# Architecture decisions

Append-only log. Format: date, decision, why, consequences. Most recent at the bottom.

## ADR-001 — 2026-10-10 — Patch-based extraction, state owned by the code
The model returns one `RequirementPatch` per message; `patch_merger` applies it. Full re-extraction was rejected: it loses confirmed data, adds corrections up wrongly and makes every turn depend on the whole transcript. Consequence: strict patch schema, pure merge function, exhaustive tests.

## ADR-002 — 2026-10-10 — Four-valued time constraint
`exact | approximate | earliest | latest` preserved on departure/return so that the planner can tell « retour à 17 h » from « retour avant 17 h ». Part of the external contract from 1.0.

## ADR-003 — 2026-10-10 — Totals computed by the code
The model reports `participants_mentioned {students, accompanying, total_stated}`; the code computes `participants_count`. « 25 élèves » alone is an ambiguity, not a total.

## ADR-004 — 2026-10-10 — Template-first dialogue
Questions come from French templates keyed by `ActionKind`; LLM rephrasing (`dialogue_policy.md`) is optional and read-only. Cheaper, deterministic, testable.

## ADR-005 — 2026-10-10 — The audio endpoint only returns the transcript
Voice is transcribed, displayed for correction, then sent as text. A single dialogue pipeline; recognition errors are corrected by the teacher before extraction.

## ADR-006 — 2026-10-10 — Models and credentials
Defaults: `TRANSCRIPTION_MODEL=gpt-transcribe`, `EXTRACTION_MODEL=gpt-5.4-mini` (reasoning effort `low`), confirmed available on the project key on 2026-10-10. Locally the key is injected from the macOS Keychain by `tools/with-api-env`, never in `.env`. Consequence: `scripts/dev.sh` wraps the API process with `with-api-env gpt`.

## ADR-007 — 2026-10-10 — Custom React hook rather than the Vercel AI SDK transport
`useConversation()` + JSON API. `useChat` expects its own stream protocol; adapting it to FastAPI adds work with no value for a 4-field slot-filling dialogue. The AI Elements **components** (shadcn) remain usable without that transport (ADR-012). To be revisited if token streaming becomes a demo need.

## ADR-008 — 2026-10-10 — SQLite in dev/tests, Postgres (port 5433) in deployment
The host already runs a foreign Postgres on 5432. SQLAlchemy 2 keeps both paths identical.

## ADR-009 — 2026-10-10 — Shared skills in `.agents/skills`, linked in `.claude/skills`
One canonical copy of each skill (Agent Skills format) so that Codex and Claude Code follow the same procedures. `AGENTS.md` is the only rules file; `CLAUDE.md` imports it.

## ADR-010 — 2026-10-10 — Repo language: English
Code, documentation, comments and commit messages are in English (shared with teammates and both coding agents); user-facing strings are in French. A switch to French was tried on 2026-10-10 and reverted the same day, which is why a few commit messages from that day are in French.

## ADR-011 — 2026-10-10 — Return date inherited from the departure
A return time without a date (« Avant 18 h. ») takes the known departure date, and vice versa: school trips are one-day trips. The teacher can correct it; a return earlier than the departure is rejected and asked again. Rejected alternative: always asking for the return date (one more turn for everyone).

## ADR-012 — 2026-10-10 — Borrowed open-source references
Structure and patterns only, not their runtimes: `fastapi/full-stack-fastapi-template` (`app/api`, `app/core/config.py`, `deps.py` split), Rasa Forms ("requested slot" filling + validation actions → our `state_machine` + `validators`), `vercel/ai-chatbot` and AI Elements (chat interface primitives on shadcn). Nothing that conflicts with the invariants (e.g. an LLM driving the flow) was taken.

## ADR-013 — 2026-10-10 — Alembic deferred
Hackathon: `Base.metadata.create_all` at startup. Alembic will be introduced with the first PostgreSQL deployment (`DATABASE_URL=postgresql+psycopg://…`). As long as the SQL schema is not frozen, migrations bring nothing.

## ADR-014 — 2026-10-10 — Pydantic as source of truth; JSON Schemas generated
The files in `packages/contracts/*.schema.json` are produced by `scripts/export_schemas.py` and checked in CI (`--check`). The models have `extra="forbid"`. Constraints that cannot be expressed in JSON Schema (e.g. "subject or theme") are documented Pydantic validators.

## ADR-015 — 2026-10-10 — Recent history provided to the extraction model
The last 8 messages (including the assistant's last question) accompany every extraction; rule 20 of prompt v1.1: a short reply answers the pending question. Without this, « Avant 18 h. » cannot be attached to the return (observed in evaluation: 84 % → 96 %).

## ADR-016 — 2026-10-10 — Chat confirmation strictly bounded
The model's `confirm` intent only leads to `CONFIRMED` if the previous state is `AWAITING_CONFIRMATION`, everything is complete and the message modifies nothing. The « Confirmer et continuer » button (`POST /confirm`, with `expected_version`) remains the main path. Protects against a false confirmation by the model.
