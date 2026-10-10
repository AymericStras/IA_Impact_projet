#!/usr/bin/env bash
# Deploys the chatbot to zhao-zenbook at https://zhaoyang.fr/sncf-chatbot/.
#
#   deploy/deploy.sh preflight          read-only: is the host healthy enough to accept the stack?
#   deploy/deploy.sh build              build both linux/amd64 images locally (never on the server)
#   deploy/deploy.sh ship               upload + docker load the images (no service is started)
#   deploy/deploy.sh remote [commit]    build ON the server from a pushed commit, inside a memory/CPU
#                                       budget (preferred: no large upload). Default: local HEAD
#   deploy/deploy.sh up --yes           start/replace the two containers (loopback ports only)
#                                       add --owner-approved when the owner has reviewed a host-guard
#                                       refusal that is not about resources (see docs/DEPLOYMENT.md)
#   deploy/deploy.sh route --yes        add/refresh the gateway block and reload nginx (graceful)
#   deploy/deploy.sh status             containers, memory use, public smoke test
#   deploy/deploy.sh down --yes         stop this stack and remove its gateway block
#
# The server hosts production services. This script follows its host rules
# (~/AGENTS.md, ~/Developer/host-guard): nothing is built or tested there, only this stack's own
# containers are touched, the stack is hard-capped, and `up` refuses to add load while the host
# is under memory pressure, short of memory or short of disk. Those resource checks cannot be
# skipped. A refusal coming only from host-guard's own health bookkeeping can be overridden with
# --owner-approved, which the owner must ask for explicitly each time.
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
remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "$@"; }
confirm() { [ "${1:-}" = "--yes" ] || fail "this changes the server: re-run with --yes"; }

preflight() {
  # Thresholds from host-guard/PRODUCTION-SAFETY-PLAN.md (admission): memory PSI full avg10 < 1 %,
  # at least 6 GiB available after our 0.75 GiB budget, root filesystem >= 25 GiB and >= 10 % free.
  remote 'python3 - "$@"' "$WEB_PORT" "$API_PORT" "${OWNER_APPROVED:-no}" <<'PY'
import json, os, shutil, socket, subprocess, sys
web_port, api_port, owner_approved = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3] == "yes"
reasons, advisory = [], []  # reasons always block; advisory blocks unless the owner approved
psi = dict(line.split(None, 1) for line in open("/proc/pressure/memory"))
full10 = float(psi["full"].split("avg10=")[1].split()[0])
full60 = float(psi["full"].split("avg60=")[1].split()[0])
mem = {k.rstrip(":"): int(v.split()[0]) for k, v in (l.split(None, 1) for l in open("/proc/meminfo"))}
available_gib = mem["MemAvailable"] / 1048576
disk = shutil.disk_usage("/")
free_gib, free_pct = disk.free / 2**30, 100 * disk.free / disk.total
if full10 >= 1.0 or full60 >= 1.0:
    reasons.append(f"memory pressure (PSI full avg10={full10} avg60={full60}, limit 1.0)")
if available_gib - 0.75 < 6:
    reasons.append(f"available memory {available_gib:.1f} GiB leaves less than 6 GiB after this stack")
if free_gib < 25.5 or free_pct < 10:
    reasons.append(f"root filesystem {free_gib:.1f} GiB / {free_pct:.0f} % free (need 25 GiB + images, 10 %)")
ours = subprocess.run(["docker", "ps", "--filter", "label=com.docker.compose.project=sncf-chatbot", "-q"],
                      capture_output=True, text=True).stdout.split()
for port in (web_port, api_port):
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", port)) == 0 and not ours:
            reasons.append(f"port {port} is already in use by something else")
guard = None
if shutil.which("host-guard"):
    try:
        guard = json.loads(subprocess.run(["host-guard", "preflight"], capture_output=True, text=True, timeout=30).stdout)
    except Exception as exc:  # report, do not guess
        guard = {"error": type(exc).__name__}
    blocking = {"resource_pressure", "production_health_unavailable_or_failed"} & set((guard or {}).get("reasons", []))
    if "resource_pressure" in blocking:
        reasons.append("host-guard reports: resource_pressure")
    elif blocking:
        advisory.append("host-guard reports: " + ", ".join(sorted(blocking)))
if not owner_approved:
    reasons += advisory
print(json.dumps({"allowed": not reasons, "reasons": reasons, "overridden_by_owner": advisory if owner_approved else [], "psi_full_avg10": full10, "psi_full_avg60": full60,
                  "available_gib": round(available_gib, 1), "root_free_gib": round(free_gib, 1),
                  "host_guard": (guard or {}).get("reasons", guard)}, indent=2))
sys.exit(0 if not reasons else 3)
PY
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
  say "uploading images for $RELEASE (rate-limited, no service started)"
  remote "mkdir -p $REMOTE_DIR/data"
  docker save "sncf-chatbot-api:$RELEASE" "sncf-chatbot-web:$RELEASE" | gzip -1 |
    ssh -o BatchMode=yes "$HOST" 'gunzip | docker load'
  scp -q "$ROOT/deploy/compose.yaml" "$HOST:$REMOTE_DIR/compose.yaml"
  remote "printf 'RELEASE=%s\nWEB_PORT=%s\nAPI_PORT=%s\n' '$RELEASE' '$WEB_PORT' '$API_PORT' > $REMOTE_DIR/.env.next && test -r ~/.local/share/credentials/sncf-chatbot/openai-api-key"
  say "shipped. Activate with: deploy/deploy.sh up --yes"
}

