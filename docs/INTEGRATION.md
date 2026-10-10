# Integration guide — read this before merging

This module turns one JSON document (`TripReportRequest`) into one PDF: the
post-trip report a teacher sends to parents. It stores nothing, sends nothing,
and reads no other module's database. You call it; it answers with a PDF.

## The one thing to remember

**Every field of the request is optional.** The service never refuses a request
because something is missing. It renders what it has and prints
« non communiqué », or leaves the block out.

That is convenient while the upstream field names are still moving, and it is
also a trap: **a wiring mistake does not fail, it silently produces a poorer
report.** So after you connect your data, check what the service did not
receive. There are four ways, use at least one in your pipeline:

| Where | What you get |
|---|---|
| `POST /api/v1/check` | JSON: `{summary, major, minor, gaps: [{field, severity, effect}]}`, no PDF rendered into the response |
| `POST /api/v1/render` response headers | `X-Rapport-Missing-Major-Count`, `X-Rapport-Missing-Minor-Count`, `X-Rapport-Missing-Major`, `X-Rapport-Missing-Minor` (comma-separated field paths) |
| Service log | one `WARNING` line per rendered report with holes: `report rendered with 2 major and 5 minor missing field(s); major: …` |
| `uv run python scripts/preview.py request.json` | the PDF in `var/preview/` and the full list on stderr (`!!` = major) |
| Python | `build_report_view(request).gaps` → tuple of `Gap(field, severity, effect)` |

`major` means a whole block of the report is empty or missing. `minor` means a
line or a detail is missing. Recommended rule for the merged product: block the
"send to parents" button, or at least show the teacher a warning, while
`major > 0`.

## What to send, by importance

Fields that change the report most when absent (all reported as `major`):

| Field | If you cannot extract it |
|---|---|
| `school.name`, `school.class_name` | cover has no school or class. The chatbot does not collect them on purpose: they must come from the teacher step or the school account. |
| `trip.date` | no date anywhere |
| `trip.origin_station`, `trip.destination_station` (or `trip.outbound.from_station` / `to_station`) | no route map, no distance, **no CO₂ estimate** |
| `education.subject` or `education.theme` | cover has no subject |
| `education.activities` | "Ce que nous avons fait" has no activity |
| `teacher_feedback` (whole object) | all five competencies read « Non évaluée » and the report says it is not validated |
| `teacher_feedback.actual_participants` | falls back to `trip.planned_participants` (labelled « prévus »); with neither, no head count and no CO₂ |
| `teacher_feedback.trip_completed` | the report does not say whether the trip happened as planned |
| `teacher_feedback.competencies` | all « Non évaluée » |
| `teacher_feedback.validated_at` | report marked « non encore validé » |

Reported as `minor`: `education.insights` (no model key, or the step was not
run), `school.teacher_name`, `trip.outbound`, `trip.return`,
`trip.*.train_number`, `education.objectives`, `education.places`,
`education.places[i].official_url`, each competency left `non_evalue`,
`teacher_feedback.completed_activity_ids`, `teacher_feedback.observations`,
`media.photos`, a photo without `consent: true` or without image data.

Gaps found while computing (also in the list):

- A station name that is not in the bundled network (`data/stations.csv`: 260
  stations, **Occitanie only**). No map is drawn. Send
  `environment.distance_km_override` to still get a CO₂ estimate.
- `data/emission_factors.json` missing or unreadable: the CO₂ block is hidden.
  Run `uv run python scripts/fetch_factors.py`.
- A photo `path` that cannot be read, or an unsupported image type.
- The logo file is missing.

## Where each field comes from today

| Request field | Source in the current modules | Status |
|---|---|---|
| `trip.*`, `education.subject/theme/places/activities` | sncf_chatbot `GET /conversations/{id}/journey/travel-file` (`TravelFile`) | available; `src/sncf_rapport/assemble.py::from_travel_file` does the mapping |
| `trip.*.train_number` | — | the planner's simulation has only a `line` label |
| `education.places[i].latitude/longitude/official_url/license/attribution` | sncf_events `/api/detail?id=` (`latitude`, `longitude`, `canonical_url`, `license`, `attribution`) | available there, but the chatbot's places carry no id that links to it — you must map them |
| `education.objectives` | — | not stored anywhere; teacher step |
| `school.*`, `teacher_feedback.*` | — | **new data**: the teacher's post-trip form (not part of this module) |
| `media.photos` | — | uploaded by the teacher; you pass them as base64 or a readable path, with `consent` |
| `sources` | sncf_resultat `StoredFact` (`url`, `retrieved_at`) or your own list | optional |

The three upstream modules use three unrelated id schemes (chatbot slugs,
sncf_events uuid5, sncf_resultat config ids). This module does not resolve
them; it only prints what you put in the request.

## Minimal call

```bash
uv sync
uv run python scripts/assemble.py \
  contracts/examples/inputs/travel_file.carcassonne.json \
  contracts/examples/inputs/teacher.carcassonne.json > /tmp/request.json
uv run python scripts/preview.py /tmp/request.json      # PDF + list of gaps

RAPPORT_API_KEY=change-me uv run uvicorn sncf_rapport.api:app --factory --port 8771
curl -sS -D - -o rapport.pdf -H 'X-Rapport-Key: change-me' \
  -H 'Content-Type: application/json' \
  --data @contracts/examples/01-carcassonne-complet.json \
  http://127.0.0.1:8771/api/v1/render
```

