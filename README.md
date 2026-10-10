# sncf_rapport

Post-trip report for parents — « Notre voyage, nos apprentissages ». One JSON
document in, one PDF out: route map, what the class did, the teacher's rating
of five competencies, an estimated CO₂ comparison with coach and car, photos
with consent, sources. The PDF is either returned (`/api/v1/render`) or
emailed to the address the teacher gave (`/api/v1/reports`), through the same
pipeline as `sncf_bilan` (Mailato, Resend, `sorties@zhaoyang.fr`).

No form, no access to other modules' databases. The only thing kept is the
sending job (status, PDF) for 30 days.

> **Merging this module? Read [`docs/INTEGRATION.md`](docs/INTEGRATION.md) first.**
> Two things bite: **(1)** every input field is optional, so a wiring mistake
> does not fail, it gives a poorer PDF; the service tells you what it did not
> receive (`/api/v1/check`, `X-Rapport-Missing-*` headers, a WARNING log line,
> `scripts/preview.py`). Look at that list. **(2)** the email address is not in
> any existing module: **the teacher's feedback form must ask for it** and pass
> it as `recipient.email`, or nothing can be sent.

## Quick start

Needs Python 3.12 or 3.13, [uv](https://docs.astral.sh/uv/), and Pango for
WeasyPrint (`brew install pango` on macOS, `apt install libpango-1.0-0
libpangoft2-1.0-0` on Debian/Ubuntu).

```bash
uv sync
uv run python scripts/preview.py contracts/examples/01-carcassonne-complet.json
open var/preview/01-carcassonne-complet.pdf     # the report
open var/preview/01-carcassonne-complet.eml     # the email, in your mail client
```

Ready-made examples: `docs/example/rapport-exemple.pdf` (full data, with the
model-written texts) and `docs/example/rapport-exemple-sans-donnees.pdf` (an
empty request, to see how missing data looks).

A hosted instance runs at `https://zhaoyang.fr/sncf-rapport` (live sending).
It needs the `X-Rapport-Key` value, which the project owner sends privately;
call it from a server, never from a browser, and never commit the key.

```bash
B=https://zhaoyang.fr/sncf-rapport
# PDF back, nothing stored or sent
curl -sS -H "X-Rapport-Key: $KEY" -H 'Content-Type: application/json' \
  --data @contracts/examples/01-carcassonne-complet.json $B/api/v1/render -o rapport.pdf
# PDF emailed to recipient.email (edit the example first: it has a placeholder address)
curl -sS -H "X-Rapport-Key: $KEY" -H 'Content-Type: application/json' \
  --data @my-request.json $B/api/v1/reports
```

From the planner's data plus the teacher's answers:

```bash
uv run python scripts/assemble.py TRAVEL_FILE.json TEACHER.json > request.json
uv run python scripts/preview.py request.json
```

As a service:

```bash
RAPPORT_API_KEY=change-me uv run uvicorn sncf_rapport.api:app --factory --port 8771
# PDF back, nothing stored or sent
curl -sS -D - -o rapport.pdf -H 'X-Rapport-Key: change-me' -H 'Content-Type: application/json' \
  --data @contracts/examples/01-carcassonne-complet.json http://127.0.0.1:8771/api/v1/render
# PDF emailed to recipient.email (dry-run by default: the message lands in var/outbox/)
curl -sS -H 'X-Rapport-Key: change-me' -H 'Content-Type: application/json' \
  --data @contracts/examples/01-carcassonne-complet.json http://127.0.0.1:8771/api/v1/reports
```

With Docker instead of Python and Pango: `docker compose up --build` (needs
`credentials.env`, service on the same port 8771).

One real email to yourself, without the service (sends only with `--yes`):

```bash
uv run python scripts/send_example.py contracts/examples/01-carcassonne-complet.json \
  --to you@example.com --yes
```

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/render` | request JSON → `application/pdf`, missing fields in response headers; nothing stored |
| `POST /api/v1/reports` | request JSON → PDF rendered, recorded and emailed to `recipient.email`. `202` queued · `200` same content already accepted (no second email) · `409` `idempotency_key` reused with other content · `422` invalid value or **no recipient** · `429` daily limit |
| `GET /api/v1/reports/{id}` | `queued`, `sent` or `failed`, with the provider's message id or the error |
| `GET /api/v1/reports/{id}/document.pdf` | the PDF that was attached |
| `POST /api/v1/reports/{id}/retry` | sends a failed report again (`409` if it is not failed) |
| `POST /api/v1/check` | request JSON → list of missing fields and their effect |
| `POST /api/v1/enrich` | request JSON → same request plus generated `education.insights` |
| `GET /healthz` | liveness and the mail mode |

Limits by default: 80 emails per 24 h in total, 5 per recipient, one recipient
per report. Jobs and PDFs are deleted after 30 days.

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
  mail/          subject, text and HTML bodies, compose.py, deliver.py (Mailato)
  service.py     render, record, send, retry
  store.py       SQLite job record (var/rapport.sqlite3, var/documents/)
  api.py         FastAPI surface
contracts/       JSON Schema + examples (0x valid, 9x invalid, inputs/)
data/            stations, connections, emission factors (see PROVENANCE.md)
scripts/         preview, send_example, assemble, enrich, fetch_factors, export_schema, stress
evals/           real-model evaluation of the generated texts
deploy/          Dockerfile, server compose file, gateway block (see docs/DEPLOYMENT.md)
docs/            INTEGRATION.md, PLAN.zh-CN.md, HANDOFF.md, DEPLOYMENT.md, adr/
```

## Configuration

Read from the environment, completed by the git-ignored `credentials.env` at
the project root (template: `credentials.env.example`; a shell variable wins
over the file). Never commit the file or paste a key in an issue or chat.

| Variable | Default | Meaning |
|---|---|---|
| `RAPPORT_API_KEY` / `RAPPORT_API_KEY_FILE` | unset = open API | value expected in `X-Rapport-Key`; required in `live` mode |
| `RAPPORT_MAIL_MODE` | `dry-run` | `dry-run` writes `var/outbox/<id>.eml`; `live` sends through Resend |
| `RESEND_API_KEY` / `RESEND_API_KEY_FILE` | unset | required in `live` mode only |
| `RAPPORT_MAIL_FROM` | `Sorties scolaires liO – démo <sorties@zhaoyang.fr>` | sender |
| `RAPPORT_REPLY_TO` | unset | Reply-To; without it the email says not to reply |
| `RAPPORT_ALLOWED_DOMAINS` | any | comma-separated recipient domains accepted in `live` mode |
| `RAPPORT_COPY_TO` | unset | comma-separated: every email also goes as a blind copy to these addresses (the recipient is never copied to itself) |
| `RAPPORT_DAILY_LIMIT`, `RAPPORT_RECIPIENT_DAILY_LIMIT` | 80, 5 | emails per 24 h |
| `RAPPORT_RETENTION_DAYS` | 30 | jobs and PDFs older than this are deleted at start-up |
| `RAPPORT_DATA_DIR` | `var` | where jobs, PDFs and the outbox live |
| `RAPPORT_LOGO_SVG` | `assets/brand/logo.svg` | logo in the masthead |
| `RAPPORT_LOGO_PNG` | `assets/brand/logo.png` | inline logo of the email |
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
- Resend accepts about 40 MB per message; a report with many large photos may
  be refused by the provider and end `failed` with the provider's message.

Email delivery uses [Mailato](https://github.com/ze2phyrzhenyin/Mailato) 0.4.0.
Rules for contributors and coding agents: `AGENTS.md`.
