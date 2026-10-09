# API — `/api/v1`

Contract version: `schema_version 1.0`. Live OpenAPI at `http://localhost:8000/docs` (when P1 is implemented). Every conversation endpoint returns a `ConversationResponse` (`packages/contracts/conversation_response.schema.json`). All text is French; errors use RFC 9457 problem details with a French `detail`.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/conversations` | `{}` | Creates a conversation in `COLLECTING` with the welcome message |
| GET | `/conversations/{id}` | — | Full state for page reload / session restore |
| POST | `/conversations/{id}/messages` | `{ "content": str, "client_message_id": str }` | Text input. Idempotent on `client_message_id` |
| POST | `/conversations/{id}/audio` | multipart `file` (webm/ogg/wav/m4a, ≤ `MAX_AUDIO_BYTES`) | Returns `transcript`; **does not extract**. Client submits corrected text via `/messages` with `source: "audio"` |
| GET | `/conversations/{id}/requirements` | — | Current `PartialRequirements` + `missing_fields` + `version` |
| PATCH | `/conversations/{id}/requirements` | `{ "field": FieldName, "value": …, "expected_version": int }` | Panel edit; 409 on version mismatch |
| POST | `/conversations/{id}/confirm` | `{ "expected_version": int }` | Only in `AWAITING_CONFIRMATION`; returns `ConversationResponse` + `confirmed_requirements` (`requirements.schema.json`) |
| GET | `/conversations/{id}/export` | — | The confirmed payload for the planner; 409 if not confirmed |
| GET | `/health` | — | `{ "status": "ok", "demo": bool }` |

## Response example

See `packages/contracts/examples/conversation_response.json`.

## Error codes

| Status | When |
|---|---|
| 400 | Empty message, unsupported audio type |
| 404 | Unknown conversation |
| 409 | `expected_version` mismatch; confirm outside `AWAITING_CONFIRMATION`; export before confirmation |
| 413 | Audio too large / too long |
| 422 | Body validation (FastAPI default, French `detail` added) |
| 429 | Rate limit per conversation |
| 502 | Provider (OpenAI) failure — state unchanged, client may retry |
| 504 | Provider timeout — state unchanged |

## Downstream handoff

Other teams read `GET /conversations/{id}/export` or receive the same JSON via whatever transport we agree on (webhook/file). They must only depend on `requirements.schema.json`.

## Change log

- 1.0 (2026-10-10): initial contract.
