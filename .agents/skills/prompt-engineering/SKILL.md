---
name: prompt-engineering
description: Modifier, versionner et valider les prompts d'extraction et de dialogue de services/api/app/prompts, ainsi que le schéma RequirementPatch que remplit le modèle. Toujours accompagné d'un passage des évaluations françaises de evals/.
---

# Ingénierie des prompts

## Lire d'abord
`AGENTS.md` §3 (invariants 1–6), `services/api/app/prompts/*.md`, `services/api/app/schemas/patch.py`, `evals/README.md`, dernière section « Évaluations » de `docs/HANDOFF.md`.

## Règles
- Les prompts sont des fichiers versionnés avec en-tête (`vX.Y`, date). Incrémenter à chaque changement sémantique et consigner les résultats d'évaluation dans `docs/HANDOFF.md`.
- Le prompt ne décide jamais du flux, n'écrit jamais de texte pour l'utilisateur, ne confirme jamais. Si un comportement relève du code (totaux, état, redemande), corriger le code, pas le prompt.
- La fiabilité vient du schéma + de la validation par le code ; le prompt améliore le rappel et le signalement des ambiguïtés. Préférer ajouter un `AmbiguityKind` plutôt que demander au modèle « d'être prudent ».
- Le prompt système reste en anglais (ADR-010) ; les exemples qu'il contient peuvent être en français.
- Régressions bloquantes : remplissage non fondé (valeur sans `evidence`), intention `confirm` sans accord explicite, champ existant perdu.
- Le modèle reçoit les 8 derniers messages (ADR-015) : les cas d'évaluation à un tour qui répondent à une question doivent fournir `history`.

## Procédure
1. Ajouter ou ajuster des cas dans `evals/french_cases.jsonl` capturant le comportement visé **avant** d'éditer le prompt (inclure l'oral : « on serait une trentaine », « deux classes de vingt-cinq », « rentrés vers seize heures », « finalement plutôt jeudi »).
2. Éditer le prompt ; si un nouveau type d'ambiguïté ou une forme de champ est nécessaire, modifier le modèle Pydantic du patch et régénérer le JSON Schema (procédure contrat).
3. Lancer `cd services/api && ../../tools/with-api-env gpt -- uv run python ../../evals/evaluate.py` (et éventuellement `--model` pour comparer).
4. N'accepter que si l'exactitude est ≥ à la précédente et que les bloquants sont à 0. Un cas peut être non déterministe : relancer avec `--id` avant de conclure. Consigner le tableau dans `docs/HANDOFF.md`.
5. Committer prompt + cas + résultats ensemble (`feat(prompt): …` / `fix(prompt): …`).
