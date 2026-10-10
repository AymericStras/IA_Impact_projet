#!/usr/bin/env python3
"""Mirror .agents/skills (canonical, read by Codex) into .claude/skills (read by Claude Code).

Copies instead of symlinks so the repo also works on Windows checkouts.
  python scripts/sync_skills.py          # write mirrors (replaces old symlinks)
  python scripts/sync_skills.py --check  # fail on drift (used by check.sh, CI and the pre-commit hook)
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".agents" / "skills"
MIRROR = ROOT / ".claude" / "skills"


def files(base: Path) -> dict[str, bytes]:
    return {str(p.relative_to(base)): p.read_bytes() for p in sorted(base.rglob("*")) if p.is_file()}


def main() -> int:
    check = "--check" in sys.argv
    source = files(SOURCE)
    if check:
        mirror = files(MIRROR) if MIRROR.exists() else {}
        drift = sorted(k for k in source.keys() | mirror.keys() if source.get(k) != mirror.get(k))
        if drift:
            print("skill mirror drift: " + ", ".join(drift) + " — run python scripts/sync_skills.py", file=sys.stderr)
            return 1
        print(f"skill parity verified ({len(source)} files)")
        return 0
    if MIRROR.exists():
        for child in MIRROR.iterdir():
            if child.is_symlink() or child.is_file():
                child.unlink()
            else:
                shutil.rmtree(child)
    for rel, content in source.items():
        target = MIRROR / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    print(f"mirrored {len(source)} skill files to .claude/skills")
    return 0


if __name__ == "__main__":
    sys.exit(main())
