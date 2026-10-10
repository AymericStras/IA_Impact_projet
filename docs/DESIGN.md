# Design system — « V3 — Occitanie en train » (apps/web)

This document describes the chatbot UI **as implemented** and is the reference for any future change. Since ADR-026 the classic chat (`/`) wears the identity of the teammates' site « Occitanie en train » — navy, one red, yellow, Barlow, pills, the « trame » — in place of the earlier teal design. The identity is settled: later work keeps it working and consistent, it does not restyle it. If something here and the code disagree, the code plus the screenshot baselines (`apps/web/e2e/__screenshots__/`) are the truth — fix this file.

The staged voice flow (`/vocal`) uses the same V3 tokens, fonts and controls; its route-specific styling is described in §15.

Before any UI change: read this file, then `apps/web/AGENTS.md`. After any UI change: `pnpm test:e2e` and look at every screenshot diff. The responsive guardrail (§13) must pass at every size of its matrix.

## 1. Principles

- One family with the « Occitanie en train » site: a navy header and navy hero blocks, white pages, grey quiet surfaces, **one red reserved for the primary action**, yellow as the accent for what must not be missed, full pills, condensed bold titles.
- The interface renders **server state only** (`ConversationResponse`, and `Journey` / `TravelFile` after the confirmation). It never computes missing fields, totals, readiness or validation, and never plans, sorts, filters or judges the feasibility of a trip.
- Every state is conveyed by **icon or shape + text**, never by colour alone.
- All user-facing text is French and lives in `apps/web/src/i18n/fr.ts`. Assistant messages come from the server and are displayed verbatim as plain text.

### 1.1 The eight decisions

They fix the weaknesses of the reference designs and override them wherever the two disagree.

1. **Red is the primary action and sits on white or light surfaces only** (red on navy is 2.66:1). On a navy surface the primary control is white with navy content (`Button` variant `inverse`).
2. **Focus ring in two layers**: navy inside, yellow outside (on navy surfaces: white inside, yellow outside). Visible on every interactive element (§10).
3. **Boundaries of interactive controls reach 3:1**: inputs, selects, checkboxes, radios, chips and secondary buttons are outlined in navy or in `--input`, never in grey-2 (1.59:1).
4. **Yellow is never text or a thin line on white** (1.42:1). It is a filled surface carrying navy text, a dot paired with text, or the outer focus layer.
5. **Errors are not the primary action**: a darker red (`--destructive`) on a pale red surface (`--destructive-soft`), always with an icon and text. `no_match` stays calm (a grey block) and visibly different from an error.
6. **A disabled primary button is clearly disabled**: grey with muted text and a hairline, not a faded red; its label stays legible (4.92:1).
7. **Text contrast ≥ 4.5:1** everywhere (≥ 3:1 for large bold titles and non-text UI). The measured pairs are in §2.
8. **Reduced motion honoured; no new animation that is not a state change** (§6).

## 2. Colour tokens

Defined once as CSS variables in `apps/web/src/app/globals.css` (`:root`) and exposed to Tailwind through `@theme inline`. The eight brand values are declared first (`--brand-*`); every semantic token points at one of them. Components use the semantic Tailwind classes (`bg-primary`, `bg-action`, `text-muted-foreground`…), never raw colour values and never the `--brand-*` variables. There is **no dark theme**.

| Brand value | Hex | Role |
|---|---|---|
| `--brand-navy` | `#0f2149` | Header and hero surfaces, user bubble, ink |
| `--brand-navy-2` | `#1d3166` | Attention icons and borders on light surfaces |
| `--brand-red` | `#c90c0f` | The primary action, and nothing else (plus the trame) |
| `--brand-yellow` | `#ffd500` | Accent surface, outer focus layer |
| `--brand-white` | `#ffffff` | Page, cards, inputs |
| `--brand-grey` | `#eceef3` | Assistant bubble, quiet surfaces, panel column |
| `--brand-grey-2` | `#c9cdd8` | Decorative dividers and card hairlines only |
| `--brand-muted` | `#5d6680` | Secondary text |

