"""Local query contract: civil days, matched slots, stable pagination, no inferred facts."""
import csv
import io
import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

from .db import DEPARTMENTS, now
from .export import records
from .language import french_title

PARIS = ZoneInfo('Europe/Paris')


def folded(value):
    return ''.join(c for c in unicodedata.normalize('NFKD',str(value or '')).casefold()
                   if not unicodedata.combining(c))


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','template'):
            self.hidden += 1
        if tag in ('p','br','div','li') and not self.hidden:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in ('script','style','template'):
            self.hidden = max(0,self.hidden-1)
        if not self.hidden:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value):
    if not value:
        return None
    parser = PlainText()
    parser.feed(str(value))
    return re.sub(r'\s+',' ',''.join(parser.parts)).strip() or None


def window(first, last):
    if not isinstance(first,str) or not isinstance(last,str):
        raise ValueError('dates_required')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',first) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',last):
        raise ValueError('dates_must_be_YYYY_MM_DD')
    a,b = date.fromisoformat(first),date.fromisoformat(last)
    if b<a or b==date.max or (b-a).days>365:
        raise ValueError('date_window_must_be_1_to_366_days')
    lo = datetime.combine(a,time.min,PARIS).astimezone(timezone.utc)
    hi = datetime.combine(b+timedelta(days=1),time.min,PARIS).astimezone(timezone.utc)
    return lo.isoformat(),hi.isoformat()


def slot_predicate(first,last,include_cancelled=False):
    lo,hi = window(first,last)
    # A performance ending exactly at midnight does not occupy the following day.
    # A point event (missing/equal end) is included if its start is inside the window.
    sql = "((c.precision='date' AND c.start_date<=? AND coalesce(c.end_date,c.start_date)>=?) OR " \
          "(c.precision='datetime' AND c.start_at<? AND (c.end_at>? OR c.start_at>=?)))"
    if not include_cancelled:
        sql += " AND c.status<>'cancelled'"
    return sql,[last,first,hi,lo,lo]


ACTIVE = "EXISTS (SELECT 1 FROM upstream_presence p WHERE p.provider=r.provider AND p.external_id=r.external_id AND p.kind=r.kind AND p.active=1)"


def validated(filters):
    allowed = {'kind','from_date','to_date','department','city','source_id','text','include_inactive','page','page_size','rail_filter'}
    if set(filters)-allowed:
        raise ValueError('unknown_search_filter')
    f = {'kind':'event','page':1,'page_size':20,'include_inactive':False,'rail_filter':'within_20_min',**filters}
    if f['rail_filter'] not in ('all','within_20_min','unknown','outside'):
        raise ValueError('invalid_rail_filter')
    if f['kind'] not in ('event','educational_offer','venue'):
        raise ValueError('invalid_kind')
    for key,maximum in (('page',100000),('page_size',100)):
        if type(f[key]) is not int or not 1<=f[key]<=maximum:
            raise ValueError('invalid_'+key)
    if type(f['include_inactive']) is not bool:
        raise ValueError('invalid_include_inactive')
    for key in ('city','source_id','department','text'):
        if f.get(key) is not None and (not isinstance(f[key],str) or len(f[key])>200):
            raise ValueError('invalid_'+key)
    if f.get('department') and f['department'] not in DEPARTMENTS:
        raise ValueError('invalid_department')
    if f['kind']=='event':
        window(f.get('from_date'),f.get('to_date'))
    return f


def selection(f):
    parts,params = ['r.kind=?'],[f['kind']]
    if not f['include_inactive']:
        parts.extend(["r.status<>'cancelled'",ACTIVE])
    for key in ('department','source_id'):
        if f.get(key):
            parts.append('r.'+('department_code' if key=='department' else key)+'=?')
            params.append(f[key])
    if f.get('city'):
        parts.append("fold(json_extract(r.data_json,'$.city'))=fold(?)");params.append(f['city'])
    if f.get('text'):
        fields = " || ' ' || ".join("coalesce(json_extract(r.data_json,'$."+k+"'),'')" for k in ('title','city','theme','location_name','description'))
        parts.append('instr(fold('+fields+'),fold(?))>0');params.append(f['text'])
    if f['kind']=='event':
        predicate,values = slot_predicate(f['from_date'],f['to_date'],f['include_inactive'])
        # Sort by the first matching occurrence, not by an earlier unrelated session.
        query = ('SELECT r.*,min(CASE WHEN c.precision=\'datetime\' THEN c.start_at ELSE civil_start(c.start_date) END) AS sort_at '
                 'FROM current_records r JOIN occurrences c ON c.observation_id=r.observation_id WHERE '
                 +' AND '.join(parts)+' AND '+predicate+' GROUP BY r.id')
        return query,params+values
    return 'SELECT r.*,r.title AS sort_at FROM current_records r WHERE '+' AND '.join(parts),params


