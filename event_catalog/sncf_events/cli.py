from __future__ import annotations

import argparse
import contextlib
import json
import os
import sqlite3
import sys
from pathlib import Path

from . import __version__
from .connectors import configure_endpoint, enable_endpoint, initial_url, install_default_endpoints, run_endpoint
from .credentials import credential_environment
from .diagnostics import doctor
from .audit_data import audit_data
from .db import ROOT, audit, backup, connect, import_registry, migrate, now, report, writer_lock
from .export import export_jsonl, records
from .ingest import finish_run, ingest_file, retry_quarantined
from .policy import review_source, set_source_enabled


def parser():
    p = argparse.ArgumentParser(description='Occitanie evidence-first data toolkit. Run under approved host resource admission.')
    p.add_argument('--version',action='version',version=__version__)
    p.add_argument('--db',default=str(ROOT/'var'/'occitanie.sqlite3'))
    p.add_argument('--env-file',help='literal credential file for sync/doctor; defaults to project .env if present')
    sub = p.add_subparsers(dest='command',required=True)
    init = sub.add_parser('init',help='apply migrations and import source registry; no network')
    init.add_argument('--seed',default=str(ROOT/'data'/'seeds'/'sources-2026-10-10.json'))
    sub.add_parser('migrate')
    web = sub.add_parser('serve',help='foreground local browser tool; no background service installation')
    web.add_argument('--port',type=int,default=8766)
    web.add_argument('--seconds',type=int,default=43200,help='bounded foreground session, at most 12 hours')
    web.add_argument('--read-only',action='store_true')
    web.add_argument('--base-path',default='/')
    viewer = sub.add_parser('viewer-access',help='generate private hosted-viewer credentials; prints paths only')
    viewer.add_argument('directory',help='new private directory; never overwrite existing credentials')
    viewer.add_argument('--username',default='zhaoyang')
    stations = sub.add_parser('import-stations',help='import pinned reviewed railway dataset; local files only')
    stations.add_argument('directory',help='backend/data directory from the pinned upstream commit')
    walking = sub.add_parser('walk-check',help='create or continue a bounded pedestrian route batch')
    walking.add_argument('--from-date')
    walking.add_argument('--to-date')
    walking.add_argument('--kind',default='event',choices=['event','educational_offer','venue'])
    walking.add_argument('--department')
    walking.add_argument('--resume')
    walking.add_argument('--budget',type=int,default=10)
    live = sub.add_parser('setup-live',help='idempotent live profile: schema, registry, recorded reviews, endpoints, stations; no network')
    live.add_argument('--stations-dir',help='backend/data directory from the pinned upstream commit')
    found = sub.add_parser('stations',help='search railway stations by name or UIC identifier')
    found.add_argument('query',nargs='?',default='')
    found.add_argument('--limit',type=int,default=20)
    for name,text in (('near','stored activities within a checked 20-minute walk of the given stations; no network'),
                      ('collect-near','bounded live collection around the given stations, then the same answer')):
        near = sub.add_parser(name,help=text)
        near.add_argument('--station',action='append',required=True,help='UIC identifier or exact name; repeat for stations along a route')
        near.add_argument('--date',required=True,help='Occitanie civil date YYYY-MM-DD')
        if name=='collect-near':
            near.add_argument('--seconds',type=int,default=300,help='foreground time budget, at most 1800')
    seed = sub.add_parser('import-sources')
    seed.add_argument('path')
    sources = sub.add_parser('sources')
    sources.add_argument('--priority',choices=['P0','P1','P2','P3'])
    sources.add_argument('--department')
    sub.add_parser('report')
    selected = sub.add_parser('search',help='date query; defaults to verified pedestrian estimates within 20 minutes')
    selected.add_argument('--from-date')
    selected.add_argument('--to-date')
    selected.add_argument('--kind',default='event',choices=['event','educational_offer','venue'])
    selected.add_argument('--department')
    selected.add_argument('--city')
    selected.add_argument('--text')
    selected.add_argument('--rail-filter',default='within_20_min',choices=['within_20_min','all','unknown','outside'])
    selected.add_argument('--page',type=int,default=1)
    selected.add_argument('--page-size',type=int,default=20)
    sub.add_parser('check',help='SQLite integrity and foreign-key checks')
    sub.add_parser('doctor',help='local configuration and key presence only; never fetches or prints keys')
    sub.add_parser('audit-data',help='verify stored evidence hashes, field values and occurrence projections; no network')
    sub.add_parser('endpoints')
    review = sub.add_parser('review-source')
    review.add_argument('source_id')
    review.add_argument('review_json')
    for name in ('enable-source','disable-source'):
        cmd = sub.add_parser(name)
        cmd.add_argument('source_id')
    endpoint = sub.add_parser('configure-endpoint')
    endpoint.add_argument('id')
    endpoint.add_argument('source_id')
    endpoint.add_argument('connector')
    endpoint.add_argument('--config',default='{}',help='JSON object; credentials are never allowed here')
    enable = sub.add_parser('enable-endpoint')
    enable.add_argument('id')
    plan = sub.add_parser('plan',help='show endpoint request without fetching or reading credentials')
    plan.add_argument('id')
    run = sub.add_parser('sync',help='bounded sequential API/JSON-LD ingestion; host admission required')
    run.add_argument('id')
    run.add_argument('--max-pages',type=int,default=3)
    run.add_argument('--resume')
    imp = sub.add_parser('ingest-file',help='local attributed export; does not enable the source or authorize redistribution')
    imp.add_argument('source_id')
    imp.add_argument('path')
    imp.add_argument('--format',required=True,choices=['manual','jsonld','openagenda_events','openagenda_agendas','datatourisme_events','datatourisme_places','occitanie_region_events','fabre_school_offers'])
    imp.add_argument('--evidence-url',required=True)
    for name in ('records','export'):
        query = sub.add_parser(name)
        query.add_argument('--kind',choices=['event','educational_offer','venue'])
        query.add_argument('--department')
        query.add_argument('--limit',type=int,default=1000)
        query.add_argument('--public',action='store_true')
        query.add_argument('--text',help='case/accent-insensitive title, city, theme or venue search')
        query.add_argument('--from-date',help='inclusive Occitanie civil date YYYY-MM-DD')
        query.add_argument('--to-date',help='inclusive Occitanie civil date YYYY-MM-DD')
        if name=='export':
            query.add_argument('path')
    b = sub.add_parser('backup')
    b.add_argument('path')
    for name in ('issues','quarantine','runs','agendas','duplicates'):
        q = sub.add_parser(name)
        q.add_argument('--limit',type=int,default=100)
    close = sub.add_parser('close-interrupted-run',help='close a crashed run after obtaining the writer mutex; never kills a process')
    close.add_argument('id')
    retry = sub.add_parser('retry-quarantine',help='reparse one retained record locally after fixing its mapper; no network')
    retry.add_argument('id',type=int)
    retry.add_argument('--format',required=True,choices=['manual','jsonld','openagenda_events','datatourisme_events','datatourisme_places','occitanie_region_events','fabre_school_offers'])
    resolve = sub.add_parser('resolve-issue')
    resolve.add_argument('id',type=int)
    resolve.add_argument('--resolution',required=True)
    choose = sub.add_parser('select-observation',help='explicitly resolve which stored revision should be current')
    choose.add_argument('entity_id')
    choose.add_argument('observation_id',type=int)
    choose.add_argument('--reason',required=True)
    return p


