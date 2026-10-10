"""Append evidence, quarantine invalid data, project only compatible fresh facts."""
from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from .db import audit, digest, dumps, loads, now
from .normalize import datatourisme, jsonld_event, jsonld_nodes, manual_record, oa_event, region_event
from .html_rules import HTML_CONNECTORS, fabre_offers
from .policy import timestamp


def collection_url(url):
    p = urlsplit(url)
    return urlunsplit((p.scheme,p.netloc,p.path,'',''))


def presence(conn, source_id, snapshot_id, url, provider, external_id, kind, active, updated):
    if updated:
        updated = timestamp(updated)
    previous = conn.execute('SELECT active,source_updated_at FROM upstream_presence WHERE provider=? AND external_id=? AND kind=? AND source_id=? AND collection_url=?',
                            (provider,external_id,kind,source_id,collection_url(url))).fetchone()
    if previous and previous['source_updated_at']:
        if not updated or updated<previous['source_updated_at'] or (updated==previous['source_updated_at'] and not previous['active']):
            return
    conn.execute('INSERT INTO upstream_presence VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,external_id,kind,source_id,collection_url) DO UPDATE SET '
                 'active=excluded.active,source_updated_at=excluded.source_updated_at,snapshot_id=excluded.snapshot_id,observed_at=excluded.observed_at',
                 (provider,external_id,kind,source_id,collection_url(url),int(active),updated,snapshot_id,now()))


def start_run(conn, source_id, endpoint_id=None):
    run_id = str(uuid.uuid4())
    with conn:
        conn.execute('INSERT INTO crawl_runs(id,endpoint_id,source_id,started_at,status) VALUES (?,?,?,?,?)',
                     (run_id,endpoint_id,source_id,now(),'running'))
    return run_id


def finish_run(conn, run_id, status, error=None, cursor=None):
    with conn:
        existing = conn.execute('SELECT status,cursor_json FROM crawl_runs WHERE id=?',(run_id,)).fetchone()
        if not existing or existing['status']!='running':
            raise ValueError('run_not_running')
        conn.execute('UPDATE crawl_runs SET status=?,finished_at=?,failure_code=?,cursor_json=? WHERE id=? AND status=?',
                     (status,now(),error,dumps(cursor) if cursor else (existing['cursor_json'] if status in ('failed','interrupted') else None),run_id,'running'))
        source = conn.execute('SELECT source_id FROM crawl_runs WHERE id=?',(run_id,)).fetchone()
        if status=='complete':
            conn.execute('UPDATE sources SET last_success_at=?,last_failure_code=NULL WHERE id=?',(now(),source[0]))
        elif status in ('failed','partial','interrupted'):
            conn.execute('UPDATE sources SET last_failure_code=? WHERE id=?',(error or status,source[0]))


def snapshot(conn, run_id, source_id, url, body, content_type, *, sanitized=False):
    if len(body.encode())>2*1024*1024:
        raise ValueError('snapshot_too_large')
    conn.execute('INSERT OR IGNORE INTO snapshots(source_id,run_id,url,fetched_at,content_type,http_status,sha256,body,sanitized) '
                 'VALUES (?,?,?,?,?,200,?,?,?)',
                 (source_id,run_id,url,now(),content_type,digest(body),body,int(sanitized)))
    return conn.execute('SELECT id FROM snapshots WHERE run_id=? AND url=? AND sha256=?',
                        (run_id,url,digest(body))).fetchone()[0]


def issue(conn, entity_id, observation_id, code, detail):
    conn.execute('INSERT INTO review_issues(entity_id,observation_id,code,detail,created_at) VALUES (?,?,?,?,?)',
                 (entity_id,observation_id,code,detail,now()))


