"""Station-first lookup: activities on one civil day within a checked 20-minute walk of given stations.

Reads never fetch. Live collection is a durable, serial queue: one bounded request per step,
scoped upstream to each station's neighbourhood, then decided locally by distance and route evidence.
"""
import contextlib
import json
import os
import re
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import rail
from .connectors import configure_endpoint, enable_endpoint, initial_url, install_default_endpoints, run_endpoint, scoped_endpoint
from .db import ROOT, connect, import_registry, migrate, now, writer_lock
from .http import Client
from .policy import latest_review, review_source, set_source_enabled, timestamp
from .search import PARIS, configure_functions, detail, folded, selection, validated

MAX_STATIONS = 40
MAX_QUEUED = 400
FRESH_HOURS = 6
RETRY_HOURS = 1
NOTE = ('Walking times are route estimates from the station coordinates at 4 km/h. Station entrances, group pace, '
        'opening hours, booking availability and trains on the chosen day are not confirmed. '
        'A date range does not establish daily opening.')
# Reviewed profile applied by setup(); live collection stops when a recorded source review expires.
LIVE_SOURCES = ('S001','S002','S007')
LIVE_ENDPOINTS = (('oa-toulouse-museum','2342325'),('oa-musees-occitanie','20704265'),
                  ('oa-architecture-2026-occitanie','4838751'),('oa-mrac','53387560'))


def _limit(name, default):
    try:
        return max(1,int(os.environ.get(name,default)))
    except ValueError:
        return default


def hourly_requests():
    return _limit('SNCF_EVENTS_HOURLY_REQUESTS',300)


def storage_bytes():
    return _limit('SNCF_EVENTS_STORAGE_MB',512)*1024**2


def civil_day(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):
        raise ValueError('date_must_be_YYYY_MM_DD')
    return date.fromisoformat(value).isoformat()


def _name_key(value):
    return re.sub(r'[^a-z0-9]+',' ',folded(value)).strip()


def stations(conn, query='', limit=20):
    """Accent/case-insensitive station search over the active railway dataset."""
    if not isinstance(query,str) or len(query)>100 or type(limit) is not int or not 1<=limit<=500:
        raise ValueError('invalid_station_query')
    needle = _name_key(query)
    rows = [dict(r) for r in conn.execute(
        'SELECT s.id,s.name,s.commune,s.department_code,s.latitude,s.longitude FROM rail_stations s '
        'JOIN rail_datasets d ON d.id=s.dataset_id WHERE d.active=1 ORDER BY s.name,s.id')]
    hits = [r for r in rows if needle in _name_key(r['name']) or query.strip()==r['id']]
    hits.sort(key=lambda r:(_name_key(r['name'])!=needle,not _name_key(r['name']).startswith(needle),r['name'],r['id']))
    return hits[:limit]


def resolve(conn, references):
    """UIC identifiers or station names. Ambiguous or unknown references are reported, never guessed."""
    if isinstance(references,str):
        references = [references]
    if not isinstance(references,(list,tuple)) or not references or len(references)>MAX_STATIONS:
        raise ValueError('stations_must_be_1_to_%d' % MAX_STATIONS)
    rows = {r['id']:dict(r) for r in conn.execute(
        'SELECT s.* FROM rail_stations s JOIN rail_datasets d ON d.id=s.dataset_id WHERE d.active=1')}
    if not rows:
        raise ValueError('station_registry_missing')
    found,unknown,seen = [],[],set()
    for reference in references:
        if not isinstance(reference,str) or not reference.strip() or len(reference)>100:
            raise ValueError('invalid_station_reference')
        reference = reference.strip()
        if reference in rows:
            matches = [rows[reference]]
        else:
            matches = [rows[r['id']] for r in stations(conn,reference,6)] if _name_key(reference) else []
            matches = [m for m in matches if _name_key(m['name'])==_name_key(reference)] or matches
        if len(matches)!=1:
            unknown.append({'reference':reference,'reason':'ambiguous_station' if matches else 'not_a_railway_station',
                            'candidates':[{'id':m['id'],'name':m['name']} for m in matches]})
        elif matches[0]['id'] not in seen:
            seen.add(matches[0]['id'])
            found.append(matches[0])
    return found,unknown


def _day_rows(conn, day):
    """Active, non-cancelled events with an occurrence on the civil day and usable venue coordinates."""
    configure_functions(conn,None)
    query,params = selection(validated({'from_date':day,'to_date':day,'rail_filter':'all'}))
    result = []
    for row in conn.execute(query+' ORDER BY sort_at,title,id',params):
        data = json.loads(row['data_json'])
        destination = rail.coordinates(data.get('latitude'),data.get('longitude'))
        if destination and data.get('status')!='moved_online':
            result.append((row['id'],destination))
    return result


