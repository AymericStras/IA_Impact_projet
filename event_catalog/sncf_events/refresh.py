"""Durable, serial refresh batches. A complete receipt is about one query, not a region."""
import json
import uuid
from datetime import datetime, timedelta, timezone

from .connectors import initial_url, run_endpoint, scoped_endpoint
from .db import dumps, now
from .ingest import finish_run
from .search import PARIS, window

EVENT_CONNECTORS = ('datatourisme_events','occitanie_region_events','openagenda_events')
# Raised from 16 MiB on 2026-10-10 by owner decision, to re-collect the catalogue with published links.
STORAGE_BYTES = 32*1024*1024
REQUESTS_PER_HOUR = 60


def endpoints(conn):
    rows = [dict(r) for r in conn.execute(
        'SELECT e.*,s.name FROM endpoints e JOIN sources s ON s.id=e.source_id '
        'WHERE e.enabled=1 AND s.enabled=1 ORDER BY e.id') if r['connector'] in EVENT_CONNECTORS]
    result,seen = [],set()
    for row in rows:
        config = json.loads(row['config_json'])
        identity = (row['connector'],row['url'],dumps({k:v for k,v in config.items() if k not in ('starts_after','updated_since','from_date','to_date','ends_before')}))
        if identity in seen:
            continue
        seen.add(identity)
        if row['connector']=='openagenda_events':
            agenda = conn.execute('SELECT title FROM discovered_agendas WHERE uid=?',(str(config.get('agenda_uid','')),)).fetchone()
            row['name'] = 'OpenAgenda · '+(agenda[0] if agenda else str(config.get('agenda_uid','')))
        result.append(row)
    return result


def job(conn, job_id):
    row = conn.execute('SELECT * FROM refresh_jobs WHERE id=?',(job_id,)).fetchone()
    if not row:
        raise ValueError('job_not_found')
    return {**dict(row),'steps':[dict(r) for r in conn.execute(
        'SELECT id,endpoint_id,phase,status,pages,accepted,quarantined,finished_at,error '
        'FROM refresh_steps WHERE job_id=? ORDER BY id',(job_id,))]}


def enqueue(conn, first,last, *, page_budget=12, endpoint_ids=None):
    window(first,last)
    if type(page_budget) is not int or not 1<=page_budget<=40:
        raise ValueError('page_budget_must_be_1_to_40')
    active = conn.execute("SELECT * FROM refresh_jobs WHERE status IN ('queued','running')").fetchone()
    if active:
        if active['from_date']==first and active['to_date']==last:
            return job(conn,active['id'])
        raise ValueError('another_date_window_is_refreshing')
    available = endpoints(conn)
    if endpoint_ids is not None:
        if not isinstance(endpoint_ids,list) or not endpoint_ids or any(not isinstance(x,str) for x in endpoint_ids):
            raise ValueError('invalid_endpoint_selection')
        if set(endpoint_ids)-{e['id'] for e in available}:
            raise ValueError('endpoint_disabled_or_not_an_event_source')
        available = [e for e in available if e['id'] in endpoint_ids]
    if not available:
        raise ValueError('no_enabled_event_endpoints')
    identifier = str(uuid.uuid4())
    stamp = now()
    with conn:
        conn.execute('INSERT INTO refresh_jobs(id,from_date,to_date,created_at,updated_at,status,page_budget) VALUES (?,?,?,?,?,?,?)',
                     (identifier,first,last,stamp,stamp,'queued',page_budget))
        for endpoint in available:
            scopes = [('window',{'window_dates':[first,last]})]
            if endpoint['connector']=='openagenda_events':
                # Fetch edits/removals independently: the new date may no longer be in the requested window.
                previous = conn.execute("SELECT j.created_at FROM refresh_steps s JOIN refresh_jobs j ON j.id=s.job_id "
                    "WHERE s.endpoint_id=? AND s.phase='changes' AND s.status='complete' ORDER BY s.id DESC LIMIT 1",(endpoint['id'],)).fetchone()
                earliest = conn.execute('SELECT min(c.started_at) FROM crawl_runs c JOIN endpoints e ON e.id=c.endpoint_id WHERE e.url=?',(endpoint['url'],)).fetchone()[0]
                since = datetime.fromisoformat(previous[0] if previous else earliest or stamp)-timedelta(minutes=5)
                scopes.append(('changes',{'delta_since':since.isoformat()}))
            for phase,scope in scopes:
                conn.execute('INSERT INTO refresh_steps(job_id,endpoint_id,phase,scope_json,initial_url) VALUES (?,?,?,?,?)',
                    (identifier,endpoint['id'],phase,dumps(scope),initial_url(scoped_endpoint(endpoint,**scope))))
    return job(conn,identifier)


