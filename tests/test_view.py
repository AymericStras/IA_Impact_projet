"""The derived layer: what the PDF will say, checked without rendering."""

from __future__ import annotations

import copy
import dataclasses
from datetime import datetime

from conftest import INSIGHTS, as_request, load_example, png_base64

from sncf_rapport import view as view_module
from sncf_rapport.config import Config
from sncf_rapport.gaps import Gap
from sncf_rapport.models import TripReportRequest
from sncf_rapport.view import ReportView, build_report_view


def build(data, **kwargs) -> ReportView:
    return build_report_view(as_request(data), **kwargs)


def strings(value) -> list[str]:
    """Every string held anywhere in a view."""
    if isinstance(value, str):
        return [value]
    if dataclasses.is_dataclass(value) and not isinstance(value, Gap):
        return [s for f in dataclasses.fields(value) for s in strings(getattr(value, f.name))]
    if isinstance(value, tuple | list):
        return [s for item in value for s in strings(item)]
    return []


def test_full_example_cover_and_route(full, issued_at):
    view = build(full, issued_at=issued_at)
    facts = {fact.label: fact.value for fact in view.cover.facts}
    assert facts["École"].startswith("École élémentaire des Tilleuls")
    assert facts["Classe"] == "CM2 B"
    assert facts["Date"] == "jeudi 12 novembre 2026"
    assert facts["Matière et thème"] == "Histoire — Moyen Âge"
    people = view.cover.figures[0]
    assert (people.value, people.label) == ("26", "élèves participants")
    assert "29" in people.note
    assert view.journey.map_svg and view.journey.map_svg.lstrip().startswith("<svg")
    assert view.journey.distance.startswith("Distance estimée")
    outbound, back = view.journey.legs
    assert (outbound.from_station, outbound.to_station) == ("Toulouse Matabiau", "Carcassonne")
    assert outbound.departure == "8 h 05" and outbound.duration == "55 min"
    assert back.label == "Retour" and back.known
    assert view.simulated and view.footer.simulation
    assert view.sources.validation == "Validé par Mme Claire Martin le lundi 16 novembre 2026"
    assert view.sources.generated == "Rapport généré le mardi 17 novembre 2026"
    assert "SIM-050033B9" in view.footer.trace


def test_competencies_follow_the_teacher_only(full):
    view = build(full)
    rows = view.competencies.rows
    assert [row.label for row in rows] == [
        "Savoir",
        "Savoir-faire",
        "Savoir se déplacer",
        "Savoir s'orienter",
        "Savoir-être",
    ]
    assert [row.status_label for row in rows] == [
        "Acquise",
        "Acquise",
        "Acquise",
        "En cours d'acquisition",
        "Non évaluée",
    ]
    assert view.competencies.acquired == "3"
    assert "validation individuelle" in view.competencies.disclaimer


def test_missing_feedback_means_nothing_is_acquired(full):
    del full["teacher_feedback"]
    view = build(full)
    assert {row.status for row in view.competencies.rows} == {"non_evaluee"}
    assert not view.competencies.assessed
    assert "Acquise" not in strings(view)
    assert view.sources.validation == "Rapport non encore validé par l'enseignant·e"
    assert view.cover.figures[0].label == "élèves prévus"


def test_non_evalue_never_yields_acquise(full):
    for key in full["teacher_feedback"]["competencies"]:
        full["teacher_feedback"]["competencies"][key] = {"status": "non_evalue", "comment": "Vu."}
    view = build(full)
    assert all(row.status_label == "Non évaluée" for row in view.competencies.rows)
    assert not any("Acquise" in text or "acquise" in text.split() for text in strings(view))


def test_activity_marks(full, partial):
    assert [a.mark for a in build(full).done.activities] == ["done", "done"]
    assert build(full).done.activities[0].time == "9 h 37 – 11 h 07"
    assert [a.mark for a in build(partial).done.activities] == ["done", "not_done"]
    full["teacher_feedback"]["activities_completed"] = "partial"
    full["teacher_feedback"]["completed_activity_ids"] = []
    assert [a.mark for a in build(full).done.activities] == ["none", "none"]


def test_completion_sentences(full):
    assert build(full).done.completion == "Le voyage s'est déroulé comme prévu."
    full["teacher_feedback"]["trip_completed"] = "partial"
    assert "en partie" in build(full).done.completion
    full["teacher_feedback"]["trip_completed"] = None
    assert build(full).done.completion is None


