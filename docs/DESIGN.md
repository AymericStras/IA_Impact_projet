# Design system — frozen (apps/web)

This document describes the chatbot UI **as implemented** and is the reference for any future change. The design is frozen: the goal of later work is to keep it working, not to restyle it. If something here and the code disagree, the code plus the screenshot baselines (`apps/web/e2e/__screenshots__/`) are the truth — fix this file.

Before any UI change: read this file, then `apps/web/AGENTS.md`. After any UI change: `pnpm test:e2e` and look at every screenshot diff. The responsive guardrail (§13) must pass at every size of its matrix.

## 1. Principles

- Calm French public-service look: light background, white surfaces, one deep blue-teal accent, thin borders, no decoration.
- The interface renders **server state only** (`ConversationResponse`). It never computes missing fields, totals, readiness or validation.
- Every state is conveyed by **icon + text**, never by colour alone.
- All user-facing text is French and lives in `apps/web/src/i18n/fr.ts`. Assistant messages come from the server and are displayed verbatim as plain text.

## 2. Colour tokens

Defined once as CSS variables in `apps/web/src/app/globals.css` (`:root`) and exposed to Tailwind through `@theme inline`. Components use the semantic Tailwind classes (`bg-primary`, `text-muted-foreground`…), never raw colour values. There is **no dark theme**.

| Token | Value (OKLCH) | ≈ sRGB | Usage |
|---|---|---|---|
| `--background` | `0.985 0.003 240` | `#f8fafc` | Page background |
| `--foreground` | `0.2 0.02 245` | `#0e171f` | Body text |
| `--card` / `--popover` | `1 0 0` | `#ffffff` | Assistant bubble, panel fields, composer, dialog |
| `--primary` | `0.42 0.1 222` | `#005874` | Brand accent: primary buttons, user bubble, progress bar, "Modifier" links |
| `--primary-foreground` | `0.99 0 0` | `#fcfcfc` | Text on primary |
| `--user-bubble` / `-foreground` | same as primary | | User message bubble (separate token on purpose) |
| `--secondary` / `-foreground` | `0.955 0.008 235` / `0.28 0.03 235` | `#ebf1f5` / `#1a2b36` | shadcn secondary variant (rare) |
| `--muted` | `0.96 0.006 240` | `#eef2f5` | State pill, progress track, example block, skeletons |
| `--muted-foreground` | `0.46 0.02 240` | `#4e5a62` | Secondary text, hints, timestamps, "À préciser" |
| `--accent` / `-foreground` | `0.94 0.025 215` / `0.3 0.07 222` | `#d9f0f6` / `#003547` | Confirmation card tint, notice, help numbers, highlighted JSON lines |
| `--success` / `-foreground` | `0.47 0.12 152` / `0.99 0 0` | `#0a6d37` | Known-field check, confirmed card icon and border |
| `--success-soft` | `0.95 0.035 152` | `#def6e3` | Confirmed card background, "Mis à jour" tick |
| `--warning` | `0.6 0.13 70` | `#b17000` | **Icons and borders only** (demo badge, pending clarification) |
| `--destructive` / `-foreground` | `0.5 0.19 27` / `0.99 0 0` | `#b7191c` | Error title, error border, recording dot |
| `--border` | `0.9 0.01 240` | `#d8dfe4` | Decorative separators and card outlines |
| `--input` | `0.62 0.015 240` | `#7e888e` | Boundary of editable fields (inputs, select, composer) |
| `--ring` | `0.45 0.1 222` | `#00607d` | Focus indicator |

Measured contrast (WCAG 2.x, computed from the token values):

| Pair | Ratio |
|---|---|
| foreground on background / card | 17.3 / 18.1 |
| muted-foreground on background / card / muted | 6.8 / 7.1 / 6.3 |
| primary-foreground on primary (buttons, user bubble) | 7.7 |
| primary on background / card (link-style buttons) | 7.6 / 8.0 |
| accent-foreground on accent | 11.1 |
| destructive on background (error title) | 6.4 |
| success on card / success-soft | 6.5 / 5.6 |
| foreground on tinted surfaces (accent/40, success-soft/60, destructive/5, warning/10) | ≥ 16 |
| ring on background / card (focus indicator, needs ≥ 3) | 6.8 / 7.0 |
| warning on card (icon only, needs ≥ 3) | 4.1 |
| input on card / background (field boundary, needs ≥ 3) | 3.6 / 3.5 |