def detail(conn, entity_id, *, first=None,last=None,include_inactive=False,rail_index=None):
    from .rail import RailIndex
    record = next(records(conn,entity_id=entity_id,limit=1),None)
    if not record:
        raise ValueError('record_not_found')
    record['title'] = french_title(record['title'])
    record['source_active'] = bool(conn.execute(
        'SELECT 1 FROM upstream_presence WHERE provider=? AND external_id=? AND kind=? AND active=1 LIMIT 1',
        (record['provider'],record['external_id'],record['kind'])).fetchone())
    record['source_name'] = conn.execute('SELECT name FROM sources WHERE id=?',(record['source_id'],)).fetchone()[0]
    record['description_text'] = plain(record.pop('description',None))
    record['conditions_text'] = plain(record.get('conditions_text'))
    record['occurrence_count'] = len(record['occurrences'])
    if first and last and record['kind']=='event':
        predicate,params = slot_predicate(first,last,include_inactive)
        oid = conn.execute('SELECT current_observation_id FROM entities WHERE id=?',(entity_id,)).fetchone()[0]
        ids = {r[0] for r in conn.execute('SELECT c.id FROM occurrences c WHERE c.observation_id=? AND '+predicate,[oid,*params])}
        record['occurrences'] = [s for s in record['occurrences'] if s['id'] in ids]
    record['possible_duplicates'] = [dict(r) for r in conn.execute(
        'SELECT r.id,r.title,r.provider,r.source_id FROM duplicate_candidates d JOIN current_records r '
        'ON r.id=CASE WHEN d.first_entity_id=? THEN d.second_entity_id ELSE d.first_entity_id END '
        "WHERE (d.first_entity_id=? OR d.second_entity_id=?) AND d.status='pending' LIMIT 20",(entity_id,entity_id,entity_id))]
    record['price_text'] = record['conditions_text']
    school = record.get('school_conditions') or {}
    if school.get('price_amount') is not None:
        record['price_text'] = ' '.join(str(school.get(k) or '') for k in ('price_amount','price_currency','price_unit'))
    # Keep the status explicit even when this is shown by a direct detail link.
    record['inactive'] = not record['source_active'] or record['status']=='cancelled'
    record['rail_walk'] = (rail_index or RailIndex(conn)).assess(record)
    return record


def configure_functions(conn, rail_index):
    conn.create_function('fold',1,folded,deterministic=True)
    conn.create_function('civil_start',1,lambda day:datetime.combine(date.fromisoformat(day),time.min,PARIS).astimezone(timezone.utc).isoformat(),deterministic=True)
    conn.create_function('rail_status',1,lambda data:rail_index.assess(data)['status'],deterministic=True)


def search(conn, **filters):
    from .rail import RailIndex
    f = validated(filters)
    rail_index = RailIndex(conn)
    configure_functions(conn,rail_index)
    query,params = selection(f)
    counts = {r[0]:r[1] for r in conn.execute('SELECT rail_status(data_json),count(*) FROM ('+query+') GROUP BY 1',params)}
    if f['rail_filter']!='all':
        query = 'SELECT * FROM ('+query+') WHERE rail_status(data_json)=?'
        params = [*params,f['rail_filter']]
    total = conn.execute('SELECT count(*) FROM ('+query+')',params).fetchone()[0]
    rows = conn.execute(query+' ORDER BY sort_at,title,id LIMIT ? OFFSET ?',
                        [*params,f['page_size'],(f['page']-1)*f['page_size']]).fetchall()
    items = [detail(conn,r['id'],first=f.get('from_date'),last=f.get('to_date'),include_inactive=f['include_inactive'],rail_index=rail_index) for r in rows]
    return {'items':items,'total':total,'page':f['page'],'page_size':f['page_size'],
            'pages':(total+f['page_size']-1)//f['page_size'],'filters':f,'generated_at':now(),'rail_counts':counts,
            'date_semantics':'Europe/Paris; date ranges do not confirm daily opening or group availability'}


def csv_export(items):
    buffer = io.StringIO(newline='')
    writer = csv.writer(buffer)
    fields = ('title','date_start','date_end','time_precision','city','location_name','address',
              'department_code','description_text','price_text','status','source_name','canonical_url','observed_at','source_updated_at',
              'rail_status','station_name','walking_seconds','walking_metres','route_checked_at','route_provider','route_evidence_url')
    writer.writerow(fields)
    def cell(value):
        value = '' if value is None else str(value)
        return "'"+value if value.lstrip().startswith(('=','+','-','@')) or value.startswith(('\t','\r','\n')) else value
    for item in items:
        for slot in item['occurrences'] or [{}]:
            row = {**item,'date_start':slot.get('start_at') or slot.get('start_date'),
                   'date_end':slot.get('end_at') or slot.get('end_date'),'time_precision':slot.get('precision','unknown')}
            rail = item.get('rail_walk') or {}
            row.update(rail_status=rail.get('status'),station_name=rail.get('station_name'),walking_seconds=rail.get('walking_seconds'),
                       walking_metres=rail.get('walking_metres'),route_checked_at=rail.get('checked_at'),route_provider=rail.get('provider'),route_evidence_url=rail.get('evidence_url'))
            writer.writerow([cell(row.get(k)) for k in fields])
    return '\ufeff'+buffer.getvalue()
