# SNCF liO Teacher Chatbot — Agent Instructions

This file is the single source of project rules for every coding agent (OpenAI Codex, Claude Code) and for humans. `CLAUDE.md` imports it; do not duplicate rules elsewhere. When a rule here and a rule in another file conflict, this file wins — fix the other file.

## 1. What we are building

A professional French-language AI chatbot that lets teachers describe an educational trip (Occitanie, liO regional trains) by **voice or text**, and that extracts, clarifies and confirms **exactly four requirements**:

| Field | French | Meaning |
|---|---|---|
| `participants_count` | Nombre de participants | Students + accompanying adults, total |
| `departure` | Date et heure de départ | Date, time, and the kind of time constraint |
| `return` | Date et heure de retour | Date, time, and the kind of time constraint |
| `teaching_type` | Type / thème pédagogique | Subject **or** theme — either alone is sufficient |

Once the teacher explicitly confirms, the backend emits a versioned JSON payload (`packages/contracts/requirements.schema.json`) for another team's travel-planning module.

**Out of scope (do not implement):** destination/activity search, liO train lookup, itinerary planning, budgets, booking, collecting age/school/station/budget or any other personal data.

Read `docs/PRODUCT.md` for the product definition and `docs/ARCHITECTURE.md` for the system design before touching code.

## 2. Architecture in one paragraph

`apps/web` (Next.js + TypeScript + Tailwind + shadcn/ui) is a thin client that renders whatever state the server returns. `services/api` (FastAPI + Pydantic v2) owns all business logic: transcription (OpenAI `gpt-transcribe`), LLM structured extraction producing a **RequirementPatch**, deterministic patch merging, validation, a **state machine** and a dialogue manager that picks the next question. PostgreSQL stores conversations, messages and requirement snapshots (SQLite is allowed for local dev/tests). The LLM never decides control flow; code does.

## 3. Non‑negotiable invariants

1. **The LLM understands language; code manages state.** State transitions, field validation, totals and "what to ask next" live in `services/api/app/domain/`, never in prompts or in the frontend.
2. **Patch, don't overwrite.** The extraction model returns a `RequirementPatch`; `patch_merger.py` applies it. Existing valid fields are never dropped unless the teacher explicitly corrects them.
3. **Never invent data.** Unknown stays `null`. Ambiguity (e.g. "25 élèves" without accompanying adults, "le mois prochain") produces a clarification question, not a guess.
4. **Preserve time constraints:** `exact | approximate | earliest | latest` (à 8 h / vers 8 h / après 8 h / avant 17 h).
5. **Only an explicit user confirmation** moves a conversation to `CONFIRMED`. The model may never set it.
6. **Never ask again** for a field that is already known and valid.
7. **The data contract is versioned.** Any change to `packages/contracts/*.schema.json` requires: bump `schema_version`, update `docs/API.md`, update examples, add a `docs/DECISIONS.md` entry, and keep backward compatibility within a major version.
8. **Secrets never leave the backend.** No `NEXT_PUBLIC_*` secret, no key in Git, no key in logs. Locally, credentials come from macOS Keychain via `./tools/with-api-env` (see §9). In CI/other hosts, from environment variables.
9. **All user-facing text is French.** Code, comments, commits and docs are English.
10. **Timezone is `Europe/Paris`** for every date/time computation and relative-date resolution.
11. **Idempotent message submission**: the same `client_message_id` must not apply a patch twice.
12. **Mock demo mode (`NEXT_PUBLIC_DEMO_MODE=true`) is clearly labelled as a demo** and never presented as real model capability.

## 4. Repository layout

```
AGENTS.md / CLAUDE.md / README.md      project rules, Claude import, quick start
apps/web/                              Next.js chatbot (P3+)
services/api/                          FastAPI service (P1+)
  app/api/      routes            app/schemas/   Pydantic I/O models
  app/domain/   state_machine, validators, patch_merger, date_resolver
  app/services/ transcription, extraction, conversation (provider adapters)
  app/prompts/  extract_requirements.md, dialogue_policy.md (versioned)
  tests/
packages/contracts/                    JSON Schemas + examples (the shared contract)
docs/                                  PRODUCT, ARCHITECTURE, API, DECISIONS, HANDOFF, DEVELOPMENT, DEMO
evals/                                 French test cases + evaluate.py
scripts/                               bootstrap, dev, test, check, demo
.agents/skills/                        shared Agent Skills (canonical copy)
.claude/skills/ -> ../../.agents/skills/*   symlinks so Claude Code finds the same skills
.claude/agents/                        role definitions (frontend, backend, ai, qa)
tools/                                 local credential launchers (gpt, stitch, with-api-env)
.github/workflows/ci.yml               CI
```

## 5. Tech stack (fixed)