def resume_job(conn, identifier):
    row = job(conn,identifier)
    if row['status'] not in ('paused','failed','partial'):
        raise ValueError('job_not_resumable')
    if conn.execute("SELECT 1 FROM refresh_jobs WHERE status IN ('queued','running')").fetchone():
        raise ValueError('another_job_is_active')
    eligible = conn.execute("SELECT id FROM refresh_steps WHERE job_id=? AND (status='pending' OR (status='failed' "
        "AND (run_id IS NULL OR EXISTS (SELECT 1 FROM crawl_runs c WHERE c.id=run_id AND c.cursor_json IS NOT NULL))))",(identifier,)).fetchall()
    if not eligible:
        raise ValueError('no_remaining_pages_create_new_refresh')
    with conn:
        conn.execute("UPDATE refresh_jobs SET status='queued',pages_in_batch=0,error=NULL,updated_at=? WHERE id=?",(now(),identifier))
        conn.executemany("UPDATE refresh_steps SET status='pending',error=NULL WHERE id=?",eligible)
    return job(conn,identifier)


def pause_job(conn, identifier):
    if job(conn,identifier)['status'] not in ('queued','running'):
        raise ValueError('job_not_active')
    with conn:
        conn.execute("UPDATE refresh_jobs SET status='paused',error='user_paused',updated_at=? WHERE id=?",(now(),identifier))
    return job(conn,identifier)


def recover(conn):
    """Caller holds writer mutex. Only repair runs linked to this app's persisted steps."""
    for step in conn.execute("SELECT * FROM refresh_steps WHERE status='running'").fetchall():
        run = conn.execute('SELECT * FROM crawl_runs WHERE id=?',(step['run_id'],)).fetchone() if step['run_id'] else None
        if run and run['status']=='running':
            finish_run(conn,run['id'],'interrupted','local_app_stopped')
        with conn:
            conn.execute("UPDATE refresh_steps SET status='failed',error='local_app_stopped' WHERE id=?",(step['id'],))
    with conn:
        conn.execute("UPDATE refresh_jobs SET status='paused',error='local_app_stopped',updated_at=? WHERE status IN ('running','queued')",(now(),))


def storage(conn):
    page_size = conn.execute('PRAGMA page_size').fetchone()[0]
    pages = conn.execute('PRAGMA page_count').fetchone()[0]
    free = conn.execute('PRAGMA freelist_count').fetchone()[0]
    return {'file_bytes':pages*page_size,'reusable_bytes':free*page_size,'budget_bytes':STORAGE_BYTES,
            'remaining_bytes':max(0,STORAGE_BYTES-pages*page_size)+free*page_size}


def process_one(conn, identifier, *, runner=run_endpoint):
    """One page/one network request per invocation, across all sources round-robin."""
    item = job(conn,identifier)
    if item['status'] not in ('queued','running'):
        return item
    pending = conn.execute("SELECT * FROM refresh_steps WHERE job_id=? AND status='pending' ORDER BY pages,id LIMIT 1",(identifier,)).fetchone()
    if not pending:
        statuses = {s['status'] for s in item['steps']}
        status = 'failed' if 'failed' in statuses else 'partial' if 'partial' in statuses else 'complete'
        with conn:
            conn.execute('UPDATE refresh_jobs SET status=?,updated_at=? WHERE id=?',(status,now(),identifier))
        return job(conn,identifier)
    from .rail import hourly_usage
    used,limited = hourly_usage(conn)
    error = ('page_budget_reached' if item['pages_in_batch']>=item['page_budget'] else
             'hourly_budget_or_cooldown' if used>=REQUESTS_PER_HOUR or limited else
             'storage_budget_reached' if storage(conn)['remaining_bytes']<512*1024 else None)
    if error:
        with conn:
            conn.execute("UPDATE refresh_jobs SET status='paused',error=?,updated_at=? WHERE id=?",(error,now(),identifier))
        return job(conn,identifier)
    step = dict(pending)
    scope = json.loads(step['scope_json'])
    endpoint = conn.execute('SELECT * FROM endpoints WHERE id=?',(step['endpoint_id'],)).fetchone()
    if initial_url(scoped_endpoint(endpoint,**scope))!=step['initial_url']:
        with conn:
            conn.execute("UPDATE refresh_steps SET status='failed',error='endpoint_config_changed' WHERE id=?",(step['id'],))
        return job(conn,identifier)
    with conn:
        conn.execute("UPDATE refresh_jobs SET status='running',updated_at=? WHERE id=?",(now(),identifier))
        conn.execute("UPDATE refresh_steps SET status='running' WHERE id=?",(step['id'],))
        attempt = conn.execute('INSERT INTO refresh_attempts(step_id,started_at) VALUES (?,?)',(step['id'],now())).lastrowid
    def started(run_id):
        with conn:
            conn.execute('UPDATE refresh_steps SET run_id=? WHERE id=?',(run_id,step['id']))
            conn.execute('UPDATE refresh_attempts SET run_id=? WHERE id=?',(run_id,attempt))
    try:
        run = runner(conn,step['endpoint_id'],max_pages=1,resume=step['run_id'],on_run=started,**scope)
        status = ('pending' if run['failure_code']=='page_budget_reached' else
                  'failed' if run['status'] in ('failed','interrupted') else
                  'partial' if step['quarantined']+run['quarantined'] else 'complete')
        if status=='pending' and run['cursor_json']:
            next_target = json.loads(run['cursor_json'])['next_url']
            previous_targets = {step['initial_url']}
            for previous in conn.execute('SELECT c.cursor_json FROM refresh_attempts a JOIN crawl_runs c ON c.id=a.run_id WHERE a.step_id=? AND a.id<>? AND c.cursor_json IS NOT NULL',(step['id'],attempt)):
                previous_targets.add(json.loads(previous[0])['next_url'])
            if next_target in previous_targets:
                status = 'failed'
                run['failure_code'] = 'pagination_cycle'
        with conn:
            conn.execute('UPDATE refresh_steps SET status=?,run_id=?,pages=pages+?,accepted=accepted+?,quarantined=quarantined+?,finished_at=?,error=? WHERE id=?',
                         (status,run['id'],run['pages'],run['accepted'],run['quarantined'],now(),run['failure_code'],step['id']))
    except (ValueError,OSError) as exc:
        # Error messages may contain provider input; store only known local codes/type.
        code = 'configuration_or_access_error' if isinstance(exc,ValueError) else 'network_or_storage_error'
        with conn:
            conn.execute("UPDATE refresh_steps SET status='failed',error=?,finished_at=? WHERE id=?",(code,now(),step['id']))
    finally:
        with conn:
            conn.execute('UPDATE refresh_attempts SET finished_at=? WHERE id=?',(now(),attempt))
            conn.execute('UPDATE refresh_jobs SET pages_in_batch=pages_in_batch+1,updated_at=? WHERE id=?',(now(),identifier))
    return job(conn,identifier)


