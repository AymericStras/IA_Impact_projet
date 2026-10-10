#!/usr/bin/env bash
# Runs ON the server (zhao-zenbook). Builds a release from a commit with a bounded budget, then
# hands over to the stack. Called by `deploy/deploy.sh remote <commit>`; can also be run by hand:
#
#   deploy/remote-build.sh <commit-sha>        build images sncf-chatbot-{api,web}:<short sha>
#
# Budget (host rules: one build at a time, the running version keeps serving):
#   - heavy steps (dependency install, Next.js build) run in throw-away containers capped at
#     BUILD_MEMORY (default 1500m, no swap), BUILD_CPUS (default 1) and a PID limit;
#   - sources, build tree and package caches live under /data/services/sncf-chatbot (not on /);
#   - the final `docker build` only copies prebuilt files into small runtime images;
#   - a lock prevents two builds from overlapping; nothing running is touched by this script.
# The peak memory of each heavy step is printed so the budget can be tuned from evidence.
set -euo pipefail

COMMIT="${1:?usage: remote-build.sh <commit-sha>}"
BASE="/data/services/sncf-chatbot"
CHECKOUT="$HOME/Developer/sncf-chatbot"
REPO="ze2phyrzhenyin/sncf-chatbot"
BUILD_MEMORY="${BUILD_MEMORY:-1500m}"
BUILD_CPUS="${BUILD_CPUS:-1}"
BASE_PATH="/sncf-chatbot"
NODE_IMAGE="node:22-alpine"
PYTHON_IMAGE="python:3.12-alpine"

say() { printf '[remote-build] %s\n' "$*"; }
fail() { printf '[remote-build] %s\n' "$*" >&2; exit 1; }

mkdir -p "$BASE/build" "$BASE/cache/pnpm" "$BASE/cache/corepack" "$BASE/cache/uv" "$BASE/cache/next"
exec 9>"$BASE/build.lock"
flock -n 9 || fail "another build is running (lock $BASE/build.lock)"

# --- source: exactly the requested commit, exported without .git, ignored files or secrets -------
if [ ! -d "$CHECKOUT/.git" ]; then
  say "cloning $REPO into $CHECKOUT"
  gh repo clone "$REPO" "$CHECKOUT" -- --quiet
fi
git -C "$CHECKOUT" fetch --quiet origin
FULL="$(git -C "$CHECKOUT" rev-parse --verify --quiet "${COMMIT}^{commit}")" || fail "unknown commit $COMMIT (pushed?)"
REL="${FULL:0:12}"
TREE="$BASE/build/$REL"
rm -rf "$TREE" && mkdir -p "$TREE"
git -C "$CHECKOUT" archive "$FULL" | tar -x -C "$TREE"
say "source $REL exported to $TREE"

bounded() { # bounded <name> <image> <workdir> <shell script> [extra docker args...]
  local name="$1" image="$2" workdir="$3" script="$4"; shift 4
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run --name "$name" --rm \
    --memory "$BUILD_MEMORY" --memory-swap "$BUILD_MEMORY" --cpus "$BUILD_CPUS" --pids-limit 512 \
    --cap-drop ALL --security-opt no-new-privileges:true --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/home -w "$workdir" "$@" "$image" sh -ec "$script
echo \"[remote-build] peak memory of $name: \$(( \$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0) / 1048576 )) MiB (cap $BUILD_MEMORY)\""
}

