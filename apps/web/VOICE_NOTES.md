# Voice flow (`/vocal`) — implementation notes

Notes of the frontend agent for the staged, voice-first experience specified in `docs/VOICE_FLOW.md`. To be merged by the lead into `docs/DESIGN.md` (stages, motion tokens, gesture rules), `apps/web/AGENTS.md` and `docs/HANDOFF.md`. Everything below describes the code **as implemented**; where the plan says "four" fields, read **five** (see "Five fields").

Status: delivery steps 1–6 of the plan are implemented and verified **in demo mode, in desktop Chromium**. Step 7 (integration, real model, CI) is not done here. The stages **after confirmation** — the simulated journey of `docs/PLANNER_CONTRACT.md` — are implemented and verified the same way (§11). Read "Not verified" before relying on this route.

## 1. What exists

| Path | Content |
|---|---|
| `src/app/vocal/page.tsx` | Route (server component: metadata) rendering `VoiceFlow` |
| `src/components/voice/VoiceFlow.tsx` | Stage router, transitions, banners, and the persistent dock with the talk button |
| `src/components/voice/StageFrame.tsx` | Shell (dynamic viewport height, safe areas, keyboard inset), top bar, live announcer, `StageHeading` |
| `src/components/voice/stages/{Ask,Listen,Think,Sheet,Done}Stage.tsx` | One file per stage |
| `src/components/voice/TalkButton.tsx` | The talk control (presentational; gesture state comes from the hook) |
| `src/components/voice/VoiceShape.tsx` | Canvas visual + reduced-motion level meter |
| `src/components/voice/SheetRow.tsx`, `FieldEditor.tsx` | One field row and its typed editor |
| `src/components/voice/TranscriptNote.tsx`, `TextEntry.tsx` | « Vous avez dit » with correct-and-resend; the text path |
| `src/components/voice/ProgressDots.tsx`, `Banner.tsx` | Five dots; notice / error block |
| `src/components/voice/fieldDisplay.ts` | Display helpers: row list, labels, values in words, asked row, confirmation sentence |
| `src/components/voice/usePrefersReducedMotion.ts` | Live `prefers-reduced-motion` (follows a change made while the page is open) |
| `src/components/voice/voiceTestHooks.ts` | Deterministic mode of the visual (demo only) |
| `src/components/voice/voice.module.css` | Route-scoped shell, layout tiers, talk button, motion tokens |
| `src/hooks/useVoiceFlow.ts` | Stage machine: pure reducer + effects around `useConversation` |
| `src/hooks/useHoldToTalk.ts` | Hold / tap / keyboard gesture |
| `src/hooks/useAudioCapture.ts` | `getUserMedia`, `MediaRecorder`, `AnalyserNode`, cleanup |
| `src/i18n/fr.voice.ts` | Every French string of this route |
| `src/components/voice/journey/*Stage.tsx` | One file per journey stage (destinations, itineraries — also the alternatives of a refused booking —, adjustments, no match, review, booking pending, booked, travel file, feedback, closed) |
| `src/components/voice/journey/Carousel.tsx`, `ItineraryView.tsx`, `JourneyIntro.tsx`, `StageActions.tsx`, `journeyDisplay.ts` | One-card-at-a-time navigation; the day as a timeline; heading + server line + simulation label; the actions rendered into the dock; formatting helpers |
| `src/components/voice/journey/journeyFixtures.ts` | Test-only fixtures built from `packages/contracts/examples` and a fake `JourneyService` |
| `playwright.voice.config.ts`, `e2e/voice-*.spec.ts`, `e2e/voice-helpers.ts`, `e2e/voice-audit.ts` | E2E: functional (`voice-flow`, `voice-journey`), responsive (`voice-responsive`, `voice-journey-responsive`, sharing the audit of `voice-audit.ts`), visual |
| `e2e/__screenshots__/darwin/{desktop,tablet,mobile,landscape}/voice-*.png` | 100 baselines (48 + 52 for the journey) |

Nothing outside these paths was modified. No dependency was added. The classic chat at `/` is untouched.

## 2. Stages and the state machine

`StageId = "ask" | "listen" | "think" | "sheet" | "done"`, plus the journey stages of §11. Every transition is in `voiceFlowReducer` (pure, exhaustive `switch`; `useVoiceFlow.test.tsx` holds 130 tests for the reducer and the hook). The hook `useVoiceFlow` only runs effects (transcription, extraction, retries) and dispatches.

