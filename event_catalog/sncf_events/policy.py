"""Source authorization and outbound scope. These do not replace host-guard."""
from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

from .db import audit, now

SECRET_PARAMETERS = {'key','api_key','apikey','token','access_token','access-token','authorization'}


def validate_public_url(url: str, *, https_only=False):
    if not isinstance(url, str) or len(url) > 4096 or any(ord(c)<33 for c in url):
        raise ValueError('invalid URL')
    p = urlsplit(url)
    if p.scheme not in (('https',) if https_only else ('http','https')) or not p.hostname:
        raise ValueError('public HTTP(S) URL required')
    if p.username or p.password or p.port not in (None,80,443) or '\\' in url:
        raise ValueError('URL credentials/custom ports are forbidden')
    host = p.hostname.lower().rstrip('.')
    if host in {'localhost','metadata.google.internal'} or host.endswith(('.localhost','.local','.internal')):
        raise ValueError('private host forbidden')
    try:
        if not ipaddress.ip_address(host).is_global:
            raise ValueError('private address forbidden')
    except ValueError as exc:
        if 'private address' in str(exc):
            raise
        if not re.fullmatch(r'[a-z0-9.-]+', host) or '.' not in host:
            raise ValueError('invalid public hostname') from exc
    path = p.path
    for _ in range(4):
        path = unquote(path)
    if any(x in ('.','..') for x in path.split('/')) or '\\' in path:
        raise ValueError('ambiguous path forbidden')
    if any(k.lower() in SECRET_PARAMETERS for k,v in parse_qsl(p.query)):
        raise ValueError('credentials must be supplied in headers')
    return p


def strip_secrets_from_url(url):
    p = urlsplit(url)
    query = [(k,v) for k,v in parse_qsl(p.query, keep_blank_values=True)
             if k.lower() not in SECRET_PARAMETERS]
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(query), ''))


def timestamp(value):
    if not isinstance(value,str):
        raise ValueError('timestamp must be text')
    dt = datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None:
        raise ValueError('timestamp requires a timezone')
    return dt.astimezone(timezone.utc).isoformat()


def latest_review(conn, source_id):
    return conn.execute('SELECT * FROM source_reviews WHERE source_id=? ORDER BY id DESC LIMIT 1',
                        (source_id,)).fetchone()


def require_read_permission(conn, source_id):
    source = conn.execute('SELECT * FROM sources WHERE id=?', (source_id,)).fetchone()
    review = latest_review(conn, source_id)
    if not source or not source['enabled']:
        raise ValueError('source_disabled')
    if not review or not review['read_allowed'] or timestamp(review['expires_at']) <= now():
        raise ValueError('source_review_missing_or_expired')
    return source


def review_source(conn, source_id, review):
    if not isinstance(review,dict):
        raise ValueError('review must be an object')
    required = {'read_allowed','facts_reuse_allowed','description_reuse_allowed','license_name',
                'evidence_url','attribution','reviewer','expires_at','notes'}
    if set(review) != required:
        raise ValueError('review fields do not match the documented contract')
    for k in ('read_allowed','facts_reuse_allowed','description_reuse_allowed'):
        if type(review[k]) is not bool:
            raise ValueError('review permission must be a boolean')
    for k in required - {'read_allowed','facts_reuse_allowed','description_reuse_allowed'}:
        if not isinstance(review[k],str) or not review[k].strip():
            raise ValueError('review text must be explicit: ' + k)
    validate_public_url(review['evidence_url'])
    review['expires_at'] = timestamp(review['expires_at'])
    if review['expires_at'] <= now():
        raise ValueError('review has already expired')
    cols = sorted(required)
    with conn:
        conn.execute(f"INSERT INTO source_reviews(source_id,reviewed_at,{','.join(cols)}) "
                     f"VALUES ({','.join('?' for _ in range(len(cols)+2))})",
                     [source_id,now(),*(review[k] for k in cols)])
        # Updating/revoking permissions always requires explicit subsequent re-enablement.
        conn.execute('UPDATE sources SET enabled=0 WHERE id=?', (source_id,))
        audit(conn,'review_source',source_id,review)


def set_source_enabled(conn, source_id, enabled):
    if not conn.execute('SELECT 1 FROM sources WHERE id=?', (source_id,)).fetchone():
        raise ValueError('unknown source')
    if enabled:
        review = latest_review(conn, source_id)
        if not review or not review['read_allowed'] or timestamp(review['expires_at'])<=now():
            raise ValueError('valid source read review required')
    with conn:
        conn.execute('UPDATE sources SET enabled=? WHERE id=?', (int(enabled),source_id))
        audit(conn,'source_enabled',source_id,{'enabled': enabled})
