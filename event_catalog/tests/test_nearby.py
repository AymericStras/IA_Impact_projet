import os
from datetime import datetime,timedelta
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit

from sncf_events import nearby,rail
from sncf_events.connectors import NEAR_METRES,configure_endpoint,enable_endpoint,initial_url,next_url,run_endpoint,scoped_endpoint
from sncf_events.db import ROOT,connect,dumps,now
from sncf_events.http import FetchError,Response
from sncf_events.search import PARIS
from tests.helpers import DatabaseCase,allow_source,event
from tests.test_rail import Routes

DAY=(datetime.now(PARIS).date()+timedelta(days=2)).isoformat()


def dated(uid,lat,lon,title='TEST ONLY — atelier',day=DAY):
    row=event(uid,title={'fr':title},timings=[{'begin':day+'T10:00:00+02:00','end':day+'T11:00:00+02:00'}])
    row['location'].update(latitude=lat,longitude=lon)
    return row


class Pages:
    bodies=[]
    urls=[]
    def __init__(self,*a,**kw):pass
    def get(self,url):
        self.urls.append(url)
        body=self.bodies.pop(0)
        if isinstance(body,Exception):raise body
        return Response(url,dumps(body),'application/json')


class NearbyCase(DatabaseCase):
    def setUp(self):
        super().setUp()
        Routes.calls=[];Routes.durations=[];Routes.failure=None
        Pages.bodies=[];Pages.urls=[]
        allow_source(self.conn,'S002',description=True)
        configure_endpoint(self.conn,'oa-test','S002','openagenda_events',{'agenda_uid':123})
        enable_endpoint(self.conn,'oa-test')
        with self.conn:
            self.conn.execute('INSERT INTO rail_datasets VALUES (?,?,?,1)',('TEST',dumps({'synthetic':True}),now()))
            for sid,name,lat in (('87000001','TEST Gare Centre',43.6),('87000002','TEST Gare Nord',43.604),('87000003','TEST Gare Centre-Ville',43.9)):
                self.conn.execute('INSERT INTO rail_stations VALUES (?,?,?,?,?,?,?,?)',('TEST',sid,name,lat,1.44,'31','Toulouse','["Train TER"]'))
        self.env=patch.dict(os.environ,{'OPENAGENDA_PUBLIC_KEY':'oa_pk_test'})
        self.env.start();self.addCleanup(self.env.stop)

    def runner(self,conn,*a,**kw):
        return run_endpoint(conn,*a,client_factory=Pages,**kw)

    def step(self):
        return nearby.process_one(self.conn,runner=self.runner,client_factory=Routes)

    def drain(self,limit=30):
        for _ in range(limit):
            if self.step() is None:return
        self.fail('lookup queue did not drain')

    def collect(self,stations,*pages):
        Pages.bodies=[{'events':list(p),'after':None} for p in pages]
        nearby.request(self.conn,stations,DAY)
        self.drain()
        return nearby.lookup(self.conn,stations,DAY)


class ScopeTests(NearbyCase):
    def endpoint(self,connector,source,config=None):
        allow_source(self.conn,source)
        configure_endpoint(self.conn,'scope-'+connector,source,connector,config or {})
        return self.conn.execute('SELECT * FROM endpoints WHERE id=?',('scope-'+connector,)).fetchone()

    def test_each_source_is_narrowed_to_the_station_neighbourhood(self):
        scope=dict(window_dates=[DAY,DAY],near=[43.6,1.44])
        region=parse_qs(urlsplit(initial_url(scoped_endpoint(self.endpoint('occitanie_region_events','S007'),**scope))).query)
        self.assertIn("within_distance(geo_point_2d, geom'POINT(1.44 43.6)', %dm)"%NEAR_METRES,region['where'][0])
        tourism=parse_qs(urlsplit(initial_url(scoped_endpoint(self.endpoint('datatourisme_events','S001'),**scope))).query)
        self.assertEqual(tourism['geo_distance'],['43.6,1.44,%dm'%NEAR_METRES])
        agenda=parse_qs(urlsplit(initial_url(scoped_endpoint(self.conn.execute("SELECT * FROM endpoints WHERE id='oa-test'").fetchone(),**scope))).query)
        self.assertLess(float(agenda['geo[southWest][lat]'][0]),43.6-NEAR_METRES/111400)
        self.assertGreater(float(agenda['geo[northEast][lng]'][0]),1.44+NEAR_METRES/111400)
        self.assertIn('timings[gte]',agenda)

    def test_station_scope_requires_a_dated_window_and_valid_coordinates(self):
        row=self.conn.execute("SELECT * FROM endpoints WHERE id='oa-test'").fetchone()
        for bad in (dict(near=[43.6,1.44]),dict(window_dates=[DAY,DAY],near=[91,1.44]),dict(window_dates=[DAY,DAY],near=[True,1]),dict(window_dates=[DAY,DAY],near=[43.6])):
            with self.assertRaises(ValueError):scoped_endpoint(row,**bad)

    def test_datatourisme_last_page_without_next_requires_final_page_number(self):
        row=self.endpoint('datatourisme_events','S001')
        self.assertIsNone(next_url(row,initial_url(row),{'objects':[],'meta':{'total':49,'page':1,'page_size':50,'total_pages':1}}))
        self.assertIsNone(next_url(row,initial_url(row),{'objects':[],'meta':{'total':0,'page':1,'page_size':50,'total_pages':0}}))
        for meta in ({'total':120,'page':1,'page_size':50,'total_pages':3},{'total':49},{'page':'1','total_pages':'1'}):
            with self.assertRaises(ValueError):next_url(row,initial_url(row),{'objects':[],'meta':meta})