- **Initial stage** comes from the server state (`stageFromServer`): `CONFIRMED`/`HANDOFF` → `done`; anything known (a value, a field not in `missing_fields`, or a pending clarification) → `sheet`; otherwise `ask`.
- **`listen` and `think`** are transient and local; a server update never interrupts them. They return to the stage they started from (`origin`: `ask` or `sheet`).
- **`done`** is entered only when the server state is confirmed (after `confirm()`, or a spoken confirmation the server accepted). There is no client-side "confirmed" flag.
- **« Modifier »** on `done` shows the sheet of a confirmed trip (`reviewing`); an edit makes the server reopen it and a new confirmation is required.
- After `think` the flow always lands on `sheet` — also when nothing was understood: the sheet is the review screen (decision D2).

To add a stage: extend `StageId`, add events to `VoiceFlowEvent` and cases to the reducer (the `never` check in `default` makes the compiler list what is missing), add a stage component and one branch in `VoiceFlow`. The stages after `done` were added this way: see §11.

### Requests and errors

| Situation | Behaviour |
|---|---|
| Recording finished | `think` step 1: `transcribe(blob)`. The blob is kept in a ref until this call succeeds |
| Transcript received | Shown at once; step 2: `send(transcript, "audio")` automatically (D2) |
| Transcription fails, `audio` kind (`AUDIO_*`, `EMPTY_TRANSCRIPT`) | Back to the origin stage with the server's `detail` and « Réessayer l'enregistrement » |
| Transcription fails, provider / network / rate limit | Stays on `think`; « Réessayer » uploads **the same blob** again |
| Extraction fails, provider kind | Stays on `think` with the transcript; « Réessayer » calls `useConversation.retry()` = same request, **same `client_message_id`** |
| Conflict / rate limit on the message | Lands on `sheet` with the server's notice; the text is kept in « Vous avez dit », flagged as not applied, ready to resend |
| « Annuler » on a failed analysis | Back to the origin; on `ask` the text field reopens with the text |
| Conversation gone (`not_found`) | « Nouvelle sortie » |
| Edit / confirm failure on the sheet | Error block at the top of the stage with « Réessayer » when the server allows it |

`useConversation.retry()` returns nothing, so the result of an extraction is read from the conversation once its request has settled (`think.settling` + one effect). An HTTP failure never reaches the mock: the service is chosen once in `src/services/index.ts`, unchanged.

## 3. Gesture rules (`useHoldToTalk`, 15 unit tests)

| Input | Effect |
|---|---|
| Press ≥ 250 ms (`HOLD_THRESHOLD_MS`) | Hold-to-talk: recording runs while pressed, release finishes |
| Press < 250 ms | Toggle: recording keeps running; the next press finishes |
| Space / Enter on the button | Toggle start; while recording, Space / Enter finish from any non-interactive focus position |
| Escape (anywhere, while recording) | Cancel |
| Drag beyond the cancel radius | « Relâchez pour annuler »; releasing there discards. Radius = max(96 px, 1.25 × button width), measured from where the press began |
| `pointercancel`, tab hidden, microphone track ended | Cancel with the notice « L'enregistrement a été interrompu » |
| Recording shorter than 0.6 s (`MIN_RECORDING_MS`), or released before the permission was granted | Discarded with « Maintenez le bouton pendant que vous parlez. » |
| Click with no pointer / key event behind it (screen reader, switch access) | Toggle |
| Server's `max_audio_seconds` reached | Recording stops and is sent; countdown shown for the last 10 s |

Implementation points that matter:

- The microphone is requested, and the `AudioContext` created, synchronously inside the gesture.
- The button has `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none`, pointer capture, and suppresses `contextmenu`. Measured in Chromium with real touch points: with `touch-action: none` a dragged finger arms the cancel; with it removed the browser turns the drag into a scroll, fires `pointercancel`, and the recording is "interrupted" instead.
- **The talk button lives in `VoiceFlow`, not in a stage**, and its layout position is identical on `ask`, `listen` and `sheet` (the dock is bottom-anchored, the button is its last item). The finger that started a recording stays on the same element while the screen changes. The responsive spec asserts ≤ 1 px of movement at every viewport.
- Press feedback changes the disc colour and the icon scale, never the disc size: the disc cannot shrink below its touch size while pressed.
- Every exit path (stop, too short, cancel, interruption, maximum duration, permission error, recorder error, unmount) goes through one `release()` that stops the tracks and closes the `AudioContext` (17 unit tests; one e2e counts live tracks after cancel / too short / completion).

