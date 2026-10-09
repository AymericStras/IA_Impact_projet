#!/usr/bin/env bash
# Verify toolchain, install dependencies, create .env. Safe to re-run.
. "$(dirname "$0")/_lib.sh"

need node   "https://nodejs.org (>= 20)"
need pnpm   "npm i -g pnpm"
need python3 "https://python.org (>= 3.12)"
need uv     "https://docs.astral.sh/uv/"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node >= 20 required, found $(node -v)"
info "node $(node -v), pnpm $(pnpm -v), $(python3 --version), uv $(uv --version | cut -d' ' -f2)"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  info "created .env from .env.example (no secrets inside; see docs/DEVELOPMENT.md)"
fi
mkdir -p "$ROOT/.local"

if has_api; then
  info "installing Python deps (services/api)"
  (cd "$API_DIR" && uv sync)
else
  warn "services/api not created yet (P1) — skipping Python deps"
fi

if has_web; then
  info "installing web deps (apps/web)"
  (cd "$WEB_DIR" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
else
  warn "apps/web not created yet (P3) — skipping web deps"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  if "$ROOT/tools/gpt" status >/dev/null 2>&1; then
    info "OpenAI credential available in Keychain (tools/gpt)"
  else
    warn "Keychain credential not found; set OPENAI_API_KEY in your environment for real AI mode"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  info "docker available — 'docker compose up -d db' starts Postgres on :5433 (optional; SQLite is the default)"
fi

info "bootstrap complete. Next: ./scripts/dev.sh or ./scripts/demo.sh"