Rules: text must reach 4.5:1. `--warning` is **not** a text colour (4.1:1). `--border` is decorative only; anything the user must perceive as a control boundary uses `--input`.

## 3. Typography

- Font: **Geist** (sans) and **Geist Mono**, self-hosted by `next/font/google` in `src/app/layout.tsx`. No other font.
- `<html lang="fr">`, antialiased.

| Role | Classes | Size |
|---|---|---|
| Brand "liO" | `text-base font-semibold tracking-tight text-primary` | 16 px |
| Page title (`h1`, shown from the `titled` tier, 40rem) | `text-sm roomy:text-base font-medium` | 14 / 16 px |
| Message bubble | `text-[0.95rem] leading-relaxed` | 15.2 px |
| Panel/card/section titles (`h2`, `h3`) | `text-sm font-semibold` / `font-medium` | 14 px |
| Field value, body of cards, buttons | `text-sm` | 14 px |
| Hints, descriptions, progress text | `text-xs text-muted-foreground` | 12 px |
| Timestamps, composer hint, counter, state pill | `text-[0.7rem]` | 11.2 px |
| "Mis à jour" tick | `text-[0.65rem] font-medium` | 10.4 px |
| JSON block | `font-mono text-xs leading-relaxed` | 12 px |
| Inputs | `text-base` below `md`, `text-sm` from `md`; never under 16 px on coarse pointers (`font-size: max(1rem, 16px)` in `globals.css`, prevents the iOS focus zoom) | 16 / 14 px |

Times are written « 8 h 00 » with non-breaking spaces in the panel; dates with `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' })` (year added only when it is not the current one). Helpers: `src/lib/format.ts`.

## 4. Shape, spacing, elevation

- Radius token `--radius: 0.75rem`. In use: `rounded-lg` (buttons, inputs), `rounded-xl` (field cards, notices, errors, recorder, dialog), `rounded-2xl` (bubbles, panel, composer, confirmation cards), `rounded-full` (pills, status dots, "Revenir en bas"). Bubbles have one tightened corner: `rounded-bl-md` (assistant) / `rounded-br-md` (user).
- Spacing follows the Tailwind 4 px scale. Page gutter `px-safe` (1rem, or the left/right safe-area inset when larger); content width `max-w-7xl` (80rem = 1280 px, centred on wider screens); column gap `gap-4` (`gap-6` from the `roomy` tier); thread `gap-3` between bubbles and `gap-4` around the footer; cards `p-3` / `p-4`; top bar `min-h-14` (`min-h-11` in compact mode).
- **No shadows.** Elevation is expressed with a 1 px border or `ring-1 ring-foreground/10`. No gradients, no illustrations, no background images.
- Icons: `lucide-react` only, 16 px (`size-4`) by default, always `aria-hidden` next to a text label or with an `aria-label` on the control.

## 5. Layout and breakpoints

The page is a viewport-high shell (`.app-shell` in `globals.css`): top bar, then `main`. Only the thread scrolls (plus the panel column in two-column layouts when it is taller than the viewport). The composer is a normal flex item under the thread — it is **not** `fixed`/`sticky` and therefore can never cover a message or a card. The conversation area never goes below 8rem: if the shell cannot hold its minimum content (extreme zoom, very large text) the shell scrolls vertically **as a whole** instead of squeezing the thread to nothing. Horizontal scrolling never happens, except inside the JSON block (`data-scroll-x`).

### 5.1 Tiers (width and height)

Breakpoints are **container queries on the app shell, in rem**, declared once as Tailwind variants in `globals.css`. They follow the space that is really available: a narrow window, a short window, browser zoom and a larger text size all land in the same tiers. Do not add `sm:`/`md:`/`lg:` width media queries or px breakpoints next to them. The px values below are for the default 16 px text size.