def coverage(conn,first,last):
    window(first,last)
    result = []
    cutoff = (datetime.now(timezone.utc)-timedelta(hours=24)).isoformat(timespec='seconds')
    for endpoint in endpoints(conn):
        row = conn.execute("SELECT s.*,j.from_date,j.to_date,j.status AS job_status FROM refresh_steps s JOIN refresh_jobs j ON j.id=s.job_id "
            "WHERE s.endpoint_id=? AND s.phase='window' AND j.from_date<=? AND j.to_date>=? ORDER BY s.id DESC LIMIT 1",(endpoint['id'],first,last)).fetchone()
        latest = conn.execute('SELECT finished_at,status FROM crawl_runs WHERE endpoint_id=? ORDER BY started_at DESC LIMIT 1',(endpoint['id'],)).fetchone()
        changes = conn.execute("SELECT status FROM refresh_steps WHERE job_id=? AND endpoint_id=? AND phase='changes'",(row['job_id'],endpoint['id'])).fetchone() if row else None
        result.append({'endpoint_id':endpoint['id'],'source_name':endpoint['name'],
                       'status':row['status'] if row else 'not_checked',
                       'fresh':bool(row and row['status']=='complete' and (not changes or changes['status']=='complete') and row['finished_at'] and row['finished_at']>=cutoff),
                       'changes_status':changes['status'] if changes else None,
                       'pages':row['pages'] if row else 0,'quarantined':row['quarantined'] if row else 0,
                       'checked_at':row['finished_at'] if row else None,
                       'last_fetch_at':latest['finished_at'] if latest else None,
                       'error':row['error'] if row else None})
    return result


def settings(conn):
    return dict(conn.execute('SELECT * FROM local_settings WHERE id=1').fetchone())


def save_settings(conn, enabled,interval_hours=6,horizon_days=30):
    if type(enabled) is not bool or type(interval_hours) is not int or not 6<=interval_hours<=168 or type(horizon_days) is not int or not 1<=horizon_days<=90:
        raise ValueError('invalid_schedule_settings')
    with conn:
        conn.execute('UPDATE local_settings SET enabled=?,interval_hours=?,horizon_days=?,next_run_at=?,last_error=NULL WHERE id=1',
                     (int(enabled),interval_hours,horizon_days,now() if enabled else None))
    return settings(conn)


def scheduled_tick(conn):
    setting = settings(conn)
    stamp = datetime.now(timezone.utc)
    if not setting['enabled'] or (setting['next_run_at'] and setting['next_run_at']>stamp.isoformat()):
        return None
    if conn.execute("SELECT 1 FROM refresh_jobs WHERE status IN ('queued','running')").fetchone():
        return None
    first = stamp.astimezone(PARIS).date()
    last = first+timedelta(days=setting['horizon_days']-1)
    error = None
    result = None
    try:
        pending = conn.execute("SELECT id FROM refresh_jobs WHERE status='paused' AND error IN ('page_budget_reached','hourly_budget_or_cooldown') "
            'AND from_date<=? AND to_date>=? ORDER BY created_at DESC LIMIT 1',(first.isoformat(),first.isoformat())).fetchone()
        result = resume_job(conn,pending[0]) if pending else enqueue(conn,first.isoformat(),last.isoformat(),page_budget=12)
    except ValueError:
        error = 'scheduled_refresh_unavailable'
    with conn:
        conn.execute('UPDATE local_settings SET next_run_at=?,last_error=? WHERE id=1',
            ((stamp+timedelta(hours=setting['interval_hours'])).isoformat(),error))
    return result
