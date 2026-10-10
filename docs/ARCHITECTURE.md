# Architecture

```
Web Next.js (apps/web)                 FastAPI (services/api)
┌──────────────────────────┐  REST    ┌─────────────────────────────────────┐
│ ChatContainer            │ ───────▶ │ api/routes.py  (/api/v1, fines)     │
│ VoiceRecorder            │          │ services/conversation.py  orchestr. │
│ RequirementsPanel        │ ◀─────── │ services/extraction.py    prompt    │
│ ConfirmationCard         │  JSON    │ services/providers/openai|fake      │
└──────────────────────────┘          │ domain/pipeline.py  (tour pur)      │
                                      │   patch_merger → validators →       │
                                      │   state_machine → dialogue          │
                                      └───────┬───────────────┬─────────────┘
                                              ▼               ▼
                                        API OpenAI       PostgreSQL / SQLite
                                   (transcribe, extract) (conversations, messages,
                                                          instantanés, idempotence)
```

## Pipeline d'une requête (message texte)

1. `POST /conversations/{id}/messages` avec `content` + `client_message_id`. Si l'identifiant a déjà été traité → réponse stockée (idempotence), aucun appel au modèle.
2. Chargement de la conversation, des informations courantes (`PartialRequirements`) et des 8 derniers messages.
3. **Extraction** (`services/extraction.py`) : prompt `prompts/extract_requirements.md` + date/heure Paris + état courant + historique récent ; appel via l'adaptateur avec Structured Outputs strict sur le schéma Pydantic `RequirementPatch` (`responses.parse`). Échec du fournisseur → 502/504, état intact, message d'erreur français, rejouable avec le même `client_message_id`.
4. **Fusion** (`domain/patch_merger.py`, pure) : application des opérations ; `participants_count` calculé par le code à partir de `participants_mentioned` (élèves + accompagnateurs, ou total énoncé) ; `replace`/intention de correction remplace ; `set` sur une valeur connue différente devient un conflit ; heure de retour sans date hérite de la date de départ.
5. **Validation** (`domain/validators.py`, pure) : champs manquants, retour ≤ départ, départ passé, effectif invalide. Un retour antérieur au départ est annulé (valeur introduite ce tour) et une correction est demandée.
6. **Machine à états** (`domain/state_machine.py`, pure) : (état précédent, intention, champs modifiés, conflits, incohérences, ambiguïtés, manquants) → état suivant + une seule `Action` (priorité : conflit > incohérence > ambiguïté bloquante > manquant > récapitulatif).
7. **Dialogue** (`domain/dialogue.py`) : gabarits français par action. Reformulation LLM optionnelle (`prompts/dialogue_policy.md`), sans accès en écriture à l'état.
8. Persistance en une transaction : message utilisateur, message assistant, instantané `version + 1` si changement, état, réponse mémorisée pour l'idempotence. Retour d'une `ConversationResponse`.

Audio : `POST /conversations/{id}/audio` → contrôle type/taille → adaptateur de transcription → `transcript` renvoyé **sans extraction** ; le client laisse l'enseignant corriger puis envoie par `/messages` (`source: "audio"`). Les octets audio ne sont jamais conservés.

Modification : `PATCH /requirements` construit un patch `replace` (intention de correction) et suit le même pipeline, donc une modification dans le panneau et une correction par chat se comportent identiquement. `expected_version` → 409 en cas de décalage.

Confirmation : `POST /confirm` n'est acceptée qu'en `AWAITING_CONFIRMATION` (ou `EDITING`) avec un état complet ; elle fige un `ConfirmedRequirements` (`schema_version 1.0`) et passe en `CONFIRMED`. Une confirmation par chat (« oui, je confirme ») n'est acceptée que si l'état précédent est `AWAITING_CONFIRMATION` et que le message ne change rien (ADR-016). Toute modification ultérieure annule l'instantané confirmé et impose une nouvelle confirmation.

## États

```
COLLECTING ─▶ [EXTRACTING ─▶ VALIDATING] ─┬─▶ COLLECTING             (champ manquant)
                                          ├─▶ ASKING_USER            (ambiguïté / conflit / incohérence)
                                          └─▶ AWAITING_CONFIRMATION
AWAITING_CONFIRMATION ─▶ CONFIRMED ─▶ (HANDOFF via /export)
AWAITING_CONFIRMATION / CONFIRMED ─▶ (modification) ─▶ AWAITING_CONFIRMATION (REOPEN_EDIT) ou COLLECTING
```
`EXTRACTING`/`VALIDATING` ne sont jamais persistés. Les transitions sont une fonction pure testée exhaustivement (`tests/test_state_machine.py`).

## Pourquoi ces choix (détails dans DECISIONS.md)

- **Patch plutôt que ré-extraction complète** : état stable, changements traçables, modèle interchangeable.
- **Le code possède le flux** : évite les redemandes, les additions accidentelles, les dates inventées, l'autoconfirmation.
- **Gabarits d'abord** pour les messages de l'assistant : moins cher, plus rapide, déterministe.
- **Adaptateur de fournisseur** : `OpenAIProvider` implémente `ExtractionProvider` + `TranscriptionProvider` ; `FakeProvider` alimente tests et mode démo.
- **Frontend fin** : affiche `ConversationResponse` ; aucune logique de champs dupliquée.
- **SQLite en dev/tests, Postgres en déploiement** via SQLAlchemy 2.
- **Structure inspirée de projets reconnus** (ADR-012) : `full-stack-fastapi-template` (découpage `api/core/schemas`), Rasa Forms (« requested slot »), `vercel/ai-chatbot` + AI Elements (UI de chat).

## Sécurité, confidentialité, fiabilité

Clé API uniquement dans le processus backend (injection trousseau en local, environnement ailleurs). Limites audio (`MAX_AUDIO_BYTES`, `MAX_AUDIO_SECONDS` côté client), délais d'attente, limitation de débit par conversation. Audio jamais stocké ; les logs ne contiennent ni transcriptions ni données personnelles. Transaction par requête ; idempotence par `client_message_id` ; un échec du fournisseur laisse l'état intact.