| Token | Value | Usage |
|---|---|---|
| `--background` | white | Page background |
| `--foreground`, `--card-foreground`, `--popover-foreground` | navy | Text |
| `--card` / `--popover` | white | Cards, panel, inputs, dialog |
| `--primary` / `--primary-foreground` | navy / white | Navy surfaces (header, journey header, confirmed card, recorder, destination card top, travel-file top), secondary outlines, links. **Not the call to action** |
| `--primary-soft` | navy-2 | Reserved for a lighter navy surface |
| `--action` / `--action-foreground` / `--action-hover` | red / white / `#a80a0c` | The single primary action (`Button` default variant) |
| `--highlight` / `--highlight-foreground` | yellow / navy | Missing field, simulation banner, demo badge, « Destination actuelle », highlighted JSON lines, key-sentence discs, recording dot (on navy), first and last timeline stops, outer focus layer |
| `--user-bubble` / `-foreground` | navy / white | User message bubble (separate token on purpose) |
| `--secondary`, `--muted`, `--accent` (+ `-foreground` navy) | grey | Assistant bubble, notices, editor surface, pills, skeletons, JSON block, panel column |
| `--muted-foreground` | `#5d6680` | Secondary text, hints, timestamps, disabled labels |
| `--success` / `-foreground` / `--success-soft` | navy / white / grey | The identity has no green: a positive state is navy with a check mark and words |
| `--warning` | navy-2 | **Icons and borders only** on light surfaces (pending clarification) |
| `--destructive` / `-foreground` / `--destructive-soft` | `#9c0a0c` / white / `#fdeeee` | Error title, icon and border; error surface; failed bubble ring; « Non vérifié » |
| `--border` | grey-2 | Decorative separators and card hairlines |
| `--input` | `#707a98` | Boundary of inputs, selects, the test-scenario box, disabled outline buttons |
| `--ring` | navy | Kept for shadcn compatibility; the focus indicator is §10 |
| `--elevation-card`, `--elevation-raised` (`shadow-card`, `shadow-raised`) | navy-tinted shadows | Cards; dialog and the expanded panel layer |
| `--focus-inner`, `--focus-gap`, `--focus-outer` | navy, white, yellow | Layers of the focus indicator; `.on-navy` swaps the first two |

Measured contrast (WCAG 2.x, computed from the hex values; alpha blends are composited first):

| Pair | Where | Ratio | Needs |
|---|---|---|---|
| navy on white / white on navy | body text, titles, header, navy blocks, user bubble, tooltip | 15.74 | 4.5 |
| navy on grey | assistant bubble, notices, pills, JSON block, neutral journey header, editor | 13.56 | 4.5 |
| navy on yellow | missing field, simulation banner, demo badge, highlighted JSON line | 11.07 | 4.5 |
| yellow on navy | check icon of the confirmed card, recording dot, focus halo on navy | 11.07 | 3 |
| white on red / on red hover | primary button label | 5.93 / 7.74 | 4.5 |
| red on white / on grey | primary button shape | 5.93 / 5.11 | 3 |
| muted on white / on grey | hints, timestamps, placeholder / disabled primary label | 5.71 / 4.92 | 4.5 |
| white at 85 % / 80 % on navy | secondary lines inside navy blocks | 11.65 / 10.46 | 4.5 |
| white on navy at 70 % over white | user bubble while « Envoi en cours… » | 5.96 | 4.5 |
| destructive on destructive-soft / on white | error title and icon / « Non vérifié », copy failure | 7.57 / 8.53 | 4.5 |
| navy on destructive-soft | error detail text | 13.97 | 4.5 |
| `--input` on white / on grey | input, select and scenario-box boundary | 4.26 / 3.67 | 3 |
| navy on white / on grey | outline buttons, composer field, checkbox, rating cell, selected card | 15.74 / 13.56 | 3 |
| navy-2 on white | pending-clarification icon | 12.47 | 3 |
| navy at 60 % on grey | typing dots | 4.09 | 3 |
| navy ring on white · white ring on navy | inner focus layer | 15.74 | 3 |
| red on navy | **trame only** (decorative, `aria-hidden`) | 2.66 | — |
| yellow on white | **never text or line**; progress dot paired with the count, outer focus halo next to the navy ring | 1.42 | — |
| grey-2 on white | **decorative** dividers and card hairlines | 1.59 | — |
| grey on white | assistant bubble edge (the bubble is carried by its text) | 1.16 | — |
| muted on yellow | **not used** | 4.02 | — |

Rules: text must reach 4.5:1. `--border` is decorative only; anything the user must perceive as a control boundary uses navy or `--input`. Red never sits on navy, yellow never carries text on white, and muted text never sits on yellow.

