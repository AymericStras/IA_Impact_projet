# apps/web — liO teacher chatbot (frontend)

Next.js 15 (App Router) + TypeScript strict + Tailwind CSS v4 + shadcn/ui (Base UI) + Motion. The client renders the server's `ConversationResponse` and nothing else: it never computes missing fields, totals, readiness or validation.

**The design is frozen.** Read `AGENTS.md` (this folder) and `docs/DESIGN.md` before changing anything.

## Run

```sh
pnpm install
NEXT_PUBLIC_DEMO_MODE=true pnpm dev     # mock demo, no backend (also ./scripts/demo.sh from the repo root)
NEXT_PUBLIC_DEMO_MODE=false pnpm dev    # real API at NEXT_PUBLIC_API_BASE_URL (default http://localhost:8000)
```

## Verify

```sh
pnpm tsc --noEmit && pnpm lint && pnpm test -- --run && pnpm build && pnpm test:e2e
```

- `pnpm test:e2e` — Playwright, demo mode, desktop 1440×900 and mobile 390×844: functional flows plus screenshot comparison against `e2e/__screenshots__/`. Builds into `.next-e2e`, serves on port 3100. First run: `pnpm exec playwright install chromium-headless-shell`.
- A screenshot diff must be looked at (`test-results/`). Update baselines only for an intended change: `pnpm test:e2e --update-snapshots`, then review the PNGs.
- With a dev server running, build with `NEXT_DIST_DIR=.next-build pnpm build` to leave its `.next` alone.
- `pnpm gen:types` regenerates `src/types/openapi.d.ts` from the running API.

## Environment (build-time)

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_DEMO_MODE` | `false` | `true` = scripted mock service with a « Mode démo » badge |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` when unset | Absolute API origin; **empty** = same origin under the base path |
| `NEXT_PUBLIC_BASE_PATH` | empty | Sub-path deployment, e.g. `/sncf-chatbot` |
| `NEXT_OUTPUT` | unset | `standalone` = self-contained server in `<distDir>/standalone` |
| `NEXT_DIST_DIR` | `.next` | Build output directory |

## Layout

| Path | Role |
|---|---|
| `src/app/` | Root layout (`lang="fr"`, Geist font), the single page, design tokens in `globals.css` |
| `src/components/chatbot/` | One component per file: ChatContainer, TopBar, HelpDialog, DemoBadge, ConversationThread, MessageBubble, TypingIndicator, MessageComposer, VoiceRecorder, AudioTranscriptionPreview, RequirementsPanel, RequirementField, ConfirmationCard, ConfirmedJsonBlock, ErrorMessage, LoadingState |
| `src/components/ui/` | shadcn/ui primitives |
| `src/hooks/useConversation.ts` | Conversation state: restore, send, transcribe, edit, confirm, retry, error-code handling |
| `src/services/` | `conversationApi.ts` (HTTP), `mockConversationApi.ts` (demo state machine), `types.ts` (interface, `ApiError`), `index.ts` picks by `NEXT_PUBLIC_DEMO_MODE` |
| `src/types/contracts.ts` | Hand-written mirror of `packages/contracts/conversation_response.schema.json` |
| `src/i18n/fr.ts` | All user-facing strings (French) |
| `src/lib/` | Env and API root, date/time formatting (`Europe/Paris`), localStorage helpers, UI helpers |
| `e2e/` | Playwright specs, helpers and screenshot baselines |
