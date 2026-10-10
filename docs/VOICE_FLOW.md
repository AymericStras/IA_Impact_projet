# Voice flow — a staged, voice-first experience (development plan)

Status: **plan, not implemented**. Owner request of 2026-10-10: a second frontend that is not a chat box — a sequence of full-screen stages, each doing one thing, built around press-and-hold speaking. The classic chat (`/`) stays as it is and remains the tested, deployable default until the owner chooses.

## 1. Product intent

A teacher opens the page, sees one question, holds a button and talks. The screen comes alive while they speak. On release, the whole screen becomes the trip sheet: four fields, filled with what was understood, the missing ones asking to be completed — by touch, keyboard or by holding and talking again. One explicit confirmation ends the flow.

Same product scope, same backend, same contract: four fields, code owns state, only an explicit action confirms. Nothing about trains, destinations or booking.

## 2. Stages

Each stage is a full-screen view with one primary action. Transitions are the only animation between them.

| # | Stage (id) | The one thing it does | Primary action | Leaves to |
|---|---|---|---|---|
| 1 | `ask` — Question | Shows one question in large type, plus one line of example | Hold the talk button (or tap to toggle, or Space) | `listen`; or `sheet` via « Écrire à la place » |
| 2 | `listen` — Écoute | Records; the screen reacts to the voice | Release (or tap again) to finish; slide away / Échap to cancel | `think`; back to `ask` on cancel |
| 3 | `think` — Analyse | Shows that the recording is being transcribed then understood (two labelled steps) | none (cancellable only by error) | `sheet`; back to `ask` on error with the reason |
| 4 | `sheet` — Fiche | The four fields as one form: understood values filled, missing/unclear ones highlighted with the server's question | Complete or correct a field by typing, or hold the talk button to say it; then « Confirmer » | `listen` (scoped), `think`, `done` |
| 5 | `done` — Confirmé | Confirms the hand-over; shows the summary and the JSON on demand | « Modifier » (back to `sheet`), « Nouvelle sortie » | `sheet`, `ask` |

### Stage details

**`ask`.** Question from the server state, not hard-coded: the welcome question when nothing is known; otherwise the server's current `assistant_message` (e.g. « À quelle heure souhaitez-vous être de retour le jeudi 12 novembre ? »). A returning visitor with a stored conversation lands directly on `sheet`. Progress is shown as four small dots (filled = known), no numbers to read. A discreet link switches to the classic chat.

**`listen`.** Full-bleed accent surface. A voice-reactive shape (canvas, driven by a Web Audio `AnalyserNode` on the same `MediaStream` that feeds `MediaRecorder`) breathes with the input level; a timer; the hint « Relâchez pour terminer ». Light haptic tick on start/stop where `navigator.vibrate` exists. Auto-stop at the server's `max_audio_seconds` with a visible countdown for the last 10 s. Recordings shorter than ~0.6 s are discarded with « Maintenez le bouton pendant que vous parlez ».

**`think`.** Two-step progress with real state: « Transcription… » (audio upload → transcript) then « Compréhension… » (transcript → extraction). The transcript appears as soon as it exists (« Vous avez dit : … ») so the teacher sees what was heard before the sheet arrives. Typical total 4–6 s.

**`sheet`.** Four large rows — Participants, Départ, Retour, Matière ou thème. Each row: state (known / à préciser / à clarifier), the value in words (« jeudi 12 novembre, vers 8 h 00 »), and tap-to-edit with the same typed editors as the classic panel. The row the server is asking about is expanded and carries the server's question. A collapsible « Vous avez dit » shows the last transcript with « Corriger le texte » (edits the transcript and re-sends it as text — the escape hatch for recognition errors). A persistent talk button at the bottom: holding it here means "complete or correct" (« Dites ce qui manque ou ce qu'il faut corriger »). « Confirmer » is enabled only when the server says `ready_for_confirmation`; otherwise it states what is missing.

**`done`.** Success state, the four values, « Voir le JSON transmis » (collapsed), « Modifier » and « Nouvelle sortie ».

## 3. Interaction rules

