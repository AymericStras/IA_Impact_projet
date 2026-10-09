# Architecture

```
Next.js web (apps/web)                 FastAPI (services/api)
┌──────────────────────────┐  REST    ┌─────────────────────────────────────┐
│ ChatContainer            │ ───────▶ │ api/   routes (/api/v1)             │
│ VoiceRecorder            │          │ services/conversation.py  orchestr. │
│ RequirementsPanel        │ ◀─────── │ services/transcription.py  adapter  │
│ ConfirmationCard         │  JSON    │ services/extraction.py     adapter  │
└──────────────────────────┘          │ domain/patch_merger.py              │
                                      │ domain/validators.py                │
                                      │ domain/date_resolver.py             │
                                      │ domain/state_machine.py             │
                                      │ domain/dialogue.py (question picker)│
                                      └───────┬───────────────┬─────────────┘
                                              ▼               ▼
                                        OpenAI API       PostgreSQL / SQLite
                                   (transcribe, extract) (conversations, messages,
                                                          requirement snapshots)
```

## Request pipeline (text message)

1. `POST /conversations/{id}/messages` with `content` + `client_message_id`. If the id was already processed → return the stored response (idempotency).
2. Load conversation + current `PartialRequirements` + recent messages.
3. **Extraction** (`services/extraction.py`): build prompt from `prompts/extract_requirements.md` + current state + current Paris datetime + last N messages; call provider adapter with Structured Outputs using the Pydantic `RequirementPatch` JSON Schema (`strict: true`). On provider failure: state unchanged, French error message, retryable.
4. **Merge** (`domain/patch_merger.py`, pure): apply operations; compute `participants_count` from `participants_mentioned` (students + accompanying, or `total_stated`); `replace` only when intent is `correct_information` or field was null; `set` on a non-null differing value becomes a conflict.
5. **Validate** (`domain/validators.py`, pure): positive ints, parsable dates, return > departure, teaching_type non-empty, no fill of unknowns. Produces `missing_fields` and validation issues.
6. **State machine** (`domain/state_machine.py`, pure): given previous state, intent, missing fields, ambiguities, conflicts → next state + the single `DialogueAction` to perform (ask_missing(field), clarify(ambiguity), summarize_and_confirm, acknowledge_confirmation, reopen_edit).
7. **Dialogue** (`domain/dialogue.py`): French templates per action (v1). Optional LLM rephrasing via `prompts/dialogue_policy.md` only for naturalness; that model has no write access to state.
8. Persist in one transaction: user message, assistant message, new requirements snapshot (`version + 1`), state. Return `ConversationResponse`.

Audio: `POST /conversations/{id}/audio` → size/duration guard → transcription adapter → return `transcript` **without** extracting; the client lets the teacher correct it and submits it through the text endpoint. Audio bytes are not persisted.

Edits: `PATCH /requirements` applies a client-supplied field value through the same merge + validate + state-machine path (operation `replace`, source `edit`), so panel edits and chat corrections behave identically.

Confirm: `POST /confirm` is accepted only in `AWAITING_CONFIRMATION`; it freezes a `ConfirmedRequirements` snapshot (`schema_version 1.0`) and moves to `CONFIRMED`. Subsequent messages that change a field move to `EDITING` and invalidate the snapshot (new confirmation needed).

## States

```
INITIAL ─▶ COLLECTING ─▶ [EXTRACTING ─▶ VALIDATING] ─┬─▶ COLLECTING        (missing fields)
                                                     ├─▶ ASKING_USER       (ambiguity / conflict)
                                                     └─▶ AWAITING_CONFIRMATION
AWAITING_CONFIRMATION ─▶ CONFIRMED ─▶ HANDOFF
AWAITING_CONFIRMATION / CONFIRMED ─▶ EDITING ─▶ (same loop as COLLECTING)
```
`EXTRACTING`/`VALIDATING` never persist. Transitions are a pure function with exhaustive tests.

## Why these choices (summary — details in DECISIONS.md)

- **Patch not full re-extraction**: stable state, traceable changes, model swappable.
- **Code owns control flow**: avoids re-asking, accidental sums, invented dates, self-confirmation.
- **Templates first for assistant text**: cheaper, faster, deterministic; LLM rephrasing is optional.
- **Provider adapter**: `OpenAIProvider` implements `TranscriptionProvider` + `ExtractionProvider` protocols; a `FakeProvider` powers tests and the mock mode.
- **Thin frontend**: renders `ConversationResponse`; no duplicated field logic.
- **SQLite for dev/tests, Postgres for deployment** via SQLAlchemy 2 + Alembic.

## Security, privacy, reliability

API key only in the backend process (Keychain injection locally, env elsewhere). Audio limits (`MAX_AUDIO_SECONDS`, `MAX_AUDIO_BYTES`), request timeouts, basic per-conversation rate limiting. Audio never stored; logs contain no transcripts or personal data at INFO level. Transactions per request; idempotency by `client_message_id`; provider failure leaves state intact.
