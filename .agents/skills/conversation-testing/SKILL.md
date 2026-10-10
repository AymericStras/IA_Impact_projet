---
name: conversation-testing
description: Generate and run multi-turn French conversation tests against the API (FakeProvider or real model) and the interface (Playwright in demo mode), covering missing fields, ambiguities, corrections, conflicts, idempotency, session restore and confirmation.
---

# Conversation testing

## Read first
`docs/PRODUCT.md` (flow + ambiguity rules), `docs/ARCHITECTURE.md` (states), `evals/french_cases.jsonl`, `services/api/tests/test_api.py` (fixtures `mk_patch`, `op`, `dt`, `tt`, `COMPLETE_PATCH`).

## Scenario matrix (each one must have a test)
| Scenario | Input | Expected |
|---|---|---|
| Complete in one message | 4 fields | `AWAITING_CONFIRMATION`, summary |
| Missing participants | time + theme | asks only for the participants |
| Missing return | departure only | asks only for the return |
| Subject only / theme only | « prof d'histoire » / « le Moyen Âge » | valid teaching_type |
| Broken-down headcount | « 25 élèves et 3 professeurs » | 28 |
| Students only | « 25 élèves » | asks for the accompanying adults; total stays null |
| Correction | « finalement, 30 en tout » | replacement, not addition |
| Vague date | « le mois prochain » | asks for the exact date |
| Constraint | « avant 17 h » | `latest` |
| Return before departure | 17 h → 8 h | asks for a correction, value not kept |
| Conflict without correction | 30 said, then « nous sommes 28 » | asks which one to keep |
| Double send | same `client_message_id` twice | a single patch, same response |
| Session restore | GET after reload | identical state |
| Edit after confirmation | PATCH in `CONFIRMED` | `AWAITING_CONFIRMATION`, export invalidated |
| Provider failure | FakeProvider raises | 502/504, state unchanged, replayable |
| Audio | webm file | `transcript` without extraction; 400 unknown type; 413 too large |

## Procedure
1. Multi-turn API tests in `services/api/tests/test_api.py`, driven by `FakeProvider` with patches scripted per turn; check `state`, `missing_fields`, `requirements`, `version` and the French text of `assistant_message`.
2. Runs with the real model: `evals/evaluate.py` (cases with `turns`), metrics in `evals/README.md`.
3. UI journey: Playwright in `./scripts/demo.sh` mode: text → question → panel update → edit → confirmation → JSON visible; microphone states with a mocked MediaRecorder.
4. Any bug found → first the failing case, then the fix.
