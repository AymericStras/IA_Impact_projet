---
name: conversation-testing
description: Generate and run multi-turn French conversation tests against the API (FakeProvider or real model) and the UI (Playwright demo mode), covering missing fields, ambiguity, corrections, conflicts, idempotency, session restore and confirmation.
---

# Conversation testing

## Read first
`docs/PRODUCT.md` (flow + ambiguity rules), `docs/ARCHITECTURE.md` (states), `evals/french_cases.jsonl`, `services/api/tests/`.

## Scenario matrix (must all have a test)
| Scenario | Input sketch | Expected |
|---|---|---|
| Complete in one message | 4 fields | `AWAITING_CONFIRMATION`, summary |
| Missing participants | time + theme | asks participants only |
| Missing return | departure only | asks return only |
| Subject only / theme only | « prof d'histoire » / « le Moyen Âge » | teaching_type valid |
| Split count | « 25 élèves et 3 professeurs » | 28 |
| Students only | « 25 élèves » | asks accompanying; count stays null |
| Correction | « finalement, 30 en tout » | replace, not add |
| Vague date | « le mois prochain » | asks exact date |
| Constraint | « avant 17 h » | `latest` |
| Return before departure | 17 h → 8 h | asks correction |
| Conflict without correction | said 30, now « nous sommes 28 » | asks which |
| Duplicate submit | same `client_message_id` twice | one patch, same response |
| Session restore | GET after reload | identical state |
| Edit after confirmation | PATCH in `CONFIRMED` | `EDITING`, re-confirm required |
| Provider failure | FakeProvider raises | 502, state unchanged |

## Procedure
1. Multi-turn API tests live in `services/api/tests/test_conversations.py`, driven by `FakeProvider` with scripted patches per turn; assert `state`, `missing_fields`, `requirements`, and the French `assistant_message` template.
2. Real-model multi-turn runs: `evals/evaluate.py --multiturn` (cases with `turns`), metrics per `evals/README.md`.
3. UI flow: Playwright in `./scripts/demo.sh` mode: text → question → panel update → edit → confirm → JSON visible; also voice UI states with a stubbed MediaRecorder.
4. Any bug found → add the failing case first, then fix.
