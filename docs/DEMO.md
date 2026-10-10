# Démonstration

## Deux modes

| Mode | Commande | Nécessite | Usage |
|---|---|---|---|
| Démo simulée | `./scripts/demo.sh` → http://localhost:3000 | rien | Développement UI, secours pour la présentation. Badge « Mode démo » ; extraction scriptée, **pas** la capacité réelle du modèle |
| IA réelle | `./scripts/dev.sh` | clé dans le trousseau (Mac) ou `OPENAI_API_KEY` | Transcription + extraction réelles |

## Script de présentation (mode IA réel, ~3 min)

1. Ouvrir le chatbot. Message d'accueil en français.
2. Voix : « Bonjour, je voudrais organiser une sortie le 12 novembre. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge. » → transcription affichée → envoyer.
3. Le panneau se remplit 3/4 ; l'assistant ne demande que l'heure de retour.
4. Écrire « Avant 17 h. » → récapitulatif + « Confirmer et continuer » / « Modifier ».
5. Cliquer sur les participants → passer à 32 → le panneau se met à jour, nouvelle confirmation demandée.
6. Confirmer → JSON (`schema_version 1.0`) affiché, `constraint: "latest"` mis en avant comme valeur transmise au planificateur.

Secours : même script en mode démo (réponses scriptées).

## Prompt de design Stitch

À utiliser avec `./tools/stitch call <outil de génération> @args.json`. La sortie va dans `artifacts/` et est réimplémentée en composants React.

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

## Mise en page cible

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
Mobile : une colonne, panneau repliable.
