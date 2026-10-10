import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


preflight, gateway = module('preflight'), module('gateway')


class PreflightTests(unittest.TestCase):
    def test_port_ownership_checks_each_listener(self):
        listeners = 'LISTEN 0 128 127.0.0.1:33450 0.0.0.0:*\nLISTEN 0 128 127.0.0.1:33451 0.0.0.0:*\n'
        labels = {'com.docker.compose.project': 'sncf-chatbot', 'com.docker.compose.service': 'web'}
        bindings = {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '33450'}]}
        details = json.dumps(labels) + '\t' + json.dumps(bindings) + '\n'
        run = Mock(side_effect=[subprocess.CompletedProcess([], 0, s) for s in (listeners, 'abc\n', details)])
        self.assertEqual(preflight.occupied_ports([33450, 33451], run), ['port_in_use:33451'])

    def check(self, value, code=0):
        run = Mock(return_value=subprocess.CompletedProcess([], code, json.dumps(value), ''))
        result = preflight.guard_result(run, lambda _: '/usr/local/bin/host-guard')
        self.assertIn('768', run.call_args.args[0])
        return result

    def test_explicit_full_allow_required(self):
        value = {'allowed': True, 'reasons': [], 'request': {'memory_bytes': 768 * 1024**2}}
        self.assertTrue(self.check(value)['allowed'])
        self.assertFalse(self.check(value, 1)['allowed'])
        for change in ({'allowed': False}, {'allowed': 'true'}, {'reasons': ['health_warmup']},
                       {'reasons': ['sandbox_unverified']}, {'request': {'memory_bytes': 256 * 1024**2}}):
            with self.subTest(change=change):
                self.assertFalse(self.check(value | change)['allowed'])

    def test_missing_unparseable_or_timed_out_guard_refuses(self):
        self.assertFalse(preflight.guard_result(which=lambda _: None)['allowed'])
        for run in (Mock(return_value=subprocess.CompletedProcess([], 0, 'broken', '')),
                    Mock(side_effect=subprocess.TimeoutExpired('host-guard', 30)),
                    Mock(side_effect=FileNotFoundError())):
            self.assertFalse(preflight.guard_result(run, lambda _: 'host-guard')['allowed'])
        for value in (None, [], {}, {'allowed': True, 'reasons': None}):
            self.assertFalse(self.check(value)['allowed'])


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.original = 'events {}\nhttp {\nserver {\nserver_name zhaoyang.fr;\n}\n}\n'
        self.block = Path(__file__).with_name('gateway-sncf-chatbot.conf').read_text()
        self.block = self.block.replace('__WEB_PORT__', '33450').replace('__API_PORT__', '33451')

    def test_block_survives_separate_encoded_argument(self):
        encoded = base64.b64encode(self.block.encode()).decode()
        rendered = gateway.render(self.original, base64.b64decode(encoded).decode())
        self.assertIn('proxy_set_header Host $host;', rendered)
        self.assertIn('proxy_pass http://127.0.0.1:33451/api/;', rendered)
        self.assertEqual(gateway.render(rendered, self.block), rendered)
        self.assertEqual(gateway.render(rendered, '', remove=True), self.original)

    def test_empty_ambiguous_and_malformed_blocks_refused(self):
        for text, block in ((self.original, ''), (self.original + self.original, self.block),
                            (self.original + gateway.BEGIN, self.block),
                            (self.original + self.block * 2, self.block)):
            with self.subTest(text=text), self.assertRaises(ValueError):
                gateway.render(text, block)

    def test_add_and_remove_preserve_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'nginx.conf'
            p.write_text(self.original)
            inode = p.stat().st_ino
            run = Mock()
            gateway.update(p, 'gateway', self.block, run=run)
            self.assertEqual(p.stat().st_ino, inode)
            self.assertIn(gateway.BEGIN, p.read_text())
            gateway.update(p, 'gateway', '', remove=True, run=run)
            self.assertEqual(p.read_text(), self.original)
            self.assertEqual(p.stat().st_ino, inode)

    def test_invalid_removal_restores_config_and_raises(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'nginx.conf'
            before = gateway.render(self.original, self.block)
            p.write_text(before)
            run = Mock(side_effect=[subprocess.CalledProcessError(1, 'nginx'), None, None])
            with self.assertRaisesRegex(RuntimeError, 'original_restored'):
                gateway.update(p, 'gateway', '', remove=True, run=run)
            self.assertEqual(p.read_text(), before)

    def test_reload_timeout_restores_disk_and_requests_old_runtime_config(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'nginx.conf'
            p.write_text(self.original)
            run = Mock(side_effect=[None, subprocess.TimeoutExpired('nginx', 10), None, None])
            with self.assertRaisesRegex(RuntimeError, 'original_restored'):
                gateway.update(p, 'gateway', self.block, run=run)
            self.assertEqual(p.read_text(), self.original)
            self.assertEqual(run.call_count, 4)


if __name__ == '__main__':
    unittest.main()