def dispatch(conn,args):
    command = args.command
    if command in ('init','migrate'):
        migrate(conn)
        if command=='init':
            result = import_registry(conn,args.seed)
            install_default_endpoints(conn)
            return result
        return {'migrated':True}
    if command=='import-sources':
        return import_registry(conn,args.path)
    if command=='import-stations':
        from .rail import import_stations
        conn.execute('PRAGMA max_page_count='+str(16*1024**2//conn.execute('PRAGMA page_size').fetchone()[0]))
        return import_stations(conn,args.directory)
    if command=='setup-live':
        from .nearby import setup
        return setup(conn,args.stations_dir)
    if command=='stations':
        from .nearby import stations
        return stations(conn,args.query,args.limit)
    if command=='near':
        from .nearby import lookup
        return lookup(conn,args.station,args.date)
    if command=='collect-near':
        import time
        from . import nearby
        if not 1<=args.seconds<=1800:
            raise ValueError('invalid_collection_time_budget')
        nearby.request(conn,args.station,args.date)
        deadline = time.monotonic()+args.seconds
        throttled = None
        while time.monotonic()<deadline and nearby.lookup(conn,args.station,args.date)['pending']:
            step = nearby.process_one(conn)
            if step and 'throttled' in step:
                throttled = step['throttled']
                break
        return {**nearby.lookup(conn,args.station,args.date),'throttled':throttled}
    if command=='walk-check':
        from . import rail
        conn.execute('PRAGMA max_page_count='+str(16*1024**2//conn.execute('PRAGMA page_size').fetchone()[0]))
        if args.resume:
            item = rail.resume(conn,args.resume)
        else:
            item = rail.enqueue(conn,dict(kind=args.kind,from_date=args.from_date,to_date=args.to_date,department=args.department),budget=args.budget)
        while item['status'] in ('queued','running'):
            item = rail.process_one(conn,item['id'])
        return item
    if command=='report':
        return report(conn)
    if command=='search':
        from .search import search
        return search(conn,**{key:getattr(args,key) for key in ('from_date','to_date','kind','department','city','text','rail_filter','page','page_size')})
    if command=='doctor':
        return doctor(conn)
    if command=='audit-data':
        return audit_data(conn)
    if command=='check':
        integrity = [r[0] for r in conn.execute('PRAGMA integrity_check')]
        foreign_keys = [list(r) for r in conn.execute('PRAGMA foreign_key_check')]
        return {'ok':integrity==['ok'] and not foreign_keys,'integrity':integrity,'foreign_keys':foreign_keys}
    if command=='sources':
        query = 'SELECT s.id,s.name,s.priority,s.role,s.entry_url,s.proposed_connector,s.enabled,s.last_success_at,s.last_failure_code FROM sources s WHERE 1=1'
        params = []
        if args.priority:
            query += ' AND priority=?'
            params.append(args.priority)
        if args.department:
            query += ' AND EXISTS (SELECT 1 FROM source_departments d WHERE d.source_id=s.id AND d.department_code=?)'
            params.append(args.department)
        return [dict(r) for r in conn.execute(query+' ORDER BY s.id',params)]
    if command=='review-source':
        review_source(conn,args.source_id,json.loads(Path(args.review_json).read_text()))
        return {'review_saved':args.source_id,'enabled':False}
    if command in ('enable-source','disable-source'):
        set_source_enabled(conn,args.source_id,command=='enable-source')
        return {'source_id':args.source_id,'enabled':command=='enable-source'}
    if command=='configure-endpoint':
        configure_endpoint(conn,args.id,args.source_id,args.connector,json.loads(args.config))
        return {'configured':args.id,'enabled':False}
    if command=='enable-endpoint':
        enable_endpoint(conn,args.id)
        return {'enabled':args.id}
    if command=='endpoints':
        return [dict(r) for r in conn.execute('SELECT * FROM endpoints ORDER BY id')]
    if command=='plan':
        e = conn.execute('SELECT * FROM endpoints WHERE id=?',(args.id,)).fetchone()
        if not e:
            raise ValueError('unknown_endpoint')
        return {'url':initial_url(e),'method':'GET','connector':e['connector'],'enabled':bool(e['enabled']),
                'execution_note':'No request made. Source review, credentials, and host resource admission remain necessary.'}
    if command=='sync':
        return run_endpoint(conn,args.id,max_pages=args.max_pages,resume=args.resume)
    if command=='ingest-file':
        return ingest_file(conn,args.source_id,args.path,args.format,args.evidence_url)
    if command in ('records','export'):
        filters = {'kind':args.kind,'department':args.department,'limit':args.limit,'public':args.public,
                   'text':args.text,'from_date':args.from_date,'to_date':args.to_date}
        return export_jsonl(conn,args.path,**filters) if command=='export' else list(records(conn,**filters))
    if command=='backup':
        backup(conn,args.path)
        return {'backup':args.path}
    tables = {'issues':'review_issues','quarantine':'quarantined_records','runs':'crawl_runs',
              'agendas':'discovered_agendas','duplicates':'duplicate_candidates'}
    if command in tables:
        if not 1<=args.limit<=1000:
            raise ValueError('limit_must_be_1_to_1000')
        # Quarantine payloads may contain personal details; inspect snapshots directly if needed.
        columns = 'id,snapshot_id,locator,reason,created_at,resolved_at,resolution,observation_id' if command=='quarantine' else '*'
        return [dict(r) for r in conn.execute(f'SELECT {columns} FROM {tables[command]} LIMIT ?',(args.limit,))]
    if command=='retry-quarantine':
        return retry_quarantined(conn,args.id,args.format)
    if command=='close-interrupted-run':
        finish_run(conn,args.id,'interrupted','operator_closed_crashed_run')
        with conn:
            audit(conn,'close_interrupted_run',args.id,{})
        return {'closed':args.id}
    if command=='resolve-issue':
        if not args.resolution.strip():
            raise ValueError('resolution_must_not_be_blank')
        with conn:
            updated = conn.execute('UPDATE review_issues SET resolved_at=?,resolution=? WHERE id=? AND resolved_at IS NULL',
                                  (now(),args.resolution,args.id)).rowcount
            if not updated:
                raise ValueError('issue_not_found_or_already_resolved')
            audit(conn,'resolve_issue',str(args.id),{'resolution':args.resolution})
        return {'resolved':args.id}
    if command=='select-observation':
        if not args.reason.strip():
            raise ValueError('reason_must_not_be_blank')
        if not conn.execute('SELECT 1 FROM observations WHERE id=? AND entity_id=?',(args.observation_id,args.entity_id)).fetchone():
            raise ValueError('observation_entity_mismatch')
        with conn:
            conn.execute('UPDATE entities SET current_observation_id=? WHERE id=?',(args.observation_id,args.entity_id))
            audit(conn,'select_observation',args.entity_id,{'observation_id':args.observation_id,'reason':args.reason})
        return {'entity_id':args.entity_id,'observation_id':args.observation_id}
    raise ValueError('unsupported_command')


def main(argv=None):
    args = parser().parse_args(argv)
    os.umask(0o077)
    readonly = args.command in {'sources','report','search','check','doctor','audit-data','endpoints','plan','records','export','backup','issues','quarantine','runs','agendas','duplicates','stations','near'}
    try:
        if args.command=='viewer-access':
            from .access import create_access
            print(json.dumps(create_access(args.directory,args.username),ensure_ascii=False))
            return 0
        if args.command not in {'init','migrate','setup-live'} and not Path(args.db).is_file():
            raise ValueError('database_not_initialized: run init in an admitted environment')
        if args.command=='serve':
            from .server import serve
            with credential_environment(args.env_file or ROOT/'.env',required=bool(args.env_file)):
                serve(args.db,port=args.port,seconds=args.seconds,readonly=args.read_only,base_path=args.base_path)
            return 0
        with contextlib.ExitStack() as stack:
            if args.command in {'sync','doctor','collect-near'}:
                stack.enter_context(credential_environment(args.env_file or ROOT/'.env',required=bool(args.env_file)))
            if not readonly:
                stack.enter_context(writer_lock(args.db))
            conn = stack.enter_context(contextlib.closing(connect(args.db,readonly=readonly)))
            result = dispatch(conn,args)
            print(json.dumps(result,ensure_ascii=False,indent=2))
            if isinstance(result,dict) and (result.get('ok') is False or result.get('status') in ('failed','partial','interrupted')):
                return 2
        return 0
    except KeyboardInterrupt:
        print(json.dumps({'error':'execution_interrupted'}),file=sys.stderr)
        return 130
    except (ValueError,KeyError,OSError,sqlite3.Error) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False),file=sys.stderr)
        return 2
