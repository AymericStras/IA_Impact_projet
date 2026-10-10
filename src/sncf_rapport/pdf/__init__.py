"""PDF rendering.

Public interface (frozen; `api.py` and the scripts depend on it):

    render_pdf(request, *, config=None, issued_at=None) -> bytes
    render_html(request, *, config=None, issued_at=None) -> str
"""

from __future__ import annotations

from .render import render_html, render_pdf

__all__ = ["render_html", "render_pdf"]
