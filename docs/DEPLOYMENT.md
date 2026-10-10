# Deployment — zhaoyang.fr/sncf-chatbot

Target: `zhao-zenbook` (home server), published through the existing `zhaoyang.fr` gateway at
`https://zhaoyang.fr/sncf-chatbot/`. Development, tests and image builds happen on the developer
machine; the server only runs two small containers.

## Current release gate — 2026-10-10

The V3 restyle is being verified on hosted development runners; it is not deployed. A read-only inspection found the live API and web containers using `a2d62efa4418`. The host's 768 MiB preflight returned `allowed=true` for `offline_readonly_sandbox` only: this is not admission for Docker image import, container replacement or gateway mutation. Those operations still need the verified shared deployment transaction described by host-guard. Do not run the historical server-build or `--owner-approved` paths below. Deployment hardening is tracked separately on `fix/deploy-guardrails`; this UI task does not modify or activate it.

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

Images: API 288 MB (Alpine + ffmpeg). Root filesystem on the host is tight (about 26 GiB free on 2026-10-10; the host rule wants 25 GiB): prune old `sncf-chatbot-*` images after a successful release.

## Historical commands (superseded; do not execute)

```sh
deploy/deploy.sh preflight                 # read-only admission check
deploy/deploy.sh remote [commit]           # build ON the server from a pushed commit (preferred)
deploy/deploy.sh up --yes                  # start/replace this stack only
deploy/deploy.sh route --yes               # gateway block: backup, nginx -t, graceful reload, public smoke test
deploy/deploy.sh status
deploy/deploy.sh down --yes                # remove the route, stop this stack, keep the data
deploy/deploy.sh build && deploy/deploy.sh ship   # alternative: build locally and upload (slow uplink: ~500 MB)
```

**Updating**: push to GitHub, then `deploy/deploy.sh remote && RELEASE=<short sha> deploy/deploy.sh up --yes`. The route does not change between releases.

### Building on the server

`deploy/remote-build.sh` runs on the server: it exports the commit from the GitHub checkout (`~/Developer/sncf-chatbot`, cloned with the host's `gh` login) into `/data/services/sncf-chatbot/build/<sha>`, runs the heavy steps in throw-away containers capped at 1500 MiB (no swap), 1 CPU and 512 PIDs, keeps package caches under `/data/services/sncf-chatbot/cache`, then assembles small runtime images that only copy prebuilt files. A lock allows one build at a time. The running version keeps serving during the build.

Measured on 2026-10-10 (two builds): `next build` reached the 1500 MiB cap (the figure includes page cache; the build completed without being killed), `uv sync` peaked at 316–328 MiB; host memory pressure stayed at 0 and available memory above 8 GiB. Switching containers caused one failed public probe out of 25 (a few seconds).

### Preflight and the owner override

The preflight always blocks on resources: memory PSI `full` at or above 1 %, less than 6 GiB available after this stack's budget, root filesystem under 25 GiB or 10 % free, ports taken by something else, or `host-guard` reporting `resource_pressure`. These cannot be skipped. A refusal that comes only from `host-guard`'s own health bookkeeping (`production_health_unavailable_or_failed`, which on 2026-10-10 reflected the restart history of an unrelated ClamAV container, not a current fault) can be overridden with `--owner-approved`, which the owner must ask for explicitly each time.

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