## 3. Typography

- **Barlow** (400, 500, 600, 700) for text and **Barlow Semi Condensed 800** for titles and big values, self-hosted by `next/font/google` in `src/app/layout.tsx` (`display: swap`, CSS variables `--font-barlow` and `--font-barlow-semi-condensed`, mapped to `font-sans` and `font-heading`). **Geist Mono** for the JSON block. No `<link>` to Google, no other font.
- `<html lang="fr">`, antialiased.
- Shared class constants (`src/lib/ui.ts`): `DISPLAY` (condensed 800), `EYEBROW` (11 px, bold, uppercase, 0.09em tracking, navy), `SELECT_PILL`.

| Role | Classes | Size |
|---|---|---|
| Wordmark « liO » | `DISPLAY`, white | 28 px (phones) · 28–32 px (two columns) · 20 px (compact) |
| Page title (`h1`) « Préparer une sortie scolaire » | `DISPLAY`, white | 26 px (phones) · 28 px (tablet) · 32 px (from `roomy`) · 18 px (compact; visually hidden below `titled` in compact mode) |
| Card and stage titles (`h2`, `h3`) | `DISPLAY` `text-2xl` / `text-xl` | 24 / 20 px |
| Field value in « Votre projet » | `DISPLAY` `text-xl` | 20 px (18 px in the yellow block) |
| Field labels, section headings inside cards | `EYEBROW` | 11 px |
| Message bubble | `text-base leading-normal` | 16 px |
| Body of cards | `text-[0.9375rem]` | 15 px |
| Primary button | `text-sm font-bold uppercase tracking-[0.07em]` | 14 px (13 px in `sm`) |
| Other buttons | `text-sm font-semibold` | 14 px (13 px in `sm`) |
| Hints, descriptions | `text-[0.8125rem]` or `text-xs`, `text-muted-foreground` | 13 / 12 px |
| Timestamps, composer hint, counter, state pill, « Mis à jour » | `text-[0.6875rem]` | 11 px |
| JSON block | `font-mono text-xs leading-relaxed` | 12 px |
| Inputs | `text-base` below `md`, 15 px from `md`; never under 16 px on coarse pointers (`font-size: max(1rem, 16px)` in `globals.css`, prevents the iOS focus zoom). The composer is always 16 px | 16 / 15 px |

Times are written « 8 h 00 » with non-breaking spaces in the panel; dates with `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' })` (year added only when it is not the current one). Helpers: `src/lib/format.ts`.

## 4. Shape, spacing, elevation, trame

- **Full pills** (`rounded-full`) for buttons, inputs, selects, chips, badges and rating cells. The composer field is a pill while it holds one line (`rounded-[1.5rem]`); multi-line fields use `rounded-[1.25rem]`.
- **Cards 16–22 px**: radius token `--radius: 0.75rem`; `rounded-xl` (16.8 px: inner blocks, yellow field block, activity chips), `rounded-2xl` (21.6 px: cards, panel, navy blocks, notices, errors), `rounded-3xl` (dialog). Bubbles are `rounded-[1.375rem]` with one tightened corner: `rounded-bl-md` (assistant) / `rounded-br-md` (user).
- **Buttons** (`src/components/ui/button.tsx`): `default` = the red primary action, uppercase, bold, letter-spaced; `outline` = secondary, 2 px navy boundary on white; `ghost` = tertiary; `link` = navy underlined (« Modifier »); `inverse` = white with navy content, the main control **on navy**; `ghost-inverse` = white text on navy; `destructive` exists but is unused. Heights 40 px (default) and 32 px (`sm`), 44 px minimum on touch.
- **Elevation**: soft navy-tinted shadows — `shadow-card` on cards and the panel, `shadow-raised` on the dialog and the expanded panel layer. Hairlines are `border-border`. No gradients, no illustrations, no background images.
- Spacing follows the Tailwind 4 px scale, with generous whitespace: page gutter `px-page` (1rem, or the safe-area inset when larger, growing beyond 80rem so the content stays centred at 78rem); thread `gap-3` between bubbles and `gap-4` around the footer; cards `p-5` (`p-3.5` in compact mode).
- Icons: `lucide-react` only, 16 px (`size-4`) by default, always `aria-hidden` next to a text label or with an `aria-label` on the control.
- **The trame** (`src/components/chatbot/Trame.tsx`): two rows of short rounded dashes and dots, like a stylised rail line. One reusable, deterministic inline SVG (`aria-hidden`, `focusable="false"`), sized by a width class. On navy it is red, yellow and white; on a light surface (`surface="light"`) the yellow and white strokes are drawn in navy, because yellow would be a thin line at 1.42:1. **It is used once: with the page title in the header.** Do not add it to cards or stages, where it would compete with content.