Frontend: Next.js (App Router), React, TypeScript strict, Tailwind CSS, shadcn/ui, Motion, custom React hook + JSON API (no AI SDK transport in v1). Backend: Python ≥3.12, FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic, `uv` for env/deps, pytest. AI: OpenAI Responses API with Structured Outputs (`EXTRACTION_MODEL`, default `gpt-5.4-mini`), OpenAI transcription (`TRANSCRIPTION_MODEL`, default `gpt-transcribe`). All model calls go through a provider adapter; business code never imports the OpenAI SDK directly. Tests: pytest, Vitest, Playwright. Design assistance: Google Stitch via `./tools/stitch` — its output is a reference, never shipped HTML.

## 6. How to run

```sh
./scripts/bootstrap.sh    # check toolchain, install deps, create .env from .env.example
./scripts/dev.sh          # API on :8000 (credentials injected from Keychain) + web on :3000
./scripts/demo.sh         # web only, mock demo mode, no API key needed
./scripts/test.sh         # contract validation + pytest + vitest
./scripts/check.sh        # everything CI runs: lint, types, tests, build, contracts
python evals/evaluate.py  # French extraction evals (needs API; run after every prompt change)
```

See `docs/DEVELOPMENT.md` for details and `docs/DEMO.md` for the demo script.

## 7. Working procedure for every task

1. Read `docs/HANDOFF.md` (current status, next steps), then the docs relevant to the task.
2. Inspect existing code before adding anything; reuse adapters, schemas and helpers.
3. Identify affected modules and the contract impact. If the contract changes, follow invariant 7 first.
4. Write or update tests **with** the change (unit for `domain/`, API tests for routes, component tests for UI, eval cases for prompt changes).
5. Run `./scripts/check.sh` (or the relevant subset) and make it pass.
6. Update docs: `docs/HANDOFF.md` always; `docs/DECISIONS.md` for any architectural choice; `docs/API.md` for any API change.
7. Commit with Conventional Commits; summarise changed files in the final message.

Use the project skills in `.agents/skills/` (`frontend-implementation`, `api-development`, `prompt-engineering`, `conversation-testing`, `integration-check`, `git-workflow`) — they encode the detailed procedures.

## 8. Code style

- Python: `ruff` (format + lint), type hints everywhere, `mypy --strict` on `app/domain` and `app/schemas`. Pydantic models for every I/O boundary. No business logic in route handlers.
- TypeScript: `strict`, ESLint (next/core-web-vitals), Prettier defaults. Components in `src/components/chatbot/`, one component per file, props typed, no AI/field logic duplicated in the client — render server state.
- Keep functions small and deterministic; prefer pure functions in `domain/` so they are trivially testable.
- Match the surrounding code's naming and comment density. Comments explain *why*, not *what*.

## 9. Git & collaboration

- Branches: `main` (protected, always demoable) + `feature/<topic>` (e.g. `feature/chat-ui`, `feature/speech-to-text`, `feature/requirements-extraction`, `feature/conversation-manager`).
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:`.
- Never commit `.env`, audio files, database files, or anything under `artifacts/` or `.local/`.
- CI (`.github/workflows/ci.yml`) must be green before merging: contracts, pytest, tsc, eslint, build.
- Do not restart host services (an unrelated PostgreSQL already listens on 5432; Docker Postgres for this project uses 5433) or launch heavy workloads just to validate credentials.

## 10. Definition of done

A task is done when: tests exist and pass; `./scripts/check.sh` passes; user-facing strings are French; no secret or personal data is logged; `docs/HANDOFF.md` describes the new state; the contract is unchanged or properly versioned; and the change can be previewed with `./scripts/dev.sh` or `./scripts/demo.sh`.

## 11. Persistent API access (local machine)

- Read `TOOLS.md` for invocation examples and the last verification result.
- GPT API credential (label `sncf` in the user's original note) is stored in macOS Keychain service `sncf-openai-api-key`, account equal to the current macOS username.
- Stitch reuses the existing Keychain service `medici-stitch-api-key`, same account. The original integration was found in `/Users/zephyrsui/Developer/meidiqi/medici-ui-prototype`.
- Use `./tools/gpt`, `./tools/stitch`, or `./tools/with-api-env gpt|stitch|all -- COMMAND ...`. They retrieve credentials at runtime; the original note is no longer a runtime dependency.
- Never print credentials, pass them as command arguments, commit them, put them in frontend code, or expose them through shell tracing / environment dumps.
- `gpt request` invokes the Responses API and requires an explicit model. `stitch call` can modify remote resources: only use writes needed by the user's current task. This setup does not authorize changing existing Medici projects.
- These commands load credentials; they are not resource isolation or production task admission tools. Existing host safety rules still apply before development, builds, tests or deployments.
