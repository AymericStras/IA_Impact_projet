# Fonctions partagées par scripts/*.sh (sourcé, non exécuté)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
WEB_DIR="$ROOT/apps/web"

info()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(basename "$0" .sh)" "$*"; }
warn()  { printf '\033[1;33m[%s]\033[0m %s\n' "$(basename "$0" .sh)" "$*" >&2; }
fail()  { printf '\033[1;31m[%s]\033[0m %s\n' "$(basename "$0" .sh)" "$*" >&2; exit 1; }

has_api() { [ -f "$API_DIR/pyproject.toml" ]; }
has_web() { [ -f "$WEB_DIR/package.json" ]; }

need() { command -v "$1" >/dev/null 2>&1 || fail "outil manquant : $1 ($2)"; }

# Charge la configuration non secrète depuis .env (les secrets viennent du trousseau via tools/with-api-env).
load_env() {
  if [ -f "$ROOT/.env" ]; then
    set -a; . "$ROOT/.env"; set +a
  fi
}

# Enveloppe une commande avec la clé OpenAI du trousseau macOS si disponible ; sinon l'exécute telle quelle
# (OPENAI_API_KEY peut déjà être définie par l'environnement / la CI).
with_gpt() {
  if [ "$(uname -s)" = "Darwin" ] && "$ROOT/tools/gpt" status >/dev/null 2>&1; then
    exec "$ROOT/tools/with-api-env" gpt -- "$@"
  else
    [ -n "${OPENAI_API_KEY:-}" ] || warn "OPENAI_API_KEY absente et trousseau indisponible ; les appels IA réels échoueront"
    exec "$@"
  fi
}
