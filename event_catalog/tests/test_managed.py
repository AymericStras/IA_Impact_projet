import base64
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sncf_events.access import authorized, create_access, generate_access, load_access
from sncf_events.managed import CGROUP, verify_limits
from sncf_events.server import App, Handler
from tests.helpers import DatabaseCase
from tests.test_local_app import Wire


class AccessTests(unittest.TestCase):
    def test_generated_credentials_validate_without_storing_plaintext(self):
        record,password = generate_access()
        header = 'Basic '+base64.b64encode(('zhaoyang:'+password).encode()).decode()
        self.assertNotIn(password,json.dumps(record))
        self.assertTrue(authorized(record,header))
        for value in ('', 'Bearer '+password,'Basic !','Basic '+base64.b64encode(('other:'+password).encode()).decode(),header+'=',None):
            self.assertFalse(authorized(record,value))

    def test_private_exclusive_credentials_and_symlink_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'access'
            result = create_access(p)
            self.assertFalse(result['secrets_printed'])
            record = load_access(p/'access.json')
            self.assertEqual(record['username'],'zhaoyang')
            with self.assertRaises(FileExistsError):create_access(p)
            os.chmod(p/'access.json',0o644)
            with self.assertRaises(ValueError):load_access(p/'access.json')
            os.chmod(p/'access.json',0o600)
            (p/'link').symlink_to(p/'access.json')
            with self.assertRaises(OSError):load_access(p/'link')


class ManagedKernelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.group = 'sys/fs/cgroup'+CGROUP+'/'
        self.write('proc/self/cgroup','0::'+CGROUP)
        self.write('proc/self/status','Uid:\t61234\t61234\t61234\t61234\nCapEff:\t0000000000000000\nNoNewPrivs:\t1\n')
        for key,value in {'memory.max':'134217728','memory.high':'100663296','memory.swap.max':'0',
                          'memory.oom.group':'1','pids.max':'32','cpu.max':'25000 100000',
                          'io.max':'259:0 rbps=1000000 wbps=1000000 riops=max wiops=max'}.items():
            self.write(self.group+key,value)

    def write(self,name,value):
        p = self.root/name
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(value)

    def verify(self):
        return verify_limits('259:0',root=self.root,platform='linux')

    def test_actual_kernel_contract_not_environment_flag(self):
        self.assertTrue(self.verify()['kernel_limits_verified'])
        with self.assertRaises(ValueError):verify_limits('259:0',root=self.root,platform='darwin')
        self.write('proc/self/cgroup','0::/user.slice/some.service')
        with self.assertRaises(ValueError):self.verify()

    def test_missing_or_unbounded_limits_fail_closed(self):
        for key,bad in [('memory.max','max'),('memory.high','134217728'),('memory.swap.max','1'),
                        ('pids.max','128'),('cpu.max','26000 100000'),('io.max','259:1 rbps=1 wbps=1'),
                        ('memory.oom.group','0')]:
            p = self.root/(self.group+key)
            good = p.read_text()
            with self.subTest(key=key):
                p.write_text(bad)
                with self.assertRaises(ValueError):self.verify()
                p.unlink()
                with self.assertRaises(OSError):self.verify()
                p.write_text(good)

    def test_root_or_capabilities_fail_closed(self):
        for status in ('Uid:\t0 0 0 0\nCapEff:\t0\nNoNewPrivs:\t1',
                       'Uid:\t61234 61234 61234 61234\nCapEff:\t1\nNoNewPrivs:\t1',
                       'Uid:\t61234 61234 61234 61234\nCapEff:\t0\nNoNewPrivs:\t0'):
            self.write('proc/self/status',status)
            with self.assertRaises(ValueError):self.verify()


class HostedHTTPTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        record,password = generate_access()
        self.header = 'Basic '+base64.b64encode(('zhaoyang:'+password).encode()).decode()
        self.app = App(self.path,readonly=True,base_path='/sncf-events/',access=record,managed=True)

    def request(self,path,auth=True,method='GET',extra=()):
        lines = [method+' '+path+' HTTP/1.1','Host: 127.0.0.1:8766','Connection: close']
        if auth:lines.append('Authorization: '+self.header)
        lines.extend(extra)
        wire = Wire(('\r\n'.join(lines)+'\r\n\r\n').encode())
        self.app.last_request = 0
        Handler(wire,('127.0.0.1',1234),SimpleNamespace(app=self.app,server_port=8766))
        headers,body = bytes(wire.output).split(b'\r\n\r\n',1)
        return int(headers.split(b' ')[1]),headers,body

    def test_every_route_requires_login_including_assets_and_health(self):
        for path in ('/sncf-events/','/sncf-events/app.js','/sncf-events/api/health',
                     '/sncf-events/api/search?from_date=2026-10-12&to_date=2026-10-12',
                     '/sncf-events/api/export.json?from_date=2026-10-12&to_date=2026-10-12'):
            status,headers,body = self.request(path,auth=False)
            self.assertEqual(status,401)
            self.assertIn(b'WWW-Authenticate: Basic',headers)
            self.assertNotIn(b'csrf',body)

    def test_authenticated_read_head_and_readonly_write(self):
        path = '/sncf-events/api/health'
        status,headers,body = self.request(path)
        self.assertEqual(status,200)
        self.assertTrue(json.loads(body)['readonly'])
        status,head_headers,head_body = self.request(path,method='HEAD')
        self.assertEqual(status,200)
        self.assertEqual(head_body,b'')
        self.assertIn(('Content-Length: '+str(len(body))).encode(),head_headers)
        self.assertEqual(self.request('/sncf-events/api/settings',method='POST')[0],403)
        self.assertEqual(self.conn.execute('SELECT enabled FROM local_settings').fetchone()[0],0)

    def test_hosted_link_navigation_still_requires_login_and_does_not_allow_cross_site_api(self):
        headers=['Sec-Fetch-Site: cross-site','Sec-Fetch-Mode: navigate','Sec-Fetch-Dest: document']
        self.assertEqual(self.request('/sncf-events/',auth=False,extra=headers)[0],401)
        self.assertEqual(self.request('/sncf-events/',extra=headers)[0],200)
        self.assertEqual(self.request('/sncf-events/api/health',extra=headers)[0],403)
        self.assertEqual(self.request('/sncf-events/',extra=['Sec-Fetch-Site: cross-site','Sec-Fetch-Mode: cors'])[0],403)

    def test_duplicate_auth_and_cross_origin_rejected(self):
        self.assertEqual(self.request('/sncf-events/',extra=['Authorization: '+self.header])[0],401)
        self.assertEqual(self.request('/sncf-events/',extra=['Origin: https://evil.example'])[0],403)

    def test_managed_mode_never_accepts_worker_or_missing_login(self):
        with self.assertRaises(ValueError):App(self.path,managed=True)
        with self.assertRaises(ValueError):App(self.path,managed=True,readonly=True)
        self.app.start_worker()
        self.assertIsNone(self.app.worker)

    def test_explicit_public_mode_reads_without_credentials_and_never_writes(self):
        self.app=App(self.path,managed=True,readonly=True,public=True,base_path='/sncf-events/')
        for path in ('','app.js','view.js','api/health','api/meta'):
            status,headers,body=self.request('/sncf-events/'+path,auth=False)
            self.assertEqual(status,200)
            self.assertNotIn(b'WWW-Authenticate',headers)
        self.assertEqual(self.request('/sncf-events/api/settings',auth=False,method='POST')[0],403)
        self.app.start_worker()
        self.assertIsNone(self.app.worker)
        with self.assertRaises(ValueError):App(self.path,public=True)
        with self.assertRaises(ValueError):App(self.path,public=True,readonly=True,managed=True,access={'unexpected':'credential'})

    def test_large_exports_are_rejected_and_head_has_no_body(self):
        from sncf_events import server
        with patch.object(server,'search',return_value={'total':1,'pages':1,'items':[{'large':'x'*(2*1024**2)}],'filters':{}}):
            status,_,body = self.request('/sncf-events/api/export.json')
        self.assertEqual(status,413)
        self.assertIn(b'narrow_filters',body)

    def test_sql_progress_deadline_interrupts_query_without_writes(self):
        def costly(conn,**kwargs):
            conn.execute('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000000) SELECT sum(x) FROM n').fetchone()
            raise AssertionError('query should have been interrupted')
        ticks = iter(range(10,10000,10))
        with patch('sncf_events.server.time.monotonic',side_effect=lambda:next(ticks)),patch('sncf_events.server.search',side_effect=costly):
            status,_,body = self.request('/sncf-events/api/search')
        self.assertEqual(status,503)
        self.assertIn(b'database_busy',body)
