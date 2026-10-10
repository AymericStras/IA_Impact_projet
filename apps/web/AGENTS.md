# apps/web — instructions for coding agents

These rules apply to everything under `apps/web`. They complement the root `AGENTS.md` (which still applies); where both speak, the stricter rule wins.

**The UI design is frozen.** Read `docs/DESIGN.md` before any UI change. Your job here is to keep the chatbot working and consistent, not to redesign it.

## Scope

- Two experiences on the same backend and the same conversation: the classic chat at `/` (conversation + "Votre projet" panel + composer with voice input) and the staged voice flow at `/vocal` (one full-screen stage at a time: ask, listen, think, sheet, done — plan in `docs/VOICE_FLOW.md`, notes in `apps/web/VOICE_NOTES.md`). The freeze below covers the classic chat; `/vocal` reuses the same tokens and may still receive a visual direction chosen by the owner.
- `/vocal` code lives in `src/app/vocal/`, `src/components/voice/`, `src/hooks/useVoiceFlow.ts`, `useHoldToTalk.ts`, `useAudioCapture.ts`, `src/i18n/fr.voice.ts`; its e2e runs with `pnpm test:e2e:voice` (config `playwright.voice.config.ts`, port 3200, `.next-voice`). Run it after the classic suite, never at the same time.
- **Journey after confirmation** (`docs/PLANNER_CONTRACT.md`, `docs/DESIGN.md` §14): once the project is `CONFIRMED` and `GET /config` says `planner_mode` is not `"off"`, the classic chat shows, under the confirmed card, the journey the server computed — destinations, itineraries, adjustments, booking, travel file, feedback. **It is rendered from server state only** (the `Journey` and `TravelFile` objects): the client does not plan, rank, filter, compute feasibility, count unlocked itineraries or decide a stage. Destinations, trains, itineraries and booking remain teammates' modules; the backend simulates them and labels them as simulated, and every journey view must show that label (`journey.notices`, never hardcoded).
- Out of scope: new pages, navigation, authentication, dashboards, any planning logic of our own (searching destinations or trains, building or checking itineraries, booking), analytics, any data beyond the five requirements (participants, departure station, departure, return, subject or theme).
- Do not edit `services/api` or `packages/contracts` from a frontend task.

## The one rule

**The UI renders server state only.** Every screen is a function of the latest `ConversationResponse` returned by the API — and, after the confirmation, of the latest `Journey` (plus the `TravelFile`). The client never computes missing fields, participant totals, date inference, validation, readiness, or what to ask next; for the journey it never computes a stage, a list order, a feasibility, an adjustment or its `unlocks` count. If the screen looks wrong because the server sent something wrong, the fix is in the backend.

If the API seems insufficient for what you need: **stop, and write the need in `docs/HANDOFF.md` under "Open questions"**. Do not work around it in the client, do not add client-side business logic, do not extend the mock to pretend the API does it.

## Where things live

| Path | Content |
|---|---|
| `src/app/` | Root layout, the single page, `globals.css` (design tokens) |
| `src/components/chatbot/` | One component per file, co-located `*.test.tsx` |
| `src/components/chatbot/journey/` | The journey after confirmation: `JourneyPanel` (chooses the view from `journey.stage`) and one component per card or list; `journeyFixtures.ts` is test data built from the contract examples (test-only) |
| `src/components/ui/` | shadcn primitives — use as generated, do not restyle |
| `src/hooks/useConversation.ts` | All conversation state and error handling |
| `src/hooks/useJourney.ts` | Journey state: the latest `Journey`, the travel file, the pending action, the error. Shared with `/vocal` |
| `src/hooks/useViewportTracking.ts` | On-screen keyboard inset (`--app-height`), panel height cap, narrow-composer detection. Also imported by the `/vocal` route: keep its exports stable |
| `src/services/conversationApi.ts` | Real HTTP client |
| `src/services/mockConversationApi.ts` | Demo-mode state machine (scripted); also holds the demo journey's state (`mockJourneyBridge`, used by the journey mock only) |
| `src/services/journeyApi.ts`, `journeyTypes.ts` | Real HTTP client of `/conversations/{id}/journey…` and the `JourneyService` interface. Shared with `/vocal` |
| `src/services/mockJourneyApi.ts` | Demo-mode journey: a scripted port of the backend's simulation (`services/api/app/services/planner.py` + the journey methods of `conversation.py`). Exports `mockJourneyApi` only |
| `src/services/types.ts` | `ConversationService` interface, `ApiError`, error-code → reaction mapping |
| `src/types/contracts.ts`, `src/types/journey.ts` | Types mirroring `packages/contracts/*.schema.json` |
| `src/i18n/fr.ts` | **Every** user-facing string |
| `src/lib/` | `env.ts` (env, API root, defaults), `format.ts` (dates/times), `storage.ts`, `ui.ts` (`TOUCH_TARGET`, `FLUID_BUTTON`, `WRAP_ANYWHERE`; exports are shared with `/vocal`) |
| `e2e/` | Playwright specs (`demo-flow`, `responsive` + `layout-audit.ts`, `visual`), helpers, screenshot baselines (`__screenshots__/`) |

