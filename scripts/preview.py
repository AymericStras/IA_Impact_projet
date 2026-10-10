#!/usr/bin/env python3
"""Render a request to var/preview/<name>.pdf (+ the email as .eml) and print what was missing.

uv run python scripts/preview.py REQUEST.json [REQUEST.json ...] [--html] [--out DIR]

Nothing is sent and no service has to run. Open the .eml in a mail client to see the
message with its inline logo and the PDF attached; <name>.email.html and .email.txt are
the two bodies for a quick look. A request without `recipient.email` is addressed to a
placeholder for the preview only.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sncf_rapport.config import REPO_ROOT, Config
from sncf_rapport.gaps import summarize
from sncf_rapport.mail.compose import LOGO_CID, compose, render_parts
from sncf_rapport.mail.deliver import write_eml
from sncf_rapport.models import TripReportRequest
from sncf_rapport.pdf import render_html, render_view_pdf
from sncf_rapport.view import build_report_view

PLACEHOLDER = "destinataire@example.fr"


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
        view = build_report_view(request, config=config)
        pdf = render_view_pdf(view)
        target = args.out / f"{path.stem}.pdf"
        target.write_bytes(pdf)
        if args.html:
            html = render_html(request, config=config)
            (args.out / f"{path.stem}.html").write_text(html, encoding="utf-8")

        addressed = request
        if not (request.recipient and request.recipient.email):
            data = request.model_dump(mode="json", by_alias=True, exclude_none=True)
            data["recipient"] = {**data.get("recipient", {}), "email": PLACEHOLDER}
            addressed = TripReportRequest.model_validate(data)
        parts = render_parts(addressed, config, report=view)
        message = compose(addressed, pdf, config, report=view)
        eml = write_eml(message, config, args.out / f"{path.stem}.eml")
        browser_html = parts["html"].replace(f"cid:{LOGO_CID}", config.logo_png.resolve().as_uri())
        (args.out / f"{path.stem}.email.html").write_text(browser_html, encoding="utf-8")
        (args.out / f"{path.stem}.email.txt").write_text(parts["text"], encoding="utf-8")

        gaps = view.gaps
        print(f"{target}", file=sys.stderr)
        print(f"  {eml}  (To: {message.to[0]}, Subject: {parts['subject']})", file=sys.stderr)
        print(f"  {summarize(list(gaps))}", file=sys.stderr)
        for gap in gaps:
            mark = "!!" if gap.severity == "major" else " ."
            print(f"  {mark} {gap.field}: {gap.effect}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
