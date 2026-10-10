ALTER TABLE quarantined_records ADD COLUMN resolved_at TEXT;
ALTER TABLE quarantined_records ADD COLUMN resolution TEXT;
ALTER TABLE quarantined_records ADD COLUMN observation_id INTEGER REFERENCES observations(id);
