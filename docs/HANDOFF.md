# Handoff — current state and next steps

**Read this first.** Update it at the end of every work session (what changed, what is verified, what is next). Keep it short; history lives in Git.

## Status — 2026-10-10

Phase **P0 (framework package) — done**. No application code yet.

Exists and verified:
- `AGENTS.md` / `CLAUDE.md` rules; docs (`PRODUCT`, `ARCHITECTURE`, `API`, `DECISIONS`, `DEVELOPMENT`, `DEMO`).
- Contracts: `packages/contracts/*.schema.json` + examples; `scripts/validate_contracts.py` passes.
- Prompts: `services/api/app/prompts/extract_requirements.md`, `dialogue_policy.md`.
- Skills (`.agents/skills/*`, symlinked in `.claude/skills/`), role agents (`.claude/agents/*`).
- Scripts (`bootstrap/dev/test/check/demo`) — they detect missing `apps/web` / `services/api` and skip with a notice.
- `evals/french_cases.jsonl` (seed cases) + `evals/evaluate.py` (runs once extraction exists; `--list` works now).
- CI workflow, `docker-compose.yml` (Postgres on 5433).
- Credentials: `./tools/gpt check` OK; `gpt-transcribe` and `gpt-5.4-mini` available.

## Next — P1: FastAPI + text extraction

1. `services/api`: `uv init`, deps (fastapi, uvicorn, pydantic, sqlalchemy, aiosqlite, alembic, openai, pytest, httpx, ruff, mypy).
2. `app/schemas/`: `PartialRequirements`, `RequirementPatch`, `ConversationResponse`, `ConfirmedRequirements` — mirror `packages/contracts`; add `scripts/export_schemas.py` + diff check in `check.sh`.
3. `app/domain/`: `patch_merger`, `validators`, `date_resolver` (Europe/Paris), `state_machine`, `dialogue` — pure, with tests from `evals/french_cases.jsonl` expectations.
4. `app/services/`: provider protocol + `OpenAIProvider` (Responses API, strict structured outputs) + `FakeProvider`.
5. Routes per `docs/API.md`; SQLite persistence; idempotency.
6. Run `python evals/evaluate.py` and record results in this file.

Then P2 (multi-turn + questions), P3 (frontend; design pass with Stitch using the prompt in `docs/DEMO.md`), P4 (audio), P5 (confirm/edit), P6 (tests/integration), P7 (polish).

## Open questions for the team

- Handoff transport to the planner module: pull via `GET /export`, or push (webhook)? Default: pull.
- Return date inference when only a time is given (see PRODUCT.md) — confirm rule with teammates.
