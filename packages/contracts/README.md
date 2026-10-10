# Contracts

The data contract shared between the chatbot, its frontend and the other teams' modules.

| File | Consumer | Role |
|---|---|---|
| `requirements.schema.json` | Planning module (other team) | Final confirmed payload. **The only thing the other teams depend on.** |
| `conversation_response.schema.json` | `apps/web` | Shape of the response of all conversation endpoints |
| `requirement_patch.schema.json` | `services/api` extraction | What the LLM returns for one message (Structured Outputs) |
| `examples/` | everyone + CI | Valid instances; `scripts/validate_contracts.py` checks them |

Rules (`AGENTS.md` §3.7, ADR-014): the Pydantic models in `services/api/app/schemas/` are the source of truth; these files are **generated** by `scripts/export_schemas.py` (do not edit them by hand; `--check` fails in CI on drift). Any change requires a `schema_version` bump, up-to-date examples, `docs/API.md` and an entry in `docs/DECISIONS.md`.

Time semantics: `constraint` distinguishes « retour à 17 h » (`exact`) from « retour avant 17 h » (`latest`) — planners must treat `latest` as an upper bound, not a target. All dates/times are local `Europe/Paris`.
