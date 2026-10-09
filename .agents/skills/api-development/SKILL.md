---
name: api-development
description: Build or change FastAPI endpoints, Pydantic schemas, domain logic (patch merge, validation, state machine, date resolution) and persistence in services/api, in accordance with the versioned contract in packages/contracts and docs/API.md.
---

# API development

## Read first
`AGENTS.md` §3, `docs/ARCHITECTURE.md`, `docs/API.md`, `packages/contracts/*.schema.json`, existing `services/api/app/`.

## Rules
- Contract first: if the change alters a request/response shape, update `packages/contracts` + examples + `docs/API.md` + `docs/DECISIONS.md` and bump `schema_version` before coding.
- Layering: `api/` (routes, thin) → `services/` (orchestration, provider adapters) → `domain/` (pure functions, no I/O, no framework imports). Business rules live in `domain/` only.
- Every I/O boundary is a Pydantic v2 model in `schemas/`. Structured Outputs use `RequirementPatch.model_json_schema()` with `strict: true`; keep `packages/contracts/requirement_patch.schema.json` in sync (`scripts/export_schemas.py`).
- State changes happen in one DB transaction; idempotency on `client_message_id`; `expected_version` → 409 on mismatch; provider errors → 502/504 with state untouched.
- Dates: `zoneinfo.ZoneInfo("Europe/Paris")`; the clock is injected (`Clock` protocol) so tests can freeze it.
- No OpenAI SDK import outside `services/providers/openai_provider.py`. Tests use `FakeProvider`.
- Logging: no transcripts, no message content, no personal data at INFO. Never log env.
- French error `detail`s; see template catalogue in `app/prompts/dialogue_policy.md`.

## Procedure
1. Write/adjust the Pydantic schema; export and diff against the JSON Schema.
2. Implement the pure domain function with table-driven tests (French phrasings from `evals/french_cases.jsonl`).
3. Implement the service/route; add `httpx` API tests (happy path, idempotency, 409, provider failure).
4. `cd services/api && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest`.
5. Start with `./scripts/dev.sh`; check `/docs` renders and matches `docs/API.md`.
6. Update `docs/HANDOFF.md`.
