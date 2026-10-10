import csv
import io
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit

from sncf_events import rail,refresh
from sncf_events.db import digest,dumps,now,migrate
from sncf_events.http import FetchError,Response
from sncf_events.ingest import start_run,ingest_page,finish_run
from sncf_events.search import search,csv_export
from tests.helpers import DatabaseCase,event


def route_body(start,end,seconds=600,metres=100,**updates):
    return dumps({'resource':'bdtopo-osrm','resourceVersion':'2026-10-07','profile':'pedestrian',
        'optimization':'fastest','crs':'EPSG:4326','distanceUnit':'meter','timeUnit':'second',
        'duration':seconds,'distance':metres,'geometry':{'type':'LineString','coordinates':[start,end]},**updates})


class Routes:
    calls=[]
    durations=[]
    failure=None
    def __init__(self,*a,**kw):pass
    def get(self,url):
        self.calls.append(url)
        if self.failure:raise FetchError(self.failure)
        q=parse_qs(urlsplit(url).query)
        start,end=([float(x) for x in q[k][0].split(',')] for k in ('start','end'))
        seconds=self.durations.pop(0) if self.durations else 600
        return Response(url,route_body(start,end,seconds,300),'application/json')


class RailTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        Routes.calls=[];Routes.durations=[];Routes.failure=None
        with self.conn:
            self.conn.execute('INSERT INTO rail_datasets VALUES (?,?,?,1)',('TEST',dumps({'synthetic':True}),now()))
            self.conn.execute('INSERT INTO rail_stations VALUES (?,?,?,?,?,?,?,?)',('TEST','87611004','TEST Station',43.6,1.44,'31','Toulouse','["Train TER"]'))
        self.station=dict(self.conn.execute('SELECT * FROM rail_stations').fetchone())
        self.destination=(43.6005,1.44)

    def ingest(self,uid=1,coords=None):
        row=event(uid)
        row['location'].update(latitude=(coords or self.destination)[0],longitude=(coords or self.destination)[1])
        run=start_run(self.conn,'S002')
        ingest_page(self.conn,run,'S002','https://api.openagenda.com/v2/agendas/1/events',dumps({'events':[row]}),'openagenda_events')
        finish_run(self.conn,run,'complete')

    def query(self,**kw):
        return search(self.conn,from_date='2026-10-12',to_date='2026-10-12',**kw)

    def enqueue(self,**kw):
        return rail.enqueue(self.conn,dict(from_date='2026-10-12',to_date='2026-10-12'),**kw)

    def run_one(self,identifier):
        return rail.process_one(self.conn,identifier,client_factory=Routes)

    def test_default_excludes_unknown_but_all_explains_it(self):
        self.ingest()
        self.assertEqual(self.query()['total'],0)
        self.assertEqual(self.query()['rail_counts'],{'unknown':1})
        self.assertEqual(self.query(rail_filter='all')['total'],1)
        with self.assertRaises(ValueError):self.query(rail_filter='anything')

    def test_inclusive_1200_seconds_and_csv_evidence(self):
        self.ingest();Routes.durations=[1200]
        identifier=self.enqueue()['id'];self.run_one(identifier)
        item=self.query()['items'][0]
        self.assertEqual(item['rail_walk']['walking_seconds'],1200)
        output=csv_export([item]);self.assertIn('TEST Station',output);self.assertIn('IGN',output)
        self.assertIn('route_evidence_url',output)

    def test_1201_is_over_limit(self):
        self.ingest();Routes.durations=[1201]
        self.run_one(self.enqueue()['id'])
        self.assertEqual(self.query()['total'],0)
        self.assertEqual(self.query(rail_filter='outside')['total'],1)

    def test_more_distant_station_can_succeed_after_nearest_fails(self):
        with self.conn:
            self.conn.execute('INSERT INTO rail_stations VALUES (?,?,?,?,?,?,?,?)',('TEST','87611005','TEST Second',43.6015,1.44,'31','Toulouse','["TGV INOUI"]'))
        self.ingest();Routes.durations=[1500,600]
        identifier=self.enqueue()['id'];self.run_one(identifier)
        self.assertEqual(self.query(rail_filter='unknown')['total'],1)
        self.run_one(identifier)
        self.assertEqual(self.query()['items'][0]['rail_walk']['station_name'],'TEST Second')

    def test_same_venue_reuses_cache_and_completes_without_second_request(self):
        self.ingest(1);self.ingest(2)
        identifier=self.enqueue()['id'];self.run_one(identifier)
        self.assertEqual(self.run_one(identifier)['status'],'complete')
        self.assertEqual(len(Routes.calls),1);self.assertEqual(self.query()['total'],2)

    def test_route_audit_detects_tampered_raw_evidence_and_cache(self):
        from sncf_events.audit_data import audit_data
        self.ingest();self.run_one(self.enqueue()['id'])
        self.assertTrue(audit_data(self.conn)['ok'])
        with self.conn:self.conn.execute('UPDATE walking_routes SET seconds=10')
        self.assertFalse(audit_data(self.conn)['ok'])
        with self.conn:self.conn.execute("UPDATE walking_evidence SET response_body='{}'")
        self.assertEqual(len(audit_data(self.conn)['walking_evidence_errors']),1)

    def test_coordinates_changed_and_expiry_invalidate_cached_success(self):
        self.ingest();self.run_one(self.enqueue()['id'])
        index=rail.RailIndex(self.conn)
        self.assertEqual(index.assess(dict(latitude=43.6006,longitude=1.44))['status'],'unknown')
        with self.conn:self.conn.execute("UPDATE walking_routes SET valid_until='2000-01-01T00:00:00+00:00'")
        self.assertEqual(self.query()['total'],0)

    def test_moved_online_event_does_not_inherit_same_venue_success(self):
        self.ingest();self.run_one(self.enqueue()['id'])
        index=rail.RailIndex(self.conn)
        data=dict(latitude=self.destination[0],longitude=self.destination[1])
        self.assertEqual(index.assess(data)['status'],'within_20_min')
        self.assertEqual(index.assess({**data,'status':'moved_online'})['reason'],'event_moved_online')

    def test_large_endpoint_snap_is_not_passed(self):
        body=route_body([1.45,43.6],[1.44,43.6005])
        with self.assertRaises(ValueError):rail.parse_route(body,self.station,self.destination)

    def test_small_endpoint_snap_is_added_and_slow_model_is_conservative(self):
        body=route_body([1.44,43.6001],[1.44,43.6004],seconds=1,metres=100)
        seconds,metres,evidence=rail.parse_route(body,self.station,self.destination)
        self.assertGreater(seconds,90);self.assertGreater(metres,100)
        self.assertEqual(evidence['model'],rail.MODEL)

    def test_wrong_profile_units_invalid_numbers_geometry_are_rejected(self):
        for update in ({'profile':'car'},{'timeUnit':'minute'},{'distanceUnit':'kilometer'},
                       {'duration':True},{'distance':-1},{'duration':'123'},{'geometry':{'type':'Point','coordinates':[1.44,43.6]}},
                       {'geometry':{'type':'LineString','coordinates':[[1.44,43.6],[1.44,None]]}}):
            with self.subTest(update=update),self.assertRaises(ValueError):
                rail.parse_route(route_body([1.44,43.6],[1.44,43.6005],**update),self.station,self.destination)

    def test_nonfinite_and_bool_coordinates_are_unknown(self):
        index=rail.RailIndex(self.conn)
        for lat in (None,True,float('nan'),float('inf'),91,'43.6'):
            self.assertEqual(index.assess(dict(latitude=lat,longitude=1.44))['status'],'unknown')

    def test_no_station_in_model_radius_is_outside_without_network(self):
        self.ingest(coords=(43.8,1.44))
        self.assertEqual(self.query(rail_filter='outside')['total'],1)
        self.assertEqual(self.enqueue()['status'],'complete');self.assertEqual(Routes.calls,[])

    def test_budget_pause_resume_and_restart_recovery(self):
        self.ingest(1);self.ingest(2,coords=(43.6006,1.44))
        identifier=self.enqueue(budget=1)['id'];self.run_one(identifier)
        self.assertEqual(self.run_one(identifier)['error'],'walking_budget_reached')
        rail.resume(self.conn,identifier);rail.recover(self.conn)
        self.assertEqual(rail.job(self.conn,identifier)['error'],'local_app_stopped')
        rail.resume(self.conn,identifier);self.run_one(identifier)
        self.assertEqual(self.run_one(identifier)['status'],'complete')

    def test_failure_is_unknown_and_cached_to_avoid_retry_storm(self):
        self.ingest();Routes.failure='transport_error'
        identifier=self.enqueue()['id'];self.run_one(identifier)
        self.assertEqual(self.run_one(identifier)['status'],'complete')
        self.assertEqual(self.query(rail_filter='unknown')['total'],1)
        self.assertEqual(self.run_one(self.enqueue()['id'])['status'],'complete')
        self.assertEqual(len(Routes.calls),1)

    def test_429_stops_queue_and_is_shared_with_refresh_budget(self):
        self.ingest();Routes.failure='http_429'
        identifier=self.enqueue()['id']
        self.assertEqual(self.run_one(identifier)['error'],'hourly_budget_or_cooldown')
        self.assertEqual(rail.hourly_usage(self.conn),(1,True))
        rail.resume(self.conn,identifier)
        self.ingest(2,coords=(43.6006,1.44))
        rail.pause(self.conn,identifier)
        second=self.enqueue()['id'];self.run_one(second)
        self.assertEqual(len(Routes.calls),1)

    def test_storage_budget_pauses_before_request(self):
        self.ingest();identifier=self.enqueue()['id']
        with patch('sncf_events.refresh.storage',return_value={'remaining_bytes':0}):
            self.assertEqual(self.run_one(identifier)['error'],'storage_budget_reached')
        self.assertEqual(Routes.calls,[])

    def test_sixty_durable_attempts_stop_further_network(self):
        self.ingest();identifier=self.enqueue()['id']
        with self.conn:
            self.conn.executemany('INSERT INTO walking_attempts(job_id,started_at) VALUES (?,?)',[(identifier,now())]*60)
        self.assertEqual(self.run_one(identifier)['error'],'hourly_budget_or_cooldown')
        self.assertEqual(Routes.calls,[])

    def test_zero_duration_csv_is_not_replaced_by_blank(self):
        self.ingest();item=self.query(rail_filter='all')['items'][0]
        item['rail_walk'].update(walking_seconds=0,walking_metres=0)
        rows=list(csv.DictReader(io.StringIO(csv_export([item]).lstrip('\ufeff'))))
        self.assertEqual(rows[0]['walking_seconds'],'0')

    def test_only_one_active_queue_and_user_pause_does_not_autorun(self):
        self.ingest();identifier=self.enqueue()['id']
        with self.assertRaises(ValueError):self.enqueue()
        rail.pause(self.conn,identifier)
        self.assertEqual(self.run_one(identifier)['status'],'paused');self.assertEqual(Routes.calls,[])

    def test_upgrade_from_v04_keeps_observations(self):
        self.ingest();before=[tuple(r) for r in self.conn.execute('SELECT * FROM observations')]
        with self.conn:
            for t in ('walking_evidence','walking_attempts','walking_jobs','walking_routes','rail_stations','rail_datasets'):
                self.conn.execute('DROP TABLE '+t)
            self.conn.execute("DELETE FROM schema_migrations WHERE version='006_rail_walk'")
        migrate(self.conn)
        self.assertEqual(before,[tuple(r) for r in self.conn.execute('SELECT * FROM observations')])

    def test_pinned_import_filters_buses_is_repeatable_and_rejects_changed_bytes(self):
        path=self.path.parent/'source';path.mkdir()
        stations='stop_id,name,lat,lon,department,commune\n'
        ids=[str(87000000+i) for i in range(260)]
        stations+=''.join(f'{sid},TEST,43.6,1.44,Haute-Garonne,Toulouse\n' for sid in ids+['Lbus','89999999'])
        missions='mode,stops\nTrain TER,'+'|'.join(ids[:-1])+'\nTGV INOUI,'+ids[-1]+'\nCar TER,Lbus|89999999\n'
        files={'stations_occitanie.csv':stations,'missions_occitanie.csv':missions,'build_info.json':'{}'}
        for name,value in files.items():(path/name).write_text(value)
        with patch.dict(rail.HASHES,{n:digest(v) for n,v in files.items()},clear=True):
            self.assertEqual(rail.import_stations(self.conn,path)['imported'],260)
            self.assertEqual(rail.import_stations(self.conn,path)['unchanged'],260)
            self.assertNotIn('Lbus',[s['id'] for s in rail.RailIndex(self.conn).stations])
            self.assertEqual(len(rail.RailIndex(self.conn).stations),260)
            (path/'stations_occitanie.csv').write_text(stations+'changed')
            with self.assertRaises(ValueError):rail.import_stations(self.conn,path)
