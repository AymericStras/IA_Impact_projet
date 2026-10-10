"""Versioned railway registry and bounded pedestrian-route checks, never inferred times."""
import csv
import io
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

from .db import DEPARTMENTS, audit, digest, dumps, loads, now
from .http import Client, FetchError

COMMIT = '5029e9d0b5f64c12e2b01e931f4ab63ef887d747'
REPOSITORY = 'https://github.com/AymericStras/IA_Impact_projet'
HASHES = {
    'stations_occitanie.csv':'e7e579dfe48cee5e14085becfb9a437db646c6094ce8816ee421bf2a5b34da35',
    'missions_occitanie.csv':'f00cbf49279446843afc651b8f37bd46bed52d0dee0bb8e63c99c56736698197',
    'build_info.json':'2be39e6199a2adade96169bfd095cf8754e8bd07bb4a11c59250e40a41e0357c',
}
MODES = {'Train TER','INTERCITES','INTERCITES de nuit','OUIGO','TGV INOUI'}
ENDPOINT = 'https://data.geopf.fr/navigation/itineraire'
MODEL = 'ign-pedestrian-4kmh-snap50-v1'
SPEED = 4000/3600
LIMIT = 1200
RADIUS = SPEED*LIMIT + 1  # One metre numeric margin; never used to accept a route.


def coordinates(lat, lon):
    if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in (lat,lon)):
        return None
    if not -90<=lat<=90 or not -180<=lon<=180:
        return None
    return (float(lat),float(lon))


def distance(a,b):
    lat1,lat2 = map(math.radians,(a[0],b[0]))
    dlat,dlon = math.radians(b[0]-a[0]),math.radians(b[1]-a[1])
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371008.8*2*math.asin(math.sqrt(min(1,max(0,h))))


def import_stations(conn, directory):
    """Import only the reviewed immutable upstream release, rejecting changed bytes."""
    directory = Path(directory)
    payloads = {}
    for name,expected in HASHES.items():
        path = directory/name
        if path.stat().st_size>2*1024**2:
            raise ValueError('station_file_too_large')
        raw = path.read_bytes()
        if digest(raw)!=expected:
            raise ValueError('station_source_hash_mismatch')
        payloads[name] = raw.decode('utf-8-sig')
    served = {}
    for row in csv.DictReader(io.StringIO(payloads['missions_occitanie.csv'])):
        if row['mode'] in MODES:
            for sid in row['stops'].split('|'):
                served.setdefault(sid,set()).add(row['mode'])
    departments = {name:code for code,name in DEPARTMENTS.items()}
    stations = []
    for row in csv.DictReader(io.StringIO(payloads['stations_occitanie.csv'])):
        sid = row['stop_id']
        if sid not in served:
            continue
        coord = coordinates(float(row['lat']),float(row['lon']))
        if not coord or not re.fullmatch(r'\d{8}',sid) or row['department'] not in departments:
            raise ValueError('invalid_rail_station')
        stations.append((COMMIT,sid,row['name'],*coord,departments[row['department']],row['commune'],dumps(sorted(served[sid]))))
    if len(stations)!=260 or len({s[1] for s in stations})!=len(served):
        raise ValueError('rail_station_coverage_mismatch')
    manifest = {'repository':REPOSITORY,'commit':COMMIT,'files':HASHES,
                'build_info':loads(payloads['build_info.json']),'count':len(stations),
                'attribution':'AymericStras / IA_Impact_projet; SNCF GTFS',
                'license_note':'Repository MIT; underlying GTFS reuse terms require separate review.'}
    if conn.execute('SELECT 1 FROM rail_datasets WHERE id=?',(COMMIT,)).fetchone():
        return {'imported':0,'unchanged':len(stations),'dataset_id':COMMIT}
    with conn:
        conn.execute('UPDATE rail_datasets SET active=0')
        conn.execute('INSERT INTO rail_datasets VALUES (?,?,?,1)',(COMMIT,dumps(manifest),now()))
        conn.executemany('INSERT INTO rail_stations VALUES (?,?,?,?,?,?,?,?)',stations)
        audit(conn,'import_rail_stations',COMMIT,{'count':len(stations),'files':HASHES})
    return {'imported':len(stations),'dataset_id':COMMIT}


