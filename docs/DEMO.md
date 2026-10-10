# Demo

## Two modes

| Mode | Command | Requires | Use |
|---|---|---|---|
| Simulated demo | `./scripts/demo.sh` → http://localhost:3000 | nothing | UI development, fallback for the presentation. « Mode démo » badge; scripted extraction, **not** the model's real capability |
| Real AI | `./scripts/dev.sh` | key in the Keychain (Mac) or `OPENAI_API_KEY` | Real transcription + extraction |

## Presentation script (real AI mode, ~3 min)

1. Open the chatbot. Welcome message in French.
2. Voice: « Bonjour, je voudrais organiser une sortie le 12 novembre. J'ai 27 élèves et 3 accompagnateurs, on partirait de Toulouse vers 8 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge. » → transcript displayed → send.
3. The panel fills up to 4/5; the assistant only asks for the return time.
4. Type « Avant 17 h. » → summary + « Confirmer et continuer » / « Modifier ».
5. Click on the participants → change to 32 → the panel updates, a new confirmation is requested.
6. Confirm → JSON (`schema_version 1.0`) displayed, `constraint: "latest"` highlighted as the value handed to the planner.

Fallback: same script in demo mode (scripted responses).

## Stitch design prompt

To be used with `./tools/stitch call <generation tool> @args.json`. The output goes to `artifacts/` and is re-implemented as React components.

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
Mobile: one column, collapsible panel.