- **Hold or tap.** Pointer down for ≥ 250 ms = hold-to-talk (release ends). A shorter press = toggle (tap to start, tap to stop). Keyboard: Space/Enter toggles; Échap cancels. Both models are always available; hold is never the only way (accessibility, tremor, desktop mouse).
- **Cancel.** While holding, dragging the pointer out of the button's cancel radius shows « Relâchez pour annuler »; release there discards. Nothing is uploaded on cancel.
- **Pointer handling.** `setPointerCapture`, `touch-action: none` on the button, `user-select: none`, context menu suppressed on long-press, `pointercancel` and `visibilitychange` treated as cancel-with-notice. The microphone stream is requested on first use (inside the gesture) and its tracks are stopped at every exit path.
- **Permission.** First use shows the browser prompt; denial explains how to allow it and offers « Écrire à la place ». No microphone / unsupported browser → the talk button is replaced by the text entry.
- **Text is a first-class path.** « Écrire à la place » opens a single text field on `ask` (one message → `think` → `sheet`); on `sheet` every field is directly editable. The flow is fully usable without a microphone.
- **Reduced motion.** With `prefers-reduced-motion`, the voice shape becomes a static level meter and stage changes cross-fade without movement.
- **Nothing is confirmed by voice alone.** Saying « oui, je confirme » on `sheet` follows the server's rule (accepted only when awaiting confirmation and nothing changed); the button remains the primary path.

## 4. Decisions (owner can overrule)

| # | Decision | Why |
|---|---|---|
| D1 | Route `/vocal`; the classic chat stays at `/` and stays the default for tests and deployment. A link in each top bar switches between them; both share the same conversation. | Nothing already verified is disturbed; the owner can flip the default later with a one-line change. |
| D2 | After release, the transcript is sent for extraction **automatically** (no manual "review the transcript, then send" step). | That step is exactly what this flow removes. The sheet is the review: nothing is confirmed without the explicit button, the transcript stays visible and correctable. Supersedes ADR-005 for this route only. |
| D3 | No backend change. `think` chains the two existing calls (`POST /audio` → transcript, `POST /messages` with `source: "audio"`). | Keeps one dialogue pipeline and one contract; evidence check and all guards apply unchanged. |
| D4 | The visual language reuses the frozen tokens of `docs/DESIGN.md` (colours, type, radii); the flow adds motion and scale, not a new palette. Motion tokens for this route are added to DESIGN.md. | One product, two experiences; keeps the guardrails meaningful. |
| D5 | The voice shape is drawn on a 2D canvas from the analyser's RMS/frequency data. No WebGL, no new runtime dependency. | Works on every target browser, cheap on phones, easy to make deterministic in tests. |
| D6 | No spoken (TTS) questions in this version. | Not requested; adds latency, cost and an audio-focus problem while recording. Listed as a follow-up. |

## 5. Architecture

Everything new lives in new files; the classic UI is not modified except for one link in its top bar (added at integration time).

```
apps/web/src/
  app/vocal/page.tsx                    route (client component shell)
  components/voice/
    VoiceFlow.tsx                       stage router + transitions (Motion)
    stages/AskStage.tsx  ListenStage.tsx  ThinkStage.tsx  SheetStage.tsx  DoneStage.tsx
    TalkButton.tsx                      hold/tap/keyboard gesture, cancel radius, a11y
    VoiceShape.tsx                      canvas visualiser (analyser → shape), reduced-motion meter
    SheetRow.tsx                        one field row; reuses the classic field editors
    TranscriptNote.tsx                  « Vous avez dit » + correct-and-resend
    ProgressDots.tsx  StageFrame.tsx    shared chrome (top bar, safe areas)
  hooks/
    useVoiceFlow.ts                     stage machine (pure reducer + effects)
    useHoldToTalk.ts                    pointer/keyboard gesture → start / stop / cancel
    useAudioCapture.ts                  getUserMedia, MediaRecorder, AnalyserNode, level stream, cleanup
  i18n/fr.voice.ts                      all French copy of this route
```

- **State.** `useVoiceFlow` composes the existing `useConversation` (server state, send, transcribe, editField, confirm, retry, error kinds). The stage is derived as much as possible from server state: `CONFIRMED` → `done`; stored conversation with any known field → `sheet`; otherwise `ask`. `listen` and `think` are local transient stages. The reducer is a pure function with exhaustive tests.
- **No client-side field logic.** Which row is highlighted, what is missing, whether confirmation is possible: all read from `ConversationResponse` (`missing_fields`, `pending_clarification`, `assistant_message`, `ready_for_confirmation`).
- **Errors.** Same `ErrorKind` mapping as the classic UI. In `think`: audio errors → back to `ask`/`sheet` with « Réessayer l'enregistrement »; provider errors → retry the same request (same `client_message_id`) from the `think` screen; conflicts → refetch and land on `sheet` with a notice. The recording blob is kept until its request has succeeded so a retry does not ask the teacher to speak again.
- **Demo mode.** The mock service already implements the same interface; `listen` works with a real microphone when available and with a synthetic level curve otherwise, so the demo runs without a mic.

