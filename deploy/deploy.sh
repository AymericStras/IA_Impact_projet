#!/usr/bin/env bash
# Deploys the chatbot to zhao-zenbook at https://zhaoyang.fr/sncf-chatbot/.
#
#   deploy/deploy.sh preflight          read-only: is the host healthy enough to accept the stack?
#   deploy/deploy.sh build              build both linux/amd64 images locally (never on the server)
#   deploy/deploy.sh ship               upload + docker load the images (no service is started)
#   deploy/deploy.sh up --yes           start/replace the two containers (loopback ports only)
#   deploy/deploy.sh route --yes        add/refresh the gateway block and reload nginx (graceful)
#   deploy/deploy.sh status             containers, memory use, public smoke test
#   deploy/deploy.sh down --yes         stop this stack and remove its gateway block
#
# The server hosts production services. This script follows its host rules
# (~/AGENTS.md, ~/Developer/host-guard): nothing is built or tested there, only this stack's own
# containers are touched, the stack is hard-capped, and `up` refuses to add load while the host
# is under memory pressure. There is deliberately no flag to skip the preflight.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-zhao-zenbook}"
BASE_PATH="/sncf-chatbot"
REMOTE_DIR="/data/services/sncf-chatbot"
GATEWAY_CONF="/data/services/zenbook-gateway/nginx.conf"
GATEWAY_CONTAINER="zenbook-projects-gateway"
WEB_PORT="${WEB_PORT:-33450}"
API_PORT="${API_PORT:-33451}"
RELEASE="${RELEASE:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"
PUBLIC_URL="https://zhaoyang.fr${BASE_PATH}"

say()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }
[[ "$RELEASE" =~ ^[0-9a-f]{7,40}$ ]] || fail "release must be a Git commit id"
for port in "$WEB_PORT" "$API_PORT"; do
  [[ "$port" =~ ^[1-9][0-9]{3,4}$ ]] && ((port <= 65535)) || fail "invalid loopback port"
done
[ "$WEB_PORT" != "$API_PORT" ] || fail "web and API ports must differ"
remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "$@"; }
confirm() { [ "${1:-}" = "--yes" ] || fail "this changes the server: re-run with --yes"; }

preflight() {
  remote "python3 - '$WEB_PORT' '$API_PORT'" < "$ROOT/deploy/preflight.py"
}

build() {
  [ -z "$(git -C "$ROOT" status --porcelain)" ] || fail "working tree is dirty: commit first (the release id is the commit)"
  say "building linux/amd64 images for release $RELEASE (local machine)"
  docker buildx build --platform linux/amd64 -f "$ROOT/deploy/Dockerfile.api" -t "sncf-chatbot-api:$RELEASE" --load "$ROOT"
  docker buildx build --platform linux/amd64 -f "$ROOT/deploy/Dockerfile.web" \
    --build-arg "NEXT_PUBLIC_BASE_PATH=$BASE_PATH" -t "sncf-chatbot-web:$RELEASE" --load "$ROOT"
  docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep "sncf-chatbot-.*:$RELEASE"
}

ship() {
  preflight || fail "preflight refused image transfer/import"
  say "uploading uncompressed images for $RELEASE (2 MiB/s stream cap, no service started)"
  remote "mkdir -p $REMOTE_DIR/data"
  docker save "sncf-chatbot-api:$RELEASE" "sncf-chatbot-web:$RELEASE" | python3 "$ROOT/deploy/rate_limit.py" |
    ssh -o BatchMode=yes "$HOST" 'docker load'
  scp -q "$ROOT/deploy/compose.yaml" "$HOST:$REMOTE_DIR/compose.yaml"
  remote "printf 'RELEASE=%s\nWEB_PORT=%s\nAPI_PORT=%s\n' '$RELEASE' '$WEB_PORT' '$API_PORT' > $REMOTE_DIR/.env.next && test -r ~/.local/share/credentials/sncf-chatbot/openai-api-key"
  say "shipped. Activate with: deploy/deploy.sh up --yes"
}

up() {
  confirm "${1:-}"
  preflight || fail "preflight refused: the host is not in a state to accept new load. Nothing was started."
  say "starting sncf-chatbot $RELEASE on 127.0.0.1:$WEB_PORT (web) and :$API_PORT (api)"
  remote "set -eu; cd $REMOTE_DIR; test -f .env.next; test ! -f .env || cp -f .env .env.previous; mv .env.next .env; docker compose up -d --no-build --pull never; sleep 6; docker compose ps --format '{{.Service}} {{.State}} {{.Health}}'"
  remote "curl -fsS -o /dev/null -w 'api  %{http_code}\n' http://127.0.0.1:$API_PORT/api/v1/health && curl -fsS -o /dev/null -w 'web  %{http_code}\n' http://127.0.0.1:$WEB_PORT$BASE_PATH"
}

gateway() {
  local action="$1" encoded
  encoded="$(sed -e "s/__WEB_PORT__/$WEB_PORT/g" -e "s/__API_PORT__/$API_PORT/g" "$ROOT/deploy/gateway-sncf-chatbot.conf" | python3 -c 'import sys,base64; print(base64.b64encode(sys.stdin.buffer.read()).decode())')"
  remote "sudo -n python3 - '$GATEWAY_CONF' '$GATEWAY_CONTAINER' '$action' '$encoded'" < "$ROOT/deploy/gateway.py"
}

route() {
  confirm "${1:-}"
  preflight || fail "preflight refused gateway change"
  gateway up
  curl -fsS -o /dev/null -w "public web  %{http_code}\n" --max-time 15 "$PUBLIC_URL/"
  curl -fsS -o /dev/null -w "public api  %{http_code}\n" --max-time 15 "$PUBLIC_URL/api/v1/health"
}

status() {
  remote "cd $REMOTE_DIR 2>/dev/null && docker compose ps --format '{{.Service}}\t{{.Image}}\t{{.State}}\t{{.Health}}' && docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' \$(docker compose ps -q)" || say "stack not running"
  curl -s -o /dev/null -w "public web  %{http_code}\n" --max-time 15 "$PUBLIC_URL/" || true
  curl -s -o /dev/null -w "public api  %{http_code}\n" --max-time 15 "$PUBLIC_URL/api/v1/health" || true
}

down() {
  confirm "${1:-}"
  say "removing the gateway block, then stopping only this stack (data in $REMOTE_DIR/data is kept)"
  gateway down
  remote "cd $REMOTE_DIR && docker compose down"
}

case "${1:-}" in
  preflight) preflight ;;
  build) build ;;
  ship) ship ;;
  up) up "${2:-}" ;;
  route) route "${2:-}" ;;
  status) status ;;
  down) down "${2:-}" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