Two fixes made to the hooks inherited from the previous agent:

- `useAudioCapture` used `startedAt === 0` to mean "not recording yet"; a recording that started at clock 0 was treated as never started. It now has an explicit `started` flag. It also handles a track that ends by itself.
- `useHoldToTalk` kept a gesture forever when its button was unmounted before the pointer came up (recording stopped by the maximum duration while a finger was down), blocking the next press. A dead or orphaned gesture no longer blocks.

## 4. Visual language and motion

V3 update (ADR-026): the visual tokens, navy header, primary controls and emphasis now follow `docs/DESIGN.md` §15. Earlier screenshots and test totals below describe the pre-restyle run; current verification is in `docs/HANDOFF.md`.

Tokens are the frozen ones of `docs/DESIGN.md`: no additional colour, font, radius, icon set or library. The route adds scale (question in large type, 64–88 px talk disc) and motion.

`listen` turns the whole shell to the accent surface (`--primary` background, `--primary-foreground` text). The focus ring inverts there (the global ring is the accent colour and would be invisible).

Motion tokens (CSS variables on the shell, `voice.module.css`):

| Token | Value | Used for |
|---|---|---|
| `--voice-stage-enter` | 240 ms | Stage entrance: opacity 0→1, y 14→0. Run by Motion from `VoiceFlow.tsx` (0.24 s, same curve); the CSS variable documents the value and is not read by the animation — change both |
| `--voice-surface` | 320 ms `ease` | Shell background / text colour when entering or leaving `listen` |
| `--voice-press` | 120 ms | Talk disc press feedback |
| `--voice-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | Entrances and press |

There is no exit animation: the next stage appears immediately (the finger is on the button).

**Voice shape** (`VoiceShape`, decision D5: 2D canvas, no WebGL):

- Three translucent organic outlines and a solid core, in `--primary-foreground`. Their radius follows the smoothed input level (50 ms attack, 260 ms release); their lobes (harmonics 2, 3, 5) follow the eight log-spaced frequency bands of the voice; voice peaks release rings that travel outwards for 1.5 s. A slow breath keeps it alive in silence.
- Level and bands come from an `AnalyserNode` on the same `MediaStream` as the `MediaRecorder`; the analyser is never connected to the destination (nothing is played back).
- Backing store = CSS size × `devicePixelRatio` (capped at 3), resized by a `ResizeObserver` and repainted in the same task, so a resize or a rotation never shows a blank or stretched frame. One `requestAnimationFrame` loop, no allocation per frame.
- Text is never placed on the shape: on the accent surface every text sits on plain `--primary`.
- **Reduced motion**: the shape is replaced by a `role="meter"` of 12 segments refreshed every 160 ms (lit segments solid, the others outlined); stage changes cross-fade without movement. The preference is followed live.
- **Deterministic mode** (demo builds only): `window.__lioVoiceFixedLevel = 0.62` before load freezes the shape and the meter at that level and at a fixed instant. Used by the visual spec.

## 5. Layout and responsiveness

The shell is a size container (`container: voice / size`), 100dvh with a 100vh fallback, and uses `--app-height` from `useKeyboardInset` when an on-screen keyboard covers the page. Only the stage area scrolls; the dock is outside it. Tiers are container queries in rem, so zoom and large text land in the same tiers as small windows:

| Tier | Condition | Layout |
|---|---|---|
| column (default) | — | top bar / stage / dock at the bottom: `[secondary] [talk] [primary]` |
| low | ≤ 32.5rem high and ≥ 30rem wide (phone landscape; large text on a laptop) | dock becomes a column on the right; `listen` puts text and shape side by side |
| tiny | < 17rem wide (200 % text on a phone) | dock stacks its controls, idle hint kept for assistive technology only |

The talk disc is `clamp(64px, 14dvh, 88px)` — in px on purpose (a finger does not grow with the text size).

Measured by `e2e/voice-responsive.spec.ts` (programmatic, no screenshots) on 320×568, 360×640, 390×844, 430×932, 568×320, 667×375, 844×390, 768×1024, 820×1180, 1024×768, 1280×720, 1440×900, 1920×1080, and 390×844 / 1280×720 at root font-size 200 %, for: ask, ask + text field, listen (meter), listen (shape), think, sheet partial, sheet with the tallest editor open, sheet ready, done, done + JSON; plus long content and notices on a subset. Per state: the page never scrolls (the shell is exactly the viewport); no horizontal overflow; nothing outside the viewport or clipped; button labels whole; talk disc round, ≥ 72 px (≥ 64 px in short landscape), fully visible and not covered; dock controls reachable without scrolling and never overlapping the stage; no overlapping controls; 44 px touch targets and 16 px fields on touch; every row and the transcript note reachable by scrolling the stage. A last test breaks the layout on purpose (12 ways) and checks the audit reports each one.

The journey stages (§11) are measured the same way by `e2e/voice-journey-responsive.spec.ts` on the same matrix: done with the scenarios open, destinations (first card; second card with an activity chosen; looked at again from a later stage), adjustments (nothing selected; one selected; every option reachable), itineraries, review, booking pending, booked, travel file, feedback (empty; rated with a long comment), closed, no match, done with a technical error, booking refused, and the sheet with the restart notice. On top of the common audit: the actions of each stage are in the dock, whole, exposed and outside the scrolling area; where secondary actions are folded (`tiny` tier) the stage keeps ≥ 40 % of the height, and both the folded and the unfolded dock are audited.

Known limits at the extremes, accepted:

- 390×844 at 200 % text: the stage area is 331–379 px high and row labels wrap inside words (« Particip/ants »). Everything is reachable; it is not pretty.
- Phone landscape with the text field open on `ask`: the field's send button needs a scroll.
- Journey stages on a phone held sideways (844×390 and smaller): the heading, the server's line and the simulation label fill the first screen; the card starts at the fold and is read by scrolling. The actions stay in the column on the right.
- Journey stages at 390×844 with 200 % text: with « Autres choix » unfolded on the review (three secondary actions) the stage area is short — above the audit's 160 px floor, not by much — until it is folded again.

## 6. Accessibility

- One `h1` per stage. Entering `ask` (first load, new trip), `think`, `sheet` and `done` moves focus to it. **Deviation from the brief:** entering `listen`, and coming back from it, does **not** move focus: the teacher is operating the talk button, and taking focus away from the control in use (mid-gesture, or right after a cancelled attempt) would force a keyboard user to find it again. The stage change is announced instead.
- Stage changes are announced by a polite live region (`fr.voice.announce`). Notices are `role="status"`, errors `role="alert"`, the timer `role="timer"`; the countdown is spoken at 10 s and 5 s only.
- The talk control is a real `<button>` with `aria-pressed`, a visible text label under the disc (« Parler » / « Terminer » / « Annuler »), `aria-describedby` on the visible hint.
- State is never motion or colour alone: recording state is a sentence + timer; row state is icon + words (« Renseigné » / « À préciser » / « À clarifier »); progress dots are filled vs hollow with a text alternative; think steps carry their state in words.
- Keyboard only: the whole flow is covered by an e2e (write → sheet → edit → confirm → new trip) and another for the voice path (Space, Space, Escape).
- Server and teacher text (questions, transcript, values, error details) is rendered as React text nodes only; a unit test feeds markup and checks no element is created.

Contrast, measured in the browser from computed styles (WCAG 2.x; e2e `measured contrast…`, asserted ≥ 4.5):

| Pair | Ratio |
|---|---|
| listen: heading, status, timer, hint, cancel button, demo label on the accent surface | 7.73 |
| listen: talk icon on the inverted disc | 7.73 |
| ask: question on background | 17.29 |
| ask: idle hint (muted) on background | 6.77 |
| ask: secondary dock button | 18.09 |
| sheet: value on card | 18.09 |
| sheet: « Renseigné » (success) on card | 6.45 |
| sheet: « À préciser » (muted) on the asked row | 6.45 |
| sheet: question on the asked row | 16.46 |
| sheet: status sentence | 17.29 |
| sheet: transcript text | 16.78 |

Not measured: the disabled « Confirmer » (50 % opacity; disabled controls are exempt, and the sentence above it says why), the pressed disc colour, placeholder text.

## 7. Server state only

- Row state: `pending_clarification.field` → « À clarifier »; in `missing_fields` → « À préciser »; else « Renseigné ». A filled value the server still lists as missing stays « À préciser » (unit-tested).
- « Confirmer » is enabled by `ready_for_confirmation` alone. The sentence above it is built from `ready_for_confirmation`, `state`, `pending_clarification`, `missing_fields`, in that order.
- The question on `ask` and the message on the sheet are `assistant_message`; after a reload (`GET` carries none) the last assistant message of `messages`.
- Values in words through `src/lib/format.ts`. The participants breakdown line uses the same display guard as the classic panel.
- The editors check only that the form is complete; validation and its messages are the server's.

### Open questions (API)

1. **Which row does the server's question concern?** `ConversationResponse` does not say. The backend's state manager has it (`Action.field` in `services/api/app/domain/state_machine.py`) but does not expose it. The sheet therefore uses: the field of `pending_clarification` when there is one; otherwise, once the teacher has spoken, the **first of `missing_fields`** (which is what `_first_missing` asks about today); the welcome and the summary go above the rows. This mirrors a backend rule in the client and will silently mis-attach the question if that rule changes. Proposed: an optional `asked_field: FieldName | null` in the response; `askedField()` in `fieldDisplay.ts` is the single place to switch.
2. **No way to make the audio call fail in demo mode** (the mock has a one-shot failure for messages only), so "transcription fails, retry with the same recording" is covered by a unit test with a fake service, not by e2e.

## 8. Five fields

Built for five fields from the start: `participants_count`, `departure_station`, `departure`, `return`, `teaching_type` (five dots, five rows, five values on `done`, `schema_version` read from the payload). The shared `FieldName` already included `departure_station` when this was written, so there is **no cast**: `SHEET_FIELDS` is a typed constant checked against `FieldName` in both directions (a field added to the contract is a compile error until it gets a row). The station editor is a single-line text input, `maxLength` 80, trimmed, 16 px text. Its label / placeholder for this route are in `fr.voice.ts`.

## 9. Duplication to remove at integration

The typed editors and the value formatting of `RequirementField.tsx` are not exported, so `FieldEditor.tsx` and `fieldDisplay.ts` re-implement them with the same labels and value shapes. Extracting them from `RequirementField` into a shared module would remove most of `FieldEditor.tsx` and the value helpers of `fieldDisplay.ts`.

## 10. How it was verified

All commands from `apps/web`. E2E is demo mode, Chromium headless shell, fake microphone (a periodic beep), port 3200, build directory `.next-voice`.

```sh
pnpm tsc --noEmit
pnpm lint
pnpm test -- --run
pnpm exec playwright test -c playwright.voice.config.ts --project=voice              # functional
pnpm exec playwright test -c playwright.voice.config.ts --project=voice-responsive   # layout matrix
pnpm exec playwright test -c playwright.voice.config.ts voice-visual                 # baselines
NEXT_DIST_DIR=.next-voice pnpm build                                                 # production build, real mode
```

For the journey stages (§11), same commands: `voice-journey.spec.ts` runs in the `voice` project, `voice-journey-responsive.spec.ts` in `voice-responsive` (same matrix and same audit, from `e2e/voice-audit.ts`, plus a self-test that breaks a journey stage on purpose), and `voice-visual.spec.ts` has two more tests (13 states × 4 projects). Unit tests: `src/hooks/useVoiceFlow.test.tsx` (reducer: every new transition, restore into each server stage, loss of the confirmation; hook: against a fake `JourneyService`), `src/components/voice/journey/*.test.tsx` (carousel keyboard / buttons / swipe; every stage component with the contract examples as fixtures), `src/components/voice/VoiceFlow.journey.test.tsx` (the stages wired into `VoiceFlow` with fake services).

Two things to know before running them:

- **Every build into `.next-voice` rewrites `tsconfig.json`** (Next adds `.next-voice/types/**/*.ts` to `include` and reformats the file). Until that line is committed (see the lead's report), restore the file after a run.
- Test output goes to `.next-voice-results/` (already git- and ESLint-ignored), not `test-results/`: the classic suite wipes `test-results/` when it starts, which broke a voice run in progress.

The screenshot comparison uses `threshold: 0.03` instead of Playwright's default 0.2. Reason, measured here: at 0.2 a white card and the near-white page background are "the same colour", so a row that grew by 240 px passed against its old baseline. The classic `playwright.config.ts` still uses the default and has the same blind spot.

## 11. After confirmation: the simulated journey

Specification: `docs/PLANNER_CONTRACT.md`. Data layer (the lead's, used as written): `useJourney`, `JourneyService`, `types/journey.ts`. Everything shown is the server's `Journey` / `TravelFile`; the client plans, ranks, filters and judges nothing.

### Stages

`StageId` gains `JourneyStageId = JourneyStage | "travel_file" | "feedback"`: the nine stages of the server, plus two local views of a confirmed booking.

| Stage | Shows | Primary action | Other actions |
|---|---|---|---|
| `done` (extended) | as before | « Rechercher des propositions », in the dock — only when `config.planner_mode` is `simulated` or `http` | « Modifier », « Nouvelle sortie »; in `simulated` mode a closed « Scénario de test » control (search: auto / adjustments / no result / error; booking: confirmed / refused / error) |
| `destinations` | ONE destination: title, why it fits, travel time, arrival station, places with walking time and note, activities as toggles with duration | « Choisir cette destination » | « Modifier ma demande »; « Retour » when the teacher came back here from a later stage |
| `itineraries` | ONE itinerary: label, timeline (outbound leg, timed activities, return leg), free time, participants, the server's checks | « Choisir cet itinéraire » | « Autre destination », « Modifier ma demande » |
| `adjustments` | the server's reason (once), every adjustment as a single-choice option: the server's `label`, before → after for time changes, « → n itinéraire(s) possible(s) »; the sentence that nothing changes without acceptance | « Accepter cet ajustement », enabled by a selection | « Autre destination », « Modifier ma demande » |
| `no_match` | a calm stage: the server's line; no alert, no retry | « Autre destination » (« Modifier ma demande » when the server proposed no destination) | « Modifier ma demande » |
| `review` | the chosen itinerary in full, « Rien n'est encore réservé… », the accepted adjustments with before → after | « Envoyer la demande » | « Autre itinéraire », « Autre destination », « Modifier ma demande » |
| `booking_pending` | the think-stage language (two steps with their state in words), the reference | « Vérifier la réponse » | none: the server no longer accepts a change |
| `booked` | success, the server's booking message, the reference | « Voir le dossier de voyage » | « Donner mon avis » |
| `travel_file` (local) | title, reference, date, timetable, places, safety advice, contacts, links as text | « Imprimer » (`window.print()`) | « Retour », « Donner mon avis » |
| `booking_refused` | the server's refusal message, « Rien n'a été réservé. », the alternatives one at a time | « Choisir cet itinéraire » | « Autre destination », « Modifier ma demande » |
| `feedback` (local) | rating 1–5 (native radios behind large targets), optional comment (1000 characters, the contract's limit) | « Envoyer mon avis », enabled by a rating | « Retour » |
| `closed` | thanks, the feedback as recorded | « Nouvelle sortie » | « Revoir le dossier de voyage » |

Every journey stage starts with `JourneyIntro`: the `h1` (focused on entry), the server's `journey.message` — only when the screen shows the stage the server is on —, and `journey.notices` verbatim (the simulation label). No sentence about simulation is written in the client; a unit test renders a different notice and checks that only it appears.

### State machine

- `journeyStage` mirrors `journey.stage` (event `JOURNEY_STATE`, dispatched for every new `Journey` object). **Every answer of the server puts the teacher on the server's stage**; `stage` differs from `journeyStage` only for what the server has no notion of:
  - `DESTINATIONS_REQUESTED` (from any stage in which the server still accepts another destination: `destinations`, `itineraries`, `adjustments`, `no_match`, `review`, `booking_refused` — the API's `_OPEN_STAGES`), `ITINERARIES_REQUESTED` (from `review`), `JOURNEY_VIEW_CLOSED` (back to the server's stage, nothing chosen);
  - `TRAVEL_FILE_OPENED` (`booked`, `closed`), `FEEDBACK_OPENED` (`booked`).
- Which destination or itinerary card is looked at, the ticked activities, the selected adjustment, the rating and the comment are component state of their stage: they are not transitions. The cards open on the server's current choice.
- « Modifier ma demande » = `MODIFY_REQUESTED`: the sheet of the confirmed request (`reviewing`), with « Revenir aux propositions ». Looking changes nothing. **An edit (typed editor, corrected text or speech — the sheet's existing pipeline) makes the server clear the confirmation and drop the journey**: `SERVER_STATE` not confirmed → `sheet`, `searchRestart` (the notice « Votre demande a changé : la recherche de propositions reprendra après la confirmation de la fiche. »), `useJourney` drops its journey (`enabled` false), `JOURNEY_STATE null` clears `journeyStage`. A journey stage without a journey renders a loading line, never a stale card.
- An accepted time adjustment changes the requirements and keeps them confirmed: `useJourney` calls `onRequirementsChanged` = `useConversation.refresh`, and `SERVER_STATE` (confirmed) leaves a journey stage where it is.
- The talk button is **not** shown on journey stages (decision): a spoken change goes through the sheet, where it already exists and is routed through the message pipeline. No speech is interpreted on the client.
- `booking_pending`: one automatic `checkBooking` 2.5 s (`BOOKING_AUTO_CHECK_MS`) after the stage is entered, per booking reference; no polling. A reload on that stage checks once again.

### Errors

`useJourney.error` (the server's French `detail`, `code`, `retry`) is shown as an `role="alert"` block titled « Erreur technique » at the top of the stage it happened on (`done` for the search), with « Réessayer » when the hook offers a retry. It is never a stage and never looks like `no_match` (a calm stage with a heading, no alert, no retry). The block shows the server's sentence as received; the client's own sentence is used only when there is none (network down). The error is dismissed when the teacher leaves the stage.

### Layout

- The actions of a journey stage are rendered **into the dock** by `StageActions` (a portal into a slot of `VoiceFlow`), outside the scrolling stage: the primary action is reachable at every size without scrolling. Order: secondary actions, then the one primary action (last, right; full row on narrow shells; bottom of the column in the `low` tier).
- `tiny` tier (< 17rem: 200 % text on a phone): two or more secondary actions fold behind one « Autres choix » button, so the stage keeps at least 40 % of the height (asserted). One tap shows them; nothing is removed. Action buttons are 44 px high **in px**, not rem: with large text a one-line action stays one line high.
- Carousel: buttons (44 px, labelled, disabled at the ends — no wrap-around), ← / → / Home / End from anywhere on the stage except fields and radio groups (a `window` listener: the keys work right after entry, when focus is on the heading), horizontal swipe by touch or pen (`touch-action: pan-y`, so a vertical movement still scrolls the stage). Position as marks (a bar and hollow dots) and as text « 2 sur 4 » in a polite live region. Card change: 220 ms slide-and-fade from the side it was asked from; a 120 ms cross-fade under reduced motion.
- Print (`@media print` in `voice.module.css`): top bar, dock and banners are hidden, the shell stops being a size container and takes the height of the file, sections avoid page breaks. The simulation label is printed with the file.

### Accessibility of the journey stages

- One `h1` per stage, focused on entry (also when a local view opens or closes); stage changes announced by the polite live region (`frVoice.announce`, one sentence per stage).
- Activities are `aria-pressed` toggle buttons named « title, duration », described by their description. Adjustments and ratings are native radio groups in a `fieldset` with a `legend`: Tab reaches the group, arrows move the selection, and neither selects anything on the server. The native control covers the whole option (one large touch target); the mark beside it shows the state by shape.
- A disabled primary action says why through `aria-describedby` (« Rien n'est modifié tant que… », « Choisissez d'abord une note. »).
- State never by colour alone: chosen activity = filled tick vs empty plus; selected option = filled radio mark and a border; feasibility check = tick or cross icon plus « Vérifié » / « Non respecté » for assistive technology (a failed check also says so in visible words); carousel position = bar vs dots plus text.
- Arrows in times are doubled in words for assistive technology (« Départ … , Arrivée … », « 17 h 30 au lieu de 17 h 00 »).
- Server text (titles, notes, messages, links of the travel file) is rendered as React text nodes; a link is shown as text and never becomes an `href` (unit tests feed markup and a `javascript:` URL).

Contrast, measured in the browser from computed styles (e2e `measured contrast of the journey stages`, asserted ≥ 4.5):

| Pair | Ratio |
|---|---|
| heading, server message, reason on background | 17.29 |
| simulation label on its strip | 16.55 |
| card title, text, times, check labels, timetable lines on card | 18.09 |
| muted text on card (section titles, place notes, train line, hints) | 7.09 |
| muted text on background (keyboard hint, step state, feedback hint) | 6.77 |
| accent chips and selected options (travel time, free time, chosen activity, selected adjustment) | 11.09 |
| « Rien n'est encore réservé », consent sentence (accent-tinted block) | 16.20 |
| reference on the success surface | 16.47 |
| primary action in the dock, at rest / hovered | 7.73 / 5.45 |
| chosen rating (on the accent colour) | 7.73 |
| secondary action in the dock | 18.09 |
| « Scénario de test » toggle (muted) | 6.58 |

Measuring note: under reduced motion the global rule gives every property a 0.01 ms transition, so a style read in the very frame of a change still returns the previous colours; the spec waits a frame before each measurement.

### Decisions worth knowing

- `done` keeps « Modifier » and « Nouvelle sortie » in the stage; « Nouvelle sortie » becomes an outline button when the search is offered (one primary action).
- Until the lookup of an existing journey has answered (`useJourney.status`), the search button is disabled; a reload on a journey stage shows `done` for that instant, then the server's stage.
- The simulation label is small type (12 px) at the top of every journey stage, not large type: it is a caution, shown before the data it qualifies. It is still two sentences long on a 320 px phone.
- In `http` mode the search is offered and the server's answer (`501 PLANNER_NOT_CONNECTED`, with its French detail) is shown as a technical error.

## 12. Not verified

Journey after confirmation (§11):

- **Real mode.** The journey stages ran against the demo journey service (a scripted port of the API's simulation) and against fake services in unit tests. Nothing ran against the FastAPI service: `PLANNER_MODE=simulated` over HTTP, the `501 PLANNER_NOT_CONNECTED` answer of `http` mode, and the refresh of the conversation after an accepted adjustment are covered by fakes only.
- **Printing.** `window.print()` is called (asserted) and the print rules were checked under emulated print media (chrome hidden, file and simulation label visible, shell not clipping). No page was printed or saved as PDF; page breaks and margins on paper were not looked at.
- **Swipe.** Synthetic touch points through the DevTools protocol at 390×844; no finger, no inertia, no real browser gesture competing for the horizontal movement (iOS back-swipe from the edge in particular).
- **Real devices, other browsers, screen readers.** None available: same limits as below.
- **More content than the simulation sends.** Fixtures have at most four destinations, three itineraries and six adjustments; long titles and many cards (the position marks wrap) were not exercised.
- **`docs/HANDOFF.md` and `docs/DESIGN.md`** were not updated from this task (owned by another agent during the work): this file is the record.

- **Real mode.** Nothing here ran against the FastAPI service or a model. The request sequence, error mapping and retry semantics are covered with a fake service and the mock only. Latency of the two chained calls is not measured.
- **Real devices and other browsers.** No phone, no iOS Safari, no Android Chrome, no Firefox, no desktop Safari. In particular, untested: `audio/mp4` recordings from Safari, the `AudioContext` unlock on iOS, the long-press callout on iOS, the page being suspended on screen lock, haptics (`navigator.vibrate` does nothing in headless Chromium; iOS has no such API).
- **A real microphone and a real voice.** The fake device is a beep: the shape was seen reacting to it, not to speech. Smoothing constants and the ripple threshold were chosen by reasoning, not tuned by ear.
- **60 fps on a phone.** Not measured. The drawing is three 72-point paths, a few arcs and no allocation per frame, which should be cheap; that is an expectation, not a measurement.
- **Safe-area insets.** `env(safe-area-inset-*)` is applied to the top bar, the stage gutters and the dock, and cannot be emulated in this setup.
- **On-screen keyboard.** `useKeyboardInset` is wired; no real keyboard was shown.
- **Real permission prompt.** Denial is simulated by making `getUserMedia` reject with `NotAllowedError`.
- **No microphone in real mode** (talk button replaced by the text field): reducer-tested; in demo mode the page records without audio instead, so no e2e reaches it.
- **Screen readers.** Roles, names and live regions were checked through the accessibility tree in tests, not with VoiceOver / NVDA / TalkBack.
- **Linux.** The functional and responsive specs are written to be portable but were only run on macOS. Baselines exist for `darwin` only.
- **`./scripts/demo.sh`** was not run: it starts `pnpm dev` on port 3000, which was in use by another agent. The equivalent demo build was served on port 3200.
- **Test flakiness under load.** Two runs failed once each while another agent's builds were running on the machine, and passed on every rerun. One was a tap whose press and release were apparently more than 250 ms apart, so the page read a too-short hold; that is an inference from the failure snapshot, not a confirmed cause. The tap helper in the specs now retries in that case. The cause of the other failure (first run of the voice path) was not identified.
