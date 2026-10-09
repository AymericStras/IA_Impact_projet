#!/usr/bin/env bash
# Mock demo: web app only, scripted conversation, no API key, no backend. Clearly labelled "Mode démo" in the UI.
. "$(dirname "$0")/_lib.sh"

has_web || fail "apps/web not created yet (P3). Demo mode will be available after the frontend exists; see docs/HANDOFF.md"

info "demo (mock) → http://localhost:3000"
cd "$WEB_DIR"
NEXT_PUBLIC_DEMO_MODE=true exec pnpm dev
