# Activity database and crawler

Catalogue d’activités et collecte pour les sorties scolaires en Occitanie.

This contribution adds an English interface, English/French source metadata,
a portable SQLite database, six CSV tables, and the Python collection/query code.
It is independent of the existing journey planner and frontend.

## Data included

| Content | Count |
|---|---:|
| Event records | 1,279 |
| School services | 7 |
| Venue candidates | 50 |
| Published sessions / date intervals | 5,373 |
| Registered sources | 144 |
| Railway stations | 260 |

- [SQLite database](distribution/catalogue.sqlite3)
- [CSV tables](distribution/csv/)
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
qualify. The station subset comes from this repository's pinned multimodal
dataset; railway-only filtering is documented in [walking access](docs/WALKING-ACCESS.md).

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
`.env.example` and [operations](docs/OPERATIONS.md). New sources and endpoints
are disabled by default. No account or password is needed for the published
read-only viewer at https://zhaoyang.fr/sncf-events/.

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
credential scans. This package preserves the existing backend and frontend.
