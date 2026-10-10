"""Read-only local readiness checks, without requests or secret values."""
from pathlib import Path

from .credentials import credential_status
from .db import digest
from .policy import require_read_permission


def doctor(conn):
    credentials = credential_status()
    expected = {p.stem:digest(p.read_text()) for p in (Path(__file__).parent/'migrations').glob('*.sql')}
    applied = dict(conn.execute('SELECT version,sha256 FROM schema_migrations'))
    integrity = [r[0] for r in conn.execute('PRAGMA integrity_check')]
    foreign_keys = [list(r) for r in conn.execute('PRAGMA foreign_key_check')]
    endpoints = []
    for row in conn.execute('SELECT * FROM endpoints ORDER BY id'):
        blockers = []
        if not row['enabled']:
            blockers.append('endpoint_disabled')
        try:
            require_read_permission(conn,row['source_id'])
        except ValueError as exc:
            blockers.append(str(exc))
        credential = ('DATATOURISME_API_KEY' if row['connector'].startswith('datatourisme_') else
                      'OPENAGENDA_PUBLIC_KEY' if row['connector'].startswith('openagenda_') else None)
        if credential and credentials[credential]!='configured':
            blockers.append(credential+':'+credentials[credential])
        endpoints.append({'id':row['id'],'connector':row['connector'],'source_id':row['source_id'],
                          'locally_configured':not blockers,'blockers':blockers})
    running = [r[0] for r in conn.execute("SELECT id FROM crawl_runs WHERE status='running'")]
    return {'ok':integrity==['ok'] and not foreign_keys and applied==expected and not running,
            'schema_matches':applied==expected,'integrity':integrity,'foreign_key_errors':foreign_keys,
            'unfinished_runs':running,'credentials':credentials,'endpoints':endpoints,
            'network_requests':0,'note':'Local configuration only; no host admission, API permission or connectivity test is implied.'}
