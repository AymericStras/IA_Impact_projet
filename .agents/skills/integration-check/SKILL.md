---
name: integration-check
description: Verify compatibility between apps/web, services/api and the shared contracts (JSON Schema ↔ Pydantic ↔ TypeScript ↔ OpenAPI), and that the confirmed payload is consumable by the other team's planning module.
---

# Integration check

## Checklist
1. **Contracts valid**: `uv run --with jsonschema python scripts/validate_contracts.py`.
2. **Pydantic ↔ JSON Schema**: `cd services/api && uv run python ../../scripts/export_schemas.py --check` (P1+) — no diff allowed.
3. **OpenAPI ↔ TypeScript**: `cd apps/web && pnpm gen:types && git diff --exit-code src/types/contracts.ts` (P3+).
4. **Endpoints ↔ docs/API.md**: every route in `/openapi.json` is listed with the same method/path/status codes.
5. **Flow**: `./scripts/dev.sh`, then with `curl`: create → message → requirements → patch → confirm → export; the export validates against `requirements.schema.json`.
6. **Demo parity**: mock service in `apps/web` returns objects valid against `conversation_response.schema.json` (unit test).
7. **Downstream**: share `packages/contracts/requirements.schema.json` + example with the planner team; confirm transport (pull `GET /export` by default). Note any agreement in `docs/DECISIONS.md`.
8. **Security**: `grep -r "NEXT_PUBLIC_.*KEY" apps/web` returns nothing; `git log -p | grep -i "sk-"` returns nothing; audio not persisted.

Report findings in `docs/HANDOFF.md`; fix contract drift before anything else.