| Variant | Condition on the shell | Effect |
|---|---|---|
| `narrow` | width < 22.5rem (360 px) | Top bar « Aide » and the panel toggle become icon-only (the label stays as accessible name); tighter panel paddings; recorder buttons lose their decorative icons |
| `single` | width < 48rem (768 px) | One column: top bar → "Votre projet" summary bar → thread → composer |
| `titled` | width ≥ 40rem (640 px) | Page title shown next to the brand |
| `wide` | width ≥ 48rem (768 px) | Two columns `minmax(0,1fr) 17.5rem`: conversation left, panel right, always expanded |
| `roomy` | width ≥ 64rem (1024 px) | Panel column `22rem`, column gap `gap-6`, title 16 px |
| `spacious` | width ≥ 80rem (1280 px) | Panel column `24rem`; beyond 1280 px the content stays centred at `max-w-7xl` |
| `tall` | height > 32.5rem (520 px) | Normal chrome |
| `short` | height ≤ 32.5rem (520 px) | **Compact mode**, see 5.2 |
| `low` | `short` and width ≥ 30rem (phone landscape) | « Revenir en bas » is an icon-only button in a reserved right gutter of the thread |
| `mouse` | media `(hover: hover) and (pointer: fine)` | The keyboard hint under the composer is shown (and only when `tall`) |

Component-level container queries complete the tiers: the panel (`@container/panel`) puts the editor's date and time side by side from 21.5rem, shows the state pill from 19rem and makes « Modifier » icon-only below 19rem (tablet column, 320 px phones, large text); the confirmation card (`@container/card`) puts its two buttons side by side from 19.5rem and stacks them full-width below; bubbles are 85 % wide, 75 % when the thread is at least 42rem wide.

| Viewport (default text size) | Result |
|---|---|
| 320×568, 360×640, 390×844, 430×932 | Single column, `tall`. At 320 the `narrow` rules apply |
| 568×320, 667×375 | Single column, compact mode |
| 844×390 | Two columns (844 ≥ 768), compact mode |
| 768×1024, 820×1180 | Two columns, 17.5rem panel |
| 1024×768 | Two columns, 22rem panel |
| 1280×720, 1440×900 | Two columns, 24rem panel |
| 1920×1080 | Same, content centred at 1280 px |

### 5.2 Compact mode (short viewports)

Driven by the **height** of the shell (`short`), whatever the width: slimmer top bar (`min-h-11`, 28 px logo), the "Votre projet" summary on one line with a chevron-only toggle, one-row composer with reduced paddings (`max-h-20`), keyboard hint hidden, tighter thread and card paddings, one-row recorder, transcript preview without its hint and with a shorter field. Nothing is removed: every control keeps its accessible name and its 44 px target on touch.

Measured conversation height (welcome state, Chromium emulation): 279 px = 71.5 % at 844×390, 204 px = 54.4 % at 667×375, 149 px = 46.6 % at 568×320. The guardrail requires ≥ 55 % at 844×390 and ≥ 45 % at 667×375 and 568×320, ≥ 35 % everywhere else.

### 5.3 "Votre projet" in a single column

Collapsed: a summary bar (title, « n / 5 informations », toggle). Expanded: the five rows open as a **layer over the conversation area** (`absolute`, capped to the height of the conversation area through `--thread-height`, scrolls internally). The layer never covers the composer and never changes the height of the thread, so expanding the panel does not move the conversation.

### 5.4 Large text and zoom

Because the tiers are in rem, a root font size of 200 % on a 390 px phone is laid out like a 195 px wide, 422 px high screen: `narrow` + `single` + `short`. Rules that make this hold:

- Rows wrap instead of overflowing: the top bar actions drop to a second line, the recorder's timer drops under its status text and its buttons under that, card and editor buttons wrap or stack.
- Text buttons use `FLUID_BUTTON` / `FLUID_BUTTON_SM` (`src/lib/ui.ts`): they grow and wrap their label instead of clipping it.
- Free text uses `WRAP_ANYWHERE`: a word longer than its line breaks rather than widening the page. The help dialog's grid column may shrink below its longest word for the same reason.
- The composer field keeps a usable width (`flex: 1 1 10rem`); when it cannot, its two buttons wrap to a second row. Its placeholder stays on one line: the short form « Votre message… » replaces « Écrivez votre message… » when the composer is narrower than 20rem.
- The transcript field grows with its text up to 7rem, then scrolls inside itself.
- At 400 % zoom of a 1280 px window (320 CSS px wide, 180–256 px high) the content reflows to one column and the shell scrolls vertically as a whole (WCAG 1.4.10).
- Zoom is never restricted: the viewport meta has no `maximum-scale` / `user-scalable`.

