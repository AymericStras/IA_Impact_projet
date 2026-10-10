"""Render the trip report PDF with WeasyPrint.

The template reads one object, the `ReportView` built by `view.build_report_view`; it
computes nothing. The only value inserted without escaping is the route map, an `<svg>`
string produced by `geo.route_map_svg` (our own code, text already escaped).
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from ..config import Config
from ..models import TripReportRequest
from ..view import ReportView, build_report_view

TEMPLATE_DIR = Path(__file__).resolve().parent
log = logging.getLogger(__name__)
_env = Environment(
    loader=FileSystemLoader(TEMPLATE_DIR),
    autoescape=select_autoescape(["html", "j2"]),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)
# One layout at a time keeps peak memory flat on a small host.
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


def render_view_html(view: ReportView) -> str:
    """HTML for an already built view (lets a caller reuse the view for its gap list)."""
    return _env.get_template("report.html.j2").render(
        view=view, css_href=(TEMPLATE_DIR / "report.css").as_uri()
    )


def render_view_pdf(view: ReportView) -> bytes:
    """PDF for a view. If the engine rejects an embedded picture, render without pictures."""
    weasyprint = _weasyprint()

    def write(candidate: ReportView) -> bytes:
        html = render_view_html(candidate)
        with _render_lock:
            return weasyprint.HTML(string=html, base_url=str(TEMPLATE_DIR)).write_pdf()

    try:
        return write(view)
    except Exception:  # noqa: BLE001 - a report without pictures beats no report
        log.exception("PDF rendering failed; retrying without photos, map and logo")
        plain = replace(
            view,
            logo_uri=None,
            photo_groups=(),
            journey=replace(view.journey, map_svg=None),
        )
        return write(plain)


def render_html(
    request: TripReportRequest,
    *,
    config: Config | None = None,
    issued_at: datetime | None = None,
) -> str:
    return render_view_html(build_report_view(request, config=config, issued_at=issued_at))


def render_pdf(
    request: TripReportRequest,
    *,
    config: Config | None = None,
    issued_at: datetime | None = None,
) -> bytes:
    return render_view_pdf(build_report_view(request, config=config, issued_at=issued_at))
