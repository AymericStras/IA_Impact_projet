---
name: prompt-engineering
description: Modify, version and validate the extraction and dialogue prompts in services/api/app/prompts, and the RequirementPatch schema the model fills. Always paired with running the French evals in evals/.
---

# Prompt engineering

## Read first
`AGENTS.md` §3 (invariants 1–6), `services/api/app/prompts/*.md`, `packages/contracts/requirement_patch.schema.json`, `evals/README.md`.

## Rules
- Prompts are versioned files with a header (`vX.Y`, date). Bump the version on every semantic change and note it in `docs/HANDOFF.md` with eval results.
- The prompt never decides control flow, never writes chatbot text, never confirms. If a behaviour belongs to code (totals, state, re-asking), fix the code, not the prompt.
- Reliability comes from the schema + code validation; the prompt improves recall and ambiguity reporting. Prefer adding an `Ambiguity.kind` over asking the model to "be careful".
- Keep the system prompt in English; examples inside it may be French.
- Blocking regressions: any unsupported fill (value with no evidence), any `confirm` intent without an explicit agreement phrase, any dropped existing field.

## Procedure
1. Add or adjust cases in `evals/french_cases.jsonl` that capture the target behaviour **before** editing the prompt (include spoken forms: « on serait une trentaine », « deux classes de vingt-cinq », « rentrés vers seize heures », « finalement plutôt jeudi »).
2. Edit the prompt; if a new ambiguity kind or field shape is needed, update the Pydantic patch model and JSON Schema (contract procedure).
3. Run `./tools/with-api-env gpt -- python evals/evaluate.py --model $EXTRACTION_MODEL` (and optionally a second model for comparison).
4. Accept only if field accuracy ≥ previous and blocking metrics are 0. Record the table in `docs/HANDOFF.md`.
5. Commit prompt + cases + results together (`feat(prompt): …` / `fix(prompt): …`).
