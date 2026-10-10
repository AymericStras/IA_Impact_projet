#!/usr/bin/env python3
"""Render one request to files, offline: the PDF and the email as a mail client shows it.

    uv run python scripts/preview.py contracts/examples/01-aller-retour-complet.json

Nothing is sent and no service has to run. Open the .eml in a mail client to
see the message with its inline logo and attachment; the .html is the same
body for a quick look in a browser (the logo is linked from the assets there).
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from sncf_bilan.config import Config
from sncf_bilan.mail.compose import LOGO_CID, compose, render_parts
from sncf_bilan.mail.deliver import write_eml
from sncf_bilan.models import RecapRequest
from sncf_bilan.pdf.render import render_pdf


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("request", type=Path, help="JSON request file")
    parser.add_argument("--out", type=Path, default=Path("var/preview"), help="output directory")
    args = parser.parse_args()

    config = Config.from_env()
    try:
        request = RecapRequest.model_validate_json(args.request.read_text(encoding="utf-8"))
    except ValidationError as exc:
        print(f"Request refused ({exc.error_count()} problem(s)):", file=sys.stderr)
        for error in exc.errors():
            where = ".".join(str(part) for part in error["loc"]) or "request"
            print(f"  {where}: {error['msg']}", file=sys.stderr)
        return 2

    pdf = render_pdf(
        request.trip,
        fingerprint=request.fingerprint(),
        logo=config.logo_svg,
        issued_at=datetime.now(UTC),
    )
    parts = render_parts(request, config)
    message = compose(request, pdf, config)

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    stem = args.request.stem
    written = {
        "pdf": out / f"{stem}.pdf",
        "eml": out / f"{stem}.eml",
        "html": out / f"{stem}.email.html",
        "txt": out / f"{stem}.email.txt",
    }
    written["pdf"].write_bytes(pdf)
    write_eml(message, config, written["eml"])
    browser_html = parts["html"].replace(f"cid:{LOGO_CID}", config.logo_png.resolve().as_uri())
    written["html"].write_text(browser_html, encoding="utf-8")
    written["txt"].write_text(parts["text"], encoding="utf-8")

    print(f"Subject: {parts['subject']}")
    print(f"To:      {request.recipient.email}")
    print(f"From:    {config.mail_from}")
    for path in written.values():
        print(f"  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