### 5.5 Mobile browser chrome, safe areas, on-screen keyboard

- Shell height: `100vh` fallback, `100dvh` where supported, so it follows the browser's collapsing toolbars.
- `viewport-fit=cover`: the page extends under notches and the shell pads itself — top bar `padding-top: env(safe-area-inset-top)`, gutters `max(1rem, env(safe-area-inset-left/right))` (`.px-safe`), composer `padding-bottom: max(0.75rem, env(safe-area-inset-bottom))`.
- Keyboard: `interactive-widget=resizes-content` asks the browser to resize the layout; where the keyboard overlays the page instead (iOS Safari), `useKeyboardInset` (`src/hooks/useViewportTracking.ts`) sets `--app-height` to the visual viewport height so the composer stays above the keyboard. Pinch-zoom is ignored by that hook.
- Inputs are never under 16 px on coarse pointers (no focus zoom on iOS).

### 5.6 Touch

On coarse pointers every interactive control is at least 44 × 44 CSS px (`TOUCH_TARGET` in `src/lib/ui.ts`, in px on purpose: a finger does not grow with the text size); inputs are at least 44 px high. Nothing is hover-only: tooltips repeat an accessible name, and the demo badge's tooltip text is also written in the help dialog.

### 5.7 Thread scrolling

`ConversationThread`: on each new message or footer change the thread follows the conversation. If the newest reply plus what follows it (e.g. confirmation card + JSON) is taller than the conversation area, the start of that reply is aligned to the top instead of jumping to the end. If the thread is not at its end, a « Revenir en bas » pill is offered; it sits on its own row under the list (in the `low` tier: icon-only in a right gutter), so it never covers message text. If the user has scrolled up, nothing moves; the user's own message always brings the thread back down. Scrolling is instant, never animated.

## 6. Motion

Library: `motion` (`motion/react`). Everything is short and functional.

| Element | Animation | Duration / easing |
|---|---|---|
| Message bubble enter | opacity 0→1, y 8→0 | 220 ms, `easeOut` |
| Confirmation / confirmed card enter | opacity 0→1, y 8→0 | 250 ms, `easeOut` |
| "Mis à jour" tick | opacity + scale 0.8→1, visible 2.2 s, fades out | 200 ms |
| Progress bar | width | 500 ms, `ease-out` (CSS) |
| Typing dots | `animate-bounce`, 140 ms stagger | 1 s loop |
| Recording dot | `animate-ping` halo | loop |
| Spinners | `animate-spin` | loop |

Reduced motion (`prefers-reduced-motion: reduce`): Motion durations become 0 and offsets are removed (`useReducedMotion`), CSS animations/transitions collapse to 0.01 ms (global rule in `globals.css`), looping animations stop (`motion-reduce:animate-none`). The e2e suite runs in this mode. Do not add parallax, auto-playing, bouncing or attention-seeking motion.

## 7. Components

All in `apps/web/src/components/chatbot/`, one component per file. Copy source for every string: `src/i18n/fr.ts` (key group in the last column). shadcn primitives (`src/components/ui/`, style "base-nova" on Base UI) are used as generated.

