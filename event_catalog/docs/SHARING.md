# Portable database and CSV package

The `event_catalog/distribution/` directory on the contribution branch contains `catalogue.sqlite3`, six CSV files, `schema.json` and a SHA-256 manifest. The package is a consistent read transaction from the operational evidence database. Original local data and backups are retained separately.

## Tables

| Table / CSV | Grain |
|---|---|
| activities | One current platform record: event, educational_offer or venue |
| occurrences | One published session or date interval, linked by activity_id |
| school_conditions | Extracted school conditions; missing values remain null |
| sources | Registered source and current reuse-review flags |
| stations | One railway-served station from the pinned upstream dataset |
| walking_assessments | One assessment per activity at export time |

SQLite also provides `events`, `educational_offers` and `venues` views and a `metadata` table. The schema is designed for downstream integration, not for resuming crawler jobs. Initialize a separate operational database with `python3 -m sncf_events init` before collecting more data.

CSV uses comma separation, quoted fields, CRLF rows and UTF-8 with BOM for Excel. Import identifiers (including department `09`, commune and station codes) as **Text**. ISO dates and timestamps retain their precision and timezone. Empty fields represent missing values, not zero. Cells beginning with a spreadsheet formula marker are prefixed with an apostrophe; SQLite retains the original typed value. No formulas are generated.

Do not flatten all sessions into a single invented date. `precision=date` means a date/range, not confirmed daily opening. `precision=datetime` retains explicit timestamps. Filter selected civil days in Europe/Paris; daylight saving transitions change their UTC boundaries.

## Example: 12 October 2026, within 20 minutes

```sql
SELECT DISTINCT a.id, a.title, a.city, a.address,
       w.station_name, w.walking_seconds, a.canonical_url
FROM activities a
JOIN occurrences o ON o.activity_id = a.id
JOIN walking_assessments w ON w.activity_id = a.id
WHERE a.kind = 'event' AND a.source_active = 1
  AND a.status <> 'cancelled' AND o.status <> 'cancelled'
  AND w.status = 'within_20_min' AND w.walking_seconds <= 1200
  AND julianday(w.valid_until) > julianday('now')
  AND (
    (o.precision = 'date' AND o.start_date <= '2026-10-12'
     AND coalesce(o.end_date,o.start_date) >= '2026-10-12')
    OR
    (o.precision = 'datetime'
     AND julianday(o.start_at) < julianday('2026-10-12T22:00:00Z')
     AND (julianday(o.end_at) > julianday('2026-10-11T22:00:00Z')
          OR julianday(o.start_at) >= julianday('2026-10-11T22:00:00Z')))
  );
```

The example UTC bounds apply to that specific Paris civil day. Compute new bounds with a timezone-aware library for other dates. Route validity is time-dependent; a frozen snapshot is not proof of continuing availability.

## Provenance and reuse

French source text remains French. Interface and registry metadata are English/French. One multilingual exhibition title uses its publisher-supplied French subtitle; `title_note` records that normalization. Dates, coordinates, IDs and URLs are unchanged.

Every activity retains its source ID, URL, observation time, source update time where available, attribution and evidence hash. Raw response bodies, personal contact lists, API keys, credentials, quarantined payloads and private operational history are excluded.

Source-specific rights continue to apply. `facts_reuse_allowed=0` means the recorded reuse review is not affirmative; publication of basic factual records does not grant downstream reuse permission. OpenAgenda and Musée Fabre reuse reviews remain pending. Descriptions are omitted unless a current review explicitly permits description reuse. Repository software licensing does not relicense third-party data.

The six CSV tables and SQLite contents are checked for counts, keys, date preservation, UTF-8 round trips, formula injection, non-English/French script and credentials before publication. The manifest records generation time and file digests. Reproduce with:

```sh
python3 -m sncf_events.share --db /path/to/operational.sqlite3 --output /new/output/directory
```
