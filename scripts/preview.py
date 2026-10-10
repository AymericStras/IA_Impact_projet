#!/usr/bin/env python3
"""Render a request to var/preview/<name>.pdf and print what the request was missing.

uv run python scripts/preview.py REQUEST.json [REQUEST.json ...] [--html] [--out DIR]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sncf_rapport.config import REPO_ROOT, Config
from sncf_rapport.gaps import summarize
from sncf_rapport.models import TripReportRequest
from sncf_rapport.pdf import render_html, render_pdf
from sncf_rapport.view import build_report_view


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("request", type=Path, nargs="+")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "var" / "preview")
    parser.add_argument("--html", action="store_true", help="also write the intermediate HTML")
    args = parser.parse_args()
    config = Config.from_env()
    args.out.mkdir(parents=True, exist_ok=True)
    for path in args.request:
        request = TripReportRequest.model_validate_json(path.read_text(encoding="utf-8"))
        target = args.out / f"{path.stem}.pdf"
        target.write_bytes(render_pdf(request, config=config))
        if args.html:
            html = render_html(request, config=config)
            (args.out / f"{path.stem}.html").write_text(html, encoding="utf-8")
        gaps = build_report_view(request, config=config).gaps
        print(f"{target}", file=sys.stderr)
        print(f"  {summarize(list(gaps))}", file=sys.stderr)
        for gap in gaps:
            mark = "!!" if gap.severity == "major" else " ."
            print(f"  {mark} {gap.field}: {gap.effect}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
