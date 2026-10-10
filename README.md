# SNCF liO — Teacher trip assistant

French-language AI chatbot (voice + text) that helps teachers describe a school trip and extracts four confirmed pieces of information from it — participants, departure, return, subject/theme — as a versioned JSON contract intended for the route-planning module developed by other members of the team.

Hackathon project, designed as an **"AI-native" repository**: OpenAI Codex and Claude Code can pick up development at any time from `AGENTS.md` / `CLAUDE.md` and `docs/HANDOFF.md`.

## Quick start

```sh
./scripts/bootstrap.sh   # tooling + dependencies + .env
./scripts/demo.sh        # simulated demo, no key → http://localhost:3000
./scripts/dev.sh         # real AI mode: FastAPI :8000 + Next.js :3000
./scripts/test.sh
./scripts/check.sh
```

Prerequisites: Node ≥ 20 + pnpm, Python ≥ 3.12 + [uv](https://docs.astral.sh/uv/), Docker optional (Postgres on 5433). On the development Mac, the OpenAI key is read from the macOS Keychain by `./tools/with-api-env`; elsewhere, set `OPENAI_API_KEY` in the environment (see `.env.example`).

## Layout

| Path | Contents |
|---|---|
| `apps/web` | Next.js chatbot interface (French) |
| `services/api` | FastAPI: transcription, structured extraction, state machine, validation |
| `packages/contracts` | JSON Schemas (generated from Pydantic) + examples shared with the other modules |
| `docs/` | PRODUCT, ARCHITECTURE, API, DECISIONS, HANDOFF, DEVELOPMENT, DEMO |
| `evals/` | French case set and evaluation script |
| `scripts/` | bootstrap / dev / test / check / demo / validate_contracts / export_schemas |
| `.agents/skills`, `.claude/` | shared skills, role agents, hooks |

## Status

See `docs/HANDOFF.md`.

## For the team integrating the planner

Consume only the output of `GET /api/v1/conversations/{id}/export` (or the `confirmed_requirements` field of the `POST …/confirm` response), which conforms to `packages/contracts/requirements.schema.json` (`schema_version` `1.0`). Example: `packages/contracts/examples/confirmed_requirements.json`. OpenAPI served at `http://localhost:8000/docs` when the API is running.
