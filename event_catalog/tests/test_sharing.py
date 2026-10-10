import csv
import hashlib
import json
from pathlib import Path
import re
import sqlite3

from sncf_events.db import ROOT, dumps
from sncf_events.ingest import finish_run, ingest_page, start_run
from sncf_events.language import french_title
from sncf_events.share import SCHEMA, csv_value, write_package
from tests.helpers import DatabaseCase, allow_source, event


class SharingTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        allow_source(self.conn,'S002',reuse=False,description=False)
        run=start_run(self.conn,'S002')
        ingest_page(self.conn,run,'S002','https://api.openagenda.com/v2/agendas/1/events',
                    dumps({'events':[event(title={'fr':'=TEST ONLY'},location={
                        'insee':'09122','city':'Foix','latitude':42.96,'longitude':1.60})]}),'openagenda_events')
        finish_run(self.conn,run,'complete')

    def test_exchange_preserves_facts_relations_and_reuse_flags_without_raw_payloads(self):
        dest=self.path.parent/'shared'
        before=self.conn.execute('SELECT data_json FROM observations').fetchone()[0]
        result=write_package(self.conn,dest)
        self.assertEqual(result['record_counts']['activities'],1)
        with sqlite3.connect(dest/'catalogue.sqlite3') as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
            self.assertEqual(db.execute('SELECT title,department_code,description FROM activities').fetchone(),('=TEST ONLY','09',None))
            self.assertEqual(db.execute("SELECT facts_reuse_allowed FROM sources WHERE id='S002'").fetchone()[0],0)
            self.assertEqual(db.execute('SELECT start_at,timezone FROM occurrences').fetchone(),('2026-10-12T08:00:00+00:00','Europe/Paris'))
            self.assertEqual(db.execute("SELECT count(*) FROM sqlite_master WHERE name IN ('snapshots','field_evidence','source_reviews')").fetchone()[0],0)
        self.assertEqual(self.conn.execute('SELECT data_json FROM observations').fetchone()[0],before)
        for name,item in result['files'].items():
            self.assertEqual(hashlib.sha256((dest/name).read_bytes()).hexdigest(),item['sha256'])
        for table in SCHEMA:
            with (dest/'csv'/(table+'.csv')).open(encoding='utf-8-sig',newline='') as stream:
                rows=list(csv.DictReader(stream))
            self.assertEqual(len(rows),result['record_counts'][table])
            if table=='activities':
                self.assertEqual(rows[0]['title'],"'=TEST ONLY")
                self.assertEqual(rows[0]['department_code'],'09')
        with self.assertRaises(FileExistsError):write_package(self.conn,dest)

    def test_formula_defence_keeps_numeric_longitude_and_unknown_values(self):
        self.assertEqual(csv_value(-1.2),-1.2)
        self.assertEqual(csv_value(None),'')
        for v in ['=1+2','+cmd','-cmd','@SUM(1)',' \t=1']:
            self.assertTrue(csv_value(v).startswith("'"))
        self.assertEqual(csv_value('09'),'09')

    def test_delivered_interface_registry_and_source_are_english_or_french(self):
        paths=[ROOT/'data/seeds/sources-2026-10-10.json',*list((ROOT/'sncf_events/web').glob('*'))]
        for p in paths:
            self.assertIsNone(re.search(r'[\u3400-\u9fff]',p.read_text()),str(p))
        self.assertEqual(french_title('Exposition&nbsp;: \u6728\u3068\u98a8 Bois et Vent'),'Exposition\xa0: Bois et Vent')

