# SNCF liO — Assistant de voyage pédagogique

Chatbot IA en français (voix + texte) qui aide les enseignants à décrire une sortie pédagogique et en extrait quatre informations confirmées — participants, départ, retour, matière/thème — sous forme d'un contrat JSON versionné destiné au module de planification d'itinéraire développé par d'autres membres de l'équipe.

Projet de hackathon, conçu comme un **dépôt « AI-native »** : OpenAI Codex et Claude Code peuvent reprendre le développement à tout moment à partir de `AGENTS.md` / `CLAUDE.md` et `docs/HANDOFF.md`.

## Démarrage rapide

```sh
./scripts/bootstrap.sh   # outillage + dépendances + .env
./scripts/demo.sh        # démo simulée, sans clé → http://localhost:3000
./scripts/dev.sh         # mode IA réel : FastAPI :8000 + Next.js :3000
./scripts/test.sh
./scripts/check.sh
```

Prérequis : Node ≥ 20 + pnpm, Python ≥ 3.12 + [uv](https://docs.astral.sh/uv/), Docker optionnel (Postgres sur 5433). Sur le Mac de développement, la clé OpenAI est lue dans le trousseau macOS par `./tools/with-api-env` ; ailleurs, définir `OPENAI_API_KEY` dans l'environnement (voir `.env.example`).

## Organisation

| Chemin | Contenu |
|---|---|
| `apps/web` | Interface du chatbot Next.js (français) |
| `services/api` | FastAPI : transcription, extraction structurée, machine à états, validation |
| `packages/contracts` | JSON Schema (générés depuis Pydantic) + exemples partagés avec les autres modules |
| `docs/` | PRODUCT, ARCHITECTURE, API, DECISIONS, HANDOFF, DEVELOPMENT, DEMO |
| `evals/` | jeu de cas français et script d'évaluation |
| `scripts/` | bootstrap / dev / test / check / demo / validate_contracts / export_schemas |
| `.agents/skills`, `.claude/` | skills partagées, agents de rôle, hooks |

## État

Voir `docs/HANDOFF.md`.

## Pour l'équipe qui intègre le planificateur

Ne consommer que la sortie de `GET /api/v1/conversations/{id}/export` (ou le champ `confirmed_requirements` de la réponse de `POST …/confirm`), conforme à `packages/contracts/requirements.schema.json` (`schema_version` `1.0`). Exemple : `packages/contracts/examples/confirmed_requirements.json`. OpenAPI servi sur `http://localhost:8000/docs` quand l'API tourne.