def test_cancelled_trip_hides_carbon(full):
    full["teacher_feedback"]["trip_completed"] = "cancelled"
    full["education"]["insights"] = copy.deepcopy(INSIGHTS)
    view = build(full)
    assert view.done.completion == "Le voyage n'a pas eu lieu."
    assert view.carbon is None
    assert all(figure.kind != "carbon" for figure in view.cover.figures)
    assert not view.done.why and not view.competencies.questions
    assert view.sources.ai_notice is None


def test_carbon_is_worded_as_an_estimate(full):
    view = build(full)
    carbon = view.carbon
    assert carbon is not None
    assert [row.is_train for row in carbon.rows] == [True, False, False]
    assert all("(estimation)" in sentence for sentence in carbon.comparisons)
    assert any("de moins qu'en autocar" in sentence for sentence in carbon.comparisons)
    everything = " ".join(strings(view))
    assert "économis" not in everything
    assert carbon.disclaimer == "Il s'agit d'une estimation, pas d'une mesure."
    method = " ".join(carbon.method)
    assert "aller-retour" in method and "29 voyageurs" in method
    assert "distance estimée" in method and "ADEME" in method
    figure = view.cover.figures[2]
    assert figure.kind == "carbon" and figure.prefix == "environ" and "estimation" in figure.note
    assert any("Facteur d'émission" in (line.label or "") for line in view.sources.data_lines)


def test_negative_saving_prints_no_boast(full, monkeypatch):
    real = view_module.estimate

    def lower_coach(**kwargs):
        result = real(**kwargs)
        cheap = tuple(
            dataclasses.replace(mode, kg_total=mode.kg_total / 100, kg_per_person=0.01)
            for mode in result.baselines
        )
        return dataclasses.replace(result, baselines=cheap)

    monkeypatch.setattr(view_module, "estimate", lower_coach)
    view = build(full)
    text = " ".join(strings(view))
    assert view.carbon is not None
    assert "de moins" not in text
    assert all(s.startswith("Train : environ") for s in view.carbon.comparisons)
    assert view.cover.figures[2].label.endswith("pour le trajet en train")


def test_kg_formatting():
    from sncf_rapport import formatting as fmt

    assert fmt.kilograms(4.24) == "4,2"
    assert fmt.kilograms(51.4) == "51"
    assert fmt.kilograms(12345.6) == "12 346"
    assert fmt.kilometres(88.3) == "88 km"


def test_unknown_station_gives_a_gap_and_a_text_route(partial):
    view = build(partial)
    assert view.journey.map_svg is None
    assert view.journey.route_text == ("Toulouse Matabiau", "Bordeaux Saint-Jean")
    assert view.journey.distance.startswith("Distance communiquée : 257 km")
    gap = next(g for g in view.gaps if g.field == "trip.destination_station")
    assert gap.severity == "major" and "Bordeaux Saint-Jean" in gap.effect
    assert all(isinstance(g, Gap) for g in view.gaps)
    assert view.carbon is not None and len(view.carbon.rows) == 2
    assert view.carbon.method_note is None  # its wording assumes an estimated distance
    assert view.cover.figures[0].label == "participants prévus"
    # nothing acquired: the cover leads with what is under way, not with a zero
    assert view.cover.figures[1].value == "1"


def test_empty_request_is_tidy(issued_at):
    view = build_report_view(TripReportRequest(), issued_at=issued_at)
    assert all(fact.value is None for fact in view.cover.facts)
    assert view.journey.legs == () and view.journey.empty_note
    assert view.carbon is None and view.photo_groups == ()
    assert view.done.activities == () and view.done.quote == ()
    assert len(view.competencies.rows) == 5
    assert not any("None" in text or "null" in text for text in strings(view))
    assert "en attente de confirmation" in view.footer.basis


