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

## Frontend notes — 2026-10-10 (responsiveness round + fifth field `departure_station`, `apps/web`) — design frozen

The UI design is frozen and documented in `docs/DESIGN.md`; the rules for coding agents are in `apps/web/AGENTS.md`. Read both before touching `apps/web`. The `/vocal` route (`src/app/vocal`, `src/components/voice`, voice hooks, `fr.voice.ts`, `e2e/voice*`, `playwright.voice.config.ts`) belongs to another workstream and is not described here.

**What exists (classic chat UI).**
- Stack: Next.js 15 (App Router) + TypeScript strict, Tailwind v4, shadcn/ui ("base-nova" on Base UI), `motion`, `lucide-react`. Tests: Vitest + Testing Library, Playwright.
- Services: `conversationApi.ts` (HTTP, `/api/v1`) and `mockConversationApi.ts` (demo), chosen once at build time by `NEXT_PUBLIC_DEMO_MODE` in `src/services/index.ts`. An HTTP failure never falls back to the mock.
- Components (`src/components/chatbot/`, one per file); states and copy sources are tabulated in `docs/DESIGN.md` §7. `useConversation` and the error reactions are unchanged from the previous round (`docs/DESIGN.md` §9).
- **Five fields.** `src/types/contracts.ts` mirrors the contract at schema_version 1.1: `FieldName` gains `departure_station`; canonical order `participants_count, departure_station, departure, return, teaching_type` (`FIELD_NAMES`); `requirements.departure_station: string | null`; `RequirementValue<"departure_station"> = string`; `ConfirmedRequirements.schema_version: "1.1"` with a required `departure_station`. `ClientConfig.planner_mode?: "off" | "simulated" | "http"` is typed and returned as `"simulated"` by the mock; nothing in the UI reads it.
- Panel: fifth row « Gare de départ », second, shown verbatim (✓ value / ○ « À préciser » from `missing_fields`), inline single-line editor (max 80 characters, trimmed, cannot be saved empty → `PATCH` with a string; the UI never sends `null`). Progress is `total − missing_fields.length`: « n / 5 informations », then « 5 / 5 informations · complet ». Help dialog and page description say five and list the station; the privacy line no longer says « ni gare ».
- Mock: station from « au départ de X », « depuis X » (X must be capitalised, so « depuis longtemps » is not a station), « (de la) gare de X », or a short answer to the station question; asks « De quelle gare souhaitez-vous partir ? » in the canonical order; summary « …, au départ de X, départ le … »; conflict/correction handling like the other fields; confirmed payload 1.1. Demo conversations are now stored under `demo.conversations.v2` (older ones are not reloaded: a returning demo user gets a new conversation and the standard notice). The Ajv test validates the mock against `packages/contracts/*.schema.json` and passes with the regenerated schemas.

**Responsive behaviour** (`docs/DESIGN.md` §5 and §13).
- Breakpoints are container queries on the app shell, in rem, declared as Tailwind variants in `globals.css` (`narrow`, `single`, `titled`, `wide`, `roomy`, `spacious`, `short`, `tall`, `low`, `mouse`). Width, height, zoom and text size all go through them; there are no `sm:`/`lg:` layout breakpoints left in the chat UI.
- Two columns from 48rem (768 px) with a 17.5rem panel (22rem from 64rem, 24rem from 80rem); single column below, where the panel is a summary bar whose details open as a layer over the conversation area (never over the composer). Content is centred at 1280 px on wider screens.
- Compact mode from the viewport **height** (≤ 32.5rem): slim top bar, one-line summary, one-row composer, no keyboard hint. Measured conversation height in the welcome state: 279 px (71.5 %) at 844×390, 204 px (54.4 %) at 667×375, 149 px (46.6 %) at 568×320.
- Large text / zoom: rows wrap, buttons grow instead of clipping, long words break, « Aide » / panel toggle / « Modifier » fall back to icon-only with accessible names on narrow shells or panels, confirmation-card buttons stack, and the shell scrolls vertically as a whole when its minimum content does not fit (conversation area never under 8rem). Zoom is not restricted.
- Mobile chrome: `100dvh` with `100vh` fallback, `viewport-fit=cover` + safe-area paddings, `interactive-widget=resizes-content` plus `useKeyboardInset` (visual viewport) for browsers that overlay the keyboard, inputs ≥ 16 px and targets ≥ 44 px on coarse pointers.
- « Revenir en bas » has its own row under the thread (icon-only in a right gutter on phone landscape) and no longer covers text.
- The help dialog opens at its beginning (focus on the dialog, not on « Fermer ») and scrolls inside when taller than the viewport; the transcript field is capped at 7rem and scrolls inside.

