-- rebuild-with-foreign-key-check
-- Preserve every endpoint ID and dependent crawl run; db.migrate validates before commit.
CREATE TABLE endpoints_new (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    connector TEXT NOT NULL CHECK(connector IN ('datatourisme_events','datatourisme_places','openagenda_events','openagenda_agendas','jsonld','occitanie_region_events')),
    url TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    UNIQUE(source_id,connector,url,config_json)
);
INSERT INTO endpoints_new SELECT * FROM endpoints;
DROP TABLE endpoints;
ALTER TABLE endpoints_new RENAME TO endpoints;
