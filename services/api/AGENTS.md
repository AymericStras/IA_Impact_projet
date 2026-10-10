# Backend scope (`services/api`)

Read the root `AGENTS.md` first; this file adds backend-specific rules.

You own Pydantic schemas, the extraction adapter, domain rules, persistence and the HTTP API. Write the regression test before changing merge, validation or confirmation rules.

- **Layers**: `app/api` (thin routes) → `app/services` (orchestration, provider adapters) → `app/domain` (pure functions: no I/O, no framework imports). Business rules live in `app/domain` only.
- **The model proposes, code decides.** Every model operation must carry `evidence` that is an exact quote of the teacher's latest message; `services/extraction.py` rejects the patch otherwise. Totals, state transitions and the next question are never taken from the model.
- **No model call inside a database transaction.** Load, release the transaction, call the provider, then re-check that the conversation did not change before writing; a concurrent change is a 409, never a silent overwrite.
- **Idempotency**: a repeated `client_message_id` with the same content returns the stored response; with different content it is a 409. `expected_version` mismatches are 409.
- **Provider failures never change state** and never fall back to the fake provider. Report 502/504 with a French message; the client retries with the same `client_message_id`.
- **Merged state is re-validated as a whole** (calendar-valid dates, counts ≥ 1). An invalid extraction is a provider error, not a 500.
- **Audio**: MIME allow-list, byte cap, real-media probe and duration cap; bytes are never persisted or logged.
- **Logging**: latency, token usage, model and request ids are fine; message text, transcripts and keys are not.
- After a schema change run `uv run python ../../scripts/export_schemas.py`; never hand-edit `packages/contracts/*.schema.json` or `openapi.json`.
- Verify with `uv run ruff check . && uv run mypy app && uv run pytest -q`, then `./scripts/check.sh`. Prompt or extraction changes also need the evals (see the `prompt-engineering` skill).
- Report live-model results separately from `FakeProvider` tests.
