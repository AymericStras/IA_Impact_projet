---
name: frontend-implementation
description: Implémenter ou modifier l'interface française du chatbot dans apps/web (Next.js, TypeScript, Tailwind, shadcn/ui, AI Elements, Motion) à partir de la spécification, en n'affichant que l'état serveur. À utiliser pour tout composant, page, hook, style ou travail d'accessibilité dans apps/web.
---

# Implémentation frontend

## Lire d'abord
`AGENTS.md` §3 (invariants 9, 12), `docs/PRODUCT.md`, `docs/DEMO.md` (mise en page + prompt Stitch), `docs/API.md`, `packages/contracts/conversation_response.schema.json`, et la section « Notes frontend » de `docs/HANDOFF.md`.

## Règles
- Le client affiche `ConversationResponse`. Ne jamais calculer `missing_fields`, totaux, `ready_for_confirmation` ou validation dans le navigateur.
- Un composant par fichier dans `src/components/chatbot/` : ChatContainer, MessageBubble, MessageComposer, VoiceRecorder, AudioTranscriptionPreview, TypingIndicator, RequirementsPanel, RequirementField, ConfirmationCard, ErrorMessage, LoadingState, DemoBadge.
- Accès aux données uniquement via `src/services/conversationApi.ts` (réel) et `src/services/mockConversationApi.ts` (démo) ; le hook `useConversation()` choisit selon `NEXT_PUBLIC_DEMO_MODE`. Le mode démo affiche un badge « Mode démo ».
- Types dans `src/types/contracts.ts`, alignés sur les JSON Schema (`pnpm gen:types` depuis l'OpenAPI de l'API quand elle tourne).
- Toutes les chaînes en français, centralisées dans `src/i18n/fr.ts`. Dates via `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' })`, heures « 8 h 00 », contraintes « vers », « au plus tard à », « à partir de ».
- Composer : Entrée envoie, Maj+Entrée saute une ligne ; désactivé pendant une requête ; bulle optimiste, retour arrière et « Réessayer » en cas d'erreur (même `client_message_id`).
- VoiceRecorder : MediaRecorder ; états inactif → autorisation → enregistrement (minuteur, annuler) → envoi → aperçu de transcription (éditable) → envoyé. Gérer refus du micro, `MAX_AUDIO_SECONDS`, échec d'envoi (réenregistrer), navigateur non pris en charge.
- RequirementField : ✓ connu / ○ « À préciser » ; « Modifier » ouvre une édition en ligne → `PATCH /requirements` avec `expected_version` ; 409 → recharger et informer.
- Accessibilité : clavier, `aria-live="polite"` sur les nouveaux messages, focus rendu au composer après envoi, contraste 4.5:1, `prefers-reduced-motion` respecté.
- Mobile : une colonne, panneau repliable avec « 3 / 4 informations ».

## Procédure
1. Si une référence visuelle est utile, lancer Stitch via `./tools/stitch` avec le prompt de `docs/DEMO.md`, sauvegarder sous `artifacts/`, traduire en composants — ne jamais livrer le HTML généré.
2. Construire le composant isolément avec des données simulées ; ajouter un test Vitest + Testing Library de ses états.
3. Le brancher via `useConversation()` ; vérifier avec `./scripts/demo.sh`.
4. `pnpm tsc --noEmit && pnpm lint && pnpm test -- --run` ; pour les parcours, Playwright en mode démo.
5. Mettre à jour `docs/HANDOFF.md`.
