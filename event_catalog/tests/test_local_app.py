import io
import json
import os
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit

from sncf_events.connectors import configure_endpoint,enable_endpoint,initial_url,run_endpoint,scoped_endpoint
from sncf_events.db import dumps,migrate,now
from sncf_events.ingest import start_run,finish_run,ingest_page
from sncf_events.search import csv_export,detail,search,window
from sncf_events import refresh
from sncf_events.server import App,Handler
from tests.helpers import DatabaseCase,allow_source,event
from tests.test_connectors import FakeClient


class LocalQueryTests(DatabaseCase):
    def ingest(self,rows,agenda=1):
        run=start_run(self.conn,'S002')
        ingest_page(self.conn,run,'S002',f'https://api.openagenda.com/v2/agendas/{agenda}/events',dumps({'events':rows}),'openagenda_events')
        finish_run(self.conn,run,'complete')

    def query(self,**filters):
        return search(self.conn,rail_filter='all',from_date='2026-10-12',to_date='2026-10-12',**filters)

    def test_only_matching_slots_and_stable_chronological_pages(self):
        self.ingest([event(1,timings=[{'begin':'2026-10-11T01:00:00Z','end':'2026-10-11T02:00:00Z'},
                                    {'begin':'2026-10-12T15:00:00Z','end':'2026-10-12T16:00:00Z'}]),event(2)])
        first=self.query(page_size=1)
        self.assertEqual(first['total'],2)
        self.assertEqual(first['items'][0]['external_id'],'2')
        second=self.query(page_size=1,page=2)['items'][0]
        self.assertEqual(second['external_id'],'1')
        self.assertEqual(len(second['occurrences']),1)
        self.assertEqual(second['occurrence_count'],2)
        self.assertEqual(len(detail(self.conn,second['id'])['occurrences']),2)

    def test_midnight_end_is_exclusive_but_point_event_is_included(self):
        self.ingest([event(1,timings=[{'begin':'2026-10-11T21:00:00Z','end':'2026-10-11T22:00:00Z'}]),
                     event(2,timings=[{'begin':'2026-10-11T22:00:00Z','end':'2026-10-11T22:00:00Z'}])])
        self.assertEqual([r['external_id'] for r in self.query()['items']],['2'])

    def test_civil_day_handles_both_dst_transitions(self):
        for day,hours in [('2026-03-29',23),('2026-10-25',25)]:
            a,b=map(datetime.fromisoformat,window(day,day))
            self.assertEqual((b-a).total_seconds(),hours*3600)
        for first,last in [('9999-12-31','9999-12-31'),('2026-01-01','2027-01-02'),('2026-10-12','2026-10-11')]:
            with self.assertRaises(ValueError):window(first,last)

    def test_cancellation_removal_and_other_active_calendar(self):
        self.ingest([event(1),event(2,status=6),event(3)])
        self.ingest([event(1)],agenda=2)
        self.ingest([{'uid':1,'removed':True,'updatedAt':'2026-10-10T00:00:00Z'},
                     {'uid':3,'removed':True,'updatedAt':'2026-10-10T00:00:00Z'}])
        self.assertEqual([r['external_id'] for r in self.query()['items']],['1'])
        self.assertEqual(self.query(include_inactive=True)['total'],3)
        self.assertTrue(self.query()['items'][0]['source_active'])

    def test_text_city_source_filters_and_no_html_execution(self):
        self.ingest([event(1,title={'fr':'Musée Éducation'},description={'fr':'<p>Bonjour <b>école</b></p><script>steal()</script>'},conditions={'fr':'<b>Gratuit</b>'})])
        result=self.query(text='ecole',city='TOULOUSE',department='31',source_id='S002')['items'][0]
        self.assertEqual(result['description_text'],'Bonjour école')
        self.assertEqual(result['price_text'],'Gratuit')
        self.assertEqual(self.query(source_id='S001')['total'],0)
        self.assertEqual(self.query(text="' OR 1=1 --")['total'],0)
        with self.assertRaises(ValueError):self.query(page_size=101)

    def test_unknown_dates_not_invented_and_school_search_ignores_calendar(self):
        self.ingest([event(1,timings=[])])
        self.assertEqual(self.query()['total'],0)
        self.assertEqual(search(self.conn,kind='educational_offer')['total'],0)
        with self.assertRaises(ValueError):search(self.conn)

    def test_csv_formulas_escaped_and_repeated_sessions_preserved(self):
        self.ingest([event(1,title={'fr':'=1+2'},timings=[{'begin':'2026-10-12'},{'begin':'2026-10-13'}])])
        rows=search(self.conn,rail_filter='all',from_date='2026-10-12',to_date='2026-10-13')['items']
        output=csv_export(rows)
        self.assertTrue(output.startswith('\ufeff'))
        self.assertEqual(output.count("'=1+2"),2)


class RefreshTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        allow_source(self.conn,'S002')
        configure_endpoint(self.conn,'oa-test','S002','openagenda_events',{'agenda_uid':123,'starts_after':'2026-10-10T00:00:00Z'})
        enable_endpoint(self.conn,'oa-test')
        FakeClient.urls=[]
        self.env=patch.dict(os.environ,{'OPENAGENDA_PUBLIC_KEY':'oa_pk_test'})
        self.env.start();self.addCleanup(self.env.stop)

    def runner(self,conn,*a,**kw):
        return run_endpoint(conn,*a,client_factory=FakeClient,**kw)

    def enqueue(self,**kw):
        return refresh.enqueue(self.conn,'2026-10-12','2026-10-12',**kw)

    def process(self,identifier,document):
        FakeClient.bodies=[document]
        return refresh.process_one(self.conn,identifier,runner=self.runner)

    def test_date_scope_and_edit_scope_are_separate_and_endpoint_unchanged(self):
        self.enqueue()
        steps=self.conn.execute('SELECT * FROM refresh_steps ORDER BY id').fetchall()
        query=parse_qs(urlsplit(steps[0]['initial_url']).query)
        self.assertEqual(query['timings[gte]'],['2026-10-11T22:00:00+00:00'])
        self.assertEqual(query['timings[lte]'],['2026-10-12T21:59:59.999999+00:00'])
        query=parse_qs(urlsplit(steps[1]['initial_url']).query)
        self.assertIn('updatedAt[gte]',query);self.assertNotIn('timings[gte]',query)
        self.assertEqual(json.loads(self.scalar('SELECT config_json FROM endpoints'))['starts_after'],'2026-10-10T00:00:00+00:00')

    def test_job_deduplicates_active_request_and_rejects_concurrent_window(self):
        first=self.enqueue()
        self.assertEqual(self.enqueue()['id'],first['id'])
        with self.assertRaises(ValueError):refresh.enqueue(self.conn,'2026-10-13','2026-10-13')

    def test_page_budget_persists_and_resume_gets_tail_without_replaying(self):
        identifier=self.enqueue(page_budget=1)['id']
        self.process(identifier,{'events':[event(1)],'after':[123.5]})
        self.assertEqual(refresh.process_one(self.conn,identifier,runner=self.runner)['status'],'paused')
        refresh.resume_job(self.conn,identifier)
        self.process(identifier,{'events':[],'after':None})  # changes phase gets its turn
        refresh.process_one(self.conn,identifier,runner=self.runner)
        refresh.resume_job(self.conn,identifier)
        self.process(identifier,{'events':[event(2)],'after':None})
        result=refresh.process_one(self.conn,identifier,runner=self.runner)
        self.assertEqual(result['status'],'complete')
        self.assertIn('after%5B%5D=123.5',FakeClient.urls[-1])
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),2)
        self.assertTrue(refresh.coverage(self.conn,'2026-10-12','2026-10-12')[0]['fresh'])
        self.assertEqual(refresh.coverage(self.conn,'2026-10-13','2026-10-13')[0]['status'],'not_checked')

    def test_quarantine_on_first_page_is_not_forgotten_at_clean_tail(self):
        identifier=self.enqueue()['id']
        self.process(identifier,{'events':[event(location={})],'after':[1]})
        self.process(identifier,{'events':[],'after':None})
        self.process(identifier,{'events':[],'after':None})
        result=refresh.process_one(self.conn,identifier,runner=self.runner)
        self.assertEqual(result['status'],'partial')
        self.assertFalse(refresh.coverage(self.conn,'2026-10-12','2026-10-12')[0]['fresh'])

    def test_rate_limit_has_persistent_cooldown(self):
        from sncf_events.http import FetchError
        identifier=self.enqueue()['id']
        self.process(identifier,FetchError('http_429'))
        result=refresh.process_one(self.conn,identifier,runner=self.runner)
        self.assertEqual(result['status'],'paused')
        self.assertEqual(result['error'],'hourly_budget_or_cooldown')
        self.assertEqual(len(FakeClient.urls),1)

    def test_storage_budget_stops_before_any_network(self):
        identifier=self.enqueue()['id']
        with patch('sncf_events.refresh.storage',return_value={'remaining_bytes':0}):
            self.assertEqual(refresh.process_one(self.conn,identifier,runner=self.runner)['error'],'storage_budget_reached')
        self.assertEqual(FakeClient.urls,[])

    def test_changed_endpoint_config_cannot_silently_resume(self):
        identifier=self.enqueue()['id']
        configure_endpoint(self.conn,'oa-test','S002','openagenda_events',{'agenda_uid':456})
        enable_endpoint(self.conn,'oa-test')
        refresh.process_one(self.conn,identifier,runner=self.runner)
        self.assertEqual(refresh.job(self.conn,identifier)['steps'][0]['error'],'endpoint_config_changed')
        self.assertEqual(FakeClient.urls,[])

    def test_schedule_is_opt_in_and_does_not_repeat_before_due(self):
        self.assertIsNone(refresh.scheduled_tick(self.conn))
        refresh.save_settings(self.conn,True,6,7)
        self.assertIsNotNone(refresh.scheduled_tick(self.conn))
        self.assertIsNone(refresh.scheduled_tick(self.conn))
        self.assertEqual(self.scalar('SELECT count(*) FROM refresh_jobs'),1)
        with self.assertRaises(ValueError):refresh.save_settings(self.conn,True,1,7)

    def test_recovery_only_closes_owned_app_run(self):
        identifier=self.enqueue()['id']
        run=start_run(self.conn,'S002','oa-test')
        with self.conn:
            self.conn.execute("UPDATE refresh_steps SET status='running',run_id=? WHERE id=(SELECT min(id) FROM refresh_steps)",(run,))
            self.conn.execute("UPDATE refresh_jobs SET status='running'")
        refresh.recover(self.conn)
        self.assertEqual(self.scalar('SELECT status FROM crawl_runs'),'interrupted')
        self.assertEqual(refresh.job(self.conn,identifier)['status'],'paused')
        other=start_run(self.conn,'S002')
        refresh.recover(self.conn)
        self.assertEqual(self.scalar('SELECT status FROM crawl_runs WHERE id=?',(other,)),'running')

    def test_datatourisme_and_region_window_urls(self):
        for name,sid,connector in [('dat','S001','datatourisme_events'),('region','S007','occitanie_region_events')]:
            configure_endpoint(self.conn,name,sid,connector,{})
            endpoint=self.conn.execute('SELECT * FROM endpoints WHERE id=?',(name,)).fetchone()
            query=parse_qs(urlsplit(initial_url(scoped_endpoint(endpoint,['2026-10-12','2026-10-13']))).query)
            expression=query['filters' if name=='dat' else 'where'][0]
            self.assertIn('2026-10-12',expression);self.assertIn('2026-10-13',expression)
            if name=='dat':self.assertIn('OR takesPlaceAt.startDate[gte]',expression)

    def test_cursor_cycle_across_page_batches_fails_instead_of_looping(self):
        identifier=self.enqueue()['id']
        self.process(identifier,{'events':[event(1)],'after':[1]})
        self.process(identifier,{'events':[],'after':None})
        result=self.process(identifier,{'events':[event(1)],'after':[1]})
        self.assertEqual(result['steps'][0]['status'],'failed')
        self.assertEqual(result['steps'][0]['error'],'pagination_cycle')

    def test_changes_pass_cancels_previously_matching_event(self):
        identifier=self.enqueue()['id']
        self.process(identifier,{'events':[event(1)],'after':None})
        self.assertFalse(refresh.coverage(self.conn,'2026-10-12','2026-10-12')[0]['fresh'])
        self.process(identifier,{'events':[event(1,status=6,updatedAt='2026-10-10T12:00:00Z',timings=[])],'after':None})
        self.assertEqual(search(self.conn,from_date='2026-10-12',to_date='2026-10-12')['total'],0)

    def test_new_migration_preserves_previous_data_and_applied_checksums(self):
        before=[tuple(r) for r in self.conn.execute("SELECT * FROM schema_migrations WHERE version<'005'")]
        identifier=self.enqueue()['id']
        self.process(identifier,{'events':[event(1)],'after':None})
        counts={t:self.scalar('SELECT count(*) FROM '+t) for t in ('sources','entities','observations','field_evidence','refresh_jobs')}
        migrate(self.conn)
        self.assertEqual(before,[tuple(r) for r in self.conn.execute("SELECT * FROM schema_migrations WHERE version<'005'")])
        self.assertEqual(counts,{t:self.scalar('SELECT count(*) FROM '+t) for t in counts})

    def test_upgrade_from_four_migrations_keeps_existing_observations(self):
        run=start_run(self.conn,'S002')
        ingest_page(self.conn,run,'S002','https://api.openagenda.com/v2/agendas/123/events',dumps({'events':[event(1)]}),'openagenda_events')
        finish_run(self.conn,run,'complete')
        before=[tuple(r) for r in self.conn.execute('SELECT * FROM observations')]
        with self.conn:
            for table in ('refresh_attempts','refresh_steps','refresh_jobs','local_settings'):
                self.conn.execute('DROP TABLE '+table)
            self.conn.execute("DELETE FROM schema_migrations WHERE version='005_local_app'")
        migrate(self.conn)
        self.assertEqual(before,[tuple(r) for r in self.conn.execute('SELECT * FROM observations')])
        self.assertEqual(self.scalar('SELECT count(*) FROM schema_migrations'),7)
        self.assertEqual(self.scalar('SELECT enabled FROM local_settings'),0)

    def test_duplicate_calendar_profiles_only_fetch_once(self):
        configure_endpoint(self.conn,'oa-test-future','S002','openagenda_events',{'agenda_uid':123})
        enable_endpoint(self.conn,'oa-test-future')
        self.assertEqual(len(refresh.endpoints(self.conn)),1)
        self.assertEqual(len(self.enqueue()['steps']),2)

    def test_manual_pause_and_resume_preserves_same_scope(self):
        identifier=self.enqueue()['id']
        refresh.pause_job(self.conn,identifier)
        self.assertEqual(refresh.process_one(self.conn,identifier,runner=self.runner)['status'],'paused')
        self.assertEqual(FakeClient.urls,[])
        self.assertEqual(refresh.resume_job(self.conn,identifier)['status'],'queued')

    def test_walking_attempts_share_the_event_refresh_hourly_budget(self):
        from sncf_events.db import now
        with self.conn:
            self.conn.execute("INSERT INTO walking_jobs(id,created_at,updated_at,status,filters_json,targets_json,budget) VALUES ('test',?,?,'complete','{}','[]',1)",(now(),now()))
            self.conn.executemany("INSERT INTO walking_attempts(job_id,started_at) VALUES ('test',?)",[(now(),)]*60)
        identifier=self.enqueue()['id']
        result=refresh.process_one(self.conn,identifier,runner=self.runner)
        self.assertEqual(result['error'],'hourly_budget_or_cooldown')
        self.assertEqual(FakeClient.urls,[])

    def test_scheduler_continues_incomplete_window_instead_of_restarting(self):
        first=datetime.now(timezone.utc).astimezone(__import__('sncf_events.search',fromlist=['PARIS']).PARIS).date().isoformat()
        identifier=refresh.enqueue(self.conn,first,first)['id']
        with self.conn:
            self.conn.execute("UPDATE refresh_jobs SET status='paused',error='page_budget_reached' WHERE id=?",(identifier,))
        refresh.save_settings(self.conn,True,6,7)
        self.assertEqual(refresh.scheduled_tick(self.conn)['id'],identifier)
        self.assertEqual(self.scalar('SELECT count(*) FROM refresh_jobs'),1)


