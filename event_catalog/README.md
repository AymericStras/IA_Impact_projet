# Activity database and crawler

Catalogue d’activités et collecte pour les sorties scolaires en Occitanie.

Find activity sources, use the collected dates and locations, or run the crawler
for school trips within a 20-minute walk of a railway station. This branch
contains only the standalone `event_catalog/` project.

**New in 0.7.0 — station lookup.** Give one or more railway stations and a date; receive structured data for that day's activities within a checked 20-minute walk, collected live around those stations only.

## Integrate with one prompt

Paste this into an AI coding assistant opened at the root of `IA_Impact_projet`. It adds one backend endpoint that
returns structured data only — time, place, basic information, walking time and source link — for activities near
one station or every station of a journey. Details are in [INTEGRATION.md](INTEGRATION.md).

```text
Integrate the activity crawler and its source data from event_catalog/ into this project's backend.

1. If event_catalog/ is missing on this branch, bring it in without merging anything else:
   git fetch origin feature/activities-database-crawler
   git checkout origin/feature/activities-database-crawler -- event_catalog
2. Read event_catalog/INTEGRATION.md completely and follow its section
   "Adding it to the IA_Impact_projet backend".
3. Add GET /activities to backend/app. It accepts date=YYYY-MM-DD and either stations=UIC,UIC,...
   or from=...&to=... (use network.route and pass every identifier of every legs[].stops).
   Return the dictionary of sncf_events.nearby.Service.activities unchanged. Structured data only:
   no frontend, no page, no change to existing endpoints.
4. Keys: I was sent a private file containing DATATOURISME_API_KEY and OPENAGENDA_PUBLIC_KEY.
   Ask me for its path, append its two lines to backend/.env (git-ignored), and never print,
   log or commit the values. If I do not have the file yet, finish everything else and tell me
   where the two lines go.
5. Apply the same per-IP rate limit pattern as /chat to /activities.
6. Add tests with Service(..., live=False) and a temporary database; tests must not use the network.
   Add /activities to the endpoint table of backend/README.md.
7. Leave event_catalog/distribution (portable SQLite and CSV snapshot, 144 registered sources) as
   offline reference data; do not import it into the live database.
8. Start the server, request /activities?stations=87773002&date=<a date within the next week>,
   poll every few seconds until "pending" is false, and show me the JSON and the test results.
```

## Start here: the most important files

**Start with [sources.csv](distribution/csv/sources.csv) to understand which
platforms and websites have been identified for collection.** It lists 144
research entries, including access methods and review status. Four sources
have been collected; the list is not a guarantee that every entry can be crawled.

| What you need | Open this file | What it contains |
|---|---|---|
| **Find platforms and websites** | **[sources.csv](distribution/csv/sources.csv)** | Source names, entry URLs, proposed connectors, priorities and access/reuse status. |
| **Use the collected activities** | **[activities.csv](distribution/csv/activities.csv)** | Titles, locations, addresses, descriptions where available, and original source links. Includes events, school services and venues. |
| **Find activities for a date** | **[occurrences.csv](distribution/csv/occurrences.csv)** | Published dates, times and sessions. Join `activity_id` to `activities.csv`'s `id`. |
| **Query all the data together** | **[catalogue.sqlite3](distribution/catalogue.sqlite3)** | The portable database combining the six exported tables. |
| **Set up the two API keys** | **[API-KEYS.md](docs/API-KEYS.md)** | DATAtourisme and OpenAgenda registration links and local configuration. Actual keys are not included. |
| **Run or extend collection** | **[OPERATIONS.md](docs/OPERATIONS.md)** and **[connectors.py](sncf_events/connectors.py)** | Collection commands and implemented API connectors. School HTML parsing is in [html_rules.py](sncf_events/html_rules.py). |

