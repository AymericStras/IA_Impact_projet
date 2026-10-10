---
name: git-workflow
description: Prepare, verify, commit and hand off work in this repository — branch naming, Conventional Commits in English, pre-commit checks, HANDOFF.md update and PR creation with gh.
---

# Git workflow

## Branches
`main` is always demoable. Work on `feature/<topic>` (`feature/chat-ui`, `feature/speech-to-text`, `feature/requirements-extraction`, `feature/conversation-manager`), `fix/<topic>`, `docs/<topic>`.

## Before committing
1. `git status` — no `.env`, no `.local/`, no `artifacts/`, no audio, no database files. `git diff --cached | grep -iE "sk-[A-Za-z0-9]|api[_-]?key *="` must be empty.
2. `./scripts/check.sh` green (or the relevant subset, stated in the commit body).
3. `docs/HANDOFF.md` up to date; `docs/DECISIONS.md` / `docs/API.md` if applicable.
4. Stage by explicit paths when several agents work in parallel (not `git add -A`).

## Commit
Conventional Commits, imperative, **description in English**: `feat: add audio recording`, `fix: preserve corrected participant count`, `test: add missing-field conversation cases`, `docs: update integration contract`, `chore(ci): …`. Optional scope: `feat(api): …`, `feat(web): …`, `feat(prompt): …`. The body explains the why; end with the attribution line required by the session, if there is one.

## PR
`gh pr create --fill --base main`; description: what, why, how verified (commands run), screenshots for the UI, impact on the contract (none / version bump). CI green. Squash merge.

## Handoff
The final message of a session lists the modified files, the checks performed and the next step as written in `docs/HANDOFF.md`.