def persist_candidate(conn, source_id, snapshot_id, candidate):
    c = candidate.validate()
    eid = str(uuid.uuid5(uuid.NAMESPACE_URL,dumps([c.provider,c.external_id,c.kind])))
    time = now()
    conn.execute('INSERT INTO entities(id,kind,provider,external_id,created_at,last_seen_at) VALUES (?,?,?,?,?,?) '
                 'ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at',
                 (eid,c.kind,c.provider,c.external_id,time,time))
    raw = dumps(c.data)
    comparable = json.loads(raw)
    for occurrence in comparable.get('occurrences') or []:
        occurrence.pop('evidence_locator',None)
    checksum = digest(dumps(comparable))
    previous = conn.execute('SELECT o.* FROM entities e JOIN observations o ON o.id=e.current_observation_id WHERE e.id=?',(eid,)).fetchone()
    existing = conn.execute('SELECT id FROM observations WHERE entity_id=? AND snapshot_id=? AND locator=?',
                           (eid,snapshot_id,c.locator)).fetchone()
    if existing:
        return eid
    cursor = conn.execute('INSERT INTO observations(entity_id,source_id,snapshot_id,locator,observed_at,source_updated_at,sha256,data_json) '
                          'VALUES (?,?,?,?,?,?,?,?)',
                          (eid,source_id,snapshot_id,c.locator,time,c.data.get('source_updated_at'),checksum,raw))
    oid = cursor.lastrowid
    for key,ev in c.evidence.items():
        conn.execute('INSERT INTO field_evidence VALUES (?,?,?,?,?)',(oid,key,ev['locator'],dumps(ev['value']),c.method))
    for s in c.data.get('occurrences') or []:
        conn.execute('INSERT OR IGNORE INTO occurrences(observation_id,slot_key,start_at,end_at,start_date,end_date,timezone,precision,status,recurrence_rule,exceptions_json,evidence_locator) '
                     'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                     (oid,s['slot_key'],s['start_at'],s['end_at'],s['start_date'],s['end_date'],s['timezone'],s['precision'],s['status'],s['recurrence_rule'],dumps(s['exceptions']),s['evidence_locator']))
    school = c.data.get('school') or {}
    columns = ['school_groups','min_age','max_age','min_group','max_group','grade_levels_json',
               'learning_objectives','duration_minutes','languages_json','booking_required','booking_url',
               'notice_days','price_amount','price_currency','price_unit']
    values = {k:school.get(k) for k in columns}
    values.update(school_groups=school.get('school_groups','unknown'),booking_required=school.get('booking_required','unknown'),
                  grade_levels_json=dumps(school.get('grade_levels',[])),languages_json=dumps(school.get('languages',[])))
    conn.execute(f"INSERT INTO school_conditions(observation_id,{','.join(columns)}) VALUES ({','.join('?' for _ in range(len(columns)+1))})",
                 [oid,*(values[k] for k in columns)])
    for code in set(c.issues):
        issue(conn,eid,oid,code,'Requires source or organizer confirmation.')
    promote = True
    if previous and previous['sha256']!=checksum:
        old = json.loads(previous['data_json'])
        old_marker = old.get('source_updated_at') or old.get('source_updated_date')
        new_marker = c.data.get('source_updated_at') or c.data.get('source_updated_date')
        if old_marker and new_marker and (len(old_marker)==10 or len(new_marker)==10):
            # Compare at the least precise published granularity; no invented midnight.
            old_marker,new_marker = old_marker[:10],new_marker[:10]
        older = old_marker and new_marker and new_marker<old_marker
        unknown_freshness = old_marker and not new_marker
        if older or unknown_freshness:
            promote = False
            issue(conn,eid,oid,'stale_or_unverifiable_revision','Preserved current projection; retained incoming evidence.')
        elif previous['source_id']!=source_id:
            promote = False
            issue(conn,eid,oid,'shared_upstream_conflict','Same provider ID differs between registered sources; review before selecting a revision.')
        elif new_marker and new_marker==old_marker:
            promote = False
            issue(conn,eid,oid,'same_timestamp_conflict','Different data carries the same upstream update timestamp.')
        if old.get('status')!=c.data.get('status'):
            issue(conn,eid,oid,'status_changed','Observed change: '+str(old.get('status'))+' -> '+str(c.data.get('status')))
    if promote:
        conn.execute('UPDATE entities SET current_observation_id=? WHERE id=?',(oid,eid))
        # Missing-field alerts on superseded observations are historical, not current conflicts.
        conn.execute("UPDATE review_issues SET resolved_at=?,resolution='superseded observation' "
                     "WHERE entity_id=? AND observation_id<>? AND resolved_at IS NULL "
                     "AND code IN ('missing_occurrences','school_group_conditions_unknown','coordinates_missing',"
                     "'exact_hours_unknown','status_not_published','record_update_time_unknown',"
                     "'date_range_not_daily_availability','source_description_is_excerpt',"
                     "'coordinates_outside_region_envelope','period_requires_schedule_review','publisher_id_missing',"
                     "'educational_suitability_unreviewed','offer_validity_unconfirmed','group_capacity_unknown',"
                     "'booking_slots_unpublished')",(time,eid,oid))
        if c.data.get('commune_code'):
            matches = conn.execute('SELECT id FROM current_records WHERE id<>? AND kind=? AND commune_code=? AND lower(title)=lower(?) LIMIT 50',
                                   (eid,c.kind,c.data['commune_code'],c.data['title'])).fetchall()
            for match in matches:
                first,second = sorted([eid,match[0]])
                conn.execute('INSERT OR IGNORE INTO duplicate_candidates(first_entity_id,second_entity_id,reason) VALUES (?,?,?)',
                             (first,second,'same kind, title and commune; identity is NOT automatically merged'))
    return eid


def parse_items(body, connector, source_id):
    if connector=='fabre_school_offers':
        yield from fabre_offers(body,source_id)
        return
    if connector=='jsonld':
        for locator,raw in jsonld_nodes(body):
            yield locator,raw,lambda r=raw,l=locator: jsonld_event(r,source_id,l)
        return
    doc = loads(body)
    key = {'openagenda_events':'events','openagenda_agendas':'agendas',
           'datatourisme_events':'objects','datatourisme_places':'objects','manual':'records',
           'occitanie_region_events':'results'}[connector]
    rows = doc.get(key)
    if not isinstance(rows,list) or len(rows)>1000:
        raise ValueError('invalid_page_envelope')
    for i,raw in enumerate(rows):
        locator = f'/{key}/{i}'
        if connector=='openagenda_events':
            factory = lambda r=raw,l=locator:oa_event(r,l)
        elif connector.startswith('datatourisme_'):
            factory = lambda r=raw,l=locator:datatourisme(r,'event' if connector.endswith('events') else 'venue',l)
        elif connector=='occitanie_region_events':
            factory = lambda r=raw,l=locator:region_event(r,l)
        elif connector=='manual':
            factory = lambda r=raw,l=locator:manual_record(r,source_id,l)
        else:
            factory = None
        yield locator,raw,factory


def ingest_page(conn, run_id, source_id, url, body, connector, *, sanitized=False):
    accepted = quarantined = 0
    with conn:
        sid = snapshot(conn,run_id,source_id,url,body,'text/html' if connector in HTML_CONNECTORS else 'application/json',sanitized=sanitized)
    try:
        items = list(parse_items(body,connector,source_id))
    except (ValueError,TypeError,KeyError,AttributeError,RecursionError):
        with conn:
            conn.execute('INSERT INTO quarantined_records(snapshot_id,locator,reason,payload_json,created_at) VALUES (?,?,?,?,?)',
                         (sid,'/','invalid_page_envelope',dumps({'body_in_snapshot':sid}),now()))
            conn.execute('UPDATE crawl_runs SET pages=pages+1,quarantined=quarantined+1 WHERE id=?',(run_id,))
        raise ValueError('invalid_page_envelope')
    with conn:
        conn.execute('BEGIN IMMEDIATE')
        for locator,raw,factory in items:
            conn.execute('SAVEPOINT record_ingest')
            try:
                if raw is None:
                    raise ValueError('invalid_jsonld_script')
                if connector=='openagenda_agendas':
                    if not raw.get('uid') or not raw.get('title'):
                        raise ValueError('invalid_agenda')
                    conn.execute('INSERT INTO discovered_agendas VALUES (?,?,?,?,?,?,?) '
                                 'ON CONFLICT(uid) DO UPDATE SET title=excluded.title,slug=excluded.slug,snapshot_id=excluded.snapshot_id,discovered_at=excluded.discovered_at,raw_json=excluded.raw_json',
                                 (str(raw['uid']),str(raw['title']),raw.get('slug'),source_id,sid,now(),dumps(raw)))
                elif connector=='openagenda_events' and raw.get('removed') is True:
                    if not raw.get('uid') or not raw.get('updatedAt'):
                        raise ValueError('invalid_removal_marker')
                    # Removal from a calendar is NOT proof of global cancellation.
                    presence(conn,source_id,sid,url,'openagenda',str(raw['uid']),'event',False,raw['updatedAt'])
                else:
                    candidate = factory()
                    persist_candidate(conn,source_id,sid,candidate)
                    presence(conn,source_id,sid,url,candidate.provider,candidate.external_id,candidate.kind,True,candidate.data.get('source_updated_at'))
                conn.execute('RELEASE record_ingest')
                accepted += 1
            except (ValueError,TypeError,KeyError,AttributeError,sqlite3.IntegrityError) as exc:
                conn.execute('ROLLBACK TO record_ingest')
                conn.execute('RELEASE record_ingest')
                reason = str(exc)[:160] if isinstance(exc,ValueError) else 'invalid_record_shape_or_constraint'
                conn.execute('INSERT INTO quarantined_records(snapshot_id,locator,reason,payload_json,created_at) VALUES (?,?,?,?,?)',
                             (sid,locator,reason,dumps(raw),now()))
                quarantined += 1
        conn.execute('UPDATE crawl_runs SET pages=pages+1,accepted=accepted+?,quarantined=quarantined+? WHERE id=?',
                     (accepted,quarantined,run_id))
    return {'snapshot_id':sid,'accepted':accepted,'quarantined':quarantined}


def ingest_file(conn, source_id, path, connector, evidence_url):
    from .policy import validate_public_url
    validate_public_url(evidence_url)
    file = Path(path)
    if file.stat().st_size>2*1024*1024:
        raise ValueError('file_exceeds_2_mib')
    body = file.read_text(encoding='utf-8-sig')
    run = start_run(conn,source_id)
    try:
        result = ingest_page(conn,run,source_id,evidence_url,body,connector)
        with conn:
            audit(conn,'local_file_import',run,{'connector':connector,'sha256':digest(body),'evidence_url':evidence_url})
    except Exception:
        finish_run(conn,run,'failed','local_import_failed')
        raise
    status = 'partial' if result['quarantined'] else 'complete'
    finish_run(conn,run,status,'quarantined_records' if result['quarantined'] else None)
    return {'run_id':run,'status':status,**result}


def retry_quarantined(conn, quarantine_id, connector):
    """Reparse retained evidence without refetching or rewriting the original failure."""
    row = conn.execute('SELECT q.*,s.body,s.source_id,s.url FROM quarantined_records q '
                       'JOIN snapshots s ON s.id=q.snapshot_id WHERE q.id=?',(quarantine_id,)).fetchone()
    if not row or row['resolved_at']:
        raise ValueError('quarantine_missing_or_already_resolved')
    for locator,raw,factory in parse_items(row['body'],connector,row['source_id']):
        if locator!=row['locator']:
            continue
        if not factory:
            raise ValueError('quarantine_record_not_retryable')
        with conn:
            conn.execute('BEGIN IMMEDIATE')
            candidate = factory()
            eid = persist_candidate(conn,row['source_id'],row['snapshot_id'],candidate)
            presence(conn,row['source_id'],row['snapshot_id'],row['url'],candidate.provider,candidate.external_id,
                     candidate.kind,True,candidate.data.get('source_updated_at'))
            oid = conn.execute('SELECT id FROM observations WHERE entity_id=? AND snapshot_id=? AND locator=?',
                               (eid,row['snapshot_id'],locator)).fetchone()[0]
            conn.execute('UPDATE quarantined_records SET resolved_at=?,resolution=?,observation_id=? WHERE id=?',
                         (now(),'reparsed retained evidence with '+connector,oid,quarantine_id))
            audit(conn,'retry_quarantine',str(quarantine_id),{'connector':connector,'observation_id':oid})
        return {'resolved':quarantine_id,'entity_id':eid,'observation_id':oid}
    raise ValueError('quarantined_locator_not_found')