def _nearby(station, rows):
    origin = (station['latitude'],station['longitude'])
    return [(identifier,destination) for identifier,destination in rows if rail.distance(origin,destination)<=rail.RADIUS]


def _routes(conn):
    return {r['route_key']:dict(r) for r in conn.execute('SELECT * FROM walking_routes WHERE valid_until>?',(now(),))}


def _missing(station, candidates, routes):
    return list(dict.fromkeys(d for _,d in candidates if rail.route_key(station,d) not in routes))


def request(conn, references, day):
    """Queue live collection for each station/day that is not fresh. Short transactions only."""
    day = civil_day(day)
    today = datetime.now(PARIS).date()
    if not today-timedelta(days=1)<=date.fromisoformat(day)<=today+timedelta(days=400):
        raise ValueError('date_outside_live_window')
    found,_ = resolve(conn,references)
    rows,routes = _day_rows(conn,day),_routes(conn)
    stamp = datetime.now(timezone.utc)
    queued = conn.execute("SELECT count(*) FROM station_lookups WHERE status IN ('queued','running')").fetchone()[0]
    where = ' WHERE dataset_id=? AND station_id=? AND day=?'
    result = []
    for station in found:
        key = (station['dataset_id'],station['id'],day)
        row = conn.execute('SELECT * FROM station_lookups'+where,key).fetchone()
        action = 'unchanged'
        if not row:
            if queued>=MAX_QUEUED:
                action = 'queue_full'
            else:
                with conn:
                    conn.execute("INSERT INTO station_lookups(dataset_id,station_id,day,requested_at,updated_at,status) VALUES (?,?,?,?,?,'queued')",(*key,now(),now()))
                action,queued = 'queued',queued+1
        elif row['status'] in ('complete','partial','failed'):
            age = stamp-datetime.fromisoformat(row['updated_at'])
            if age>=timedelta(hours=FRESH_HOURS if row['status']=='complete' else RETRY_HOURS):
                # Step receipts describe one collection pass; crawl runs and snapshots keep the evidence.
                with conn:
                    conn.execute('DELETE FROM station_lookup_steps'+where,key)
                    conn.execute("UPDATE station_lookups SET status='queued',error=NULL,requested_at=?,updated_at=?"+where,(now(),now(),*key))
                action = 'queued'
            elif row['status']=='complete' and _missing(station,_nearby(station,rows),routes):
                # A neighbouring lookup added venues: only the routes are outstanding.
                with conn:
                    conn.execute("UPDATE station_lookups SET status='running',requested_at=?,updated_at=?"+where,(now(),now(),*key))
                action = 'routes_queued'
        result.append({'station_id':station['id'],'action':action})
    return result