### 4.1 Header

`TopBar` is a navy block (`.on-navy`): the wordmark « liO », the title « Préparer une sortie scolaire » (`fr.app.headerTitle`) in white condensed type, the trame, and the controls — the yellow « Mode démo » pill (demo only), the link to `/vocal`, « Nouvelle conversation », « Aide ». No red in the header.

| Shell | Arrangement | Height (default text size) |
|---|---|---|
| tall, single column (phones) | wordmark + controls on one row; title and trame below | 118 px at 390 × 844 |
| tall, two columns | one band: wordmark, hairline, title with the trame under it; controls on the right (the voice link becomes an outlined pill « Version vocale » from `roomy`) | 87 px |
| short (landscape phones, very large text) | one slim row: wordmark, title (from `titled`), the trame **beside** it — there is no room under it; the trame is dropped on `narrow` + `short` shells (doubled text on a phone) | 48 px |

### 4.2 Surfaces of the classic chat

- **Two columns**: the conversation is on white; the panel column is a grey band (`.panel-column`) running from the header to the bottom of the screen and to its right edge, with « Votre projet » as a white card on it.
- **Single column**: « Votre projet » is a white strip under the header (title, five dots, count, toggle) with a hairline under it; its details open as a white layer with `shadow-raised` over the conversation.
- **Composer**: three pills on the page, no frame — the field (2 px navy border), the round microphone button (navy outline) and the red send button (a round icon button in a single column, the word « Envoyer » in two columns; grey while there is nothing to send).

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

`ConversationThread`: on each new message or footer change the thread follows the conversation. When the footer holds an element marked `data-thread-anchor` (the journey, §14) and the footer changes, the **start of that element** is aligned to the top instead, wherever the thread was — the content under the reader has just been replaced by the teacher's own choice — and the thread does not re-glue to the bottom when that element grows (travel file arriving). The scroll container is `position: relative` so that absolutely positioned descendants (screen-reader-only text, stretched checkbox inputs) scroll with it instead of giving the shell a phantom scrollable height. If the newest reply plus what follows it (e.g. confirmation card + JSON) is taller than the conversation area, the start of that reply is aligned to the top instead of jumping to the end. If the thread is not at its end, a « Revenir en bas » pill is offered; it sits on its own row under the list (in the `low` tier: icon-only in a right gutter), so it never covers message text. If the user has scrolled up, nothing moves; the user's own message always brings the thread back down. Scrolling is instant, never animated.

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
| `ConfirmationCard` | hidden · ready (« Vérification avant transmission », « Modifier », « Confirmer et continuer ») · confirming · confirmed (« Projet confirmé » + JSON; when the journey follows, a small « Voir la suite : propositions de sortie » button that brings it into view) | `confirmation`, `journey.continue` |
| `ConfirmedJsonBlock` | open/closed · copied · copy failed; `"constraint"` lines highlighted | `confirmation` |
| `ErrorMessage` | with retry · with restart · dismiss only | `errors` |
| `LoadingState` | skeleton bubbles | `loading` |
| `journey/*` | the journey after confirmation, see §14 | `journey` |

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
- Journey failures (§14) are shown inside the journey section by the same `ErrorMessage` block: `PLANNER_ERROR`, `BOOKING_ERROR`, network failures and uncoded 5xx with « Réessayer » (replays the same call); a refused acceptance of an adjustment without it (a second acceptance is refused by the server). A failure never changes the stage on screen. "No result" (`no_match`) and a refused booking are **stages**, not errors: they never use `role="alert"` nor the destructive tint.

## 10. Accessibility rules

