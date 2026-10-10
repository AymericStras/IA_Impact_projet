"""The rendered PDF: each fixture is rendered once and its text inspected."""

from __future__ import annotations

import copy
from html import unescape

import pytest
from conftest import (
    INSIGHTS,
    ISSUED_AT,
    as_request,
    flat,
    load_example,
    pdf_images,
    pdf_pages,
    pdf_text,
    png_base64,
)

from sncf_rapport.pdf import render_html, render_pdf

LABELS = ("Savoir", "Savoir-faire", "Savoir se déplacer", "Savoir s'orienter", "Savoir-être")


def _full() -> dict:
    data = copy.deepcopy(load_example("01-carcassonne-complet.json"))
    data.get("education", {}).pop("insights", None)
    return data


def _render(data: dict) -> bytes:
    return render_pdf(as_request(data), issued_at=ISSUED_AT)


@pytest.fixture(scope="module")
def full_pdf() -> bytes:
    return _render(_full())


@pytest.fixture(scope="module")
def empty_pdf() -> bytes:
    return _render(load_example("02-minimal-tout-vide.json"))


@pytest.fixture(scope="module")
def partial_pdf() -> bytes:
    return _render(load_example("03-hors-reseau-partiel.json"))


@pytest.fixture(scope="module")
def rich_pdf() -> bytes:
    """Photos (consented or not, trip and documentary) and the model-written texts."""
    data = _full()
    data["education"]["insights"] = copy.deepcopy(INSIGHTS)
    data["teacher_feedback"]["competencies"]["savoir_etre"] = {"status": "non_evalue"}
    data["media"] = {
        "photos": [
            {"data_base64": png_base64(), "media_type": "image/png", "consent": True},
            {
                "data_base64": png_base64(rgb=(201, 12, 15)),
                "media_type": "image/png",
                "caption": "PHOTO SANS ACCORD",
                "consent": False,
            },
            {
                "data_base64": png_base64(rgb=(255, 213, 0)),
                "caption": "Vue ancienne de la Cité",
                "consent": True,
                "kind": "documentary",
            },
        ]
    }
    return _render(data)


def test_full_example(full_pdf):
    text = flat(pdf_text(full_pdf))
    assert full_pdf.startswith(b"%PDF")
    assert 2 <= pdf_pages(full_pdf) <= 3
    for expected in (
        "Rapport de voyage scolaire".upper(),
        "Notre voyage, nos apprentissages",
        "École élémentaire des Tilleuls",
        "CM2 B",
        "jeudi 12 novembre 2026",
        "Toulouse Matabiau",
        "Carcassonne",
        "Notre parcours",
        "Ce que nous avons fait",
        "Le voyage s'est déroulé comme prévu.",
        "Compétences développées",
        "Notre impact carbone",
        "estimation",
        "Il s'agit d'une estimation, pas d'une mesure.",
        "Sources et validation",
        "Validé par Mme Claire Martin le lundi 16 novembre 2026",
        "SIMULATION",
        "Démonstration : horaires et réservation simulés.",
        "ne constitue pas une validation individuelle de chaque élève",
        "https://www.remparts-carcassonne.fr/",
        "Gares et lignes : jeu de données du hackathon liO / SNCF open data",
        "1 / ",
    ):
        assert expected in text, expected
    for label in LABELS:
        assert label in text
    assert "de moins qu'en autocar (estimation)" in text
    assert "économis" not in text
    assert "Photos du voyage" not in text and "Pourquoi ce voyage" not in text.title()


def test_nothing_leaks_into_any_pdf(full_pdf, empty_pdf, partial_pdf, rich_pdf):
    for pdf in (full_pdf, empty_pdf, partial_pdf, rich_pdf):
        text = pdf_text(pdf)
        for leak in ("None", "null", "NotImplemented", "Undefined", "nan", "{{"):
            assert leak not in text.split() and f" {leak} " not in text, leak


def test_empty_example_is_short_and_tidy(empty_pdf):
    text = flat(pdf_text(empty_pdf))
    assert pdf_pages(empty_pdf) <= 2
    assert "non communiqué" in text and "Non évaluée" in text
    assert "Rapport non encore validé par l'enseignant·e" in text
    assert "SIMULATION" not in text
    for absent in ("Acquise", "Notre impact carbone", "Photos du voyage", "Les activités".upper()):
        assert absent not in text, absent
    assert pdf_images(empty_pdf) <= 1  # the logo at most


