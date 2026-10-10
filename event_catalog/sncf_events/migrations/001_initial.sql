CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
);
CREATE TABLE departments (
    code TEXT PRIMARY KEY CHECK(length(code)=2), name TEXT NOT NULL,
    region_code TEXT NOT NULL DEFAULT '76' CHECK(region_code='76')
);
CREATE TABLE communes (
    code TEXT PRIMARY KEY CHECK(length(code)=5), name TEXT NOT NULL,
    department_code TEXT NOT NULL REFERENCES departments(code),
    latitude REAL CHECK(latitude BETWEEN -90 AND 90),
    longitude REAL CHECK(longitude BETWEEN -180 AND 180),
    evidence_url TEXT NOT NULL, checked_at TEXT NOT NULL
);
CREATE TABLE registry_imports (
    sha256 TEXT PRIMARY KEY, as_of TEXT NOT NULL, imported_at TEXT NOT NULL,
    record_count INTEGER NOT NULL CHECK(record_count>=0), document_json TEXT NOT NULL CHECK(json_valid(document_json))
);
CREATE TABLE sources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    scope TEXT NOT NULL, role TEXT NOT NULL, entry_url TEXT NOT NULL,
    proposed_connector TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2','P3')),
    verification_status TEXT NOT NULL, notes TEXT NOT NULL, evidence_url TEXT NOT NULL,
    checked_on TEXT NOT NULL, authorization_review TEXT NOT NULL,
    production_crawl_tested INTEGER NOT NULL DEFAULT 0 CHECK(production_crawl_tested IN (0,1)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    last_success_at TEXT, last_failure_code TEXT,
    raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
    import_sha256 TEXT REFERENCES registry_imports(sha256)
);
CREATE TABLE source_aliases (
    source_id TEXT NOT NULL REFERENCES sources(id), url TEXT NOT NULL,
    PRIMARY KEY(source_id,url)
);
CREATE TABLE source_departments (
    source_id TEXT NOT NULL REFERENCES sources(id), department_code TEXT NOT NULL REFERENCES departments(code),
    PRIMARY KEY(source_id,department_code)
);
CREATE TABLE source_relationships (
    downstream_id TEXT NOT NULL REFERENCES sources(id), upstream_id TEXT NOT NULL REFERENCES sources(id),
    relationship TEXT NOT NULL CHECK(relationship IN ('syndicates','directory','possible_shared_upstream')),
    evidence_url TEXT NOT NULL, checked_at TEXT NOT NULL,
    PRIMARY KEY(downstream_id,upstream_id,relationship), CHECK(downstream_id<>upstream_id)
);
CREATE TABLE source_reviews (
    id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    read_allowed INTEGER NOT NULL CHECK(read_allowed IN (0,1)),
    facts_reuse_allowed INTEGER NOT NULL CHECK(facts_reuse_allowed IN (0,1)),
    description_reuse_allowed INTEGER NOT NULL CHECK(description_reuse_allowed IN (0,1)),
    license_name TEXT NOT NULL, evidence_url TEXT NOT NULL,
    attribution TEXT NOT NULL, reviewer TEXT NOT NULL, reviewed_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, notes TEXT NOT NULL
);
CREATE TABLE endpoints (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    connector TEXT NOT NULL CHECK(connector IN ('datatourisme_events','datatourisme_places','openagenda_events','openagenda_agendas','jsonld')),
    url TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    UNIQUE(source_id,connector,url,config_json)
);
CREATE TABLE crawl_runs (
    id TEXT PRIMARY KEY, endpoint_id TEXT REFERENCES endpoints(id), source_id TEXT NOT NULL REFERENCES sources(id),
    started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('running','complete','partial','failed','interrupted')),
    pages INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
    quarantined INTEGER NOT NULL DEFAULT 0, cursor_json TEXT CHECK(cursor_json IS NULL OR json_valid(cursor_json)),
    failure_code TEXT, CHECK(pages>=0 AND accepted>=0 AND quarantined>=0)
);
CREATE UNIQUE INDEX one_active_crawl ON crawl_runs((1)) WHERE status='running';
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    run_id TEXT NOT NULL REFERENCES crawl_runs(id), url TEXT NOT NULL,
    fetched_at TEXT NOT NULL, content_type TEXT NOT NULL, http_status INTEGER NOT NULL,
    sha256 TEXT NOT NULL, body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=2097152),
    sanitized INTEGER NOT NULL DEFAULT 0 CHECK(sanitized IN (0,1)),
    UNIQUE(run_id,url,sha256)
);
CREATE TABLE entities (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('event','educational_offer','venue')),
    provider TEXT NOT NULL, external_id TEXT NOT NULL,
    current_observation_id INTEGER REFERENCES observations(id),
    created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    UNIQUE(provider,external_id,kind)
);
CREATE TRIGGER snapshot_run_source_guard BEFORE INSERT ON snapshots
WHEN NEW.source_id<>(SELECT source_id FROM crawl_runs WHERE id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'snapshot/run source mismatch'); END;
CREATE TABLE observations (
    id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id),
    source_id TEXT NOT NULL REFERENCES sources(id), snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    locator TEXT NOT NULL, observed_at TEXT NOT NULL, source_updated_at TEXT,
    sha256 TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)),
    UNIQUE(entity_id,snapshot_id,locator)
);
CREATE INDEX observations_entity ON observations(entity_id,id);
CREATE TRIGGER observation_source_guard BEFORE INSERT ON observations
WHEN NEW.source_id<>(SELECT source_id FROM snapshots WHERE id=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'snapshot/source mismatch'); END;
CREATE TRIGGER entity_observation_guard BEFORE UPDATE OF current_observation_id ON entities
WHEN NEW.current_observation_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM observations WHERE id=NEW.current_observation_id AND entity_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'observation/entity mismatch'); END;
CREATE TABLE field_evidence (
    observation_id INTEGER NOT NULL REFERENCES observations(id), field TEXT NOT NULL,
    locator TEXT NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    method TEXT NOT NULL CHECK(method IN ('api','jsonld','manual','ai_reviewed')),
    PRIMARY KEY(observation_id,field,locator)
);
CREATE TABLE upstream_presence (
    provider TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES sources(id), collection_url TEXT NOT NULL,
    active INTEGER NOT NULL CHECK(active IN (0,1)), source_updated_at TEXT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id), observed_at TEXT NOT NULL,
    PRIMARY KEY(provider,external_id,kind,source_id,collection_url)
);
CREATE TABLE occurrences (
    id INTEGER PRIMARY KEY, observation_id INTEGER NOT NULL REFERENCES observations(id),
    slot_key TEXT NOT NULL, start_at TEXT, end_at TEXT,
    start_date TEXT, end_date TEXT, timezone TEXT,
    precision TEXT NOT NULL CHECK(precision IN ('datetime','date','unknown')),
    status TEXT NOT NULL CHECK(status IN ('scheduled','rescheduled','postponed','cancelled','full','moved_online','unknown')),
    recurrence_rule TEXT, exceptions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(exceptions_json)),
    evidence_locator TEXT NOT NULL, UNIQUE(observation_id,slot_key),
    CHECK(end_at IS NULL OR (start_at IS NOT NULL AND end_at>=start_at)),
    CHECK(end_date IS NULL OR (start_date IS NOT NULL AND end_date>=start_date)),
    CHECK((precision='datetime' AND start_at IS NOT NULL AND start_date IS NULL) OR
          (precision='date' AND start_date IS NOT NULL AND start_at IS NULL) OR
          (precision='unknown' AND start_at IS NULL AND start_date IS NULL))
);
CREATE TABLE school_conditions (
    observation_id INTEGER PRIMARY KEY REFERENCES observations(id),
    school_groups TEXT NOT NULL DEFAULT 'unknown' CHECK(school_groups IN ('confirmed','not_supported','unknown')),
    min_age INTEGER CHECK(min_age>=0), max_age INTEGER CHECK(max_age>=min_age OR min_age IS NULL),
    min_group INTEGER CHECK(min_group>=1), max_group INTEGER CHECK(max_group>=1 AND (min_group IS NULL OR max_group>=min_group)),
    grade_levels_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(grade_levels_json)),
    learning_objectives TEXT, duration_minutes INTEGER CHECK(duration_minutes>0),
    languages_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(languages_json)),
    booking_required TEXT NOT NULL DEFAULT 'unknown' CHECK(booking_required IN ('yes','no','unknown')),
    booking_url TEXT, notice_days INTEGER CHECK(notice_days>=0),
    price_amount TEXT, price_currency TEXT, price_unit TEXT CHECK(price_unit IN ('person','group','unknown')),
    CHECK(price_amount IS NULL OR (price_currency IS NOT NULL AND price_unit IS NOT NULL))
);
CREATE TABLE availability_confirmations (
    id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id),
    occurrence_id INTEGER REFERENCES occurrences(id),
    status TEXT NOT NULL CHECK(status IN ('available','unavailable','unknown')),
    seats INTEGER CHECK(seats>=0), confirmed_at TEXT NOT NULL, valid_until TEXT NOT NULL,
    supplier_name TEXT NOT NULL, evidence_url TEXT NOT NULL,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    CHECK(valid_until>confirmed_at), CHECK(status<>'available' OR seats IS NOT NULL)
);
CREATE TRIGGER availability_entity_guard BEFORE INSERT ON availability_confirmations
WHEN NEW.occurrence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM occurrences c JOIN observations o ON o.id=c.observation_id
    WHERE c.id=NEW.occurrence_id AND o.entity_id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'availability/entity mismatch'); END;