def route_key(station, destination):
    return digest(dumps([MODEL,station['dataset_id'],station['id'],station['latitude'],station['longitude'],destination]))


class RailIndex:
    """One snapshot per search; repeated venues share the same computed assessment."""
    def __init__(self, conn):
        self.stations = [dict(r) for r in conn.execute('SELECT s.* FROM rail_stations s JOIN rail_datasets d ON d.id=s.dataset_id WHERE d.active=1')]
        self.routes = {r['route_key']:dict(r) for r in conn.execute('SELECT * FROM walking_routes WHERE valid_until>?',(now(),))}
        self.cache = {}

    def candidates(self, destination):
        return sorted((s for s in self.stations if distance(destination,(s['latitude'],s['longitude']))<=RADIUS),
                      key=lambda s:distance(destination,(s['latitude'],s['longitude'])))

    def assess(self, data):
        if isinstance(data,str):
            data = loads(data)
        destination = coordinates(data.get('latitude'),data.get('longitude'))
        online = data.get('status')=='moved_online'
        cache_key = (destination,online)
        if cache_key in self.cache:
            return self.cache[cache_key]
        result = {'status':'unknown','reason':'coordinates_missing','limit_seconds':LIMIT,'model':MODEL,
                  'provider':'IGN Géoplateforme / BD TOPO','station_name':None,'walking_seconds':None,
                  'walking_metres':None,'checked_at':None,'valid_until':None,
                  'note':'Route estimate; station entrance, group pace and trains on the chosen day remain unconfirmed.'}
        if online:
            result['reason'] = 'event_moved_online'
        elif not self.stations:
            result['reason'] = 'station_registry_missing'
        elif destination:
            candidates = self.candidates(destination)
            good,missing = [],False
            for station in candidates:
                row = self.routes.get(route_key(station,destination))
                if not row or row['status']!='ok':
                    missing = True
                else:
                    good.append((row,station))
            if good:
                row,station = min(good,key=lambda pair:pair[0]['seconds'])
                result.update(station_id=station['id'],station_name=station['name'],
                              station_latitude=station['latitude'],station_longitude=station['longitude'],
                              dataset_id=station['dataset_id'],walking_seconds=row['seconds'],walking_metres=row['metres'],
                              checked_at=row['checked_at'],valid_until=row['valid_until'],evidence_url=row['request_url'],
                              response_sha256=row['response_sha256'])
                if row['seconds']<=LIMIT:
                    result.update(status='within_20_min',reason='pedestrian_route_estimate')
                elif not missing:
                    result.update(status='outside',reason='all_candidate_routes_over_limit')
                else:
                    result['reason'] = 'other_candidate_routes_unverified'
            elif not candidates:
                result.update(status='outside',reason='no_station_within_model_radius')
            else:
                result['reason'] = 'route_unverified_or_unavailable'
        self.cache[cache_key] = result
        return result


def request_url(station,destination):
    return ENDPOINT+'?'+urlencode({'resource':'bdtopo-osrm','start':f"{station['longitude']},{station['latitude']}",
        'end':f'{destination[1]},{destination[0]}','profile':'pedestrian','optimization':'fastest',
        'geometryFormat':'geojson','getSteps':'false','getBbox':'false','distanceUnit':'meter',
        'timeUnit':'second','crs':'EPSG:4326'})


