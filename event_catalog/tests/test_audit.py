import json
from unittest.mock import Mock

from sncf_events.audit_data import audit_data
from sncf_events.db import backup,dumps
from sncf_events.ingest import start_run,ingest_page,finish_run
from tests.helpers import DatabaseCase,event


class AuditTests(DatabaseCase):
    def test_duplicate_published_timings_share_projection_but_retain_raw_evidence(self):
        timing={'begin':'2026-10-10T10:00:00+02:00','end':'2026-10-10T11:00:00+02:00'}
        self.ingest(dumps({'events':[event(timings=[timing,dict(timing)])]}))
        self.assertEqual(self.scalar('SELECT count(*) FROM occurrences'),1)
        self.assertEqual(len(json.loads(self.scalar('SELECT data_json FROM observations'))['occurrences']),2)
        self.assertTrue(audit_data(self.conn)['ok'])

    def test_conflicting_duplicate_period_is_quarantined_instead_of_silently_discarded(self):
        data={'kind':'event','external_id':'TEST ONLY','title':'TEST ONLY','department_code':'31',
              'occurrences':[{'begin':'2026-10-10','status':'scheduled'},{'begin':'2026-10-10','status':'cancelled'}]}
        self.ingest(dumps({'records':[data]}),'manual')
        self.assertEqual(self.scalar('SELECT reason FROM quarantined_records'),'conflicting_duplicate_occurrence')
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),0)

    def ingest(self,body=None,connector='openagenda_events'):
        run=start_run(self.conn,'S002')
        ingest_page(self.conn,run,'S002','https://example.org/events',body or dumps({'events':[event()]}),connector)
        finish_run(self.conn,run,'complete')

    def test_real_projection_and_each_tampered_layer_detected(self):
        self.ingest()
        self.assertTrue(audit_data(self.conn)['ok'])
        self.conn.execute("UPDATE snapshots SET sha256='wrong'")
        self.conn.execute("UPDATE observations SET sha256='wrong'")
        self.conn.execute("UPDATE field_evidence SET value_json='\"wrong\"' WHERE field='title'")
        self.conn.execute("UPDATE occurrences SET status='cancelled'");self.conn.commit()
        result=audit_data(self.conn)
        self.assertFalse(result['ok'])
        self.assertEqual(len(result['hash_errors']),2)
        self.assertEqual(len(result['field_evidence_errors']),1)
        self.assertEqual(len(result['occurrence_projection_errors']),1)

    def test_jsonld_script_and_end_date_evidence(self):
        raw={'@type':'Event','name':'TEST ONLY','url':'https://example.org/e','startDate':'2026-10-10','endDate':'2026-10-11','location':{'address':{'insee':'31555'}}}
        self.ingest('<script type="application/ld+json">'+json.dumps({'@graph':[raw]})+'</script>','jsonld')
        result=audit_data(self.conn)
        self.assertTrue(result['ok'],result)
        self.assertGreater(result['checked_field_evidence'],3)

    def test_deliberately_invalid_quarantine_snapshot_not_false_alarm(self):
        run=start_run(self.conn,'S002')
        with self.assertRaises(ValueError):
            ingest_page(self.conn,run,'S002','https://example.org','bad json','openagenda_events')
        self.assertTrue(audit_data(self.conn)['ok'])

    def test_failed_backup_leaves_no_partial_destination(self):
        source=Mock();source.backup.side_effect=OSError('simulated write failure')
        target=self.path.parent/'backup.sqlite3'
        with self.assertRaises(OSError):backup(source,target)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.path.parent.glob('.backup-*')),[])
