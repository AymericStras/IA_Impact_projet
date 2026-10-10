#!/usr/bin/env bash
# Validation des contrats + tests backend + tests unitaires frontend.
. "$(dirname "$0")/_lib.sh"

info "validation des contrats"
uv run --quiet --with jsonschema python "$ROOT/scripts/validate_contracts.py"

if has_api; then
  info "pytest (services/api)"
  (cd "$API_DIR" && uv run pytest -q)
else
  warn "services/api absent — pytest ignoré"
fi

if has_web; then
  info "vitest (apps/web)"
  (cd "$WEB_DIR" && pnpm test -- --run)
else
  warn "apps/web absent — vitest ignoré"
fi

info "tests terminés"