| Component | States | Copy (`fr.*`) |
|---|---|---|
| `ChatContainer` | loading (skeleton) · failed to start (error + « Réessayer ») · ready | `app`, `errors`, `loading` |
| `TopBar` | with/without demo badge; "Nouvelle conversation" disabled while a request is in flight | `app` |
| `DemoBadge` | demo mode only; tooltip « Réponses simulées, sans modèle d'IA » | `demo` |
| `HelpDialog` | closed · open (5 numbered items, example, privacy note, demo note in demo mode); never taller than the viewport, scrolls inside | `help` |
| `ConversationThread` | following · scrolled up (« Revenir en bas ») | `conversation` |
| `MessageBubble` | assistant · user · user pending (70 % opacity, « Envoi en cours… ») · user failed (destructive ring) · source labels « Message dicté » / « Modification depuis le panneau » | `conversation`, `composer` |
| `TypingIndicator` | shown while a message is being processed | `conversation.typing` |
| `MessageComposer` | idle · typing · disabled (request in flight) · near limit (counter) · at limit (« Limite de … caractères atteinte ») · recorder open | `composer` |
| `VoiceRecorder` | see §8 | `voice` |
| `AudioTranscriptionPreview` | editable transcript, « Réenregistrer » / « Envoyer »; demo notice | `transcription` |
| `RequirementsPanel` | five rows in the canonical order (participants, gare de départ, départ, retour, matière ou thème) · collapsed/expanded (single column) · progress « n / 5 informations », then « 5 / 5 informations · complet » · state pill (panel ≥ 19rem wide) | `panel`, `states` |
| `RequirementField` | known (green check + value) · missing (dashed circle + « À préciser ») · partial (server value with « heure à préciser ») · clarification pending (warning icon + « Une précision est attendue ») · just updated (« Mis à jour ») · editing · saving | `panel`, `fields`, `constraints`, `dateTime` |
| `ConfirmationCard` | hidden · ready (« Vérification avant transmission », « Modifier », « Confirmer et continuer ») · confirming · confirmed (« Projet confirmé » + JSON) | `confirmation` |
| `ConfirmedJsonBlock` | open/closed · copied · copy failed; `"constraint"` lines highlighted | `confirmation` |
| `ErrorMessage` | with retry · with restart · dismiss only | `errors` |
| `LoadingState` | skeleton bubbles | `loading` |

Component rules that must hold:

- **Composer**: Enter sends, Shift+Enter inserts a newline, Enter during an IME composition does nothing (`isSubmitEnter`). `maxLength` comes from `GET /config`; the counter appears from 90 % of the limit. Focus returns to the textarea after a send.
- **RequirementsPanel**: the progress count is `total − missing_fields.length`, nothing else is counted in the client.
- **RequirementField**: known/missing comes from `missing_fields`. The breakdown line (« 27 élèves et 3 accompagnateurs ») is shown only when the server's breakdown is complete and adds up to the server's total. The departure station is free text shown verbatim. Editors: number input · single-line station text (max 80 characters, trimmed, cannot be saved empty) · date + time + constraint select (« à / vers / à partir de / au plus tard à ») · matière + thème. Saving sends `PATCH /requirements` with `expected_version` of the latest response; on failure the editor stays open with the user's values.
- **ConfirmationCard**: appears only when `ready_for_confirmation` is true; the confirmed state only when `state === "CONFIRMED"` and `confirmed_requirements` is non-null. Its copy must not repeat the assistant's bubble.
- **Messages** are rendered as React text nodes with `whitespace-pre-wrap`. No HTML, no markdown, no link detection.

## 8. Voice recorder state machine

```
idle (mic button)
  └─ click ─▶ requesting ──(permission denied / no mic / unsupported)──▶ error
                 └─ granted ─▶ recording ──(« Annuler »)──▶ idle
                                  ├─ « Arrêter » or max duration (GET /config) ─▶ uploading
                                  └─ empty recording ─▶ error
uploading ──▶ preview (editable transcript) ── « Envoyer » ─▶ message sent with source "audio" ─▶ idle
    │              └─ « Réenregistrer » ─▶ requesting
    └─ failure ─▶ error
error: always « Réenregistrer » and « Écrire à la place »;
       « Réessayer la transcription » only when the same recording may succeed
       (provider/network failure) — never for AUDIO_* / EMPTY_TRANSCRIPT.
```

A recording larger than `max_audio_bytes` is rejected before upload. The transcript is never extracted or sent automatically: the teacher corrects it, and it goes through the same `/messages` endpoint as typed text. In demo mode the transcript is scripted and labelled « Transcription simulée (mode démo). ».

## 9. Errors, notices, empty and loading states

The server's French `detail` is always what is displayed. The reaction is chosen from the stable `code` (`ApiError.kind` in `src/services/types.ts`), with the HTTP status as fallback only.