# --- web: install and build inside the budget ---------------------------------------------------
say "web: pnpm install + next build (cap $BUILD_MEMORY, $BUILD_CPUS cpu)"
bounded sncf-chatbot-build-web "$NODE_IMAGE" /srv/apps/web '
  mkdir -p /tmp/home public
  corepack pnpm config set store-dir /cache/pnpm >/dev/null
  corepack pnpm install --frozen-lockfile --prefer-offline
  corepack pnpm build
  test -f .next/standalone/server.js' \
  -v "$TREE/apps/web:/srv/apps/web" -v "$BASE/cache/pnpm:/cache/pnpm" -v "$BASE/cache/corepack:/cache/corepack" \
  -e COREPACK_HOME=/cache/corepack -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 -e CI=1 \
  -e NODE_OPTIONS=--max-old-space-size=1024 -e NEXT_TELEMETRY_DISABLED=1 \
  -e NEXT_PUBLIC_BASE_PATH="$BASE_PATH" -e NEXT_PUBLIC_API_BASE_URL= -e NEXT_PUBLIC_DEMO_MODE=false -e NEXT_OUTPUT=standalone

# --- api: virtualenv built in the same base image and at the same path as the runtime ------------
say "api: uv sync (cap $BUILD_MEMORY, $BUILD_CPUS cpu)"
bounded sncf-chatbot-build-api "$PYTHON_IMAGE" /srv/services/api '
  mkdir -p /tmp/home
  python -m pip install --quiet --disable-pip-version-check --target /tmp/uv uv==0.6.14
  PYTHONPATH=/tmp/uv /tmp/uv/bin/uv sync --frozen --no-dev --no-install-project
  .venv/bin/python -c "import fastapi, pydantic, sqlalchemy, openai"' \
  -v "$TREE/services/api:/srv/services/api" -v "$BASE/cache/uv:/cache/uv" \
  -e UV_CACHE_DIR=/cache/uv -e UV_LINK_MODE=copy -e UV_COMPILE_BYTECODE=1 -e UV_PYTHON_DOWNLOADS=never

# --- runtime images: copy prebuilt files only (light) --------------------------------------------
say "assembling runtime images"
cat > "$TREE/Dockerfile.api.runtime" <<EOF
FROM $PYTHON_IMAGE
RUN apk add --no-cache ffmpeg && adduser -D -u 1000 app && mkdir -p /data && chown app /data
WORKDIR /srv/services/api
COPY --chown=1000:1000 services/api/.venv ./.venv
COPY --chown=1000:1000 services/api/app ./app
COPY --chown=1000:1000 services/api/pyproject.toml ./pyproject.toml
ENV PATH="/srv/services/api/.venv/bin:\$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER 1000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--log-level", "info"]
EOF
cat > "$TREE/Dockerfile.web.runtime" <<EOF
FROM $NODE_IMAGE
WORKDIR /srv/apps/web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --chown=1000:1000 apps/web/.next/standalone ./
COPY --chown=1000:1000 apps/web/.next/static ./.next/static
COPY --chown=1000:1000 apps/web/public ./public
USER 1000
EXPOSE 3000
CMD ["node", "server.js"]
EOF
printf '%s\n' '**/node_modules' '!apps/web/.next/standalone/node_modules' '!apps/web/.next/standalone/**/node_modules' \
  'apps/web/.next/cache' 'apps/web/e2e' '**/__pycache__' > "$TREE/.dockerignore"
docker build --quiet -f "$TREE/Dockerfile.api.runtime" -t "sncf-chatbot-api:$REL" "$TREE" >/dev/null
docker build --quiet -f "$TREE/Dockerfile.web.runtime" -t "sncf-chatbot-web:$REL" "$TREE" >/dev/null
docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep "sncf-chatbot-.*:$REL"

# --- hand-over files; the stack itself is started by `deploy.sh up` -------------------------------
cp "$TREE/deploy/compose.yaml" "$BASE/compose.yaml"
printf 'RELEASE=%s\nWEB_PORT=%s\nAPI_PORT=%s\n' "$REL" "${WEB_PORT:-33450}" "${API_PORT:-33451}" > "$BASE/.env.next"
# Keep the build tree of this release only; older trees are removed (caches stay).
find "$BASE/build" -mindepth 1 -maxdepth 1 -type d ! -name "$REL" -exec rm -rf {} +
rm -rf "$TREE/apps/web/node_modules" "$TREE/services/api/.venv"
say "built $REL. Activate with: deploy/deploy.sh up --yes"
