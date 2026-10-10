import contextlib
import io
import unittest
from unittest.mock import patch

from sncf_events.http import Client, FetchError, MAX_BYTES, _next_request_by_host


class FakeResponse:
    def __init__(self,body=b'{}',status=200,content_type='application/json',encoding='identity'):
        self.stream=io.BytesIO(body)
        self.status=status
        self.headers={'Content-Type':content_type,'Content-Encoding':encoding}
    def read(self,size): return self.stream.read(size)
    def getheader(self,name,default=None): return self.headers.get(name,default)


class FakeConnection:
    def __init__(self,response): self.response=response;self.requests=[];self.closed=False
    def request(self,*args,**kwargs): self.requests.append((args,kwargs))
    def getresponse(self): return self.response
    def close(self): self.closed=True


class HTTPTests(unittest.TestCase):
    @contextlib.contextmanager
    def transport(self,response):
        clock=[100.0]
        connection=FakeConnection(response)
        def sleep(seconds): clock[0]+=seconds
        with patch.dict(_next_request_by_host,{},clear=True), \
             patch('sncf_events.http.PinnedHTTPS',return_value=connection) as factory, \
             patch('sncf_events.http.time.monotonic',side_effect=lambda:clock[0]), \
             patch('sncf_events.http.time.sleep',side_effect=sleep):
            yield connection,factory,clock

    def test_get_uses_header_key_not_url_and_ignores_proxy_environment(self):
        with self.transport(FakeResponse()) as (connection,factory,clock),patch.dict('os.environ',{'HTTPS_PROXY':'http://127.0.0.1:1234'}):
            client=Client('https://example.org/events',{'/events'},headers={'key':'TEST-ONLY'})
            response=client.get('https://example.org/events?limit=1')
            self.assertEqual(response.body,'{}')
            args,kwargs=connection.requests[0]
            self.assertEqual(args,('GET','/events?limit=1'))
            self.assertEqual(kwargs['headers']['key'],'TEST-ONLY')
            self.assertEqual(factory.call_args.args[0],'example.org')
            self.assertTrue(connection.closed)

    def test_redirect_denial_and_rate_limit_stop_without_retries(self):
        for status in (301,302,403,404,429,500):
            with self.subTest(status=status),self.transport(FakeResponse(status=status)) as (c,f,t):
                with self.assertRaisesRegex(FetchError,'http_'+str(status)):
                    Client('https://example.org/events',{'/events'}).get('https://example.org/events')
                self.assertEqual(len(c.requests),1)
                self.assertTrue(c.closed)

    def test_compressed_or_unexpected_type_rejected(self):
        for response in (FakeResponse(encoding='gzip'),FakeResponse(content_type='application/pdf')):
            with self.transport(response) as (c,f,t),self.assertRaises(FetchError):
                Client('https://example.org/events',{'/events'}).get('https://example.org/events')
            self.assertTrue(c.closed)

    def test_oversized_body_is_stopped_and_connection_closed(self):
        with self.transport(FakeResponse(b'x'*(MAX_BYTES+1))) as (c,f,t):
            with self.assertRaisesRegex(FetchError,'response_size_budget_exceeded'):
                Client('https://example.org/events',{'/events'}).get('https://example.org/events')
            self.assertTrue(c.closed)

    def test_invalid_utf8_is_controlled_transport_error(self):
        with self.transport(FakeResponse(b'\xff')) as (c,f,t):
            with self.assertRaisesRegex(FetchError,'transport_error'):
                Client('https://example.org/events',{'/events'}).get('https://example.org/events')
            self.assertTrue(c.closed)

    def test_request_and_time_budgets_block_before_connect(self):
        for kwargs in ({'max_requests':0},{'seconds':-1}):
            with self.transport(FakeResponse()) as (c,f,t):
                with self.assertRaisesRegex(FetchError,'run_budget_exhausted'):
                    Client('https://example.org/events',{'/events'},**kwargs).get('https://example.org/events')
                f.assert_not_called()

    def test_same_host_spacing_survives_new_client_in_same_process(self):
        with self.transport(FakeResponse()) as (c,f,t):
            Client('https://example.org/events',{'/events'}).get('https://example.org/events')
            finished=t[0]
            Client('https://example.org/events',{'/events'}).get('https://example.org/events')
            self.assertGreaterEqual(t[0]-finished,4)

    def test_slow_host_wait_cannot_exceed_next_run_deadline(self):
        with self.transport(FakeResponse()) as (c,f,t):
            Client('https://example.org/events',{'/events'}).get('https://example.org/events')
            with self.assertRaisesRegex(FetchError,'run_budget_exhausted'):
                Client('https://example.org/events',{'/events'},seconds=1).get('https://example.org/events')
            self.assertEqual(len(c.requests),1)

    def test_robots_allow_disallow_and_slow_rules(self):
        cases=[(b'User-agent: *\nAllow: /events',None),
               (b'User-agent: *\nDisallow: /events','robots_disallowed'),
               (b'User-agent: *\nCrawl-delay: 10','robots_requires_slower_schedule'),
               (b'User-agent: *\nRequest-rate: 1/10','robots_requires_slower_schedule'),
               (b'<html>captcha</html>','robots_not_plain_text')]
        for body,error in cases:
            with self.subTest(body=body),self.transport(FakeResponse(body,content_type='text/plain')):
                client=Client('https://example.org/events',{'/robots.txt','/events'})
                if error:
                    with self.assertRaisesRegex(FetchError,error): client.check_robots('https://example.org/events')
                else:
                    self.assertEqual(client.check_robots('https://example.org/events').status,200)
