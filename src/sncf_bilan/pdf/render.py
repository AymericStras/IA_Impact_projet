"""Render the recap PDF with WeasyPrint."""

from __future__ import annotations

import os
import sys
import threading
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from .. import formatting as fmt
from ..models import Trip
from ..view import build_trip_view

TEMPLATE_DIR = Path(__file__).resolve().parent
_env = Environment(
    loader=FileSystemLoader(TEMPLATE_DIR),
    autoescape=select_autoescape(["html", "j2"]),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)
# One layout at a time keeps peak memory flat on the small production host.
_render_lock = threading.Lock()


def _weasyprint():
    if sys.platform == "darwin":
        # Homebrew's Pango is outside the default library search path.
        paths = [p for p in os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "").split(":") if p]
        for candidate in ("/opt/homebrew/lib", "/usr/local/lib"):
            if candidate not in paths and Path(candidate).is_dir():
                paths.append(candidate)
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = ":".join(paths)
    import weasyprint

    return weasyprint


def render_html(trip: Trip, *, fingerprint: str, logo: Path, issued_at: datetime) -> str:
    return _env.get_template("recap.html.j2").render(
        trip=build_trip_view(trip),
        fingerprint=fingerprint[:12],
        issued_on=fmt.date_short(issued_at),
        logo_href=logo.resolve().as_uri(),
        css_href=(TEMPLATE_DIR / "recap.css").as_uri(),
    )


def render_pdf(trip: Trip, *, fingerprint: str, logo: Path, issued_at: datetime) -> bytes:
    if not logo.is_file():
        raise FileNotFoundError(f"Logo file is missing: {logo}")
    html = render_html(trip, fingerprint=fingerprint, logo=logo, issued_at=issued_at)
    weasyprint = _weasyprint()
    with _render_lock:
        return weasyprint.HTML(string=html, base_url=str(TEMPLATE_DIR)).write_pdf()