class Wire:
    def __init__(self,body):self.reader=io.BytesIO(body);self.output=bytearray()
    def makefile(self,*args):return self.reader
    def sendall(self,body):self.output.extend(body)
    def settimeout(self,*a):pass


class LocalHTTPTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.app=App(self.path)

    def request(self,path,*,method='GET',payload=None,host='127.0.0.1:8766',origin=None,token=None):
        body=dumps(payload).encode() if payload is not None else b''
        headers=[f'{method} {path} HTTP/1.1',f'Host: {host}','Connection: close']
        if origin:headers.append('Origin: '+origin)
        if token:headers.append('X-CSRF-Token: '+token)
        if body:headers.extend(['Content-Type: application/json','Content-Length: '+str(len(body))])
        wire=Wire(('\r\n'.join(headers)+'\r\n\r\n').encode()+body)
        Handler(wire,('127.0.0.1',1234),SimpleNamespace(app=self.app,server_port=8766))
        head,data=bytes(wire.output).split(b'\r\n\r\n',1)
        return int(head.split(b' ')[1]),head.decode(),data

    def test_page_assets_security_headers_and_no_arbitrary_files(self):
        for path in ('/','/app.js','/style.css','/view.js'):
            status,headers,body=self.request(path)
            self.assertEqual(status,200);self.assertIn('Content-Security-Policy',headers);self.assertTrue(body)
        for path in ('/.env','/../.env','/var/occitanie.sqlite3','/api/unknown'):
            self.assertEqual(self.request(path)[0],404)

    def test_dns_rebinding_and_cross_origin_writes_rejected(self):
        self.assertEqual(self.request('/api/meta',host='evil.example')[0],403)
        self.assertEqual(self.request('/api/meta',origin='https://evil.example')[0],403)
        for origin,token in [(None,None),('http://127.0.0.1:8766','wrong'),('https://evil.example',self.app.csrf)]:
            self.assertEqual(self.request('/api/settings',method='POST',payload={'enabled':True},origin=origin,token=token)[0],403)
        self.assertEqual(self.scalar('SELECT enabled FROM local_settings'),0)

    def test_settings_and_readonly_mode(self):
        kwargs={'method':'POST','payload':{'enabled':True,'interval_hours':6,'horizon_days':7},'origin':'http://127.0.0.1:8766','token':self.app.csrf}
        self.assertEqual(self.request('/api/settings',**kwargs)[0],200)
        self.assertEqual(self.scalar('SELECT enabled FROM local_settings'),1)
        self.app.readonly=True
        self.assertEqual(self.request('/api/settings',**kwargs)[0],403)

    def test_metadata_does_not_disclose_keys(self):
        with patch.dict(os.environ,{'DATATOURISME_API_KEY':'SECRET_NOT_FOR_BROWSER'}):
            status,_,body=self.request('/api/meta')
        self.assertEqual(status,200);self.assertNotIn(b'SECRET_NOT_FOR_BROWSER',body)
        self.assertEqual(json.loads(body)['registered_sources'],144)

    def test_search_validation_empty_export_and_missing_record(self):
        self.assertEqual(self.request('/api/search?from_date=2026-10-12&to_date=2026-10-12')[0],200)
        self.assertEqual(self.request('/api/search?page=1&page=2')[0],400)
        self.assertEqual(self.request('/api/search?from_date=9999-12-31&to_date=9999-12-31')[0],400)
        self.assertEqual(self.request('/api/detail?id=unknown')[0],400)
        status,header,body=self.request('/api/export.csv?from_date=2026-10-12&to_date=2026-10-12')
        self.assertEqual(status,200);self.assertIn('attachment',header);self.assertTrue(body.startswith(b'\xef\xbb\xbf'))
        self.assertEqual(self.request('/api/status?from_date=2026-10-12&to_date=2026-10-12')[0],200)

    def test_station_lookup_routes_read_stored_evidence_only(self):
        with self.conn:
            self.conn.execute('INSERT INTO rail_datasets VALUES (?,?,?,1)',('TEST',dumps({'synthetic':True}),now()))
            self.conn.execute('INSERT INTO rail_stations VALUES (?,?,?,?,?,?,?,?)',('TEST','87611004','TEST Station',43.6,1.44,'31','Toulouse','["Train TER"]'))
        status,_,body=self.request('/api/stations?q=test')
        self.assertEqual((status,json.loads(body)['stations'][0]['id']),(200,'87611004'))
        status,_,body=self.request('/api/near?stations=87611004,Paris&date=2026-10-12')
        result=json.loads(body)
        self.assertEqual((status,result['total'],result['stations'][0]['coverage']['state']),(200,0,'not_requested'))
        self.assertEqual(result['unknown_stations'][0]['reference'],'Paris')
        self.assertEqual(self.scalar('SELECT count(*) FROM station_lookups'),0)
        for path in ('/api/near?stations=87611004','/api/near?stations=&date=2026-10-12','/api/near?stations=87611004&date=12-10-2026','/api/stations?limit=0'):
            self.assertEqual(self.request(path)[0],400)

    def test_prefixed_deployment_assets_api_redirect_and_writes(self):
        self.app=App(self.path,base_path='/sncf-events/')
        self.assertEqual(self.request('/sncf-events')[0],308)
        for path in ('/sncf-events/','/sncf-events/app.js','/sncf-events/api/meta'):
            self.assertEqual(self.request(path)[0],200)
        self.assertEqual(self.request('/api/meta')[0],404)
        self.assertEqual(self.request('/sncf-events/.env')[0],404)
        self.assertEqual(self.request('/sncf-events/api/settings',method='POST',payload={'enabled':False},origin='http://127.0.0.1:8766',token=self.app.csrf)[0],200)
        with self.assertRaises(ValueError):App(self.path,base_path='//evil/')
