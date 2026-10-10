# Evals — French case set

`french_cases.jsonl`: one case per line. A single-turn case gives `message` + `state` (current requirements, may be `{}`), an optional `history` (previous messages, including the assistant's last question) and `expect`. A multi-turn case gives `turns: [{message, expect}]`; the history is propagated automatically from one turn to the next.

`expect` keys (all optional, each one checked if present):

| Key | Meaning |
|---|---|
| `operations` | list of `{field, operation, value?}` that must appear (`value` compared as a subset: omitting `constraint` accepts any constraint) |
| `no_operations_on` | fields that must have **no** operation (guard against invented data) |
| `participants_mentioned` | subset of `{students, accompanying, total_stated}` |
| `ambiguity_kinds` | `kind`s that must appear (`[]` = no ambiguity expected) |
| `conflicts_on` | fields that must appear in `conflicts` |
| `user_intent` | expected intent |
| `merged` | expected subset of `PartialRequirements` after merge |
| `missing_fields` | expected list after merge + validation |
| `state` | state decided by the state machine |

`today` freezes the Paris clock for relative dates (`2026-10-10`, a Saturday, unless stated otherwise).

## Running

```sh
python evals/evaluate.py --list                     # list of cases (no API)
cd services/api && ../../tools/with-api-env gpt -- uv run python ../../evals/evaluate.py [--model gpt-5.4-mini] [--tag correction] [--id <case>]
```

Results in `evals/results/<timestamp>.json` (ignored by Git); summary to be recorded in `docs/HANDOFF.md`.

## Metrics

1. Per-field extraction accuracy (unambiguous cases) — target ≥ 95 %.
2. Participant total accuracy.
3. Date/time/constraint accuracy.
4. Missing-field detection.
5. State preservation during corrections (no lost field).
6. **Unsupported fills** (operation without `evidence` / invented value) — must be 0, blocking.
7. **False confirmations** (`confirm` intent without explicit agreement) — must be 0, blocking.
8. Multi-turn completion rate.

The script returns 1 if a blocker is non-zero or if the pass rate is < 95 %.