CREATE TABLE rail_access_checks (
    id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id),
    station_id TEXT NOT NULL, station_name TEXT NOT NULL,
    route_provider TEXT NOT NULL, walking_seconds INTEGER CHECK(walking_seconds>=0),
    walking_metres INTEGER CHECK(walking_metres>=0),
    accessible_route TEXT NOT NULL DEFAULT 'unknown' CHECK(accessible_route IN ('yes','no','unknown')),
    checked_at TEXT NOT NULL, valid_until TEXT NOT NULL, evidence_url TEXT NOT NULL,
    CHECK(valid_until>checked_at)
);
CREATE TABLE review_issues (
    id INTEGER PRIMARY KEY, entity_id TEXT REFERENCES entities(id),
    observation_id INTEGER REFERENCES observations(id), code TEXT NOT NULL,
    detail TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT
);
CREATE INDEX open_issues ON review_issues(entity_id) WHERE resolved_at IS NULL;
CREATE TABLE duplicate_candidates (
    first_entity_id TEXT NOT NULL REFERENCES entities(id), second_entity_id TEXT NOT NULL REFERENCES entities(id),
    reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','distinct','same')),
    reviewed_by TEXT, reviewed_at TEXT,
    PRIMARY KEY(first_entity_id,second_entity_id), CHECK(first_entity_id<second_entity_id)
);
CREATE TABLE quarantined_records (
    id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    locator TEXT NOT NULL, reason TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
);
CREATE TABLE discovered_agendas (
    uid TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT, source_id TEXT NOT NULL REFERENCES sources(id),
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id), discovered_at TEXT NOT NULL,
    raw_json TEXT NOT NULL CHECK(json_valid(raw_json))
);
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, action TEXT NOT NULL,
    target TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json))
);
CREATE VIEW current_records AS
SELECT e.id,e.kind,e.provider,e.external_id,e.last_seen_at,o.id AS observation_id,
       o.source_id,o.snapshot_id,o.observed_at,o.source_updated_at,o.data_json,
       json_extract(o.data_json,'$.title') AS title,
       json_extract(o.data_json,'$.department_code') AS department_code,
       json_extract(o.data_json,'$.commune_code') AS commune_code,
       json_extract(o.data_json,'$.status') AS status
FROM entities e JOIN observations o ON o.id=e.current_observation_id;
CREATE VIEW events AS SELECT * FROM current_records WHERE kind='event';
CREATE VIEW educational_offers AS SELECT * FROM current_records WHERE kind='educational_offer';
CREATE VIEW venues AS SELECT * FROM current_records WHERE kind='venue';
CREATE VIEW current_occurrences AS
SELECT e.id AS entity_id,c.* FROM entities e JOIN occurrences c ON c.observation_id=e.current_observation_id;
CREATE VIEW department_coverage AS
SELECT d.code,d.name,
 (SELECT count(*) FROM source_departments sd WHERE sd.department_code=d.code) AS registered_local_sources,
 (SELECT count(*) FROM source_departments sd JOIN sources s ON s.id=sd.source_id WHERE sd.department_code=d.code AND s.enabled=1) AS enabled_local_sources,
 (SELECT count(*) FROM current_records r WHERE r.department_code=d.code AND r.kind='event') AS events,
 (SELECT count(*) FROM current_records r WHERE r.department_code=d.code AND r.kind='educational_offer') AS educational_offers,
 (SELECT count(*) FROM current_records r WHERE r.department_code=d.code AND r.kind='venue') AS venues
FROM departments d;
