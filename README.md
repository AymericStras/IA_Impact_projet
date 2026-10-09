# SNCF liO — Assistant de voyage pédagogique

A French-language AI chatbot (voice + text) that helps teachers describe an educational trip and extracts four confirmed requirements — participants, departure, return, teaching subject/theme — as a versioned JSON contract for the travel-planning module built by other teammates.

Hackathon project. Designed as an **AI-native repository**: OpenAI Codex and Claude Code can take over development at any point by reading `AGENTS.md` / `CLAUDE.md` and `docs/HANDOFF.md`.

## Quick start

```sh
./scripts/bootstrap.sh   # toolchain check + dependency install + .env
./scripts/demo.sh        # mock demo, no API key → http://localhost:3000
./scripts/dev.sh         # real AI mode: FastAPI :8000 + Next.js :3000
./scripts/test.sh
./scripts/check.sh
```

Requirements: Node ≥ 20 + pnpm, Python ≥ 3.12 + [uv](https://docs.astral.sh/uv/), optionally Docker (Postgres on port 5433). On this development Mac, API keys are read from the macOS Keychain by `./tools/with-api-env`; elsewhere set `OPENAI_API_KEY` in `.env` (see `.env.example`).

## Layout

| Path | Content |
|---|---|
| `apps/web` | Next.js chatbot UI (French) |
| `services/api` | FastAPI: transcription, structured extraction, state machine, validation |
| `packages/contracts` | JSON Schemas + examples shared with other modules |
| `docs/` | PRODUCT, ARCHITECTURE, API, DECISIONS, HANDOFF, DEVELOPMENT, DEMO |
| `evals/` | French extraction test set and evaluation script |
| `scripts/` | bootstrap / dev / test / check / demo |
| `.agents/skills`, `.claude/` | shared agent skills and role agents |

## Status

See `docs/HANDOFF.md`. Current phase: **P0 — framework package** complete; next is **P1 — FastAPI + text extraction**.

## For teammates integrating with the planner

Consume only `POST /api/v1/conversations/{id}/confirm` output, which conforms to `packages/contracts/requirements.schema.json` (`schema_version` `1.0`). Example: `packages/contracts/examples/confirmed_requirements.json`. OpenAPI is served at `http://localhost:8000/docs` when the API runs.