class StationTests(NearbyCase):
    def test_search_and_resolution_never_guess(self):
        self.assertEqual([s['id'] for s in nearby.stations(self.conn,'gare centre')],['87000001','87000003'])
        found,unknown=nearby.resolve(self.conn,['87000002','test gare CENTRE','TEST Gare','Paris','87000002'])
        self.assertEqual([s['id'] for s in found],['87000002','87000001'])
        self.assertEqual([(u['reference'],u['reason'],len(u['candidates'])) for u in unknown],
                         [('TEST Gare','ambiguous_station',3),('Paris','not_a_railway_station',0)])

    def test_station_and_date_arguments_are_bounded(self):
        for stations in ([],['x']*41,[''],[5]):
            with self.assertRaises(ValueError):nearby.resolve(self.conn,stations)
        for day in ('2026-13-01','tomorrow','2020-01-01','2099-01-01'):
            with self.assertRaises(ValueError):nearby.request(self.conn,['87000001'],day)
        self.assertEqual(self.scalar('SELECT count(*) FROM station_lookups'),0)


class LookupTests(NearbyCase):
    def test_read_before_collection_reports_not_requested(self):
        result=nearby.lookup(self.conn,['87000001'],DAY)
        self.assertEqual((result['total'],result['complete'],result['pending']),(0,False,False))
        self.assertEqual(result['stations'][0]['coverage']['state'],'not_requested')
        self.assertEqual(Pages.urls+Routes.calls,[])

    def test_live_lookup_returns_time_place_and_checked_walk(self):
        Routes.durations=[540]
        result=self.collect(['87000001'],[dated(1,43.6005,1.44)])
        self.assertTrue(result['complete']);self.assertEqual(result['total'],1)
        station=result['stations'][0];item=station['activities'][0]
        self.assertEqual(station['coverage']['state'],'complete')
        self.assertEqual((station['coverage']['venues_in_radius'],station['coverage']['routes_verified']),(1,1))
        self.assertEqual((item['walking_seconds'],item['walking_minutes'],item['city']),(540,9,'Toulouse'))
        self.assertEqual(item['occurrences'][0]['precision'],'datetime')
        self.assertTrue(item['occurrences'][0]['start_at'].startswith(DAY[:8]))
        self.assertEqual(item['description'],'Synthetic fixture, do not publish.')
        self.assertIn('geo%5BnorthEast%5D',Pages.urls[0])
        self.assertEqual(len(Routes.calls),1)

    def test_over_limit_far_and_other_day_are_not_listed(self):
        Routes.durations=[1201]
        other=(datetime.fromisoformat(DAY)+timedelta(days=3)).date().isoformat()
        result=self.collect(['87000001'],[dated(1,43.6005,1.44),dated(2,43.7,1.44),dated(3,43.6006,1.44,day=other)])
        self.assertEqual(result['total'],0);self.assertTrue(result['complete'])
        self.assertEqual(result['stations'][0]['coverage']['venues_in_radius'],1)
        self.assertEqual(len(Routes.calls),1)

    def test_description_is_withheld_without_reuse_permission(self):
        self.collect(['87000001'],[dated(1,43.6005,1.44)])
        allow_source(self.conn,'S002',reuse=False,description=False)
        item=nearby.lookup(self.conn,['87000001'],DAY)['stations'][0]['activities'][0]
        self.assertIsNone(item['description']);self.assertFalse(item['facts_reuse_allowed'])

    def test_activity_between_two_stations_is_listed_once_under_the_shorter_walk(self):
        Routes.durations=[900,300]
        result=self.collect(['87000001','87000002'],[dated(1,43.602,1.44)],[])
        self.assertEqual(result['total'],1)
        first,second=result['stations']
        self.assertEqual(first['activities'],[])
        item=second['activities'][0]
        self.assertEqual(item['walking_seconds'],300)
        self.assertEqual(item['also_near'],[{'station_id':'87000001','station_name':'TEST Gare Centre','walking_seconds':900}])

    def test_same_title_and_place_from_two_records_is_merged(self):
        result=self.collect(['87000001'],[dated(1,43.6005,1.44,'Tomber du ciel'),dated(2,43.6006,1.44,'TOMBER DU CIEL'),dated(3,43.6005,1.44,'Autre atelier')])
        items=result['stations'][0]['activities']
        self.assertEqual(sorted(len(i['other_sources']) for i in items),[0,1])

    def test_failed_route_is_partial_and_never_listed(self):
        Routes.failure='http_500'
        result=self.collect(['87000001'],[dated(1,43.6005,1.44)])
        coverage=result['stations'][0]['coverage']
        self.assertEqual((coverage['state'],coverage['error'],coverage['routes_unavailable']),('partial','some_routes_unverified',1))
        self.assertEqual(result['total'],0);self.assertFalse(result['complete'])

    def test_failed_source_is_reported_not_hidden(self):
        Pages.bodies=[FetchError('http_503')]
        nearby.request(self.conn,['87000001'],DAY);self.drain()
        coverage=nearby.lookup(self.conn,['87000001'],DAY)['stations'][0]['coverage']
        self.assertEqual((coverage['state'],coverage['error']),('failed','all_sources_failed'))
        self.assertEqual(coverage['sources'][0]['error'],'http_503')

    def test_second_page_is_followed_one_request_per_step(self):
        Pages.bodies=[{'events':[dated(1,43.6005,1.44)],'after':[1,2]},{'events':[dated(2,43.6007,1.44,'TEST ONLY — visite')],'after':None}]
        nearby.request(self.conn,['87000001'],DAY)
        self.assertEqual(self.step()['step_status'],'pending');self.assertEqual(len(Pages.urls),1)
        self.drain()
        self.assertEqual(nearby.lookup(self.conn,['87000001'],DAY)['total'],2)
        self.assertEqual(self.scalar('SELECT pages FROM station_lookup_steps'),2)


