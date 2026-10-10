# Production gate

This repository is a hackathon prototype. The items below are **not done**; each must be implemented and tested before the chatbot is exposed publicly. Do not tick an item from code inspection or a mock test.

## Identity and authorisation
- [ ] Real user identity and conversation ownership. Today a conversation is protected only by its unguessable id; anyone holding the id can read and modify it.
- [ ] Restrict who may create conversations that call the paid model.

## Network and abuse limits
- [ ] TLS and a reverse proxy with request-size limits (including chunked multipart uploads).
- [ ] Distributed rate limiting and per-user quotas. The current limiter is in-process and per conversation.
- [ ] Spend limits on the model account; alerting on latency, error rate and cost.
- [ ] Bounded concurrency around `ffprobe`/`ffmpeg`.

## Data lifecycle
- [ ] Retention period for conversations and transcripts; scheduled deletion. Nothing is purged today.
- [ ] Privacy notice for teachers; confirm no pupil identity is collected (the product never asks for it, but free text may contain it).
- [ ] Review the provider's own retention. `store=false` on the Responses API is not a zero-retention guarantee.
- [ ] Encrypted storage and backups; restore tested.

## Database and concurrency
- [ ] PostgreSQL path exercised (only SQLite has been run) with Alembic migrations (ADR-013).
- [ ] Concurrency tested with several workers: duplicate submits, stale versions, crashes during a model call.

## Model
- [ ] Human review of real French recordings (accents, noise, numbers and dates) — evals so far are synthetic text.
- [ ] Recorded latency and cost per conversation; behaviour on quota exhaustion and unavailable model ids.

## Frontend and devices
- [ ] Microphone flow on real phones and browsers (HTTPS required outside localhost); permission denied, interruption, slow network.
- [ ] Keyboard-only and screen-reader pass on real assistive technology.

## Integration
- [ ] Agreed transport with the planning module (pull `GET /export` is the default) and a test against their real service.

## Release
- [ ] Hosted CI green (the workflow exists but has not run on GitHub), dependency review, rollback plan, health/readiness probes.