def usage(conn):
    cutoff = (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat(timespec='seconds')
    used = conn.execute('SELECT count(*) FROM station_lookup_attempts WHERE started_at>?',(cutoff,)).fetchone()[0]
    recent = (datetime.now(timezone.utc)-timedelta(minutes=10)).isoformat(timespec='seconds')
    limited = conn.execute("SELECT 1 FROM station_lookup_attempts WHERE started_at>? AND error='http_429'",(recent,)).fetchone()
    return used,bool(limited)


def throttle(conn):
    used,limited = usage(conn)
    size = conn.execute('PRAGMA page_count').fetchone()[0]*conn.execute('PRAGMA page_size').fetchone()[0]
    return ('provider_rate_limit_cooldown' if limited else 'hourly_request_budget_reached' if used>=hourly_requests() else
            'storage_budget_reached' if size>=storage_bytes() else None)


def _collector(conn, *args, **kwargs):
    return run_endpoint(conn,*args,client_factory=lambda *a,**kw:Client(*a,seconds=25,**kw),**kwargs)


def _router(*args, **kwargs):
    return Client(*args,interval=1.0,**kwargs)


def process_one(conn, *, runner=_collector, client_factory=_router):
    """At most one network request. Returns the lookup touched, a throttle reason, or None when idle."""
    lookup = conn.execute("SELECT * FROM station_lookups WHERE status IN ('queued','running') ORDER BY requested_at,station_id LIMIT 1").fetchone()
    if not lookup:
        return None
    reason = throttle(conn)
    if reason:
        return {'throttled':reason}
    from .refresh import endpoints
    key = (lookup['dataset_id'],lookup['station_id'],lookup['day'])
    where = ' WHERE dataset_id=? AND station_id=? AND day=?'
    station = dict(conn.execute('SELECT * FROM rail_stations WHERE dataset_id=? AND id=?',key[:2]).fetchone())
    scope = {'window_dates':[lookup['day'],lookup['day']],'near':[station['latitude'],station['longitude']]}
    def finish(status, error=None, collected=False):
        with conn:
            conn.execute('UPDATE station_lookups SET status=?,error=?,updated_at=?,collected_at=coalesce(?,collected_at)'+where,
                         (status,error,now(),now() if collected else None,*key))
        return {'station_id':key[1],'day':key[2],'status':status,'error':error}
    if lookup['status']=='queued':
        available = endpoints(conn)
        if not available:
            return finish('failed','no_enabled_event_endpoints')
        with conn:
            for endpoint in available:
                conn.execute('INSERT OR IGNORE INTO station_lookup_steps(dataset_id,station_id,day,endpoint_id,initial_url) VALUES (?,?,?,?,?)',
                             (*key,endpoint['id'],initial_url(scoped_endpoint(endpoint,**scope))))
            conn.execute("UPDATE station_lookups SET status='running',updated_at=?"+where,(now(),*key))
    step = conn.execute("SELECT * FROM station_lookup_steps"+where+" AND status='pending' ORDER BY pages,id LIMIT 1",key).fetchone()
    if step:
        with conn:
            attempt = conn.execute("INSERT INTO station_lookup_attempts(started_at,kind) VALUES (?,'collect')",(now(),)).lastrowid
        status,error,run = 'failed','configuration_or_access_error',None
        try:
            run = runner(conn,step['endpoint_id'],max_pages=1,resume=step['run_id'],**scope)
            error = run['failure_code']
            status = ('pending' if error=='page_budget_reached' else 'failed' if run['status'] in ('failed','interrupted') else
                      'partial' if step['quarantined']+run['quarantined'] else 'complete')
            if status=='pending' and step['pages']>=19:
                status,error = 'partial','station_page_budget_reached'
        except ValueError:
            pass  # Error text may contain provider input; keep the local code only.
        except OSError:
            error = 'network_or_storage_error'
        with conn:
            conn.execute('UPDATE station_lookup_steps SET status=?,run_id=coalesce(?,run_id),pages=pages+?,accepted=accepted+?,quarantined=quarantined+?,finished_at=?,error=? WHERE id=?',
                         (status,run and run['id'],run['pages'] if run else 0,run['accepted'] if run else 0,run['quarantined'] if run else 0,now(),error,step['id']))
            conn.execute('UPDATE station_lookup_attempts SET finished_at=?,error=? WHERE id=?',(now(),error,attempt))
            conn.execute('UPDATE station_lookups SET updated_at=?'+where,(now(),*key))
        return {'station_id':key[1],'day':key[2],'status':'running','step':step['endpoint_id'],'step_status':status}
    candidates = _nearby(station,_day_rows(conn,lookup['day']))
    routes = _routes(conn)
    missing = _missing(station,candidates,routes)
    if missing:
        with conn:
            attempt = conn.execute("INSERT INTO station_lookup_attempts(started_at,kind) VALUES (?,'route')",(now(),)).lastrowid
        result = rail.check_route(conn,station,missing[0],client_factory=client_factory)
        with conn:
            conn.execute('UPDATE station_lookup_attempts SET finished_at=?,error=? WHERE id=?',(now(),result['reason'],attempt))
            conn.execute('UPDATE station_lookups SET updated_at=?'+where,(now(),*key))
        return {'station_id':key[1],'day':key[2],'status':'running','route':result['status']}
    steps = [r['status'] for r in conn.execute('SELECT status FROM station_lookup_steps'+where,key)]
    unverified = any(routes[rail.route_key(station,d)]['status']!='ok' for _,d in candidates)
    if steps and all(s=='failed' for s in steps):
        return finish('failed','all_sources_failed')
    if any(s!='complete' for s in steps):
        return finish('partial','some_sources_incomplete',True)
    return finish('partial','some_routes_unverified',True) if unverified else finish('complete',None,True)


def _coverage(conn, station, day, candidates, routes):
    key = (station['dataset_id'],station['id'],day)
    row = conn.execute('SELECT * FROM station_lookups WHERE dataset_id=? AND station_id=? AND day=?',key).fetchone()
    steps = [dict(r) for r in conn.execute(
        'SELECT s.endpoint_id,s.status,s.pages,s.accepted,s.error FROM station_lookup_steps s '
        'WHERE s.dataset_id=? AND s.station_id=? AND s.day=? ORDER BY s.id',key)]
    destinations = list(dict.fromkeys(d for _,d in candidates))
    states = [routes.get(rail.route_key(station,d),{}).get('status') for d in destinations]
    return {'state':row['status'] if row else 'not_requested','error':row['error'] if row else None,
            'requested_at':row['requested_at'] if row else None,'collected_at':row['collected_at'] if row else None,
            'sources':steps,'venues_in_radius':len(destinations),'routes_verified':states.count('ok'),
            'routes_pending':states.count(None),'routes_unavailable':states.count('unknown')}


def lookup(conn, references, day):
    """Read-only answer from stored evidence. `complete` is true only when every station finished live checks."""
    day = civil_day(day)
    found,unknown = resolve(conn,references)
    rows,routes = _day_rows(conn,day),_routes(conn)
    index = rail.RailIndex(conn)
    best,groups = {},[]
    for station in found:
        candidates = _nearby(station,rows)
        groups.append((station,candidates))
        for identifier,destination in candidates:
            route = routes.get(rail.route_key(station,destination))
            if route and route['status']=='ok' and route['seconds']<=rail.LIMIT:
                best.setdefault(identifier,[]).append((route['seconds'],station['id'],station['name'],route))
    reviews,cards,result = {},{},[]
    for station,candidates in groups:
        activities = []
        for identifier,_ in candidates:
            options = sorted(best.get(identifier,[]),key=lambda o:o[:2])
            # Each activity is listed once, under the requested station with the shortest checked walk.
            if not options or options[0][1]!=station['id']:
                continue
            if identifier not in cards:
                record = detail(conn,identifier,first=day,last=day,rail_index=index)
                if record['source_id'] not in reviews:
                    review = latest_review(conn,record['source_id'])
                    reviews[record['source_id']] = review if review and timestamp(review['expires_at'])>now() else None
                review = reviews[record['source_id']]
                cards[identifier] = {
                    'id':record['id'],'title':record['title'],'theme':record.get('theme'),
                    'occurrences':[{k:s.get(k) for k in ('start_at','end_at','start_date','end_date','precision','status')} for s in record['occurrences']],
                    'schedule_text':record.get('schedule_text'),'location_name':record.get('location_name'),
                    'address':record.get('address'),'city':record.get('city'),
                    'latitude':record.get('latitude'),'longitude':record.get('longitude'),'price_text':record.get('price_text'),
                    'description':record['description_text'] if review and review['description_reuse_allowed'] else None,
                    'url':record.get('canonical_url'),'source_id':record['source_id'],'source_name':record['source_name'],
                    'attribution':record.get('attribution'),'license':record.get('license'),
                    'facts_reuse_allowed':bool(review and review['facts_reuse_allowed']),'observed_at':record['observed_at']}
            seconds,_,_,route = options[0]
            activities.append({**cards[identifier],'walking_seconds':seconds,'walking_minutes':-(-seconds//60),
                               'walking_metres':route['metres'],'route_checked_at':route['checked_at'],
                               'also_near':[{'station_id':o[1],'station_name':o[2],'walking_seconds':o[0]} for o in options[1:]]})
        activities.sort(key=lambda a:(a['walking_seconds'],a['title'] or '',a['id']))
        merged = []
        for activity in activities:
            # Same title at the same place from another publisher: one entry, every source kept.
            twin = next((m for m in merged if _name_key(m['title'])==_name_key(activity['title']) and rail.distance(
                (m['latitude'],m['longitude']),(activity['latitude'],activity['longitude']))<=150),None)
            if twin:
                twin['other_sources'].append({k:activity[k] for k in ('id','source_id','source_name','url')})
            else:
                merged.append({**activity,'other_sources':[]})
        activities = merged
        result.append({'id':station['id'],'name':station['name'],'commune':station['commune'],
                       'department_code':station['department_code'],'latitude':station['latitude'],'longitude':station['longitude'],
                       'coverage':_coverage(conn,station,day,candidates,routes),'activities':activities})
    states = [s['coverage']['state'] for s in result]
    return {'date':day,'timezone':'Europe/Paris','limit_seconds':rail.LIMIT,'generated_at':now(),
            'complete':bool(states) and all(s=='complete' for s in states),
            'pending':any(s in ('queued','running') for s in states),
            'total':sum(len(s['activities']) for s in result),'stations':result,'unknown_stations':unknown,'note':NOTE}


def setup(conn, stations_dir=None, data_dir=None):
    """Idempotent live profile for a new database: schema, registry, recorded reviews, endpoints, stations."""
    data_dir = Path(data_dir or ROOT/'data')
    migrate(conn)
    import_registry(conn,sorted((data_dir/'seeds').glob('sources-*.json'))[-1])
    install_default_endpoints(conn)
    report = {'sources':{},'endpoints':{},'stations':None}
    for source_id in LIVE_SOURCES:
        review = latest_review(conn,source_id)
        if not review or timestamp(review['expires_at'])<=now():
            paths = sorted((data_dir/'reviews').glob(source_id+'-*.json'))
            document = json.loads(paths[-1].read_text(encoding='utf-8')) if paths else None
            if not document or timestamp(document['expires_at'])<=now():
                report['sources'][source_id] = 'review_missing_or_expired'
                continue
            review_source(conn,source_id,document)
        if not conn.execute('SELECT enabled FROM sources WHERE id=?',(source_id,)).fetchone()[0]:
            set_source_enabled(conn,source_id,True)
        report['sources'][source_id] = 'enabled'
    for endpoint_id,agenda in LIVE_ENDPOINTS:
        if not conn.execute('SELECT 1 FROM endpoints WHERE id=?',(endpoint_id,)).fetchone():
            configure_endpoint(conn,endpoint_id,'S002','openagenda_events',{'agenda_uid':agenda})
    for endpoint_id in ('datatourisme-events','occitanie-region',*(e for e,_ in LIVE_ENDPOINTS)):
        row = conn.execute('SELECT enabled,source_id FROM endpoints WHERE id=?',(endpoint_id,)).fetchone()
        if not row['enabled'] and report['sources'].get(row['source_id'])=='enabled':
            enable_endpoint(conn,endpoint_id)
        report['endpoints'][endpoint_id] = bool(conn.execute('SELECT enabled FROM endpoints WHERE id=?',(endpoint_id,)).fetchone()[0])
    active = conn.execute('SELECT count(*) FROM rail_stations s JOIN rail_datasets d ON d.id=s.dataset_id WHERE d.active=1').fetchone()[0]
    if not active and stations_dir:
        rail.import_stations(conn,stations_dir)
        active = conn.execute('SELECT count(*) FROM rail_stations s JOIN rail_datasets d ON d.id=s.dataset_id WHERE d.active=1').fetchone()[0]
    report['stations'] = active
    return report


class Service:
    """Embeddable lookup for a host application: one SQLite file, one bounded background worker.

    Only one process may collect. A second process serves stored results read-only.
    """
    def __init__(self, path, *, stations_dir=None, live=True, pause=1.0):
        self.path = Path(path)
        self.stations_dir = stations_dir
        self.live = live
        self.pause = pause
        self.stop_event = threading.Event()
        self.thread = None
        self.error = None
        self.setup_report = None
        self._lock = contextlib.ExitStack()

    def start(self):
        try:
            self._lock.enter_context(writer_lock(self.path))
        except ValueError:
            self.live,self.error = False,'another_process_owns_collection'
            return self
        with contextlib.closing(connect(self.path)) as conn:
            self.setup_report = setup(conn,self.stations_dir)
        if self.live:
            self.thread = threading.Thread(target=self._work,name='sncf-events-station-lookups',daemon=True)
            self.thread.start()
        return self

    def _work(self):
        while not self.stop_event.is_set():
            idle = True
            try:
                with contextlib.closing(connect(self.path)) as conn:
                    step = process_one(conn)
                idle = step is None or 'throttled' in step
                self.error = step.get('throttled') if step else None
            except Exception as exc:  # The host application must keep serving stored results.
                self.error = 'worker_'+type(exc).__name__
            self.stop_event.wait(15 if self.error else 2 if idle else self.pause)

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=40)
        self._lock.close()

    def stations(self, query='', limit=20):
        with contextlib.closing(connect(self.path,readonly=True)) as conn:
            return stations(conn,query,limit)

    def activities(self, references, day):
        """Queue what is missing (when live) and return what is already verified."""
        queued = None
        if self.live and self.thread:
            with contextlib.closing(connect(self.path)) as conn:
                queued = request(conn,references,day)
        with contextlib.closing(connect(self.path,readonly=True)) as conn:
            result = lookup(conn,references,day)
        result['live'] = {'enabled':bool(self.live and self.thread),'worker_error':self.error,'requests':queued}
        return result
