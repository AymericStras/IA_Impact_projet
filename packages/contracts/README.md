# Contracts

The shared data contract between the chatbot, its frontend, and the other teams' modules.

| File | Consumer | Purpose |
|---|---|---|
| `requirements.schema.json` | Travel-planning module (other team) | Final confirmed payload. **This is the only thing other teams depend on.** |
| `conversation_response.schema.json` | `apps/web` | Response shape of every conversation endpoint |
| `requirement_patch.schema.json` | `services/api` extraction | What the LLM returns for one message (Structured Outputs) |
| `examples/` | everyone + CI | Valid instances; `scripts/validate_contracts.py` checks them |

Rules (see `AGENTS.md` §3.7): Pydantic models in `services/api/app/schemas/` are the authoritative definitions; these JSON Schemas must stay equivalent (P1 adds an automated export + diff check in `scripts/check.sh`). Changing anything here requires a `schema_version` bump, updated examples, `docs/API.md`, and a `docs/DECISIONS.md` entry.

Time semantics: `constraint` distinguishes *"retour à 17 h"* (`exact`) from *"retour avant 17 h"* (`latest`) — planners must treat `latest` as an upper bound, not a target. All dates/times are `Europe/Paris` local.
