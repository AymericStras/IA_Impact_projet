# Evals — French extraction test set

`french_cases.jsonl`: one case per line. Single-turn cases give `message` + `state` (current requirements, may be `{}`) and `expect`. Multi-turn cases give `turns: [{message, expect}]`.

`expect` keys (all optional, each asserted when present):

| Key | Meaning |
|---|---|
| `operations` | list of `{field, operation, value?}` that must appear (value compared when given; `date`/`time`/`constraint` subset-compared) |
| `no_operations_on` | fields that must have **no** operation (regression guard against invented data) |
| `participants_mentioned` | subset of `{students, accompanying, total_stated}` |
| `ambiguity_kinds` | list of `kind`s that must appear |
| `conflicts_on` | fields that must appear in `conflicts` |
| `user_intent` | expected intent |
| `merged` | after `patch_merger` — expected subset of `PartialRequirements` (needs services/api) |
| `missing_fields` | expected list after merge + validate (needs services/api) |

`today` fixes the Paris clock for relative dates (`2026-10-10`, a Saturday, unless the case says otherwise).

## Run

```sh
python evals/evaluate.py --list                     # show cases (no API)
./tools/with-api-env gpt -- python evals/evaluate.py [--model gpt-5.4-mini] [--tag correction]
```

Requires `services/api` (P1) for the extraction adapter and merge. Results go to `evals/results/<timestamp>.json` (git-ignored); summarise the table in `docs/HANDOFF.md`.

## Metrics

1. Field extraction accuracy (per field, unambiguous cases) — target ≥ 95 %.
2. Participants total accuracy.
3. Date/time/constraint accuracy.
4. Missing-field detection accuracy.
5. State preservation on corrections (no dropped fields).
6. **Unsupported fills** (operation without evidence / invented value) — must be 0, blocking.
7. **False confirmations** (`confirm` intent without explicit agreement) — must be 0, blocking.
8. Multi-turn completion rate.
