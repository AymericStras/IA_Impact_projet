#!/usr/bin/env python3
"""Write a factual handoff snapshot to reports/handoff-snapshot.json.

Records branch, commit, uncommitted files and the last recorded check run. It reads no secrets and
commits nothing. A snapshot is not proof that later edits passed: rerun ./scripts/check.sh.
"""

from __future__ import annotations

import datetime
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"


def git(*args: str) -> str:
    try:
        return subprocess.check_output(["git", *args], cwd=ROOT, stderr=subprocess.DEVNULL).decode().strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return "(not a git checkout)"


def load(name: str) -> object:
    path = REPORTS / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    snapshot = {
        "generated_at_utc": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
        "branch": git("branch", "--show-current"),
        "commit": git("rev-parse", "HEAD"),
        "last_commits": git("log", "--oneline", "-8").splitlines(),
        "uncommitted": git("status", "--short").splitlines(),
        "last_recorded_checks": load("checks.json"),
        "last_recorded_evals": load("evals-latest.json"),
        "notice": "Recorded checks may predate current uncommitted edits. Rerun ./scripts/check.sh before claiming completion.",
        "next": "Read docs/HANDOFF.md and docs/tasks/board.json.",
    }
    out = REPORTS / "handoff-snapshot.json"
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out.relative_to(ROOT))


if __name__ == "__main__":
    main()
