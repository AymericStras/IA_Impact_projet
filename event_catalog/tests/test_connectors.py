import ipaddress
import json
import os
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from sncf_events.connectors import configure_endpoint, enable_endpoint, initial_url, next_url, run_endpoint, sanitize_payload
from sncf_events.db import dumps
from sncf_events.http import Client, FetchError, PinnedHTTPS, Response
from sncf_events.policy import require_read_permission, validate_public_url
from tests.helpers import DatabaseCase, allow_source, event


class FakeClient:
    bodies = []
    urls = []

    def __init__(self,*args,**kwargs):
        self.index = 0

    def get(self,url):
        self.urls.append(url)
        if self.index>=len(self.bodies):
            raise AssertionError('Unexpected request')
        body = self.bodies[self.index]
        self.index += 1
        if isinstance(body,Exception):
            raise body
        return Response(url,dumps(body),'application/json')


class ConnectorTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        FakeClient.urls = []
        FakeClient.bodies = []

    def setup_oa(self):
        allow_source(self.conn,'S002')
        configure_endpoint(self.conn,'oa-test','S002','openagenda_events',{'agenda_uid':123})
        enable_endpoint(self.conn,'oa-test')

    def endpoint(self):
        return self.conn.execute("SELECT * FROM endpoints WHERE id='oa-test'").fetchone()

    def run_oa(self,**kwargs):
        with patch.dict(os.environ,{'OPENAGENDA_PUBLIC_KEY':'oa_pk_synthetic_test'}):
            return run_endpoint(self.conn,'oa-test',client_factory=FakeClient,**kwargs)

    def test_no_permission_no_network(self):
        configure_endpoint(self.conn,'oa-test','S002','openagenda_events',{'agenda_uid':123})
        with self.assertRaisesRegex(ValueError,'source_disabled'):
            enable_endpoint(self.conn,'oa-test')
        self.assertEqual(FakeClient.urls,[])

    def test_reject_secret_and_legacy_openagenda_keys(self):
        self.setup_oa()
        for key in ('oa_sk_secret','legacy-key',''):
            with patch.dict(os.environ,{'OPENAGENDA_PUBLIC_KEY':key}):
                with self.assertRaisesRegex(ValueError,'public_oa_pk'):
                    run_endpoint(self.conn,'oa-test',client_factory=FakeClient)
        self.assertEqual(FakeClient.urls,[])

    def test_two_page_cursor_is_followed_without_key_in_url(self):
        self.setup_oa()
        FakeClient.bodies = [{'events':[event(1)],'after':['cursor',1]}, {'events':[event(2)],'after':None}]
        result = self.run_oa(max_pages=2)
        self.assertEqual(result['status'],'complete')
        self.assertEqual(result['pages'],2)
        self.assertIn('after%5B%5D=cursor',FakeClient.urls[1])
        self.assertTrue(all('oa_pk_' not in url for url in FakeClient.urls))

    def test_page_budget_is_partial_and_can_resume(self):
        self.setup_oa()
        FakeClient.bodies = [{'events':[event(1)],'after':['next',1]}]
        first = self.run_oa(max_pages=1)
        self.assertEqual(first['status'],'partial')
        self.assertEqual(first['failure_code'],'page_budget_reached')
        FakeClient.bodies = [{'events':[event(2)],'after':None}]
        second = self.run_oa(max_pages=1,resume=first['id'])
        self.assertEqual(second['status'],'complete')
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),2)

    def test_cursor_cycle_does_not_loop_indefinitely(self):
        self.setup_oa()
        FakeClient.bodies = [{'events':[event(1)],'after':[1]}, {'events':[event(1)],'after':[1]}]
        result = self.run_oa(max_pages=4)
        self.assertEqual(result['status'],'failed')
        self.assertEqual(len(FakeClient.urls),2)

    def test_rate_limit_ends_run_once_without_retry(self):
        self.setup_oa()
        FakeClient.bodies = [FetchError('http_429')]
        result = self.run_oa()
        self.assertEqual(result['failure_code'],'http_429')
        self.assertEqual(len(FakeClient.urls),1)
        self.assertEqual(self.scalar("SELECT count(*) FROM crawl_runs WHERE status='running'"),0)

    def test_missing_pagination_is_not_reported_complete(self):
        self.setup_oa()
        FakeClient.bodies = [{'events':[event()]}]
        result = self.run_oa()
        self.assertEqual(result['status'],'failed')
        self.assertEqual(self.scalar('SELECT count(*) FROM snapshots'),1)

    def test_malformed_envelope_preserves_evidence(self):
        self.setup_oa()
        FakeClient.bodies = [{'unexpected':'shape','after':None}]
        result = self.run_oa()
        self.assertEqual(result['status'],'failed')
        self.assertEqual(self.scalar('SELECT count(*) FROM snapshots'),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM quarantined_records'),1)

    def test_bad_records_mean_partial_result(self):
        self.setup_oa()
        FakeClient.bodies = [{'events':[event(location={})],'after':None}]
        result = self.run_oa()
        self.assertEqual(result['status'],'partial')
        self.assertEqual(result['quarantined'],1)

    def test_changed_endpoint_config_cannot_resume_old_cursor(self):
        self.setup_oa()
        FakeClient.bodies = [{'events':[event()],'after':[1]}]
        first = self.run_oa(max_pages=1)
        configure_endpoint(self.conn,'oa-test','S002','openagenda_events',{'agenda_uid':456})
        enable_endpoint(self.conn,'oa-test')
        with self.assertRaisesRegex(ValueError,'config_changed'):
            self.run_oa(resume=first['id'])

    def test_datatourisme_fields_include_dates_and_admin_codes(self):
        configure_endpoint(self.conn,'dt','S001','datatourisme_events',{})
        endpoint = self.conn.execute("SELECT * FROM endpoints WHERE id='dt'").fetchone()
        url = initial_url(endpoint)
        query = parse_qs(urlsplit(url).query)
        self.assertIn('takesPlaceAt',query['fields'][0])
        self.assertIn('09,11,12,30,31,32,34,46,48,65,66,81,82',query['filters'][0])
        target = next_url(endpoint,url,{'meta':{'next':'http://api.datatourisme.fr/v1/catalog?filters=type%3DEntertainmentAndEvent&page=2&api_key=secret'}})
        self.assertTrue(target.startswith('https://'))
        self.assertNotIn('api_key',target)
        with self.assertRaisesRegex(ValueError,'scope'):
            next_url(endpoint,url,{'meta':{'next':'https://evil.example/steal?api_key=secret'}})

    def test_credentials_are_removed_from_saved_response(self):
        body = '{"objects":[],"meta":{"next":"https://api.datatourisme.fr/v1/catalog?api_key=SECRET&page=2"}}'
        clean = sanitize_payload(body,'SECRET')
        self.assertNotIn('SECRET',clean)
        self.assertNotIn('api_key',clean)

    def test_agenda_discovery_is_not_event_ingestion(self):
        allow_source(self.conn,'S002')
        configure_endpoint(self.conn,'oa-test','S002','openagenda_agendas',{'search':'science'})
        enable_endpoint(self.conn,'oa-test')
        FakeClient.bodies = [{'agendas':[{'uid':123,'title':'TEST national science','slug':'test'}],'after':None}]
        self.assertEqual(self.run_oa()['status'],'complete')
        self.assertEqual(self.scalar('SELECT count(*) FROM discovered_agendas'),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM entities'),0)


class NetworkPolicyTests(DatabaseCase):
    def test_private_urls_credentials_and_traversal_rejected(self):
        urls = ['http://127.0.0.1/private','https://localhost','file:///etc/passwd',
                'https://192.168.1.1/','https://user:pass@example.org/',
                'https://example.org/%252e%252e/private','https://example.org/?api_key=secret',
                'https://169.254.169.254/latest/meta-data']
        for url in urls:
            with self.subTest(url=url),self.assertRaises(ValueError):
                validate_public_url(url)

    def test_scope_check_precedes_request(self):
        client = Client('https://example.org/events',{'/events'})
        with self.assertRaises(FetchError):
            client.get('https://another.example/events')
        with self.assertRaises(FetchError):
            client.get('https://example.org/admin')

    def test_dns_rebinding_target_is_rejected_before_connect(self):
        conn = PinnedHTTPS('example.org')
        answers = [(2,1,6,'',('127.0.0.1',443))]
        with patch('socket.getaddrinfo',return_value=answers),patch('socket.socket') as socket:
            with self.assertRaises(FetchError):
                conn.connect()
            socket.assert_not_called()

    def test_expired_permission_is_blocked(self):
        allow_source(self.conn,'S002')
        self.conn.execute("UPDATE source_reviews SET expires_at='2000-01-01T00:00:00+00:00'")
        self.conn.commit()
        with self.assertRaisesRegex(ValueError,'expired'):
            require_read_permission(self.conn,'S002')
