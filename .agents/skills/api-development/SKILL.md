---
name: api-development
description: Build or change the FastAPI endpoints, Pydantic schemas, domain logic (patch merge, validation, state machine, dates) and persistence in services/api, in accordance with the versioned contract in packages/contracts and docs/API.md.
---

# API development

## Read first
`AGENTS.md` §3, `docs/ARCHITECTURE.md`, `docs/API.md`, `services/api/app/schemas/`, the existing code in `app/domain` and `app/services`.

## Rules
- Contract first: if the change modifies a request/response shape, modify the Pydantic models, regenerate `packages/contracts` (`uv run python ../../scripts/export_schemas.py`), update examples, `docs/API.md`, `docs/DECISIONS.md` and bump `schema_version` before coding the rest.
- Layers: `api/` (thin routes) → `services/` (orchestration, adapters) → `domain/` (pure functions, no I/O or framework). Business rules live in `domain/` only; `domain/pipeline.py` chains merge → validation → decision → message.
- Every I/O boundary is a Pydantic v2 model (`extra="forbid"`). Structured Outputs use `RequirementPatch` through `responses.parse`; all its fields are required (strict mode).
- State changes in one transaction; idempotency on `client_message_id`; `expected_version` → 409; provider errors → 502/504 without touching the state (the model call precedes any write).
- Dates: `zoneinfo.ZoneInfo("Europe/Paris")`; injected clock (`Clock`, `FixedClock` in tests). SQLite does not keep the timezone: normalise on read (`_iso_paris`).
- No import of the OpenAI SDK outside `services/providers/openai_provider.py`. Tests use `FakeProvider` and override `get_extraction_provider` / `get_transcription_provider` / `get_clock`.
- Logs: no transcripts, no message content, no personal data at INFO level. Never the environment.
- Error `detail` in French; templates in `app/domain/dialogue.py` (reference catalogue in `app/prompts/dialogue_policy.md`).

## Procedure
1. Write/adjust the Pydantic model; regenerate and check the JSON Schemas.
2. Implement the pure domain function with table-driven tests (French phrasings from `evals/french_cases.jsonl`).
3. Implement service/route; add API tests (nominal case, idempotency, 409, provider failure, contract conformance).
4. `cd services/api && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest -q`.
5. Run `./scripts/dev.sh`; check that `/docs` matches `docs/API.md`.
6. Update `docs/HANDOFF.md`.