| Code(s) | UI |
|---|---|
| `VERSION_CONFLICT`, `CONCURRENT_UPDATE` | Refetch the conversation, show a **notice** above the composer, keep the user's draft / open editor. No automatic replay |
| `RATE_LIMITED` | Notice, draft kept |
| `PROVIDER_ERROR`, `PROVIDER_TIMEOUT`, `INVALID_EVIDENCE`, `INVALID_EXTRACTION`, network failure, uncoded 5xx | **Error block** under the failed bubble with « Réessayer »: replays the same request with the **same** `client_message_id` |
| `IDEMPOTENCY_CONFLICT` | Error block with « Réessayer », which uses a **new** `client_message_id` |
| `AUDIO_INVALID`, `AUDIO_EMPTY`, `AUDIO_TOO_LONG`, `AUDIO_TOO_LARGE`, `AUDIO_FORMAT`, `EMPTY_TRANSCRIPT` | Recorder error state with « Réenregistrer » |
| `CONVERSATION_NOT_FOUND` | On load: new conversation + notice. During use: error block offering « Nouvelle conversation » |
| anything else (validation…) | Error block with the detail, dismiss only; dismissing puts an unsent message back in the composer |

- Notice: `role="status"`, accent tint, info icon, dismiss button. Error: `role="alert"`, destructive tint, alert icon, title « Une erreur est survenue ».
- Loading: skeleton bubbles; typing dots while a reply is awaited; spinners inside the acting button.
- Empty conversation: the server's welcome message; the panel shows five « À préciser » rows and « 0 / 5 informations ».
- In real mode a failed request is **never** answered by the mock.

## 10. Accessibility rules

- One `h1` (top bar), `h2` for panel and cards, `h3` for field labels. Landmarks: `header`, `main`, `aside`, labelled `section`.
- Thread is `role="log"`; the latest assistant message is mirrored in a visually hidden `aria-live="polite"` region. Notices are `role="status"`, errors `role="alert"`, progress text is `aria-live="polite"`.
- Focus indicator: 2 px solid `--ring` outline with 2 px offset on every focusable element (unlayered rule in `globals.css`); the composer shows it on its frame (`data-focus-inside`). Never remove it.
- Keyboard: everything reachable in visual order; skip link « Aller à la zone de saisie »; opening an editor focuses its first input, closing it returns focus to « Modifier »; « Modifier » on the confirmation card expands the panel and focuses its first edit button.
- Every form control has a visible `<label>`; icon-only buttons have an `aria-label`.
- Minimum 44 px targets on coarse pointers; text contrast ≥ 4.5:1; reduced motion honoured.
- Text can be enlarged to 200 % and the page zoomed to 400 % without loss of content or function (§5.4); zoom is never disabled.
- The JSON block is the only horizontally scrollable region; it is focusable (`tabIndex=0`, labelled) so it can be scrolled with the keyboard.

## 11. Do not

- Do not add colours, fonts, icon sets or UI libraries. Do not add a dark theme.
- Do not add gradients, shadows, illustrations, background images or decorative animation.
- Do not restyle shadcn primitives outside the tokens (no per-component colour overrides, no edits to `src/components/ui/*` beyond wiring).
- Do not compute field logic in the client: no missing-field detection, totals, date inference, validation or readiness. Display guards (like hiding an inconsistent breakdown line) are the only exception and must never change what is sent.
- Do not render messages as HTML or markdown; no `dangerouslySetInnerHTML` anywhere.
- Do not stream partial JSON or partial model output into the requirements state: the panel only changes when a complete `ConversationResponse` arrives.
- Do not hardcode French strings in components; add them to `src/i18n/fr.ts`.
- Do not make the composer `fixed`/`sticky`, and do not animate scrolling.
- Do not fall back to the mock service when an HTTP call fails.
- Do not update screenshot baselines to make a test pass without having looked at the diff.
- Do not fix a responsive failure by hiding content, removing a control, lowering a threshold of the responsive guardrail, or restricting zoom. Fix the layout.
- Do not add width/height media queries or px breakpoints next to the tiers of §5.1.

## 12. Visual regression baselines

`apps/web/e2e/visual.spec.ts` compares full-viewport screenshots in demo mode (fixed clock, fixed ids, reduced motion) for four projects and nine states:

