# Takeover prompt

Paste the block below as the first instruction when opening this repository in Codex or Claude Code. Everything an agent needs is in the repository; no earlier chat is required.

```text
You are taking over the SNCF liO Teacher Chatbot repository. Do not rebuild the project and do not rely
on any earlier conversation.

First read AGENTS.md, README.md, docs/HANDOFF.md, docs/tasks/board.json and the nested AGENTS.md of any
directory you will touch (services/api/AGENTS.md, apps/web/AGENTS.md). Inspect the git branch, uncommitted
changes and the latest reports/. Tell me what is really implemented, what is simulated, and what has not
been verified.

Keep exactly four business fields: participants, departure, return, teaching subject/theme. The LLM
proposes typed patches; code owns state, validation, totals and the next question. Only an explicit user
action confirms. Do not add recommendation, itinerary, budget or booking logic.

Pick the highest-priority task on the board that is `ready` (not `blocked`). If a task needs credentials,
a teammate's API or a physical device that is not available, do not fake it: do the verifiable part and
say what remains. Write the failing test first, make the smallest change, run ./scripts/check.sh. If you
change a Pydantic schema, regenerate the contracts. If you change a skill, run scripts/sync_skills.py.
If you change a prompt, add eval cases first and rerun the evals.

Frontend (apps/web) has a frozen design system. Follow apps/web/AGENTS.md and docs/DESIGN.md exactly:
no restyling, no new colours or fonts, no new UI libraries, no client-side field logic. UI changes need
the component tests and the Playwright screenshots to pass, and you must look at the screenshots.

For parallel work, freeze the contract, assign file ownership and use scripts/worktree.py. Never read or
print .env or Keychain values, bypass tool permissions, push to a remote, or delete existing work.

When you finish: list changed files, the checks you actually ran and their results, what is still
unverified, and the next step. Update docs/HANDOFF.md and docs/tasks/board.json, run
python scripts/handoff.py, and commit with a Conventional Commit. Explain your summary to the project
owner in Chinese.
```