- One `h1` (top bar), `h2` for panel and cards, `h3` for field labels. Landmarks: `header`, `main`, `aside`, labelled `section`.
- Thread is `role="log"`; the latest assistant message is mirrored in a visually hidden `aria-live="polite"` region. Notices are `role="status"`, errors `role="alert"`, progress text is `aria-live="polite"`.
- Focus indicator: inner 2 px navy ring, surface-colour gap and outer yellow halo; `.on-navy` uses a white inner ring. The composer shows it on its frame (`data-focus-inside`). Stage headings receive programmatic focus without a ring; every interactive control retains it.
- Keyboard: everything reachable in visual order; skip link « Aller à la zone de saisie »; opening an editor focuses its first input, closing it returns focus to « Modifier »; « Modifier » on the confirmation card expands the panel and focuses its first edit button.
- Every form control has a visible `<label>`; icon-only buttons have an `aria-label`.
- Minimum 44 px targets on coarse pointers; text contrast ≥ 4.5:1; reduced motion honoured.
- Text can be enlarged to 200 % and the page zoomed to 400 % without loss of content or function (§5.4); zoom is never disabled.
- The JSON block is the only horizontally scrollable region; it is focusable (`tabIndex=0`, labelled) so it can be scrolled with the keyboard.

## 11. Do not

- Do not add colours, fonts, icon sets or UI libraries. Do not add a dark theme.
- Do not add gradients, illustrations, background images or decorative animation. Use only the shared `shadow-card` and `shadow-raised` elevation tokens.
- Preserve the shared V3 shadcn primitives (pill controls and inverse variants); do not add per-page primitive overrides.
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

`apps/web/e2e/visual.spec.ts` compares full-viewport screenshots in demo mode (fixed clock, fixed ids, reduced motion) for four projects and thirteen states:

| Project | Viewport | Layout |
|---|---|---|
| `desktop` | 1440 × 900 | two columns, 24rem panel |
| `mobile` | 390 × 844, touch | single column |
| `tablet` | 768 × 1024, touch | two columns, 17.5rem panel |
| `landscape` | 844 × 390, touch | two columns, compact mode |

`01-welcome` · `02-partial-4-of-5` · `03-inline-edit-open` · `04-complete-confirmation-card` · `05-confirmed-json` (with the « Voir la suite » pointer) · `06-recorder-recording` (timer masked) · `07-transcript-preview` · `08-error-retry` · `09-help-dialog` · `10-journey-destinations` · `11-journey-adjustments` · `12-journey-review` · `13-journey-travel-file`

The four journey states come from one run of the `adjustments` test scenario (destinations → adjustments → accepted « Retour à 17 h 30 » → review → travel file). Baselines: `apps/web/e2e/__screenshots__/<platform>/<project>/<name>.png` (currently `darwin` only, 52 PNGs for the classic chat; the `voice-*` files belong to `/vocal`). They are platform-specific because font rasterisation differs; on a new platform they must be generated once and reviewed against the committed ones by eye.

- Run: `pnpm test:e2e` (from `apps/web`). It builds the app in demo mode into `.next-e2e` and serves it on port 3100.
- A failure writes `*-actual.png` and `*-diff.png` under `apps/web/test-results/`. **Open them.** Unintended diff → fix the code. Intended change → update this document first, then `pnpm test:e2e --update-snapshots`, review the new PNGs, commit them with the change.

## 13. Responsive guardrail

`apps/web/e2e/responsive.spec.ts` (+ `layout-audit.ts`) checks the layout **programmatically** — no screenshots, so the verdict is the same on macOS and Linux. It runs in `pnpm test:e2e` and in `pnpm test:e2e:ci` (the portable subset: `demo-flow` + `responsive`).

Matrix: 320×568 · 360×640 · 390×844 · 430×932 · 568×320 · 667×375 · 844×390 · 768×1024 · 820×1180 · 1024×768 · 1280×720 · 1440×900 · 1920×1080, plus 390×844 and 1280×720 with the root font size at 200 % (set before the page loads).

