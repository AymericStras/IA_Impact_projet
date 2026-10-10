---
name: frontend-implementation
description: Implement or modify the French chatbot interface in apps/web (Next.js, TypeScript, Tailwind, shadcn/ui, AI Elements, Motion) from the specification, rendering server state only. Use for any component, page, hook, styling or accessibility work in apps/web.
---

# Frontend implementation

## Read first
`AGENTS.md` §3 (invariants 9, 12), `docs/PRODUCT.md`, `docs/DEMO.md` (layout + Stitch prompt), `docs/API.md`, `packages/contracts/conversation_response.schema.json`, and the "Frontend notes" section of `docs/HANDOFF.md`.

## Rules
- The client renders `ConversationResponse`. Never compute `missing_fields`, totals, `ready_for_confirmation` or validation in the browser.
- One component per file in `src/components/chatbot/`: ChatContainer, MessageBubble, MessageComposer, VoiceRecorder, AudioTranscriptionPreview, TypingIndicator, RequirementsPanel, RequirementField, ConfirmationCard, ErrorMessage, LoadingState, DemoBadge.
- Data access only through `src/services/conversationApi.ts` (real) and `src/services/mockConversationApi.ts` (demo); the `useConversation()` hook chooses according to `NEXT_PUBLIC_DEMO_MODE`. Demo mode shows a « Mode démo » badge.
- Types in `src/types/contracts.ts`, aligned with the JSON Schemas (`pnpm gen:types` from the API's OpenAPI when it is running).
- All strings in French, centralised in `src/i18n/fr.ts`. Dates through `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' })`, times « 8 h 00 », constraints « vers », « au plus tard à », « à partir de ».
- Composer: Enter sends, Shift+Enter inserts a line break; disabled during a request; optimistic bubble, rollback and « Réessayer » on error (same `client_message_id`).
- VoiceRecorder: MediaRecorder; states idle → permission → recording (timer, cancel) → uploading → transcript preview (editable) → sent. Handle microphone denial, `MAX_AUDIO_SECONDS`, upload failure (re-record), unsupported browser.
- RequirementField: ✓ known / ○ « À préciser »; « Modifier » opens an inline edit → `PATCH /requirements` with `expected_version`; 409 → reload and inform.
- Accessibility: keyboard, `aria-live="polite"` on new messages, focus returned to the composer after sending, 4.5:1 contrast, `prefers-reduced-motion` respected.
- Mobile: one column, collapsible panel with « 3 / 4 informations ».

## Procedure
1. If a visual reference is useful, run Stitch through `./tools/stitch` with the prompt from `docs/DEMO.md`, save under `artifacts/`, translate into components — never ship the generated HTML.
2. Build the component in isolation with mocked data; add a Vitest + Testing Library test of its states.
3. Wire it through `useConversation()`; verify with `./scripts/demo.sh`.
4. `pnpm tsc --noEmit && pnpm lint && pnpm test -- --run`; for journeys, Playwright in demo mode.
5. Update `docs/HANDOFF.md`.
