---
name: integration-check
description: Vérifier la compatibilité entre apps/web, services/api et les contrats partagés (Pydantic ↔ JSON Schema ↔ TypeScript ↔ OpenAPI), et que la charge utile confirmée est consommable par le module de planification de l'autre équipe.
---

# Vérification d'intégration

## Liste de contrôle
1. **Contrats valides** : `uv run --with jsonschema python scripts/validate_contracts.py`.
2. **Pydantic ↔ JSON Schema** : `cd services/api && uv run python ../../scripts/export_schemas.py --check` — aucune dérive.
3. **OpenAPI ↔ TypeScript** : API lancée, puis `cd apps/web && pnpm gen:types` et comparer avec `src/types/contracts.ts`.
4. **Endpoints ↔ docs/API.md** : chaque route de `/openapi.json` y figure avec les mêmes méthode/chemin/codes.
5. **Parcours** : `./scripts/dev.sh`, puis avec `curl` : créer → message → requirements → patch → confirm → export ; l'export valide contre `requirements.schema.json`.
6. **Parité démo** : le service simulé d'`apps/web` renvoie des objets valides contre `conversation_response.schema.json` (test unitaire ajv).
7. **Aval** : partager `packages/contracts/requirements.schema.json` + exemple avec l'équipe planification ; convenir du transport (`GET /export` par défaut). Consigner l'accord dans `docs/DECISIONS.md`.
8. **Sécurité** : `grep -r "NEXT_PUBLIC_.*KEY" apps/web` vide ; `git log -p | grep -i "sk-"` vide ; audio non persisté ; aucun contenu de message dans les logs INFO.

Consigner les constats dans `docs/HANDOFF.md` ; corriger toute dérive de contrat avant le reste.