def parse_route(body, station, destination):
    data = loads(body)
    expected = {'resource':'bdtopo-osrm','profile':'pedestrian','optimization':'fastest',
                'crs':'EPSG:4326','distanceUnit':'meter','timeUnit':'second'}
    if not isinstance(data,dict) or any(data.get(k)!=v for k,v in expected.items()) or not data.get('resourceVersion'):
        raise ValueError('route_contract_mismatch')
    for key in ('distance','duration'):
        if isinstance(data.get(key),bool) or not isinstance(data.get(key),(int,float)) or not 0<=data[key]<=10**7:
            raise ValueError('invalid_route_measurement')
    geometry = data.get('geometry') or {}
    points = geometry.get('coordinates')
    if geometry.get('type')!='LineString' or not isinstance(points,list) or len(points)<2:
        raise ValueError('invalid_route_geometry')
    if any(not isinstance(p,list) or len(p)!=2 or not coordinates(p[1],p[0]) for p in points):
        raise ValueError('invalid_route_geometry')
    origin = (station['latitude'],station['longitude'])
    gaps = [distance(origin,(points[0][1],points[0][0])),distance(destination,(points[-1][1],points[-1][0]))]
    if max(gaps)>50:
        raise ValueError('route_endpoint_too_far')
    if data['distance']+2<distance((points[0][1],points[0][0]),(points[-1][1],points[-1][0])):
        raise ValueError('implausible_route_distance')
    seconds = math.ceil(max(data['duration'],data['distance']/SPEED)+sum(gaps)/SPEED)
    metres = math.ceil(data['distance']+sum(gaps))
    # Keep exact field evidence + digest of the entire response, including geometry.
    evidence = {k:data[k] for k in (*expected,'resourceVersion','distance','duration')}
    evidence.update(first_point=points[0],last_point=points[-1],endpoint_gaps_metres=gaps,model=MODEL)
    return seconds,metres,evidence


def check_route(conn,station,destination,*,client_factory=Client):
    url = request_url(station,destination)
    checked = datetime.now(timezone.utc)
    status,reason,seconds,metres,evidence,sha,body = 'unknown',None,None,None,{},digest(''),''
    try:
        response = client_factory(ENDPOINT,['/navigation/itineraire'],seconds=25,max_requests=1).get(url)
        if len(response.body.encode('utf-8'))>65536:
            raise ValueError('route_evidence_size_budget_exceeded')
        body = response.body
        sha = digest(body)
        seconds,metres,evidence = parse_route(body,station,destination)
        status = 'ok'
    except FetchError as exc:
        reason = str(exc) if re.fullmatch(r'[a-z0-9_]+',str(exc)) else 'route_fetch_failed'
    except (ValueError,KeyError,TypeError,OverflowError):
        reason = 'route_response_unusable'
    # Failures are cached briefly to avoid repeatedly requesting a broken route.
    expiry = checked + (timedelta(days=30) if status=='ok' else timedelta(hours=1))
    with conn:
        conn.execute('INSERT INTO walking_evidence(route_key,checked_at,request_url,response_sha256,response_body,result_json) VALUES (?,?,?,?,?,?)',
                     (route_key(station,destination),checked.isoformat(timespec='seconds'),url,sha,body,
                      dumps({'status':status,'reason':reason,'seconds':seconds,'metres':metres,'evidence':evidence})))
        conn.execute('INSERT OR REPLACE INTO walking_routes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (route_key(station,destination),station['dataset_id'],station['id'],dumps(destination),
             checked.isoformat(timespec='seconds'),expiry.isoformat(timespec='seconds'),status,reason,
             seconds,metres,url,sha,dumps(evidence)))
    return {'status':status,'reason':reason,'seconds':seconds,'metres':metres}


def job(conn,identifier):
    row = conn.execute('SELECT * FROM walking_jobs WHERE id=?',(identifier,)).fetchone()
    if not row:
        raise ValueError('walking_job_not_found')
    result = dict(row)
    result['total'] = len(loads(result.pop('targets_json')))
    result['filters'] = loads(result.pop('filters_json'))
    return result


def enqueue(conn, filters, *, budget=10):
    from .search import configure_functions, selection, validated
    if type(budget) is not int or not 1<=budget<=10:
        raise ValueError('invalid_walking_budget')
    f = validated({**filters,'rail_filter':'all','page':1})
    if conn.execute("SELECT 1 FROM walking_jobs WHERE status IN ('queued','running')").fetchone():
        raise ValueError('walking_job_already_active')
    index = RailIndex(conn)
    if not index.stations:
        raise ValueError('station_registry_missing')
    configure_functions(conn,index)
    query,params = selection(f)
    rows = conn.execute(query+' ORDER BY sort_at,title,id LIMIT 501',params).fetchall()
    if len(rows)>500:
        raise ValueError('walking_limit_500_narrow_filters')
    targets = [r['id'] for r in rows if index.assess(r['data_json'])['status']=='unknown']
    identifier = str(uuid.uuid4())
    with conn:
        conn.execute('INSERT INTO walking_jobs(id,created_at,updated_at,status,filters_json,targets_json,budget) VALUES (?,?,?,?,?,?,?)',
                     (identifier,now(),now(),'queued' if targets else 'complete',dumps(f),dumps(targets),budget))
    return job(conn,identifier)


