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

## Frontend notes — 2026-10-10 (P3 + polish round 2, `apps/web`) — design frozen

**Read first:** `apps/web/AGENTS.md` (rules for agents) and `docs/DESIGN.md` (the frozen design system). The UI renders server state only; a visual change must go through the screenshot baselines.

**What exists.** Next.js 15 (App Router, TS strict), Tailwind v4, shadcn/ui v4 ("base-nova" on Base UI: primitives use `render={...}`, not `asChild`), Motion, Vitest + Testing Library, Playwright. pnpm, own lockfile in `apps/web`.
- Components (`src/components/chatbot/`, one per file): `ChatContainer`, `TopBar`, `HelpDialog`, `DemoBadge`, `ConversationThread`, `MessageBubble`, `TypingIndicator`, `MessageComposer`, `VoiceRecorder`, `AudioTranscriptionPreview`, `RequirementsPanel`, `RequirementField`, `ConfirmationCard`, `ConfirmedJsonBlock`, `ErrorMessage`, `LoadingState`. States and copy sources are tabulated in `docs/DESIGN.md` §7.
- Layout: fixed-height shell (`h-dvh`); only the thread scrolls and the composer is a normal flex item, so nothing can sit under it (fixes the mobile confirmation card). Thread auto-scroll follows new messages, aligns the start of a reply that is taller than the viewport, and shows « Revenir en bas » when the user scrolled up.
- `useConversation`: restore from `localStorage`, `send` (optimistic bubble), `transcribe`, `editField` / `confirm` with `expected_version`, `retry`, `restart`, and `config` from `GET /config` (fetched once; defaults 120 s / 10 485 760 bytes / 4 000 chars if it fails).
- Errors: `ApiError` carries the server `code`; the reaction is `ApiError.kind` (`src/services/types.ts`), HTTP status only as fallback. `VERSION_CONFLICT` / `CONCURRENT_UPDATE` → refetch + notice, draft/editor kept. `RATE_LIMITED` → notice, draft kept. `PROVIDER_ERROR` / `PROVIDER_TIMEOUT` / `INVALID_EVIDENCE` / `INVALID_EXTRACTION` / network / uncoded 5xx → « Réessayer » with the same `client_message_id`. `IDEMPOTENCY_CONFLICT` → « Réessayer » with a new id. `AUDIO_*` / `EMPTY_TRANSCRIPT` → recorder error with « Réenregistrer » only. `CONVERSATION_NOT_FOUND` mid-session → error offering « Nouvelle conversation ». The server's French `detail` is always what is shown.
- Limits from `/config`: recorder auto-stop, size check before upload, textarea `maxLength` with a counter from 90 %.
- Other round-2 changes: confirmation card has its own copy (no repeat of the assistant bubble; same for the confirmed card); breakdown line shown only when students + accompanying equals the total; Enter ignored during IME composition; messages are plain React text (test with an `<img onerror>` payload); 44 px touch targets below `lg`; a 2 px focus outline on every control; editable-field borders darkened to 3.6:1.
- Mock (`mockConversationApi.ts`): same error codes and `/config` shape as the API, backend-aligned templates including the « C'est noté, j'ai mis à jour … (au lieu de …). » prefix when a chat message overwrites a known value, and a one-shot failure switch (`DEMO_FAIL_NEXT_KEY`) used by the e2e tests.
- AI Elements: not used. `response` is absent from the registry and the other components pull `ai` v7 + `streamdown` as runtime dependencies; chat primitives are plain shadcn components. Stitch pass: not done.

**Deployment under a sub-path.** Build-time variables: `NEXT_PUBLIC_BASE_PATH=/sncf-chatbot` (Next `basePath` + `trailingSlash`, also namespaces `localStorage` keys), `NEXT_PUBLIC_API_BASE_URL=` **empty** (same-origin API at `/sncf-chatbot/api/v1`; unset still means `http://localhost:8000`), `NEXT_OUTPUT=standalone`, `NEXT_PUBLIC_DEMO_MODE=false`; optional `NEXT_DIST_DIR`. Start with `node <distDir>/standalone/server.js` after copying `<distDir>/static` to `<distDir>/standalone/<distDir>/static`. Verified with a demo-mode standalone build on port 3100: `/sncf-chatbot/` → 200, `/sncf-chatbot` → 308 to the slash form, `/` → 404, favicon and all 12 `_next` assets referenced by the page → 200 and under the base path. Standalone folder: 69 MB (66 MB `node_modules`). The reverse proxy must forward `/sncf-chatbot/api/v1/*` to the API; that part was not tested here.

**Guardrails.**
- `pnpm test:e2e` (Playwright, demo mode, production build in `.next-e2e`, port 3100): projects `desktop` 1440×900 and `mobile` 390×844; 20 tests (19 run + 1 mobile-only skip on desktop): full flow, scroll behaviour, error + retry, voice flow, touch targets, focus visibility, and 9 screenshot states per project.
- Baselines: `apps/web/e2e/__screenshots__/darwin/{desktop,mobile}/` — `01-welcome`, `02-partial-3-of-4`, `03-inline-edit-open`, `04-complete-confirmation-card`, `05-confirmed-json`, `06-recorder-recording`, `07-transcript-preview`, `08-error-retry`, `09-help-dialog` (18 PNGs). Platform-specific: on Linux they must be generated and reviewed once. Updating: `pnpm test:e2e --update-snapshots`, only for an intended change and after looking at the diff.
- `NEXT_DIST_DIR` keeps builds away from a running dev server's `.next`.

**How verified** (from `apps/web`, 2026-10-10): `pnpm tsc --noEmit` ✓ · `pnpm lint` ✓ · `pnpm test -- --run` ✓ 9 files / 48 tests · `NEXT_PUBLIC_DEMO_MODE=true NEXT_DIST_DIR=.next-build pnpm build` ✓ · `pnpm test:e2e` ✓ 19 passed, 1 skipped, screenshots compared against the committed baselines. Real mode: page load against the running API checked headlessly (`GET /config` 200, `POST /conversations` 201, no console error, no demo badge, `maxLength` 4000). Not verified here: a real-model message round-trip after this round, real-microphone recording on a device, Safari/Firefox, and the e2e suite on Linux/CI.

**Assumptions the backend must honour.**
- Endpoints and bodies as in `docs/API.md`; `GET /config` → `{max_audio_seconds, max_audio_bytes, max_message_chars, timezone}`; errors as problem details `{type, title, status, code, detail}` with a French `detail`.
- A field is shown as known iff it is absent from `missing_fields`; partial values are shown verbatim; `confirmed_requirements` is rendered only when `state === "CONFIRMED"`.
- CORS must allow the web origin when the API is on another origin.

**Next for the frontend**: switch `src/types/contracts.ts` to `pnpm gen:types` once `/openapi.json` is stable; add `pnpm test:e2e` to CI with Linux baselines.
