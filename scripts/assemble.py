#!/usr/bin/env python3
"""travel_file.json + teacher.json -> TripReportRequest JSON on stdout.

uv run python scripts/assemble.py TRAVEL_FILE.json TEACHER.json > request.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sncf_rapport.assemble import assemble


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    travel_file = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    teacher = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    request = assemble(travel_file, teacher)
    print(
        json.dumps(
            request.model_dump(mode="json", by_alias=True, exclude_none=True),
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
