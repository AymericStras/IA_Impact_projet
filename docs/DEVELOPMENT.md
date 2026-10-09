# Development guide

## Prerequisites

Node ≥ 20 and `pnpm`; Python ≥ 3.12 and `uv`; Docker optional (Postgres). On the dev Mac the OpenAI key is read from the Keychain by `./tools/with-api-env` (see `TOOLS.md`); never put it in `.env` there.

## Commands

| Command | Does |
|---|---|
| `./scripts/bootstrap.sh` | Verifies toolchain, `uv sync` in `services/api`, `pnpm install` in `apps/web`, creates `.env` from `.env.example`, checks Keychain credential (non-fatal) |
| `./scripts/dev.sh` | API via `with-api-env gpt -- uv run uvicorn …` on :8000 and web `pnpm dev` on :3000; Ctrl‑C stops both |
| `./scripts/demo.sh` | Web only with `NEXT_PUBLIC_DEMO_MODE=true` (no key, no backend) |
| `./scripts/test.sh` | Contract validation, `pytest`, `vitest` |
| `./scripts/check.sh` | `test.sh` + `ruff`, `mypy`, `tsc`, `eslint`, `next build` — identical to CI |
| `./tools/with-api-env gpt -- python evals/evaluate.py` | Extraction evals against the real model |

Scripts skip components that do not exist yet and say so; they never fail because a phase is not started.

## Environments

- `DATABASE_URL` defaults to SQLite in `.local/` (git-ignored). `docker compose up -d db` gives Postgres on `localhost:5433` (`sncf`/`sncf`, db `sncf_chatbot`); set `DATABASE_URL` accordingly. Alembic migrations run on API start in dev.
- `NEXT_PUBLIC_DEMO_MODE=true` switches the web app to the mock conversation service with a visible « Mode démo » badge.

## Adding a feature

1. Branch `feature/<topic>`.
2. If it touches the contract: update `packages/contracts`, bump version, update examples, `docs/API.md`, `DECISIONS.md` — first.
3. Backend: schema → domain (pure + tests) → service → route → API test.
4. Frontend: component in `src/components/chatbot/`, typed against `src/types/contracts.ts` (generated from OpenAPI in P3), tests with Vitest/Testing Library; Playwright for the full flow in demo mode.
5. Prompt change: edit `services/api/app/prompts/*.md`, add eval cases, run evals, record results in `HANDOFF.md`.
6. `./scripts/check.sh` green → Conventional Commit → PR → CI → merge.

## Testing strategy

- `domain/`: unit tests, table-driven from French phrasings (merge, validation, state transitions, date resolution with a frozen Paris clock).
- API: `httpx.AsyncClient` tests with `FakeProvider`; idempotency, 409 on stale version, provider failure keeps state.
- Evals (`evals/`): real model, metrics in `evals/README.md`; blocking issues = unsupported fills, false confirmations.
- Web: component tests; Playwright flow in demo mode (text → question → edit → confirm → JSON shown).

## Design workflow (Stitch)

`./tools/stitch tools` lists tools; `./tools/stitch call <tool> @args.json` generates/edits screens with the design prompt in `docs/DEMO.md`. Save references under `artifacts/` (git-ignored). Re-implement as React components — never paste generated HTML into the app.
