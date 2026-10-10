#!/usr/bin/env python3
"""Write contracts/trip_report_request.schema.json from the Pydantic model (--check to compare)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sncf_rapport.models import TripReportRequest

TARGET = Path(__file__).resolve().parents[1] / "contracts" / "trip_report_request.schema.json"


def main() -> int:
    schema = TripReportRequest.model_json_schema(by_alias=True)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    text = json.dumps(schema, ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        if not TARGET.is_file() or TARGET.read_text(encoding="utf-8") != text:
            print(f"{TARGET.name} is out of date; run scripts/export_schema.py", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(text, encoding="utf-8")
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