def test_photos_need_consent_and_real_image_data(full, tmp_path):
    on_disk = tmp_path / "p.png"
    on_disk.write_bytes(__import__("base64").b64decode(png_base64()))
    full["media"] = {
        "photos": [
            {"data_base64": png_base64(), "media_type": "image/png", "consent": True},
            {"data_base64": png_base64(), "media_type": "image/png", "consent": False},
            {"path": str(on_disk), "caption": "Sur le quai", "consent": True},
            {"path": str(tmp_path / "absent.jpg"), "consent": True},
            {"data_base64": "pas du base64 !", "consent": True},
            {"data_base64": "aGVsbG8gd29ybGQ=", "media_type": "image/png", "consent": True},
            {"data_base64": png_base64(), "media_type": "image/gif", "consent": True},
            {"data_base64": png_base64(), "consent": True, "kind": "documentary"},
        ]
    }
    view = build(full)
    trip, documentary = view.photo_groups
    assert trip.title == "Photos du voyage" and len(trip.photos) == 2
    assert all(photo.src.startswith("data:image/png;base64,") for photo in trip.photos)
    assert trip.photos[1].caption == "Sur le quai"
    assert documentary.title.startswith("Images d'illustration (documentation")
    assert len(documentary.photos) == 1
    fields = {g.field for g in view.gaps if g.effect.startswith("Photo not printed")}
    assert fields == {
        "media.photos[1].consent",
        "media.photos[3]",
        "media.photos[4]",
        "media.photos[5]",
        "media.photos[6]",
    }


def test_missing_data_files_degrade_with_gaps(full, tmp_path):
    view_module.clear_caches()
    config = Config(
        stations_csv=tmp_path / "s.csv",
        connections_csv=tmp_path / "c.csv",
        emission_factors=tmp_path / "f.json",
        logo_svg=tmp_path / "logo.svg",
    )
    view = build(full, config=config)
    fields = {g.field for g in view.gaps}
    assert {"data/stations.csv", "data/emission_factors.json", "assets/brand/logo.svg"} <= fields
    assert view.logo_uri is None and view.carbon is None and view.journey.map_svg is None
    assert view.journey.route_text == ("Toulouse Matabiau", "Carcassonne")
    (tmp_path / "logo.svg").write_text("<svg><not closed", encoding="utf-8")
    assert build(full, config=config).logo_uri is None
    view_module.clear_caches()


def test_optional_derivations_may_raise(full, monkeypatch):
    def boom(*args, **kwargs):
        raise NotImplementedError

    monkeypatch.setattr(view_module, "route_map_svg", boom)
    monkeypatch.setattr(view_module, "estimate", boom)
    view = build(full)
    assert view.journey.map_svg is None and view.carbon is None
    assert view.journey.route_text == ("Toulouse Matabiau", "Carcassonne")
    assert view.cover.figures[2].kind == "distance"


def test_odd_dates_never_raise(full):
    full["trip"]["date"] = "0001-01-01"
    full["trip"]["outbound"]["departure"] = "0001-01-01T00:00:00+14:00"
    full["trip"]["outbound"]["arrival"] = "2026-11-12T09:00:00"  # naive
    full["teacher_feedback"]["validated_at"] = "9999-12-31T23:59:59-12:00"
    view = build(full, issued_at=datetime(9999, 12, 31, 23, 59))
    assert view.journey.legs[0].duration is None
    assert view.journey.legs[0].arrival == "9 h 00"
    assert view.sources.validation.startswith("Validé par Mme Claire Martin")
    assert not any("None" in text for text in strings(view))


def test_insights_are_shown_beside_the_status_never_in_it(full):
    for key in full["teacher_feedback"]["competencies"]:
        full["teacher_feedback"]["competencies"][key] = {"status": "non_evalue"}
    full["education"]["insights"] = copy.deepcopy(INSIGHTS)
    view = build(full)
    rows = view.competencies.rows
    assert rows[0].insight.startswith("Observer les remparts")
    assert rows[1].insight is None and rows[4].insight
    assert {row.status_label for row in rows} == {"Non évaluée"}
    assert view.competencies.acquired == "0"
    assert view.done.why and view.done.why_tag
    assert len(view.competencies.questions) == 2
    assert view.sources.ai_notice.endswith(" ; ils n'ont pas encore été relus par l'enseignant·e.")
    full["education"]["insights"]["reviewed_by_teacher"] = True
    assert build(full).sources.ai_notice.endswith(", puis relus par l'enseignant·e.")


def test_teacher_written_insights_carry_no_ai_mention(full):
    full["education"]["insights"] = copy.deepcopy(INSIGHTS) | {"origin": "teacher"}
    view = build(full)
    assert view.done.why and view.done.why_tag is None
    assert view.competencies.questions_tag is None and view.sources.ai_notice is None
    del full["education"]["insights"]
    plain = build(full)
    assert plain.done.why == () and plain.competencies.questions == ()
    assert plain.sources.ai_notice is None
    assert all(row.insight is None for row in plain.competencies.rows)


def test_all_examples_build():
    for name in ("01-carcassonne-complet.json", "02-minimal-tout-vide.json"):
        assert isinstance(build(load_example(name)), ReportView)
