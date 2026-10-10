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
| `api` (FastAPI, 1 worker) | 384 MiB | 1 | 185 MiB after a text and an audio request (amd64 image under emulation) |
| `web` (Next.js standalone) | 384 MiB | 1 | about 100–180 MiB |

Images: API 288 MB (Alpine + ffmpeg). Docker and containerd storage are already backed by `/data`; pruning their images does not reclaim the root filesystem. Root cleanup belongs to the host maintenance workflow.

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

Preflight delegates every admission decision to `host-guard preflight --memory-mb 768`. It requires an explicit `allowed=true`, no refusal reasons, the exact budget, a successful exit and valid JSON; missing, malformed and timed-out protection fails closed. Occupied ports must belong to this stack. There is no override flag.

This check establishes current readiness only. It does not reserve the host-guard task slot or prove that the shared Docker daemon's image-import work is inside the task budget. `ship` now caps its uncompressed stream at 2 MiB/s and checks readiness first, but **production ship/up remain pending a guarded deployment transaction that covers daemon work and verifies actual container cgroups**. Do not treat preflight alone as authorization to run them.

## Routing details

- Next.js is built with `basePath=/sncf-chatbot`; the browser calls the API on the same origin at `/sncf-chatbot/api/v1/…`, which the gateway proxies to the API container's `/api/v1/…`. `/docs` and `/openapi.json` are not exposed.
- Uploads: `client_max_body_size 11m` (audio cap is 10 MiB). Read timeout 75 s (model timeout is 30 s plus one retry).
- The microphone needs HTTPS: satisfied by the public vhost.

## Public exposure

The URL is public and, at the owner's request, there is no rate limiting and no cap on model calls (`RATE_LIMIT_PER_MINUTE=0`). Anyone who finds the URL can spend the API key's quota: set a monthly budget on the key in the provider's dashboard. Conversations are protected only by their unguessable id. See `docs/PRODUCTION.md`.

## Status — 2026-10-10

- Done: deployment bundle written; the linux/amd64 API image was run locally with the deployment restrictions (uid 1000, read-only root, no capabilities, 384 MiB cap) and served a real extraction and a real transcription; API key copied to the server's credentials directory (fingerprint verified).
- Not done: web image build, `ship`, `up`, `route`. On 2026-10-10 around 02:35 the preflight refused: memory PSI `full` avg10 between 3 % and 9 % (a pre-existing ClamAV container restart loop on the host, 76 restarts) and `host-guard` reporting `resource_pressure` and `production_health_unavailable_or_failed`. Nothing was started on the server.
- Host diagnosis corrected: the controller repeatedly created TLS contexts and hit its own `memory.high`; caching the opener reduced controller memory to about 17 MiB and host memory PSI to 0. ClamAV has a separate socket-startup mismatch; it was not proven to cause the observed pressure.
- Deployment script fixes verified locally: all refusal reasons honored, ports checked individually, managed block passed separately from Python stdin, same-inode gateway updates restored after validation/reload failure, and failed route removal cannot proceed to stopping containers. No live gateway changes made.
- Building on the server is possible later only if the host rules allow it; today they suspend full builds on that machine.
