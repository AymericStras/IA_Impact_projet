"""Loopback browser app; optional authenticated, resource-bounded read-only hosting."""
import contextlib
import json
import os
import resource
import re
import secrets
import shutil
import sqlite3
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .credentials import credential_status
from .db import DEPARTMENTS, connect, loads, now, writer_lock
from . import refresh, rail
from .search import PARIS, csv_export, detail, search

ASSETS = Path(__file__).parent/'web'


def peak_rss():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value if sys.platform=='darwin' else value*1024


def filters(query):
    result = {}
    for k,v in query.items():
        if len(v)!=1:
            raise ValueError('duplicate_query_parameter')
        if k in ('page','page_size'):
            result[k] = int(v[0])
        elif k=='include_inactive':
            if v[0] not in ('true','false'):
                raise ValueError('invalid_include_inactive')
            result[k] = v[0]=='true'
        elif v[0]:
            result[k] = v[0]
    return result


class App:
    def __init__(self, path, *, readonly=False,base_path='/',access=None,managed=False,public=False):
        if not re.fullmatch(r'/(?:[a-z0-9-]+/)*',base_path):
            raise ValueError('invalid_base_path')
        self.path = Path(path)
        self.base_path = base_path
        self.readonly = readonly
        if (access is not None or managed or public) and not readonly:
            raise ValueError('hosted_viewer_requires_readonly')
        if managed and access is None and not public:
            raise ValueError('hosted_viewer_requires_authentication')
        if public and (not managed or access is not None):
            raise ValueError('public_viewer_requires_managed_readonly_without_credentials')
        self.access = access
        self.managed = managed
        self.last_request = 0.0
        self.transfer_next = 0.0
        self.csrf = secrets.token_urlsafe(32)
        self.stop = threading.Event()
        self.worker = None
        self.worker_error = None

    def metadata(self,conn):
        return {'version':__version__,'today':datetime.now(PARIS).date().isoformat(),'timezone':'Europe/Paris',
                'csrf':self.csrf,'readonly':self.readonly,'base_path':self.base_path,'credentials':credential_status(),
                'rail_stations':conn.execute('SELECT count(*) FROM rail_stations s JOIN rail_datasets d ON d.id=s.dataset_id WHERE d.active=1').fetchone()[0],
                'counts':{r[0]:r[1] for r in conn.execute('SELECT kind,count(*) FROM entities GROUP BY kind')},
                'registered_sources':conn.execute('SELECT count(*) FROM sources').fetchone()[0],
                'departments':DEPARTMENTS,
                'sources':[dict(r) for r in conn.execute('SELECT s.id,s.name,count(*) AS records FROM current_records r JOIN sources s ON s.id=r.source_id GROUP BY s.id ORDER BY s.id')],
                'cities':[r[0] for r in conn.execute("SELECT DISTINCT json_extract(data_json,'$.city') AS city FROM current_records WHERE city IS NOT NULL ORDER BY city")],
                'endpoints':[{'id':e['id'],'name':e['name']} for e in refresh.endpoints(conn)],
                'settings':refresh.settings(conn),'storage':refresh.storage(conn),'worker_error':self.worker_error}

    def start_worker(self):
        if self.readonly:
            return
        with writer_lock(self.path),contextlib.closing(connect(self.path)) as conn:
            refresh.recover(conn)
            rail.recover(conn)
        self.worker = threading.Thread(target=self._work,name='occitanie-refresh',daemon=False)
        self.worker.start()

    def _work(self):
        from .connectors import run_endpoint
        from .http import Client
        def runner(conn,*args,**kwargs):
            return run_endpoint(conn,*args,client_factory=lambda *a,**kw:Client(*a,seconds=25,**kw),**kwargs)
        while not self.stop.wait(2):
            try:
                if shutil.disk_usage(self.path.parent).free<1024**3:
                    self.worker_error = 'disk_space_low'
                    continue
                if peak_rss()>128*1024**2:
                    self.worker_error = 'memory_budget_reached'
                    self.stop.set()
                    break
                with writer_lock(self.path),contextlib.closing(connect(self.path)) as conn:
                    page_size = conn.execute('PRAGMA page_size').fetchone()[0]
                    conn.execute('PRAGMA max_page_count='+str(refresh.STORAGE_BYTES//page_size))
                    refresh.scheduled_tick(conn)
                    active = conn.execute("SELECT id FROM refresh_jobs WHERE status IN ('queued','running')").fetchone()
                    if active:
                        refresh.process_one(conn,active[0],runner=runner)
                    else:
                        walking = conn.execute("SELECT id FROM walking_jobs WHERE status IN ('queued','running')").fetchone()
                        if walking:
                            rail.process_one(conn,walking[0])
                self.worker_error = None
            except ValueError:
                self.worker_error = 'database_writer_busy_or_configuration_error'
            except (sqlite3.Error,OSError):
                self.worker_error = 'database_or_storage_error'
                self.stop.set()

    def close(self):
        self.stop.set()
        if self.worker:
            self.worker.join()  # One bounded request finishes; no abandoned ingestion thread.


class Handler(BaseHTTPRequestHandler):
    server_version = 'OccitanieLocal'
    sys_version = ''

    def log_message(self,*args):
        pass  # No query strings or source content in access logs.

    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def handle_one_request(self):
        app = self.server.app
        if app.managed:
            delay = .1-(time.monotonic()-app.last_request)
            if delay>0:
                app.stop.wait(delay)
            app.last_request = time.monotonic()
        super().handle_one_request()

    def send_error(self,code,message=None,explain=None):
        self.send(code,{'error':'http_error_'+str(code)})

    def send(self,status,payload,ctype='application/json; charset=utf-8',download=None):
        if not isinstance(payload,(bytes,str)):
            payload = json.dumps(payload,ensure_ascii=False)
        if isinstance(payload,str):
            payload = payload.encode('utf-8')
        managed = self.server.app.managed
        if managed and len(payload)>2*1024**2:
            status,payload,ctype,download = 413,b'{"error":"response_too_large_narrow_filters"}','application/json',None
        self.send_response(status)
        for key,value in {'Content-Type':ctype,'Content-Length':str(len(payload)),'Cache-Control':'no-store',
                          'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
                          'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
                          'Cross-Origin-Resource-Policy':'same-origin'}.items():
            self.send_header(key,value)
        if download:
            self.send_header('Content-Disposition','attachment; filename="'+download+'"')
        if status==401:
            self.send_header('WWW-Authenticate','Basic realm="Occitanie", charset="UTF-8"')
        self.end_headers()
        if self.command=='HEAD':
            return
        try:
            if managed:
                # One HTTP worker: this is a global 128 KiB/s application ceiling.
                app = self.server.app
                for offset in range(0,len(payload),8192):
                    if app.stop.is_set():
                        break
                    target = max(app.transfer_next,time.monotonic())
                    delay = target-time.monotonic()
                    if delay>0 and app.stop.wait(delay):
                        break
                    chunk = payload[offset:offset+8192]
                    self.wfile.write(chunk)
                    app.transfer_next = target+len(chunk)/(128*1024)
            else:
                self.wfile.write(payload)
        except (BrokenPipeError,ConnectionResetError,TimeoutError):
            pass

    def authorized(self,write=False):
        host = '127.0.0.1:'+str(self.server.server_port)
        app = self.server.app
        navigation = (app.managed and not write and self.command in ('GET','HEAD')
                      and urlsplit(self.path).path in (app.base_path,app.base_path.rstrip('/'))
                      and self.headers.get('Sec-Fetch-Mode')=='navigate'
                      and self.headers.get('Sec-Fetch-Dest')=='document')
        if self.headers.get('Host')!=host or (self.headers.get('Sec-Fetch-Site')=='cross-site' and not navigation):
            self.send(403,{'error':'local_origin_required'});return False
        origin = self.headers.get('Origin')
        if origin and origin!='http://'+host:
            self.send(403,{'error':'local_origin_required'});return False
        if app.access is not None:
            from .access import authorized
            values = self.headers.get_all('Authorization', [])
            if len(values)!=1 or not authorized(app.access, values[0]):
                self.send(401,{'error':'authentication_required'});return False
        if write and (origin!='http://'+host or not secrets.compare_digest(self.headers.get('X-CSRF-Token',''),self.server.app.csrf)):
            self.send(403,{'error':'local_origin_required'});return False
        return True

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.authorized():
            return
        parsed = urlsplit(self.path)
        base = self.server.app.base_path
        if base!='/' and parsed.path==base[:-1]:
            self.send_response(308)
            self.send_header('Location',base)
            self.send_header('Content-Length','0')
            self.end_headers()
            return
        if not parsed.path.startswith(base):
            return self.send(404,{'error':'not_found'})
        path = '/'+parsed.path[len(base):]
        assets = {'/':('index.html','text/html; charset=utf-8'),'/app.js':('app.js','text/javascript; charset=utf-8'),
                  '/style.css':('style.css','text/css; charset=utf-8'),'/view.js':('view.js','text/javascript; charset=utf-8')}
        if path in assets:
            filename,ctype = assets[path]
            return self.send(200,(ASSETS/filename).read_bytes(),ctype)
        try:
            query = parse_qs(parsed.query,keep_blank_values=True,max_num_fields=20)
            with contextlib.closing(connect(self.server.app.path,readonly=True)) as conn:
                if self.server.app.managed:
                    deadline = time.monotonic()+2
                    conn.set_progress_handler(lambda: int(time.monotonic()>deadline or self.server.app.stop.is_set()),1000)
                if path=='/api/health':
                    version = conn.execute("SELECT 1 FROM schema_migrations WHERE version='006_rail_walk'").fetchone()
                    return self.send(200 if version else 503,{'ok':bool(version),'version':__version__,'readonly':self.server.app.readonly})
                if path=='/api/meta':
                    return self.send(200,self.server.app.metadata(conn))
                if path=='/api/search':
                    return self.send(200,search(conn,**filters(query)))
                if path=='/api/detail':
                    if set(query)!={'id'} or len(query['id'])!=1:
                        raise ValueError('id_required')
                    return self.send(200,detail(conn,query['id'][0]))
                if path=='/api/status':
                    rows = [refresh.job(conn,r[0]) for r in conn.execute('SELECT id FROM refresh_jobs ORDER BY created_at DESC,id DESC LIMIT 8')]
                    coverage = refresh.coverage(conn,query.get('from_date',[''])[0],query.get('to_date',[''])[0])
                    walking = [rail.job(conn,r[0]) for r in conn.execute('SELECT id FROM walking_jobs ORDER BY created_at DESC,id DESC LIMIT 5')]
                    return self.send(200,{'jobs':rows,'walking_jobs':walking,'coverage':coverage,'settings':refresh.settings(conn),
                                          'storage':refresh.storage(conn),'worker_error':self.server.app.worker_error})
                if path in ('/api/export.csv','/api/export.json'):
                    f = filters(query)
                    f.update(page=1,page_size=100)
                    conn.execute('BEGIN')  # Stable export even if the worker commits another page.
                    result = search(conn,**f)
                    if result['total']>2000:
                        raise ValueError('export_limit_2000_narrow_your_filters')
                    items = result['items']
                    for page in range(2,result['pages']+1):
                        items.extend(search(conn,**{**f,'page':page})['items'])
                    if path.endswith('.csv'):
                        return self.send(200,csv_export(items),'text/csv; charset=utf-8','occitanie-events.csv')
                    return self.send(200,{'filters':result['filters'],'generated_at':now(),'total':result['total'],'items':items},download='occitanie-events.json')
                return self.send(404,{'error':'not_found'})
        except (ValueError,KeyError,OverflowError):
            return self.send(400,{'error':'invalid_query_or_export_over_2000'})
        except sqlite3.Error:
            return self.send(503,{'error':'database_busy_or_upgrade_required'})

    def do_POST(self):
        if not self.authorized(write=True):
            return
        if self.server.app.readonly:
            return self.send(403,{'error':'read_only_preview'})
        base = self.server.app.base_path
        if not self.path.startswith(base):
            return self.send(404,{'error':'not_found'})
        path = '/'+self.path[len(base):]
        try:
            length = int(self.headers.get('Content-Length','0'))
            if not 0<length<=4096 or self.headers.get('Content-Type')!='application/json' or self.headers.get('Transfer-Encoding'):
                raise ValueError('invalid_request_body')
            payload = loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(payload,dict):
                raise ValueError('invalid_request_body')
            with writer_lock(self.server.app.path),contextlib.closing(connect(self.server.app.path)) as conn:
                conn.execute('PRAGMA max_page_count='+str(refresh.STORAGE_BYTES//conn.execute('PRAGMA page_size').fetchone()[0]))
                if path=='/api/walking':
                    if set(payload)!={'filters'} or not isinstance(payload['filters'],dict):
                        raise ValueError('invalid_request_body')
                    result = rail.enqueue(conn,payload['filters'])
                elif path in ('/api/walking-resume','/api/walking-pause'):
                    if set(payload)!={'id'}:
                        raise ValueError('invalid_request_body')
                    result = (rail.resume if path.endswith('resume') else rail.pause)(conn,payload['id'])
                elif path=='/api/refresh':
                    if set(payload)-{'from_date','to_date','endpoint_ids','page_budget'}:
                        raise ValueError('invalid_request_body')
                    result = refresh.enqueue(conn,payload.pop('from_date'),payload.pop('to_date'),**payload)
                elif path=='/api/resume':
                    if set(payload)!={'id'}:
                        raise ValueError('invalid_request_body')
                    result = refresh.resume_job(conn,payload['id'])
                elif path=='/api/pause':
                    if set(payload)!={'id'}:
                        raise ValueError('invalid_request_body')
                    result = refresh.pause_job(conn,payload['id'])
                elif path=='/api/settings':
                    if set(payload)-{'enabled','interval_hours','horizon_days'}:
                        raise ValueError('invalid_request_body')
                    result = refresh.save_settings(conn,**payload)
                else:
                    return self.send(404,{'error':'not_found'})
            self.send(200,result)
        except (ValueError,KeyError,TypeError,UnicodeError):
            self.send(409,{'error':'invalid_request_or_writer_busy'})
        except sqlite3.Error:
            self.send(503,{'error':'database_busy_or_upgrade_required'})


def make_server(app,port=8766):
    server = HTTPServer(('127.0.0.1',port),Handler)
    server.app = app
    server.timeout = 0.5
    return server


def serve(path, *, port=8766,seconds=43200,readonly=False,base_path='/'):
    if not 1024<=port<=65535 or not 1<=seconds<=43200:
        raise ValueError('invalid_port_or_session_duration')
    with contextlib.closing(connect(path,readonly=True)) as conn:
        if not conn.execute("SELECT 1 FROM schema_migrations WHERE version='006_rail_walk'").fetchone():
            raise ValueError('upgrade_required_run_backup_then_migrate')
    app = App(path,readonly=readonly,base_path=base_path)
    server = make_server(app,port)
    start = time.monotonic()
    start_cpu = time.process_time()
    print('Local browser: http://127.0.0.1:'+str(port)+base_path+' (foreground; Ctrl+C to stop)',flush=True)
    try:
        app.start_worker()
        while not app.stop.is_set() and time.monotonic()-start<seconds:
            if time.process_time()-start_cpu>90 or peak_rss()>128*1024**2:
                print('Local session budget reached; saved data retained.',flush=True)
                break
            server.handle_request()
    except KeyboardInterrupt:
        pass
    finally:
        app.close()
        server.server_close()
    return {'stopped':True,'data_preserved':True}
