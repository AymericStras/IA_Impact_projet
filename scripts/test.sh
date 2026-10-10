#!/usr/bin/env bash
# Contract validation + backend tests + frontend unit tests.
. "$(dirname "$0")/_lib.sh"

info "validating contracts"
uv run --quiet --with jsonschema python "$ROOT/scripts/validate_contracts.py"

if has_api; then
  info "pytest (services/api)"
  (cd "$API_DIR" && uv run pytest -q)
else
  warn "services/api absent — pytest skipped"
fi

if has_web; then
  info "vitest (apps/web)"
  (cd "$WEB_DIR" && pnpm test -- --run)
else
  warn "apps/web absent — vitest skipped"
fi

info "tests done"
