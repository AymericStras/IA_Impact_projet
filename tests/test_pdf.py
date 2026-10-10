from __future__ import annotations

import io
from datetime import UTC, datetime

import pytest
from pypdf import PdfReader

from sncf_bilan.config import Config
from sncf_bilan.models import RecapRequest
from sncf_bilan.pdf.render import render_html, render_pdf

from .conftest import example, example_data

ISSUED = datetime(2026, 10, 10, 9, 0, tzinfo=UTC)


def pdf_of(request: RecapRequest) -> PdfReader:
    data = render_pdf(
        request.trip, fingerprint=request.fingerprint(), logo=Config().logo_svg, issued_at=ISSUED
    )
    assert data.startswith(b"%PDF-")
    return PdfReader(io.BytesIO(data))


def text_of(reader: PdfReader) -> str:
    text = "\n".join(page.extract_text() for page in reader.pages)
    return " ".join(text.replace(" ", " ").replace(" ", " ").split())


def test_complete_round_trip_shows_every_field():
    request = example("01-aller-retour-complet")
    reader = pdf_of(request)
    text = text_of(reader)

    assert len(reader.pages) == 1
    for expected in [
        "Récapitulatif de voyage",
        "Référence SIM-050033B9",
        "Sortie pédagogique — Cité médiévale de Carcassonne",
        "Aller-retour",
        "jeudi 12 novembre 2026",
        "8 h 05 de Toulouse Matabiau — arrivée 9 h 00",
        "16 h 25 de Carcassonne — arrivée 17 h 20",
        "2de classe",
        "30,00 €",
        "1,00 €",
        "12/11/2026",
        "55 min",
        "liO Toulouse Matabiau – Carcassonne",
        "liO Carcassonne – Toulouse Matabiau",
        "Il ne constitue pas un titre de transport",
        "Établi le 10/10/2026",
        f"Empreinte des données {request.fingerprint()[:12]}",
        "1 / 1",
    ]:
        assert expected in text, expected
    assert "non communiqué" not in text
    assert "Train" not in text  # no seating columns when no leg has seating data


def test_every_recap_carries_the_watermark_and_only_simulated_ones_the_notice():
    simulated = text_of(pdf_of(example("01-aller-retour-complet")))
    assert "SIMULATION" in simulated
    assert "simulées" in simulated

    # The watermark is the condition for using the logo: it does not depend on the data.
    real = text_of(pdf_of(example("01-aller-retour-complet", simulated=False)))
    assert "SIMULATION" in real
    assert "simulées" not in real
    assert "Il ne constitue pas un titre de transport" in real

    assert "SIMULATION" in text_of(pdf_of(example("02-aller-simple-minimal")))


def test_missing_optional_values_are_stated_not_invented():
    text = text_of(pdf_of(example("02-aller-simple-minimal")))
    assert "Montpellier Saint-Roch" in text and "Sète" in text
    assert "Aller simple" in text
    assert "14 h 32" in text
    assert "non communiquée" in text  # class, arrival
    assert text.count("non communiqué") == 2  # class, arrival; never the price
    assert text.count("1,00 €") == 2  # one traveller: total and per person
    assert "Référence" not in text
    assert "Retour" not in text


def test_seating_columns_and_long_names():
    text = text_of(pdf_of(example("03-correspondance-premiere-classe")))
    for expected in [
        "1re classe",
        "2,00 €",  # two travellers at the fixed tariff
        "Train",
        "Voiture",
        "Place",
        "876512",
        "871408",
        "41, 42",
        "12, 14",
        "38 min",
        "1 h 24",
    ]:
        assert expected in text, expected


def test_logo_is_embedded():
    reader = pdf_of(example("01-aller-retour-complet"))
    resources = reader.pages[0]["/Resources"]
    assert "/XObject" in resources and len(resources["/XObject"]) >= 1


def test_many_legs_flow_onto_further_pages_with_footer_on_each():
    data = example_data("03-correspondance-premiere-classe")
    leg = data["trip"]["legs"][0]
    data["trip"]["legs"] = [
        {
            **leg,
            "departure": f"2026-12-{day:02d}T07:12+01:00",
            "arrival": f"2026-12-{day:02d}T07:50+01:00",
        }
        for day in range(1, 13)
    ]
    reader = pdf_of(RecapRequest.model_validate(data))
    assert len(reader.pages) == 2
    for page in reader.pages:
        page_text = " ".join(page.extract_text().split())
        assert "Il ne constitue pas un titre de transport" in page_text
        assert "SIMULATION" in page_text
    assert "2 / 2" in " ".join(reader.pages[1].extract_text().split())


def test_user_text_is_escaped_in_the_document():
    request = example("01-aller-retour-complet", title='<script>alert(1)</script> & "co"')
    html = render_html(
        request.trip, fingerprint=request.fingerprint(), logo=Config().logo_svg, issued_at=ISSUED
    )
    assert "<script>alert(1)" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt; &amp;" in html
    assert '<script>alert(1)</script> & "co"' in text_of(pdf_of(request))


def test_missing_logo_is_an_error_not_a_blank_header(tmp_path):
    request = example("01-aller-retour-complet")
    with pytest.raises(FileNotFoundError):
        render_pdf(request.trip, fingerprint="0" * 64, logo=tmp_path / "none.svg", issued_at=ISSUED)
