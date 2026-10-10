"""Shared fixtures: example requests, a tiny in-memory PNG, PDF text extraction."""

from __future__ import annotations

import base64
import copy
import io
import json
import re
import struct
import zlib
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from pypdf import PdfReader

from sncf_rapport.formatting import PARIS
from sncf_rapport.models import TripReportRequest

EXAMPLES = Path(__file__).resolve().parents[1] / "contracts" / "examples"
ISSUED_AT = datetime(2026, 11, 17, 9, 0, tzinfo=PARIS)

INSIGHTS: dict[str, Any] = {
    "why": "En parcourant la Cité, les élèves voient comment une ville se protégeait.",
    "competencies": {
        "savoir": "Observer les remparts pour comprendre une ville fortifiée.",
        "savoir_etre": "Écouter la guide et rester attentif au groupe.",
    },
    "questions": ["Qu'est-ce qui t'a le plus surpris ?", "À quoi servaient les remparts ?"],
    "origin": "ai",
    "reviewed_by_teacher": False,
}


def load_example(name: str) -> dict[str, Any]:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


def as_request(data: dict[str, Any]) -> TripReportRequest:
    return TripReportRequest.model_validate(data)


def png_bytes(width: int = 8, height: int = 6, rgb: tuple[int, int, int] = (15, 33, 73)) -> bytes:
    """A valid PNG built by hand, so that no picture file lives in the repository."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    rows = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def png_base64(**kwargs: Any) -> str:
    return base64.b64encode(png_bytes(**kwargs)).decode("ascii")


def pdf_text(pdf: bytes) -> str:
    """All the text of a PDF with French no-break spaces turned into plain spaces."""
    reader = PdfReader(io.BytesIO(pdf))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return re.sub(r"[ \t  ]+", " ", text)


def flat(text: str) -> str:
    """Text on one line: wording checks must not depend on where a line wraps."""
    return re.sub(r"\s+", " ", text)


def pdf_pages(pdf: bytes) -> int:
    return len(PdfReader(io.BytesIO(pdf)).pages)


def pdf_images(pdf: bytes) -> int:
    """Distinct pictures in the document (every page lists the shared ones)."""
    reader = PdfReader(io.BytesIO(pdf))
    return len({image.name for page in reader.pages for image in page.images})


@pytest.fixture
def full() -> dict[str, Any]:
    """The complete example, without the optional model-written texts."""
    data = copy.deepcopy(load_example("01-carcassonne-complet.json"))
    data.get("education", {}).pop("insights", None)
    return data


@pytest.fixture
def partial() -> dict[str, Any]:
    return copy.deepcopy(load_example("03-hors-reseau-partiel.json"))


@pytest.fixture
def issued_at() -> datetime:
    return ISSUED_AT
