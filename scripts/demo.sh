#!/usr/bin/env bash
# Simulated demo: web only, scripted conversation, no key or backend. « Mode démo » badge in the interface.
. "$(dirname "$0")/_lib.sh"

has_web || fail "apps/web absent; see docs/HANDOFF.md"

info "demo (simulated) → http://localhost:3000"
cd "$WEB_DIR"
NEXT_PUBLIC_DEMO_MODE=true exec pnpm dev
