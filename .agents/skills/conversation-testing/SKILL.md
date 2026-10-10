---
name: conversation-testing
description: Générer et exécuter des tests de conversation multi-tours en français contre l'API (FakeProvider ou vrai modèle) et l'interface (Playwright en mode démo), couvrant champs manquants, ambiguïtés, corrections, conflits, idempotence, restauration de session et confirmation.
---

# Tests de conversation

## Lire d'abord
`docs/PRODUCT.md` (déroulé + règles d'ambiguïté), `docs/ARCHITECTURE.md` (états), `evals/french_cases.jsonl`, `services/api/tests/test_api.py` (fixtures `mk_patch`, `op`, `dt`, `tt`, `COMPLETE_PATCH`).

## Matrice de scénarios (chacun doit avoir un test)
| Scénario | Entrée | Attendu |
|---|---|---|
| Complet en un message | 4 champs | `AWAITING_CONFIRMATION`, récapitulatif |
| Participants manquants | heure + thème | demande seulement les participants |
| Retour manquant | départ seul | demande seulement le retour |
| Matière seule / thème seul | « prof d'histoire » / « le Moyen Âge » | teaching_type valide |
| Effectif décomposé | « 25 élèves et 3 professeurs » | 28 |
| Élèves seuls | « 25 élèves » | demande les accompagnateurs ; total reste null |
| Correction | « finalement, 30 en tout » | remplacement, pas addition |
| Date vague | « le mois prochain » | demande la date exacte |
| Contrainte | « avant 17 h » | `latest` |
| Retour avant départ | 17 h → 8 h | demande une correction, valeur non conservée |
| Conflit sans correction | 30 dit, puis « nous sommes 28 » | demande laquelle retenir |
| Double envoi | même `client_message_id` deux fois | un seul patch, même réponse |
| Restauration de session | GET après rechargement | état identique |
| Modification après confirmation | PATCH en `CONFIRMED` | `AWAITING_CONFIRMATION`, export invalidé |
| Échec du fournisseur | FakeProvider lève | 502/504, état inchangé, rejouable |
| Audio | fichier webm | `transcript` sans extraction ; 400 type inconnu ; 413 trop gros |

## Procédure
1. Tests API multi-tours dans `services/api/tests/test_api.py`, pilotés par `FakeProvider` avec des patches scriptés par tour ; vérifier `state`, `missing_fields`, `requirements`, `version` et le texte français de `assistant_message`.
2. Passages avec le vrai modèle : `evals/evaluate.py` (cas avec `turns`), métriques dans `evals/README.md`.
3. Parcours UI : Playwright en mode `./scripts/demo.sh` : texte → question → mise à jour du panneau → modification → confirmation → JSON visible ; états du micro avec un MediaRecorder simulé.
4. Tout bogue trouvé → d'abord le cas qui échoue, puis la correction.
