# Project Instructions

@AGENTS.md

Follow the architecture, invariants and development rules defined in AGENTS.md.

Before editing:
1. Read `docs/HANDOFF.md`, then the documentation relevant to the task.
2. Inspect existing implementations and reuse them.
3. Identify affected modules and any contract impact.
4. Write or update the appropriate tests.

After editing:
1. Run the relevant tests (`./scripts/test.sh` or a subset).
2. Run linting and type checks (`./scripts/check.sh`).
3. Update `docs/HANDOFF.md`, and `docs/DECISIONS.md` / `docs/API.md` when relevant.
4. Summarize all changed files.

Project skills live in `.claude/skills/` (symlinks to `.agents/skills/`), role agents in `.claude/agents/`.
