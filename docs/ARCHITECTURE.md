# Architecture

```
Web Next.js (apps/web)                 FastAPI (services/api)
┌──────────────────────────┐  REST    ┌─────────────────────────────────────┐
│ ChatContainer            │ ───────▶ │ api/routes.py  (/api/v1, thin)      │
│ VoiceRecorder            │          │ services/conversation.py  orchestr. │
│ RequirementsPanel        │ ◀─────── │ services/extraction.py    prompt    │
│ ConfirmationCard         │  JSON    │ services/providers/openai|fake      │
└──────────────────────────┘          │ domain/pipeline.py  (pure turn)     │
                                      │   patch_merger → validators →       │
                                      │   state_machine → dialogue          │
                                      └───────┬───────────────┬─────────────┘
                                              ▼               ▼
                                        OpenAI API       PostgreSQL / SQLite
                                   (transcribe, extract) (conversations, messages,
                                                          snapshots, idempotency)
```

## Request pipeline (text message)

1. `POST /conversations/{id}/messages` with `content` + `client_message_id`. If the identifier has already been processed → stored response (idempotency), no model call.
2. Load the conversation, the current requirements (`PartialRequirements`) and the last 8 messages.
3. **Extraction** (`services/extraction.py`): prompt `prompts/extract_requirements.md` + Paris date/time + current state + recent history; call through the adapter with strict Structured Outputs on the Pydantic schema `RequirementPatch` (`responses.parse`). Provider failure → 502/504, state intact, French error message, replayable with the same `client_message_id`.
4. **Merge** (`domain/patch_merger.py`, pure): apply the operations; `participants_count` computed by the code from `participants_mentioned` (students + accompanying adults, or stated total); `replace`/correction intent replaces; `set` on a different known value becomes a conflict; a return time without a date inherits the departure date.
5. **Validation** (`domain/validators.py`, pure): missing fields, return ≤ departure, departure in the past, invalid headcount. A return earlier than the departure is rolled back (value introduced this turn) and a correction is requested.
6. **State machine** (`domain/state_machine.py`, pure): (previous state, intent, changed fields, conflicts, inconsistencies, ambiguities, missing) → next state + a single `Action` (priority: conflict > inconsistency > blocking ambiguity > missing > summary).
7. **Dialogue** (`domain/dialogue.py`): French templates per action. Optional LLM rephrasing (`prompts/dialogue_policy.md`), with no write access to the state.
8. Persistence in one transaction: user message, assistant message, snapshot `version + 1` if changed, state, response memoised for idempotency. Returns a `ConversationResponse`.

Audio: `POST /conversations/{id}/audio` → type/size check → transcription adapter → `transcript` returned **without extraction**; the client lets the teacher correct it and then sends it through `/messages` (`source: "audio"`). Audio bytes are never kept.

Edit: `PATCH /requirements` builds a `replace` patch (correction intent) and follows the same pipeline, so an edit in the panel and a correction through the chat behave identically. `expected_version` → 409 on mismatch.

Confirmation: `POST /confirm` is only accepted in `AWAITING_CONFIRMATION` (or `EDITING`) with a complete state; it freezes a `ConfirmedRequirements` (`schema_version 1.0`) and moves to `CONFIRMED`. A confirmation through the chat (« oui, je confirme ») is only accepted if the previous state is `AWAITING_CONFIRMATION` and the message changes nothing (ADR-016). Any later modification cancels the confirmed snapshot and requires a new confirmation.

## States

```
COLLECTING ─▶ [EXTRACTING ─▶ VALIDATING] ─┬─▶ COLLECTING             (missing field)
                                          ├─▶ ASKING_USER            (ambiguity / conflict / inconsistency)
                                          └─▶ AWAITING_CONFIRMATION
AWAITING_CONFIRMATION ─▶ CONFIRMED ─▶ (HANDOFF via /export)
AWAITING_CONFIRMATION / CONFIRMED ─▶ (edit) ─▶ AWAITING_CONFIRMATION (REOPEN_EDIT) or COLLECTING
```
`EXTRACTING`/`VALIDATING` are never persisted. Transitions are a pure function, exhaustively tested (`tests/test_state_machine.py`).

## Why these choices (details in DECISIONS.md)

- **Patch rather than full re-extraction**: stable state, traceable changes, swappable model.
- **The code owns the flow**: avoids re-asking, accidental additions, invented dates, self-confirmation.
- **Templates first** for assistant messages: cheaper, faster, deterministic.
- **Provider adapter**: `OpenAIProvider` implements `ExtractionProvider` + `TranscriptionProvider`; `FakeProvider` feeds tests and demo mode.
- **Thin frontend**: renders `ConversationResponse`; no duplicated field logic.
- **SQLite in dev/tests, Postgres in deployment** through SQLAlchemy 2.
- **Structure inspired by well-known projects** (ADR-012): `full-stack-fastapi-template` (`api/core/schemas` split), Rasa Forms ("requested slot"), `vercel/ai-chatbot` + AI Elements (chat UI).

## Security, privacy, reliability

API key only in the backend process (Keychain injection locally, environment elsewhere). Audio limits (`MAX_AUDIO_BYTES`, `MAX_AUDIO_SECONDS` on the client side), timeouts, per-conversation rate limiting. Audio never stored; logs contain neither transcripts nor personal data. One transaction per request; idempotency by `client_message_id`; a provider failure leaves the state intact.
