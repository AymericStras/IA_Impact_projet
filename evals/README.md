# Évaluations — jeu de cas français

`french_cases.jsonl` : un cas par ligne. Un cas à un tour donne `message` + `state` (informations courantes, peut être `{}`), un `history` optionnel (messages précédents, dont la dernière question de l'assistant) et `expect`. Un cas multi-tours donne `turns: [{message, expect}]` ; l'historique est propagé automatiquement d'un tour à l'autre.

Clés d'`expect` (toutes optionnelles, chacune vérifiée si présente) :

| Clé | Signification |
|---|---|
| `operations` | liste de `{field, operation, value?}` devant apparaître (`value` comparée en sous-ensemble : omettre `constraint` accepte toute contrainte) |
| `no_operations_on` | champs qui ne doivent avoir **aucune** opération (garde contre les données inventées) |
| `participants_mentioned` | sous-ensemble de `{students, accompanying, total_stated}` |
| `ambiguity_kinds` | `kind`s devant apparaître (`[]` = aucune ambiguïté attendue) |
| `conflicts_on` | champs devant apparaître dans `conflicts` |
| `user_intent` | intention attendue |
| `merged` | sous-ensemble attendu de `PartialRequirements` après fusion |
| `missing_fields` | liste attendue après fusion + validation |
| `state` | état décidé par la machine à états |

`today` fige l'horloge de Paris pour les dates relatives (`2026-10-10`, un samedi, sauf indication).

## Lancer

```sh
python evals/evaluate.py --list                     # liste des cas (sans API)
cd services/api && ../../tools/with-api-env gpt -- uv run python ../../evals/evaluate.py [--model gpt-5.4-mini] [--tag correction] [--id <cas>]
```

Résultats dans `evals/results/<horodatage>.json` (ignoré par Git) ; résumé à consigner dans `docs/HANDOFF.md`.

## Métriques

1. Exactitude d'extraction par champ (cas non ambigus) — cible ≥ 95 %.
2. Exactitude du total de participants.
3. Exactitude date/heure/contrainte.
4. Détection des champs manquants.
5. Préservation de l'état lors des corrections (aucun champ perdu).
6. **Remplissages non fondés** (opération sans `evidence` / valeur inventée) — doit être 0, bloquant.
7. **Fausses confirmations** (intention `confirm` sans accord explicite) — doit être 0, bloquant.
8. Taux de complétion multi-tours.

Le script renvoie 1 si un bloquant est non nul ou si le taux de réussite est < 95 %.
