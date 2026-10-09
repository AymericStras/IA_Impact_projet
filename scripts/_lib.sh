# Shared helpers for scripts/*.sh (sourced, not executed)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
WEB_DIR="$ROOT/apps/web"

info()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(basename "$0" .sh)" "$*"; }
warn()  { printf '\033[1;33m[%s]\033[0m %s\n' "$(basename "$0" .sh)" "$*" >&2; }
fail()  { printf '\033[1;31m[%s]\033[0m %s\n' "$(basename "$0" .sh)" "$*" >&2; exit 1; }

has_api() { [ -f "$API_DIR/pyproject.toml" ]; }
has_web() { [ -f "$WEB_DIR/package.json" ]; }

need() { command -v "$1" >/dev/null 2>&1 || fail "missing tool: $1 ($2)"; }

# Load non-secret config from .env if present (secrets come from Keychain via tools/with-api-env).
load_env() {
  if [ -f "$ROOT/.env" ]; then
    set -a; . "$ROOT/.env"; set +a
  fi
}

# Wrap a command with the OpenAI key from macOS Keychain when available; otherwise run as-is
# (OPENAI_API_KEY may already be set by the environment / CI).
with_gpt() {
  if [ "$(uname -s)" = "Darwin" ] && "$ROOT/tools/gpt" status >/dev/null 2>&1; then
    exec "$ROOT/tools/with-api-env" gpt -- "$@"
  else
    [ -n "${OPENAI_API_KEY:-}" ] || warn "OPENAI_API_KEY not set and Keychain unavailable; real AI calls will fail"
    exec "$@"
  fi
}
