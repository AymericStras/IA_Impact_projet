# Project instructions

@AGENTS.md

Follow the architecture, invariants and development rules defined in AGENTS.md.

Before modifying:
1. Read `docs/HANDOFF.md`, then the documentation relevant to the task.
2. Inspect the existing implementations and reuse them.
3. Identify the affected modules and any impact on the contract.
4. Write or update the corresponding tests.

After modifying:
1. Run the relevant tests (`./scripts/test.sh` or a subset).
2. Run lint and type checking (`./scripts/check.sh`).
3. Update `docs/HANDOFF.md`, and `docs/DECISIONS.md` / `docs/API.md` if needed.
4. Summarise all modified files.

The project skills are in `.claude/skills/` (links to `.agents/skills/`), the role agents in `.claude/agents/`, the hooks in `.claude/settings.json`.