For the **20-minute walk rule**, use
[walking_assessments.csv](distribution/csv/walking_assessments.csv) and
[stations.csv](distribution/csv/stations.csv). The
[dated query example](docs/SHARING.md#example-12-october-2026-within-20-minutes)
combines activities, sessions and valid walking estimates.

To browse without downloading files, open the
[published activity viewer](https://zhaoyang.fr/sncf-events/) — no account is
required. It displays saved data; automatic server collection is not enabled.

## Data included

| Content | Count |
|---|---:|
| Event records | 1,279 |
| School services | 7 |
| Venue candidates | 50 |
| Published sessions / date intervals | 5,373 |
| Registered sources | 144 |
| Railway stations | 260 |

- [All six CSV tables](distribution/csv/)
- [Checksums and generation metadata](distribution/manifest.json)
- [Data dictionary](distribution/schema.json)
- [Query examples, CSV conventions and source rights](docs/SHARING.md)

The six tables contain activities, occurrences, school conditions, sources,
stations and walking assessments. School-condition rows also preserve unknown
conditions; their count is not a count of confirmed school offers. Data is a
snapshot collected on 2026-10-10. Source IDs identify records, not globally
deduplicated activities. Four sources have been collected; 144 is the research
registry size, not the number of working crawlers.

## Read the shared database

```sh
cd event_catalog
sqlite3 distribution/catalogue.sqlite3 \
  'SELECT kind,count(*) FROM activities GROUP BY kind;'
sqlite3 -header -csv distribution/catalogue.sqlite3 \
  'SELECT title,city,address,canonical_url FROM events LIMIT 10;'
```

See [the dated SQL example](docs/SHARING.md) for session-aware queries within a
20-minute walk of a station. The default website filter accepts only verified,
unexpired pedestrian estimates of at most 1,200 seconds. Unknown routes do not
qualify. The station subset comes from the upstream multimodal dataset at
[commit 5029e9d](https://github.com/AymericStras/IA_Impact_projet/tree/5029e9d0b5f64c12e2b01e931f4ab63ef887d747/backend/data);
railway-only filtering is documented in [walking access](docs/WALKING-ACCESS.md).

## Run the crawler and local interface

Python 3.11+ is sufficient; there are no third-party Python dependencies.
The portable database uses an exchange schema. Create a separate operational
database for new collection; it starts with sources and zero activity records.

```sh
cd event_catalog
python3 -m sncf_events init
python3 -m sncf_events check
python3 -m sncf_events doctor
python3 -m sncf_events serve
```

Open http://127.0.0.1:8766. Collection requires source reviews and, for
DATAtourisme/OpenAgenda, your own API keys in a private `.env` file. Use
[the two-key setup guide](docs/API-KEYS.md), `.env.example` and
[operations](docs/OPERATIONS.md). New sources and endpoints
are disabled by default. No account or password is needed for the published
read-only viewer at https://zhaoyang.fr/sncf-events/.

For development, [cli.py](sncf_events/cli.py) defines the commands,
[normalize.py](sncf_events/normalize.py) maps source data to catalogue fields,
and [rail.py](sncf_events/rail.py) handles station access and walking estimates.
The crawler imports the [source seed](data/seeds/sources-2026-10-10.json) into
its operational database. Editing the exported `sources.csv` alone does not
configure or enable a collector.

```sh
python3 -m unittest discover -s tests -v
node tests/test_view.mjs
python3 -m sncf_events.share --db var/occitanie.sqlite3 --output var/new-share
```

## Scope and rights

Implemented collection covers DATAtourisme, selected OpenAgenda calendars,
Région Occitanie and reviewed Musée Fabre school pages. IGN supplies pedestrian
route estimates. Universal crawling, live group inventory and train timetable
verification are not claimed. The website reads a snapshot; automatic server
collection is not enabled.

No API keys, authentication files, raw response archives, contact lists or
private server configuration are included. Descriptions are omitted unless
their current source review permits reuse. Source rights and pending review
flags remain in the database; publishing facts does not grant downstream
reuse permission. The repository software license does not relicense source
data or underlying SNCF/IGN datasets. Original French titles and descriptions
remain in French; one multilingual title uses its supplied French subtitle.

Code version: 0.6.0. Validation: 194 Python tests and 12 interface logic checks,
plus SQLite integrity, foreign keys, CSV round trips, file hashes and language/
credential scans. The software license is included in [LICENSE](LICENSE).
