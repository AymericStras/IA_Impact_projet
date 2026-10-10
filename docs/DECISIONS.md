# Décisions d'architecture

Journal en ajout seul. Format : date, décision, pourquoi, conséquences. Les plus récentes en bas.

## ADR-001 — 2026-10-10 — Extraction par patch, état possédé par le code
Le modèle renvoie un `RequirementPatch` par message ; `patch_merger` l'applique. La ré-extraction complète a été écartée : elle perd des données confirmées, additionne mal les corrections et fait dépendre chaque tour de toute la transcription. Conséquence : schéma de patch strict, fonction de fusion pure, tests exhaustifs.

## ADR-002 — 2026-10-10 — Contrainte horaire à quatre valeurs
`exact | approximate | earliest | latest` conservée sur départ/retour pour que le planificateur distingue « retour à 17 h » de « retour avant 17 h ». Fait partie du contrat externe dès 1.0.

## ADR-003 — 2026-10-10 — Totaux calculés par le code
Le modèle rapporte `participants_mentioned {students, accompanying, total_stated}` ; le code calcule `participants_count`. « 25 élèves » seul est une ambiguïté, pas un total.

## ADR-004 — 2026-10-10 — Dialogue par gabarits d'abord
Les questions viennent de gabarits français indexés par `ActionKind` ; la reformulation LLM (`dialogue_policy.md`) est optionnelle et en lecture seule. Moins cher, déterministe, testable.

## ADR-005 — 2026-10-10 — L'endpoint audio ne renvoie que la transcription
La voix est transcrite, affichée pour correction, puis envoyée comme texte. Un seul pipeline de dialogue ; les erreurs de reconnaissance sont corrigées par l'enseignant avant extraction.

## ADR-006 — 2026-10-10 — Modèles et identifiants
Défauts : `TRANSCRIPTION_MODEL=gpt-transcribe`, `EXTRACTION_MODEL=gpt-5.4-mini` (effort de raisonnement `low`), confirmés disponibles sur la clé du projet le 2026-10-10. En local la clé est injectée depuis le trousseau macOS par `tools/with-api-env`, jamais dans `.env`. Conséquence : `scripts/dev.sh` enveloppe le processus API avec `with-api-env gpt`.

## ADR-007 — 2026-10-10 — Hook React maison plutôt que le transport Vercel AI SDK
`useConversation()` + API JSON. `useChat` attend son propre protocole de flux ; l'adapter à FastAPI ajoute du travail sans valeur pour un dialogue de remplissage de 4 champs. Les **composants** AI Elements (shadcn) restent utilisables sans ce transport (ADR-012). À revoir si le streaming de tokens devient un besoin de démo.

## ADR-008 — 2026-10-10 — SQLite en dev/tests, Postgres (port 5433) en déploiement
L'hôte exécute déjà un Postgres étranger sur 5432. SQLAlchemy 2 garde les deux chemins identiques.

## ADR-009 — 2026-10-10 — Skills partagées dans `.agents/skills`, liées dans `.claude/skills`
Une copie canonique de chaque skill (format Agent Skills) pour que Codex et Claude Code suivent les mêmes procédures. `AGENTS.md` est l'unique fichier de règles ; `CLAUDE.md` l'importe.

## ADR-010 — 2026-10-10 — Langue du dépôt : français
Décision initiale (anglais) remplacée à la demande du responsable du projet : documentation, commentaires, messages de commit et tests en français ; identifiants de code en anglais ; le prompt système d'extraction reste en anglais (lu par le modèle, meilleure fiabilité) ; textes utilisateur en français.

## ADR-011 — 2026-10-10 — Date de retour héritée du départ
Une heure de retour sans date (« Avant 18 h. ») prend la date de départ connue, et inversement : les sorties pédagogiques sont des sorties à la journée. L'enseignant peut corriger ; un retour antérieur au départ est rejeté et redemandé. Alternative écartée : demander systématiquement la date de retour (un tour de plus pour tous).

## ADR-012 — 2026-10-10 — Références open source empruntées
Structure et patrons seulement, pas leurs runtimes : `fastapi/full-stack-fastapi-template` (découpage `app/api`, `app/core/config.py`, `deps.py`), Rasa Forms (remplissage par « requested slot » + actions de validation → notre `state_machine` + `validators`), `vercel/ai-chatbot` et AI Elements (primitives d'interface de chat sur shadcn). Rien de ce qui entre en conflit avec les invariants (ex. LLM pilotant le flux) n'a été repris.

## ADR-013 — 2026-10-10 — Alembic différé
Hackathon : `Base.metadata.create_all` au démarrage. Alembic sera introduit avec le premier déploiement PostgreSQL (`DATABASE_URL=postgresql+psycopg://…`). Tant que le schéma SQL n'est pas figé, les migrations n'apportent rien.

## ADR-014 — 2026-10-10 — Pydantic source de vérité ; JSON Schema générés
Les fichiers de `packages/contracts/*.schema.json` sont produits par `scripts/export_schemas.py` et vérifiés en CI (`--check`). Les modèles ont `extra="forbid"`. Les contraintes inexprimables en JSON Schema (ex. « matière ou thème ») sont des validateurs Pydantic documentés.

## ADR-015 — 2026-10-10 — Historique récent fourni au modèle d'extraction
Les 8 derniers messages (dont la dernière question de l'assistant) accompagnent chaque extraction ; règle 20 du prompt v1.1 : une réponse brève répond à la question en attente. Sans cela, « Avant 18 h. » n'est pas rattachable au retour (constaté en évaluation : 84 % → 96 %).

## ADR-016 — 2026-10-10 — Confirmation par chat strictement encadrée
L'intention `confirm` du modèle n'entraîne `CONFIRMED` que si l'état précédent est `AWAITING_CONFIRMATION`, que tout est complet et que le message ne modifie rien. Le bouton « Confirmer et continuer » (`POST /confirm`, avec `expected_version`) reste la voie principale. Protège contre une fausse confirmation du modèle.
