# Handoff

State on 2026-10-10: version 0.1.0, feature-complete for "JSON in, PDF out".

## What exists

- Contract `TripReportRequest` (all fields optional, text cleaned and cut, lists capped).
- `gaps.py`: list of missing fields with their effect; exposed by `/api/v1/check`,
  `X-Rapport-Missing-*` headers, a WARNING log line, `scripts/preview.py`.
- `assemble.py`: chatbot `TravelFile` + teacher JSON → request.
- `geo/`: station matching, rail path, estimated distance, inline SVG map (Occitanie).
- `carbon/`: ADEME Impact CO2 factors in `data/emission_factors.json`, estimate vs coach and car.
- `view.py` + `pdf/`: the French A4 report (WeasyPrint), SIMULATION watermark.
- `enrich.py`: optional model-written texts (`education.insights`), on when `OPENAI_API_KEY` is set.
- `api.py`: `/api/v1/render`, `/api/v1/check`, `/api/v1/enrich`, `/healthz`.
- Examples in `contracts/examples/`, rendered samples in `docs/example/`.

## Verified on 2026-10-10

- `uv run ruff check . && uv run ruff format --check . && uv run pytest && uv run python scripts/export_schema.py --check`: 478 tests pass.
- `uv run python scripts/stress.py 300`: 0 failure, mean 0.9 s per report, longest 11 pages.
- `evals/evaluate.py` with `gpt-5.4-mini`: 12 trips, 89 texts kept, 0 dropped by the guard rails,
  the two cases that must stay empty are empty. Cost of the run: about USD 0.02.
- Pages of the four examples checked by eye.

## Not done

- No teacher form: `school.*` and `teacher_feedback.*` must be produced by the merged product.
- Not deployed. No email (hand the PDF to `sncf_bilan` if needed).
- Stations outside Occitanie: no map; CO2 only with `environment.distance_km_override`.
- Places are not linked to `sncf_events` ids, so coordinates and official links arrive only if
  the caller fills them.
- The full example runs to 4 pages; the last one holds only "Sources et validation".
- The estimated distance is 3–6 % under real rail distance (straight segments between stops).
- A coach ("Car TER") link of the data set can be part of a route.

## Decisions taken with the owner

All fields optional, with a loud report of what is missing; CO2 against coach and car; SNCF
Voyageurs logo (owner reports SNCF's permission); SIMULATION watermark on simulated trips;
model-written texts allowed with the chatbot's OpenAI key; car baseline at four people per car.

## Where to continue

1. Wire the real teacher step and call `/api/v1/enrich` there so the teacher reviews the texts.
2. Map chatbot places to `sncf_events` entities to get coordinates and official links.
3. Add a national station list if trips leave Occitanie.
