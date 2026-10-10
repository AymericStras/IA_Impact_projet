# API — `/api/v1`

Version du contrat : `schema_version 1.0`. OpenAPI en direct sur `http://localhost:8000/docs`. Tous les endpoints de conversation renvoient une `ConversationResponse` (`packages/contracts/conversation_response.schema.json`). Les erreurs suivent la RFC 9457 (`application/problem+json`, `{type, title, status, detail}`) avec un `detail` en français.

| Méthode | Chemin | Corps | Notes |
|---|---|---|---|
| POST | `/conversations` | `{}` | 201 ; conversation en `COLLECTING` avec le message d'accueil |
| GET | `/conversations/{id}` | — | État complet pour rechargement / restauration de session |
| POST | `/conversations/{id}/messages` | `{ "content": str, "client_message_id": str, "source": "text"\|"audio" }` | Entrée texte. Idempotent sur `client_message_id` |
| POST | `/conversations/{id}/audio` | multipart `file` (webm/ogg/wav/mp4/m4a/mpeg/flac, ≤ `MAX_AUDIO_BYTES`) | Renvoie `transcript` ; **n'extrait pas**. Le client envoie le texte corrigé via `/messages` |
| GET | `/conversations/{id}/requirements` | — | Même réponse que GET conversation (état courant) |
| PATCH | `/conversations/{id}/requirements` | `{ "field": FieldName, "value": …, "expected_version": int }` | Modification depuis le panneau ; 409 si version obsolète. `value` : entier, `{date,time,constraint}`, `{subject,theme}` ou `null` (effacer) |
| POST | `/conversations/{id}/confirm` | `{ "expected_version": int }` | Seulement si l'état est complet et en attente de confirmation ; la réponse porte `confirmed_requirements` |
| GET | `/conversations/{id}/export` | — | Charge utile confirmée (`requirements.schema.json`) ; 409 si non confirmée |
| GET | `/health` | — | `{ "status": "ok", "extraction_model", "transcription_model" }` |

## Exemple de réponse

Voir `packages/contracts/examples/conversation_response.json`.

## Codes d'erreur

| Statut | Quand |
|---|---|
| 400 | Message vide, type audio non pris en charge, enregistrement vide |
| 404 | Conversation inconnue |
| 409 | `expected_version` obsolète ; confirmation hors `AWAITING_CONFIRMATION` ; export avant confirmation |
| 413 | Audio trop volumineux |
| 422 | Corps invalide |
| 429 | Limite de débit par conversation |
| 502 | Échec du fournisseur (OpenAI) — état inchangé, réessai possible |
| 504 | Délai dépassé côté fournisseur — état inchangé |

## Transmission au module aval

L'autre équipe lit `GET /conversations/{id}/export` (ou reçoit le même JSON par le transport convenu : webhook/fichier). Elle ne doit dépendre que de `requirements.schema.json`. Sémantique du temps : `constraint: "latest"` est une borne supérieure, pas une cible.

## Journal des changements

- 1.0 (2026-10-10) : contrat initial. `confirmed_requirements` ajouté à `ConversationResponse` avant toute publication (toujours 1.0).
