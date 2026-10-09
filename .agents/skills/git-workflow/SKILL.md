---
name: git-workflow
description: Prepare, verify, commit and hand off work in this repo — branch naming, Conventional Commits, pre-commit checks, HANDOFF.md updates, and PR creation with gh.
---

# Git workflow

## Branches
`main` is always demoable. Work on `feature/<topic>` (`feature/chat-ui`, `feature/speech-to-text`, `feature/requirements-extraction`, `feature/conversation-manager`), `fix/<topic>`, `docs/<topic>`.

## Before committing
1. `git status` — no `.env`, `.local/`, `artifacts/`, audio, db files. `git diff --cached | grep -iE "sk-[A-Za-z0-9]|api[_-]?key *="` must be empty.
2. `./scripts/check.sh` passes (or the relevant subset, stated in the commit body).
3. `docs/HANDOFF.md` updated; `docs/DECISIONS.md` / `docs/API.md` if applicable.

## Commit
Conventional Commits, imperative, English: `feat: add audio recording`, `fix: preserve corrected participant count`, `test: add missing-field conversation cases`, `docs: update integration contract`, `chore(ci): …`. Optional scope: `feat(api): …`, `feat(web): …`, `feat(prompt): …`. Body explains why; end with the attribution line required by the session, if any.

## PR
`gh pr create --fill --base main`; description: what, why, how verified (commands run), screenshots for UI, contract impact (none / version bump). CI must be green. Squash-merge.

## Handoff
Final message of a session lists changed files, verification performed, and the next step as written in `docs/HANDOFF.md`.
