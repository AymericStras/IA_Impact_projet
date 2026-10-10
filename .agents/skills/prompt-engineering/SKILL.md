---
name: prompt-engineering
description: Modify, version and validate the extraction and dialogue prompts in services/api/app/prompts, as well as the RequirementPatch schema the model fills. Always paired with a run of the French evals in evals/.
---

# Prompt engineering

## Read first
`AGENTS.md` §3 (invariants 1–6), `services/api/app/prompts/*.md`, `services/api/app/schemas/patch.py`, `evals/README.md`, the latest "Evals" section of `docs/HANDOFF.md`.

## Rules
- Prompts are versioned files with a header (`vX.Y`, date). Bump on every semantic change and record the eval results in `docs/HANDOFF.md`.
- The prompt never decides the flow, never writes text for the user, never confirms. If a behaviour belongs to the code (totals, state, re-asking), fix the code, not the prompt.
- Reliability comes from the schema + validation by the code; the prompt improves recall and ambiguity flagging. Prefer adding an `AmbiguityKind` over asking the model to "be careful".
- The system prompt stays in English (ADR-010); the examples it contains may be in French.
- Blocking regressions: unsupported fill (value without `evidence`), `confirm` intent without explicit agreement, existing field lost.
- The model receives the last 8 messages (ADR-015): single-turn eval cases that answer a question must provide `history`.

## Procedure
1. Add or adjust cases in `evals/french_cases.jsonl` capturing the target behaviour **before** editing the prompt (include spoken forms: « on serait une trentaine », « deux classes de vingt-cinq », « rentrés vers seize heures », « finalement plutôt jeudi »).
2. Edit the prompt; if a new ambiguity kind or field shape is needed, modify the patch's Pydantic model and regenerate the JSON Schema (contract procedure).
3. Run `cd services/api && ../../tools/with-api-env gpt -- uv run python ../../evals/evaluate.py` (and optionally `--model` to compare).
4. Accept only if accuracy is ≥ the previous one and the blockers are at 0. A case may be non-deterministic: re-run with `--id` before concluding. Record the table in `docs/HANDOFF.md`.
5. Commit prompt + cases + results together (`feat(prompt): …` / `fix(prompt): …`).
