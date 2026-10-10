# Guide de développement

## Prérequis

Node ≥ 20 et `pnpm` ; Python ≥ 3.12 et `uv` ; Docker optionnel (Postgres). Sur le Mac de développement, la clé OpenAI est lue dans le trousseau par `./tools/with-api-env` (voir `TOOLS.md`) ; ne jamais la mettre dans `.env` ici.

## Commandes

| Commande | Effet |
|---|---|
| `./scripts/bootstrap.sh` | Vérifie l'outillage, `uv sync` dans `services/api`, `pnpm install` dans `apps/web`, crée `.env` depuis `.env.example`, vérifie le trousseau (non bloquant) |
| `./scripts/dev.sh` | API via `with-api-env gpt -- uv run uvicorn …` sur :8000 et web `pnpm dev` sur :3000 ; Ctrl‑C arrête les deux |
| `./scripts/demo.sh` | Web seul avec `NEXT_PUBLIC_DEMO_MODE=true` (sans clé, sans backend) |
| `./scripts/test.sh` | Validation des contrats, `pytest`, `vitest` |
| `./scripts/check.sh` | `test.sh` + `ruff`, `mypy`, dérive des schémas, `tsc`, `eslint`, `next build` — identique à la CI |
| `cd services/api && ../../tools/with-api-env gpt -- uv run python ../../evals/evaluate.py` | Évaluations d'extraction contre le vrai modèle |
| `cd services/api && uv run python ../../scripts/export_schemas.py` | Régénère les JSON Schema après un changement de modèle Pydantic |

Les scripts ignorent les composants absents et le disent ; ils n'échouent jamais parce qu'une phase n'a pas commencé.

## Environnements

- `DATABASE_URL` : SQLite dans `.local/` par défaut (ignoré par Git). `docker compose up -d db` fournit Postgres sur `localhost:5433` (`sncf`/`sncf`, base `sncf_chatbot`) : `DATABASE_URL=postgresql+psycopg://sncf:sncf@localhost:5433/sncf_chatbot`.
- `NEXT_PUBLIC_DEMO_MODE=true` bascule le web sur le service de conversation simulé avec un badge « Mode démo » visible.

## Ajouter une fonctionnalité

1. Branche `feature/<sujet>`.
2. Si le contrat change : modifier les modèles Pydantic, régénérer `packages/contracts`, incrémenter la version, mettre à jour exemples, `docs/API.md`, `DECISIONS.md` — en premier.
3. Backend : schéma → domaine (pur + tests) → service → route → test API.
4. Frontend : composant dans `src/components/chatbot/`, typé contre `src/types/contracts.ts`, tests Vitest/Testing Library ; Playwright pour le parcours complet en mode démo.
5. Changement de prompt : éditer `services/api/app/prompts/*.md` (incrémenter la version), ajouter des cas d'évaluation, lancer les évaluations, consigner les résultats dans `HANDOFF.md`.
6. `./scripts/check.sh` vert → commit Conventional → PR → CI → fusion.

## Stratégie de test

- `domain/` : tests unitaires pilotés par des formulations françaises (fusion, validation, transitions, formatage des dates avec horloge figée).
- API : `TestClient` + `FakeProvider` ; idempotence, 409 sur version obsolète, échec du fournisseur sans modification d'état, conformité des réponses au contrat publié.
- Évaluations (`evals/`) : vrai modèle, métriques dans `evals/README.md` ; bloquants = remplissages non fondés, fausses confirmations, champs perdus.
- Web : tests de composants ; parcours Playwright en mode démo (texte → question → modification → confirmation → JSON affiché).

## Outils d'IA pour le développement

- **Agents de rôle** (`.claude/agents/`) : `frontend`, `backend`, `ai`, `qa` ; **skills** (`.agents/skills/`) partagées Codex/Claude.
- **Hooks** (`.claude/settings.json`) : formatage et correction `ruff` automatiques à chaque édition d'un `.py` du backend.
- **Évaluations** comme test de régression des prompts : toute modification de prompt = nouveau passage et résultats consignés.
- **Stitch** : `./tools/stitch tools` liste les outils ; `./tools/stitch call <outil> @args.json` génère/édite des écrans avec le prompt de `docs/DEMO.md`. Références sous `artifacts/` (ignoré par Git). Réimplémenter en composants React — jamais coller le HTML généré.
