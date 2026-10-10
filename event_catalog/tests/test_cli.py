import io
import json
import os
import sqlite3
import runpy
import tomllib
from contextlib import closing, redirect_stdout, redirect_stderr
from unittest.mock import patch

from sncf_events.cli import main
from sncf_events.db import ROOT,dumps
from sncf_events.ingest import start_run
from tests.helpers import DatabaseCase, allow_source, event
from tests.test_connectors import FakeClient


class CLITests(DatabaseCase):
    def test_python_module_entrypoint_and_package_version_match(self):
        output=io.StringIO()
        with patch('sys.argv',['sncf_events','--version']),redirect_stdout(output),self.assertRaises(SystemExit) as ended:
            runpy.run_module('sncf_events',run_name='__main__')
        self.assertEqual(ended.exception.code,0)
        self.assertEqual(output.getvalue().strip(),tomllib.loads((ROOT/'pyproject.toml').read_text())['project']['version'])

    def setUp(self):
        super().setUp()
        self.envfile=self.path.parent/'test.env'
        self.envfile.write_text('OPENAGENDA_PUBLIC_KEY=oa_pk_synthetic_cli\n')

    def cli(self,*args,expected=0,db=None):
        out,err=io.StringIO(),io.StringIO()
        with patch.dict(os.environ,{},clear=True),redirect_stdout(out),redirect_stderr(err):
            status=main(['--db',str(db or self.path),'--env-file',str(self.envfile),*map(str,args)])
        self.assertEqual(status,expected,err.getvalue() or out.getvalue())
        return json.loads((err if expected and err.getvalue() else out).getvalue())

    def fixture(self):
        path=self.path.parent/'event.json'
        path.write_text(dumps({'events':[event()]}))
        return self.cli('ingest-file','S002',path,'--format','openagenda_events','--evidence-url','https://api.openagenda.com/v2/agendas/1/events')

    def test_new_init_repeated_init_migrate_import_and_check(self):
        fresh=self.path.parent/'fresh.sqlite3'
        self.assertEqual(self.cli('init',db=fresh)['imported'],144)
        self.assertEqual(self.cli('init',db=fresh)['imported'],0)
        self.assertTrue(self.cli('migrate',db=fresh)['migrated'])
        self.assertEqual(self.cli('import-sources',self.seed,db=fresh)['imported'],0)
        self.assertTrue(self.cli('check',db=fresh)['ok'])
        self.assertEqual(len(self.cli('endpoints',db=fresh)),6)

    def test_missing_database_does_not_create_file(self):
        missing=self.path.parent/'missing.sqlite3'
        self.assertIn('database_not_initialized',self.cli('check',db=missing,expected=2)['error'])
        self.assertFalse(missing.exists())

    def test_viewer_access_prints_no_password_and_needs_no_database(self):
        target = self.path.parent/'viewer-access'
        result = self.cli('viewer-access',target,db=self.path.parent/'absent.sqlite3')
        self.assertFalse(result['secrets_printed'])
        self.assertNotIn('Password:',json.dumps(result))
        self.assertTrue((target/'login.txt').is_file())
        self.cli('viewer-access',target,expected=2)

    def test_source_and_read_only_listing_commands(self):
        self.assertEqual(len(self.cli('sources')),144)
        self.assertEqual(len(self.cli('sources','--priority','P0')),20)
        self.assertTrue(self.cli('sources','--department','09'))
        self.assertEqual(self.cli('report')['counts']['events'],0)
        for command in ('issues','quarantine','runs','agendas','duplicates'):
            self.assertEqual(self.cli(command),[])
            self.assertIn('limit',self.cli(command,'--limit',0,expected=2)['error'])

    def test_local_ingest_query_export_and_backup_round_trip(self):
        self.fixture()
        self.assertEqual(len(self.cli('records','--kind','event','--department','31')),1)
        self.assertEqual(self.cli('records','--public'),[])
        allow_source(self.conn,'S002')
        exported=self.path.parent/'public.jsonl'
        self.assertEqual(self.cli('export',exported,'--public')['exported'],1)
        self.assertEqual(json.loads(exported.read_text())['school_conditions']['languages'],[])
        self.cli('export',exported,expected=2)
        backup=self.path.parent/'saved.sqlite3';self.cli('backup',backup)
        with closing(sqlite3.connect(backup)) as restored:
            self.assertEqual(restored.execute('SELECT count(*) FROM events').fetchone()[0],1)
        self.cli('backup',backup,expected=2)

    def test_review_enable_configure_plan_and_disable(self):
        allow_source(self.conn,'S002')
        review=dict(self.conn.execute('SELECT * FROM source_reviews').fetchone())
        for key in ('id','source_id','reviewed_at'): review.pop(key)
        for key in ('read_allowed','facts_reuse_allowed','description_reuse_allowed'): review[key]=bool(review[key])
        file=self.path.parent/'review.json';file.write_text(dumps(review))
        self.cli('review-source','S002',file)
        self.cli('enable-source','S002')
        self.cli('configure-endpoint','oa-cli','S002','openagenda_events','--config','{"agenda_uid":123}')
        self.cli('enable-endpoint','oa-cli')
        self.assertTrue(self.cli('plan','oa-cli')['enabled'])
        self.cli('disable-source','S002')
        self.cli('enable-endpoint','oa-cli',expected=2)

    def test_sync_through_cli_with_fake_transport_and_partial_exit(self):
        self.cli('init');self.cli('enable-source','S007',expected=2)
        allow_source(self.conn,'S007')
        self.cli('enable-endpoint','occitanie-region')
        from tests.test_region import region_row
        from sncf_events.connectors import run_endpoint
        FakeClient.urls=[]
        FakeClient.bodies=[{'total_count':51,'results':[region_row(i) for i in range(50)]}]
        with patch('sncf_events.cli.run_endpoint',side_effect=lambda *a,**k:run_endpoint(*a,client_factory=FakeClient,**k)):
            result=self.cli('sync','occitanie-region','--max-pages',1,expected=2)
        self.assertEqual(result['status'],'partial')
        self.assertEqual(result['accepted'],50)

    def test_interrupted_run_issue_resolution_and_observation_selection(self):
        self.fixture()
        run=start_run(self.conn,'S002')
        self.assertEqual(self.cli('close-interrupted-run',run)['closed'],run)
        self.cli('close-interrupted-run',run,expected=2)
        issue=self.scalar('SELECT id FROM review_issues LIMIT 1')
        self.cli('resolve-issue',issue,'--resolution','TEST ONLY reviewed')
        self.cli('resolve-issue',issue,'--resolution','already resolved',expected=2)
        entity=self.scalar('SELECT id FROM entities');oid=self.scalar('SELECT id FROM observations')
        self.cli('select-observation',entity,oid,'--reason','TEST ONLY review')
        self.cli('select-observation',entity,oid+999,'--reason','TEST ONLY invalid',expected=2)
        self.cli('select-observation',entity,oid,'--reason',' ',expected=2)

    def test_invalid_file_and_retry_are_controlled_errors(self):
        self.cli('ingest-file','S002',self.path.parent/'missing','--format','openagenda_events','--evidence-url','https://example.org',expected=2)
        self.cli('retry-quarantine',999,'--format','openagenda_events',expected=2)
