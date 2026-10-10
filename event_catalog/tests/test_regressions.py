"""Failure-path tests discovered during the full v0.2 audit."""
import io
import json
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

from sncf_events.cli import main
from sncf_events.connectors import configure_endpoint, enable_endpoint, initial_url, next_url, run_endpoint, sanitize_payload
from sncf_events.db import dumps
from sncf_events.export import export_jsonl, records
from sncf_events.ingest import finish_run, ingest_page, start_run
from sncf_events.normalize import oa_event
from tests.helpers import DatabaseCase, allow_source, event
from tests.test_connectors import FakeClient


class RegressionTests(DatabaseCase):
    def test_search_cursor_accepts_real_api_float_score_but_not_boolean_or_nan(self):
        configure_endpoint(self.conn,'search','S002','openagenda_agendas',{'search':'Occitanie'})
        e=self.conn.execute("SELECT * FROM endpoints WHERE id='search'").fetchone()
        self.assertIn('53.311996',next_url(e,initial_url(e),{'after':[53.311996,4310687]}))
        for invalid in ([True,1],[float('nan'),1],[{},1]):
            with self.assertRaises(ValueError):
                next_url(e,initial_url(e),{'after':invalid})

    def test_actual_datatourisme_language_shape_and_original_hours(self):
        from sncf_events.normalize import datatourisme
        raw={'uuid':'TEST-DT','label':{'@fr':'TEST ONLY museum'},'lastUpdate':'2026-10-01',
             'hasDescription':[{'description':{'@fr':'TEST ONLY text'}}],
             'hasBeenCreatedBy':{'legalName':'TEST ONLY producer'},
             'isLocatedAt':[{'address':[{'hasAddressCity':{'insee':'31555'},'streetAddress':['TEST ONLY address']}]}],
             'takesPlaceAt':[{'startDate':'2026-10-10','endDate':'2026-10-11','startTime':'11:00','endTime':'18:00'}]}
        c=datatourisme(raw,'event').validate()
        self.assertEqual(c.data['title'],'TEST ONLY museum')
        self.assertEqual(c.data['description'],'TEST ONLY text')
        self.assertEqual(c.data['schedule_periods'][0]['startTime'],'11:00')
        self.assertEqual(c.data['occurrences'][0]['precision'],'date')
        self.assertEqual(c.data['producer']['legalName'],'TEST ONLY producer')

    def ingest(self, row):
        run = start_run(self.conn,'S002')
        result = ingest_page(self.conn,run,'S002','https://api.openagenda.com/v2/agendas/1/events',
                             dumps({'events':[row]}),'openagenda_events')
        finish_run(self.conn,run,'complete')
        return result

    def test_non_object_endpoint_config_is_a_controlled_cli_error(self):
        for config in ('null','[]','1','true'):
            with self.subTest(config=config),redirect_stdout(io.StringIO()),redirect_stderr(io.StringIO()):
                self.assertEqual(main(['--db',str(self.path),'configure-endpoint','invalid','S001',
                                       'datatourisme_events','--config',config]),2)

    def test_bad_from_date_type_is_a_controlled_cli_error(self):
        with redirect_stdout(io.StringIO()),redirect_stderr(io.StringIO()):
            self.assertEqual(main(['--db',str(self.path),'configure-endpoint','invalid','S007',
                'occitanie_region_events','--config','{"from_date":123}']),2)

    def test_nonfinite_json_is_retained_as_invalid_envelope(self):
        run = start_run(self.conn,'S002')
        body = '{"events":['+dumps(event())+', {"uid":NaN}],"after":null}'
        with self.assertRaisesRegex(ValueError,'invalid_page_envelope'):
            ingest_page(self.conn,run,'S002','https://api.openagenda.com/v2/agendas/1/events',body,'openagenda_events')
        self.assertEqual(self.scalar('SELECT count(*) FROM snapshots'),1)
        self.assertEqual(self.scalar('SELECT locator FROM quarantined_records'),'/')
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),0)

    def test_sanitizer_preserves_invalid_json_for_quarantine(self):
        for body in ('{"value":NaN}','['*1100+'0'+']'*1100):
            self.assertEqual(sanitize_payload(body,''),body)

    def test_empty_timing_object_still_reports_missing_schedule(self):
        c=oa_event(event(timings=[{}])).validate()
        self.assertIn('missing_occurrences',c.issues)

    def test_school_lists_are_arrays_in_downstream_json(self):
        self.ingest(event())
        school=list(records(self.conn))[0]['school_conditions']
        self.assertEqual(school['grade_levels'],[])
        self.assertEqual(school['languages'],[])
        self.assertNotIn('grade_levels_json',school)

    def test_repeated_region_ingestion_does_not_accumulate_open_missing_field_issues(self):
        from tests.test_region import region_row
        for _ in range(3):
            run=start_run(self.conn,'S007')
            ingest_page(self.conn,run,'S007','https://data.laregion.fr/api/events',
                        dumps({'results':[region_row()]}),'occitanie_region_events')
            finish_run(self.conn,run,'complete')
        self.assertEqual(self.scalar("SELECT count(*) FROM review_issues WHERE code='exact_hours_unknown' AND resolved_at IS NULL"),1)

    def test_export_failure_leaves_no_partial_destination(self):
        target=self.path.parent/'export.jsonl'
        def broken(*args,**kwargs):
            yield {'id':'first'}
            raise ValueError('broken second record')
        with patch('sncf_events.export.records',broken),self.assertRaises(ValueError):
            export_jsonl(self.conn,target)
        self.assertFalse(target.exists())

    def test_keyboard_interrupt_closes_run_and_retains_resume_cursor(self):
        allow_source(self.conn,'S007')
        configure_endpoint(self.conn,'region','S007','occitanie_region_events',{})
        enable_endpoint(self.conn,'region')
        class InterruptedClient:
            def __init__(self,*a,**k): pass
            def get(self,url): raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            run_endpoint(self.conn,'region',client_factory=InterruptedClient)
        row=self.conn.execute('SELECT * FROM crawl_runs').fetchone()
        self.assertEqual(row['status'],'interrupted')
        self.assertIn('next_url',json.loads(row['cursor_json']))

    def test_blank_issue_resolution_rejected(self):
        self.ingest(event())
        issue=self.scalar('SELECT id FROM review_issues LIMIT 1')
        with redirect_stdout(io.StringIO()),redirect_stderr(io.StringIO()):
            self.assertEqual(main(['--db',str(self.path),'resolve-issue',str(issue),'--resolution','  ']),2)
        self.assertIsNone(self.scalar('SELECT resolved_at FROM review_issues WHERE id=?',(issue,)))

    def test_expired_available_seats_and_old_occurrence_are_not_exported(self):
        self.ingest(event())
        entity=self.scalar('SELECT id FROM entities')
        occurrence=self.scalar('SELECT id FROM occurrences')
        snapshot=self.scalar('SELECT id FROM snapshots')
        self.conn.execute('INSERT INTO availability_confirmations(entity_id,occurrence_id,status,seats,confirmed_at,valid_until,supplier_name,evidence_url,snapshot_id) VALUES (?,?,?,?,?,?,?,?,?)',
                          (entity,occurrence,'available',30,'2026-01-01T00:00:00+00:00','2099-01-01T00:00:00+00:00','TEST ONLY','https://example.org/proof',snapshot))
        self.conn.commit()
        self.ingest(event(timings=[{'begin':'2026-12-01T10:00:00+01:00'}],updatedAt='2026-10-03T00:00:00Z'))
        self.assertEqual(list(records(self.conn))[0]['availability'],[])