class QueueTests(NearbyCase):
    def test_fresh_result_is_not_requested_again_and_stale_result_is(self):
        self.collect(['87000001'],[dated(1,43.6005,1.44)])
        self.assertEqual(nearby.request(self.conn,['87000001'],DAY),[{'station_id':'87000001','action':'unchanged'}])
        with self.conn:self.conn.execute("UPDATE station_lookups SET updated_at='2000-01-01T00:00:00+00:00'")
        self.assertEqual(nearby.request(self.conn,['87000001'],DAY)[0]['action'],'queued')
        self.assertEqual(self.scalar('SELECT count(*) FROM station_lookup_steps'),0)
        self.assertEqual(self.scalar('SELECT count(*) FROM crawl_runs'),1)

    def test_new_venue_from_a_neighbour_only_queues_its_route(self):
        self.collect(['87000001'],[])
        self.collect(['87000002'],[dated(1,43.602,1.44)])
        requests=len(Pages.urls)
        self.assertEqual(nearby.request(self.conn,['87000001'],DAY)[0]['action'],'routes_queued')
        self.drain()
        self.assertEqual(len(Pages.urls),requests)
        self.assertEqual(nearby.lookup(self.conn,['87000001'],DAY)['stations'][0]['coverage']['routes_verified'],1)

    def test_collection_and_routes_continue_after_300_attempts(self):
        with self.conn:
            self.conn.executemany("INSERT INTO station_lookup_attempts(started_at,kind) VALUES (?,?)",
                                  [(now(),'collect' if i%2 else 'route') for i in range(300)])
        result=self.collect(['87000001'],[dated(1,43.6005,1.44)])
        self.assertTrue(result['complete']);self.assertEqual(result['total'],1)
        self.assertEqual((len(Pages.urls),len(Routes.calls)),(1,1))
        self.assertEqual(nearby.usage(self.conn),(302,False))

    def test_legacy_hourly_limit_setting_does_not_stop_collection(self):
        with self.conn:
            self.conn.execute("INSERT INTO station_lookup_attempts(started_at,kind) VALUES (?,'collect')",(now(),))
        with patch.dict(os.environ,{'SNCF_EVENTS_HOURLY_REQUESTS':'1'}):
            result=self.collect(['87000001'],[dated(1,43.6005,1.44)])
        self.assertTrue(result['complete']);self.assertEqual(result['total'],1)
        self.assertEqual((len(Pages.urls),len(Routes.calls)),(1,1))

    def test_provider_rate_limit_stops_requests_and_keeps_work_pending(self):
        nearby.request(self.conn,['87000001'],DAY)
        with self.conn:
            self.conn.execute("INSERT INTO station_lookup_attempts(started_at,kind,error) VALUES (?,'collect','http_429')",(now(),))
        self.assertEqual(self.step(),{'throttled':'provider_rate_limit_cooldown'})
        self.assertEqual(Pages.urls+Routes.calls,[])
        self.assertTrue(nearby.lookup(self.conn,['87000001'],DAY)['pending'])

    def test_collection_resumes_after_provider_cooldown(self):
        earlier=(datetime.fromisoformat(now())-timedelta(minutes=11)).isoformat(timespec='seconds')
        with self.conn:
            self.conn.execute("INSERT INTO station_lookup_attempts(started_at,kind,error) VALUES (?,'route','http_429')",(earlier,))
        result=self.collect(['87000001'],[dated(1,43.6005,1.44)])
        self.assertTrue(result['complete']);self.assertEqual(result['total'],1)

    def test_storage_limit_still_stops_requests(self):
        nearby.request(self.conn,['87000001'],DAY)
        with patch.object(nearby,'storage_bytes',return_value=0):
            self.assertEqual(self.step(),{'throttled':'storage_budget_reached'})
        self.assertEqual(Pages.urls+Routes.calls,[])
        self.assertTrue(nearby.lookup(self.conn,['87000001'],DAY)['pending'])

    def test_queue_is_bounded(self):
        with patch.object(nearby,'MAX_QUEUED',1):
            actions=[r['action'] for r in nearby.request(self.conn,['87000001','87000002'],DAY)]
        self.assertEqual(actions,['queued','queue_full'])

    def test_no_enabled_source_fails_without_network(self):
        with self.conn:self.conn.execute('UPDATE endpoints SET enabled=0')
        nearby.request(self.conn,['87000001'],DAY);self.drain()
        self.assertEqual(self.scalar('SELECT error FROM station_lookups'),'no_enabled_event_endpoints')


