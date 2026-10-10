# Handoff

State on 2026-10-10: version 0.1.0, feature-complete for "JSON in, PDF out"
and "JSON in, PDF emailed" (same pipeline as `sncf_bilan`).

## What exists

- Contract `TripReportRequest` (all fields optional, text cleaned and cut, lists capped).
- `gaps.py`: list of missing fields with their effect; exposed by `/api/v1/check`,
  `X-Rapport-Missing-*` headers, a WARNING log line, `scripts/preview.py`.
- `assemble.py`: chatbot `TravelFile` + teacher JSON → request.
- `geo/`: station matching, rail path, estimated distance, inline SVG map (Occitanie).
- `carbon/`: ADEME Impact CO2 factors in `data/emission_factors.json`, estimate vs coach and car.
- `view.py` + `pdf/`: the French A4 report (WeasyPrint), SIMULATION watermark.
- `enrich.py`: optional model-written texts (`education.insights`), on when `OPENAI_API_KEY` is set.
- `mail/`, `service.py`, `store.py`: the email (subject, text, HTML from `view.build_mail_view`),
  the SQLite job record, dry-run outbox or Resend through Mailato 0.4.0, retry, daily limits,
  30-day purge. `recipient.email` on the request; without it `/reports` answers 422.
- `api.py`: `/api/v1/render`, `/api/v1/reports` (+ `{id}`, `document.pdf`, `retry`),
  `/api/v1/check`, `/api/v1/enrich`, `/healthz`.
- `scripts/send_example.py`: one real email to yourself (`--yes`), `scripts/preview.py` also
  writes the `.eml`.
- Examples in `contracts/examples/`, rendered samples in `docs/example/`.

## Verified on 2026-10-10

- `uv run ruff check . && uv run ruff format --check . && uv run pytest && uv run python scripts/export_schema.py --check`: 518 tests pass.
- No real email was sent: everything ran in dry-run. A live send still needs the owner's
  `credentials.env` (Resend key for `zhaoyang.fr`) and their go-ahead.
- `uv run python scripts/stress.py 300`: 0 failure, mean 0.9 s per report, longest 11 pages.
- `evals/evaluate.py` with `gpt-5.4-mini`: 12 trips, 89 texts kept, 0 dropped by the guard rails,
  the two cases that must stay empty are empty. Cost of the run: about USD 0.02.
- Pages of the four examples checked by eye.

## Not done

- No teacher form: `school.*`, `teacher_feedback.*` **and `recipient.email`** must be produced by
  the merged product. The form must ask the teacher for the email address (owner, 2026-10-10).
- Deployment: see `docs/DEPLOYMENT.md` for the current state of the hosted instance.
- Stations outside Occitanie: no map; CO2 only with `environment.distance_km_override`.
- Places are not linked to `sncf_events` ids, so coordinates and official links arrive only if
  the caller fills them.
- The full example runs to 4 pages; the last one holds only "Sources et validation".
- The estimated distance is 3–6 % under real rail distance (straight segments between stops).
- A coach ("Car TER") link of the data set can be part of a route.

## Decisions taken with the owner

All fields optional, with a loud report of what is missing; CO2 against coach and car; SNCF
Voyageurs logo (owner reports SNCF's permission); SIMULATION watermark on simulated trips;
model-written texts allowed with the chatbot's OpenAI key; car baseline at four people per car;
the report is emailed like the recap of `sncf_bilan`, to an address the teacher gives with their
feedback (2026-10-10).

## Where to continue

1. Wire the real teacher step: collect the email address, call `/api/v1/enrich` so the teacher
   reviews the texts, then `/api/v1/reports`.
2. Map chatbot places to `sncf_events` entities to get coordinates and official links.
3. Add a national station list if trips leave Occitanie.
