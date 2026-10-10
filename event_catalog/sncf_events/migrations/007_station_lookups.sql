CREATE TABLE station_lookups (
    dataset_id TEXT NOT NULL, station_id TEXT NOT NULL,
    day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    requested_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','complete','partial','failed')),
    collected_at TEXT, error TEXT,
    PRIMARY KEY(dataset_id,station_id,day),
    FOREIGN KEY(dataset_id,station_id) REFERENCES rail_stations(dataset_id,id)
);
CREATE INDEX station_lookups_queue ON station_lookups(status,requested_at);
CREATE TABLE station_lookup_steps (
    id INTEGER PRIMARY KEY, dataset_id TEXT NOT NULL, station_id TEXT NOT NULL, day TEXT NOT NULL,
    endpoint_id TEXT NOT NULL REFERENCES endpoints(id), initial_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','partial','failed')),
    run_id TEXT REFERENCES crawl_runs(id), pages INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0, quarantined INTEGER NOT NULL DEFAULT 0,
    finished_at TEXT, error TEXT, UNIQUE(dataset_id,station_id,day,endpoint_id),
    FOREIGN KEY(dataset_id,station_id,day) REFERENCES station_lookups(dataset_id,station_id,day)
);
CREATE TABLE station_lookup_attempts (
    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('collect','route')), error TEXT
);
CREATE INDEX station_lookup_attempts_time ON station_lookup_attempts(started_at);
