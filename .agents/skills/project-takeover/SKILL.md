---
name: project-takeover
description: Resume this repository safely in Codex or Claude Code without previous chat context — read the handoff and task board, inspect git state and evidence, pick one unblocked task, and leave an honest handoff. Use at the start of every new session.
---

# Project takeover

## Inputs
The repository path and, optionally, a task id from `docs/tasks/board.json`. Never assume earlier conversation exists.

## Procedure
1. Read `AGENTS.md` → `README.md` → `docs/HANDOFF.md` → `docs/tasks/board.json`, then the nested `AGENTS.md` of the directory you will touch (`services/api/AGENTS.md`, `apps/web/AGENTS.md`).
2. Inspect `git status --short`, the current branch and `git log --oneline -10`. Never discard or overwrite uncommitted changes you did not make; ask or work around them.
3. Summarise in three lists: what is implemented and verified, what is simulated (mock demo, FakeProvider), what is unverified. Use `reports/` and the HANDOFF evidence, not assumptions.
4. Run the baseline: `./scripts/check.sh`. Record pre-existing failures separately from anything you cause.
5. Select ONE task: the highest-priority `ready` item on the board (not `blocked`). State the files it owns. If another agent owns a file, coordinate instead of editing it.
6. Write the failing test first where practical, implement the smallest coherent change, rerun the relevant checks.
7. Review your own diff. Update `docs/HANDOFF.md` and the task board with evidence (commands actually run and their results). Run `python scripts/handoff.py`.
8. Commit with Conventional Commits. Do not push, publish, create cloud resources or change production settings without explicit authorisation.

## Rules
- Do not regenerate the project or swap the stack because a newer tool exists.
- Do not expand the five-field contract.
- Model evals and live smoke tests cost money: run them when the task changes prompts/extraction, and say so in the handoff.
- Never mark something tested from a mock, a screenshot or code inspection. "Configured" is not "verified".

## Deliverable
Changed files, checks actually run with results, remaining limitations, the next task, and the commit reference.
