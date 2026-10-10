# Integrating the station activity lookup

Give one or more railway stations and a date; get back structured data for that day's activities within a
checked 20-minute walk of each station: what, when, where, how far, and the source link. No web page is
involved. Python 3.11+, SQLite, no third-party dependency.

```python
from sncf_events.nearby import Service

service = Service("event_catalog/var/live.sqlite3", stations_dir="backend/data").start()
result = service.activities(["87773002", "87773200", "87775007"], "2026-10-12")
service.stop()
```

Stations are UIC identifiers (the `stop_id` values of `stations_occitanie.csv`, also found in `legs[].stops`
of a computed route) or exact station names. Pass every stop of a journey to search along the route.

## How live collection works

`service.activities()` never blocks on the network. It returns what is already verified and, when live, queues
what is missing. A background worker then, one bounded request at a time:

1. asks each source only for events on that date around each station (1,400 m upstream filter);
2. keeps venues within 1,334 m in a straight line;
3. requests an IGN pedestrian route from the station to each venue and accepts 1,200 seconds or less.

Call again until `pending` is `false`. On 2026-10-10 a first lookup of Montpellier Saint-Roch took 41 seconds,
and Toulouse Matabiau, Carcassonne and Narbonne together took 86 seconds. Results are reused for six hours; routes for 30 days.

Only one process collects (file lock). Other processes, or a process without keys, serve stored results.

## Keys

Set both in the process environment before `start()`; never commit them:

```dotenv
DATATOURISME_API_KEY=...
OPENAGENDA_PUBLIC_KEY=oa_pk_...
```

Without a key, that source's step fails and is reported in `coverage.sources`; the other sources still work.
Région Occitanie and IGN need no key. The station lookup has no application-imposed hourly request quota.
`SNCF_EVENTS_HOURLY_REQUESTS` is no longer used, including when present in an existing environment.
The optional storage limit remains `SNCF_EVENTS_STORAGE_MB` (default 512).

Collection remains serial and pauses for ten minutes after a provider returns HTTP 429. Provider-side
limits still apply. Results and routes remain cached, and request attempts are recorded for diagnostics.
On a public site every uncached station/date pair can trigger external requests; rate-limit the endpoint
per client as well.

## Response

```json
{
  "date": "2026-10-12", "timezone": "Europe/Paris", "limit_seconds": 1200,
  "complete": true, "pending": false, "total": 24,
  "stations": [{
    "id": "87775007", "name": "Nîmes Centre", "commune": "Nîmes", "department_code": "30",
    "latitude": 43.832, "longitude": 4.366,
    "coverage": {"state": "complete", "error": null, "collected_at": "2026-10-10T05:58:41+00:00",
                 "venues_in_radius": 5, "routes_verified": 5, "routes_pending": 0, "routes_unavailable": 0,
                 "sources": [{"endpoint_id": "datatourisme-events", "status": "complete", "pages": 1, "accepted": 8, "error": null}]},
    "activities": [{
      "id": "…", "title": "Balade sonore : Nîmes en filature", "theme": null,
      "occurrences": [{"start_at": null, "end_at": null, "start_date": "2026-09-01", "end_date": "2026-12-31",
                       "precision": "date", "status": "scheduled"}],
      "schedule_text": null, "location_name": null, "address": "6 Boulevard des arènes", "city": "Nîmes",
      "latitude": 43.835, "longitude": 4.36, "price_text": null, "description": null,
      "url": "https://data.datatourisme.fr/…", "official_url": "https://organiser.example/…",
      "booking_url": "https://tickets.example/…", "venue_url": null,
      "source_id": "S001", "source_name": "DATAtourisme",
      "attribution": "…", "license": "…", "facts_reuse_allowed": true, "observed_at": "2026-10-10T05:58:12+00:00",
      "walking_seconds": 795, "walking_minutes": 14, "walking_metres": 795, "route_checked_at": "…",
      "also_near": [], "other_sources": []
    }]
  }],
  "unknown_stations": [{"reference": "nimes", "reason": "ambiguous_station",
                        "candidates": [{"id": "87775007", "name": "Nîmes Centre"}, {"id": "87703975", "name": "Nîmes Pont du Gard"}]}],
  "live": {"enabled": true, "worker_error": null, "requests": [{"station_id": "87775007", "action": "queued"}]},
  "note": "Walking times are route estimates …"
}
```

