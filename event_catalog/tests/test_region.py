import json
import sqlite3
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from sncf_events.connectors import configure_endpoint, enable_endpoint, initial_url, next_url, run_endpoint
from sncf_events.db import ROOT, connect, digest, import_registry, migrate, now
from sncf_events.export import records
from sncf_events.ingest import ingest_page, start_run, retry_quarantined
from sncf_events.normalize import region_event
from tests.helpers import DatabaseCase, allow_source
from tests.test_connectors import FakeClient


def region_row(uid=1, **changes):
    result = {'url':f'https://www.laregion.fr/TEST-ONLY-{uid}',
              'titre':'TEST &amp; atelier','description':'TEST ONLY &nbsp;description (…) ',
              'date_debut':'2026-10-10','date_fin':'2026-10-31','date':'Du 10 au 31 octobre 2026',
              'code_insee':'31555','commune':'Toulouse','adresse':'TEST ONLY address',
              'geo_point_2d':{'lat':43.6,'lon':1.44},'thematique':'Science','type':'TEST ONLY'}
    result.update(changes)
    return result


class RegionTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        FakeClient.urls,FakeClient.bodies = [],[]
        allow_source(self.conn,'S007')
        configure_endpoint(self.conn,'region','S007','occitanie_region_events',{'from_date':'2026-10-10'})
        enable_endpoint(self.conn,'region')

    def endpoint(self):
        return self.conn.execute("SELECT * FROM endpoints WHERE id='region'").fetchone()

    def test_date_range_is_not_expanded_or_assigned_midnight(self):
        c = region_event(region_row()).validate()
        self.assertEqual(c.data['title'],'TEST & atelier')
        self.assertEqual(len(c.data['occurrences']),1)
        period = c.data['occurrences'][0]
        self.assertEqual(period['precision'],'date')
        self.assertIsNone(period['start_at'])
        self.assertIsNone(period['timezone'])
        self.assertEqual(c.data['status'],'unknown')
        self.assertNotIn('school',c.data)
        self.assertNotIn('source_updated_at',c.data)
        self.assertIn('date_range_not_daily_availability',c.issues)
        self.assertEqual(c.evidence['published_end_date']['locator'],'/results/0/date_fin')

    def test_outside_region_and_missing_insee_are_quarantined(self):
        run = start_run(self.conn,'S007')
        result = ingest_page(self.conn,run,'S007',initial_url(self.endpoint()),json.dumps({'results':[
            region_row(1,code_insee='75056'),region_row(2,code_insee=None),region_row(3)]}),'occitanie_region_events')
        self.assertEqual((result['accepted'],result['quarantined']),(1,2))
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),1)

    def test_html_entities_in_urls_are_decoded_before_url_parsing(self):
        c = region_event(region_row(url='https://www.laregion.fr/TEST-&#128154;')).validate()
        self.assertEqual(c.data['canonical_url'],'https://www.laregion.fr/TEST-%F0%9F%92%9A')
        self.assertEqual(c.evidence['canonical_url']['value'],'https://www.laregion.fr/TEST-&#128154;')

    def test_retry_preserves_failure_and_reuses_original_snapshot(self):
        run = start_run(self.conn,'S007')
        with patch('sncf_events.ingest.region_event',side_effect=ValueError('old_mapper_rejection')):
            ingest_page(self.conn,run,'S007',initial_url(self.endpoint()),json.dumps({'results':[region_row()]}),'occitanie_region_events')
        result = retry_quarantined(self.conn,1,'occitanie_region_events')
        self.assertEqual(result['resolved'],1)
        self.assertEqual(self.scalar('SELECT count(*) FROM snapshots'),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),1)
        self.assertEqual(self.scalar('SELECT reason FROM quarantined_records'),'old_mapper_rejection')
        self.assertEqual(self.scalar('SELECT count(*) FROM quarantined_records WHERE resolved_at IS NULL'),0)
        with self.assertRaises(ValueError):
            retry_quarantined(self.conn,1,'occitanie_region_events')

    def test_failed_retry_does_not_clear_quarantine_or_create_entity(self):
        run = start_run(self.conn,'S007')
        ingest_page(self.conn,run,'S007',initial_url(self.endpoint()),json.dumps({'results':[region_row(code_insee=None)]}),'occitanie_region_events')
        with self.assertRaises(ValueError):
            retry_quarantined(self.conn,1,'occitanie_region_events')
        self.assertIsNone(self.scalar('SELECT resolved_at FROM quarantined_records'))
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),0)

    def test_invalid_date_is_not_inferred_from_free_text(self):
        for changes in ({'date_fin':'2026-02-30'},{'date_debut':'2026-10-10T00:00:00Z'},{'date_fin':'2026-01-01'}):
            with self.assertRaises(ValueError):
                region_event(region_row(**changes))

    def test_page_cursor_retains_query_and_ends_at_total(self):
        e = self.endpoint()
        url = initial_url(e)
        first = next_url(e,url,{'total_count':51,'results':[region_row(i) for i in range(50)]})
        params = parse_qs(urlsplit(first).query)
        self.assertEqual(params['offset'],['50'])
        self.assertEqual(params['where'],["date_fin >= date'2026-10-10'"])
        self.assertIsNone(next_url(e,first,{'total_count':51,'results':[region_row(50)]}))

    def test_missing_or_inconsistent_total_never_completes(self):
        e = self.endpoint()
        for payload in ({'results':[]},{'total_count':1,'results':[]},
                        {'total_count':50,'results':[region_row()]},{'total_count':True,'results':[]}):
            with self.assertRaises(ValueError):
                next_url(e,initial_url(e),payload)

    def test_live_contract_without_key_and_public_provenance(self):
        FakeClient.bodies = [{'total_count':1,'results':[region_row()]}]
        result = run_endpoint(self.conn,'region',client_factory=FakeClient)
        self.assertEqual(result['status'],'complete')
        record = list(records(self.conn,public=True))[0]
        self.assertEqual(record['city'],'Toulouse')
        self.assertEqual(record['theme'],'Science')
        self.assertEqual(record['schedule_semantics'],'published_date_range')
        self.assertEqual(record['evidence']['snapshot_id'],1)
        self.assertIsNone(record['school_conditions']['max_group'])
        self.assertNotIn('description',record)

    def test_stable_url_deduplicates_between_runs(self):
        for _ in range(2):
            FakeClient.bodies = [{'total_count':1,'results':[region_row()]}]
            run_endpoint(self.conn,'region',client_factory=FakeClient)
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM observations'),2)

    def test_endpoint_cannot_be_retargeted_or_inject_filter(self):
        for sid,config in [('S011',{}),('S007',{'url':'https://evil.example'}),('S007',{'from_date':"2026-10-10' OR true"})]:
            with self.assertRaises(ValueError):
                configure_endpoint(self.conn,'bad',sid,'occitanie_region_events',config)

    def test_partial_offset_run_resumes_without_reimporting_page(self):
        FakeClient.bodies = [{'total_count':51,'results':[region_row(i) for i in range(50)]}]
        first = run_endpoint(self.conn,'region',max_pages=1,client_factory=FakeClient)
        self.assertEqual(first['status'],'partial')
        FakeClient.bodies = [{'total_count':51,'results':[region_row(50)]}]
        last = run_endpoint(self.conn,'region',max_pages=1,resume=first['id'],client_factory=FakeClient)
        self.assertEqual(last['status'],'complete')
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),51)

    def test_upgrade_preserves_existing_endpoint_run_and_foreign_keys(self):
        old = connect(self.path.parent/'old.sqlite3')
        self.addCleanup(old.close)
        sql = (ROOT/'sncf_events/migrations/001_initial.sql').read_text()
        old.executescript(sql)
        old.execute('INSERT INTO schema_migrations VALUES (?,?,?)',('001_initial',digest(sql),now()))
        old.commit()
        # Seed departments before importing the source directory, as init does.
        from sncf_events.db import DEPARTMENTS
        old.executemany('INSERT INTO departments(code,name) VALUES (?,?)',DEPARTMENTS.items())
        old.commit()
        import_registry(old,self.seed)
        configure_endpoint(old,'prior','S001','datatourisme_events',{})
        run = start_run(old,'S001','prior')
        migrate(old)
        self.assertEqual(old.execute('SELECT endpoint_id FROM crawl_runs WHERE id=?',(run,)).fetchone()[0],'prior')
        self.assertEqual(old.execute('PRAGMA foreign_keys').fetchone()[0],1)
        self.assertEqual(old.execute('PRAGMA foreign_key_check').fetchall(),[])
        configure_endpoint(old,'new','S007','occitanie_region_events',{})
        with self.assertRaises(sqlite3.IntegrityError):
            old.execute("DELETE FROM endpoints WHERE id='prior'")
