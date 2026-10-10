import json
import sqlite3

from sncf_events.db import ROOT, backup, connect, import_registry, migrate, report, writer_lock
from sncf_events.connectors import install_default_endpoints
from tests.helpers import DatabaseCase, allow_source


class RegistryTests(DatabaseCase):
    def test_standalone_bootstrap_matches_current_migrations(self):
        fresh = connect(self.path.parent/'bootstrap.sqlite3')
        self.addCleanup(fresh.close)
        sql = '\n'.join(line for line in (ROOT/'database/bootstrap.sql').read_text().splitlines() if not line.startswith('.'))
        fresh.executescript(sql)
        migrate(fresh)
        self.assertEqual(fresh.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(fresh.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(fresh.execute('SELECT count(*) FROM sources').fetchone()[0],144)
        self.assertEqual(fresh.execute('SELECT count(*) FROM endpoints').fetchone()[0],6)
        self.assertEqual(fresh.execute('SELECT sum(enabled) FROM endpoints').fetchone()[0],0)

    def test_seed_preserves_all_144_sources_without_inventing_events(self):
        stats = report(self.conn)['counts']
        self.assertEqual(stats['sources'],144)
        self.assertEqual(stats['enabled_sources'],0)
        self.assertEqual(stats['entities'],0)
        self.assertEqual(self.scalar('SELECT count(*) FROM departments'),13)

    def test_multi_department_source_and_domain_aliases(self):
        deps = [r[0] for r in self.conn.execute("SELECT department_code FROM source_departments WHERE source_id='S068' ORDER BY department_code")]
        self.assertEqual(deps,['12','48'])
        self.assertEqual(self.scalar('SELECT count(*) FROM source_aliases'),5)
        self.assertEqual(self.scalar("SELECT url FROM source_aliases WHERE source_id='S014'"),'https://www.echosciences-sud.fr/')

    def test_national_sources_do_not_inflate_local_coverage(self):
        self.assertEqual(self.scalar("SELECT count(*) FROM source_departments WHERE source_id='S001'"),0)
        self.assertTrue(all(r['registered_local_sources']>=2 for r in report(self.conn)['department_coverage']))

    def test_reimport_is_idempotent_and_keeps_operational_review(self):
        allow_source(self.conn,'S001')
        result = import_registry(self.conn,self.seed)
        self.assertEqual(result['imported'],0)
        self.assertEqual(self.scalar("SELECT enabled FROM sources WHERE id='S001'"),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM source_reviews'),1)

    def test_changed_research_notes_preserve_runtime_state(self):
        allow_source(self.conn,'S001')
        seed = json.loads(self.seed.read_text())
        seed['records'][0]['notes'] += ' updated research'
        path = self.path.parent/'changed.json'
        path.write_text(json.dumps(seed))
        import_registry(self.conn,path)
        self.assertEqual(self.scalar("SELECT enabled FROM sources WHERE id='S001'"),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM registry_imports'),2)

    def test_invalid_registry_import_is_atomic(self):
        doc = json.loads(self.seed.read_text())
        doc['records'][1]['source_id'] = doc['records'][0]['source_id']
        file = self.path.parent/'invalid.json'
        file.write_text(json.dumps(doc))
        with self.assertRaises(ValueError):
            import_registry(self.conn,file)
        self.assertEqual(self.scalar('SELECT count(*) FROM registry_imports'),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM sources'),144)

    def test_seed_cannot_enable_sources(self):
        doc = json.loads(self.seed.read_text())
        doc['records'][0]['enabled'] = True
        file = self.path.parent/'enabled.json'
        file.write_text(json.dumps(doc))
        with self.assertRaises(ValueError):
            import_registry(self.conn,file)

    def test_migrations_are_repeatable_and_foreign_keys_active(self):
        migrate(self.conn)
        self.assertEqual(self.scalar('SELECT count(*) FROM schema_migrations'),7)
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("INSERT INTO source_aliases VALUES ('missing','https://example.org')")
        self.conn.rollback()
        self.assertEqual(self.scalar('PRAGMA integrity_check'),'ok')

    def test_migration_tampering_is_rejected(self):
        self.conn.execute("UPDATE schema_migrations SET sha256='wrong'")
        self.conn.commit()
        with self.assertRaises(ValueError):
            migrate(self.conn)

    def test_backup_does_not_overwrite_and_can_be_restored(self):
        target = self.path.parent/'backup.sqlite3'
        backup(self.conn,target)
        with sqlite3.connect(target) as restored:
            self.assertEqual(restored.execute('SELECT count(*) FROM sources').fetchone()[0],144)
            self.assertEqual(restored.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        with self.assertRaises(FileExistsError):
            backup(self.conn,target)

    def test_writer_mutex_refuses_concurrent_writer(self):
        with writer_lock(self.path):
            with self.assertRaises(ValueError):
                with writer_lock(self.path):
                    pass

    def test_default_endpoints_stay_disabled_and_are_idempotent(self):
        install_default_endpoints(self.conn)
        install_default_endpoints(self.conn)
        self.assertEqual(self.scalar('SELECT count(*) FROM endpoints'),6)
        self.assertEqual(self.scalar('SELECT sum(enabled) FROM endpoints'),0)
