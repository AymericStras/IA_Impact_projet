# Deployment — zhaoyang.fr/sncf-chatbot

Target: `zhao-zenbook` (home server), published through the existing `zhaoyang.fr` gateway at
`https://zhaoyang.fr/sncf-chatbot/`. Development, tests and image builds happen on the developer
machine; the server only runs two small containers.

## Current release — 2026-10-10

**Live at https://zhaoyang.fr/sncf-chatbot/: release `71610a3c0af5`** (V3 identity, five fields, simulated journey in both interfaces, labelled mode switch on phones), images built on the developer machine. `71610a3c0af5` replaced `fbeabc2dc29a` the same day: only the web image was uploaded (compressed, 4 min 48 s); the API image is the `fbeabc2dc29a` one retagged on the host, the backend being unchanged. The backup unit was again stopped for the switch and started afterwards. After the switch: public web, `/vocal/` and API health 200, the « Vocal » and « Classique » links navigate both ways at 390 and 360 px on the live site, neighbouring sites 200. The notes below describe the `fbeabc2dc29a` release.

- How it went: the preflight refused while `repair-workflow-external-backup.service` was in a failure loop on the host (`RuntimeError: snapshot_retention_expired`, systemd `auto-restart`; host-guard reports it as `maintenance_active`). With the owner's explicit approval that unit was stopped for the release and started again afterwards (it still fails: a host task, outside this repository). The preflight then returned `allowed=true`.
- Upload: the home uplink gives about 0.2 MB/s, far under the 2 MiB/s cap of `ship`. With the owner's approval the 497 MB stream was sent compressed instead (`docker save … | zstd -T0 -12 | ssh host 'zstd -d | docker load'`, 140 MB, 11 min 18 s), then the compose file and `.env.next` were written as `ship` does, and `deploy/deploy.sh up --yes` (with its preflight) replaced the two containers.
- Verified after the switch: `deploy.sh status` — API healthy 72 MiB, web 37 MiB (caps 384 MiB), public web and API health 200; `GET /config` returns `planner_mode: simulated`; `POST /conversations` 201 with the five-field welcome; `/` and `/vocal/` 200. Host memory PSI 0 before and after. `zhaoyang.fr/`, `/sitelist/` and `rex31.com/` answered 200 before and after; `/label-print/` answered 404 before and after.
- Not verified: a full conversation with the live model or the microphone on this release, real devices, a rollback. At the owner's request the images of `a2d62efa4418` and `967768381684` were then removed from the host: only `fbeabc2dc29a` remains, `.env.previous` still names `a2d62efa4418`, so a rollback now needs that release rebuilt and shipped first.
- host-guard's `allowed=true` is a readiness answer for its offline sandbox; it has no admission path for a Docker import and a container replacement. This release went ahead on the owner's repeated explicit instruction. The server-build and `--owner-approved` paths no longer exist in `deploy/deploy.sh`. The release evidence further down describes an earlier release.

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

## Historical release evidence — 2026-10-10

**Live at https://zhaoyang.fr/sncf-chatbot/** (release `fb06e85d40b5`, built on the server).

- Verified from the public internet in Chromium with a fake microphone fed synthesized French speech: recording over HTTPS, upload through the gateway, transcription, extraction of the five fields with a follow-up question for the station, confirmation, JSON with `schema_version` 1.1. No console or network error.
- Containers: API 73–88 MiB, web 35–40 MiB (caps 384 MiB each). Existing sites on the host (`zhaoyang.fr/`, `/sitelist/`, `rex31.com/`, `/label-print/`) answered 200 before and after each step.
- The OpenAI key is read from `~/.local/share/credentials/sncf-chatbot/openai-api-key` (mounted read-only).
- The deployed web is the last committed frontend: the conversation handles the departure station, but the side panel does not yet show it as a fifth row, and the simulated journey after confirmation has no interface yet.
- Not verified: real phones and real microphones on the public URL; behaviour under concurrent users; a rollback (`.env.previous` is kept, the previous images are still on the host, but the path has not been exercised).
- Disk: root filesystem at 26 GiB free, close to the host's 25 GiB floor. Each release adds about 700 MB of images; remove images of releases older than the previous one.
- Host diagnosis corrected: the controller repeatedly created TLS contexts and hit its own `memory.high`; caching the opener reduced controller memory to about 17 MiB and host memory PSI to 0. ClamAV has a separate socket-startup mismatch; it was not proven to cause the observed pressure.
- Deployment script fixes verified locally: all refusal reasons honored, ports checked individually, managed block passed separately from Python stdin, same-inode gateway updates restored after validation/reload failure, and failed route removal cannot proceed to stopping containers. No live gateway changes made.
- Building on the server is possible later only if the host rules allow it; today they suspend full builds on that machine.
