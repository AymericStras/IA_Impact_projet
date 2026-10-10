# After confirmation: the simulated journey and the proposed contract

Destinations and activities, liO train lookup, itineraries, booking and the travel file belong to teammates' modules. This repository holds the **boundary** and a **simulation** of them (`services/api/app/services/planner.py`), so that the whole process of the team's diagrams — "from the request to the feedback" — can be exercised end to end before the real interfaces exist. Speech-to-text and requirement extraction stay real.

## Modes (`PLANNER_MODE`, exposed by `GET /api/v1/config`)

| Mode | Behaviour |
|---|---|
| `simulated` (default, test mode) | Deterministic code over a small illustrative catalogue. No model call. Everything is flagged `simulated: true`; no train number, price or availability is invented. |
| `http` | Reserved for the real services. Not connected yet: the journey endpoints answer `501 PLANNER_NOT_CONNECTED`. |
| `off` | The journey is hidden; the flow ends at the confirmed JSON. |

## Stages

```
CONFIRMED
   │ POST /journey
   ▼
destinations ──POST /journey/destination──▶ itineraries ──POST /journey/itinerary──▶ review
      ▲                 │                        ▲                                      │ POST /journey/booking
      │                 ▼                        │                                      ▼
      │            adjustments ──POST /journey/adjustment (explicit acceptance)   booking_pending
      │                 │                                                               │ POST /journey/booking/check
      │                 ▼                                                    ┌──────────┴──────────┐
      └──────────── no_match                                               booked            booking_refused
                                                                             │ GET /journey/travel-file   │ alternatives → review
                                                                             │ POST /journey/feedback
                                                                             ▼
                                                                           closed
```

| Diagram step | Stage / endpoint | Simulation |
|---|---|---|
| Recommend destinations, places and activities | `POST /journey` → `destinations` | Catalogue ranked by keyword match with the subject/theme; the origin city is excluded; each destination has places (walking time, note) and activities (duration) |
| Teacher chooses a destination and activities | `POST /journey/destination` | Any number of activities (none = the first one) |
| Search trains, build and check itineraries, rank | → `itineraries` | Up to three variants (full day, earlier return, later departure) that never violate the time constraints; feasibility checks listed per itinerary |
| No solution: analyse and propose adjustments | → `adjustments` | **Several** options, each stating what changes and how many itineraries it unlocks: return later (30/60/90 min), departure earlier, fewer activities, a nearer destination. Only options that really unlock something are listed. If none helps → `no_match` |
| Teacher accepts an adjustment | `POST /journey/adjustment` | A time change is applied to the requirements **only now**; it is an explicit consent, so the requirements stay confirmed (new version, visible in the conversation). Other kinds change the choice, not the requirements |
| Teacher chooses and confirms an itinerary | `POST /journey/itinerary` → `review` | Final check before anything is sent |
| Option / booking request, waiting | `POST /journey/booking` → `booking_pending` | Reference `SIM-…` |
| Confirmation received? | `POST /journey/booking/check` → `booked` or `booking_refused` | On refusal the other itineraries are offered as alternatives |
| Travel documents | `GET /journey/travel-file` | Timetable of the day, places, safety advice, generic contacts; `official_links` is empty — real links come from the real modules |
| Feedback | `POST /journey/feedback` → `closed` | Rating 1–5 and a comment |

`GET /journey` returns the current state at any time (409 when no search is in progress).

## Rules that hold in every mode

- **Preferences can change at any time.** Before a booking request is waiting, the teacher can pick another destination or other activities from any stage (`POST /journey/destination` again). Editing any requirement (chat, panel, voice) clears the confirmation and the journey: confirm again, search again.
- **Nothing is adjusted silently.** Adjustments are offers; requirements change only on acceptance, with the before/after values recorded.
- **A technical failure is never "no result".** `502 PLANNER_ERROR` and `502 BOOKING_ERROR` say that the failure does not mean no trip exists, and leave the state untouched.
- **Nothing is booked for real**, and nothing simulated may be presented as real: every screen showing journey data must show the simulation label from `notices`.
- The simulation is plain code, never a model, and must not grow into a real planner.

## Test scenarios (simulation only)

`POST /journey` accepts `{"search_scenario": "auto" | "adjustments" | "no_match" | "error", "booking_scenario": "confirmed" | "refused" | "error"}`. `adjustments` raises the time needed on site just enough that nothing fits as asked, so the adjustment branch can be shown on any request. `auto` reaches the same branch naturally when the day is too short. A simulated refusal happens once: the alternative then succeeds.

## Departure station or city

`requirements.departure_station` is what the teacher said: a station ("Toulouse Matabiau") or a city ("Toulouse"). A city means any of its stations; `Journey.departure_stations` shows the expansion (illustrative table in the simulation; the real expansion is the planner's job). Simulated travel times do not depend on the origin.

## For the teammates

- **What you receive**: the confirmed payload, `packages/contracts/requirements.schema.json` (`schema_version` 1.1), example `examples/confirmed_requirements.json`. `constraint` is `exact`, `approximate`, `earliest` or `latest`; `latest` is an upper bound, not a target.
- **What we would like back**: the shapes in `packages/contracts/journey.schema.json` and `travel_file.schema.json` (examples `journey_adjustments.json`, `journey_booked.json`, `travel_file.json`) — destinations with places and activities, itineraries with two train legs and timed activities, adjustments with before/after values, a booking status, a travel file.
- These shapes are a **proposal**. If your services answer differently, send us your format: the mapping is written in one place (`services/planner.py` gets an HTTP implementation) and nothing else changes.

## Not done

API only. Neither frontend shows the journey yet (task `PLANNER-SIM-UI`). No real data source is connected.
