#!/usr/bin/env bash
# Démo simulée : web seul, conversation scriptée, sans clé ni backend. Badge « Mode démo » dans l'interface.
. "$(dirname "$0")/_lib.sh"

has_web || fail "apps/web absent ; voir docs/HANDOFF.md"

info "démo (simulée) → http://localhost:3000"
cd "$WEB_DIR"
NEXT_PUBLIC_DEMO_MODE=true exec pnpm dev
