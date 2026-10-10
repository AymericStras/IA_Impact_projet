CREATE TABLE refresh_jobs (
    id TEXT PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','paused','complete','partial','failed','cancelled')),
    page_budget INTEGER NOT NULL CHECK(page_budget BETWEEN 1 AND 40),
    pages_in_batch INTEGER NOT NULL DEFAULT 0 CHECK(pages_in_batch>=0),
    error TEXT, CHECK(to_date>=from_date)
);
CREATE UNIQUE INDEX one_active_refresh ON refresh_jobs((1)) WHERE status IN ('queued','running');
CREATE TABLE refresh_steps (
    id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES refresh_jobs(id),
    endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
    phase TEXT NOT NULL CHECK(phase IN ('window','changes')),
    scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
    initial_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','partial','failed')),
    run_id TEXT REFERENCES crawl_runs(id), pages INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0, quarantined INTEGER NOT NULL DEFAULT 0,
    finished_at TEXT, error TEXT, UNIQUE(job_id,endpoint_id,phase)
);
CREATE INDEX refresh_steps_endpoint ON refresh_steps(endpoint_id,phase,id);
CREATE TABLE refresh_attempts (
    id INTEGER PRIMARY KEY, step_id INTEGER NOT NULL REFERENCES refresh_steps(id),
    started_at TEXT NOT NULL, finished_at TEXT, run_id TEXT REFERENCES crawl_runs(id)
);
CREATE INDEX refresh_attempts_time ON refresh_attempts(started_at);
CREATE TABLE local_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    interval_hours INTEGER NOT NULL DEFAULT 6 CHECK(interval_hours BETWEEN 6 AND 168),
    horizon_days INTEGER NOT NULL DEFAULT 30 CHECK(horizon_days BETWEEN 1 AND 90),
    next_run_at TEXT, last_error TEXT
);
INSERT INTO local_settings(id) VALUES (1);
