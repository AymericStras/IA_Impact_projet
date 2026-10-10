#!/usr/bin/env python3
"""Small local guard against committing secrets or private data.

Scans git-tracked and staged files for API-key-shaped strings, private keys, and file types that
must never be committed (.env, databases, audio). Not a replacement for a real secret scanner.
Matched content is never printed, only the path and the rule name.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATTERNS = {
    "openai-key": re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}"),
    "google-api-key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "bearer-literal": re.compile(r"Authorization['\"]?\s*[:=]\s*['\"]Bearer\s+[A-Za-z0-9._-]{30,}"),
}
BLOCKED_SUFFIXES = {".sqlite3", ".sqlite", ".db", ".pem", ".webm", ".wav", ".mp3", ".m4a", ".ogg"}
SKIP_PARTS = {".git", "node_modules", ".venv", ".next", ".local", "artifacts", "__pycache__"}


def tracked_files() -> list[str]:
    try:
        out = subprocess.check_output(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=ROOT,
            stderr=subprocess.DEVNULL,
        )
        return [name for name in out.decode().split("\0") if name]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [str(p.relative_to(ROOT)) for p in ROOT.rglob("*") if p.is_file()]


def main() -> int:
    findings: list[str] = []
    for name in tracked_files():
        path = ROOT / name
        if SKIP_PARTS.intersection(path.parts) or not path.is_file():
            continue
        if path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example"):
            findings.append(f"{name}: env file must not be committed")
            continue
        if path.suffix.lower() in BLOCKED_SUFFIXES:
            findings.append(f"{name}: blocked file type {path.suffix}")
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        findings.extend(f"{name}: {rule}" for rule, pattern in PATTERNS.items() if pattern.search(content))
    if findings:
        print("Potential secrets / private data (content redacted):", file=sys.stderr)
        print("\n".join(f"  {f}" for f in findings), file=sys.stderr)
        return 1
    print("secret scan passed (limited patterns)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
