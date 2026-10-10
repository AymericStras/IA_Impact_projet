"""Verify stored hashes, field provenance and occurrence projections without network."""
import re

from .db import digest, dumps, loads
from .normalize import JSONLDScripts, pointer
from .html_rules import html_blocks, html_evidence


def audit_data(conn):
    hashes,fields,projections = [],[],[]
    snapshots = observations = evidence_count = 0
    # Process one snapshot at a time to keep the audit bounded by response size.
    for snap in conn.execute('SELECT id,body,sha256,content_type FROM snapshots ORDER BY id'):
        snapshots += 1
        if digest(snap['body'])!=snap['sha256']:
            hashes.append({'snapshot_id':snap['id']})
        rows = conn.execute('SELECT id,sha256,data_json FROM observations WHERE snapshot_id=? ORDER BY id',(snap['id'],)).fetchall()
        if not rows:
            continue  # Invalid input snapshots may deliberately have quarantine only.
        scripts = None
        blocks = None
        document = None
        try:
            if snap['content_type']=='text/html':
                parser=JSONLDScripts();parser.feed(snap['body']);scripts=parser.scripts
                blocks=html_blocks(snap['body'])
            else:
                document=loads(snap['body'])
        except (ValueError,RecursionError):
            fields.append({'snapshot_id':snap['id'],'error':'unparseable_observed_snapshot'})
        for row in rows:
            observations += 1
            data=loads(row['data_json'])
            comparable=loads(row['data_json'])
            for occurrence in comparable.get('occurrences') or []:
                occurrence.pop('evidence_locator',None)
            if digest(dumps(comparable))!=row['sha256']:
                hashes.append({'observation_id':row['id']})
            for ev in conn.execute('SELECT field,locator,value_json FROM field_evidence WHERE observation_id=?',(row['id'],)):
                evidence_count += 1
                try:
                    path=ev['locator'];root=document
                    if path.startswith(('html-block[','html-range[')) and blocks is not None:
                        actual=html_evidence(blocks,path)
                    elif scripts is not None:
                        match=re.fullmatch(r'script\[(\d+)\](.*)',path)
                        if not match: raise ValueError('invalid script locator')
                        root=loads(scripts[int(match[1])]);path=match[2]
                        actual=pointer(root,path)
                    else:
                        actual=pointer(root,path)
                    if dumps(actual)!=dumps(loads(ev['value_json'])):
                        raise ValueError('evidence value differs')
                except (ValueError,KeyError,TypeError,IndexError,RecursionError):
                    fields.append({'observation_id':row['id'],'field':ev['field']})
            expected={}
            duplicate_conflict=False
            for occurrence in data.get('occurrences') or []:
                key=occurrence['slot_key']
                if key in expected and {k:v for k,v in expected[key].items() if k!='evidence_locator'}!={k:v for k,v in occurrence.items() if k!='evidence_locator'}:
                    duplicate_conflict=True
                # SQL projection keeps the first occurrence of an identical slot key.
                expected.setdefault(key,occurrence)
            stored={s['slot_key']:dict(s) for s in conn.execute('SELECT * FROM occurrences WHERE observation_id=?',(row['id'],))}
            mismatch=duplicate_conflict or set(expected)!=set(stored)
            for key in set(expected)&set(stored):
                names=('start_at','end_at','start_date','end_date','timezone','precision','status','recurrence_rule','evidence_locator')
                if any(expected[key].get(name)!=stored[key][name] for name in names) or expected[key].get('exceptions',[])!=loads(stored[key]['exceptions_json']):
                    mismatch=True
            if mismatch:
                projections.append({'observation_id':row['id']})
    from .rail import parse_route,route_key
    route_errors = []
    route_evidence_count = 0
    for ev in conn.execute('SELECT * FROM walking_evidence ORDER BY id'):
        route_evidence_count += 1
        try:
            if digest(ev['response_body'])!=ev['response_sha256']:
                raise ValueError('route_evidence_hash')
            result = loads(ev['result_json'])
            row = conn.execute('SELECT * FROM walking_routes WHERE route_key=?',(ev['route_key'],)).fetchone()
            if not row:
                raise ValueError('route_cache_missing')
            station = conn.execute('SELECT * FROM rail_stations WHERE dataset_id=? AND id=?',(row['dataset_id'],row['station_id'])).fetchone()
            destination = loads(row['destination_json'])
            if route_key(station,destination)!=ev['route_key']:
                raise ValueError('route_coordinate_binding')
            if result['status']=='ok':
                seconds,metres,evidence = parse_route(ev['response_body'],station,destination)
                if (seconds,metres,evidence)!=(result['seconds'],result['metres'],result['evidence']):
                    raise ValueError('route_projection')
            if ev['checked_at']==row['checked_at'] and ev['response_sha256']==row['response_sha256']:
                if (row['seconds'],row['metres'],row['status'],loads(row['evidence_json']))!=(result['seconds'],result['metres'],result['status'],result['evidence']):
                    raise ValueError('route_cache_projection')
        except (ValueError,KeyError,TypeError,IndexError):
            route_errors.append({'walking_evidence_id':ev['id']})
    for row in conn.execute('SELECT * FROM walking_routes'):
        if not conn.execute('SELECT 1 FROM walking_evidence WHERE route_key=? AND checked_at=? AND response_sha256=?',
                            (row['route_key'],row['checked_at'],row['response_sha256'])).fetchone():
            route_errors.append({'route_key':row['route_key']})
    return {'ok':not (hashes or fields or projections or route_errors),'checked_snapshots':snapshots,
            'checked_observations':observations,'checked_field_evidence':evidence_count,
            'hash_errors':hashes,'field_evidence_errors':fields,'occurrence_projection_errors':projections,
            'checked_walking_evidence':route_evidence_count,'walking_evidence_errors':route_errors,
            'network_requests':0,'note':'Internal consistency with retained evidence; not verification of upstream truth or availability.'}