def test_partial_example_has_no_map_and_a_communicated_distance(partial_pdf):
    text = flat(pdf_text(partial_pdf))
    assert "Distance communiquée : 257 km" in text
    assert "Distance estimée" not in text
    assert "Bordeaux Saint-Jean" in text and "Collège du Parc" in text
    assert "Le voyage s'est déroulé en partie comme prévu." in text
    assert "train n° 4660" in text
    assert "qu'en voiture" not in text  # only the coach baseline was requested
    assert "km" in text and "Castelnaudary" not in text  # no map labels


def test_photos_and_consent(full_pdf, rich_pdf):
    text = flat(pdf_text(rich_pdf))
    assert "Photos du voyage" in text
    assert "Images d'illustration (documentation, non prises pendant le voyage)" in text
    assert "Vue ancienne de la Cité" in text
    assert "PHOTO SANS ACCORD" not in text
    assert text.index("Photos du voyage") < text.index("Images d'illustration")
    assert pdf_images(rich_pdf) - pdf_images(full_pdf) == 2


def test_insights_blocks_and_attribution(rich_pdf):
    text = flat(pdf_text(rich_pdf))
    assert "POURQUOI CE VOYAGE" in text and "POUR EN PARLER À LA MAISON" in text
    assert "Ce que la sortie a permis de travailler : Observer les remparts" in text
    assert "Appréciation de l'enseignant·e :" in text
    assert "Qu'est-ce qui t'a le plus surpris ?" in text
    assert "rédigés avec l'aide d'une IA à partir du programme de la sortie ; ils n'ont pas" in text
    # the insight sits in a row that stays « Non évaluée »
    row = text[text.index("Savoir-être") : text.index("Cette appréciation porte")]
    assert "Non évaluée" in row and "Écouter la guide" in row and "Acquise" not in row
    assert text.index("POURQUOI CE VOYAGE") < text.index("LES ACTIVITÉS")


def test_reviewed_insights_say_so():
    data = _full()
    data["education"]["insights"] = copy.deepcopy(INSIGHTS) | {"reviewed_by_teacher": True}
    html = unescape(render_html(as_request(data), issued_at=ISSUED_AT))
    assert ", puis relus par l'enseignant·e." in html
    assert "pas encore été relus" not in html


def test_cancelled_trip_has_no_carbon_block():
    data = _full()
    data["teacher_feedback"]["trip_completed"] = "cancelled"
    text = flat(pdf_text(_render(data)))
    assert "Le voyage n'a pas eu lieu." in text
    assert "Notre impact carbone" not in text and "CO₂e" not in text and "CO2e" not in text


def test_user_text_is_escaped():
    data = _full()
    data["teacher_feedback"]["competencies"]["savoir"]["comment"] = "<script>alert(1)</script>"
    data["teacher_feedback"]["observations"] = "{{ 7 * 7 }} <b>gras</b>"
    data["school"]["name"] = 'École "A&B" <img src=x onerror=alert(1)>'
    html = render_html(as_request(data), issued_at=ISSUED_AT)
    assert "<script" not in html and "<img src=x" not in html and "<b>gras" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "{{ 7 * 7 }}" in html and ">49<" not in html
    assert "A&amp;B" in html


def test_only_the_map_is_inserted_unescaped():
    html = render_html(as_request(_full()), issued_at=ISSUED_AT)
    assert html.count("<svg xmlns") == 1  # the route map; glyphs are template markup
    template = (render_html.__globals__["TEMPLATE_DIR"] / "report.html.j2").read_text("utf-8")
    assert template.count("|safe") == 1 and "map_svg|safe" in template


def test_engine_failure_falls_back_to_a_report_without_pictures(monkeypatch):
    from sncf_rapport.pdf import render

    real = render.render_view_html
    seen = []

    def fragile(view):
        seen.append(view.logo_uri)
        if view.logo_uri or view.journey.map_svg:
            raise RuntimeError("engine rejected a picture")
        return real(view)

    monkeypatch.setattr(render, "render_view_html", fragile)
    pdf = render_pdf(as_request(_full()), issued_at=ISSUED_AT)
    assert pdf.startswith(b"%PDF") and len(seen) == 2 and seen[1] is None
    assert "Toulouse Matabiau" in pdf_text(pdf)
