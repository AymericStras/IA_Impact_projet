CREATE TABLE rail_datasets (
    id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
    imported_at TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE UNIQUE INDEX one_active_rail_dataset ON rail_datasets((1)) WHERE active=1;
CREATE TABLE rail_stations (
    dataset_id TEXT NOT NULL REFERENCES rail_datasets(id), id TEXT NOT NULL,
    name TEXT NOT NULL, latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
    longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
    department_code TEXT NOT NULL REFERENCES departments(code), commune TEXT NOT NULL,
    modes_json TEXT NOT NULL CHECK(json_valid(modes_json)), PRIMARY KEY(dataset_id,id)
);
CREATE TABLE walking_routes (
    route_key TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES rail_datasets(id),
    station_id TEXT NOT NULL, destination_json TEXT NOT NULL CHECK(json_valid(destination_json)),
    checked_at TEXT NOT NULL, valid_until TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ok','unknown')), reason TEXT,
    seconds INTEGER CHECK(seconds>=0), metres INTEGER CHECK(metres>=0),
    request_url TEXT NOT NULL, response_sha256 TEXT NOT NULL,
    evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
    FOREIGN KEY(dataset_id,station_id) REFERENCES rail_stations(dataset_id,id)
);
CREATE TABLE walking_jobs (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','paused','complete')),
    filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),
    targets_json TEXT NOT NULL CHECK(json_valid(targets_json)),
    position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0),
    requests INTEGER NOT NULL DEFAULT 0, batch_requests INTEGER NOT NULL DEFAULT 0,
    budget INTEGER NOT NULL CHECK(budget BETWEEN 1 AND 10), error TEXT
);
CREATE UNIQUE INDEX one_active_walking_job ON walking_jobs((1)) WHERE status IN ('queued','running');
CREATE TABLE walking_attempts (
    id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES walking_jobs(id),
    started_at TEXT NOT NULL, finished_at TEXT, error TEXT
);
CREATE INDEX walking_attempts_time ON walking_attempts(started_at);
CREATE TABLE walking_evidence (
    id INTEGER PRIMARY KEY, route_key TEXT NOT NULL, checked_at TEXT NOT NULL,
    request_url TEXT NOT NULL, response_sha256 TEXT NOT NULL,
    response_body TEXT NOT NULL CHECK(length(CAST(response_body AS BLOB))<=65536),
    result_json TEXT NOT NULL CHECK(json_valid(result_json))
);
