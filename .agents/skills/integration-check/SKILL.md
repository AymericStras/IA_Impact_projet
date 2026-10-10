---
name: integration-check
description: Verify compatibility between apps/web, services/api and the shared contracts (Pydantic ↔ JSON Schema ↔ TypeScript ↔ OpenAPI), and that the confirmed payload is consumable by the other team's planning module.
---

# Integration check

## Checklist
1. **Valid contracts**: `uv run --with jsonschema python scripts/validate_contracts.py`.
2. **Pydantic ↔ JSON Schema**: `cd services/api && uv run python ../../scripts/export_schemas.py --check` — no drift.
3. **OpenAPI ↔ TypeScript**: API running, then `cd apps/web && pnpm gen:types` and compare with `src/types/contracts.ts`.
4. **Endpoints ↔ docs/API.md**: every route in `/openapi.json` appears there with the same method/path/codes.
5. **Journey**: `./scripts/dev.sh`, then with `curl`: create → message → requirements → patch → confirm → export; the export validates against `requirements.schema.json`.
6. **Demo parity**: the simulated service in `apps/web` returns objects that validate against `conversation_response.schema.json` (ajv unit test).
7. **Downstream**: share `packages/contracts/requirements.schema.json` + example with the planning team; agree on the transport (`GET /export` by default). Record the agreement in `docs/DECISIONS.md`.
8. **Security**: `grep -r "NEXT_PUBLIC_.*KEY" apps/web` empty; `git log -p | grep -i "sk-"` empty; audio not persisted; no message content in INFO logs.

Record the findings in `docs/HANDOFF.md`; fix any contract drift before anything else.