def pause(conn,identifier,reason='user_paused'):
    job(conn,identifier)
    with conn:
        conn.execute("UPDATE walking_jobs SET status='paused',error=?,updated_at=? WHERE id=? AND status IN ('queued','running')",(reason,now(),identifier))
    return job(conn,identifier)


def resume(conn,identifier):
    item = job(conn,identifier)
    if item['status']!='paused' or conn.execute("SELECT 1 FROM walking_jobs WHERE status IN ('queued','running')").fetchone():
        raise ValueError('walking_job_not_resumable')
    with conn:
        conn.execute("UPDATE walking_jobs SET status='queued',batch_requests=0,error=NULL,updated_at=? WHERE id=?",(now(),identifier))
    return job(conn,identifier)


def recover(conn):
    with conn:
        conn.execute("UPDATE walking_jobs SET status='paused',error='local_app_stopped',updated_at=? WHERE status IN ('queued','running')",(now(),))


def hourly_usage(conn):
    cutoff = (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat(timespec='seconds')
    used = sum(conn.execute('SELECT count(*) FROM '+t+' WHERE started_at>?',(cutoff,)).fetchone()[0]
               for t in ('walking_attempts','refresh_attempts'))
    limited = conn.execute("SELECT 1 FROM walking_attempts WHERE started_at>? AND error='http_429'",(cutoff,)).fetchone()
    limited = limited or conn.execute("SELECT 1 FROM refresh_attempts a JOIN crawl_runs c ON c.id=a.run_id WHERE a.started_at>? AND c.failure_code='http_429'",(cutoff,)).fetchone()
    return used,bool(limited)


def process_one(conn,identifier,*,client_factory=Client):
    from .refresh import storage
    item = job(conn,identifier)
    if item['status'] not in ('queued','running'):
        return item
    targets = loads(conn.execute('SELECT targets_json FROM walking_jobs WHERE id=?',(identifier,)).fetchone()[0])
    index = RailIndex(conn)
    position = item['position']
    while position<len(targets):
        row = conn.execute('SELECT data_json FROM current_records WHERE id=?',(targets[position],)).fetchone()
        data = loads(row[0]) if row else {}
        destination = coordinates(data.get('latitude'),data.get('longitude'))
        pending = []
        if destination and data.get('status')!='moved_online' and index.assess(data)['status']=='unknown':
            pending = [s for s in index.candidates(destination) if route_key(s,destination) not in index.routes]
        if not pending:
            position += 1
            continue
        used,limited = hourly_usage(conn)
        error = ('walking_budget_reached' if item['batch_requests']>=item['budget'] else
                 'hourly_budget_or_cooldown' if used>=60 or limited else
                 'storage_budget_reached' if storage(conn)['remaining_bytes']<128*1024 else None)
        if error:
            with conn:
                conn.execute('UPDATE walking_jobs SET position=? WHERE id=?',(position,identifier))
            return pause(conn,identifier,error)
        # Reserve the request durably before fetching, including failed/crashed attempts.
        with conn:
            attempt = conn.execute('INSERT INTO walking_attempts(job_id,started_at) VALUES (?,?)',(identifier,now())).lastrowid
            conn.execute("UPDATE walking_jobs SET status='running',position=?,requests=requests+1,batch_requests=batch_requests+1,updated_at=? WHERE id=?",(position,now(),identifier))
        result = check_route(conn,pending[0],destination,client_factory=client_factory)
        with conn:
            conn.execute('UPDATE walking_attempts SET finished_at=?,error=? WHERE id=?',(now(),result['reason'],attempt))
        if result['reason']=='http_429':
            return pause(conn,identifier,'hourly_budget_or_cooldown')
        return job(conn,identifier)
    with conn:
        conn.execute("UPDATE walking_jobs SET status='complete',position=?,error=NULL,updated_at=? WHERE id=?",(position,now(),identifier))
    return job(conn,identifier)