As a library:

```python
from sncf_rapport.assemble import assemble
from sncf_rapport.pdf import render_pdf
from sncf_rapport.view import build_report_view

request = assemble(travel_file_dict, teacher_dict)  # or TripReportRequest.model_validate(...)
for gap in build_report_view(request).gaps:
    if gap.severity == "major":
        logger.warning("rapport: %s missing — %s", gap.field, gap.effect)
pdf_bytes = render_pdf(request)
```

## Generated texts on the educational value (optional, needs a model key)

`education.insights` holds three short texts: « Pourquoi ce voyage », one
sentence per competency on what the trip let the class work on, and three
questions for parents to ask at home. They are written by a language model in
`src/sncf_rapport/enrich.py`.

**It connects by itself:** if the process has `OPENAI_API_KEY` (or
`OPENAI_API_KEY_FILE`), `POST /api/v1/render` adds the texts when the request
has none. With no key, nothing happens and the report simply has no such
blocks. Nothing to configure beyond the key the chatbot already uses.

| Control | Effect |
|---|---|
| `OPENAI_API_KEY` present | enrichment on (`RAPPORT_ENRICH=auto`, the default) |
| `RAPPORT_ENRICH=off`, or `?enrich=off` on `/render` | never call the model |
| `RAPPORT_OPENAI_MODEL` | default `gpt-5.4-mini` |
| `POST /api/v1/enrich` | returns the request with the texts added, without rendering: show them to the teacher, let them edit, set `insights.reviewed_by_teacher: true`, then call `/render` |
| `X-Rapport-Enrich` response header | `generated`, `cached`, `existing`, `no_key`, `off`, `no_material` or `failed` |
| Library | `enrich_request(request, config)` → `(request, outcome)`; `render_pdf` itself never calls the network |

What you should know:

- **Recommended flow:** call `/enrich` when the teacher opens the confirmation
  step, let them read and correct the texts, then render. The automatic path in
  `/render` exists so the block is never silently missing, but its texts are
  printed as "not yet reviewed by the teacher".
- **Privacy:** only subject, theme, class level, destination, place names,
  activity titles and objectives are sent. No school name, teacher name,
  teacher comment, head count or photo. `store: false` is set on the call.
- **Guard rails:** a generated sentence is dropped when it contains a number
  or a century that is not in the input, a link, or a claim that pupils
  "acquired" or "master" something. Statuses come from the teacher only.
- **Failure is quiet:** timeout (25 s), HTTP error, unusable answer → the
  report is rendered without the texts, `X-Rapport-Enrich: failed`, one
  WARNING log line. The trip being cancelled, or too little data, gives
  `no_material`.
- **Cost:** about 700 input and 350 output tokens per report, roughly
  USD 0.002 with `gpt-5.4-mini`. Answers are cached on disk by content
  (`var/cache/insights/`, `RAPPORT_CACHE_DIR`), so the same trip is paid once.
- **Quality check:** `OPENAI_API_KEY=… uv run python evals/evaluate.py` runs 12
  varied trips against the real model and fails when the guard rails drop more
  than 10 % of the fields. Run it after changing the prompt or the model.

## Contract details that bite

- The contract is `contracts/trip_report_request.schema.json`, generated from
  `src/sncf_rapport/models.py`. Unknown keys are ignored, not refused.
- A value that is present but invalid (unknown enum value, wrong type, negative
  count, `schema_version` other than `"1.0"`) **is** refused with HTTP 422.
  Missing is fine; wrong is not.
- Over-long text is cut with « … » at the length given in the schema, control
  characters are removed, and lists are capped (activities 30, places 20,
  objectives 12, photos 12, sources 40). This is silent: if you rely on more,
  split the report.
- `trip.return` is the JSON key (Python attribute `return_`).
- Competency `status` is one of `acquis`, `partiel`, `non_evalue`. Anything the
  teacher did not explicitly rate must be sent as `non_evalue` or left out. Do
  not default to `acquis` upstream: the report would certify something nobody
  assessed.
- `teacher_feedback.completed_activity_ids` refers to `education.activities[i].id`.
  `assemble.py` numbers the planner's activities `act-1`, `act-2`, … in order.
- Photos print only with `consent: true`. `kind: "documentary"` images go in a
  separate, labelled group so nobody takes an archive picture for a trip photo.
  Request body limit: 25 MB.
- `trip.simulated: true` puts a "SIMULATION" watermark on every page. The
  planner sets it today; keep passing it through until bookings are real.
- CO₂ figures are estimates (distance between stops × public ADEME factors).
  Keep the wording if you restyle the template: never "saved", always
  "estimation". See `docs/adr/0002-emission-factors.md`.
- Auth: header `X-Rapport-Key`, compared with `RAPPORT_API_KEY` (or the file
  named by `RAPPORT_API_KEY_FILE`). With no key configured the API is open and
  says so in the log: fine on a laptop, not on a server.
- The SNCF Voyageurs logo is a trademark; see `assets/brand/PROVENANCE.md`
  before publishing the module anywhere new.
