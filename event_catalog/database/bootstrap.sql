.bail on
.timeout 2000
-- New database only; existing databases must use migrate.
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
PRAGMA defer_foreign_keys=ON;
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, action TEXT NOT NULL,
    target TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json))
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
CREATE TABLE communes (
    code TEXT PRIMARY KEY CHECK(length(code)=5), name TEXT NOT NULL,
    department_code TEXT NOT NULL REFERENCES departments(code),
    latitude REAL CHECK(latitude BETWEEN -90 AND 90),
    longitude REAL CHECK(longitude BETWEEN -180 AND 180),
    evidence_url TEXT NOT NULL, checked_at TEXT NOT NULL
);
CREATE TABLE crawl_runs (
    id TEXT PRIMARY KEY, endpoint_id TEXT REFERENCES endpoints(id), source_id TEXT NOT NULL REFERENCES sources(id),
    started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('running','complete','partial','failed','interrupted')),
    pages INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
    quarantined INTEGER NOT NULL DEFAULT 0, cursor_json TEXT CHECK(cursor_json IS NULL OR json_valid(cursor_json)),
    failure_code TEXT, CHECK(pages>=0 AND accepted>=0 AND quarantined>=0)
);
CREATE TABLE departments (
    code TEXT PRIMARY KEY CHECK(length(code)=2), name TEXT NOT NULL,
    region_code TEXT NOT NULL DEFAULT '76' CHECK(region_code='76')
);
CREATE TABLE discovered_agendas (
    uid TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT, source_id TEXT NOT NULL REFERENCES sources(id),
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id), discovered_at TEXT NOT NULL,
    raw_json TEXT NOT NULL CHECK(json_valid(raw_json))
);
CREATE TABLE duplicate_candidates (
    first_entity_id TEXT NOT NULL REFERENCES entities(id), second_entity_id TEXT NOT NULL REFERENCES entities(id),
    reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','distinct','same')),
    reviewed_by TEXT, reviewed_at TEXT,
    PRIMARY KEY(first_entity_id,second_entity_id), CHECK(first_entity_id<second_entity_id)
);
CREATE TABLE "endpoints" (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    connector TEXT NOT NULL CHECK(connector IN ('datatourisme_events','datatourisme_places','openagenda_events','openagenda_agendas','jsonld','occitanie_region_events','fabre_school_offers')),
    url TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    UNIQUE(source_id,connector,url,config_json)
);
CREATE TABLE entities (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('event','educational_offer','venue')),
    provider TEXT NOT NULL, external_id TEXT NOT NULL,
    current_observation_id INTEGER REFERENCES observations(id),
    created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    UNIQUE(provider,external_id,kind)
);
CREATE TABLE "field_evidence" (
    observation_id INTEGER NOT NULL REFERENCES observations(id), field TEXT NOT NULL,
    locator TEXT NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    method TEXT NOT NULL CHECK(method IN ('api','jsonld','manual','ai_reviewed','html_rule')),
    PRIMARY KEY(observation_id,field,locator)
);
CREATE TABLE local_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    interval_hours INTEGER NOT NULL DEFAULT 6 CHECK(interval_hours BETWEEN 6 AND 168),
    horizon_days INTEGER NOT NULL DEFAULT 30 CHECK(horizon_days BETWEEN 1 AND 90),
    next_run_at TEXT, last_error TEXT
);
CREATE TABLE observations (
    id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id),
    source_id TEXT NOT NULL REFERENCES sources(id), snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    locator TEXT NOT NULL, observed_at TEXT NOT NULL, source_updated_at TEXT,
    sha256 TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)),
    UNIQUE(entity_id,snapshot_id,locator)
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
CREATE TABLE quarantined_records (
    id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    locator TEXT NOT NULL, reason TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
, resolved_at TEXT, resolution TEXT, observation_id INTEGER REFERENCES observations(id));
CREATE TABLE rail_access_checks (
    id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id),
    station_id TEXT NOT NULL, station_name TEXT NOT NULL,
    route_provider TEXT NOT NULL, walking_seconds INTEGER CHECK(walking_seconds>=0),
    walking_metres INTEGER CHECK(walking_metres>=0),
    accessible_route TEXT NOT NULL DEFAULT 'unknown' CHECK(accessible_route IN ('yes','no','unknown')),
    checked_at TEXT NOT NULL, valid_until TEXT NOT NULL, evidence_url TEXT NOT NULL,
    CHECK(valid_until>checked_at)
);
CREATE TABLE rail_datasets (
    id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
    imported_at TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE TABLE rail_stations (
    dataset_id TEXT NOT NULL REFERENCES rail_datasets(id), id TEXT NOT NULL,
    name TEXT NOT NULL, latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
    longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
    department_code TEXT NOT NULL REFERENCES departments(code), commune TEXT NOT NULL,
    modes_json TEXT NOT NULL CHECK(json_valid(modes_json)), PRIMARY KEY(dataset_id,id)
);
CREATE TABLE refresh_attempts (
    id INTEGER PRIMARY KEY, step_id INTEGER NOT NULL REFERENCES refresh_steps(id),
    started_at TEXT NOT NULL, finished_at TEXT, run_id TEXT REFERENCES crawl_runs(id)
);
CREATE TABLE refresh_jobs (
    id TEXT PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','paused','complete','partial','failed','cancelled')),
    page_budget INTEGER NOT NULL CHECK(page_budget BETWEEN 1 AND 40),
    pages_in_batch INTEGER NOT NULL DEFAULT 0 CHECK(pages_in_batch>=0),
    error TEXT, CHECK(to_date>=from_date)
);
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
CREATE TABLE registry_imports (
    sha256 TEXT PRIMARY KEY, as_of TEXT NOT NULL, imported_at TEXT NOT NULL,
    record_count INTEGER NOT NULL CHECK(record_count>=0), document_json TEXT NOT NULL CHECK(json_valid(document_json))
);
CREATE TABLE review_issues (
    id INTEGER PRIMARY KEY, entity_id TEXT REFERENCES entities(id),
    observation_id INTEGER REFERENCES observations(id), code TEXT NOT NULL,
    detail TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT
);
CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
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
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    run_id TEXT NOT NULL REFERENCES crawl_runs(id), url TEXT NOT NULL,
    fetched_at TEXT NOT NULL, content_type TEXT NOT NULL, http_status INTEGER NOT NULL,
    sha256 TEXT NOT NULL, body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=2097152),
    sanitized INTEGER NOT NULL DEFAULT 0 CHECK(sanitized IN (0,1)),
    UNIQUE(run_id,url,sha256)
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
CREATE TABLE upstream_presence (
    provider TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES sources(id), collection_url TEXT NOT NULL,
    active INTEGER NOT NULL CHECK(active IN (0,1)), source_updated_at TEXT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id), observed_at TEXT NOT NULL,
    PRIMARY KEY(provider,external_id,kind,source_id,collection_url)
);
CREATE TABLE walking_attempts (
    id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES walking_jobs(id),
    started_at TEXT NOT NULL, finished_at TEXT, error TEXT
);
CREATE TABLE walking_evidence (
    id INTEGER PRIMARY KEY, route_key TEXT NOT NULL, checked_at TEXT NOT NULL,
    request_url TEXT NOT NULL, response_sha256 TEXT NOT NULL,
    response_body TEXT NOT NULL CHECK(length(CAST(response_body AS BLOB))<=65536),
    result_json TEXT NOT NULL CHECK(json_valid(result_json))
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
INSERT INTO "audit_log" VALUES(1,'2026-10-10T04:44:17+00:00','registry_import','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e','{"as_of":"2026-10-10","count":144}');
INSERT INTO "audit_log" VALUES(2,'2026-10-10T04:44:17+00:00','configure_endpoint','datatourisme-events','{"config":{},"connector":"datatourisme_events"}');
INSERT INTO "audit_log" VALUES(3,'2026-10-10T04:44:17+00:00','configure_endpoint','datatourisme-places','{"config":{},"connector":"datatourisme_places"}');
INSERT INTO "audit_log" VALUES(4,'2026-10-10T04:44:17+00:00','configure_endpoint','openagenda-occitanie','{"config":{"search":"Occitanie"},"connector":"openagenda_agendas"}');
INSERT INTO "audit_log" VALUES(5,'2026-10-10T04:44:17+00:00','configure_endpoint','openagenda-science','{"config":{"search":"Fête de la science"},"connector":"openagenda_agendas"}');
INSERT INTO "audit_log" VALUES(6,'2026-10-10T04:44:17+00:00','configure_endpoint','openagenda-patrimoine','{"config":{"search":"Journées européennes du patrimoine"},"connector":"openagenda_agendas"}');
INSERT INTO "audit_log" VALUES(7,'2026-10-10T04:44:17+00:00','configure_endpoint','occitanie-region','{"config":{},"connector":"occitanie_region_events"}');
INSERT INTO "departments" VALUES('09','Ariège','76');
INSERT INTO "departments" VALUES('11','Aude','76');
INSERT INTO "departments" VALUES('12','Aveyron','76');
INSERT INTO "departments" VALUES('30','Gard','76');
INSERT INTO "departments" VALUES('31','Haute-Garonne','76');
INSERT INTO "departments" VALUES('32','Gers','76');
INSERT INTO "departments" VALUES('34','Hérault','76');
INSERT INTO "departments" VALUES('46','Lot','76');
INSERT INTO "departments" VALUES('48','Lozère','76');
INSERT INTO "departments" VALUES('65','Hautes-Pyrénées','76');
INSERT INTO "departments" VALUES('66','Pyrénées-Orientales','76');
INSERT INTO "departments" VALUES('81','Tarn','76');
INSERT INTO "departments" VALUES('82','Tarn-et-Garonne','76');
INSERT INTO "endpoints" VALUES('datatourisme-events','S001','datatourisme_events','https://api.datatourisme.fr/v1/entertainmentAndEvent','{}',0);
INSERT INTO "endpoints" VALUES('datatourisme-places','S001','datatourisme_places','https://api.datatourisme.fr/v1/placeOfInterest','{}',0);
INSERT INTO "endpoints" VALUES('openagenda-occitanie','S002','openagenda_agendas','https://api.openagenda.com/v2/agendas','{"search":"Occitanie"}',0);
INSERT INTO "endpoints" VALUES('openagenda-science','S002','openagenda_agendas','https://api.openagenda.com/v2/agendas','{"search":"Fête de la science"}',0);
INSERT INTO "endpoints" VALUES('openagenda-patrimoine','S002','openagenda_agendas','https://api.openagenda.com/v2/agendas','{"search":"Journées européennes du patrimoine"}',0);
INSERT INTO "endpoints" VALUES('occitanie-region','S007','occitanie_region_events','https://data.laregion.fr/api/explore/v2.1/catalog/datasets/agendas-participatif-des-sorties-en-occitanie/records','{}',0);
INSERT INTO "local_settings" VALUES(1,0,6,30,NULL,NULL);
INSERT INTO "registry_imports" VALUES('eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e','2026-10-10','2026-10-10T04:44:17+00:00',144,'{
  "title": "Occitanie school-trip event source registry",
  "as_of": "2026-10-10",
  "record_count": 144,
  "scope_note": "Research seed registry including multiple sections per domain, institution directories, technical endpoints, restricted access and candidates awaiting review. Not a census of all online sources.",
  "verification_note": "Initial research on 2026-10-10 distinguished page/search/documentation checks from production collection. This seed alone does not attest credentialed API tests, exhaustive pagination or individual licensing review. See current source reviews and collection runs.",
  "safety_defaults": {
    "enabled": false,
    "respect_robots_and_terms": true,
    "review_dataset_license": true,
    "follow_login_or_captcha_automatically": false,
    "submit_forms_automatically": false,
    "collect_attendee_personal_data": false,
    "download_media_by_default": false,
    "crawl_scope": "allowlisted_public_event_and_education_pages_only"
  },
  "geo_filter": {
    "region_name": "Occitanie",
    "department_codes": [
      "09",
      "11",
      "12",
      "30",
      "31",
      "32",
      "34",
      "46",
      "48",
      "65",
      "66",
      "81",
      "82"
    ]
  },
  "records": [
    {
      "source_id": "S001",
      "name": "DATAtourisme",
      "category": "Open data / aggregation API",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.datatourisme.fr/utiliser-les-donnees/",
      "proposed_connector": "datatourisme_rest_v1",
      "priority": "P0",
      "verification_status": "Official API documentation checked",
      "notes": "Free API key required; retrieve events and places separately. Initial research recorded the legacy Diffuseur transition in October 2026 and planned closure in October 2027; this seed is not a credentialed test report.",
      "evidence_url": "https://api.datatourisme.fr/v1/docs",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S002",
      "name": "OpenAgenda",
      "category": "Open calendars",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://openagenda.com/",
      "proposed_connector": "openagenda_api_v2",
      "priority": "P0",
      "verification_status": "Official API documentation checked",
      "notes": "Discover national and local calendars, filter by actual event location, collect authorized public content and deduplicate across calendars.",
      "evidence_url": "https://developers.openagenda.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S003",
      "name": "Apidae",
      "category": "Tourism information systems",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized feeds / technical entry",
      "entry_url": "https://dev.apidae-tourisme.com/",
      "proposed_connector": "apidae_authorized",
      "priority": "P1",
      "verification_status": "Official documentation entry retrieved",
      "notes": "Confirm project, API key, dataset scope and reuse authorization. Nationwide access is not assumed.",
      "evidence_url": "https://dev.apidae-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S004",
      "name": "Tourinsoft Syndications V3",
      "category": "Tourism information systems",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized feeds / technical entry",
      "entry_url": "https://api-v3.tourinsoft.com/Help/Syndications",
      "proposed_connector": "tourinsoft_syndication_v3_authorized",
      "priority": "P1",
      "verification_status": "Official API documentation checked",
      "notes": "Request client and syndicationId plus reuse permission from the tourism institution. Prefer syndication feeds to business administration APIs.",
      "evidence_url": "https://api-v3.tourinsoft.com/Help/Syndications",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S005",
      "name": "data.gouv.fr",
      "category": "Open data catalogues",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Dataset discovery",
      "entry_url": "https://www.data.gouv.fr/",
      "proposed_connector": "dataset_catalog_then_resource",
      "priority": "P1",
      "verification_status": "Official dataset found in search",
      "notes": "Discover tourism, event, museum and library datasets. Review dates, fields, licenses and refresh frequency for each dataset.",
      "evidence_url": "https://www.data.gouv.fr/datasets/datatourisme-la-plateforme-nationale-des-donnees-touristiques",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S006",
      "name": "Ministère de la Culture — données ouvertes",
      "category": "Open data catalogues",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Dataset / institution discovery",
      "entry_url": "https://culture.data.gouv.fr/",
      "proposed_connector": "dataset_discovery",
      "priority": "P1",
      "verification_status": "Only entry page retrieved",
      "notes": "Redirected from data.culture.gouv.fr. An institution directory is not a live event database.",
      "evidence_url": "https://culture.data.gouv.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": [
        "https://data.culture.gouv.fr/"
      ]
    },
    {
      "source_id": "S007",
      "name": "Région Occitanie — données ouvertes",
      "category": "Open data catalogues",
      "scope": "Occitanie",
      "department": "",
      "role": "Dataset / institution discovery",
      "entry_url": "https://data.laregion.fr/pages/accueil/",
      "proposed_connector": "dataset_discovery",
      "priority": "P1",
      "verification_status": "Only entry page retrieved",
      "notes": "Identify the specific agenda dataset and its license; a catalogue portal alone is not an event API.",
      "evidence_url": "https://data.laregion.fr/pages/accueil/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S008",
      "name": "Toulouse Métropole — données ouvertes",
      "category": "Open data catalogues",
      "scope": "Toulouse Métropole",
      "department": "31",
      "role": "Dataset / institution discovery",
      "entry_url": "https://data.toulouse-metropole.fr/",
      "proposed_connector": "dataset_discovery",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Find current event and venue datasets; no specific dataset ID was confirmed in initial research.",
      "evidence_url": "https://data.toulouse-metropole.fr/pages/demarche/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S009",
      "name": "Montpellier Métropole — données ouvertes",
      "category": "Open data catalogues",
      "scope": "Montpellier Métropole",
      "department": "34",
      "role": "Dataset / institution discovery",
      "entry_url": "https://data.montpellier3m.fr/",
      "proposed_connector": "dataset_discovery",
      "priority": "P1",
      "verification_status": "Official data catalogue found in search",
      "notes": "Verify license and edition year for each dataset; past cultural editions are not current schedules.",
      "evidence_url": "https://data.montpellier3m.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S010",
      "name": "France — API de découpage administratif",
      "category": "Geographic discovery infrastructure",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Administrative divisions; not an event source",
      "entry_url": "https://geo.api.gouv.fr/decoupage-administratif/regions",
      "proposed_connector": "geo_admin_api",
      "priority": "P0",
      "verification_status": "Official API documentation checked",
      "notes": "Enumerate regions, departments and communes to measure coverage and link actual event locations.",
      "evidence_url": "https://geo.api.gouv.fr/decoupage-administratif/regions",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S011",
      "name": "Région Occitanie — agenda",
      "category": "General events",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.laregion.fr/-agenda-occitanie-",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Official page confirmed in search",
      "notes": "Also discover culture and festival sections; trace aggregated records back to organizers.",
      "evidence_url": "https://www.laregion.fr/-agenda-occitanie-",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S012",
      "name": "Occitanie — tourisme officiel",
      "category": "Tourism / events",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-occitanie.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Official page confirmed in search",
      "notes": "Destinations, events and school/youth leads; check overlap with DATAtourisme.",
      "evidence_url": "https://www.tourisme-occitanie.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S013",
      "name": "DRAC Occitanie",
      "category": "Culture / education network",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.culture.gouv.fr/regions/drac-occitanie",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Cultural institutions, projects and event leads; calls for proposals are not attendable events.",
      "evidence_url": "https://www.culture.gouv.fr/regions/drac-occitanie",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S014",
      "name": "Science(s) en Occitanie",
      "category": "Science communication network",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.sciences-en-occitanie.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Former Echosciences Sud redirects here; includes events and organization discovery.",
      "evidence_url": "https://www.sciences-en-occitanie.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": [
        "https://www.echosciences-sud.fr/"
      ]
    },
    {
      "source_id": "S015",
      "name": "Instant Science",
      "category": "Science / school groups",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.instantscience.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda, teacher pages and school catalogues. Distinguish school visits from activities delivered at school.",
      "evidence_url": "https://www.instantscience.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S016",
      "name": "GRAINE Occitanie",
      "category": "Environmental education network",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://graine-occitanie.org/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Find member institutions and educational services. Adult professional training is not automatically suitable for students.",
      "evidence_url": "https://graine-occitanie.org/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S017",
      "name": "CEN Occitanie",
      "category": "Nature / conservation",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.cen-occitanie.org/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Nature activities and protected-area leads. Distinguish event venues from institution headquarters.",
      "evidence_url": "https://www.cen-occitanie.org/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S018",
      "name": "LPO Occitanie",
      "category": "Nature / biodiversity",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://occitanie.lpo.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Includes Agenda nature and departmental branches. Verify age, group size and booking for each activity.",
      "evidence_url": "https://occitanie.lpo.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S019",
      "name": "L’Agence Unique Occitanie Culture",
      "category": "Culture / books / institution network",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://lagenceunique-occitanieculture.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Former occitanielivre.fr redirects here. Cultural institution and event discovery.",
      "evidence_url": "https://lagenceunique-occitanieculture.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": [
        "https://www.occitanielivre.fr/"
      ]
    },
    {
      "source_id": "S020",
      "name": "Académie de Toulouse — DAAC",
      "category": "Educational institution network",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://pedagogie.ac-toulouse.fr/daac/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Related official page found in search",
      "notes": "Education partnerships and cultural institutions. ADAGE is not an unrestricted event catalogue API.",
      "evidence_url": "https://pedagogie.ac-toulouse.fr/daac/pass-culture-part-collectivepart-individuelle",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S021",
      "name": "Académie de Montpellier — ressources éducatives",
      "category": "Educational institution network",
      "scope": "Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://pedagogie.ac-montpellier.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Related official page found in search",
      "notes": "Museum educational services; keep teacher training separate from student trips.",
      "evidence_url": "https://pedagogie.ac-montpellier.fr/service-educatif-musee-fabre",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S022",
      "name": "Ariège — conseil départemental",
      "category": "Departmental government",
      "scope": "Ariège",
      "department": "09",
      "role": "Event publishing / aggregation",
      "entry_url": "https://ariege.fr/sortir-et-decouvrir/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Root domain returned HTTP 418 during research. Try indexed culture sections and authorized tourism feeds.",
      "evidence_url": "https://ariege.fr/sortir-et-decouvrir/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S023",
      "name": "Ariège — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Ariège",
      "department": "09",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.ariegepyrenees.com/preparer/agenda/tout-lagenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Official page confirmed in search",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.ariegepyrenees.com/preparer/agenda/tout-lagenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S024",
      "name": "Aude — conseil départemental",
      "category": "Departmental government",
      "scope": "Aude",
      "department": "11",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.aude.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Human verification required during research",
      "notes": "Human verification observed. Seek a partner feed, authorized allowlisting or manual access.",
      "evidence_url": "https://www.aude.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S025",
      "name": "Aude — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Aude",
      "department": "11",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.audetourisme.com/fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.audetourisme.com/fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S026",
      "name": "Aveyron — conseil départemental",
      "category": "Departmental government",
      "scope": "Aveyron",
      "department": "12",
      "role": "Event publishing / aggregation",
      "entry_url": "https://aveyron.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Only JavaScript / cookie notice returned",
      "notes": "The observed access issue is not proof of a permanent collection prohibition. Review permitted rendering and upstream feeds.",
      "evidence_url": "https://aveyron.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S027",
      "name": "Aveyron — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Aveyron",
      "department": "12",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-aveyron.com/fr/evenements/agenda-aveyron",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Official page confirmed in search",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourisme-aveyron.com/fr/evenements/agenda-aveyron",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S028",
      "name": "Gard — conseil départemental",
      "category": "Departmental government",
      "scope": "Gard",
      "department": "30",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.gard.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Agenda plus separate archives and library institutions.",
      "evidence_url": "https://www.gard.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S029",
      "name": "Gard — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Gard",
      "department": "30",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourismegard.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourismegard.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S030",
      "name": "Haute-Garonne — conseil départemental",
      "category": "Departmental government",
      "scope": "Haute-Garonne",
      "department": "31",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.haute-garonne.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Also inspect archives, cultural centres and school sections.",
      "evidence_url": "https://www.haute-garonne.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S031",
      "name": "Haute-Garonne — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Haute-Garonne",
      "department": "31",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.hautegaronnetourisme.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Official page confirmed in search; direct retrieval failed",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.hautegaronnetourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S032",
      "name": "Gers — conseil départemental",
      "category": "Departmental government",
      "scope": "Gers",
      "department": "32",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.gers.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Departmental heritage and event sections.",
      "evidence_url": "https://www.gers.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S033",
      "name": "Gers — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Gers",
      "department": "32",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-gers.com/agenda/tout-lagenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Official page confirmed in search",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourisme-gers.com/agenda/tout-lagenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S034",
      "name": "Hérault — conseil départemental",
      "category": "Departmental government",
      "scope": "Hérault",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://herault.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Retrieval failed during research",
      "notes": "Root and www retrieval failed during research. Retain as a candidate; do not infer closure or absence of events.",
      "evidence_url": "https://herault.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S035",
      "name": "Hérault — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Hérault",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.herault-tourisme.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.herault-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S036",
      "name": "Lot — conseil départemental",
      "category": "Departmental government",
      "scope": "Lot",
      "department": "46",
      "role": "Event publishing / aggregation",
      "entry_url": "https://lot.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Departmental culture, heritage and events.",
      "evidence_url": "https://lot.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S037",
      "name": "Lot — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Lot",
      "department": "46",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-lot.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourisme-lot.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S038",
      "name": "Lozère — conseil départemental",
      "category": "Departmental government",
      "scope": "Lozère",
      "department": "48",
      "role": "Event publishing / aggregation",
      "entry_url": "https://lozere.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Departmental culture and nature education leads.",
      "evidence_url": "https://lozere.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S039",
      "name": "Lozère — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Lozère",
      "department": "48",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.lozere-tourisme.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.lozere-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S040",
      "name": "Hautes-Pyrénées — conseil départemental",
      "category": "Departmental government",
      "scope": "Hautes-Pyrénées",
      "department": "65",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.hautespyrenees.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Retrieval failed during research",
      "notes": "Manual entry-point review and data partnership follow-up required.",
      "evidence_url": "https://www.hautespyrenees.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S041",
      "name": "Hautes-Pyrénées — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Hautes-Pyrénées",
      "department": "65",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-hautes-pyrenees.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourisme-hautes-pyrenees.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S042",
      "name": "Pyrénées-Orientales — conseil départemental",
      "category": "Departmental government",
      "scope": "Pyrénées-Orientales",
      "department": "66",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.ledepartement66.fr/agenda/les-rendez-vous-du-departement/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Web calendar and seasonal brochures. Downloaded documents require separate extraction and version tracking.",
      "evidence_url": "https://www.ledepartement66.fr/agenda/les-rendez-vous-du-departement/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S043",
      "name": "Pyrénées-Orientales — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Pyrénées-Orientales",
      "department": "66",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-pyreneesorientales.com/agenda/aujourdhui-demain-et-apres-demain/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Official page confirmed in search",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourisme-pyreneesorientales.com/agenda/aujourdhui-demain-et-apres-demain/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S044",
      "name": "Tarn — conseil départemental",
      "category": "Departmental government",
      "scope": "Tarn",
      "department": "81",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tarn.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Retrieval failed during research",
      "notes": "Manual entry-point review required; tourism site listed separately.",
      "evidence_url": "https://www.tarn.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S045",
      "name": "Tarn — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Tarn",
      "department": "81",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-tarn.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourisme-tarn.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S046",
      "name": "Tarn-et-Garonne — conseil départemental",
      "category": "Departmental government",
      "scope": "Tarn-et-Garonne",
      "department": "82",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tarnetgaronne.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Departmental agenda, culture and education sections.",
      "evidence_url": "https://www.tarnetgaronne.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S047",
      "name": "Tarn-et-Garonne — tourisme officiel",
      "category": "Departmental tourism",
      "scope": "Tarn-et-Garonne",
      "department": "82",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-tarnetgaronne.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P0",
      "verification_status": "Page retrieved",
      "notes": "Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.",
      "evidence_url": "https://www.tourisme-tarnetgaronne.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S048",
      "name": "Toulouse Métropole",
      "category": "Municipal / metropolitan government",
      "scope": "Toulouse Métropole",
      "department": "31",
      "role": "Event publishing / aggregation",
      "entry_url": "https://metropole.toulouse.fr/agenda",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Retrieval failed during research",
      "notes": "Public agenda link confirmed from a municipal institution page.",
      "evidence_url": "https://bibliotheque.toulouse.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S049",
      "name": "Toulouse Tourisme",
      "category": "Local tourism",
      "scope": "Toulouse Tourisme",
      "department": "31",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.toulouse-tourisme.com/agenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "HTTP 403 during research",
      "notes": "Ask about tourism upstream data or an authorized feed first.",
      "evidence_url": "https://www.toulouse-tourisme.com/agenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S050",
      "name": "Montpellier — agenda municipal",
      "category": "Municipal / metropolitan government",
      "scope": "Montpellier — agenda municipal",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.montpellier.fr/agenda",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Retrieval failed during research",
      "notes": "Current exact agenda entry requires review.",
      "evidence_url": "https://www.montpellier.fr/agenda",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S051",
      "name": "Montpellier Tourisme",
      "category": "Local tourism",
      "scope": "Montpellier Tourisme",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.montpellier-tourisme.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Discover event filters and group services.",
      "evidence_url": "https://www.montpellier-tourisme.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S052",
      "name": "Nîmes Tourisme",
      "category": "Local tourism",
      "scope": "Nîmes Tourisme",
      "department": "30",
      "role": "Event publishing / aggregation",
      "entry_url": "https://nimes-tourisme.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Only entry page retrieved",
      "notes": "www redirects to the bare domain; agenda and rendering need testing.",
      "evidence_url": "https://nimes-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S053",
      "name": "Perpignan Tourisme",
      "category": "Local tourism",
      "scope": "Perpignan Tourisme",
      "department": "66",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.perpignantourisme.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "HTTP 403 during research",
      "notes": "Consider authorization or an alternative upstream source; plain HTML success is not guaranteed.",
      "evidence_url": "https://www.perpignantourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S054",
      "name": "Carcassonne Tourisme",
      "category": "Local tourism",
      "scope": "Carcassonne Tourisme",
      "department": "11",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.carcassonne-tourisme.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "HTTP 502 during research",
      "notes": "Failure may be temporary or tool-specific; recheck.",
      "evidence_url": "https://www.carcassonne-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S055",
      "name": "Côte du Midi / Narbonne",
      "category": "Local tourism",
      "scope": "Côte du Midi / Narbonne",
      "department": "11",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.cotedumidi.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Former narbonne-tourisme.com redirects here.",
      "evidence_url": "https://www.cotedumidi.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": [
        "https://www.narbonne-tourisme.com/"
      ]
    },
    {
      "source_id": "S056",
      "name": "Albi Tourisme",
      "category": "Local tourism",
      "scope": "Albi Tourisme",
      "department": "81",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.albi-tourisme.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Review event, venue and school/group sections page by page.",
      "evidence_url": "https://www.albi-tourisme.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S057",
      "name": "Montauban Tourisme",
      "category": "Local tourism",
      "scope": "Montauban Tourisme",
      "department": "82",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.montauban-tourisme.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Local events and group programme leads.",
      "evidence_url": "https://www.montauban-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S058",
      "name": "Destination Auch",
      "category": "Local tourism",
      "scope": "Auch — destination",
      "department": "32",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-gers.com/destinations/auch/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Former auch-tourisme.com redirects to the Gers main site; not an independent upstream source.",
      "evidence_url": "https://www.tourisme-gers.com/destinations/auch/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": [
        "https://www.auch-tourisme.com/"
      ]
    },
    {
      "source_id": "S059",
      "name": "Tarbes Tourisme",
      "category": "Local tourism",
      "scope": "Tarbes Tourisme",
      "department": "65",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tarbes-tourisme.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Local event leads.",
      "evidence_url": "https://www.tarbes-tourisme.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S060",
      "name": "Rodez Tourisme",
      "category": "Local tourism",
      "scope": "Rodez Tourisme",
      "department": "12",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.rodez-tourisme.fr/agenda/les-grands-evenements/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "This entry covers major events; also discover the complete agenda.",
      "evidence_url": "https://www.rodez-tourisme.fr/agenda/les-grands-evenements/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S061",
      "name": "Foix Tourisme",
      "category": "Local tourism",
      "scope": "Foix Tourisme",
      "department": "09",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.foix-tourisme.com/agenda/fetes-animations/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Local event entry.",
      "evidence_url": "https://www.foix-tourisme.com/agenda/fetes-animations/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S062",
      "name": "Pyrénées Ariégeoises",
      "category": "Local tourism",
      "scope": "Pyrénées Ariégeoises",
      "department": "09",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.pyrenees-ariegeoises.com/a-voir-a-faire/sortir/agenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Do not assume every event is reachable by train.",
      "evidence_url": "https://www.pyrenees-ariegeoises.com/a-voir-a-faire/sortir/agenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S063",
      "name": "Pyrénées Cathares",
      "category": "Local tourism",
      "scope": "Pyrénées Cathares",
      "department": "09",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.pyreneescathares.com/sejourner/s-organiser/tout-l-agenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Local agenda listing.",
      "evidence_url": "https://www.pyreneescathares.com/sejourner/s-organiser/tout-l-agenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S064",
      "name": "Couserans Pyrénées",
      "category": "Local tourism",
      "scope": "Couserans Pyrénées",
      "department": "09",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-couserans-pyrenees.com/agenda/lagenda-des-evenements/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Local agenda listing.",
      "evidence_url": "https://www.tourisme-couserans-pyrenees.com/agenda/lagenda-des-evenements/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S065",
      "name": "Arize-Lèze",
      "category": "Local tourism",
      "scope": "Arize-Lèze",
      "department": "09",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-arize-leze.com/agenda/tout-lagenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Local agenda listing.",
      "evidence_url": "https://www.tourisme-arize-leze.com/agenda/tout-lagenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S066",
      "name": "Terres d’Aveyron",
      "category": "Local tourism",
      "scope": "Terres d’Aveyron",
      "department": "12",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.terresdaveyron.com/sejourner/agenda/tout-lagenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Local agenda listing.",
      "evidence_url": "https://www.terresdaveyron.com/sejourner/agenda/tout-lagenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S067",
      "name": "Bastides et Gorges de l’Aveyron",
      "category": "Local tourism",
      "scope": "Bastides et Gorges de l’Aveyron",
      "department": "12",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.bastides-gorges-aveyron.fr/l-agenda/tout-lagenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Local agenda; derive department from the actual event commune.",
      "evidence_url": "https://www.bastides-gorges-aveyron.fr/l-agenda/tout-lagenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S068",
      "name": "Aubrac",
      "category": "Local tourism",
      "scope": "Aubrac",
      "department": "12/48",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-en-aubrac.com/agenda-evenements/tout-lagenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Destination spans administrative boundaries; exclude events outside Occitanie.",
      "evidence_url": "https://www.tourisme-en-aubrac.com/agenda-evenements/tout-lagenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S069",
      "name": "Causses et Gorges de l’Aveyron",
      "category": "Local tourism",
      "scope": "Causses et Gorges de l’Aveyron",
      "department": "82",
      "role": "Event publishing / aggregation",
      "entry_url": "https://causses-gorgesaveyron.com/evenements-agenda-des-evenements-fetes-locales-et-festivals/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "An institution name containing Aveyron does not establish department 12 as the event location.",
      "evidence_url": "https://causses-gorgesaveyron.com/evenements-agenda-des-evenements-fetes-locales-et-festivals/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S070",
      "name": "Gers Armagnac",
      "category": "Local tourism",
      "scope": "Gers Armagnac",
      "department": "32",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.gers-armagnac.com/vivre/agenda/tout-lagenda/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Local agenda listing.",
      "evidence_url": "https://www.gers-armagnac.com/vivre/agenda/tout-lagenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S071",
      "name": "Vallespir",
      "category": "Local tourism",
      "scope": "Vallespir",
      "department": "66",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.vallespir-tourisme.fr/agenda/les-evenements-majeurs/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Major-event entry; discover other sections as well.",
      "evidence_url": "https://www.vallespir-tourisme.fr/agenda/les-evenements-majeurs/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S072",
      "name": "Saint-Guilhem / Vallée de l’Hérault",
      "category": "Local tourism",
      "scope": "Saint-Guilhem / Vallée de l’Hérault",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.saintguilhem-valleeherault.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Linked from official departmental site; target needs review",
      "notes": "Discovered through Hérault official tourism; target agenda and collection remain untested.",
      "evidence_url": "https://www.herault-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S073",
      "name": "Grand Pic Saint-Loup",
      "category": "Local tourism",
      "scope": "Grand Pic Saint-Loup",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.grandpicsaintloup-tourisme.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Linked from official departmental site; target needs review",
      "notes": "Discovered through Hérault official tourism; target agenda and collection remain untested.",
      "evidence_url": "https://www.herault-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S074",
      "name": "Salagou",
      "category": "Local tourism",
      "scope": "Salagou",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.destination-salagou.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Linked from official departmental site; target needs review",
      "notes": "Discovered through Hérault official tourism; target agenda and collection remain untested.",
      "evidence_url": "https://www.herault-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S075",
      "name": "La Grande Motte",
      "category": "Local tourism",
      "scope": "La Grande Motte",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.lagrandemotte.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Linked from official departmental site; target needs review",
      "notes": "Discovered through Hérault official tourism; target agenda and collection remain untested.",
      "evidence_url": "https://www.herault-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S076",
      "name": "Minervois-Caroux",
      "category": "Local tourism",
      "scope": "Minervois-Caroux",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.minervois-caroux.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Linked from official departmental site; target needs review",
      "notes": "Discovered through Hérault official tourism; target agenda and collection remain untested.",
      "evidence_url": "https://www.herault-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S077",
      "name": "Lodévois et Larzac",
      "category": "Local tourism",
      "scope": "Lodévois et Larzac",
      "department": "34",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.tourisme-lodevois-larzac.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Linked from official departmental site; target needs review",
      "notes": "Discovered through Hérault official tourism; target agenda and collection remain untested.",
      "evidence_url": "https://www.herault-tourisme.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S078",
      "name": "Fête de la science",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.fetedelascience.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Official reference confirmed; direct retrieval failed",
      "notes": "Theme: science. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://www.fetedelascience.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S079",
      "name": "Journées européennes du patrimoine",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://journeesdupatrimoine.culture.gouv.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: history / heritage. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://journeesdupatrimoine.culture.gouv.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S080",
      "name": "Nuit européenne des musées",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://nuitdesmusees.culture.gouv.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: museums. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://nuitdesmusees.culture.gouv.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S081",
      "name": "Rendez-vous aux jardins",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://rendezvousauxjardins.culture.gouv.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: nature / gardens. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://rendezvousauxjardins.culture.gouv.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S082",
      "name": "Journées nationales de l’architecture",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://journeesarchitecture.culture.gouv.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: architecture. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://journeesarchitecture.culture.gouv.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S083",
      "name": "Journées européennes de l’archéologie",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://journeesarcheologie.culture.gouv.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: archaeology. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://journeesarcheologie.culture.gouv.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S084",
      "name": "Nuits de la lecture",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.nuitsdelalecture.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: reading. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://www.nuitsdelalecture.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S085",
      "name": "Partir en Livre",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.partir-en-livre.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: youth reading. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://www.partir-en-livre.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S086",
      "name": "Fête de la nature",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://fetedelanature.com/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: nature. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://fetedelanature.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S087",
      "name": "Fête de la musique",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://fetedelamusique.culture.gouv.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Theme: music. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://fetedelamusique.culture.gouv.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S088",
      "name": "Semaine de l’industrie",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.entreprises.gouv.fr/semaine-de-lindustrie",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: industry / careers. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://www.entreprises.gouv.fr/semaine-de-lindustrie",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S089",
      "name": "Journées européennes des métiers d’art",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.journeesdesmetiersdart.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: crafts / careers. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://www.journeesdesmetiersdart.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S090",
      "name": "Association française d’astronomie",
      "category": "National themed events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.afastronomie.fr/",
      "proposed_connector": "current_edition_openagenda_uid_then_html",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Theme: astronomy. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.",
      "evidence_url": "https://www.afastronomie.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S091",
      "name": "Muséum de Toulouse",
      "category": "Venues / school services",
      "scope": "Muséum de Toulouse",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://museum.toulouse-metropole.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved; event list loads dynamically",
      "notes": "Natural sciences. Geolocate the main museum and Jardins separately.",
      "evidence_url": "https://museum.toulouse-metropole.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S092",
      "name": "Quai des Savoirs",
      "category": "Venues / school services",
      "scope": "Quai des Savoirs",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://quaidessavoirs.toulouse-metropole.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved; event list loads dynamically",
      "notes": "Science, digital culture, exhibitions and workshops.",
      "evidence_url": "https://quaidessavoirs.toulouse-metropole.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S093",
      "name": "Cité de l’espace",
      "category": "Venues / school services",
      "scope": "Cité de l’espace",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.cite-espace.com/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Retrieval failed during research",
      "notes": "Candidate space education venue; current school sections and collection method require review.",
      "evidence_url": "https://www.cite-espace.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S094",
      "name": "L’Envol des Pionniers",
      "category": "Venues / school services",
      "scope": "L’Envol des Pionniers",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.lenvol-des-pionniers.com/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Aviation history; inspect school/group sections.",
      "evidence_url": "https://www.lenvol-des-pionniers.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S095",
      "name": "Aeroscopia",
      "category": "Venues / school services",
      "scope": "Aeroscopia",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.aeroscopia.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Aviation; inspect school/group sections.",
      "evidence_url": "https://www.aeroscopia.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S096",
      "name": "Les Abattoirs",
      "category": "Venues / school services",
      "scope": "Les Abattoirs",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.lesabattoirs.org/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Art; entry may redirect according to language.",
      "evidence_url": "https://www.lesabattoirs.org/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S097",
      "name": "Musée Fabre — Enseignants",
      "category": "Venues / school services",
      "scope": "Musée Fabre — Enseignants",
      "department": "34",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.museefabre.fr/enseignants",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Official school page found in search",
      "notes": "Explicit school services. Also inspect scolaires and offre-de-visites-et-ateliers.",
      "evidence_url": "https://www.museefabre.fr/enseignants",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S098",
      "name": "MO.CO. — Événements",
      "category": "Venues / school services",
      "scope": "MO.CO. — Événements",
      "department": "34",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.moco.art/fr/evenement",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Official page confirmed in search",
      "notes": "Art events; school group conditions require separate verification.",
      "evidence_url": "https://www.moco.art/fr/evenement",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S099",
      "name": "Musée de la Romanité",
      "category": "Venues / school services",
      "scope": "Musée de la Romanité",
      "department": "30",
      "role": "Events and bookable educational services",
      "entry_url": "https://museedelaromanite.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Official page confirmed in search; direct retrieval failed",
      "notes": "History and archaeology; school entry visible in official search.",
      "evidence_url": "https://museedelaromanite.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S100",
      "name": "Narbo Via",
      "category": "Venues / school services",
      "scope": "Narbo Via",
      "department": "11",
      "role": "Events and bookable educational services",
      "entry_url": "https://narbovia.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Official event page found in search",
      "notes": "History and archaeology; bare domain. Separate school information from public events.",
      "evidence_url": "https://narbovia.fr/evenement/lessentiel-des-collections-2/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S101",
      "name": "Musée Soulages",
      "category": "Venues / school services",
      "scope": "Musée Soulages",
      "department": "12",
      "role": "Events and bookable educational services",
      "entry_url": "https://musee-soulages-rodez.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Art; separate educational activities from ticket availability.",
      "evidence_url": "https://musee-soulages-rodez.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S102",
      "name": "Musée Champollion",
      "category": "Venues / school services",
      "scope": "Musée Champollion",
      "department": "46",
      "role": "Events and bookable educational services",
      "entry_url": "https://musee-champollion.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Writing and history; collect school booking information page by page.",
      "evidence_url": "https://musee-champollion.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S103",
      "name": "Pont du Gard",
      "category": "Venues / school services",
      "scope": "Pont du Gard",
      "department": "30",
      "role": "Events and bookable educational services",
      "entry_url": "https://pontdugard.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Official teacher/school entry exists. Listing does not establish a walk of 20 minutes or less from a station.",
      "evidence_url": "https://pontdugard.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S104",
      "name": "Musée de Préhistoire de Tautavel",
      "category": "Venues / school services",
      "scope": "Musée de Préhistoire de Tautavel",
      "department": "66",
      "role": "Events and bookable educational services",
      "entry_url": "https://450000ans.com/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Official Scolaire and Groupes sections exist; calculate transport access separately.",
      "evidence_url": "https://450000ans.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S105",
      "name": "Sites Touristiques Ariège",
      "category": "Venues / school services",
      "scope": "Sites Touristiques Ariège",
      "department": "09",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.sites-touristiques-ariege.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Multiple venues and heritage sites. Record the actual venue for each activity.",
      "evidence_url": "https://www.sites-touristiques-ariege.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S106",
      "name": "Bibliothèques de Toulouse",
      "category": "Venues / school services",
      "scope": "Bibliothèques de Toulouse",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://bibliotheque.toulouse.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved; event list loads dynamically",
      "notes": "Reading, exhibitions and workshops; brochures coexist with the agenda.",
      "evidence_url": "https://bibliotheque.toulouse.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S107",
      "name": "Médiathèques Montpellier Métropole",
      "category": "Venues / school services",
      "scope": "Médiathèques Montpellier Métropole",
      "department": "34",
      "role": "Events and bookable educational services",
      "entry_url": "https://mediatheques.montpellier3m.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Only dynamic page shell retrieved",
      "notes": "A Places restantes label in a page template is not evidence of available inventory.",
      "evidence_url": "https://mediatheques.montpellier3m.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S108",
      "name": "Archives de la Haute-Garonne",
      "category": "Venues / school services",
      "scope": "Archives de la Haute-Garonne",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://archives.haute-garonne.fr/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Access denied during research",
      "notes": "Access Denied observed; seek authorization, upstream cultural calendars or manual input.",
      "evidence_url": "https://archives.haute-garonne.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S109",
      "name": "Théâtre de la Cité",
      "category": "Venues / school services",
      "scope": "Théâtre de la Cité",
      "department": "31",
      "role": "Events and bookable educational services",
      "entry_url": "https://theatre-cite.com/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Performance seasons, educational relations and brochures. Evening public performances are not automatically school sessions.",
      "evidence_url": "https://theatre-cite.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S110",
      "name": "L’Archipel — Perpignan",
      "category": "Venues / school services",
      "scope": "L’Archipel — Perpignan",
      "department": "66",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.theatredelarchipel.org/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Only entry page retrieved",
      "notes": "Theatre; detailed calendars and school activities require testing.",
      "evidence_url": "https://www.theatredelarchipel.org/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S111",
      "name": "Théâtre de Nîmes",
      "category": "Venues / school services",
      "scope": "Théâtre de Nîmes",
      "department": "30",
      "role": "Events and bookable educational services",
      "entry_url": "https://www.theatredenimes.com/",
      "proposed_connector": "agenda_school_pages_html_authorized_rendering",
      "priority": "P1",
      "verification_status": "Retrieval failed during research",
      "notes": "Candidate retained; current entry and school programmes require review.",
      "evidence_url": "https://www.theatredenimes.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S112",
      "name": "Centre des monuments nationaux",
      "category": "Heritage network",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Venue discovery / school services",
      "entry_url": "https://www.monuments-nationaux.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Find Occitanie venues through the national directory, then collect from the individual institutions.",
      "evidence_url": "https://www.monuments-nationaux.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S113",
      "name": "Réseau national des CPIE",
      "category": "Environmental education network",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Institution discovery / educational services",
      "entry_url": "https://www.cpie.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Discover local members and environmental education. The national page is not a complete Occitanie event database.",
      "evidence_url": "https://www.cpie.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S114",
      "name": "Fédération des Parcs naturels régionaux de France",
      "category": "Regional park network",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Institution discovery",
      "entry_url": "https://www.parcs-naturels-regionaux.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P1",
      "verification_status": "Page retrieved",
      "notes": "Discover Occitanie park websites, then collect their activities and educational services.",
      "evidence_url": "https://www.parcs-naturels-regionaux.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S115",
      "name": "Réseau Canopé",
      "category": "Educational institution network",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Educational resources / partnerships",
      "entry_url": "https://www.reseau-canope.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Much content is teacher training, not student outings.",
      "evidence_url": "https://www.reseau-canope.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S116",
      "name": "pass Culture / ADAGE",
      "category": "Education / authorized platform",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized educational offers / services",
      "entry_url": "https://pass.culture.fr/partenaires-techniques",
      "proposed_connector": "pass_culture_authorized_partnership",
      "priority": "P2",
      "verification_status": "Official partnership documentation checked",
      "notes": "Partner APIs do not provide unrestricted ADAGE catalogue access. Confirm teacher/institution permissions and partnership scope.",
      "evidence_url": "https://aide.passculture.app/hc/fr/articles/10616916478236--Acteurs-Culturels-Comment-synchroniser-votre-structure-pass-Culture-avec-un-partenaire-technique",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S117",
      "name": "AgendaCulturel",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.agendaculturel.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Culture, performances and exhibitions; filter by location and age. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://www.agendaculturel.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S118",
      "name": "JDS",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.jds.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "General events, including Toulouse and Montpellier; exclude unsuitable categories. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://www.jds.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S119",
      "name": "Spectable",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.spectable.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Art, courses and culture; distinguish recurring courses from single outings. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://www.spectable.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S120",
      "name": "Unidivers",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://unidivers.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Aggregated cultural events; trace upstream sources, duplicates and freshness. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://unidivers.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S121",
      "name": "Alentoor",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.alentoor.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Public event page found in search",
      "notes": "Local agenda; check original data sources. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://www.alentoor.fr/66-pyrenees-orientales/agenda/aujourdhui",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S122",
      "name": "Le Petit Agenda",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.lepetitagenda.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Public event page found in search",
      "notes": "Includes Pyrénées-Orientales and young-audience discovery filters. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://www.lepetitagenda.com/evenements/le-petit-agenda/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S123",
      "name": "CitizenKid",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.citizenkid.com/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Family and child recommendations do not establish school-group capacity. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://www.citizenkid.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S124",
      "name": "Familiscope",
      "category": "Commercial / editorial event listings",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.familiscope.fr/",
      "proposed_connector": "authorized_feed_then_html_or_jsonld",
      "priority": "P2",
      "verification_status": "Retrieval failed during research",
      "notes": "Family platform candidate; current availability and precise entry need review. Bulk redistribution permission and a full-platform reading API were not verified.",
      "evidence_url": "https://www.familiscope.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S125",
      "name": "HelloAsso",
      "category": "Associations / ticketing",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.helloasso.com/",
      "proposed_connector": "helloasso_authorized_directory",
      "priority": "P1",
      "verification_status": "Official API permission documentation checked",
      "notes": "Directory search requires appropriate FormOpenDirectory / OrganizationOpenDirectory permissions. Ordinary association keys do not automatically grant full directory search.",
      "evidence_url": "https://dev.helloasso.com/docs/privil%C3%A8ges-et-r%C3%B4les",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S126",
      "name": "Eventbrite",
      "category": "Ticketing / events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.eventbrite.fr/",
      "proposed_connector": "eventbrite_authorized_or_public_page",
      "priority": "P2",
      "verification_status": "Official API documentation found in search",
      "notes": "Official changelog records removal of general Event Search API. Use authorized organizations or known events; do not promise universal geographic search.",
      "evidence_url": "https://www.eventbrite.com/platform/docs/changelog",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S127",
      "name": "Meetup",
      "category": "Community events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.meetup.com/",
      "proposed_connector": "meetup_authorized",
      "priority": "P3",
      "verification_status": "Official API / Pro documentation checked; actual permissions untested",
      "notes": "Official GraphQL page describes API access with Meetup Pro; confirm permitted scope. Nationwide geographic search untested; assess school age and curriculum suitability separately.",
      "evidence_url": "https://www.meetup.com/graphql/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S128",
      "name": "Billetweb",
      "category": "Ticketing / events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.billetweb.fr/fr-fr/",
      "proposed_connector": "public_event_pages_or_written_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.",
      "evidence_url": "https://www.billetweb.fr/fr-fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S129",
      "name": "Weezevent",
      "category": "Ticketing / events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://weezevent.com/fr/",
      "proposed_connector": "public_event_pages_or_written_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.",
      "evidence_url": "https://weezevent.com/fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S130",
      "name": "Billet Réduc",
      "category": "Ticketing / events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.billetreduc.com/",
      "proposed_connector": "public_event_pages_or_written_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.",
      "evidence_url": "https://www.billetreduc.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S131",
      "name": "Fnac Spectacles",
      "category": "Ticketing / events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.fnacspectacles.com/",
      "proposed_connector": "public_event_pages_or_written_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.",
      "evidence_url": "https://www.fnacspectacles.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S132",
      "name": "Ticketmaster France",
      "category": "Ticketing / events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.ticketmaster.fr/",
      "proposed_connector": "ticketmaster_discovery_v2",
      "priority": "P2",
      "verification_status": "Official Discovery API documentation checked; frontend entry only",
      "notes": "Discovery API supports event/venue search and FR country code. Key required; actual France/Occitanie coverage untested in the seed research. Do not equate it with the entire frontend catalogue. Deep pagination limit of 1000 requires partitioned queries.",
      "evidence_url": "https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S133",
      "name": "Fever",
      "category": "Ticketing / events",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://feverup.com/",
      "proposed_connector": "public_event_pages_or_written_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.",
      "evidence_url": "https://feverup.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S134",
      "name": "PanneauPocket",
      "category": "Local information platforms",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.panneaupocket.com/",
      "proposed_connector": "public_page_review_or_platform_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Municipal event and notice discovery. No unrestricted third-party event API confirmed.",
      "evidence_url": "https://www.panneaupocket.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S135",
      "name": "IntraMuros",
      "category": "Local information platforms",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Event publishing / aggregation",
      "entry_url": "https://www.intramuros.org/",
      "proposed_connector": "public_page_review_or_platform_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Municipal event and notice discovery. No unrestricted third-party event API confirmed.",
      "evidence_url": "https://www.intramuros.org/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S136",
      "name": "La Dépêche",
      "category": "Local media",
      "scope": "Occitanie and the media coverage area",
      "department": "",
      "role": "Additional discovery / change verification",
      "entry_url": "https://www.ladepeche.fr/",
      "proposed_connector": "approved_public_sections_rss_or_media_partnership",
      "priority": "P2",
      "verification_status": "Page retrieved",
      "notes": "Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.",
      "evidence_url": "https://www.ladepeche.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S137",
      "name": "Midi Libre",
      "category": "Local media",
      "scope": "Occitanie and the media coverage area",
      "department": "",
      "role": "Additional discovery / change verification",
      "entry_url": "https://www.midilibre.fr/",
      "proposed_connector": "approved_public_sections_rss_or_media_partnership",
      "priority": "P2",
      "verification_status": "Retrieval failed during research",
      "notes": "Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.",
      "evidence_url": "https://www.midilibre.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S138",
      "name": "L’Indépendant",
      "category": "Local media",
      "scope": "Occitanie and the media coverage area",
      "department": "",
      "role": "Additional discovery / change verification",
      "entry_url": "https://www.lindependant.fr/",
      "proposed_connector": "approved_public_sections_rss_or_media_partnership",
      "priority": "P2",
      "verification_status": "Retrieval failed during research",
      "notes": "Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.",
      "evidence_url": "https://www.lindependant.fr/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S139",
      "name": "Facebook Pages / Events",
      "category": "Social platforms",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized content / discovery leads",
      "entry_url": "https://www.facebook.com/",
      "proposed_connector": "approved_api_or_organizer_submission",
      "priority": "P3",
      "verification_status": "Platform candidate; account / event collection untested",
      "notes": "Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.",
      "evidence_url": "https://www.facebook.com/legal/automated_data_collection_terms",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S140",
      "name": "Instagram",
      "category": "Social platforms",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized content / discovery leads",
      "entry_url": "https://www.instagram.com/",
      "proposed_connector": "approved_api_or_organizer_submission",
      "priority": "P3",
      "verification_status": "Platform candidate; account / event collection untested",
      "notes": "Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.",
      "evidence_url": "https://www.instagram.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S141",
      "name": "TikTok",
      "category": "Social platforms",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized content / discovery leads",
      "entry_url": "https://www.tiktok.com/",
      "proposed_connector": "approved_api_or_organizer_submission",
      "priority": "P3",
      "verification_status": "Platform candidate; account / event collection untested",
      "notes": "Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.",
      "evidence_url": "https://www.tiktok.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S142",
      "name": "LinkedIn Events",
      "category": "Social platforms",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized content / discovery leads",
      "entry_url": "https://www.linkedin.com/",
      "proposed_connector": "approved_api_or_organizer_submission",
      "priority": "P3",
      "verification_status": "Platform candidate; account / event collection untested",
      "notes": "Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.",
      "evidence_url": "https://www.linkedin.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S143",
      "name": "X",
      "category": "Social platforms",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Authorized content / discovery leads",
      "entry_url": "https://x.com/",
      "proposed_connector": "approved_api_or_organizer_submission",
      "priority": "P3",
      "verification_status": "Platform candidate; account / event collection untested",
      "notes": "Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.",
      "evidence_url": "https://x.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    },
    {
      "source_id": "S144",
      "name": "Calaméo — brochures des organisateurs",
      "category": "Online brochures",
      "scope": "France; filter by actual event location in Occitanie",
      "department": "",
      "role": "Document publishing",
      "entry_url": "https://www.calameo.com/",
      "proposed_connector": "organizer_original_documents_with_permission",
      "priority": "P2",
      "verification_status": "Official organizer outbound link confirmed",
      "notes": "An official Théâtre de la Cité page links its brochure. Reader access, download rights and reuse permission require separate checks.",
      "evidence_url": "https://theatre-cite.com/",
      "checked_on": "2026-10-10",
      "production_crawl_tested": false,
      "authorization_review": "Review license, terms, robots policy and API permissions for each source.",
      "enabled": false,
      "aliases": []
    }
  ]
}
');
INSERT INTO "schema_migrations" VALUES('001_initial','84e1ed37ea86acede67511ab40fd87c447703bd1850977f29a82e4808d20540e','2026-10-10T04:44:17+00:00');
INSERT INTO "schema_migrations" VALUES('002_region_dataset','47914e39f31e352f2eb6d13ef81025c12bd1957df87ddd768e4c93fe0cf71edc','2026-10-10T04:44:17+00:00');
INSERT INTO "schema_migrations" VALUES('003_quarantine_resolution','4214732a6c25cba02380cee9d17edb70ebd85555cb671eb610e47867a4102920','2026-10-10T04:44:17+00:00');
INSERT INTO "schema_migrations" VALUES('004_school_html','01abfd5d659092a93553358e8740dc9b1a41622b03875bf1ee70fe3d3dbf215b','2026-10-10T04:44:17+00:00');
INSERT INTO "schema_migrations" VALUES('005_local_app','a276047df1ac36e8cce81c62eb2251f1a8b4f52f4356cf46cd7255fcfed27bd0','2026-10-10T04:44:17+00:00');
INSERT INTO "schema_migrations" VALUES('006_rail_walk','b537238ca1ae40621b2d9c57bb470574e4d58e4718f0c3d2311168e3bd43124b','2026-10-10T04:44:17+00:00');
INSERT INTO "source_aliases" VALUES('S006','https://data.culture.gouv.fr/');
INSERT INTO "source_aliases" VALUES('S014','https://www.echosciences-sud.fr/');
INSERT INTO "source_aliases" VALUES('S019','https://www.occitanielivre.fr/');
INSERT INTO "source_aliases" VALUES('S055','https://www.narbonne-tourisme.com/');
INSERT INTO "source_aliases" VALUES('S058','https://www.auch-tourisme.com/');
INSERT INTO "source_departments" VALUES('S008','31');
INSERT INTO "source_departments" VALUES('S009','34');
INSERT INTO "source_departments" VALUES('S022','09');
INSERT INTO "source_departments" VALUES('S023','09');
INSERT INTO "source_departments" VALUES('S024','11');
INSERT INTO "source_departments" VALUES('S025','11');
INSERT INTO "source_departments" VALUES('S026','12');
INSERT INTO "source_departments" VALUES('S027','12');
INSERT INTO "source_departments" VALUES('S028','30');
INSERT INTO "source_departments" VALUES('S029','30');
INSERT INTO "source_departments" VALUES('S030','31');
INSERT INTO "source_departments" VALUES('S031','31');
INSERT INTO "source_departments" VALUES('S032','32');
INSERT INTO "source_departments" VALUES('S033','32');
INSERT INTO "source_departments" VALUES('S034','34');
INSERT INTO "source_departments" VALUES('S035','34');
INSERT INTO "source_departments" VALUES('S036','46');
INSERT INTO "source_departments" VALUES('S037','46');
INSERT INTO "source_departments" VALUES('S038','48');
INSERT INTO "source_departments" VALUES('S039','48');
INSERT INTO "source_departments" VALUES('S040','65');
INSERT INTO "source_departments" VALUES('S041','65');
INSERT INTO "source_departments" VALUES('S042','66');
INSERT INTO "source_departments" VALUES('S043','66');
INSERT INTO "source_departments" VALUES('S044','81');
INSERT INTO "source_departments" VALUES('S045','81');
INSERT INTO "source_departments" VALUES('S046','82');
INSERT INTO "source_departments" VALUES('S047','82');
INSERT INTO "source_departments" VALUES('S048','31');
INSERT INTO "source_departments" VALUES('S049','31');
INSERT INTO "source_departments" VALUES('S050','34');
INSERT INTO "source_departments" VALUES('S051','34');
INSERT INTO "source_departments" VALUES('S052','30');
INSERT INTO "source_departments" VALUES('S053','66');
INSERT INTO "source_departments" VALUES('S054','11');
INSERT INTO "source_departments" VALUES('S055','11');
INSERT INTO "source_departments" VALUES('S056','81');
INSERT INTO "source_departments" VALUES('S057','82');
INSERT INTO "source_departments" VALUES('S058','32');
INSERT INTO "source_departments" VALUES('S059','65');
INSERT INTO "source_departments" VALUES('S060','12');
INSERT INTO "source_departments" VALUES('S061','09');
INSERT INTO "source_departments" VALUES('S062','09');
INSERT INTO "source_departments" VALUES('S063','09');
INSERT INTO "source_departments" VALUES('S064','09');
INSERT INTO "source_departments" VALUES('S065','09');
INSERT INTO "source_departments" VALUES('S066','12');
INSERT INTO "source_departments" VALUES('S067','12');
INSERT INTO "source_departments" VALUES('S068','12');
INSERT INTO "source_departments" VALUES('S068','48');
INSERT INTO "source_departments" VALUES('S069','82');
INSERT INTO "source_departments" VALUES('S070','32');
INSERT INTO "source_departments" VALUES('S071','66');
INSERT INTO "source_departments" VALUES('S072','34');
INSERT INTO "source_departments" VALUES('S073','34');
INSERT INTO "source_departments" VALUES('S074','34');
INSERT INTO "source_departments" VALUES('S075','34');
INSERT INTO "source_departments" VALUES('S076','34');
INSERT INTO "source_departments" VALUES('S077','34');
INSERT INTO "source_departments" VALUES('S091','31');
INSERT INTO "source_departments" VALUES('S092','31');
INSERT INTO "source_departments" VALUES('S093','31');
INSERT INTO "source_departments" VALUES('S094','31');
INSERT INTO "source_departments" VALUES('S095','31');
INSERT INTO "source_departments" VALUES('S096','31');
INSERT INTO "source_departments" VALUES('S097','34');
INSERT INTO "source_departments" VALUES('S098','34');
INSERT INTO "source_departments" VALUES('S099','30');
INSERT INTO "source_departments" VALUES('S100','11');
INSERT INTO "source_departments" VALUES('S101','12');
INSERT INTO "source_departments" VALUES('S102','46');
INSERT INTO "source_departments" VALUES('S103','30');
INSERT INTO "source_departments" VALUES('S104','66');
INSERT INTO "source_departments" VALUES('S105','09');
INSERT INTO "source_departments" VALUES('S106','31');
INSERT INTO "source_departments" VALUES('S107','34');
INSERT INTO "source_departments" VALUES('S108','31');
INSERT INTO "source_departments" VALUES('S109','31');
INSERT INTO "source_departments" VALUES('S110','66');
INSERT INTO "source_departments" VALUES('S111','30');
INSERT INTO "sources" VALUES('S001','DATAtourisme','Open data / aggregation API','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.datatourisme.fr/utiliser-les-donnees/','datatourisme_rest_v1','P0','Official API documentation checked','Free API key required; retrieve events and places separately. Initial research recorded the legacy Diffuseur transition in October 2026 and planned closure in October 2027; this seed is not a credentialed test report.','https://api.datatourisme.fr/v1/docs','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Open data / aggregation API","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.datatourisme.fr/utiliser-les-donnees/","evidence_url":"https://api.datatourisme.fr/v1/docs","name":"DATAtourisme","notes":"Free API key required; retrieve events and places separately. Initial research recorded the legacy Diffuseur transition in October 2026 and planned closure in October 2027; this seed is not a credentialed test report.","priority":"P0","production_crawl_tested":false,"proposed_connector":"datatourisme_rest_v1","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S001","verification_status":"Official API documentation checked"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S002','OpenAgenda','Open calendars','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://openagenda.com/','openagenda_api_v2','P0','Official API documentation checked','Discover national and local calendars, filter by actual event location, collect authorized public content and deduplicate across calendars.','https://developers.openagenda.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Open calendars","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://openagenda.com/","evidence_url":"https://developers.openagenda.com/","name":"OpenAgenda","notes":"Discover national and local calendars, filter by actual event location, collect authorized public content and deduplicate across calendars.","priority":"P0","production_crawl_tested":false,"proposed_connector":"openagenda_api_v2","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S002","verification_status":"Official API documentation checked"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S003','Apidae','Tourism information systems','France; filter by actual event location in Occitanie','Authorized feeds / technical entry','https://dev.apidae-tourisme.com/','apidae_authorized','P1','Official documentation entry retrieved','Confirm project, API key, dataset scope and reuse authorization. Nationwide access is not assumed.','https://dev.apidae-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Tourism information systems","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://dev.apidae-tourisme.com/","evidence_url":"https://dev.apidae-tourisme.com/","name":"Apidae","notes":"Confirm project, API key, dataset scope and reuse authorization. Nationwide access is not assumed.","priority":"P1","production_crawl_tested":false,"proposed_connector":"apidae_authorized","role":"Authorized feeds / technical entry","scope":"France; filter by actual event location in Occitanie","source_id":"S003","verification_status":"Official documentation entry retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S004','Tourinsoft Syndications V3','Tourism information systems','France; filter by actual event location in Occitanie','Authorized feeds / technical entry','https://api-v3.tourinsoft.com/Help/Syndications','tourinsoft_syndication_v3_authorized','P1','Official API documentation checked','Request client and syndicationId plus reuse permission from the tourism institution. Prefer syndication feeds to business administration APIs.','https://api-v3.tourinsoft.com/Help/Syndications','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Tourism information systems","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://api-v3.tourinsoft.com/Help/Syndications","evidence_url":"https://api-v3.tourinsoft.com/Help/Syndications","name":"Tourinsoft Syndications V3","notes":"Request client and syndicationId plus reuse permission from the tourism institution. Prefer syndication feeds to business administration APIs.","priority":"P1","production_crawl_tested":false,"proposed_connector":"tourinsoft_syndication_v3_authorized","role":"Authorized feeds / technical entry","scope":"France; filter by actual event location in Occitanie","source_id":"S004","verification_status":"Official API documentation checked"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S005','data.gouv.fr','Open data catalogues','France; filter by actual event location in Occitanie','Dataset discovery','https://www.data.gouv.fr/','dataset_catalog_then_resource','P1','Official dataset found in search','Discover tourism, event, museum and library datasets. Review dates, fields, licenses and refresh frequency for each dataset.','https://www.data.gouv.fr/datasets/datatourisme-la-plateforme-nationale-des-donnees-touristiques','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Open data catalogues","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.data.gouv.fr/","evidence_url":"https://www.data.gouv.fr/datasets/datatourisme-la-plateforme-nationale-des-donnees-touristiques","name":"data.gouv.fr","notes":"Discover tourism, event, museum and library datasets. Review dates, fields, licenses and refresh frequency for each dataset.","priority":"P1","production_crawl_tested":false,"proposed_connector":"dataset_catalog_then_resource","role":"Dataset discovery","scope":"France; filter by actual event location in Occitanie","source_id":"S005","verification_status":"Official dataset found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S006','Ministère de la Culture — données ouvertes','Open data catalogues','France; filter by actual event location in Occitanie','Dataset / institution discovery','https://culture.data.gouv.fr/','dataset_discovery','P1','Only entry page retrieved','Redirected from data.culture.gouv.fr. An institution directory is not a live event database.','https://culture.data.gouv.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":["https://data.culture.gouv.fr/"],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Open data catalogues","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://culture.data.gouv.fr/","evidence_url":"https://culture.data.gouv.fr/","name":"Ministère de la Culture — données ouvertes","notes":"Redirected from data.culture.gouv.fr. An institution directory is not a live event database.","priority":"P1","production_crawl_tested":false,"proposed_connector":"dataset_discovery","role":"Dataset / institution discovery","scope":"France; filter by actual event location in Occitanie","source_id":"S006","verification_status":"Only entry page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S007','Région Occitanie — données ouvertes','Open data catalogues','Occitanie','Dataset / institution discovery','https://data.laregion.fr/pages/accueil/','dataset_discovery','P1','Only entry page retrieved','Identify the specific agenda dataset and its license; a catalogue portal alone is not an event API.','https://data.laregion.fr/pages/accueil/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Open data catalogues","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://data.laregion.fr/pages/accueil/","evidence_url":"https://data.laregion.fr/pages/accueil/","name":"Région Occitanie — données ouvertes","notes":"Identify the specific agenda dataset and its license; a catalogue portal alone is not an event API.","priority":"P1","production_crawl_tested":false,"proposed_connector":"dataset_discovery","role":"Dataset / institution discovery","scope":"Occitanie","source_id":"S007","verification_status":"Only entry page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S008','Toulouse Métropole — données ouvertes','Open data catalogues','Toulouse Métropole','Dataset / institution discovery','https://data.toulouse-metropole.fr/','dataset_discovery','P1','Official page confirmed in search','Find current event and venue datasets; no specific dataset ID was confirmed in initial research.','https://data.toulouse-metropole.fr/pages/demarche/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Open data catalogues","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://data.toulouse-metropole.fr/","evidence_url":"https://data.toulouse-metropole.fr/pages/demarche/","name":"Toulouse Métropole — données ouvertes","notes":"Find current event and venue datasets; no specific dataset ID was confirmed in initial research.","priority":"P1","production_crawl_tested":false,"proposed_connector":"dataset_discovery","role":"Dataset / institution discovery","scope":"Toulouse Métropole","source_id":"S008","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S009','Montpellier Métropole — données ouvertes','Open data catalogues','Montpellier Métropole','Dataset / institution discovery','https://data.montpellier3m.fr/','dataset_discovery','P1','Official data catalogue found in search','Verify license and edition year for each dataset; past cultural editions are not current schedules.','https://data.montpellier3m.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Open data catalogues","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://data.montpellier3m.fr/","evidence_url":"https://data.montpellier3m.fr/","name":"Montpellier Métropole — données ouvertes","notes":"Verify license and edition year for each dataset; past cultural editions are not current schedules.","priority":"P1","production_crawl_tested":false,"proposed_connector":"dataset_discovery","role":"Dataset / institution discovery","scope":"Montpellier Métropole","source_id":"S009","verification_status":"Official data catalogue found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S010','France — API de découpage administratif','Geographic discovery infrastructure','France; filter by actual event location in Occitanie','Administrative divisions; not an event source','https://geo.api.gouv.fr/decoupage-administratif/regions','geo_admin_api','P0','Official API documentation checked','Enumerate regions, departments and communes to measure coverage and link actual event locations.','https://geo.api.gouv.fr/decoupage-administratif/regions','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Geographic discovery infrastructure","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://geo.api.gouv.fr/decoupage-administratif/regions","evidence_url":"https://geo.api.gouv.fr/decoupage-administratif/regions","name":"France — API de découpage administratif","notes":"Enumerate regions, departments and communes to measure coverage and link actual event locations.","priority":"P0","production_crawl_tested":false,"proposed_connector":"geo_admin_api","role":"Administrative divisions; not an event source","scope":"France; filter by actual event location in Occitanie","source_id":"S010","verification_status":"Official API documentation checked"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S011','Région Occitanie — agenda','General events','Occitanie','Event publishing / aggregation','https://www.laregion.fr/-agenda-occitanie-','authorized_feed_then_html_or_jsonld','P0','Official page confirmed in search','Also discover culture and festival sections; trace aggregated records back to organizers.','https://www.laregion.fr/-agenda-occitanie-','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"General events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.laregion.fr/-agenda-occitanie-","evidence_url":"https://www.laregion.fr/-agenda-occitanie-","name":"Région Occitanie — agenda","notes":"Also discover culture and festival sections; trace aggregated records back to organizers.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S011","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S012','Occitanie — tourisme officiel','Tourism / events','Occitanie','Event publishing / aggregation','https://www.tourisme-occitanie.com/','authorized_feed_then_html_or_jsonld','P0','Official page confirmed in search','Destinations, events and school/youth leads; check overlap with DATAtourisme.','https://www.tourisme-occitanie.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Tourism / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.tourisme-occitanie.com/","evidence_url":"https://www.tourisme-occitanie.com/","name":"Occitanie — tourisme officiel","notes":"Destinations, events and school/youth leads; check overlap with DATAtourisme.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S012","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S013','DRAC Occitanie','Culture / education network','Occitanie','Event publishing / aggregation','https://www.culture.gouv.fr/regions/drac-occitanie','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Cultural institutions, projects and event leads; calls for proposals are not attendable events.','https://www.culture.gouv.fr/regions/drac-occitanie','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Culture / education network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.culture.gouv.fr/regions/drac-occitanie","evidence_url":"https://www.culture.gouv.fr/regions/drac-occitanie","name":"DRAC Occitanie","notes":"Cultural institutions, projects and event leads; calls for proposals are not attendable events.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S013","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S014','Science(s) en Occitanie','Science communication network','Occitanie','Event publishing / aggregation','https://www.sciences-en-occitanie.fr/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Former Echosciences Sud redirects here; includes events and organization discovery.','https://www.sciences-en-occitanie.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":["https://www.echosciences-sud.fr/"],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Science communication network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.sciences-en-occitanie.fr/","evidence_url":"https://www.sciences-en-occitanie.fr/","name":"Science(s) en Occitanie","notes":"Former Echosciences Sud redirects here; includes events and organization discovery.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S014","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S015','Instant Science','Science / school groups','Occitanie','Event publishing / aggregation','https://www.instantscience.fr/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda, teacher pages and school catalogues. Distinguish school visits from activities delivered at school.','https://www.instantscience.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Science / school groups","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.instantscience.fr/","evidence_url":"https://www.instantscience.fr/","name":"Instant Science","notes":"Collect agenda, teacher pages and school catalogues. Distinguish school visits from activities delivered at school.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S015","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S016','GRAINE Occitanie','Environmental education network','Occitanie','Event publishing / aggregation','https://graine-occitanie.org/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Find member institutions and educational services. Adult professional training is not automatically suitable for students.','https://graine-occitanie.org/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Environmental education network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://graine-occitanie.org/","evidence_url":"https://graine-occitanie.org/","name":"GRAINE Occitanie","notes":"Find member institutions and educational services. Adult professional training is not automatically suitable for students.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S016","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S017','CEN Occitanie','Nature / conservation','Occitanie','Event publishing / aggregation','https://www.cen-occitanie.org/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Nature activities and protected-area leads. Distinguish event venues from institution headquarters.','https://www.cen-occitanie.org/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Nature / conservation","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.cen-occitanie.org/","evidence_url":"https://www.cen-occitanie.org/","name":"CEN Occitanie","notes":"Nature activities and protected-area leads. Distinguish event venues from institution headquarters.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S017","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S018','LPO Occitanie','Nature / biodiversity','Occitanie','Event publishing / aggregation','https://occitanie.lpo.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Includes Agenda nature and departmental branches. Verify age, group size and booking for each activity.','https://occitanie.lpo.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Nature / biodiversity","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://occitanie.lpo.fr/","evidence_url":"https://occitanie.lpo.fr/","name":"LPO Occitanie","notes":"Includes Agenda nature and departmental branches. Verify age, group size and booking for each activity.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S018","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S019','L’Agence Unique Occitanie Culture','Culture / books / institution network','Occitanie','Event publishing / aggregation','https://lagenceunique-occitanieculture.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Former occitanielivre.fr redirects here. Cultural institution and event discovery.','https://lagenceunique-occitanieculture.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":["https://www.occitanielivre.fr/"],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Culture / books / institution network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://lagenceunique-occitanieculture.fr/","evidence_url":"https://lagenceunique-occitanieculture.fr/","name":"L’Agence Unique Occitanie Culture","notes":"Former occitanielivre.fr redirects here. Cultural institution and event discovery.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S019","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S020','Académie de Toulouse — DAAC','Educational institution network','Occitanie','Event publishing / aggregation','https://pedagogie.ac-toulouse.fr/daac/','authorized_feed_then_html_or_jsonld','P1','Related official page found in search','Education partnerships and cultural institutions. ADAGE is not an unrestricted event catalogue API.','https://pedagogie.ac-toulouse.fr/daac/pass-culture-part-collectivepart-individuelle','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Educational institution network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://pedagogie.ac-toulouse.fr/daac/","evidence_url":"https://pedagogie.ac-toulouse.fr/daac/pass-culture-part-collectivepart-individuelle","name":"Académie de Toulouse — DAAC","notes":"Education partnerships and cultural institutions. ADAGE is not an unrestricted event catalogue API.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S020","verification_status":"Related official page found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S021','Académie de Montpellier — ressources éducatives','Educational institution network','Occitanie','Event publishing / aggregation','https://pedagogie.ac-montpellier.fr/','authorized_feed_then_html_or_jsonld','P1','Related official page found in search','Museum educational services; keep teacher training separate from student trips.','https://pedagogie.ac-montpellier.fr/service-educatif-musee-fabre','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Educational institution network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://pedagogie.ac-montpellier.fr/","evidence_url":"https://pedagogie.ac-montpellier.fr/service-educatif-musee-fabre","name":"Académie de Montpellier — ressources éducatives","notes":"Museum educational services; keep teacher training separate from student trips.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Occitanie","source_id":"S021","verification_status":"Related official page found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S022','Ariège — conseil départemental','Departmental government','Ariège','Event publishing / aggregation','https://ariege.fr/sortir-et-decouvrir/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Root domain returned HTTP 418 during research. Try indexed culture sections and authorized tourism feeds.','https://ariege.fr/sortir-et-decouvrir/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://ariege.fr/sortir-et-decouvrir/","evidence_url":"https://ariege.fr/sortir-et-decouvrir/","name":"Ariège — conseil départemental","notes":"Root domain returned HTTP 418 during research. Try indexed culture sections and authorized tourism feeds.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Ariège","source_id":"S022","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S023','Ariège — tourisme officiel','Departmental tourism','Ariège','Event publishing / aggregation','https://www.ariegepyrenees.com/preparer/agenda/tout-lagenda/','authorized_feed_then_html_or_jsonld','P0','Official page confirmed in search','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.ariegepyrenees.com/preparer/agenda/tout-lagenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://www.ariegepyrenees.com/preparer/agenda/tout-lagenda/","evidence_url":"https://www.ariegepyrenees.com/preparer/agenda/tout-lagenda/","name":"Ariège — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Ariège","source_id":"S023","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S024','Aude — conseil départemental','Departmental government','Aude','Event publishing / aggregation','https://www.aude.fr/','authorized_feed_then_html_or_jsonld','P1','Human verification required during research','Human verification observed. Seek a partner feed, authorized allowlisting or manual access.','https://www.aude.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"11","enabled":false,"entry_url":"https://www.aude.fr/","evidence_url":"https://www.aude.fr/","name":"Aude — conseil départemental","notes":"Human verification observed. Seek a partner feed, authorized allowlisting or manual access.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Aude","source_id":"S024","verification_status":"Human verification required during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S025','Aude — tourisme officiel','Departmental tourism','Aude','Event publishing / aggregation','https://www.audetourisme.com/fr/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.audetourisme.com/fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"11","enabled":false,"entry_url":"https://www.audetourisme.com/fr/","evidence_url":"https://www.audetourisme.com/fr/","name":"Aude — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Aude","source_id":"S025","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S026','Aveyron — conseil départemental','Departmental government','Aveyron','Event publishing / aggregation','https://aveyron.fr/','authorized_feed_then_html_or_jsonld','P1','Only JavaScript / cookie notice returned','The observed access issue is not proof of a permanent collection prohibition. Review permitted rendering and upstream feeds.','https://aveyron.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"12","enabled":false,"entry_url":"https://aveyron.fr/","evidence_url":"https://aveyron.fr/","name":"Aveyron — conseil départemental","notes":"The observed access issue is not proof of a permanent collection prohibition. Review permitted rendering and upstream feeds.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Aveyron","source_id":"S026","verification_status":"Only JavaScript / cookie notice returned"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S027','Aveyron — tourisme officiel','Departmental tourism','Aveyron','Event publishing / aggregation','https://www.tourisme-aveyron.com/fr/evenements/agenda-aveyron','authorized_feed_then_html_or_jsonld','P0','Official page confirmed in search','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourisme-aveyron.com/fr/evenements/agenda-aveyron','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"12","enabled":false,"entry_url":"https://www.tourisme-aveyron.com/fr/evenements/agenda-aveyron","evidence_url":"https://www.tourisme-aveyron.com/fr/evenements/agenda-aveyron","name":"Aveyron — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Aveyron","source_id":"S027","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S028','Gard — conseil départemental','Departmental government','Gard','Event publishing / aggregation','https://www.gard.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Agenda plus separate archives and library institutions.','https://www.gard.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"30","enabled":false,"entry_url":"https://www.gard.fr/","evidence_url":"https://www.gard.fr/","name":"Gard — conseil départemental","notes":"Agenda plus separate archives and library institutions.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Gard","source_id":"S028","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S029','Gard — tourisme officiel','Departmental tourism','Gard','Event publishing / aggregation','https://www.tourismegard.com/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourismegard.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"30","enabled":false,"entry_url":"https://www.tourismegard.com/","evidence_url":"https://www.tourismegard.com/","name":"Gard — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Gard","source_id":"S029","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S030','Haute-Garonne — conseil départemental','Departmental government','Haute-Garonne','Event publishing / aggregation','https://www.haute-garonne.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Also inspect archives, cultural centres and school sections.','https://www.haute-garonne.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://www.haute-garonne.fr/","evidence_url":"https://www.haute-garonne.fr/","name":"Haute-Garonne — conseil départemental","notes":"Also inspect archives, cultural centres and school sections.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Haute-Garonne","source_id":"S030","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S031','Haute-Garonne — tourisme officiel','Departmental tourism','Haute-Garonne','Event publishing / aggregation','https://www.hautegaronnetourisme.com/','authorized_feed_then_html_or_jsonld','P0','Official page confirmed in search; direct retrieval failed','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.hautegaronnetourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://www.hautegaronnetourisme.com/","evidence_url":"https://www.hautegaronnetourisme.com/","name":"Haute-Garonne — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Haute-Garonne","source_id":"S031","verification_status":"Official page confirmed in search; direct retrieval failed"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S032','Gers — conseil départemental','Departmental government','Gers','Event publishing / aggregation','https://www.gers.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Departmental heritage and event sections.','https://www.gers.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"32","enabled":false,"entry_url":"https://www.gers.fr/","evidence_url":"https://www.gers.fr/","name":"Gers — conseil départemental","notes":"Departmental heritage and event sections.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Gers","source_id":"S032","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S033','Gers — tourisme officiel','Departmental tourism','Gers','Event publishing / aggregation','https://www.tourisme-gers.com/agenda/tout-lagenda/','authorized_feed_then_html_or_jsonld','P0','Official page confirmed in search','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourisme-gers.com/agenda/tout-lagenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"32","enabled":false,"entry_url":"https://www.tourisme-gers.com/agenda/tout-lagenda/","evidence_url":"https://www.tourisme-gers.com/agenda/tout-lagenda/","name":"Gers — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Gers","source_id":"S033","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S034','Hérault — conseil départemental','Departmental government','Hérault','Event publishing / aggregation','https://herault.fr/','authorized_feed_then_html_or_jsonld','P1','Retrieval failed during research','Root and www retrieval failed during research. Retain as a candidate; do not infer closure or absence of events.','https://herault.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://herault.fr/","evidence_url":"https://herault.fr/","name":"Hérault — conseil départemental","notes":"Root and www retrieval failed during research. Retain as a candidate; do not infer closure or absence of events.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Hérault","source_id":"S034","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S035','Hérault — tourisme officiel','Departmental tourism','Hérault','Event publishing / aggregation','https://www.herault-tourisme.com/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.herault-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.herault-tourisme.com/","evidence_url":"https://www.herault-tourisme.com/","name":"Hérault — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Hérault","source_id":"S035","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S036','Lot — conseil départemental','Departmental government','Lot','Event publishing / aggregation','https://lot.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Departmental culture, heritage and events.','https://lot.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"46","enabled":false,"entry_url":"https://lot.fr/","evidence_url":"https://lot.fr/","name":"Lot — conseil départemental","notes":"Departmental culture, heritage and events.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Lot","source_id":"S036","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S037','Lot — tourisme officiel','Departmental tourism','Lot','Event publishing / aggregation','https://www.tourisme-lot.com/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourisme-lot.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"46","enabled":false,"entry_url":"https://www.tourisme-lot.com/","evidence_url":"https://www.tourisme-lot.com/","name":"Lot — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Lot","source_id":"S037","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S038','Lozère — conseil départemental','Departmental government','Lozère','Event publishing / aggregation','https://lozere.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Departmental culture and nature education leads.','https://lozere.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"48","enabled":false,"entry_url":"https://lozere.fr/","evidence_url":"https://lozere.fr/","name":"Lozère — conseil départemental","notes":"Departmental culture and nature education leads.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Lozère","source_id":"S038","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S039','Lozère — tourisme officiel','Departmental tourism','Lozère','Event publishing / aggregation','https://www.lozere-tourisme.com/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.lozere-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"48","enabled":false,"entry_url":"https://www.lozere-tourisme.com/","evidence_url":"https://www.lozere-tourisme.com/","name":"Lozère — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Lozère","source_id":"S039","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S040','Hautes-Pyrénées — conseil départemental','Departmental government','Hautes-Pyrénées','Event publishing / aggregation','https://www.hautespyrenees.fr/','authorized_feed_then_html_or_jsonld','P1','Retrieval failed during research','Manual entry-point review and data partnership follow-up required.','https://www.hautespyrenees.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"65","enabled":false,"entry_url":"https://www.hautespyrenees.fr/","evidence_url":"https://www.hautespyrenees.fr/","name":"Hautes-Pyrénées — conseil départemental","notes":"Manual entry-point review and data partnership follow-up required.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Hautes-Pyrénées","source_id":"S040","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S041','Hautes-Pyrénées — tourisme officiel','Departmental tourism','Hautes-Pyrénées','Event publishing / aggregation','https://www.tourisme-hautes-pyrenees.com/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourisme-hautes-pyrenees.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"65","enabled":false,"entry_url":"https://www.tourisme-hautes-pyrenees.com/","evidence_url":"https://www.tourisme-hautes-pyrenees.com/","name":"Hautes-Pyrénées — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Hautes-Pyrénées","source_id":"S041","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S042','Pyrénées-Orientales — conseil départemental','Departmental government','Pyrénées-Orientales','Event publishing / aggregation','https://www.ledepartement66.fr/agenda/les-rendez-vous-du-departement/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Web calendar and seasonal brochures. Downloaded documents require separate extraction and version tracking.','https://www.ledepartement66.fr/agenda/les-rendez-vous-du-departement/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"66","enabled":false,"entry_url":"https://www.ledepartement66.fr/agenda/les-rendez-vous-du-departement/","evidence_url":"https://www.ledepartement66.fr/agenda/les-rendez-vous-du-departement/","name":"Pyrénées-Orientales — conseil départemental","notes":"Web calendar and seasonal brochures. Downloaded documents require separate extraction and version tracking.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Pyrénées-Orientales","source_id":"S042","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S043','Pyrénées-Orientales — tourisme officiel','Departmental tourism','Pyrénées-Orientales','Event publishing / aggregation','https://www.tourisme-pyreneesorientales.com/agenda/aujourdhui-demain-et-apres-demain/','authorized_feed_then_html_or_jsonld','P0','Official page confirmed in search','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourisme-pyreneesorientales.com/agenda/aujourdhui-demain-et-apres-demain/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"66","enabled":false,"entry_url":"https://www.tourisme-pyreneesorientales.com/agenda/aujourdhui-demain-et-apres-demain/","evidence_url":"https://www.tourisme-pyreneesorientales.com/agenda/aujourdhui-demain-et-apres-demain/","name":"Pyrénées-Orientales — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Pyrénées-Orientales","source_id":"S043","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S044','Tarn — conseil départemental','Departmental government','Tarn','Event publishing / aggregation','https://www.tarn.fr/','authorized_feed_then_html_or_jsonld','P1','Retrieval failed during research','Manual entry-point review required; tourism site listed separately.','https://www.tarn.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"81","enabled":false,"entry_url":"https://www.tarn.fr/","evidence_url":"https://www.tarn.fr/","name":"Tarn — conseil départemental","notes":"Manual entry-point review required; tourism site listed separately.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Tarn","source_id":"S044","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S045','Tarn — tourisme officiel','Departmental tourism','Tarn','Event publishing / aggregation','https://www.tourisme-tarn.com/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourisme-tarn.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"81","enabled":false,"entry_url":"https://www.tourisme-tarn.com/","evidence_url":"https://www.tourisme-tarn.com/","name":"Tarn — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Tarn","source_id":"S045","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S046','Tarn-et-Garonne — conseil départemental','Departmental government','Tarn-et-Garonne','Event publishing / aggregation','https://www.tarnetgaronne.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Departmental agenda, culture and education sections.','https://www.tarnetgaronne.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental government","checked_on":"2026-10-10","department":"82","enabled":false,"entry_url":"https://www.tarnetgaronne.fr/","evidence_url":"https://www.tarnetgaronne.fr/","name":"Tarn-et-Garonne — conseil départemental","notes":"Departmental agenda, culture and education sections.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Tarn-et-Garonne","source_id":"S046","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S047','Tarn-et-Garonne — tourisme officiel','Departmental tourism','Tarn-et-Garonne','Event publishing / aggregation','https://www.tourisme-tarnetgaronne.fr/','authorized_feed_then_html_or_jsonld','P0','Page retrieved','Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.','https://www.tourisme-tarnetgaronne.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Departmental tourism","checked_on":"2026-10-10","department":"82","enabled":false,"entry_url":"https://www.tourisme-tarnetgaronne.fr/","evidence_url":"https://www.tourisme-tarnetgaronne.fr/","name":"Tarn-et-Garonne — tourisme officiel","notes":"Collect agenda lists and detail pages; first check DATAtourisme or an authorized tourism feed from the institution.","priority":"P0","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Tarn-et-Garonne","source_id":"S047","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S048','Toulouse Métropole','Municipal / metropolitan government','Toulouse Métropole','Event publishing / aggregation','https://metropole.toulouse.fr/agenda','authorized_feed_then_html_or_jsonld','P1','Retrieval failed during research','Public agenda link confirmed from a municipal institution page.','https://bibliotheque.toulouse.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Municipal / metropolitan government","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://metropole.toulouse.fr/agenda","evidence_url":"https://bibliotheque.toulouse.fr/","name":"Toulouse Métropole","notes":"Public agenda link confirmed from a municipal institution page.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Toulouse Métropole","source_id":"S048","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S049','Toulouse Tourisme','Local tourism','Toulouse Tourisme','Event publishing / aggregation','https://www.toulouse-tourisme.com/agenda/','authorized_feed_then_html_or_jsonld','P1','HTTP 403 during research','Ask about tourism upstream data or an authorized feed first.','https://www.toulouse-tourisme.com/agenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://www.toulouse-tourisme.com/agenda/","evidence_url":"https://www.toulouse-tourisme.com/agenda/","name":"Toulouse Tourisme","notes":"Ask about tourism upstream data or an authorized feed first.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Toulouse Tourisme","source_id":"S049","verification_status":"HTTP 403 during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S050','Montpellier — agenda municipal','Municipal / metropolitan government','Montpellier — agenda municipal','Event publishing / aggregation','https://www.montpellier.fr/agenda','authorized_feed_then_html_or_jsonld','P1','Retrieval failed during research','Current exact agenda entry requires review.','https://www.montpellier.fr/agenda','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Municipal / metropolitan government","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.montpellier.fr/agenda","evidence_url":"https://www.montpellier.fr/agenda","name":"Montpellier — agenda municipal","notes":"Current exact agenda entry requires review.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Montpellier — agenda municipal","source_id":"S050","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S051','Montpellier Tourisme','Local tourism','Montpellier Tourisme','Event publishing / aggregation','https://www.montpellier-tourisme.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Discover event filters and group services.','https://www.montpellier-tourisme.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.montpellier-tourisme.fr/","evidence_url":"https://www.montpellier-tourisme.fr/","name":"Montpellier Tourisme","notes":"Discover event filters and group services.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Montpellier Tourisme","source_id":"S051","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S052','Nîmes Tourisme','Local tourism','Nîmes Tourisme','Event publishing / aggregation','https://nimes-tourisme.com/','authorized_feed_then_html_or_jsonld','P1','Only entry page retrieved','www redirects to the bare domain; agenda and rendering need testing.','https://nimes-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"30","enabled":false,"entry_url":"https://nimes-tourisme.com/","evidence_url":"https://nimes-tourisme.com/","name":"Nîmes Tourisme","notes":"www redirects to the bare domain; agenda and rendering need testing.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Nîmes Tourisme","source_id":"S052","verification_status":"Only entry page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S053','Perpignan Tourisme','Local tourism','Perpignan Tourisme','Event publishing / aggregation','https://www.perpignantourisme.com/','authorized_feed_then_html_or_jsonld','P1','HTTP 403 during research','Consider authorization or an alternative upstream source; plain HTML success is not guaranteed.','https://www.perpignantourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"66","enabled":false,"entry_url":"https://www.perpignantourisme.com/","evidence_url":"https://www.perpignantourisme.com/","name":"Perpignan Tourisme","notes":"Consider authorization or an alternative upstream source; plain HTML success is not guaranteed.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Perpignan Tourisme","source_id":"S053","verification_status":"HTTP 403 during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S054','Carcassonne Tourisme','Local tourism','Carcassonne Tourisme','Event publishing / aggregation','https://www.carcassonne-tourisme.com/','authorized_feed_then_html_or_jsonld','P1','HTTP 502 during research','Failure may be temporary or tool-specific; recheck.','https://www.carcassonne-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"11","enabled":false,"entry_url":"https://www.carcassonne-tourisme.com/","evidence_url":"https://www.carcassonne-tourisme.com/","name":"Carcassonne Tourisme","notes":"Failure may be temporary or tool-specific; recheck.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Carcassonne Tourisme","source_id":"S054","verification_status":"HTTP 502 during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S055','Côte du Midi / Narbonne','Local tourism','Côte du Midi / Narbonne','Event publishing / aggregation','https://www.cotedumidi.com/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Former narbonne-tourisme.com redirects here.','https://www.cotedumidi.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":["https://www.narbonne-tourisme.com/"],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"11","enabled":false,"entry_url":"https://www.cotedumidi.com/","evidence_url":"https://www.cotedumidi.com/","name":"Côte du Midi / Narbonne","notes":"Former narbonne-tourisme.com redirects here.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Côte du Midi / Narbonne","source_id":"S055","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S056','Albi Tourisme','Local tourism','Albi Tourisme','Event publishing / aggregation','https://www.albi-tourisme.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Review event, venue and school/group sections page by page.','https://www.albi-tourisme.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"81","enabled":false,"entry_url":"https://www.albi-tourisme.fr/","evidence_url":"https://www.albi-tourisme.fr/","name":"Albi Tourisme","notes":"Review event, venue and school/group sections page by page.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Albi Tourisme","source_id":"S056","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S057','Montauban Tourisme','Local tourism','Montauban Tourisme','Event publishing / aggregation','https://www.montauban-tourisme.com/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Local events and group programme leads.','https://www.montauban-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"82","enabled":false,"entry_url":"https://www.montauban-tourisme.com/","evidence_url":"https://www.montauban-tourisme.com/","name":"Montauban Tourisme","notes":"Local events and group programme leads.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Montauban Tourisme","source_id":"S057","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S058','Destination Auch','Local tourism','Auch — destination','Event publishing / aggregation','https://www.tourisme-gers.com/destinations/auch/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Former auch-tourisme.com redirects to the Gers main site; not an independent upstream source.','https://www.tourisme-gers.com/destinations/auch/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":["https://www.auch-tourisme.com/"],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"32","enabled":false,"entry_url":"https://www.tourisme-gers.com/destinations/auch/","evidence_url":"https://www.tourisme-gers.com/destinations/auch/","name":"Destination Auch","notes":"Former auch-tourisme.com redirects to the Gers main site; not an independent upstream source.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Auch — destination","source_id":"S058","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S059','Tarbes Tourisme','Local tourism','Tarbes Tourisme','Event publishing / aggregation','https://www.tarbes-tourisme.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Local event leads.','https://www.tarbes-tourisme.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"65","enabled":false,"entry_url":"https://www.tarbes-tourisme.fr/","evidence_url":"https://www.tarbes-tourisme.fr/","name":"Tarbes Tourisme","notes":"Local event leads.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Tarbes Tourisme","source_id":"S059","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S060','Rodez Tourisme','Local tourism','Rodez Tourisme','Event publishing / aggregation','https://www.rodez-tourisme.fr/agenda/les-grands-evenements/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','This entry covers major events; also discover the complete agenda.','https://www.rodez-tourisme.fr/agenda/les-grands-evenements/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"12","enabled":false,"entry_url":"https://www.rodez-tourisme.fr/agenda/les-grands-evenements/","evidence_url":"https://www.rodez-tourisme.fr/agenda/les-grands-evenements/","name":"Rodez Tourisme","notes":"This entry covers major events; also discover the complete agenda.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Rodez Tourisme","source_id":"S060","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S061','Foix Tourisme','Local tourism','Foix Tourisme','Event publishing / aggregation','https://www.foix-tourisme.com/agenda/fetes-animations/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Local event entry.','https://www.foix-tourisme.com/agenda/fetes-animations/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://www.foix-tourisme.com/agenda/fetes-animations/","evidence_url":"https://www.foix-tourisme.com/agenda/fetes-animations/","name":"Foix Tourisme","notes":"Local event entry.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Foix Tourisme","source_id":"S061","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S062','Pyrénées Ariégeoises','Local tourism','Pyrénées Ariégeoises','Event publishing / aggregation','https://www.pyrenees-ariegeoises.com/a-voir-a-faire/sortir/agenda/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Do not assume every event is reachable by train.','https://www.pyrenees-ariegeoises.com/a-voir-a-faire/sortir/agenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://www.pyrenees-ariegeoises.com/a-voir-a-faire/sortir/agenda/","evidence_url":"https://www.pyrenees-ariegeoises.com/a-voir-a-faire/sortir/agenda/","name":"Pyrénées Ariégeoises","notes":"Do not assume every event is reachable by train.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Pyrénées Ariégeoises","source_id":"S062","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S063','Pyrénées Cathares','Local tourism','Pyrénées Cathares','Event publishing / aggregation','https://www.pyreneescathares.com/sejourner/s-organiser/tout-l-agenda/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Local agenda listing.','https://www.pyreneescathares.com/sejourner/s-organiser/tout-l-agenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://www.pyreneescathares.com/sejourner/s-organiser/tout-l-agenda/","evidence_url":"https://www.pyreneescathares.com/sejourner/s-organiser/tout-l-agenda/","name":"Pyrénées Cathares","notes":"Local agenda listing.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Pyrénées Cathares","source_id":"S063","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S064','Couserans Pyrénées','Local tourism','Couserans Pyrénées','Event publishing / aggregation','https://www.tourisme-couserans-pyrenees.com/agenda/lagenda-des-evenements/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Local agenda listing.','https://www.tourisme-couserans-pyrenees.com/agenda/lagenda-des-evenements/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://www.tourisme-couserans-pyrenees.com/agenda/lagenda-des-evenements/","evidence_url":"https://www.tourisme-couserans-pyrenees.com/agenda/lagenda-des-evenements/","name":"Couserans Pyrénées","notes":"Local agenda listing.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Couserans Pyrénées","source_id":"S064","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S065','Arize-Lèze','Local tourism','Arize-Lèze','Event publishing / aggregation','https://www.tourisme-arize-leze.com/agenda/tout-lagenda/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Local agenda listing.','https://www.tourisme-arize-leze.com/agenda/tout-lagenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://www.tourisme-arize-leze.com/agenda/tout-lagenda/","evidence_url":"https://www.tourisme-arize-leze.com/agenda/tout-lagenda/","name":"Arize-Lèze","notes":"Local agenda listing.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Arize-Lèze","source_id":"S065","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S066','Terres d’Aveyron','Local tourism','Terres d’Aveyron','Event publishing / aggregation','https://www.terresdaveyron.com/sejourner/agenda/tout-lagenda/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Local agenda listing.','https://www.terresdaveyron.com/sejourner/agenda/tout-lagenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"12","enabled":false,"entry_url":"https://www.terresdaveyron.com/sejourner/agenda/tout-lagenda/","evidence_url":"https://www.terresdaveyron.com/sejourner/agenda/tout-lagenda/","name":"Terres d’Aveyron","notes":"Local agenda listing.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Terres d’Aveyron","source_id":"S066","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S067','Bastides et Gorges de l’Aveyron','Local tourism','Bastides et Gorges de l’Aveyron','Event publishing / aggregation','https://www.bastides-gorges-aveyron.fr/l-agenda/tout-lagenda/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Local agenda; derive department from the actual event commune.','https://www.bastides-gorges-aveyron.fr/l-agenda/tout-lagenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"12","enabled":false,"entry_url":"https://www.bastides-gorges-aveyron.fr/l-agenda/tout-lagenda/","evidence_url":"https://www.bastides-gorges-aveyron.fr/l-agenda/tout-lagenda/","name":"Bastides et Gorges de l’Aveyron","notes":"Local agenda; derive department from the actual event commune.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Bastides et Gorges de l’Aveyron","source_id":"S067","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S068','Aubrac','Local tourism','Aubrac','Event publishing / aggregation','https://www.tourisme-en-aubrac.com/agenda-evenements/tout-lagenda/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Destination spans administrative boundaries; exclude events outside Occitanie.','https://www.tourisme-en-aubrac.com/agenda-evenements/tout-lagenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"12/48","enabled":false,"entry_url":"https://www.tourisme-en-aubrac.com/agenda-evenements/tout-lagenda/","evidence_url":"https://www.tourisme-en-aubrac.com/agenda-evenements/tout-lagenda/","name":"Aubrac","notes":"Destination spans administrative boundaries; exclude events outside Occitanie.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Aubrac","source_id":"S068","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S069','Causses et Gorges de l’Aveyron','Local tourism','Causses et Gorges de l’Aveyron','Event publishing / aggregation','https://causses-gorgesaveyron.com/evenements-agenda-des-evenements-fetes-locales-et-festivals/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','An institution name containing Aveyron does not establish department 12 as the event location.','https://causses-gorgesaveyron.com/evenements-agenda-des-evenements-fetes-locales-et-festivals/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"82","enabled":false,"entry_url":"https://causses-gorgesaveyron.com/evenements-agenda-des-evenements-fetes-locales-et-festivals/","evidence_url":"https://causses-gorgesaveyron.com/evenements-agenda-des-evenements-fetes-locales-et-festivals/","name":"Causses et Gorges de l’Aveyron","notes":"An institution name containing Aveyron does not establish department 12 as the event location.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Causses et Gorges de l’Aveyron","source_id":"S069","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S070','Gers Armagnac','Local tourism','Gers Armagnac','Event publishing / aggregation','https://www.gers-armagnac.com/vivre/agenda/tout-lagenda/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Local agenda listing.','https://www.gers-armagnac.com/vivre/agenda/tout-lagenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"32","enabled":false,"entry_url":"https://www.gers-armagnac.com/vivre/agenda/tout-lagenda/","evidence_url":"https://www.gers-armagnac.com/vivre/agenda/tout-lagenda/","name":"Gers Armagnac","notes":"Local agenda listing.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Gers Armagnac","source_id":"S070","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S071','Vallespir','Local tourism','Vallespir','Event publishing / aggregation','https://www.vallespir-tourisme.fr/agenda/les-evenements-majeurs/','authorized_feed_then_html_or_jsonld','P1','Official page confirmed in search','Major-event entry; discover other sections as well.','https://www.vallespir-tourisme.fr/agenda/les-evenements-majeurs/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"66","enabled":false,"entry_url":"https://www.vallespir-tourisme.fr/agenda/les-evenements-majeurs/","evidence_url":"https://www.vallespir-tourisme.fr/agenda/les-evenements-majeurs/","name":"Vallespir","notes":"Major-event entry; discover other sections as well.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Vallespir","source_id":"S071","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S072','Saint-Guilhem / Vallée de l’Hérault','Local tourism','Saint-Guilhem / Vallée de l’Hérault','Event publishing / aggregation','https://www.saintguilhem-valleeherault.fr/','authorized_feed_then_html_or_jsonld','P2','Linked from official departmental site; target needs review','Discovered through Hérault official tourism; target agenda and collection remain untested.','https://www.herault-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.saintguilhem-valleeherault.fr/","evidence_url":"https://www.herault-tourisme.com/","name":"Saint-Guilhem / Vallée de l’Hérault","notes":"Discovered through Hérault official tourism; target agenda and collection remain untested.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Saint-Guilhem / Vallée de l’Hérault","source_id":"S072","verification_status":"Linked from official departmental site; target needs review"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S073','Grand Pic Saint-Loup','Local tourism','Grand Pic Saint-Loup','Event publishing / aggregation','https://www.grandpicsaintloup-tourisme.fr/','authorized_feed_then_html_or_jsonld','P2','Linked from official departmental site; target needs review','Discovered through Hérault official tourism; target agenda and collection remain untested.','https://www.herault-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.grandpicsaintloup-tourisme.fr/","evidence_url":"https://www.herault-tourisme.com/","name":"Grand Pic Saint-Loup","notes":"Discovered through Hérault official tourism; target agenda and collection remain untested.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Grand Pic Saint-Loup","source_id":"S073","verification_status":"Linked from official departmental site; target needs review"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S074','Salagou','Local tourism','Salagou','Event publishing / aggregation','https://www.destination-salagou.fr/','authorized_feed_then_html_or_jsonld','P2','Linked from official departmental site; target needs review','Discovered through Hérault official tourism; target agenda and collection remain untested.','https://www.herault-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.destination-salagou.fr/","evidence_url":"https://www.herault-tourisme.com/","name":"Salagou","notes":"Discovered through Hérault official tourism; target agenda and collection remain untested.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Salagou","source_id":"S074","verification_status":"Linked from official departmental site; target needs review"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S075','La Grande Motte','Local tourism','La Grande Motte','Event publishing / aggregation','https://www.lagrandemotte.com/','authorized_feed_then_html_or_jsonld','P2','Linked from official departmental site; target needs review','Discovered through Hérault official tourism; target agenda and collection remain untested.','https://www.herault-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.lagrandemotte.com/","evidence_url":"https://www.herault-tourisme.com/","name":"La Grande Motte","notes":"Discovered through Hérault official tourism; target agenda and collection remain untested.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"La Grande Motte","source_id":"S075","verification_status":"Linked from official departmental site; target needs review"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S076','Minervois-Caroux','Local tourism','Minervois-Caroux','Event publishing / aggregation','https://www.minervois-caroux.com/','authorized_feed_then_html_or_jsonld','P2','Linked from official departmental site; target needs review','Discovered through Hérault official tourism; target agenda and collection remain untested.','https://www.herault-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.minervois-caroux.com/","evidence_url":"https://www.herault-tourisme.com/","name":"Minervois-Caroux","notes":"Discovered through Hérault official tourism; target agenda and collection remain untested.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Minervois-Caroux","source_id":"S076","verification_status":"Linked from official departmental site; target needs review"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S077','Lodévois et Larzac','Local tourism','Lodévois et Larzac','Event publishing / aggregation','https://www.tourisme-lodevois-larzac.fr/','authorized_feed_then_html_or_jsonld','P2','Linked from official departmental site; target needs review','Discovered through Hérault official tourism; target agenda and collection remain untested.','https://www.herault-tourisme.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local tourism","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.tourisme-lodevois-larzac.fr/","evidence_url":"https://www.herault-tourisme.com/","name":"Lodévois et Larzac","notes":"Discovered through Hérault official tourism; target agenda and collection remain untested.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"Lodévois et Larzac","source_id":"S077","verification_status":"Linked from official departmental site; target needs review"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S078','Fête de la science','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.fetedelascience.fr/','current_edition_openagenda_uid_then_html','P1','Official reference confirmed; direct retrieval failed','Theme: science. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://www.fetedelascience.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.fetedelascience.fr/","evidence_url":"https://www.fetedelascience.fr/","name":"Fête de la science","notes":"Theme: science. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S078","verification_status":"Official reference confirmed; direct retrieval failed"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S079','Journées européennes du patrimoine','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://journeesdupatrimoine.culture.gouv.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: history / heritage. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://journeesdupatrimoine.culture.gouv.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://journeesdupatrimoine.culture.gouv.fr/","evidence_url":"https://journeesdupatrimoine.culture.gouv.fr/","name":"Journées européennes du patrimoine","notes":"Theme: history / heritage. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S079","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S080','Nuit européenne des musées','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://nuitdesmusees.culture.gouv.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: museums. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://nuitdesmusees.culture.gouv.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://nuitdesmusees.culture.gouv.fr/","evidence_url":"https://nuitdesmusees.culture.gouv.fr/","name":"Nuit européenne des musées","notes":"Theme: museums. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S080","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S081','Rendez-vous aux jardins','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://rendezvousauxjardins.culture.gouv.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: nature / gardens. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://rendezvousauxjardins.culture.gouv.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://rendezvousauxjardins.culture.gouv.fr/","evidence_url":"https://rendezvousauxjardins.culture.gouv.fr/","name":"Rendez-vous aux jardins","notes":"Theme: nature / gardens. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S081","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S082','Journées nationales de l’architecture','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://journeesarchitecture.culture.gouv.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: architecture. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://journeesarchitecture.culture.gouv.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://journeesarchitecture.culture.gouv.fr/","evidence_url":"https://journeesarchitecture.culture.gouv.fr/","name":"Journées nationales de l’architecture","notes":"Theme: architecture. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S082","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S083','Journées européennes de l’archéologie','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://journeesarcheologie.culture.gouv.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: archaeology. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://journeesarcheologie.culture.gouv.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://journeesarcheologie.culture.gouv.fr/","evidence_url":"https://journeesarcheologie.culture.gouv.fr/","name":"Journées européennes de l’archéologie","notes":"Theme: archaeology. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S083","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S084','Nuits de la lecture','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.nuitsdelalecture.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: reading. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://www.nuitsdelalecture.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.nuitsdelalecture.fr/","evidence_url":"https://www.nuitsdelalecture.fr/","name":"Nuits de la lecture","notes":"Theme: reading. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S084","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S085','Partir en Livre','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.partir-en-livre.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: youth reading. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://www.partir-en-livre.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.partir-en-livre.fr/","evidence_url":"https://www.partir-en-livre.fr/","name":"Partir en Livre","notes":"Theme: youth reading. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S085","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S086','Fête de la nature','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://fetedelanature.com/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: nature. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://fetedelanature.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://fetedelanature.com/","evidence_url":"https://fetedelanature.com/","name":"Fête de la nature","notes":"Theme: nature. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S086","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S087','Fête de la musique','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://fetedelamusique.culture.gouv.fr/','current_edition_openagenda_uid_then_html','P1','Official page confirmed in search','Theme: music. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://fetedelamusique.culture.gouv.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://fetedelamusique.culture.gouv.fr/","evidence_url":"https://fetedelamusique.culture.gouv.fr/","name":"Fête de la musique","notes":"Theme: music. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S087","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S088','Semaine de l’industrie','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.entreprises.gouv.fr/semaine-de-lindustrie','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: industry / careers. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://www.entreprises.gouv.fr/semaine-de-lindustrie','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.entreprises.gouv.fr/semaine-de-lindustrie","evidence_url":"https://www.entreprises.gouv.fr/semaine-de-lindustrie","name":"Semaine de l’industrie","notes":"Theme: industry / careers. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S088","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S089','Journées européennes des métiers d’art','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.journeesdesmetiersdart.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: crafts / careers. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://www.journeesdesmetiersdart.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.journeesdesmetiersdart.fr/","evidence_url":"https://www.journeesdesmetiersdart.fr/","name":"Journées européennes des métiers d’art","notes":"Theme: crafts / careers. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S089","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S090','Association française d’astronomie','National themed events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.afastronomie.fr/','current_edition_openagenda_uid_then_html','P1','Page retrieved','Theme: astronomy. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.','https://www.afastronomie.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"National themed events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.afastronomie.fr/","evidence_url":"https://www.afastronomie.fr/","name":"Association française d’astronomie","notes":"Theme: astronomy. Filter by actual Occitanie venue and edition year. Never copy previous-edition dates into a future year.","priority":"P1","production_crawl_tested":false,"proposed_connector":"current_edition_openagenda_uid_then_html","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S090","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S091','Muséum de Toulouse','Venues / school services','Muséum de Toulouse','Events and bookable educational services','https://museum.toulouse-metropole.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved; event list loads dynamically','Natural sciences. Geolocate the main museum and Jardins separately.','https://museum.toulouse-metropole.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://museum.toulouse-metropole.fr/","evidence_url":"https://museum.toulouse-metropole.fr/","name":"Muséum de Toulouse","notes":"Natural sciences. Geolocate the main museum and Jardins separately.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Muséum de Toulouse","source_id":"S091","verification_status":"Page retrieved; event list loads dynamically"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S092','Quai des Savoirs','Venues / school services','Quai des Savoirs','Events and bookable educational services','https://quaidessavoirs.toulouse-metropole.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved; event list loads dynamically','Science, digital culture, exhibitions and workshops.','https://quaidessavoirs.toulouse-metropole.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://quaidessavoirs.toulouse-metropole.fr/","evidence_url":"https://quaidessavoirs.toulouse-metropole.fr/","name":"Quai des Savoirs","notes":"Science, digital culture, exhibitions and workshops.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Quai des Savoirs","source_id":"S092","verification_status":"Page retrieved; event list loads dynamically"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S093','Cité de l’espace','Venues / school services','Cité de l’espace','Events and bookable educational services','https://www.cite-espace.com/','agenda_school_pages_html_authorized_rendering','P1','Retrieval failed during research','Candidate space education venue; current school sections and collection method require review.','https://www.cite-espace.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://www.cite-espace.com/","evidence_url":"https://www.cite-espace.com/","name":"Cité de l’espace","notes":"Candidate space education venue; current school sections and collection method require review.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Cité de l’espace","source_id":"S093","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S094','L’Envol des Pionniers','Venues / school services','L’Envol des Pionniers','Events and bookable educational services','https://www.lenvol-des-pionniers.com/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Aviation history; inspect school/group sections.','https://www.lenvol-des-pionniers.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://www.lenvol-des-pionniers.com/","evidence_url":"https://www.lenvol-des-pionniers.com/","name":"L’Envol des Pionniers","notes":"Aviation history; inspect school/group sections.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"L’Envol des Pionniers","source_id":"S094","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S095','Aeroscopia','Venues / school services','Aeroscopia','Events and bookable educational services','https://www.aeroscopia.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Aviation; inspect school/group sections.','https://www.aeroscopia.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://www.aeroscopia.fr/","evidence_url":"https://www.aeroscopia.fr/","name":"Aeroscopia","notes":"Aviation; inspect school/group sections.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Aeroscopia","source_id":"S095","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S096','Les Abattoirs','Venues / school services','Les Abattoirs','Events and bookable educational services','https://www.lesabattoirs.org/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Art; entry may redirect according to language.','https://www.lesabattoirs.org/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://www.lesabattoirs.org/","evidence_url":"https://www.lesabattoirs.org/","name":"Les Abattoirs","notes":"Art; entry may redirect according to language.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Les Abattoirs","source_id":"S096","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S097','Musée Fabre — Enseignants','Venues / school services','Musée Fabre — Enseignants','Events and bookable educational services','https://www.museefabre.fr/enseignants','agenda_school_pages_html_authorized_rendering','P1','Official school page found in search','Explicit school services. Also inspect scolaires and offre-de-visites-et-ateliers.','https://www.museefabre.fr/enseignants','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.museefabre.fr/enseignants","evidence_url":"https://www.museefabre.fr/enseignants","name":"Musée Fabre — Enseignants","notes":"Explicit school services. Also inspect scolaires and offre-de-visites-et-ateliers.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Musée Fabre — Enseignants","source_id":"S097","verification_status":"Official school page found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S098','MO.CO. — Événements','Venues / school services','MO.CO. — Événements','Events and bookable educational services','https://www.moco.art/fr/evenement','agenda_school_pages_html_authorized_rendering','P1','Official page confirmed in search','Art events; school group conditions require separate verification.','https://www.moco.art/fr/evenement','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://www.moco.art/fr/evenement","evidence_url":"https://www.moco.art/fr/evenement","name":"MO.CO. — Événements","notes":"Art events; school group conditions require separate verification.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"MO.CO. — Événements","source_id":"S098","verification_status":"Official page confirmed in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S099','Musée de la Romanité','Venues / school services','Musée de la Romanité','Events and bookable educational services','https://museedelaromanite.fr/','agenda_school_pages_html_authorized_rendering','P1','Official page confirmed in search; direct retrieval failed','History and archaeology; school entry visible in official search.','https://museedelaromanite.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"30","enabled":false,"entry_url":"https://museedelaromanite.fr/","evidence_url":"https://museedelaromanite.fr/","name":"Musée de la Romanité","notes":"History and archaeology; school entry visible in official search.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Musée de la Romanité","source_id":"S099","verification_status":"Official page confirmed in search; direct retrieval failed"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S100','Narbo Via','Venues / school services','Narbo Via','Events and bookable educational services','https://narbovia.fr/','agenda_school_pages_html_authorized_rendering','P1','Official event page found in search','History and archaeology; bare domain. Separate school information from public events.','https://narbovia.fr/evenement/lessentiel-des-collections-2/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"11","enabled":false,"entry_url":"https://narbovia.fr/","evidence_url":"https://narbovia.fr/evenement/lessentiel-des-collections-2/","name":"Narbo Via","notes":"History and archaeology; bare domain. Separate school information from public events.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Narbo Via","source_id":"S100","verification_status":"Official event page found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S101','Musée Soulages','Venues / school services','Musée Soulages','Events and bookable educational services','https://musee-soulages-rodez.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Art; separate educational activities from ticket availability.','https://musee-soulages-rodez.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"12","enabled":false,"entry_url":"https://musee-soulages-rodez.fr/","evidence_url":"https://musee-soulages-rodez.fr/","name":"Musée Soulages","notes":"Art; separate educational activities from ticket availability.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Musée Soulages","source_id":"S101","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S102','Musée Champollion','Venues / school services','Musée Champollion','Events and bookable educational services','https://musee-champollion.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Writing and history; collect school booking information page by page.','https://musee-champollion.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"46","enabled":false,"entry_url":"https://musee-champollion.fr/","evidence_url":"https://musee-champollion.fr/","name":"Musée Champollion","notes":"Writing and history; collect school booking information page by page.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Musée Champollion","source_id":"S102","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S103','Pont du Gard','Venues / school services','Pont du Gard','Events and bookable educational services','https://pontdugard.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Official teacher/school entry exists. Listing does not establish a walk of 20 minutes or less from a station.','https://pontdugard.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"30","enabled":false,"entry_url":"https://pontdugard.fr/","evidence_url":"https://pontdugard.fr/","name":"Pont du Gard","notes":"Official teacher/school entry exists. Listing does not establish a walk of 20 minutes or less from a station.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Pont du Gard","source_id":"S103","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S104','Musée de Préhistoire de Tautavel','Venues / school services','Musée de Préhistoire de Tautavel','Events and bookable educational services','https://450000ans.com/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Official Scolaire and Groupes sections exist; calculate transport access separately.','https://450000ans.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"66","enabled":false,"entry_url":"https://450000ans.com/","evidence_url":"https://450000ans.com/","name":"Musée de Préhistoire de Tautavel","notes":"Official Scolaire and Groupes sections exist; calculate transport access separately.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Musée de Préhistoire de Tautavel","source_id":"S104","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S105','Sites Touristiques Ariège','Venues / school services','Sites Touristiques Ariège','Events and bookable educational services','https://www.sites-touristiques-ariege.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Multiple venues and heritage sites. Record the actual venue for each activity.','https://www.sites-touristiques-ariege.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"09","enabled":false,"entry_url":"https://www.sites-touristiques-ariege.fr/","evidence_url":"https://www.sites-touristiques-ariege.fr/","name":"Sites Touristiques Ariège","notes":"Multiple venues and heritage sites. Record the actual venue for each activity.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Sites Touristiques Ariège","source_id":"S105","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S106','Bibliothèques de Toulouse','Venues / school services','Bibliothèques de Toulouse','Events and bookable educational services','https://bibliotheque.toulouse.fr/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved; event list loads dynamically','Reading, exhibitions and workshops; brochures coexist with the agenda.','https://bibliotheque.toulouse.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://bibliotheque.toulouse.fr/","evidence_url":"https://bibliotheque.toulouse.fr/","name":"Bibliothèques de Toulouse","notes":"Reading, exhibitions and workshops; brochures coexist with the agenda.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Bibliothèques de Toulouse","source_id":"S106","verification_status":"Page retrieved; event list loads dynamically"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S107','Médiathèques Montpellier Métropole','Venues / school services','Médiathèques Montpellier Métropole','Events and bookable educational services','https://mediatheques.montpellier3m.fr/','agenda_school_pages_html_authorized_rendering','P1','Only dynamic page shell retrieved','A Places restantes label in a page template is not evidence of available inventory.','https://mediatheques.montpellier3m.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"34","enabled":false,"entry_url":"https://mediatheques.montpellier3m.fr/","evidence_url":"https://mediatheques.montpellier3m.fr/","name":"Médiathèques Montpellier Métropole","notes":"A Places restantes label in a page template is not evidence of available inventory.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Médiathèques Montpellier Métropole","source_id":"S107","verification_status":"Only dynamic page shell retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S108','Archives de la Haute-Garonne','Venues / school services','Archives de la Haute-Garonne','Events and bookable educational services','https://archives.haute-garonne.fr/','agenda_school_pages_html_authorized_rendering','P1','Access denied during research','Access Denied observed; seek authorization, upstream cultural calendars or manual input.','https://archives.haute-garonne.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://archives.haute-garonne.fr/","evidence_url":"https://archives.haute-garonne.fr/","name":"Archives de la Haute-Garonne","notes":"Access Denied observed; seek authorization, upstream cultural calendars or manual input.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Archives de la Haute-Garonne","source_id":"S108","verification_status":"Access denied during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S109','Théâtre de la Cité','Venues / school services','Théâtre de la Cité','Events and bookable educational services','https://theatre-cite.com/','agenda_school_pages_html_authorized_rendering','P1','Page retrieved','Performance seasons, educational relations and brochures. Evening public performances are not automatically school sessions.','https://theatre-cite.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"31","enabled":false,"entry_url":"https://theatre-cite.com/","evidence_url":"https://theatre-cite.com/","name":"Théâtre de la Cité","notes":"Performance seasons, educational relations and brochures. Evening public performances are not automatically school sessions.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Théâtre de la Cité","source_id":"S109","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S110','L’Archipel — Perpignan','Venues / school services','L’Archipel — Perpignan','Events and bookable educational services','https://www.theatredelarchipel.org/','agenda_school_pages_html_authorized_rendering','P1','Only entry page retrieved','Theatre; detailed calendars and school activities require testing.','https://www.theatredelarchipel.org/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"66","enabled":false,"entry_url":"https://www.theatredelarchipel.org/","evidence_url":"https://www.theatredelarchipel.org/","name":"L’Archipel — Perpignan","notes":"Theatre; detailed calendars and school activities require testing.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"L’Archipel — Perpignan","source_id":"S110","verification_status":"Only entry page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S111','Théâtre de Nîmes','Venues / school services','Théâtre de Nîmes','Events and bookable educational services','https://www.theatredenimes.com/','agenda_school_pages_html_authorized_rendering','P1','Retrieval failed during research','Candidate retained; current entry and school programmes require review.','https://www.theatredenimes.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Venues / school services","checked_on":"2026-10-10","department":"30","enabled":false,"entry_url":"https://www.theatredenimes.com/","evidence_url":"https://www.theatredenimes.com/","name":"Théâtre de Nîmes","notes":"Candidate retained; current entry and school programmes require review.","priority":"P1","production_crawl_tested":false,"proposed_connector":"agenda_school_pages_html_authorized_rendering","role":"Events and bookable educational services","scope":"Théâtre de Nîmes","source_id":"S111","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S112','Centre des monuments nationaux','Heritage network','France; filter by actual event location in Occitanie','Venue discovery / school services','https://www.monuments-nationaux.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Find Occitanie venues through the national directory, then collect from the individual institutions.','https://www.monuments-nationaux.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Heritage network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.monuments-nationaux.fr/","evidence_url":"https://www.monuments-nationaux.fr/","name":"Centre des monuments nationaux","notes":"Find Occitanie venues through the national directory, then collect from the individual institutions.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Venue discovery / school services","scope":"France; filter by actual event location in Occitanie","source_id":"S112","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S113','Réseau national des CPIE','Environmental education network','France; filter by actual event location in Occitanie','Institution discovery / educational services','https://www.cpie.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Discover local members and environmental education. The national page is not a complete Occitanie event database.','https://www.cpie.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Environmental education network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.cpie.fr/","evidence_url":"https://www.cpie.fr/","name":"Réseau national des CPIE","notes":"Discover local members and environmental education. The national page is not a complete Occitanie event database.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Institution discovery / educational services","scope":"France; filter by actual event location in Occitanie","source_id":"S113","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S114','Fédération des Parcs naturels régionaux de France','Regional park network','France; filter by actual event location in Occitanie','Institution discovery','https://www.parcs-naturels-regionaux.fr/','authorized_feed_then_html_or_jsonld','P1','Page retrieved','Discover Occitanie park websites, then collect their activities and educational services.','https://www.parcs-naturels-regionaux.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Regional park network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.parcs-naturels-regionaux.fr/","evidence_url":"https://www.parcs-naturels-regionaux.fr/","name":"Fédération des Parcs naturels régionaux de France","notes":"Discover Occitanie park websites, then collect their activities and educational services.","priority":"P1","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Institution discovery","scope":"France; filter by actual event location in Occitanie","source_id":"S114","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S115','Réseau Canopé','Educational institution network','France; filter by actual event location in Occitanie','Educational resources / partnerships','https://www.reseau-canope.fr/','authorized_feed_then_html_or_jsonld','P2','Page retrieved','Much content is teacher training, not student outings.','https://www.reseau-canope.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Educational institution network","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.reseau-canope.fr/","evidence_url":"https://www.reseau-canope.fr/","name":"Réseau Canopé","notes":"Much content is teacher training, not student outings.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Educational resources / partnerships","scope":"France; filter by actual event location in Occitanie","source_id":"S115","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S116','pass Culture / ADAGE','Education / authorized platform','France; filter by actual event location in Occitanie','Authorized educational offers / services','https://pass.culture.fr/partenaires-techniques','pass_culture_authorized_partnership','P2','Official partnership documentation checked','Partner APIs do not provide unrestricted ADAGE catalogue access. Confirm teacher/institution permissions and partnership scope.','https://aide.passculture.app/hc/fr/articles/10616916478236--Acteurs-Culturels-Comment-synchroniser-votre-structure-pass-Culture-avec-un-partenaire-technique','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Education / authorized platform","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://pass.culture.fr/partenaires-techniques","evidence_url":"https://aide.passculture.app/hc/fr/articles/10616916478236--Acteurs-Culturels-Comment-synchroniser-votre-structure-pass-Culture-avec-un-partenaire-technique","name":"pass Culture / ADAGE","notes":"Partner APIs do not provide unrestricted ADAGE catalogue access. Confirm teacher/institution permissions and partnership scope.","priority":"P2","production_crawl_tested":false,"proposed_connector":"pass_culture_authorized_partnership","role":"Authorized educational offers / services","scope":"France; filter by actual event location in Occitanie","source_id":"S116","verification_status":"Official partnership documentation checked"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S117','AgendaCulturel','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.agendaculturel.fr/','authorized_feed_then_html_or_jsonld','P2','Page retrieved','Culture, performances and exhibitions; filter by location and age. Bulk redistribution permission and a full-platform reading API were not verified.','https://www.agendaculturel.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.agendaculturel.fr/","evidence_url":"https://www.agendaculturel.fr/","name":"AgendaCulturel","notes":"Culture, performances and exhibitions; filter by location and age. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S117","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S118','JDS','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.jds.fr/','authorized_feed_then_html_or_jsonld','P2','Page retrieved','General events, including Toulouse and Montpellier; exclude unsuitable categories. Bulk redistribution permission and a full-platform reading API were not verified.','https://www.jds.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.jds.fr/","evidence_url":"https://www.jds.fr/","name":"JDS","notes":"General events, including Toulouse and Montpellier; exclude unsuitable categories. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S118","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S119','Spectable','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.spectable.com/','authorized_feed_then_html_or_jsonld','P2','Page retrieved','Art, courses and culture; distinguish recurring courses from single outings. Bulk redistribution permission and a full-platform reading API were not verified.','https://www.spectable.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.spectable.com/","evidence_url":"https://www.spectable.com/","name":"Spectable","notes":"Art, courses and culture; distinguish recurring courses from single outings. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S119","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S120','Unidivers','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://unidivers.fr/','authorized_feed_then_html_or_jsonld','P2','Page retrieved','Aggregated cultural events; trace upstream sources, duplicates and freshness. Bulk redistribution permission and a full-platform reading API were not verified.','https://unidivers.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://unidivers.fr/","evidence_url":"https://unidivers.fr/","name":"Unidivers","notes":"Aggregated cultural events; trace upstream sources, duplicates and freshness. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S120","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S121','Alentoor','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.alentoor.fr/','authorized_feed_then_html_or_jsonld','P2','Public event page found in search','Local agenda; check original data sources. Bulk redistribution permission and a full-platform reading API were not verified.','https://www.alentoor.fr/66-pyrenees-orientales/agenda/aujourdhui','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.alentoor.fr/","evidence_url":"https://www.alentoor.fr/66-pyrenees-orientales/agenda/aujourdhui","name":"Alentoor","notes":"Local agenda; check original data sources. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S121","verification_status":"Public event page found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S122','Le Petit Agenda','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.lepetitagenda.com/','authorized_feed_then_html_or_jsonld','P2','Public event page found in search','Includes Pyrénées-Orientales and young-audience discovery filters. Bulk redistribution permission and a full-platform reading API were not verified.','https://www.lepetitagenda.com/evenements/le-petit-agenda/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.lepetitagenda.com/","evidence_url":"https://www.lepetitagenda.com/evenements/le-petit-agenda/","name":"Le Petit Agenda","notes":"Includes Pyrénées-Orientales and young-audience discovery filters. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S122","verification_status":"Public event page found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S123','CitizenKid','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.citizenkid.com/','authorized_feed_then_html_or_jsonld','P2','Page retrieved','Family and child recommendations do not establish school-group capacity. Bulk redistribution permission and a full-platform reading API were not verified.','https://www.citizenkid.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.citizenkid.com/","evidence_url":"https://www.citizenkid.com/","name":"CitizenKid","notes":"Family and child recommendations do not establish school-group capacity. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S123","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S124','Familiscope','Commercial / editorial event listings','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.familiscope.fr/','authorized_feed_then_html_or_jsonld','P2','Retrieval failed during research','Family platform candidate; current availability and precise entry need review. Bulk redistribution permission and a full-platform reading API were not verified.','https://www.familiscope.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Commercial / editorial event listings","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.familiscope.fr/","evidence_url":"https://www.familiscope.fr/","name":"Familiscope","notes":"Family platform candidate; current availability and precise entry need review. Bulk redistribution permission and a full-platform reading API were not verified.","priority":"P2","production_crawl_tested":false,"proposed_connector":"authorized_feed_then_html_or_jsonld","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S124","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S125','HelloAsso','Associations / ticketing','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.helloasso.com/','helloasso_authorized_directory','P1','Official API permission documentation checked','Directory search requires appropriate FormOpenDirectory / OrganizationOpenDirectory permissions. Ordinary association keys do not automatically grant full directory search.','https://dev.helloasso.com/docs/privil%C3%A8ges-et-r%C3%B4les','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Associations / ticketing","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.helloasso.com/","evidence_url":"https://dev.helloasso.com/docs/privil%C3%A8ges-et-r%C3%B4les","name":"HelloAsso","notes":"Directory search requires appropriate FormOpenDirectory / OrganizationOpenDirectory permissions. Ordinary association keys do not automatically grant full directory search.","priority":"P1","production_crawl_tested":false,"proposed_connector":"helloasso_authorized_directory","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S125","verification_status":"Official API permission documentation checked"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S126','Eventbrite','Ticketing / events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.eventbrite.fr/','eventbrite_authorized_or_public_page','P2','Official API documentation found in search','Official changelog records removal of general Event Search API. Use authorized organizations or known events; do not promise universal geographic search.','https://www.eventbrite.com/platform/docs/changelog','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Ticketing / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.eventbrite.fr/","evidence_url":"https://www.eventbrite.com/platform/docs/changelog","name":"Eventbrite","notes":"Official changelog records removal of general Event Search API. Use authorized organizations or known events; do not promise universal geographic search.","priority":"P2","production_crawl_tested":false,"proposed_connector":"eventbrite_authorized_or_public_page","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S126","verification_status":"Official API documentation found in search"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S127','Meetup','Community events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.meetup.com/','meetup_authorized','P3','Official API / Pro documentation checked; actual permissions untested','Official GraphQL page describes API access with Meetup Pro; confirm permitted scope. Nationwide geographic search untested; assess school age and curriculum suitability separately.','https://www.meetup.com/graphql/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Community events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.meetup.com/","evidence_url":"https://www.meetup.com/graphql/","name":"Meetup","notes":"Official GraphQL page describes API access with Meetup Pro; confirm permitted scope. Nationwide geographic search untested; assess school age and curriculum suitability separately.","priority":"P3","production_crawl_tested":false,"proposed_connector":"meetup_authorized","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S127","verification_status":"Official API / Pro documentation checked; actual permissions untested"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S128','Billetweb','Ticketing / events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.billetweb.fr/fr-fr/','public_event_pages_or_written_partnership','P2','Page retrieved','No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.','https://www.billetweb.fr/fr-fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Ticketing / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.billetweb.fr/fr-fr/","evidence_url":"https://www.billetweb.fr/fr-fr/","name":"Billetweb","notes":"No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.","priority":"P2","production_crawl_tested":false,"proposed_connector":"public_event_pages_or_written_partnership","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S128","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S129','Weezevent','Ticketing / events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://weezevent.com/fr/','public_event_pages_or_written_partnership','P2','Page retrieved','No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.','https://weezevent.com/fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Ticketing / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://weezevent.com/fr/","evidence_url":"https://weezevent.com/fr/","name":"Weezevent","notes":"No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.","priority":"P2","production_crawl_tested":false,"proposed_connector":"public_event_pages_or_written_partnership","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S129","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S130','Billet Réduc','Ticketing / events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.billetreduc.com/','public_event_pages_or_written_partnership','P2','Page retrieved','No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.','https://www.billetreduc.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Ticketing / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.billetreduc.com/","evidence_url":"https://www.billetreduc.com/","name":"Billet Réduc","notes":"No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.","priority":"P2","production_crawl_tested":false,"proposed_connector":"public_event_pages_or_written_partnership","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S130","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S131','Fnac Spectacles','Ticketing / events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.fnacspectacles.com/','public_event_pages_or_written_partnership','P2','Page retrieved','No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.','https://www.fnacspectacles.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Ticketing / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.fnacspectacles.com/","evidence_url":"https://www.fnacspectacles.com/","name":"Fnac Spectacles","notes":"No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.","priority":"P2","production_crawl_tested":false,"proposed_connector":"public_event_pages_or_written_partnership","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S131","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S132','Ticketmaster France','Ticketing / events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.ticketmaster.fr/','ticketmaster_discovery_v2','P2','Official Discovery API documentation checked; frontend entry only','Discovery API supports event/venue search and FR country code. Key required; actual France/Occitanie coverage untested in the seed research. Do not equate it with the entire frontend catalogue. Deep pagination limit of 1000 requires partitioned queries.','https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Ticketing / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.ticketmaster.fr/","evidence_url":"https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/","name":"Ticketmaster France","notes":"Discovery API supports event/venue search and FR country code. Key required; actual France/Occitanie coverage untested in the seed research. Do not equate it with the entire frontend catalogue. Deep pagination limit of 1000 requires partitioned queries.","priority":"P2","production_crawl_tested":false,"proposed_connector":"ticketmaster_discovery_v2","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S132","verification_status":"Official Discovery API documentation checked; frontend entry only"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S133','Fever','Ticketing / events','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://feverup.com/','public_event_pages_or_written_partnership','P2','Page retrieved','No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.','https://feverup.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Ticketing / events","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://feverup.com/","evidence_url":"https://feverup.com/","name":"Fever","notes":"No open France-wide directory API verified. Organizer ticketing APIs do not imply full-platform search; retail ticket availability does not prove school-group capacity.","priority":"P2","production_crawl_tested":false,"proposed_connector":"public_event_pages_or_written_partnership","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S133","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S134','PanneauPocket','Local information platforms','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.panneaupocket.com/','public_page_review_or_platform_partnership','P2','Page retrieved','Municipal event and notice discovery. No unrestricted third-party event API confirmed.','https://www.panneaupocket.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local information platforms","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.panneaupocket.com/","evidence_url":"https://www.panneaupocket.com/","name":"PanneauPocket","notes":"Municipal event and notice discovery. No unrestricted third-party event API confirmed.","priority":"P2","production_crawl_tested":false,"proposed_connector":"public_page_review_or_platform_partnership","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S134","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S135','IntraMuros','Local information platforms','France; filter by actual event location in Occitanie','Event publishing / aggregation','https://www.intramuros.org/','public_page_review_or_platform_partnership','P2','Page retrieved','Municipal event and notice discovery. No unrestricted third-party event API confirmed.','https://www.intramuros.org/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local information platforms","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.intramuros.org/","evidence_url":"https://www.intramuros.org/","name":"IntraMuros","notes":"Municipal event and notice discovery. No unrestricted third-party event API confirmed.","priority":"P2","production_crawl_tested":false,"proposed_connector":"public_page_review_or_platform_partnership","role":"Event publishing / aggregation","scope":"France; filter by actual event location in Occitanie","source_id":"S135","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S136','La Dépêche','Local media','Occitanie and the media coverage area','Additional discovery / change verification','https://www.ladepeche.fr/','approved_public_sections_rss_or_media_partnership','P2','Page retrieved','Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.','https://www.ladepeche.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local media","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.ladepeche.fr/","evidence_url":"https://www.ladepeche.fr/","name":"La Dépêche","notes":"Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.","priority":"P2","production_crawl_tested":false,"proposed_connector":"approved_public_sections_rss_or_media_partnership","role":"Additional discovery / change verification","scope":"Occitanie and the media coverage area","source_id":"S136","verification_status":"Page retrieved"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S137','Midi Libre','Local media','Occitanie and the media coverage area','Additional discovery / change verification','https://www.midilibre.fr/','approved_public_sections_rss_or_media_partnership','P2','Retrieval failed during research','Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.','https://www.midilibre.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local media","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.midilibre.fr/","evidence_url":"https://www.midilibre.fr/","name":"Midi Libre","notes":"Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.","priority":"P2","production_crawl_tested":false,"proposed_connector":"approved_public_sections_rss_or_media_partnership","role":"Additional discovery / change verification","scope":"Occitanie and the media coverage area","source_id":"S137","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S138','L’Indépendant','Local media','Occitanie and the media coverage area','Additional discovery / change verification','https://www.lindependant.fr/','approved_public_sections_rss_or_media_partnership','P2','Retrieval failed during research','Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.','https://www.lindependant.fr/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Local media","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.lindependant.fr/","evidence_url":"https://www.lindependant.fr/","name":"L’Indépendant","notes":"Extract event facts and original attribution; do not copy whole articles or bypass paywalls. Publication date is not the event date.","priority":"P2","production_crawl_tested":false,"proposed_connector":"approved_public_sections_rss_or_media_partnership","role":"Additional discovery / change verification","scope":"Occitanie and the media coverage area","source_id":"S138","verification_status":"Retrieval failed during research"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S139','Facebook Pages / Events','Social platforms','France; filter by actual event location in Occitanie','Authorized content / discovery leads','https://www.facebook.com/','approved_api_or_organizer_submission','P3','Platform candidate; account / event collection untested','Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.','https://www.facebook.com/legal/automated_data_collection_terms','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Social platforms","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.facebook.com/","evidence_url":"https://www.facebook.com/legal/automated_data_collection_terms","name":"Facebook Pages / Events","notes":"Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.","priority":"P3","production_crawl_tested":false,"proposed_connector":"approved_api_or_organizer_submission","role":"Authorized content / discovery leads","scope":"France; filter by actual event location in Occitanie","source_id":"S139","verification_status":"Platform candidate; account / event collection untested"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S140','Instagram','Social platforms','France; filter by actual event location in Occitanie','Authorized content / discovery leads','https://www.instagram.com/','approved_api_or_organizer_submission','P3','Platform candidate; account / event collection untested','Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.','https://www.instagram.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Social platforms","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.instagram.com/","evidence_url":"https://www.instagram.com/","name":"Instagram","notes":"Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.","priority":"P3","production_crawl_tested":false,"proposed_connector":"approved_api_or_organizer_submission","role":"Authorized content / discovery leads","scope":"France; filter by actual event location in Occitanie","source_id":"S140","verification_status":"Platform candidate; account / event collection untested"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S141','TikTok','Social platforms','France; filter by actual event location in Occitanie','Authorized content / discovery leads','https://www.tiktok.com/','approved_api_or_organizer_submission','P3','Platform candidate; account / event collection untested','Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.','https://www.tiktok.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Social platforms","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.tiktok.com/","evidence_url":"https://www.tiktok.com/","name":"TikTok","notes":"Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.","priority":"P3","production_crawl_tested":false,"proposed_connector":"approved_api_or_organizer_submission","role":"Authorized content / discovery leads","scope":"France; filter by actual event location in Occitanie","source_id":"S141","verification_status":"Platform candidate; account / event collection untested"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S142','LinkedIn Events','Social platforms','France; filter by actual event location in Occitanie','Authorized content / discovery leads','https://www.linkedin.com/','approved_api_or_organizer_submission','P3','Platform candidate; account / event collection untested','Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.','https://www.linkedin.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Social platforms","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.linkedin.com/","evidence_url":"https://www.linkedin.com/","name":"LinkedIn Events","notes":"Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.","priority":"P3","production_crawl_tested":false,"proposed_connector":"approved_api_or_organizer_submission","role":"Authorized content / discovery leads","scope":"France; filter by actual event location in Occitanie","source_id":"S142","verification_status":"Platform candidate; account / event collection untested"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S143','X','Social platforms','France; filter by actual event location in Occitanie','Authorized content / discovery leads','https://x.com/','approved_api_or_organizer_submission','P3','Platform candidate; account / event collection untested','Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.','https://x.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Social platforms","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://x.com/","evidence_url":"https://x.com/","name":"X","notes":"Prefer organizer authorization, website synchronization or voluntary submissions. Public display does not imply unrestricted automated collection or account-free access.","priority":"P3","production_crawl_tested":false,"proposed_connector":"approved_api_or_organizer_submission","role":"Authorized content / discovery leads","scope":"France; filter by actual event location in Occitanie","source_id":"S143","verification_status":"Platform candidate; account / event collection untested"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
INSERT INTO "sources" VALUES('S144','Calaméo — brochures des organisateurs','Online brochures','France; filter by actual event location in Occitanie','Document publishing','https://www.calameo.com/','organizer_original_documents_with_permission','P2','Official organizer outbound link confirmed','An official Théâtre de la Cité page links its brochure. Reader access, download rights and reuse permission require separate checks.','https://theatre-cite.com/','2026-10-10','Review license, terms, robots policy and API permissions for each source.',0,0,NULL,NULL,'{"aliases":[],"authorization_review":"Review license, terms, robots policy and API permissions for each source.","category":"Online brochures","checked_on":"2026-10-10","department":"","enabled":false,"entry_url":"https://www.calameo.com/","evidence_url":"https://theatre-cite.com/","name":"Calaméo — brochures des organisateurs","notes":"An official Théâtre de la Cité page links its brochure. Reader access, download rights and reuse permission require separate checks.","priority":"P2","production_crawl_tested":false,"proposed_connector":"organizer_original_documents_with_permission","role":"Document publishing","scope":"France; filter by actual event location in Occitanie","source_id":"S144","verification_status":"Official organizer outbound link confirmed"}','eca6bdcf48ce9dc21b880908056b9495bc70a1ce00b4964310ff3575cf53f22e');
CREATE TRIGGER availability_entity_guard BEFORE INSERT ON availability_confirmations
WHEN NEW.occurrence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM occurrences c JOIN observations o ON o.id=c.observation_id
    WHERE c.id=NEW.occurrence_id AND o.entity_id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'availability/entity mismatch'); END;
CREATE VIEW current_occurrences AS
SELECT e.id AS entity_id,c.* FROM entities e JOIN occurrences c ON c.observation_id=e.current_observation_id;
CREATE VIEW current_records AS
SELECT e.id,e.kind,e.provider,e.external_id,e.last_seen_at,o.id AS observation_id,
       o.source_id,o.snapshot_id,o.observed_at,o.source_updated_at,o.data_json,
       json_extract(o.data_json,'$.title') AS title,
       json_extract(o.data_json,'$.department_code') AS department_code,
       json_extract(o.data_json,'$.commune_code') AS commune_code,
       json_extract(o.data_json,'$.status') AS status
FROM entities e JOIN observations o ON o.id=e.current_observation_id;
CREATE VIEW department_coverage AS
SELECT d.code,d.name,
 (SELECT count(*) FROM source_departments sd WHERE sd.department_code=d.code) AS registered_local_sources,
 (SELECT count(*) FROM source_departments sd JOIN sources s ON s.id=sd.source_id WHERE sd.department_code=d.code AND s.enabled=1) AS enabled_local_sources,
 (SELECT count(*) FROM current_records r WHERE r.department_code=d.code AND r.kind='event') AS events,
 (SELECT count(*) FROM current_records r WHERE r.department_code=d.code AND r.kind='educational_offer') AS educational_offers,
 (SELECT count(*) FROM current_records r WHERE r.department_code=d.code AND r.kind='venue') AS venues
FROM departments d;
CREATE VIEW educational_offers AS SELECT * FROM current_records WHERE kind='educational_offer';
CREATE TRIGGER entity_observation_guard BEFORE UPDATE OF current_observation_id ON entities
WHEN NEW.current_observation_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM observations WHERE id=NEW.current_observation_id AND entity_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'observation/entity mismatch'); END;
CREATE VIEW events AS SELECT * FROM current_records WHERE kind='event';
CREATE TRIGGER observation_source_guard BEFORE INSERT ON observations
WHEN NEW.source_id<>(SELECT source_id FROM snapshots WHERE id=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'snapshot/source mismatch'); END;
CREATE INDEX observations_entity ON observations(entity_id,id);
CREATE UNIQUE INDEX one_active_crawl ON crawl_runs((1)) WHERE status='running';
CREATE UNIQUE INDEX one_active_rail_dataset ON rail_datasets((1)) WHERE active=1;
CREATE UNIQUE INDEX one_active_refresh ON refresh_jobs((1)) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX one_active_walking_job ON walking_jobs((1)) WHERE status IN ('queued','running');
CREATE INDEX open_issues ON review_issues(entity_id) WHERE resolved_at IS NULL;
CREATE INDEX refresh_attempts_time ON refresh_attempts(started_at);
CREATE INDEX refresh_steps_endpoint ON refresh_steps(endpoint_id,phase,id);
CREATE TRIGGER snapshot_run_source_guard BEFORE INSERT ON snapshots
WHEN NEW.source_id<>(SELECT source_id FROM crawl_runs WHERE id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'snapshot/run source mismatch'); END;
CREATE VIEW venues AS SELECT * FROM current_records WHERE kind='venue';
CREATE INDEX walking_attempts_time ON walking_attempts(started_at);
COMMIT;
