# Contribution verification

## Version 0.7.3 — refreshed snapshot with links, 2026-10-10

The portable database and CSVs in `distribution/` were regenerated from a catalogue
collected again on 2026-10-10 with the 0.7.2 link fields. They hold 1,708 activities
(1,651 events, 7 school services, 50 venues), 6,324 sessions or date intervals, 144
registered sources and 260 stations. `activities` gains three nullable columns:
`official_url` (226 events, 31 venues), `booking_url` (318 events, 1 venue) and
`venue_url` (420 events). Région Occitanie publishes no link other than its own page.
The larger count comes from following more result pages of the same endpoints, not
from new sources; it is still not exhaustive regional coverage. Checksums are in
`distribution/manifest.json`.

The application storage budget is 32 MiB (16 MiB before). The package passes 225
Python tests and the interface logic checks. The public viewer at
https://zhaoyang.fr/sncf-events/ serves this version and this catalogue; 28
account-free HTTP checks pass there, including `/api/stations`, `/api/near` and
returned links. The statement below that the snapshot has no link columns describes
0.7.2 only.

## Version 0.7.2 — organiser, ticketing and venue links, 2026-10-10

Collected records and the station lookup now carry `official_url` (DATAtourisme
`hasContact.homepage`), `booking_url` (DATAtourisme `hasBookingContact.homepage`,
OpenAgenda `registration` links) and `venue_url` (OpenAgenda `location.website`),
next to the existing source page link. Only the link sub-fields are requested upstream;
contact names, e-mail addresses and telephone numbers are not collected. Links are
copied from the source, validated as public `http(s)` addresses and never fetched.

The package passes 225 Python tests and the interface logic checks; the copied
implementation and tests match the verified files. Live check with real keys on a new
database: Toulouse Matabiau and Narbonne for 2026-10-17 completed in 66 seconds with
15 activities; all 10 DATAtourisme activities carried `official_url` and 7
`booking_url`, the OpenAgenda activity carried `venue_url`, and the 4 Région Occitanie
activities carried only their laregion.fr page.

The portable database and CSV snapshot in `distribution/` are unchanged: they were
collected before this version and contain no link columns. Links appear in a database
you collect with this code, including the live station lookup. A database created by
an earlier version keeps working without a migration; its records gain links when they
are collected again. Existing integrations must update their `event_catalog/` code.

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
