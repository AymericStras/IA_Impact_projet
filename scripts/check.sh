#!/usr/bin/env bash
# Everything CI does: contracts, lint, types, tests, build. Must pass before merging.
. "$(dirname "$0")/_lib.sh"

"$ROOT/scripts/test.sh"

if has_api; then
  info "ruff + mypy (services/api)"
  (cd "$API_DIR" && uv run ruff check . && uv run ruff format --check . && uv run mypy app)
  if [ -f "$ROOT/scripts/export_schemas.py" ]; then
    info "Pydantic ↔ JSON Schema drift"
    (cd "$API_DIR" && uv run python "$ROOT/scripts/export_schemas.py" --check)
  fi
fi

if has_web; then
  info "tsc + eslint + build (apps/web)"
  (cd "$WEB_DIR" && pnpm tsc --noEmit && pnpm lint && NEXT_PUBLIC_DEMO_MODE=true pnpm build)
fi

info "all checks passed"
