# Chatbot enseignants SNCF liO — Instructions pour les agents

Ce fichier est la source unique des règles du projet pour tout agent de code (OpenAI Codex, Claude Code) et pour les humains. `CLAUDE.md` l'importe ; ne dupliquez pas les règles ailleurs. En cas de contradiction avec un autre fichier, ce fichier l'emporte : corrigez l'autre.

## 1. Ce que nous construisons

Un chatbot professionnel en français qui permet à des enseignants de décrire une sortie pédagogique (Occitanie, trains régionaux liO) **à la voix ou au clavier**, et qui extrait, clarifie et confirme **exactement quatre informations** :

| Champ | Libellé | Signification |
|---|---|---|
| `participants_count` | Nombre de participants | Élèves + accompagnateurs, total |
| `departure` | Date et heure de départ | Date, heure et nature de la contrainte horaire |
| `return` | Date et heure de retour | Date, heure et nature de la contrainte horaire |
| `teaching_type` | Type / thème pédagogique | Matière **ou** thème : l'un des deux suffit |

Après confirmation explicite de l'enseignant, le backend émet une charge utile JSON versionnée (`packages/contracts/requirements.schema.json`) destinée au module de planification d'itinéraire d'une autre équipe.

**Hors périmètre (ne pas implémenter) :** recherche de destinations/activités, horaires liO, planification d'itinéraire, budget, réservation, collecte d'âge/établissement/gare/budget ou de toute autre donnée personnelle.

Lire `docs/PRODUCT.md` (définition produit) et `docs/ARCHITECTURE.md` (conception) avant de toucher au code.

## 2. L'architecture en un paragraphe

`apps/web` (Next.js + TypeScript + Tailwind + shadcn/ui) est un client fin qui affiche l'état renvoyé par le serveur. `services/api` (FastAPI + Pydantic v2) détient toute la logique métier : transcription (OpenAI `gpt-transcribe`), extraction structurée par LLM produisant un **RequirementPatch**, fusion déterministe des patches, validation, **machine à états** et gestionnaire de dialogue qui choisit la prochaine question. PostgreSQL stocke conversations, messages et instantanés (SQLite autorisé en dev/tests). Le LLM ne décide jamais du flux ; le code le fait.

## 3. Invariants non négociables

1. **Le LLM comprend la langue ; le code gère l'état.** Transitions, validation, totaux et « quoi demander ensuite » vivent dans `services/api/app/domain/`, jamais dans les prompts ni dans le frontend.
2. **Patch, pas réécriture.** Le modèle renvoie un `RequirementPatch` ; `patch_merger.py` l'applique. Un champ valide n'est jamais perdu sauf correction explicite de l'enseignant.
3. **Ne jamais inventer.** Inconnu reste `null`. Une ambiguïté (« 25 élèves » sans accompagnateurs, « le mois prochain ») produit une question, pas une supposition.
4. **Conserver la contrainte horaire :** `exact | approximate | earliest | latest` (à 8 h / vers 8 h / après 8 h / avant 17 h).
5. **Seule une confirmation explicite de l'utilisateur** fait passer en `CONFIRMED`. Le modèle ne peut jamais le faire.
6. **Ne jamais redemander** une information déjà connue et valide.
7. **Le contrat est versionné.** Les modèles Pydantic de `app/schemas/` sont la source de vérité ; les JSON Schema sont générés (`scripts/export_schemas.py`, dérive bloquante en CI). Tout changement exige : incrément de `schema_version`, mise à jour de `docs/API.md` et des exemples, entrée dans `docs/DECISIONS.md`, compatibilité ascendante au sein d'une version majeure.
8. **Les secrets ne quittent jamais le backend.** Aucun secret `NEXT_PUBLIC_*`, aucune clé dans Git ni dans les logs. En local, les identifiants viennent du trousseau macOS via `./tools/with-api-env` (§11) ; ailleurs, de l'environnement.
9. **Tout texte visible par l'utilisateur est en français.** Code, commentaires, commits et documentation aussi (identifiants de code en anglais ; le prompt d'extraction lu par le modèle reste en anglais, ADR-010).
10. **Fuseau `Europe/Paris`** pour tout calcul de date/heure et toute résolution de date relative.
11. **Envoi de message idempotent** : un même `client_message_id` n'applique jamais deux fois un patch.
12. **Le mode démo (`NEXT_PUBLIC_DEMO_MODE=true`) est clairement signalé** et n'est jamais présenté comme la capacité réelle du modèle.

## 4. Organisation du dépôt

```
AGENTS.md / CLAUDE.md / README.md      règles, import Claude, démarrage rapide
apps/web/                              chatbot Next.js
services/api/                          service FastAPI
  app/api/      routes, deps       app/schemas/   modèles Pydantic (contrat)
  app/core/     configuration      app/db/        SQLAlchemy
  app/domain/   clock, patch_merger, validators, state_machine, dialogue, pipeline
  app/services/ extraction, conversation, providers/ (openai, fake)
  app/prompts/  extract_requirements.md, dialogue_policy.md (versionnés)
  tests/
packages/contracts/                    JSON Schema générés + exemples (contrat partagé)
docs/                                  PRODUCT, ARCHITECTURE, API, DECISIONS, HANDOFF, DEVELOPMENT, DEMO
evals/                                 cas français + evaluate.py
scripts/                               bootstrap, dev, test, check, demo, validate_contracts, export_schemas
.agents/skills/                        skills partagées (copie canonique, format Agent Skills)
.claude/skills/ -> ../../.agents/skills/*   liens symboliques pour Claude Code
.claude/agents/                        rôles (frontend, backend, ai, qa) ; .claude/settings.json : hooks
tools/                                 lanceurs d'identifiants locaux (gpt, stitch, with-api-env)
.github/workflows/ci.yml               CI
```

