# sncf_rapport

Post-trip report for parents — « Notre voyage, nos apprentissages ». One JSON
document in, one PDF out: route map, what the class did, the teacher's rating
of five competencies, an estimated CO₂ comparison with coach and car, photos
with consent, sources.

It renders only. No form, no storage, no email, no access to other modules'
databases.

> **Merging this module? Read [`docs/INTEGRATION.md`](docs/INTEGRATION.md) first.**
> Every input field is optional, so a wiring mistake does not fail: it gives a
> poorer PDF. The service tells you what it did not receive (`/api/v1/check`,
> `X-Rapport-Missing-*` headers, a WARNING log line, `scripts/preview.py`).
> Look at that list.

## Quick start

Needs Python 3.12 or 3.13, [uv](https://docs.astral.sh/uv/), and Pango for
WeasyPrint (`brew install pango` on macOS, `apt install libpango-1.0-0
libpangoft2-1.0-0` on Debian/Ubuntu).

```bash
uv sync
uv run python scripts/preview.py contracts/examples/01-carcassonne-complet.json
open var/preview/01-carcassonne-complet.pdf
```

Ready-made examples: `docs/example/rapport-exemple.pdf` (full data, with the
model-written texts) and `docs/example/rapport-exemple-sans-donnees.pdf` (an
empty request, to see how missing data looks).

From the planner's data plus the teacher's answers:

```bash
uv run python scripts/assemble.py TRAVEL_FILE.json TEACHER.json > request.json
uv run python scripts/preview.py request.json
```

As a service:

```bash
RAPPORT_API_KEY=change-me uv run uvicorn sncf_rapport.api:app --factory --port 8771
curl -sS -D - -o rapport.pdf -H 'X-Rapport-Key: change-me' -H 'Content-Type: application/json' \
  --data @contracts/examples/01-carcassonne-complet.json http://127.0.0.1:8771/api/v1/render
```

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/render` | request JSON → `application/pdf`, missing fields in response headers |
| `POST /api/v1/check` | request JSON → list of missing fields and their effect |
| `POST /api/v1/enrich` | request JSON → same request plus generated `education.insights` |
| `GET /healthz` | liveness |

## Layout

```
src/sncf_rapport/
  models.py      input contract (all optional; cleans and truncates text)
  gaps.py        what was missing and what the reader loses
  assemble.py    planner travel file + teacher JSON -> request
  view.py        the only layer the template reads; all derivations
  enrich.py      optional: model-written texts on the educational value
  geo/           station lookup, rail path, distance, inline SVG map
  carbon/        emission factors and the estimate
  pdf/           Jinja template, CSS, WeasyPrint
  api.py         FastAPI surface
contracts/       JSON Schema + examples (0x valid, 9x invalid, inputs/)
data/            stations, connections, emission factors (see PROVENANCE.md)
scripts/         preview, assemble, enrich, fetch_factors, export_schema, stress
evals/           real-model evaluation of the generated texts
docs/            INTEGRATION.md, PLAN.zh-CN.md, HANDOFF.md, adr/
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `RAPPORT_API_KEY` / `RAPPORT_API_KEY_FILE` | unset = open API | value expected in `X-Rapport-Key` |
| `RAPPORT_LOGO_SVG` | `assets/brand/logo.svg` | logo in the masthead |
| `RAPPORT_STATIONS_CSV`, `RAPPORT_CONNECTIONS_CSV` | `data/…` | rail network for the map and distance |
| `RAPPORT_EMISSION_FACTORS` | `data/emission_factors.json` | refreshed by `scripts/fetch_factors.py` |
| `RAPPORT_ROOT_PATH` | empty | path prefix behind a reverse proxy |
| `OPENAI_API_KEY` / `OPENAI_API_KEY_FILE` | unset = no generated text | enables the "educational value" texts |
| `RAPPORT_ENRICH` | `auto` | `off` to never call the model |
| `RAPPORT_OPENAI_MODEL` | `gpt-5.4-mini` | model for those texts |

## Checks

```bash
uv run ruff check . && uv run ruff format --check . && uv run pytest \
  && uv run python scripts/export_schema.py --check
uv run python scripts/stress.py 300     # random hostile requests, must report 0 failure
```

## Limits to know

- Map and distance cover Occitanie only (260 stations). Elsewhere: no map, and
  the CO₂ estimate needs `environment.distance_km_override`.
- Distance is the sum of straight segments between stops: about 3–6 % under the
  real rail distance. It is printed as an estimate.
- Emission factors are ADEME national averages (Impact CO2), usage plus vehicle
  manufacture, infrastructure excluded. The car baseline assumes four people
  per car (full cars, the assumption least favourable to the train) unless
  `environment.car_occupancy` is given; the report prints the assumption.
- Trips marked `simulated` carry a "SIMULATION" watermark.