## Commands that must pass

Run from `apps/web`, all five, before you call a task done:

```sh
pnpm tsc --noEmit
pnpm lint
pnpm test -- --run
pnpm build
pnpm test:e2e
pnpm test:e2e:voice   # when anything under the /vocal paths, a shared hook or lib/ui.ts changed
```

- `pnpm test:e2e` builds the app in demo mode into `.next-e2e` and serves it on port **3100**; it does not touch a `pnpm dev` running on port 3000. It runs three specs: `demo-flow` (flows, including the journey and its branches, on the `desktop`, `mobile`, `tablet` and `landscape` projects), `visual` (screenshots, same four projects, macOS baselines only) and `responsive` (programmatic layout audit over a viewport matrix, journey states included).
- `pnpm test:e2e:ci` runs the portable subset (`demo-flow` + `responsive`, no screenshots): this is the one for Linux/CI until Linux baselines exist.
- **`e2e/responsive.spec.ts` must pass at every size of its matrix** (`docs/DESIGN.md` §13). When it fails, the layout is broken at that size: fix the layout. Never make it pass by hiding content, removing a control, lowering a threshold, loosening `auditLayout`, or restricting zoom (`maximum-scale`, `user-scalable`). The spec contains a self-test that fails if the audit stops detecting a kind of breakage.
- Two builds must not run at the same time in this directory (Next rewrites `tsconfig.json` during a build): if a build fails with "Cannot read file tsconfig.json", another build was running — rerun.
- If a dev server is running, build with `NEXT_DIST_DIR=.next-build pnpm build` so you do not overwrite its `.next`.
- First run on a machine: `pnpm exec playwright install chromium-headless-shell`.

## Change procedure

1. Read `docs/DESIGN.md` and the component you are about to touch, including its test.
2. Write or update the component test **first** (Vitest + Testing Library), then change the code.
3. Run the five commands.
4. If `pnpm test:e2e` reports a screenshot difference, open `test-results/**/*-diff.png` and `*-actual.png` and **look at them**.
   - You did not intend a visual change → your change is wrong; fix it.
   - You intended it → update `docs/DESIGN.md` first, then `pnpm test:e2e --update-snapshots`, review every regenerated PNG, and commit them with the change. Say in your summary which screenshots changed and why.
   - Never run `--update-snapshots` just to turn the suite green.
5. Update the "Frontend notes" section of `docs/HANDOFF.md`.

## Forbidden changes

Same list as "Do not" in `docs/DESIGN.md`:

