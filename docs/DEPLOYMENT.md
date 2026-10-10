# Deployment — zhaoyang.fr/sncf-chatbot

Target: `zhao-zenbook` (home server), published through the existing `zhaoyang.fr` gateway at
`https://zhaoyang.fr/sncf-chatbot/`. Development, tests and image builds happen on the developer
machine; the server only runs two small containers.

## Layout on the server (host conventions)

| What | Where |
|---|---|
| Compose file, `.env` (release id, ports), SQLite data | `/data/services/sncf-chatbot/` |
| OpenAI API key (0600, never in an image or the compose env) | `~/.local/share/credentials/sncf-chatbot/openai-api-key` |
| Stitch key (shared, already on the host) | `~/.local/share/credentials/stitch/api-key` |
| Gateway route | managed block `sncf-chatbot` in `/data/services/zenbook-gateway/nginx.conf` |
| Loopback ports | web `127.0.0.1:33450`, API `127.0.0.1:33451` |

`zhaoyang.fr` forwards every path to the zenbook gateway, so no change is needed on the public ingress.

## Resource budget

| Container | Memory cap (no swap) | CPU | Observed locally |
|---|---|---|---|
| `api` (FastAPI, 1 worker) | 384 MiB | 1 | about 80–120 MiB |
| `web` (Next.js standalone) | 384 MiB | 1 | about 100–180 MiB |

Images: API 288 MB (Alpine + ffmpeg). Root filesystem on the host is tight (about 26 GiB free on 2026-10-10; the host rule wants 25 GiB): prune old `sncf-chatbot-*` images after a successful release.

## Commands

```sh
deploy/deploy.sh preflight     # read-only admission check
deploy/deploy.sh build         # local linux/amd64 images, tagged with the commit
deploy/deploy.sh ship          # docker save | ssh docker load, compose file, release env
deploy/deploy.sh up --yes      # start/replace this stack only (preflight must pass)
deploy/deploy.sh route --yes   # gateway block: backup, nginx -t, graceful reload, public smoke test
deploy/deploy.sh status
deploy/deploy.sh down --yes    # remove the route, stop this stack, keep the data
```

The preflight applies the admission thresholds of the host's own safety plan: memory PSI `full` below 1 %, at least 6 GiB available after this stack's budget, root filesystem at least 25 GiB and 10 % free, and no `resource_pressure` / `production_health_unavailable_or_failed` from `host-guard preflight`. There is no override flag.

## Routing details

- Next.js is built with `basePath=/sncf-chatbot`; the browser calls the API on the same origin at `/sncf-chatbot/api/v1/…`, which the gateway proxies to the API container's `/api/v1/…`. `/docs` and `/openapi.json` are not exposed.
- Uploads: `client_max_body_size 11m` (audio cap is 10 MiB). Read timeout 75 s (model timeout is 30 s plus one retry).
- The microphone needs HTTPS: satisfied by the public vhost.

## Public exposure

The URL is public and, at the owner's request, there is no rate limiting and no cap on model calls (`RATE_LIMIT_PER_MINUTE=0`). Anyone who finds the URL can spend the API key's quota: set a monthly budget on the key in the provider's dashboard. Conversations are protected only by their unguessable id. See `docs/PRODUCTION.md`.

## Status — 2026-10-10

- Done: deployment bundle written; API image builds locally for linux/amd64; API key copied to the server's credentials directory (fingerprint verified).
- Not done: web image build, `ship`, `up`, `route`. On 2026-10-10 around 02:35 the preflight refused: memory PSI `full` avg10 between 3 % and 9 % (a pre-existing ClamAV container restart loop on the host, 76 restarts) and `host-guard` reporting `resource_pressure` and `production_health_unavailable_or_failed`. Nothing was started on the server.
- Building on the server is possible later only if the host rules allow it; today they suspend full builds on that machine.
