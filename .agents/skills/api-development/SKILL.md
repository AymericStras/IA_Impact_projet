---
name: api-development
description: Construire ou modifier les endpoints FastAPI, les schémas Pydantic, la logique de domaine (fusion de patch, validation, machine à états, dates) et la persistance dans services/api, conformément au contrat versionné de packages/contracts et docs/API.md.
---

# Développement de l'API

## Lire d'abord
`AGENTS.md` §3, `docs/ARCHITECTURE.md`, `docs/API.md`, `services/api/app/schemas/`, le code existant de `app/domain` et `app/services`.

## Règles
- Contrat d'abord : si le changement modifie une forme de requête/réponse, modifier les modèles Pydantic, régénérer `packages/contracts` (`uv run python ../../scripts/export_schemas.py`), mettre à jour exemples, `docs/API.md`, `docs/DECISIONS.md` et incrémenter `schema_version` avant de coder le reste.
- Couches : `api/` (routes fines) → `services/` (orchestration, adaptateurs) → `domain/` (fonctions pures, sans E/S ni framework). Les règles métier vivent dans `domain/` uniquement ; `domain/pipeline.py` enchaîne fusion → validation → décision → message.
- Chaque frontière d'E/S est un modèle Pydantic v2 (`extra="forbid"`). Les Structured Outputs utilisent `RequirementPatch` via `responses.parse` ; tous ses champs sont obligatoires (mode strict).
- Changements d'état en une transaction ; idempotence sur `client_message_id` ; `expected_version` → 409 ; erreurs du fournisseur → 502/504 sans toucher l'état (l'appel au modèle précède toute écriture).
- Dates : `zoneinfo.ZoneInfo("Europe/Paris")` ; horloge injectée (`Clock`, `FixedClock` en tests). SQLite ne conserve pas le fuseau : normaliser à la lecture (`_iso_paris`).
- Aucun import du SDK OpenAI hors `services/providers/openai_provider.py`. Les tests utilisent `FakeProvider` et surchargent `get_extraction_provider` / `get_transcription_provider` / `get_clock`.
- Logs : ni transcriptions, ni contenu de message, ni données personnelles au niveau INFO. Jamais l'environnement.
- `detail` d'erreur en français ; gabarits dans `app/domain/dialogue.py` (catalogue de référence dans `app/prompts/dialogue_policy.md`).

## Procédure
1. Écrire/ajuster le modèle Pydantic ; régénérer et vérifier les JSON Schema.
2. Implémenter la fonction de domaine pure avec des tests tabulaires (formulations françaises de `evals/french_cases.jsonl`).
3. Implémenter service/route ; ajouter des tests API (cas nominal, idempotence, 409, échec du fournisseur, conformité au contrat).
4. `cd services/api && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest -q`.
5. Lancer `./scripts/dev.sh` ; vérifier que `/docs` correspond à `docs/API.md`.
6. Mettre à jour `docs/HANDOFF.md`.
