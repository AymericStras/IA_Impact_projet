#!/usr/bin/env bash
# Lance l'API (:8000, clé OpenAI injectée depuis le trousseau) et le web (:3000). Ctrl-C arrête les deux.
. "$(dirname "$0")/_lib.sh"
load_env

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

if has_api; then
  info "API → http://${API_HOST:-127.0.0.1}:${API_PORT:-8000}  (docs at /docs)"
  (
    cd "$API_DIR"
    with_gpt uv run uvicorn app.main:app --reload --host "${API_HOST:-127.0.0.1}" --port "${API_PORT:-8000}"
  ) &
  PIDS+=($!)
else
  warn "services/api absent — API non lancée"
fi

if has_web; then
  info "web → http://localhost:3000"
  (cd "$WEB_DIR" && NEXT_PUBLIC_DEMO_MODE="${NEXT_PUBLIC_DEMO_MODE:-false}" pnpm dev) &
  PIDS+=($!)
else
  warn "apps/web absent — web non lancé"
fi

[ "${#PIDS[@]}" -gt 0 ] || fail "rien à lancer ; voir docs/HANDOFF.md"
wait
