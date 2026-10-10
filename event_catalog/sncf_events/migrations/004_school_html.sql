-- rebuild-with-foreign-key-check
CREATE TABLE endpoints_new (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    connector TEXT NOT NULL CHECK(connector IN ('datatourisme_events','datatourisme_places','openagenda_events','openagenda_agendas','jsonld','occitanie_region_events','fabre_school_offers')),
    url TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    UNIQUE(source_id,connector,url,config_json)
);
INSERT INTO endpoints_new SELECT * FROM endpoints;
DROP TABLE endpoints;
ALTER TABLE endpoints_new RENAME TO endpoints;
CREATE TABLE field_evidence_new (
    observation_id INTEGER NOT NULL REFERENCES observations(id), field TEXT NOT NULL,
    locator TEXT NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    method TEXT NOT NULL CHECK(method IN ('api','jsonld','manual','ai_reviewed','html_rule')),
    PRIMARY KEY(observation_id,field,locator)
);
INSERT INTO field_evidence_new SELECT * FROM field_evidence;
DROP TABLE field_evidence;
ALTER TABLE field_evidence_new RENAME TO field_evidence;