class SetupTests(DatabaseCase):
    def test_setup_is_idempotent_and_applies_only_recorded_reviews(self):
        fresh=connect(self.path.parent/'live.sqlite3');self.addCleanup(fresh.close)
        first=nearby.setup(fresh);second=nearby.setup(fresh)
        self.assertEqual(first,second)
        self.assertEqual(first['sources'],{s:'enabled' for s in nearby.LIVE_SOURCES})
        self.assertTrue(all(first['endpoints'].values()));self.assertEqual(first['stations'],0)
        self.assertEqual(fresh.execute('SELECT count(*) FROM source_reviews').fetchone()[0],3)
        self.assertEqual(fresh.execute('SELECT count(*) FROM sources WHERE enabled=1').fetchone()[0],3)
        self.assertEqual(fresh.execute('SELECT count(*) FROM entities').fetchone()[0],0)

    def test_expired_recorded_review_leaves_source_disabled(self):
        fresh=connect(self.path.parent/'expired.sqlite3');self.addCleanup(fresh.close)
        with patch.object(nearby,'now',lambda:'2027-01-01T00:00:00+00:00'):
            report=nearby.setup(fresh)
        self.assertEqual(set(report['sources'].values()),{'review_missing_or_expired'})
        self.assertFalse(any(report['endpoints'].values()))

    def test_service_reads_without_collecting_when_not_live(self):
        service=nearby.Service(self.path.parent/'service.sqlite3',live=False).start();self.addCleanup(service.stop)
        self.assertIsNone(service.thread)
        with self.assertRaises(ValueError):service.activities(['87611004'],DAY)
        self.assertEqual(service.stations('toulouse'),[])
        second=nearby.Service(self.path.parent/'service.sqlite3').start();self.addCleanup(second.stop)
        self.assertEqual((second.live,second.error),(False,'another_process_owns_collection'))
