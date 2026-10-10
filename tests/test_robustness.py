"""Whatever the upstream sends, a PDF comes out.

HTML is built for many seeds (fast); the full PDF for fewer (WeasyPrint is the
slow part). Raise the counts with RAPPORT_FUZZ_HTML / RAPPORT_FUZZ_PDF, or run
`uv run python scripts/stress.py 500` for a long session.
"""

from __future__ import annotations

import io
import os
import re
from datetime import UTC, datetime

import pytest
from fuzzgen import make_request
from pypdf import PdfReader

from sncf_rapport.gaps import Gap
from sncf_rapport.models import TripReportRequest
from sncf_rapport.pdf import render_html, render_pdf
from sncf_rapport.view import build_report_view

HTML_SEEDS = int(os.environ.get("RAPPORT_FUZZ_HTML", "300"))
PDF_SEEDS = int(os.environ.get("RAPPORT_FUZZ_PDF", "30"))
ISSUED = datetime(2026, 11, 16, 18, 0, tzinfo=UTC)
LEAKS = re.compile(r"\bNone\b|\bnull\b|NotImplemented|Traceback|Undefined|\bnan\b|\binf\b|\{\{|\{%")
MAX_PAGES = 30


def _request(seed: int) -> TripReportRequest:
    return TripReportRequest.model_validate(make_request(seed))


def test_generator_is_deterministic_and_always_valid():
    assert make_request(7) == make_request(7)
    for seed in range(HTML_SEEDS):
        _request(seed)


@pytest.mark.parametrize("seed", range(HTML_SEEDS))
def test_html_builds_for_any_request(seed):
    request = _request(seed)
    view = build_report_view(request, issued_at=ISSUED)
    assert all(isinstance(gap, Gap) for gap in view.gaps)
    html = render_html(request, issued_at=ISSUED)
    assert "<script" not in html.lower()
    assert "\x00" not in html


@pytest.mark.parametrize("seed", range(PDF_SEEDS))
def test_pdf_renders_for_any_request(seed):
    pdf = render_pdf(_request(seed), issued_at=ISSUED)
    assert pdf.startswith(b"%PDF")
    reader = PdfReader(io.BytesIO(pdf))
    assert 1 <= len(reader.pages) <= MAX_PAGES
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    # Words the user typed are allowed; our own code must not leak these.
    typed = str(make_request(seed))
    for leak in LEAKS.findall(text):
        assert leak in typed, f"seed {seed}: '{leak}' leaked into the PDF"


def test_same_request_gives_same_text_twice():
    request = _request(3)
    first = PdfReader(io.BytesIO(render_pdf(request, issued_at=ISSUED)))
    second = PdfReader(io.BytesIO(render_pdf(request, issued_at=ISSUED)))
    assert [p.extract_text() for p in first.pages] == [p.extract_text() for p in second.pages]


def test_missing_data_files_do_not_break_the_report(tmp_path):
    from sncf_rapport.config import Config

    config = Config(
        stations_csv=tmp_path / "absent.csv",
        connections_csv=tmp_path / "absent2.csv",
        emission_factors=tmp_path / "absent.json",
        logo_svg=tmp_path / "absent.svg",
    )
    request = _request(1)
    pdf = render_pdf(request, config=config, issued_at=ISSUED)
    assert pdf.startswith(b"%PDF")
    fields = {gap.field for gap in build_report_view(request, config=config).gaps}
    assert any("emission_factors" in field for field in fields)


def test_corrupt_data_files_do_not_break_the_report(tmp_path):
    from sncf_rapport.config import Config

    (tmp_path / "s.csv").write_text("id,name\n\x00garbage,,,\n", encoding="utf-8")
    (tmp_path / "c.csv").write_bytes(b"\xff\xfe\x00not csv")
    (tmp_path / "f.json").write_text("{ nope", encoding="utf-8")
    (tmp_path / "logo.svg").write_text("<svg><not closed", encoding="utf-8")
    config = Config(
        stations_csv=tmp_path / "s.csv",
        connections_csv=tmp_path / "c.csv",
        emission_factors=tmp_path / "f.json",
        logo_svg=tmp_path / "logo.svg",
    )
    assert render_pdf(_request(2), config=config, issued_at=ISSUED).startswith(b"%PDF")