- `occurrences` holds only the sessions on the requested day. `precision: "datetime"` carries `start_at`/`end_at`
  with their offset; `precision: "date"` is a published date range and does not establish that day's opening hours.
- `coverage.state`: `not_requested`, `queued`, `running`, `complete`, `partial` (a source or route failed; see
  `error` and `sources`) or `failed`. An empty `activities` list means "none found" only when the state is `complete`.
- An activity near several requested stations appears once, under the shortest checked walk; `also_near` lists the others.
- The same title at the same place from two publishers is one entry; `other_sources` keeps the other links,
  and a link missing from the listed record is taken from the other one.
- Four links, each `null` when the source does not publish it:
  - `url`: the record's page on the source platform (DATAtourisme, OpenAgenda or laregion.fr). Always the
    attribution link; it is not the organiser's site.
  - `official_url`: the organiser's page as published by DATAtourisme (`hasContact.homepage`). Usually the
    activity's own page, sometimes only the organiser's home page.
  - `booking_url`: the ticketing or registration page (DATAtourisme `hasBookingContact.homepage`,
    OpenAgenda `registration` entries of type `link`). It does not establish availability or group booking.
  - `venue_url`: the venue's website (OpenAgenda `location.website`); not specific to the activity.
  Links are copied from the source, checked only for being public `http(s)` addresses, and never fetched or
  guessed. Région Occitanie publishes no link other than `url`. In a live check on 2026-10-10, 97 of 100
  DATAtourisme events around Toulouse carried an organiser page and 66 a ticketing page; of 251 OpenAgenda
  events in three agendas, 179 carried a venue website and 95 a registration link.
- `description` is `null` unless the source's recorded review allows description reuse. Keep `url` and
  `attribution` with anything you display. `facts_reuse_allowed: false` means that review is not affirmative.
- Bus stops and unknown or ambiguous names are returned in `unknown_stations`, never guessed.
- `ValueError` codes: `date_must_be_YYYY_MM_DD`, `date_outside_live_window` (yesterday to 400 days ahead),
  `stations_must_be_1_to_40`, `invalid_station_reference`, `station_registry_missing`.

## Adding it to the IA_Impact_projet backend

`event_catalog/` lives on branch `feature/activities-database-crawler`; bring that directory into the working
branch (`git checkout origin/feature/activities-database-crawler -- event_catalog`). Then:

1. `backend/app/activities.py` — put `event_catalog` on `sys.path` and create one
   `Service(<repo>/event_catalog/var/live.sqlite3, stations_dir=<repo>/backend/data)`. `stations_dir` must be the
   full `backend/data` directory; its three files are hash-pinned. `event_catalog/var/` is already git-ignored.
2. `backend/app/main.py` — start the service on application startup and stop it on shutdown. `app.chat` already
   loads `backend/.env` into the environment at import, so the two keys go in that file.
3. Add `GET /activities?date=YYYY-MM-DD&stations=87773002,87773200` and `GET /activities?date=…&from=…&to=…`.
   For the second form call `network.route(from, to)` and pass every identifier of every `legs[].stops`.
   Return the dictionary unchanged; map `ValueError` to the existing `{"detail": {"code", "message"}}` 400 shape.
4. Reuse the per-IP limiter pattern of `/chat` for this endpoint.
5. Test with a temporary database and `Service(..., live=False)`; do not call the network in tests.

First start creates the database, applies the recorded source reviews shipped in `data/reviews/` (they expire on
2026-11-10; collection stops for a source whose review has expired until a new review file is added), enables the
six event endpoints and imports the 260 railway stations.

## Command line and viewer

```sh
python3 -m sncf_events setup-live --stations-dir /path/to/backend/data
python3 -m sncf_events stations montpellier
python3 -m sncf_events collect-near --station 87773002 --station "Nîmes Centre" --date 2026-10-12
python3 -m sncf_events near --station 87773002 --date 2026-10-12      # stored evidence only
```

The read-only viewer serves the same stored answer at `GET /api/near?stations=ID,ID&date=YYYY-MM-DD` and
`GET /api/stations?q=…`; it never collects.

## Limits

Six event endpoints are queried: DATAtourisme, Région Occitanie and four selected OpenAgenda calendars. This is not
exhaustive local coverage. Walking times start at the station coordinates, not a verified entrance. Train service on
the chosen day, group capacity and booking are not checked. Events removed upstream after collection are only
noticed by the regional change collection described in [operations](docs/OPERATIONS.md).