**Guardrails.**
- `pnpm test:e2e` (demo mode, production build in `.next-e2e`, port 3100): 66 tests — `demo-flow` (7 tests × `desktop` 1440×900, `mobile` 390×844, `tablet` 768×1024, `landscape` 844×390; one is mobile-only), `visual` (4 tests × the same projects, 9 screenshots each) and `responsive` (22 tests).
- `pnpm test:e2e:ci`: the portable subset, `demo-flow` + `responsive` (50 tests, no screenshots).
- `e2e/responsive.spec.ts` + `e2e/layout-audit.ts`: programmatic audit over 13 viewports + 2 at 200 % root font size, 8 states each; long-content tests; 400 %-zoom reflow tests; a self-test proving the audit reports each kind of breakage. Details and thresholds: `docs/DESIGN.md` §13. The transcript-preview state has its own, lower conversation floor (20 %): it is an editing form and leaves 141 px (24.8 %) at 320×568.
- Baselines: `apps/web/e2e/__screenshots__/darwin/{desktop,mobile,tablet,landscape}/` — `01-welcome`, `02-partial-4-of-5` (renamed from `02-partial-3-of-4`), `03-inline-edit-open`, `04-complete-confirmation-card`, `05-confirmed-json`, `06-recorder-recording`, `07-transcript-preview`, `08-error-retry`, `09-help-dialog` (36 PNGs). macOS only: on Linux they must be generated and reviewed once.
- CI on ubuntu (not wired; `.github/workflows` untouched): from `apps/web`, `pnpm install --frozen-lockfile`, `pnpm exec playwright install --with-deps chromium-headless-shell`, `pnpm test:e2e:ci`. No backend, key or environment variable is needed (the Playwright config sets `NEXT_PUBLIC_DEMO_MODE=true` and `NEXT_DIST_DIR=.next-e2e` for its own server; port 3100 must be free). Never run on CI `pnpm test:e2e` until Linux baselines exist: `visual` would fail on a missing `linux` folder.

**How verified** (from `apps/web`, 2026-10-10): `pnpm tsc --noEmit` ✓ · `pnpm lint` ✓ · `pnpm test -- --run` ✓ 14 files / 169 tests (10 files / 66 tests for the chat UI, the rest belongs to `/vocal`) · `NEXT_DIST_DIR=.next-build pnpm build` ✓ · `pnpm test:e2e` ✓ 63 passed, 3 skipped (mobile-only test on the other projects) · `pnpm test:e2e:ci` ✓ 47 passed, 3 skipped.

**Not verified.** No real device: everything above is Chromium viewport emulation on macOS. Not exercised: iOS/Android browser toolbars and `dvh`, the on-screen keyboard (`useKeyboardInset` has unit tests only), notches and safe-area insets, Safari and Firefox, real pinch-zoom, OS-level text-size settings (emulated by the root font size), a real microphone, the suite on Linux. Real mode with five fields against the live API was not run in this round, and `./scripts/demo.sh` was not run (it starts `pnpm dev` on port 3000, which was in use).

**Assumptions the backend must honour.**
- Endpoints and bodies as in `docs/API.md`; `GET /config` → `{max_audio_seconds, max_audio_bytes, max_message_chars, timezone, planner_mode?}`; errors as problem details `{type, title, status, code, detail}` with a French `detail`.
- A field is shown as known iff it is absent from `missing_fields`; values are shown verbatim; `confirmed_requirements` is rendered only when `state === "CONFIRMED"`. `departure_station` longer than 80 characters is refused by the server (the input also has `maxLength=80`).
- CORS must allow the web origin when the API is on another origin.

**Open points seen from the frontend.**
- The server's welcome message (« … combien de participants, quand partir et revenir, et sur quel thème … ») does not mention the departure station. The mock copies it as is; if the backend changes it, update `T.welcome` in `mockConversationApi.ts`.
- `docs/DEMO.md` (demo script) and `src/i18n/fr.voice.ts` (« Les quatre informations de la sortie », « schema_version 1.0 ») still describe four fields; neither was edited in this round.

**Next for the frontend**: switch `src/types/contracts.ts` to `pnpm gen:types` once `/openapi.json` is stable; wire `pnpm test:e2e:ci` in CI; generate and review Linux baselines before running `visual` there.
