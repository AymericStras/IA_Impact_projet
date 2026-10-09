# Demo

## Two modes

| Mode | Command | Needs | Use |
|---|---|---|---|
| Mock demo | `./scripts/demo.sh` → http://localhost:3000 | nothing | UI development, pitch fallback. Shows a « Mode démo » badge; scripted extraction, **not** real model capability |
| Real AI | `./scripts/dev.sh` | Keychain key (Mac) or `OPENAI_API_KEY` | Actual transcription + extraction |

## Pitch script (real AI mode, ~3 min)

1. Open the chatbot. Welcome message in French.
2. Voice: « Bonjour, je voudrais organiser une sortie le 12 novembre. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge. » → transcript shown → send.
3. Panel fills 3/4; assistant asks for the return time only.
4. Type « Avant 17 h. » → summary + « Confirmer et continuer » / « Modifier ».
5. Click participants → change to 32 → panel updates, re-confirmation requested.
6. Confirm → JSON (`schema_version 1.0`) displayed, with `constraint: "latest"` highlighted as the hand-off value for the planner.

Fallback: same script in mock mode (scripted answers).

## Stitch design prompt

Use with `./tools/stitch call <generate tool> @args.json` (P3). Output goes to `artifacts/` and is re-implemented as React components.

```text
Design a professional French-language AI chatbot interface for teachers planning
educational trips in the Occitanie region of France.

Product context: a public-transport and educational mobility assistant associated
with regional liO trains.

Design goals: professional, minimal, modern, intuitive, accessible, calm and
trustworthy, highly polished interactions.

Layout: clean top navigation; main conversational area; compact requirements
summary panel; fixed message composer; integrated microphone control.

The assistant collects four requirements: number of participants; departure date
and time; return date and time; educational subject or theme.

Required interface states: welcome; text conversation; audio recording; audio
transcription; missing information; completed requirements; user confirmation;
loading and error states.

Visual direction: contemporary French public service design; subtle liO-inspired
color accents; light background; soft neutral surfaces; restrained borders;
excellent typography; generous whitespace; smooth, subtle animations.

Avoid: excessive gradients, large decorative illustrations, dashboard clutter,
heavy shadows, unnecessary cards, distracting animations.

All user-facing text must be in French. Create responsive desktop and mobile
layouts. Prioritize interaction quality and clear communication over decoration.
```

## Target layout

```
┌────────────────────────────────────────────────────────┐
│  liO   Assistant de voyage pédagogique          Aide   │
├────────────────────────────────┬───────────────────────┤
│  Conversation                  │  Votre projet         │
│  …                             │  Participants ✓ 30    │
│                                │  Départ ✓ 12 nov, 8 h │
│                                │  Retour ○ À préciser  │
│                                │  Thème ✓ Histoire     │
│                                │  3 / 4 informations   │
├────────────────────────────────┤                       │
│  Écrivez votre message…    🎤  │                       │
└────────────────────────────────┴───────────────────────┘
```
Mobile: single column, requirements panel collapsible.