remote_build() {
  local commit; commit="${1:-$(git -C "$ROOT" rev-parse HEAD)}"
  git -C "$ROOT" branch -r --contains "$commit" 2>/dev/null | grep -q . || fail "commit $commit is not pushed: the server builds from GitHub"
  preflight >/dev/null || [ "${OWNER_APPROVED:-no}" = yes ] || { preflight || true; fail "preflight refused: no build started."; }
  say "building $commit on $HOST (bounded: one build at a time, running version untouched)"
  ssh -o BatchMode=yes "$HOST" "WEB_PORT=$WEB_PORT API_PORT=$API_PORT bash -s -- $commit" < "$ROOT/deploy/remote-build.sh"
}

up() {
  confirm "${1:-}"
  [ "${2:-}" = "--owner-approved" ] && OWNER_APPROVED=yes
  preflight || fail "preflight refused: the host is not in a state to accept new load. Nothing was started."
  say "starting sncf-chatbot $RELEASE on 127.0.0.1:$WEB_PORT (web) and :$API_PORT (api)"
  remote "cd $REMOTE_DIR && cp -f .env .env.previous 2>/dev/null; mv .env.next .env && docker compose up -d --no-build --remove-orphans && sleep 6 && docker compose ps --format '{{.Service}} {{.State}} {{.Health}}'"
  remote "curl -fsS -o /dev/null -w 'api  %{http_code}\n' http://127.0.0.1:$API_PORT/api/v1/health && curl -fsS -o /dev/null -w 'web  %{http_code}\n' http://127.0.0.1:$WEB_PORT$BASE_PATH"
}

route() {
  confirm "${1:-}"
  local block; block="$(sed -e "s/__WEB_PORT__/$WEB_PORT/g" -e "s/__API_PORT__/$API_PORT/g" "$ROOT/deploy/gateway-sncf-chatbot.conf")"
  say "updating the managed block in the gateway (backup, nginx -t, graceful reload)"
  # The block travels as a base64 argument: stdin is taken by the Python program itself.
  remote 'sudo -n python3 - "$@"' "$GATEWAY_CONF" "$GATEWAY_CONTAINER" "$(printf '%s\n' "$block" | base64 | tr -d '\n')" <<'PY'
import base64, datetime, re, shutil, subprocess, sys
conf, container = sys.argv[1], sys.argv[2]
block = base64.b64decode(sys.argv[3]).decode().strip() + "\n"
if "# BEGIN managed sncf-chatbot" not in block or "# END managed sncf-chatbot" not in block:
    sys.exit("route block missing or truncated: nothing changed")
text = open(conf, encoding="utf-8").read()
pattern = re.compile(r"# BEGIN managed sncf-chatbot\n.*?# END managed sncf-chatbot\n", re.S)
if pattern.search(text):
    new = pattern.sub(lambda _: block, text, count=1)
else:
    anchor = "server_name zhaoyang.fr;\n"
    if text.count(anchor) != 1:
        sys.exit("gateway config: expected exactly one 'server_name zhaoyang.fr;'")
    new = text.replace(anchor + "\n", anchor, 1) if text.count(anchor + "\n") == 1 else text  # drop a stray blank line
    new = new.replace(anchor, anchor + block, 1)
if new == text:
    print("gateway block already up to date"); sys.exit(0)
backup = f"{conf}.before-sncf-chatbot-{datetime.datetime.now():%Y%m%dT%H%M%S}"
shutil.copy2(conf, backup)
with open(conf, "r+", encoding="utf-8") as handle:  # truncate-and-write keeps the bind-mounted inode
    handle.seek(0); handle.write(new); handle.truncate()
test = subprocess.run(["docker", "exec", container, "nginx", "-t"], capture_output=True, text=True)
if test.returncode != 0:
    with open(conf, "r+", encoding="utf-8") as handle:
        handle.seek(0); handle.write(text); handle.truncate()
    sys.exit("nginx -t failed, config restored:\n" + test.stderr)
subprocess.run(["docker", "exec", container, "nginx", "-s", "reload"], check=True)
print("gateway reloaded; backup:", backup)
PY
  sleep 2
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
  remote 'sudo -n python3 - "$@"' "$GATEWAY_CONF" "$GATEWAY_CONTAINER" <<'PY'
import re, subprocess, sys
conf, container = sys.argv[1], sys.argv[2]
text = open(conf, encoding="utf-8").read()
new = re.sub(r"# BEGIN managed sncf-chatbot\n.*?# END managed sncf-chatbot\n", "", text, count=1, flags=re.S)
if new != text:
    with open(conf, "r+", encoding="utf-8") as handle:
        handle.seek(0); handle.write(new); handle.truncate()
    if subprocess.run(["docker", "exec", container, "nginx", "-t"]).returncode == 0:
        subprocess.run(["docker", "exec", container, "nginx", "-s", "reload"], check=True)
PY
  remote "cd $REMOTE_DIR && docker compose down"
}

case "${1:-}" in
  preflight) preflight ;;
  build) build ;;
  ship) ship ;;
  remote) [ "${3:-}" = "--owner-approved" ] && OWNER_APPROVED=yes; [ "${2:-}" = "--owner-approved" ] && { OWNER_APPROVED=yes; remote_build; exit; }; remote_build "${2:-}" ;;
  up) up "${2:-}" "${3:-}" ;;
  route) route "${2:-}" ;;
  status) status ;;
  down) down "${2:-}" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
