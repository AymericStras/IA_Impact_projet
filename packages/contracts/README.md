# Contrats

Le contrat de données partagé entre le chatbot, son frontend et les modules des autres équipes.

| Fichier | Consommateur | Rôle |
|---|---|---|
| `requirements.schema.json` | Module de planification (autre équipe) | Charge utile finale confirmée. **La seule chose dont dépendent les autres équipes.** |
| `conversation_response.schema.json` | `apps/web` | Forme de la réponse de tous les endpoints de conversation |
| `requirement_patch.schema.json` | extraction `services/api` | Ce que le LLM renvoie pour un message (Structured Outputs) |
| `examples/` | tous + CI | Instances valides ; `scripts/validate_contracts.py` les vérifie |

Règles (`AGENTS.md` §3.7, ADR-014) : les modèles Pydantic de `services/api/app/schemas/` sont la source de vérité ; ces fichiers sont **générés** par `scripts/export_schemas.py` (ne pas les éditer à la main ; `--check` échoue en CI en cas de dérive). Tout changement exige un incrément de `schema_version`, des exemples à jour, `docs/API.md` et une entrée dans `docs/DECISIONS.md`.

Sémantique du temps : `constraint` distingue « retour à 17 h » (`exact`) de « retour avant 17 h » (`latest`) — les planificateurs doivent traiter `latest` comme une borne supérieure, pas une cible. Toutes les dates/heures sont locales `Europe/Paris`.
