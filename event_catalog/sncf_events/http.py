"""Bounded, sequential GETs to reviewed public HTTPS endpoints, no redirects."""
from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import time
from dataclasses import dataclass
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from .policy import validate_public_url
from . import __version__

MAX_BYTES = 2 * 1024 * 1024
USER_AGENT = 'OccitanieEducationSources/'+__version__
_next_request_by_host = {}


class FetchError(ValueError):
    pass


@dataclass
class Response:
    url: str
    body: str
    content_type: str
    status: int = 200


class PinnedHTTPS(http.client.HTTPSConnection):
    def connect(self):
        # Resolve once, validate every answer, and connect to that exact address.
        # TLS still authenticates the original hostname; proxy env is not used.
        answers = socket.getaddrinfo(self.host, 443, type=socket.SOCK_STREAM)
        if not answers or any(not ipaddress.ip_address(a[4][0]).is_global for a in answers):
            raise FetchError('non_public_dns_answer')
        family, kind, proto, _, address = answers[0]
        sock = socket.socket(family, kind, proto)
        try:
            sock.settimeout(self.timeout)
            sock.connect(address)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise


class Client:
    def __init__(self, origin_url, allowed_paths, *, headers=None, seconds=60, max_requests=10, interval=4.0):
        p = validate_public_url(origin_url, https_only=True)
        self.host = p.hostname
        self.paths = set(allowed_paths)
        self.headers = headers or {}
        self.deadline = time.monotonic() + min(seconds,120)
        self.remaining = min(max_requests,20)
        self.interval = min(4.0,max(1.0,interval))
        self.next_at = 0.0
        self.byte_count = 0

    def get(self, url):
        p = validate_public_url(url, https_only=True)
        if p.hostname != self.host or p.path not in self.paths or p.port not in (None,443):
            raise FetchError('out_of_scope_url')
        if self.remaining<=0 or time.monotonic()>=self.deadline:
            raise FetchError('run_budget_exhausted')
        delay = max(0,max(self.next_at,_next_request_by_host.get(self.host,0))-time.monotonic())
        if time.monotonic()+delay>=self.deadline:
            raise FetchError('run_budget_exhausted')
        time.sleep(delay)
        self.remaining -= 1
        connection = PinnedHTTPS(self.host, timeout=min(10,max(0.1,self.deadline-time.monotonic())),
                                 context=ssl.create_default_context())
        try:
            connection.request('GET', p.path + ('?' + p.query if p.query else ''), headers={
                'User-Agent': USER_AGENT, 'Accept': 'application/json,text/html,text/plain',
                'Accept-Encoding':'identity', **self.headers})
            response = connection.getresponse()
            if response.status != 200:
                # Fail once, including 429; no login, redirect, CAPTCHA, or retry loop.
                raise FetchError('http_' + str(response.status))
            if response.getheader('Content-Encoding','identity') not in ('','identity'):
                raise FetchError('unsupported_content_encoding')
            ctype = response.getheader('Content-Type','').split(';')[0].strip().lower()
            if ctype not in {'application/json','application/ld+json','text/html','text/plain'}:
                raise FetchError('unsupported_content_type')
            chunks = []
            size = 0
            while True:
                if time.monotonic()>=self.deadline:
                    raise FetchError('run_budget_exhausted')
                chunk = response.read(16384)
                if not chunk:
                    break
                size += len(chunk)
                self.byte_count += len(chunk)
                if size>MAX_BYTES or self.byte_count>10*MAX_BYTES:
                    raise FetchError('response_size_budget_exceeded')
                chunks.append(chunk)
                time.sleep(len(chunk)/(128*1024))
            return Response(url,b''.join(chunks).decode('utf-8-sig'),ctype)
        except (OSError,http.client.HTTPException,UnicodeError) as exc:
            # Do not persist arbitrary exceptions containing request/credential data.
            raise FetchError('transport_error') from exc
        finally:
            connection.close()
            self.next_at = time.monotonic()+self.interval
            _next_request_by_host[self.host] = self.next_at

    def check_robots(self, url):
        robots_url = f'https://{self.host}/robots.txt'
        robots = self.get(robots_url)
        if '<html' in robots.body[:1024].lower():
            raise FetchError('robots_not_plain_text')
        parser = RobotFileParser()
        parser.parse(robots.body.splitlines())
        if not parser.can_fetch(USER_AGENT,url):
            raise FetchError('robots_disallowed')
        delay = parser.crawl_delay(USER_AGENT) or 0
        rate = parser.request_rate(USER_AGENT)
        if delay>4 or (rate and rate.seconds/max(1,rate.requests)>4):
            raise FetchError('robots_requires_slower_schedule')
        return robots
