# Planner contract (proposal) and simulation

The trip-planning module — destination and activity recommendation, liO train lookup, itinerary — belongs to teammates. This repository only holds the **boundary** (`services/api/app/services/planner.py`) and a **simulation** so the whole flow can be exercised before their interface exists.

## Modes (`PLANNER_MODE`)

| Mode | Behaviour |
|---|---|
| `simulated` (default, test mode) | Deterministic proposals built from a small illustrative catalogue. No model call. Everything is flagged `simulated: true`; no train numbers, prices or availability. |
| `http` | `POST {PLANNER_BASE_URL}/plan` with the confirmed requirements; the answer is validated. Not yet exercised against a real service. |
| `off` | The planning step is hidden; the flow ends at the confirmed JSON. |

`GET /api/v1/config` exposes `planner_mode` so the client shows or hides the step.

## Flow after confirmation

```
CONFIRMED ──POST /plan──▶ proposals | no_match ──POST /plan/select──▶ selected ──GET /handoff──▶ NOT_RESERVED
     ▲                                                                                              
     └── any later edit of a requirement clears confirmation, proposals and selection
```

| Method | Path | Notes |
|---|---|---|
| POST | `/conversations/{id}/plan` | Body `{}` or, in simulation only, `{"scenario": "match" \| "no_match" \| "error"}`. 409 before confirmation. Returns `PlanResult`. |
| GET | `/conversations/{id}/plan` | Last result; 409 if none. |
| POST | `/conversations/{id}/plan/select` | `{"proposal_id": …}`; 409 for an unknown id. |
| GET | `/conversations/{id}/handoff` | Selected proposal + requirements, `booking_status: "NOT_RESERVED"`. 409 until a proposal is selected. |

Rules that hold in every mode: a technical failure is `502 PLANNER_ERROR` with a message saying it does **not** mean that no trip exists — it is never reported as `no_match`; nothing is ever booked; a service answering in `http` mode must not return `simulated: true`.

## What we send to the planner

Exactly the published confirmed payload (`packages/contracts/requirements.schema.json`, example `examples/confirmed_requirements.json`). Time semantics: `constraint` is `exact`, `approximate`, `earliest` or `latest`; `latest` is an upper bound, not a target.

## What we expect back

`packages/contracts/plan_result.schema.json` (example `examples/plan_result.json`): a list of proposals, each with a title, destination, why it fits the theme, an outbound and a return leg (line, stations, local ISO times with offset) and timed activities. `packages/contracts/handoff.schema.json` is what the booking step receives.

**For the teammates:** this response shape is a proposal. If your service answers differently, tell us the format and we write the mapping inside `HttpPlanner`; nothing else in the chatbot changes.

## Simulation behaviour

- Destinations are ranked by keyword match with the teacher's subject/theme (illustrative catalogue of Occitanie outings).
- Times never violate the teacher's constraints: `exact` is kept, `approximate` moves by 5 minutes, `earliest` leaves 10 minutes after, `latest` arrives 10 minutes before. A day too short for a visit of at least 90 minutes yields no proposal for that destination.
- The departure station is not collected by the chatbot: the simulation assumes **Toulouse Matabiau** and says so in `assumptions`.
- No budget or price: out of scope.
- Scenarios `no_match` and `error` exist to exercise the interface.

## Not done

The step is implemented in the API only. Both frontends (classic chat and `/vocal`) still end at the confirmed JSON; adding the proposals stage to them is the next task.
