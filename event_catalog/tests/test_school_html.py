import json
from unittest.mock import patch

from sncf_events.audit_data import audit_data
from sncf_events.connectors import configure_endpoint,enable_endpoint,initial_url,run_endpoint
from sncf_events.db import connect,migrate
from sncf_events.export import records
from sncf_events.html_rules import FABRE_URL,fabre_offers,html_blocks,html_evidence
from sncf_events.http import Response
from sncf_events.ingest import ingest_page,start_run,finish_run
from tests.helpers import DatabaseCase,allow_source


def page():
    # Fixture descriptions and offer names are entirely synthetic.
    return '''<h1>TEST ONLY</h1><h2><p>Offre à destination des publics scolaires</p></h2>
      <h3>Exposition : Le design selon Pierre Paulin</h3>
      <p><p><u>Maternelles</u></p><p>Visite guidée</p>
      <p><strong>TEST ONLY A &amp; B</strong></p><p>TEST ONLY description.</p>
      <p>RENDEZ-VOUS ENSEIGNANTS</p><p>TEST ONLY teachers meeting</p><p>Mercredi 16 septembre à 14h00</p></p>
      <h2><p>Offre à destination des publics scolaires</p></h2>
      <h3>Exposition : Chine, Chefs d'oeuvre du musée Guimet</h3>
      <p>TEST ONLY: l'hôtel de Cabrières Sabatier D'Espeyran</p>
      <p>Cycle 1 (Maternelles)</p><p><em>→ TEST ONLY C</em></p><p>TEST ONLY other description.</p>
      <p>∗ Durée : 1h15</p><p>RENDEZ-VOUS ENSEIGNANTS</p><p>TEST ONLY</p>
      <h2>Musée Fabre</h2><p>Boulevard Bonne Nouvelle<br>34000 Montpellier - France</p>
      <h2>Hôtel Sabatier</h2><p>6 bis rue Montpelliéret<br>34000 Montpellier - France</p>
      <p>Pour toute visite libre ou guidée, merci d'envoyer le formulaire de réservation.</p>'''


