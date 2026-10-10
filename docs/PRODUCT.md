# Product definition

## Users and goal

Teachers (primary/secondary) in France preparing a one-day school trip with the liO regional trains in Occitanie. They describe the trip in natural French, by voice or keyboard. The assistant extracts, clarifies and confirms **four pieces of information**, then hands them over to the planning module.

## The four pieces of information

| # | Field | Complete when | Typical phrasings |
|---|---|---|---|
| 1 | `participants_count` | A total is known: stated total, or students + accompanying adults known | « Nous sommes 30 », « 27 élèves et 3 accompagnateurs », « deux classes de 25 et 4 adultes » |
| 2 | `departure` | date + time + constraint | « le 12 novembre vers 8 h », « jeudi prochain à 7 h 45 » (if resolvable) |
| 3 | `return` | date + time + constraint | « retour avant 17 h », « rentrés vers seize heures » |
| 4 | `teaching_type` | subject **or** theme | « professeur d'histoire », « le Moyen Âge », « un cours de SVT », « autour de l'architecture » |

Ambiguity → we ask, we never guess:

- « J'ai 25 élèves » → ask for the number of accompanying adults (students ≠ participants).
- « Le mois prochain », « bientôt », « une trentaine » → ask for the exact value.
- Return before departure → ask for a correction (the inconsistent value is not kept).
- Return time without a date → inherits the departure date (one-day trip, ADR-011); the teacher can correct it.
- New contradictory value without a correction phrase (« finalement », « en fait ») → ask which one to keep.

Time constraints are preserved: `exact` (à), `approximate` (vers), `earliest` (après / pas avant), `latest` (avant / au plus tard).

## Not collected

Budget, departure station, students' age, grade level, school, contact details, names. If the teacher mentions them, they are ignored (never stored in the requirements) and never asked for.

## Conversation flow

1. Welcome message with an example of what can be said.
2. The teacher speaks or types. Audio → transcript displayed for correction → sent as text.
3. Extraction → patch merge → validation → the state machine chooses: targeted question (missing), clarification (ambiguity/conflict/inconsistency) or summary + confirmation request (complete).
4. The teacher can edit any field at any time, through the chat or in the panel.
5. Explicit confirmation (« Confirmer et continuer ») → `CONFIRMED` → versioned JSON exported.
6. After confirmation, a correction reopens editing (new confirmation required, export invalidated in the meantime).

Principles: never ask again for a known field; one question at a time; concise, polite French; no promise about trains, destinations or availability.

## Success criteria (hackathon)

- Minimal demo: text → extraction → follow-up → correction → confirmation → JSON.
- Voice uses the same pipeline (no second dialogue logic).
- Target ≥ 95 % extraction accuracy on unambiguous cases; zero unsupported fills / false confirmations (blocking). Current result: see `docs/HANDOFF.md`.
- Works offline in demo mode for the presentation.
