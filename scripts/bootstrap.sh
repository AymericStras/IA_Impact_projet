#!/usr/bin/env bash
# Vérifie l'outillage, installe les dépendances, crée .env. Réexécutable sans risque.
. "$(dirname "$0")/_lib.sh"

need node   "https://nodejs.org (>= 20)"
need pnpm   "npm i -g pnpm"
need python3 "https://python.org (>= 3.12)"
need uv     "https://docs.astral.sh/uv/"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node >= 20 requis, trouvé $(node -v)"
info "node $(node -v), pnpm $(pnpm -v), $(python3 --version), uv $(uv --version | cut -d' ' -f2)"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  info ".env créé depuis .env.example (aucun secret ; voir docs/DEVELOPMENT.md)"
fi
mkdir -p "$ROOT/.local"

if has_api; then
  info "installation des dépendances Python (services/api)"
  (cd "$API_DIR" && uv sync)
else
  warn "services/api absent — dépendances Python ignorées"
fi

if has_web; then
  info "installation des dépendances web (apps/web)"
  (cd "$WEB_DIR" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
else
  warn "apps/web absent — dépendances web ignorées"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  if "$ROOT/tools/gpt" status >/dev/null 2>&1; then
    info "identifiant OpenAI disponible dans le trousseau (tools/gpt)"
  else
    warn "identifiant absent du trousseau ; définir OPENAI_API_KEY dans l'environnement pour le mode IA réel"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  info "docker disponible — 'docker compose up -d db' lance Postgres sur :5433 (optionnel ; SQLite par défaut)"
fi

info "bootstrap terminé. Ensuite : ./scripts/dev.sh ou ./scripts/demo.sh"