class SchoolHtmlTests(DatabaseCase):
    def ingest(self,body=None):
        run=start_run(self.conn,'S097')
        try:
            result=ingest_page(self.conn,run,'S097',FABRE_URL,body or page(),'fabre_school_offers')
        except ValueError:
            finish_run(self.conn,run,'failed','invalid_page_envelope')
            raise
        finish_run(self.conn,run,'complete')
        return result

    def test_realistic_nested_html_preserves_grades_duration_and_distinct_buildings(self):
        self.assertEqual(self.ingest()['accepted'],2)
        rows=sorted(records(self.conn),key=lambda r:r['title'])
        self.assertEqual([r['location_name'] for r in rows],['Musée Fabre','Hôtel Sabatier'])
        self.assertEqual(rows[0]['title'],'TEST ONLY A & B')
        self.assertEqual(rows[1]['school_conditions']['duration_minutes'],75)
        self.assertEqual(rows[0]['school_conditions']['grade_levels'],['Maternelles'])
        self.assertIsNone(rows[0]['school_conditions']['duration_minutes'])
        self.assertTrue(all(r['kind']=='educational_offer' and r['occurrences']==[] for r in rows))
        self.assertTrue(all(r['school_conditions']['school_groups']=='confirmed' for r in rows))
        self.assertTrue(all(r['school_conditions']['max_group'] is None and r['availability']==[] for r in rows))
        self.assertTrue(all('offer_validity_unconfirmed' in r['unresolved_issues'] for r in rows))
        self.assertTrue(audit_data(self.conn)['ok'])

    def test_hidden_scripts_forms_and_teachers_are_not_student_offers(self):
        hidden='<p>Maternelles</p><p>FAKE TITLE</p><p>FAKE DESCRIPTION</p>'
        body=page()+''.join('<'+tag+'>'+hidden+'</'+tag+'>' for tag in ['script','style','template','form'])
        body+='<div hidden>'+hidden+'</div><div style="display:none">'+hidden+'</div>'
        self.assertEqual(self.ingest(body)['accepted'],2)
        self.assertNotIn('FAKE',str(html_blocks(body)))
        self.assertEqual(self.scalar('SELECT count(*) FROM occurrences'),0)

    def test_changed_or_empty_structure_fails_instead_of_clearing_current_data(self):
        self.ingest()
        for body in ['<html>unrelated page</html>',page().replace('34000 Montpellier - France','unknown'),
                     page().replace('Le design selon Pierre Paulin','TEST NEW EXHIBITION'),
                     page().replace('formulaire de réservation','unrelated'),
                     page().replace("l'hôtel de Cabrières Sabatier D'Espeyran",'another venue')]:
            with self.subTest(body=body[:20]),self.assertRaises(ValueError):self.ingest(body)
        self.assertEqual(self.scalar('SELECT count(*) FROM educational_offers'),2)
        self.assertEqual(self.scalar('SELECT count(*) FROM quarantined_records'),5)

    def test_bad_duration_and_unknown_source_are_rejected(self):
        with self.assertRaises(ValueError):list(fabre_offers(page(),'S015'))
        with self.assertRaises(ValueError):list(fabre_offers(page().replace('1h15','1h99'),'S097'))

    def test_page_reparse_is_entity_idempotent_and_keeps_provenance(self):
        self.ingest();self.ingest()
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),2)
        self.assertEqual(self.scalar('SELECT count(*) FROM observations'),4)
        self.assertEqual(self.scalar("SELECT count(*) FROM field_evidence WHERE method<>'html_rule'"),0)
        self.assertTrue(audit_data(self.conn)['ok'])

    def test_html_evidence_tampering_is_detected(self):
        self.ingest()
        self.conn.execute("UPDATE field_evidence SET value_json='\"changed\"' WHERE field='school.duration_minutes'")
        self.conn.commit()
        result=audit_data(self.conn)
        self.assertFalse(result['ok'])
        self.assertEqual(len(result['field_evidence_errors']),1)

    def test_invalid_html_locators_and_parser_budgets_fail(self):
        blocks=html_blocks('<p>TEST</p>')
        for loc in ['other','html-range[1:0]','html-range[0:9]','html-block[2]']:
            with self.assertRaises((ValueError,IndexError)):html_evidence(blocks,loc)
        with self.assertRaises(ValueError):html_blocks('<div>'*257)

    def test_offers_are_internal_until_source_reuse_review_and_not_date_matched(self):
        allow_source(self.conn,'S097',reuse=False)
        self.ingest()
        self.assertEqual(list(records(self.conn,public=True)),[])
        self.assertEqual(list(records(self.conn,from_date='2026-10-10')),[])

    def test_connector_fixed_scope_robots_and_single_page(self):
        allow_source(self.conn,'S097',reuse=False)
        for sid,config in [('S015',{}),('S097',{'url':'https://www.museefabre.fr/other'}),('S097',{'search':'x'})]:
            with self.assertRaises(ValueError):configure_endpoint(self.conn,'bad',sid,'fabre_school_offers',config)
        configure_endpoint(self.conn,'school','S097','fabre_school_offers',{})
        enable_endpoint(self.conn,'school')
        endpoint=self.conn.execute("SELECT * FROM endpoints WHERE id='school'").fetchone()
        self.assertEqual(initial_url(endpoint),FABRE_URL)
        calls=[]
        class FakeClient:
            def __init__(self,url,paths,**kwargs):pass
            def check_robots(self,url):
                calls.append('robots')
                return Response('https://www.museefabre.fr/robots.txt','User-agent: *\nAllow: /','text/plain')
            def get(self,url):
                calls.append(url)
                return Response(url,page(),'text/html')
        result=run_endpoint(self.conn,'school',max_pages=3,client_factory=FakeClient)
        self.assertEqual(result['status'],'complete')
        self.assertEqual(calls,['robots',FABRE_URL])
        self.assertEqual(self.scalar('SELECT count(*) FROM snapshots'),2)

    def test_upgrade_keeps_existing_evidence_and_run_foreign_keys(self):
        old=connect(self.path.parent/'v02.sqlite3');self.addCleanup(old.close)
        from sncf_events import db
        original=db.Path.glob
        with patch.object(db.Path,'glob',lambda p,pattern:[f for f in original(p,pattern) if not f.name.startswith('004_')]):
            migrate(old)
        from sncf_events.db import import_registry
        from tests.helpers import event
        import_registry(old,self.seed)
        configure_endpoint(old,'prior','S002','openagenda_events',{'agenda_uid':1})
        run=start_run(old,'S002','prior')
        ingest_page(old,run,'S002','https://example.org',json.dumps({'events':[event()]}),'openagenda_events')
        finish_run(old,run,'complete')
        count=old.execute('SELECT count(*) FROM field_evidence').fetchone()[0]
        migrate(old)
        self.assertEqual(old.execute('SELECT count(*) FROM field_evidence').fetchone()[0],count)
        self.assertEqual(old.execute('SELECT endpoint_id FROM crawl_runs WHERE id=?',(run,)).fetchone()[0],'prior')
        self.assertEqual(old.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertTrue(audit_data(old)['ok'])
