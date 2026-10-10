# Development guide

## Prerequisites

Node ≥ 20 and `pnpm`; Python ≥ 3.12 and `uv`; Docker optional (Postgres). On the development Mac, the OpenAI key is read from the Keychain by `./tools/with-api-env` (see `TOOLS.md`); never put it in `.env` here.

## Commands

| Command | Effect |
|---|---|
| `./scripts/bootstrap.sh` | Checks the tooling, `uv sync` in `services/api`, `pnpm install` in `apps/web`, creates `.env` from `.env.example`, checks the Keychain (non-blocking) |
| `./scripts/dev.sh` | API through `with-api-env gpt -- uv run uvicorn …` on :8000 and web `pnpm dev` on :3000; Ctrl‑C stops both |
| `./scripts/demo.sh` | Web only with `NEXT_PUBLIC_DEMO_MODE=true` (no key, no backend) |
| `./scripts/test.sh` | Contract validation, `pytest`, `vitest` |
| `./scripts/check.sh` | `test.sh` + `ruff`, `mypy`, schema drift, `tsc`, `eslint`, `next build` — identical to CI |
| `cd services/api && ../../tools/with-api-env gpt -- uv run python ../../evals/evaluate.py` | Extraction evals against the real model |
| `cd services/api && uv run python ../../scripts/export_schemas.py` | Regenerates the JSON Schemas after a Pydantic model change |

The scripts skip absent components and say so; they never fail because a phase has not started.

## Environments

- `DATABASE_URL`: SQLite in `.local/` by default (ignored by Git). `docker compose up -d db` provides Postgres on `localhost:5433` (`sncf`/`sncf`, database `sncf_chatbot`): `DATABASE_URL=postgresql+psycopg://sncf:sncf@localhost:5433/sncf_chatbot`.
- `NEXT_PUBLIC_DEMO_MODE=true` switches the web app to the simulated conversation service with a visible « Mode démo » badge.

## Adding a feature

1. Branch `feature/<topic>`.
2. If the contract changes: modify the Pydantic models, regenerate `packages/contracts`, bump the version, update examples, `docs/API.md`, `DECISIONS.md` — first.
3. Backend: schema → domain (pure + tests) → service → route → API test.
4. Frontend: component in `src/components/chatbot/`, typed against `src/types/contracts.ts`, Vitest/Testing Library tests; Playwright for the full journey in demo mode.
5. Prompt change: edit `services/api/app/prompts/*.md` (bump the version), add eval cases, run the evals, record the results in `HANDOFF.md`.
6. `./scripts/check.sh` green → Conventional commit → PR → CI → merge.

## Test strategy

- `domain/`: unit tests driven by French phrasings (merge, validation, transitions, date formatting with a frozen clock).
- API: `TestClient` + `FakeProvider`; idempotency, 409 on stale version, provider failure without state modification, conformance of responses to the published contract.
- Evals (`evals/`): real model, metrics in `evals/README.md`; blockers = unsupported fills, false confirmations, lost fields.
- Web: component tests; Playwright journey in demo mode (text → question → edit → confirmation → JSON displayed).

## AI tools for development

- **Role agents** (`.claude/agents/`): `frontend`, `backend`, `ai`, `qa`; **skills** (`.agents/skills/`) shared by Codex/Claude.
- **Hooks** (`.claude/settings.json`): automatic `ruff` formatting and fixing on every edit of a backend `.py` file.
- **Evals** as the prompt regression test: any prompt modification = a new run and recorded results.
- **Stitch**: `./tools/stitch tools` lists the tools; `./tools/stitch call <tool> @args.json` generates/edits screens with the prompt from `docs/DEMO.md`. References under `artifacts/` (ignored by Git). Re-implement as React components — never paste the generated HTML.