## 6. Responsiveness and accessibility (acceptance, not aspiration)

Same matrix as the classic UI (`docs/DESIGN.md`): 320×568 → 1920×1080, phone landscape, tablets, root font 200 %. Per stage: no horizontal scroll, nothing clipped, the talk button fully visible and ≥ 72 px (≥ 64 px in short landscape), the sheet scrolls inside the stage while « Confirmer » and the talk button stay reachable, safe-area insets respected, `100dvh` shell, inputs ≥ 16 px on touch.

Accessibility: every stage has a heading that receives focus on entry; stage changes are announced (`aria-live`); the talk button is a real `<button>` with `aria-pressed` and a text label; recording state is conveyed by text and timer, not only motion or colour; contrast ≥ 4.5:1 on the accent surface; the whole flow is operable by keyboard and without a microphone; reduced motion honoured.

## 7. Tests

| Level | What |
|---|---|
| Unit (Vitest) | `useVoiceFlow` reducer: every transition incl. cancel, short press, errors, restore; `useHoldToTalk`: hold vs tap threshold, cancel radius, keyboard, `pointercancel`; `useAudioCapture` with mocked `MediaRecorder`/`AudioContext`: tracks stopped on every exit, auto-stop; `SheetRow` highlighting from server state; no HTML rendering of transcript text |
| E2E functional (Playwright, demo mode, runs on Linux) | voice path with Chromium's fake microphone: ask → hold → release → think → sheet → complete a missing field by voice → confirm → done → JSON; text-only path; cancel; permission denied; too-short press; error then retry without re-recording |
| E2E responsive (no screenshots) | the per-stage assertions of §6 across the viewport matrix |
| Visual baselines (macOS) | each stage at desktop, tablet, phone portrait, phone landscape; canvas frozen to a fixed level |
| Real mode (manual run, recorded in HANDOFF) | live model + fake microphone fed with synthesized French speech through `/vocal`, directly and behind the gateway simulation |

## 8. Delivery steps

1. **Skeleton** — route, `StageFrame`, `useVoiceFlow` reducer with tests, stages rendered from mocked state.
2. **Capture** — `useAudioCapture`, `useHoldToTalk`, `TalkButton`, `VoiceShape`; unit tests; works in demo mode.
3. **Pipeline** — `think` chaining transcript → extraction with retry semantics; `TranscriptNote`.
4. **Sheet** — rows, editors reuse, scoped voice completion, confirmation; `done`.
5. **Polish** — transitions, haptics, reduced motion, copy; responsive pass on the full matrix.
6. **Guardrails** — functional + responsive specs, visual baselines, `docs/DESIGN.md` section (stages, motion tokens, gesture rules), `apps/web/AGENTS.md`, HANDOFF.
7. **Integration (lead)** — cross-links between `/` and `/vocal`, CI job for the portable e2e specs, real-mode verification, commit and push.

Stitch produces reference screens for the five stages (desktop and mobile) in the existing Stitch project, for the owner to look at; nothing from Stitch is applied without the owner's choice.

## 9. Risks and what is not covered

- **Real devices are not available.** iOS Safari is the riskiest target: `MediaRecorder` produces `audio/mp4`, the audio context must be resumed inside the gesture, long-press triggers callouts, and the page may be suspended on screen lock. The code handles these by design, but it is verified only in desktop Chromium/WebKit emulation until someone tests on a phone.
- **Latency.** Two sequential model calls after release (about 3 s + 2 s measured locally). `think` shows real progress and the transcript early; a combined endpoint is a possible later optimisation, not part of this plan.
- **Hold-to-talk fatigue** for long descriptions: tap-to-toggle covers it; the hint mentions it after a 20 s hold.
- **Noise and accents** are untested (synthetic speech only so far).
- **Not included:** spoken questions (TTS), streaming transcription while speaking, wake word, offline mode.

## 10. Definition of done

The owner can open `/vocal` on a laptop and a phone-sized viewport, hold to speak a full request, release, see the sheet filled, complete a missing field by voice or touch, confirm, and get the same JSON as the classic flow; the classic chat at `/` is unchanged and all its tests still pass; unit, e2e functional and responsive suites are green locally and the portable ones in CI; the real-mode run is recorded in `docs/HANDOFF.md` with what was and was not verified.
