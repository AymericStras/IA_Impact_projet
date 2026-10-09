---
name: frontend-implementation
description: Implement or modify the French chatbot UI in apps/web (Next.js, TypeScript, Tailwind, shadcn/ui, Motion) from the design spec, rendering server state only. Use for any component, page, hook, styling or accessibility work in apps/web.
---

# Frontend implementation

## Read first
`AGENTS.md` §3 (invariants 9, 12), `docs/PRODUCT.md`, `docs/DEMO.md` (layout + Stitch prompt), `packages/contracts/conversation_response.schema.json`.

## Rules
- The client renders `ConversationResponse`. Never compute `missing_fields`, totals, readiness or validation in the browser.
- One component per file in `src/components/chatbot/`: ChatContainer, MessageBubble, MessageComposer, VoiceRecorder, AudioTranscriptionPreview, TypingIndicator, RequirementsPanel, RequirementField, ConfirmationCard, ErrorMessage, LoadingState.
- Data access only through `src/services/conversationApi.ts` (real) and `src/services/mockConversationApi.ts` (demo); the `useConversation()` hook picks one from `NEXT_PUBLIC_DEMO_MODE`. Demo mode shows a « Mode démo » badge.
- Types in `src/types/contracts.ts`, generated from the API's OpenAPI (`pnpm gen:types`); never hand-edit.
- All strings French, centralised in `src/i18n/fr.ts`. Dates formatted with `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' })`.
- Composer: Enter sends, Shift+Enter newline; disabled while a request is in flight; optimistic user bubble, rollback on error with retry.
- VoiceRecorder: MediaRecorder; states idle → requesting → recording (timer, cancel) → uploading → transcript preview (editable) → sent. Handle permission denied, `MAX_AUDIO_SECONDS`, upload failure (re-record).
- RequirementField: ✓ known / ○ « À préciser »; « Modifier » opens inline edit → `PATCH /requirements` with `expected_version`; 409 → reload and inform.
- Accessibility: keyboard reachable, `aria-live="polite"` on new assistant messages, focus management after send, 4.5:1 contrast, reduced-motion respected for Motion animations.
- Mobile: single column, panel collapsible with progress « 3 / 4 informations ».

## Procedure
1. If a design reference is needed, run Stitch via `./tools/stitch` with the prompt in `docs/DEMO.md`, save output under `artifacts/`, and translate it into components — never ship generated HTML.
2. Build the component in isolation with mock data; add a Vitest + Testing Library test for its states.
3. Wire it through `useConversation()`; verify in `./scripts/demo.sh`.
4. `pnpm tsc --noEmit && pnpm lint && pnpm test`; for flows, Playwright in demo mode.
5. Update `docs/HANDOFF.md`.
