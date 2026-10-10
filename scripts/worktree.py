#!/usr/bin/env python3
"""Create one isolated git worktree + branch for a parallel agent task.

  python scripts/worktree.py voice-device-qa   ->  ../sncf_chatbot--voice-device-qa on branch feature/voice-device-qa

Only `git worktree add` is run: no checkout, reset, force, delete or push. The coordinator integrates
the branch after review. Never copy .env into a task worktree.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    if len(sys.argv) != 2 or not re.fullmatch(r"[a-z][a-z0-9-]{2,48}", sys.argv[1]):
        print("usage: python scripts/worktree.py <lowercase-task-slug>", file=sys.stderr)
        return 2
    task = sys.argv[1]
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        print("working tree is dirty: commit or stash before creating parallel work", file=sys.stderr)
        return 1
    destination = ROOT.parent / f"{ROOT.name}--{task}"
    subprocess.run(["git", "worktree", "add", "-b", f"feature/{task}", str(destination), "HEAD"], cwd=ROOT, check=True)
    print(destination)
    print("Edit only the files your task owns. Shared contracts, dependencies and the task board belong to the coordinator.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