| Project | Viewport | Layout |
|---|---|---|
| `desktop` | 1440 × 900 | two columns, 24rem panel |
| `mobile` | 390 × 844, touch | single column |
| `tablet` | 768 × 1024, touch | two columns, 17.5rem panel |
| `landscape` | 844 × 390, touch | two columns, compact mode |

`01-welcome` · `02-partial-4-of-5` · `03-inline-edit-open` · `04-complete-confirmation-card` · `05-confirmed-json` · `06-recorder-recording` (timer masked) · `07-transcript-preview` · `08-error-retry` · `09-help-dialog`

Baselines: `apps/web/e2e/__screenshots__/<platform>/<project>/<name>.png` (currently `darwin` only, 36 PNGs). They are platform-specific because font rasterisation differs; on a new platform they must be generated once and reviewed against the committed ones by eye.

- Run: `pnpm test:e2e` (from `apps/web`). It builds the app in demo mode into `.next-e2e` and serves it on port 3100.
- A failure writes `*-actual.png` and `*-diff.png` under `apps/web/test-results/`. **Open them.** Unintended diff → fix the code. Intended change → update this document first, then `pnpm test:e2e --update-snapshots`, review the new PNGs, commit them with the change.

## 13. Responsive guardrail

`apps/web/e2e/responsive.spec.ts` (+ `layout-audit.ts`) checks the layout **programmatically** — no screenshots, so the verdict is the same on macOS and Linux. It runs in `pnpm test:e2e` and in `pnpm test:e2e:ci` (the portable subset: `demo-flow` + `responsive`).

Matrix: 320×568 · 360×640 · 390×844 · 430×932 · 568×320 · 667×375 · 844×390 · 768×1024 · 820×1180 · 1024×768 · 1280×720 · 1440×900 · 1920×1080, plus 390×844 and 1280×720 with the root font size at 200 % (set before the page loads).

States audited at every size: welcome · help dialog · recorder recording · transcript preview · complete + confirmation card · station editor open · departure editor open (five rows) · confirmed + JSON.

What the audit (`auditLayout`) reports:

| Check | Rule |
|---|---|
| Horizontal overflow | neither the page, nor the shell, nor any inner scroller (thread, panel layer, dialog) scrolls sideways; only `[data-scroll-x]` may |
| Out of viewport / clipped | no control and no element holding text sticks out horizontally; no text cut by an `overflow: hidden` box; no clipped button label |
| Composer | fully visible, at least 36 px high, not covered, placeholder on one line |
| Conversation height | ≥ 55 % of the viewport at 844×390, ≥ 45 % at 667×375 and 568×320, ≥ 35 % elsewhere; ≥ 20 % while the transcript preview is open (a transient editing form that cannot be as small as the composer) |
| Overlap | no two reachable controls overlap, including a control hidden under another one |
| Touch targets | ≥ 44 × 44 px on touch viewports |
| Columns | two columns from 48rem of effective width, one below |

Further tests in the same file: long content (a 300-character theme, an 80-character station, a 4000-character message, a long unbroken string, the JSON block) at 320×568, 768×1024, 1440×900 and 390×844 at 200 %; reflow at 400 % zoom (320×256 and 320×180); and a self-test that injects each kind of breakage and requires the audit to report it — weakening the audit fails that test.

These are Chromium viewport emulations. They do not cover real devices: browser toolbars, the on-screen keyboard, notches and safe-area insets, Safari and Firefox are not exercised (§5.5 is implemented but verified only by unit tests and by reading the CSS).

### Cross-platform note on the conversation floor

At root font 200 % on phone widths the conversation floor is 30 % (35 % everywhere else, 45–55 % in landscape). The first Linux CI run measured 32.1 % where macOS measured 36.7 % for the same build: font metrics differ by a few points, and a floor only one platform meets is not a guardrail. This was decided by the project lead with the owner informed; it is not a precedent for lowering thresholds to get a green run.

### Link between the two experiences

The classic top bar carries an icon link to `/vocal` (hidden on `narrow` shells, where four controls do not fit); the Help dialog always carries the same link as text with a 44 px target. `/vocal` links back from its own top bar.

