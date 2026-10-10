"""Read/query API for downstream planners; no raw pages or contact lists in exports."""
import json
import os
import tempfile
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .db import dumps, now
from .ingest import collection_url
from .policy import latest_review, timestamp

FACT_FIELDS = {'title','canonical_url','official_url','booking_url','venue_url','department_code','commune_code','latitude','longitude',
               'address','city','location_name','status','edition_year','attendance_mode',
               'age','source_updated_date','venue_external_id','theme','source_calendar',
               'schedule_text','schedule_semantics','schedule_periods','producer','provider_types',
               'public_opening_information','learning_topics','booking_conditions','conditions_text'}


def records(conn, *, kind=None, department=None, limit=1000, public=False, text=None, from_date=None, to_date=None, entity_id=None):
    if not 1<=limit<=10000:
        raise ValueError('limit_must_be_1_to_10000')
    where,params = [],[]
    if entity_id:
        where.append('id=?');params.append(entity_id)
    if kind:
        where.append('kind=?')
        params.append(kind)
    if department:
        where.append('department_code=?')
        params.append(department)
    first = date.fromisoformat(from_date) if from_date else None
    last = date.fromisoformat(to_date) if to_date else None
    if last == date.max:
        raise ValueError('date_filter_end_out_of_range')
    if first and last and last<first:
        raise ValueError('date_filter_end_before_start')
    # Date filters are inclusive civil days in Occitanie, including DST changes.
    if first or last:
        date_parts,datetime_parts,date_params,datetime_params = [],[],[],[]
        if first:
            date_parts.append('coalesce(c.end_date,c.start_date)>=?');date_params.append(first.isoformat())
            datetime_parts.append('coalesce(c.end_at,c.start_at)>=?')
            datetime_params.append(datetime.combine(first,time.min,ZoneInfo('Europe/Paris')).astimezone(timezone.utc).isoformat())
        if last:
            date_parts.append('c.start_date<=?');date_params.append(last.isoformat())
            datetime_parts.append('c.start_at<?')
            datetime_params.append(datetime.combine(last+timedelta(days=1),time.min,ZoneInfo('Europe/Paris')).astimezone(timezone.utc).isoformat())
        where.append("EXISTS (SELECT 1 FROM occurrences c WHERE c.observation_id=current_records.observation_id AND "
                     "((c.precision='date' AND "+' AND '.join(date_parts)+") OR (c.precision='datetime' AND "+' AND '.join(datetime_parts)+')))')
        params.extend(date_params+datetime_params)
    def folded(value):
        return ''.join(c for c in unicodedata.normalize('NFKD',str(value or '')).casefold() if not unicodedata.combining(c))
    if text is not None and (not isinstance(text,str) or len(text)>200):
        raise ValueError('text_filter_must_be_at_most_200_characters')
    query = 'SELECT * FROM current_records'+(' WHERE '+' AND '.join(where) if where else '')+' ORDER BY id'
    count = 0
    for row in conn.execute(query,params):
        review = latest_review(conn,row['source_id'])
        if public and (not review or not review['facts_reuse_allowed'] or timestamp(review['expires_at'])<=now()):
            continue
        snap = conn.execute('SELECT url,fetched_at,sha256 FROM snapshots WHERE id=?',(row['snapshot_id'],)).fetchone()
        membership = conn.execute('SELECT active FROM upstream_presence WHERE provider=? AND external_id=? AND kind=? AND source_id=? AND collection_url=?',
                                  (row['provider'],row['external_id'],row['kind'],row['source_id'],collection_url(snap['url']))).fetchone()
        if public and (not membership or not membership['active']):
            continue
        data = json.loads(row['data_json'])
        if text and folded(text) not in folded(' '.join(str(data.get(k) or '') for k in ('title','city','theme','location_name'))):
            continue
        result = {k:data.get(k) for k in sorted(FACT_FIELDS)}
        if not public or review['description_reuse_allowed']:
            result['description'] = data.get('description')
        result.update(id=row['id'],kind=row['kind'],provider=row['provider'],external_id=row['external_id'],
                      source_id=row['source_id'],observed_at=row['observed_at'],source_updated_at=row['source_updated_at'],
                      source_active=bool(membership and membership['active']),
                      evidence={'url':snap['url'],'snapshot_id':row['snapshot_id'],'sha256':snap['sha256'],'fetched_at':snap['fetched_at']})
        result['occurrences'] = [dict(r) for r in conn.execute('SELECT id,start_at,end_at,start_date,end_date,timezone,precision,status,recurrence_rule,exceptions_json FROM occurrences WHERE observation_id=? ORDER BY coalesce(start_at,start_date)',(row['observation_id'],))]
        school = conn.execute('SELECT * FROM school_conditions WHERE observation_id=?',(row['observation_id'],)).fetchone()
        result['school_conditions'] = {k:v for k,v in dict(school).items() if k!='observation_id'} if school else None
        if result['school_conditions'] is not None:
            for name in ('grade_levels','languages'):
                result['school_conditions'][name] = json.loads(result['school_conditions'].pop(name+'_json'))
        result['unresolved_issues'] = [r[0] for r in conn.execute('SELECT DISTINCT code FROM review_issues WHERE entity_id=? AND resolved_at IS NULL ORDER BY code',(row['id'],))]
        result['availability'] = [dict(r) for r in conn.execute('SELECT occurrence_id,status,seats,confirmed_at,valid_until,supplier_name,evidence_url FROM availability_confirmations WHERE entity_id=? AND valid_until>? '
            'AND (occurrence_id IS NULL OR occurrence_id IN (SELECT id FROM occurrences WHERE observation_id=?))',(row['id'],now(),row['observation_id']))]
        result['rail_access'] = [dict(r) for r in conn.execute('SELECT station_id,station_name,walking_seconds,walking_metres,accessible_route,checked_at,valid_until,evidence_url FROM rail_access_checks WHERE entity_id=? AND valid_until>?',(row['id'],now()))]
        result['planning_status'] = 'requires_confirmation'
        result['attribution'] = review['attribution'] if review else None
        result['license'] = review['license_name'] if review else 'unreviewed'
        yield result
        count += 1
        if count>=limit:
            break


def export_jsonl(conn, path, **filters):
    count = 0
    path = Path(path)
    if path.exists() or path.is_symlink():
        raise FileExistsError('export destination already exists')
    # Publish only complete output, atomically and without replacing an existing file.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=path.parent,prefix='.events-',delete=False) as file:
            temporary = Path(file.name)
            for record in records(conn,**filters):
                file.write(dumps(record)+'\n')
                count += 1
            file.flush()
            os.fsync(file.fileno())
        os.link(temporary,path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {'exported':count,'path':str(path),'public':filters.get('public',False)}