States audited at every size: welcome · help dialog · recorder recording · transcript preview · complete + confirmation card · station editor open · departure editor open (five rows) · confirmed + JSON (with the journey's start card) · and the journey (§14): start card with the test-scenario tool open · destinations (top, and scrolled to the activity checkboxes) · adjustments (top, and its actions) · change of destination · itineraries · review (top, and its buttons) · booked · travel file (start and end) · feedback form · closed.

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

The classic top bar carries a link to `/vocal` as an outlined pill with a visible label (« Vocal » below `roomy`, « Version vocale » from `roomy`; the demo badge reads « Démo » on single-column shells to leave room; hidden on `narrow` shells, where four controls do not fit); the Help dialog always carries the same link as text with a 44 px target. `/vocal` links back from its own top bar, with the visible short label « Classique » between 22.5rem and 42rem (icon alone below, « Discussion classique » above). An icon alone was not recognised as a mode switch on phones (owner feedback, 2026-10-10).

## 14. Journey after confirmation

What follows the confirmation — destinations, itineraries, adjustments, booking, travel file, feedback — belongs to teammates' modules; the backend simulates them (`docs/PLANNER_CONTRACT.md`). The classic chat renders that journey **in the thread**, under the confirmed card and its JSON block (which stay as they are), once the conversation is `CONFIRMED` and `GET /config` says `planner_mode` is not `"off"` (absent counts as off). Components: `apps/web/src/components/chatbot/journey/`, one per file; copy in `fr.journey`.

Rules:

- **Server state only.** Stage, lists and their order, messages, reasons, adjustment labels, `unlocks` counts and feasibility checks are read from the `Journey` object and shown as received. The client formats times and durations (`formatClock` « 8 h 05 », `formatDuration` « 1 h 15 », `src/lib/format.ts`) and pluralises its own labels; it plans, sorts, filters and checks nothing.
- **The simulation label is on every journey view.** `JourneyNotices` renders every string of `journey.notices` (warning border and tint, flask icon), directly under the stage header and again inside the travel file, so that the printed page carries it. Nothing is hardcoded: no notice from the server, no label.
- **Nothing is applied without a click.** Adjustments are cards with one button each; none is preselected. The sentence « Rien n'est modifié tant que vous n'avez pas accepté un ajustement. » stands above the list.
- **Change at any time.** In every stage before a booking request is waiting (`destinations`, `itineraries`, `adjustments`, `no_match`, `review`, `booking_refused`) the section ends with `JourneyActions`: « Changer de destination » (« Choisir une autre destination » in `adjustments` and `no_match`; shows `journey.destinations` again with the current choice marked and its activities ticked; absent when the server listed no destination), « Modifier ma demande » (opens "Votre projet" on its first « Modifier » button) and « Relancer la recherche ». Editing a requirement clears the confirmation: the journey leaves the screen at once and a `role="status"` notice (« La recherche de propositions est interrompue… ») stays above the confirmation card until the project is confirmed again.
- **"No result" is not an error.** `no_match` and `booking_refused` use the neutral header (muted tint, `SearchX` / warning-triangle icon) and plain text; technical failures use the `ErrorMessage` block (§9). The two never share a look.

| Component | Shows | States |
|---|---|---|
| `JourneyPanel` | chooses the view from `journey.stage`; holds only what the teacher asked to look at again (destination list, other itineraries) and the test-scenario selection | idle (nothing) · loading · start · one view per stage · error block on top of the current view |
| `JourneyStart` | « Propositions de sortie », primary button « Rechercher des propositions » | idle · searching |
| `ScenarioControls` | « Scénario de test »: two selects (recherche: automatique / ajustements proposés / aucun résultat / erreur technique; réservation: confirmée / refusée une fois / erreur technique), dashed border | collapsed (default) · open. Only when `planner_mode === "simulated"`; on the start card and next to « Relancer la recherche » |
| `JourneyHeader` | stage title (`h2`) + `journey.message` | accent tint (in progress) · success tint (`booked`, `closed`) · muted tint (`no_match`, `booking_refused`) |
| `JourneyNotices` | every `journey.notices` line | — |
| `DestinationList` / `DestinationCard` | title, `theme_match`, travel time and arrival station, places (walking time, note), activities as checkboxes with durations, « Choisir cette destination »; the stations a city was expanded into | default · current destination · sending |
| `ItineraryList` / `ItineraryCard` / `TrainLegRow` | label, destination · day · participants, « Aller » and « Retour » (time + station → time + station, line label), timed activities, free time, feasibility checks (icon **and** « Vérifié » / « Non vérifié » in words), « Choisir cet itinéraire » | default · sending |
| `AdjustmentList` / `AdjustmentCard` | the reason (once when all adjustments share it, per card otherwise), the consent sentence, then **every** adjustment: the server's `label`, before → after for each time change, « → n itinéraire(s) possible(s) », « Accepter cet ajustement » | default · applying |
| `NoMatchCard` | « La recherche a bien fonctionné : il ne s'agit pas d'une erreur technique. » | — |
| `ReviewCard` | the selected itinerary in full, « Rien n'est réservé pour l'instant. », « Choisir un autre itinéraire », « Envoyer la demande de réservation » | default · sending |
| `BookingPending` | reference, waiting line, « Vérifier la réponse »; the answer is looked up **once** automatically after 2.5 s (no polling) | waiting · checking |
| `BookingRefused` | the server's refusal message, then `journey.alternatives` as itinerary cards | with / without alternatives |
| `TravelFileView` | title, reference, notices, timetable of the day, places, safety advice, contacts, official links as plain text (only when the server sends some), « Imprimer le dossier » | — |
| `FeedbackForm` / `FeedbackGiven` | 1–5 rating as a native radio group (arrow keys), optional comment (1000 characters), « Envoyer mon avis »; after `closed`, the recorded rating and comment | empty (button disabled) · rated · sending |
| `JourneyActions` | the three ways out described above | — |
| `JourneyInterruptedNotice` | notice shown after an edit dropped the journey | — |

Layout: the section is a container (`@container/journey`). Cards are one per row and go side by side from 40rem of section width (destinations, itineraries; three itineraries from 62rem) or 36rem / 58rem (adjustments); button rows stack below 24rem–30rem. Checkboxes and radios are native inputs stretched invisibly over their row or cell (the whole row is the hit area, ≥ 44 px on touch; the focus ring is drawn on the row). Times carry non-breaking spaces. A new stage always starts from its header (§5.7).

**Printing.** `TravelFileView` is the print area (`data-print-area`). `@media print` in `globals.css` removes everything that is neither the file, inside it, nor one of its ancestors, releases the viewport-high scrolling shell so the file flows over as many pages as needed, and hides the print button (`data-print-hidden`). Without a travel file on screen, printing keeps the browser's default behaviour.

Demo mode: `src/services/mockJourneyApi.ts` is a scripted port of the backend's simulation (same catalogue, same French strings, same error codes), validated against `journey.schema.json` / `travel_file.schema.json` and against the contract examples. It is scaffolding for the demo and the e2e suite, not a planner.


## 15. V3 in the staged voice flow

The layout, gestures, stage routing and server-state rendering of `apps/web/VOICE_NOTES.md` remain the reference. The visual identity now matches the classic chat:

- Persistent navy header, white navigation, yellow demo badge; hollow white / filled yellow progress dots. The decorative trame appears once in the header on wide shells.
- Condensed 800 stage titles and destination titles, Barlow body text; pill controls. The initial eyebrow and missing field values use yellow with navy text.
- The talk disc is red on the white ask/sheet surface and white on the navy listening surface. When the sheet can be confirmed, the talk disc becomes navy so confirmation is the single red primary action. Its dimensions and bottom anchoring do not change.
- Journey dock primary actions are red, secondary actions have navy outlines. Disabled controls are grey with legible labels. Cards use the shared elevation; all server simulation notices use yellow with navy text, including the travel file.
- The listening shell and header declare `.on-navy` for the shared two-layer focus ring. Programmatically focused headings have neither outline nor halo. The recording shape, reduced-motion meter and transition timing are unchanged.

The intended restyle changes all 100 voice screenshots and 52 classic screenshots. Regeneration requires review of each image; the full functional and responsive suites still apply. macOS visual comparisons also run on an isolated GitHub-hosted `macos-26` runner, independently of local development and production services. Failed comparisons upload actual/expected/diff images without updating baselines automatically.

For an intentional restyle, after updating this document, the manual CI dispatch input `update_visual_baselines=true` runs the visual specs with `--update-snapshots` on the macOS runner and uploads `visual-baseline-candidates-macos`. This produces candidates only: review all images locally, commit the reviewed PNGs, then require the normal PR comparison to pass. Normal push/PR runs never update snapshots. Example: `gh workflow run ci.yml --ref <branch> -f update_visual_baselines=true`.

Narrow classic headers use a single-line 1.25rem title and tighter trame spacing. Short confirmation cards reduce typography and gaps while retaining every message and action. Narrow recorder actions reduce horizontal padding and letter spacing so enlarged text can share one row; touch targets stay at least 44px. Scrollable surfaces and controls reserve a 0.5rem focus margin.
