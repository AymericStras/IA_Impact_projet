import io
import json
import os
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch

from sncf_events.cli import main
from sncf_events.credentials import NAMES, credential_environment, credential_status, read_env_file
from tests.helpers import DatabaseCase


class CredentialTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.envfile=self.path.parent/'.env'

    def test_only_literal_keys_loaded_and_existing_environment_wins(self):
        self.envfile.write_text('# comment\nDATATOURISME_API_KEY="synthetic-file"\nOPENAGENDA_PUBLIC_KEY=oa_pk_synthetic\n')
        with patch.dict(os.environ,{'DATATOURISME_API_KEY':'synthetic-env'},clear=True):
            with credential_environment(self.envfile):
                self.assertEqual(os.environ['DATATOURISME_API_KEY'],'synthetic-env')
                self.assertEqual(credential_status()['OPENAGENDA_PUBLIC_KEY'],'configured')
            self.assertNotIn('OPENAGENDA_PUBLIC_KEY',os.environ)
            self.assertEqual(os.environ['DATATOURISME_API_KEY'],'synthetic-env')

    def test_bad_config_never_exposes_value_or_executes_shell(self):
        for value in ['DATATOURISME_API_KEY=$(touch-HACK)', 'SECRET=sensitive-test-value',
                      'DATATOURISME_API_KEY="sensitive-test-value','DATATOURISME_API_KEY=a\nDATATOURISME_API_KEY=b']:
            self.envfile.write_text(value)
            with self.assertRaises(ValueError) as raised:
                read_env_file(self.envfile)
            self.assertNotIn('sensitive-test-value',str(raised.exception))
        self.envfile.write_text('X'*8193)
        with self.assertRaises(ValueError): read_env_file(self.envfile)

    def test_optional_missing_file_and_blank_keys(self):
        with patch.dict(os.environ,{},clear=True),credential_environment(self.envfile):
            self.assertEqual(set(credential_status().values()),{'missing'})
        self.envfile.write_text('DATATOURISME_API_KEY=\nOPENAGENDA_PUBLIC_KEY=\n')
        with patch.dict(os.environ,{},clear=True),credential_environment(self.envfile):
            self.assertEqual(set(credential_status().values()),{'missing'})
        with self.assertRaises(FileNotFoundError):
            with credential_environment(self.path.parent/'absent',required=True): pass

    def test_account_secret_and_header_injection_marked_invalid(self):
        with patch.dict(os.environ,{'OPENAGENDA_PUBLIC_KEY':'oa_sk_synthetic','DATATOURISME_API_KEY':'bad\nheader'},clear=True):
            self.assertEqual(credential_status()['OPENAGENDA_PUBLIC_KEY'],'requires_oa_pk_public_key')
            self.assertEqual(credential_status()['DATATOURISME_API_KEY'],'invalid_header_value')

    def test_doctor_is_read_only_no_network_and_redacts_credentials(self):
        from sncf_events.connectors import install_default_endpoints
        install_default_endpoints(self.conn)
        self.envfile.write_text('DATATOURISME_API_KEY=synthetic-do-not-print\nOPENAGENDA_PUBLIC_KEY=oa_pk_do-not-print\n')
        output=io.StringIO()
        with patch.dict(os.environ,{},clear=True),patch('socket.socket',side_effect=AssertionError('no network')),redirect_stdout(output):
            status=main(['--db',str(self.path),'--env-file',str(self.envfile),'doctor'])
        self.assertEqual(status,0)
        self.assertNotIn('do-not-print',output.getvalue())
        data=json.loads(output.getvalue())
        self.assertEqual(data['network_requests'],0)
        self.assertTrue(data['schema_matches'])
        self.assertEqual(len(data['endpoints']),6)
        self.assertTrue(all(not e['locally_configured'] for e in data['endpoints']))

    def test_doctor_reports_tampered_schema(self):
        self.conn.execute("UPDATE schema_migrations SET sha256='wrong'");self.conn.commit()
        self.envfile.write_text('')
        output=io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(main(['--db',str(self.path),'--env-file',str(self.envfile),'doctor']),2)
        self.assertFalse(json.loads(output.getvalue())['schema_matches'])
