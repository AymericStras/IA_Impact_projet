"""SQLite persistence; no daemon, installation, or application network access."""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import math
import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEPARTMENTS = {
    '09': 'Ariège', '11': 'Aude', '12': 'Aveyron', '30': 'Gard',
    '31': 'Haute-Garonne', '32': 'Gers', '34': 'Hérault', '46': 'Lot',
    '48': 'Lozère', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales',
    '81': 'Tarn', '82': 'Tarn-et-Garonne',
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def loads(value):
    """Reject ambiguous/non-JSON numbers before record transactions begin."""
    def reject_constant(_):
        raise ValueError('nonfinite_json_number')
    def finite_float(raw):
        value = float(raw)
        if not math.isfinite(value):
            raise ValueError('nonfinite_json_number')
        return value
    def unique_keys(pairs):
        result = {}
        for key,item in pairs:
            if key in result:
                raise ValueError('duplicate_json_key')
            result[key] = item
        return result
    return json.loads(value,parse_constant=reject_constant,parse_float=finite_float,object_pairs_hook=unique_keys)


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def connect(path: str | Path, *, readonly=False) -> sqlite3.Connection:
    path = Path(path).resolve()
    if readonly:
        conn = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=2)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=2000')
    return conn


@contextlib.contextmanager
def writer_lock(path: str | Path):
    """Database writer mutex only. NOT a host resource/safety admission tool."""
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(path.suffix + '.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError('another writer owns this database') from exc
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def migrate(conn):
    exists = conn.execute("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").fetchone()
    applied = dict(conn.execute('SELECT version,sha256 FROM schema_migrations')) if exists else {}
    files = sorted((Path(__file__).parent / 'migrations').glob('*.sql'))
    if set(applied) - {p.stem for p in files}:
        raise ValueError('database schema is newer than this application')
    for file in files:
        sql = file.read_text()
        checksum = digest(sql)
        if file.stem in applied:
            if applied[file.stem] != checksum:
                raise ValueError('applied migration was modified: ' + file.stem)
            continue
        rebuild = sql.startswith('-- rebuild-with-foreign-key-check')
        try:
            if conn.in_transaction:
                raise ValueError('migration requires no open transaction')
            if rebuild:
                conn.execute('PRAGMA foreign_keys=OFF')
            conn.execute('BEGIN IMMEDIATE')
            statement = ''
            for line in sql.splitlines(keepends=True):
                statement += line
                if sqlite3.complete_statement(statement):
                    conn.execute(statement)
                    statement = ''
            if statement.strip():
                raise ValueError('incomplete migration statement')
            if conn.execute('PRAGMA foreign_key_check').fetchone():
                raise ValueError('migration foreign key check failed')
            conn.execute('INSERT INTO schema_migrations VALUES (?,?,?)',(file.stem,checksum,now()))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            if rebuild:
                conn.execute('PRAGMA foreign_keys=ON')
    with conn:
        conn.executemany('INSERT OR IGNORE INTO departments(code,name) VALUES (?,?)', DEPARTMENTS.items())


def audit(conn, action, target, detail):
    conn.execute('INSERT INTO audit_log(occurred_at,action,target,detail_json) VALUES (?,?,?,?)',
                 (now(), action, target, dumps(detail)))


def import_registry(conn, path):
    raw = Path(path).read_bytes()
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('seed exceeds 2 MiB')
    document = json.loads(raw)
    rows = document['records']
    if document['record_count'] != len(rows) or len({r['source_id'] for r in rows}) != len(rows):
        raise ValueError('registry count mismatch or duplicate source_id')
    if set(document['geo_filter']['department_codes']) != set(DEPARTMENTS):
        raise ValueError('unexpected region coverage')
    checksum = digest(raw)
    if conn.execute('SELECT 1 FROM registry_imports WHERE sha256=?', (checksum,)).fetchone():
        return {'imported': 0, 'unchanged': len(rows), 'sha256': checksum}
    latest = conn.execute('SELECT max(as_of) FROM registry_imports').fetchone()[0]
    if latest and latest > document['as_of']:
        raise ValueError('refusing an older registry over a newer import')
    fields = ['name','category','scope','role','entry_url','proposed_connector','priority',
              'verification_status','notes','evidence_url','checked_on','authorization_review']
    from .policy import validate_public_url
    for row in rows:
        validate_public_url(row['entry_url'])
        for alias in row['aliases']:
            validate_public_url(alias)
        if row.get('enabled') is not False:
            raise ValueError('seed import cannot enable a source')
        if any(d not in DEPARTMENTS for d in row['department'].split('/') if d):
            raise ValueError('invalid source department')
    with conn:
        conn.execute('INSERT INTO registry_imports VALUES (?,?,?,?,?)',
                     (checksum, document['as_of'], now(), len(rows), raw.decode('utf-8-sig')))
        for row in rows:
            cols = ['id', *fields, 'raw_json', 'import_sha256']
            vals = [row['source_id'], *(row[k] for k in fields), dumps(row), checksum]
            update = ','.join(f'{k}=excluded.{k}' for k in cols if k != 'id')
            conn.execute(f"INSERT INTO sources({','.join(cols)}) VALUES ({','.join('?' for _ in cols)}) "
                         f'ON CONFLICT(id) DO UPDATE SET {update}', vals)
            sid = row['source_id']
            conn.execute('DELETE FROM source_aliases WHERE source_id=?', (sid,))
            conn.execute('DELETE FROM source_departments WHERE source_id=?', (sid,))
            conn.executemany('INSERT INTO source_aliases VALUES (?,?)', [(sid,a) for a in row['aliases']])
            conn.executemany('INSERT INTO source_departments VALUES (?,?)',
                             [(sid,d) for d in row['department'].split('/') if d])
        audit(conn, 'registry_import', checksum, {'count': len(rows), 'as_of': document['as_of']})
    return {'imported': len(rows), 'unchanged': 0, 'sha256': checksum}


def backup(conn, target):
    target = Path(target)
    if target.exists() or target.is_symlink():
        raise FileExistsError('backup destination already exists')
    fd,temporary = tempfile.mkstemp(dir=target.parent,prefix='.backup-')
    os.close(fd)
    destination = sqlite3.connect(temporary)
    try:
        conn.backup(destination, pages=64, sleep=0.01)
        if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('backup integrity check failed')
        if destination.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('backup foreign key check failed')
        destination.close()
        os.link(temporary,target)
    finally:
        destination.close()
        Path(temporary).unlink(missing_ok=True)


def report(conn):
    totals = {t: conn.execute(f'SELECT count(*) FROM {t}').fetchone()[0]
              for t in ['sources','entities','events','educational_offers','venues',
                        'snapshots','quarantined_records','discovered_agendas']}
    totals['enabled_sources'] = conn.execute('SELECT count(*) FROM sources WHERE enabled=1').fetchone()[0]
    totals['open_issues'] = conn.execute('SELECT count(*) FROM review_issues WHERE resolved_at IS NULL').fetchone()[0]
    totals['unresolved_quarantined_records'] = conn.execute('SELECT count(*) FROM quarantined_records WHERE resolved_at IS NULL').fetchone()[0]
    return {'generated_at': now(), 'counts': totals,
            'department_coverage': [dict(r) for r in conn.execute('SELECT * FROM department_coverage ORDER BY code')],
            'crawl_runs': [dict(r) for r in conn.execute('SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT 20')],
            'coverage_note': 'Registered source coverage is not measured event recall. Blank source departments are not counted as verified local coverage.'}
