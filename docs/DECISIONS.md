# Architecture decisions

Append-only log. Format: date, decision, why, consequences. Newest last.

## ADR-001 — 2026-10-10 — Patch-based extraction, code-owned state
Model returns a `RequirementPatch` per message; `patch_merger` applies it. Full re-extraction was rejected because it loses confirmed data, mis-sums corrections, and makes every turn depend on the whole transcript. Consequence: strict Pydantic patch schema, pure merge function, exhaustive merge tests.

## ADR-002 — 2026-10-10 — Four-value time constraint
`exact | approximate | earliest | latest` kept on departure/return so the planner distinguishes "retour à 17 h" from "retour avant 17 h". Consequence: part of the external contract from 1.0.

## ADR-003 — 2026-10-10 — Totals computed by code
Model reports `participants_mentioned {students, accompanying, total_stated}`; code computes `participants_count`. "25 élèves" alone is an ambiguity, not a total.

## ADR-004 — 2026-10-10 — Template-first dialogue
Assistant questions come from French templates keyed by `DialogueAction`; LLM rephrasing (`dialogue_policy.md`) is optional and read-only. Cheaper, deterministic, testable.

## ADR-005 — 2026-10-10 — Audio endpoint returns transcript only
Voice is transcribed, shown for correction, then submitted as text. One dialogue pipeline; recognition errors are caught by the teacher before extraction.

## ADR-006 — 2026-10-10 — Models and credentials
Defaults: `TRANSCRIPTION_MODEL=gpt-transcribe`, `EXTRACTION_MODEL=gpt-5.4-mini` (both confirmed available on the project key on 2026-10-10; candidates to compare in evals: `gpt-5.4`, `gpt-4.1-mini` for latency). Locally the key is injected from macOS Keychain by `tools/with-api-env`; never in `.env` on this machine. Consequence: `scripts/dev.sh` wraps the API process with `with-api-env gpt`.

## ADR-007 — 2026-10-10 — Custom React hook over Vercel AI SDK transport
`useConversation()` + JSON API. AI SDK's `useChat` expects its own stream protocol; adapting FastAPI to it adds work without value for a 4-field form-filling dialogue. Revisit if token streaming becomes a demo requirement.

## ADR-008 — 2026-10-10 — SQLite for dev/tests, Postgres (port 5433) for deployment
Host already runs an unrelated Postgres on 5432. SQLAlchemy 2 + Alembic keep both paths identical.

## ADR-009 — 2026-10-10 — Shared skills in `.agents/skills`, symlinked into `.claude/skills`
One canonical copy of each skill (Agent Skills format) so Codex and Claude Code follow identical procedures. `AGENTS.md` is the single rules file; `CLAUDE.md` imports it.

## ADR-010 — 2026-10-10 — Repo language
Code, docs, commits in English (shared with teammates and both agents); all user-facing strings in French.
