# Contribution verification

## Version 0.7.1 — hourly quota removal, 2026-10-10

Removed the station lookup's application-imposed hourly request quota. The former
`SNCF_EVENTS_HOURLY_REQUESTS` setting is ignored, including in existing environments.
Serial collection, caching, provider HTTP 429 cooldowns, queue bounds, storage limits
and attempt accounting remain in effect.

All 26 station-lookup tests passed in a read-only, network-disabled sandbox with a
128 MiB memory ceiling. The copied implementation and tests match the verified files.
Regressions cover collection and routes after 300 attempts, the obsolete setting,
HTTP 429 pause and recovery, and storage protection. No live API calls or backend
deployment were performed for this patch. The portable database and CSV snapshot
are unchanged. Existing integrations must update their `event_catalog/` code.

## Version 0.7.0 — station lookup, 2026-10-10

Adds the station-first lookup described in [INTEGRATION.md](../INTEGRATION.md):
`sncf_events.nearby`, the `near`, `collect-near` and `setup-live` commands,
station-scoped collection on DATAtourisme, Région Occitanie and OpenAgenda, and
migration `007_station_lookups`. The package passes 217 Python tests and 12
interface logic checks without network access or credentials.

Live checks with real keys, each on a new database: Montpellier Saint-Roch for
2026-10-12 completed in 41 seconds with 22 venues routed and 20 activities
within 1,200 seconds; Toulouse Matabiau, Carcassonne and Narbonne for 2026-10-14
completed together in 86 seconds with 18 activities. Unknown and ambiguous
station names were reported, not guessed.

The portable snapshot in `distribution/` is unchanged from version 0.6.0 and
does not contain these live results. The integration into `backend/` described
in INTEGRATION.md has not been applied or run in this repository. Recorded
source reviews expire on 2026-11-10; collection for a source stops at expiry.

## Version 0.6.0 — portable snapshot

Version 0.6.0, prepared on 2026-10-10. The copied standalone package passes
194 Python tests and 12 interface logic checks. SQLite integrity and foreign
keys, CSV/table counts, UTF-8 text, stable IDs, explicit timezones, route expiry,
manifest digests and credential/language scans are checked before publication.

The snapshot has 1,336 records, 5,373 sessions, 144 registered sources and 260
railway stations. Of 162 candidates for 2026-10-12, 30 pass the walking rule,
129 are outside the current station/model scope and 3 remain unknown.

Unknown group capacity and availability remain unknown. No exhaustive regional
coverage, universal source compatibility or automatic server refresh is claimed.
Native browser visual verification was unavailable because the computer-use
connection failed to initialize; HTTP and JavaScript checks were performed.

The public website now serves the English account-free viewer. All 25 public
HTTP checks passed without credentials, including search, details and CSV/JSON
downloads. Write routes remain denied. Publication did not restart any existing
business service or the gateway container.
