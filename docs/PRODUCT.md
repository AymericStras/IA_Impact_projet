# Product definition

## Users and goal

French teachers (primary/secondary) planning an educational day trip using liO regional trains in Occitanie. They describe the trip in natural French, by voice or text. The assistant extracts, clarifies and confirms **four requirements**, then hands them to the travel-planning module.

## The four requirements

| # | Field | Accept as complete when | Examples of teacher phrasing |
|---|---|---|---|
| 1 | `participants_count` | A total is known: stated total, or students + accompanying both known | « Nous sommes 30 », « 27 élèves et 3 accompagnateurs », « deux classes de 25 et 4 adultes » |
| 2 | `departure` | date + time + constraint | « le 12 novembre vers 8 h », « jeudi prochain à 7 h 45 » (only if resolvable) |
| 3 | `return` | date + time + constraint | « retour avant 17 h », « rentrés vers seize heures » |
| 4 | `teaching_type` | subject **or** theme | « professeur d'histoire », « le Moyen Âge », « un cours de SVT », « autour de l'architecture » |

Ambiguity → ask, never guess:

- « J'ai 25 élèves » → ask for accompanying adults (students ≠ participants).
- « Le mois prochain », « bientôt », « une trentaine » → ask for the exact value.
- Return before departure → ask the teacher to correct.
- Return without a date → assume the departure date **only if** the teacher's wording implies the same day (« partir à 8 h et rentrer à 17 h »); otherwise ask. Record the decision in `DECISIONS.md` when the rule is implemented.

Time constraints are preserved: `exact` (à), `approximate` (vers), `earliest` (après / pas avant), `latest` (avant / au plus tard).

## Not collected

Budget, departure station, student ages, class level, school name, contact details, names. If a teacher volunteers them, they are ignored (not stored in requirements) and never requested.

## Conversation flow

1. Welcome message with an example of what to say.
2. Teacher speaks or types. Audio → transcription shown for correction → submitted as text.
3. Extraction → patch merge → validation → state machine chooses: targeted question (missing), clarification (ambiguous/conflict), or summary + confirmation request (complete).
4. Teacher can edit any field at any time, in chat or via the requirements panel.
5. Explicit confirmation (« Confirmer et continuer ») → `CONFIRMED` → versioned JSON exported.
6. After confirmation, a new correction reopens editing (`EDITING` → re-confirm).

Principles: never re-ask a known field; one question at a time; concise, polite French; no promises about trains, destinations or availability.

## Success criteria (hackathon)

- Minimum demo: text → extraction → follow-up → correction → confirmation → JSON.
- Voice uses the same pipeline (no second dialogue logic).
- Target ≥ 95 % field-extraction accuracy on unambiguous eval cases; zero unsupported fills / false confirmations (blocking).
- Works offline in mock demo mode for the pitch.
