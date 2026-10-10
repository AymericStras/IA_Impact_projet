# API — `/api/v1`

Contract version: `schema_version 1.1`. Live OpenAPI at `http://localhost:8000/docs`. All conversation endpoints return a `ConversationResponse` (`packages/contracts/conversation_response.schema.json`). Errors follow RFC 9457 (`application/problem+json`, `{type, title, status, detail}`) with a French `detail`.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/conversations` | `{}` | 201; conversation in `COLLECTING` with the welcome message |
| GET | `/conversations/{id}` | — | Full state for reload / session restore |
| POST | `/conversations/{id}/messages` | `{ "content": str, "client_message_id": str, "source": "text"\|"audio" }` | Text input. Idempotent on `client_message_id` |
| POST | `/conversations/{id}/audio` | multipart `file` (webm/ogg/wav/mp4/m4a/mpeg/flac, ≤ `MAX_AUDIO_BYTES`) | Returns `transcript`; **does not extract**. The client sends the corrected text through `/messages` |
| GET | `/conversations/{id}/requirements` | — | Same response as GET conversation (current state) |
| PATCH | `/conversations/{id}/requirements` | `{ "field": FieldName, "value": …, "expected_version": int }` | Edit from the panel; 409 if the version is stale. `value`: integer, string (`departure_station`), `{date,time,constraint}`, `{subject,theme}` or `null` (clear) |
| POST | `/conversations/{id}/confirm` | `{ "expected_version": int }` | Only if the state is complete and awaiting confirmation; the response carries `confirmed_requirements` |
| GET | `/conversations/{id}/export` | — | Confirmed payload (`requirements.schema.json`); 409 if not confirmed |
| GET | `/health` | — | `{ "status": "ok", "extraction_model", "transcription_model" }` |

## Example response

See `packages/contracts/examples/conversation_response.json`.

## Error codes

| Status | When |
|---|---|
| 400 | Empty message, unsupported audio type, empty recording |
| 404 | Unknown conversation |
| 409 | Stale `expected_version`; confirmation outside `AWAITING_CONFIRMATION`; export before confirmation |
| 413 | Audio too large |
| 422 | Invalid body |
| 429 | Per-conversation rate limit |
| 502 | Provider (OpenAI) failure — state unchanged, retry possible |
| 504 | Provider-side timeout — state unchanged |

## Handoff to the downstream module

The other team reads `GET /conversations/{id}/export` (or receives the same JSON through the agreed transport: webhook/file). It must depend only on `requirements.schema.json`. Time semantics: `constraint: "latest"` is an upper bound, not a target.

## Changelog

- 1.0 (2026-10-10): initial contract. `confirmed_requirements` added to `ConversationResponse` before any publication (still 1.0).
- 1.1 (2026-10-10): `requirements.departure_station` added (station or city, as said; a city means any station of that city). Required in the confirmed payload. `FieldName` gains `departure_station`.