## 5. Pile technique (fixée)

Frontend : Next.js (App Router), React, TypeScript strict, Tailwind CSS, shadcn/ui (+ primitives AI Elements si installées), Motion, hook React maison + API JSON (pas de transport AI SDK en v1). Backend : Python ≥ 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (Alembic lors du passage PostgreSQL, ADR-013), `uv`, pytest. IA : OpenAI Responses API avec Structured Outputs strict (`EXTRACTION_MODEL`, défaut `gpt-5.4-mini`), transcription OpenAI (`TRANSCRIPTION_MODEL`, défaut `gpt-transcribe`). Tous les appels passent par un adaptateur ; le code métier n'importe jamais le SDK OpenAI. Tests : pytest, Vitest, Playwright. Design : Google Stitch via `./tools/stitch` — référence visuelle, jamais du HTML livré.

## 6. Lancer le projet

```sh
./scripts/bootstrap.sh    # vérifie l'outillage, installe, crée .env depuis .env.example
./scripts/dev.sh          # API :8000 (clé injectée depuis le trousseau) + web :3000
./scripts/demo.sh         # web seul, mode démo simulé, sans clé
./scripts/test.sh         # contrats + pytest + vitest
./scripts/check.sh        # tout ce que fait la CI : lint, types, tests, build, contrats
cd services/api && ../../tools/with-api-env gpt -- uv run python ../../evals/evaluate.py   # évaluations françaises
```

Détails dans `docs/DEVELOPMENT.md`, script de démonstration dans `docs/DEMO.md`.

## 7. Procédure pour chaque tâche

1. Lire `docs/HANDOFF.md` (état, prochaines étapes), puis la documentation utile à la tâche.
2. Inspecter le code existant avant d'ajouter ; réutiliser adaptateurs, schémas, helpers.
3. Identifier les modules touchés et l'impact sur le contrat. Si le contrat change, appliquer l'invariant 7 d'abord.
4. Écrire ou mettre à jour les tests **avec** le changement (unitaires pour `domain/`, API pour les routes, composants pour l'UI, cas d'évaluation pour les prompts).
5. Exécuter `./scripts/check.sh` (ou le sous-ensemble pertinent) jusqu'au vert.
6. Mettre à jour la doc : `docs/HANDOFF.md` toujours ; `docs/DECISIONS.md` pour tout choix d'architecture ; `docs/API.md` pour tout changement d'API.
7. Commit en Conventional Commits (description en français) ; résumer les fichiers modifiés dans le message final.

Utiliser les skills du projet (`.agents/skills/` : `frontend-implementation`, `api-development`, `prompt-engineering`, `conversation-testing`, `integration-check`, `git-workflow`) : elles détaillent les procédures.

## 8. Style de code

- Python : `ruff` (format + lint), annotations de types partout, `mypy --strict` sur `app`. Modèle Pydantic à chaque frontière d'E/S. Aucune logique métier dans les routes. Un hook Claude Code formate automatiquement les `.py` édités.
- TypeScript : `strict`, ESLint (next/core-web-vitals), Prettier. Composants dans `src/components/chatbot/`, un par fichier, props typées, aucune logique de champs dupliquée côté client.
- Fonctions petites et déterministes ; privilégier les fonctions pures dans `domain/`.
- Suivre le style du code voisin. Les commentaires expliquent le *pourquoi*, pas le *quoi*.

## 9. Git et collaboration

- Branches : `main` (protégée, toujours démontrable) + `feature/<sujet>` (`feature/chat-ui`, `feature/speech-to-text`, `feature/requirements-extraction`, `feature/conversation-manager`).
- Conventional Commits : `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:` — description en français.
- Ne jamais committer `.env`, audio, bases de données, ni `artifacts/` ou `.local/`.
- CI (`.github/workflows/ci.yml`) verte avant fusion : contrats, pytest, tsc, eslint, build.
- Ne pas redémarrer les services de l'hôte (un PostgreSQL étranger écoute déjà sur 5432 ; le Postgres Docker du projet utilise 5433) ni lancer de travaux lourds pour valider des identifiants.

## 10. Définition de « terminé »

Tests présents et verts ; `./scripts/check.sh` vert ; textes utilisateur en français ; aucun secret ni donnée personnelle dans les logs ; `docs/HANDOFF.md` décrit le nouvel état ; contrat inchangé ou correctement versionné ; le changement se prévisualise avec `./scripts/dev.sh` ou `./scripts/demo.sh`.

## 11. Accès API persistant (machine locale)

- Lire `TOOLS.md` pour les exemples d'invocation et le dernier résultat de vérification.
- La clé GPT (étiquette `sncf` dans la note d'origine) est dans le trousseau macOS, service `sncf-openai-api-key`, compte = utilisateur macOS courant.
- Stitch réutilise le service `medici-stitch-api-key`, même compte. L'intégration d'origine se trouve dans `/Users/zephyrsui/Developer/meidiqi/medici-ui-prototype`.
- Utiliser `./tools/gpt`, `./tools/stitch` ou `./tools/with-api-env gpt|stitch|all -- COMMANDE ...`. Ils lisent les identifiants à l'exécution ; la note d'origine n'est plus une dépendance.
- Ne jamais afficher les identifiants, les passer en argument, les committer, les mettre dans le frontend ni les exposer via le traçage shell ou un dump d'environnement.
- `gpt request` appelle la Responses API et exige un modèle explicite. `stitch call` peut modifier des ressources distantes : n'écrire que ce qu'exige la tâche en cours. Cette configuration n'autorise pas la modification des projets Medici existants.
- Ces commandes chargent des identifiants ; elles n'isolent rien. Les règles de sécurité de l'hôte s'appliquent avant tout développement, build, test ou déploiement.