- No new colours, fonts, icon sets, UI libraries, CSS frameworks or dark theme.
- No gradients, shadows, illustrations, background images, decorative or attention-seeking animation.
- No restyling of shadcn primitives outside the tokens.
- No client-side field logic (missing fields, totals, date inference, validation, readiness), and no client-side planning logic (ranking, filtering, feasibility, adjustments) outside `mockJourneyApi.ts`.
- No journey view without the server's notices, and no hardcoded simulation label.
- No HTML or markdown rendering of messages; no `dangerouslySetInnerHTML`.
- No streaming of partial JSON / partial model output into the requirements state.
- No hardcoded French strings in components — add them to `src/i18n/fr.ts`. Code, comments, tests and docs are in English.
- No `fixed`/`sticky` composer, no animated scrolling.
- No `sm:`/`md:`/`lg:` width breakpoints or px media queries for layout: use the shell tiers of `globals.css` (`narrow`, `single`, `wide`, `roomy`, `spacious`, `short`, `tall`, `low`, `mouse`; `docs/DESIGN.md` §5.1). No hover-only information, no control under 44 × 44 px on coarse pointers, no input under 16 px on touch, no `maximum-scale` / `user-scalable=no`.
- No AI SDK transport, no new state-management or data-fetching library; keep `useConversation` + the JSON API.
- No removal or weakening of tests, e2e assertions or screenshot baselines to get a green run.

## Demo mode vs real mode

| | Demo (`NEXT_PUBLIC_DEMO_MODE=true`) | Real (`false` / unset) |
|---|---|---|
| Service | `mockConversationApi` — regex heuristics + French templates, state in `localStorage`; `mockJourneyApi` for the journey | `conversationApi` and `journeyApi` — HTTP to the FastAPI service |
| Label | « Mode démo » badge always visible | no badge |
| Purpose | UI development, pitch fallback, e2e and screenshots | the actual product |

- The mode is chosen **once, at build time**, in `src/services/index.ts`. No other application code may import the mock (its own tests aside).
- **An HTTP failure must never fall back to the mock.** In real mode a failed call surfaces the server's French `detail` with the documented recovery (see `docs/DESIGN.md` §9).
- The mock is scaffolding, not model capability. Keep it valid against `packages/contracts` (the Ajv test enforces this) and aligned with the backend's templates; do not grow it into a second implementation of the backend.
- The same holds for `mockJourneyApi.ts`: it copies the backend simulation's catalogue, rules, French strings and error codes (`PLANNER_ERROR`, `BOOKING_ERROR`, `INVALID_STATE`) so that demo mode shows every stage and branch. Its test validates every output against `journey.schema.json` / `travel_file.schema.json` and compares it with the contract examples. When the backend simulation changes, port the change; never add behaviour the backend does not have, and never put planning logic anywhere else in the client.
- Journey test switches (simulated mode, real or demo): the « Scénario de test » tool sends `search_scenario` (`auto` / `adjustments` / `no_match` / `error`) and `booking_scenario` (`confirmed` / `refused` / `error`) with `POST /journey`.
- Mock-only test switch: setting the `localStorage` key exported as `DEMO_FAIL_NEXT_KEY` makes the next message fail once with a provider error.

## Deployment under a sub-path

The app can be served under a path prefix with the API reverse-proxied on the same origin (e.g. `https://example.org/sncf-chatbot/` and `/sncf-chatbot/api/v1/…`). All of these are **build-time** variables:

| Variable | Value for a sub-path deployment | Effect |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | `/sncf-chatbot` | Next.js `basePath` (pages, `_next` assets, favicon) and `trailingSlash`; also namespaces the `localStorage` keys |
| `NEXT_PUBLIC_API_BASE_URL` | empty | Same-origin API at `${NEXT_PUBLIC_BASE_PATH}/api/v1`. An absolute URL is used as-is; **unset** means `http://localhost:8000` |
| `NEXT_OUTPUT` | `standalone` | Emits `<distDir>/standalone/server.js` (copy `<distDir>/static` into `standalone/<distDir>/static` before starting it) |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | Real API |
| `NEXT_DIST_DIR` | optional | Build output directory (default `.next`) |

The API root is resolved in one place, `resolveApiRoot` in `src/lib/env.ts` (unit-tested). Never build API or asset URLs by hand elsewhere; never hardcode a leading `/` path to a static file — let Next apply the base path.

## Security

- No secrets in this app. Nothing secret may be put in a `NEXT_PUBLIC_*` variable: those are compiled into the public bundle. The OpenAI key lives only in the backend.
- Treat every string from the server or the user as untrusted text: render through React text nodes only; never build HTML, never `eval`, never inject into `href`/`src`.
- Do not log message contents, transcripts or requirements to the console.
- Audio is sent to the API and never stored client-side; do not persist anything beyond the conversation id (and the mock's own state in demo mode).
