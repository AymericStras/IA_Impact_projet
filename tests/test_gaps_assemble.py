import json
from pathlib import Path

from sncf_rapport.assemble import assemble, from_travel_file
from sncf_rapport.gaps import input_gaps, summarize
from sncf_rapport.models import TripReportRequest

EXAMPLES = Path(__file__).resolve().parents[1] / "contracts" / "examples"


def _load(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


def _fields(request: TripReportRequest, severity: str | None = None) -> set[str]:
    return {
        gap.field for gap in input_gaps(request) if severity is None or gap.severity == severity
    }


def test_full_example_has_no_major_gap():
    request = TripReportRequest.model_validate(_load("01-carcassonne-complet.json"))
    assert _fields(request, "major") == set()
    assert "trip.outbound.train_number" in _fields(request, "minor")
    assert "teacher_feedback.competencies.savoir_etre" in _fields(request, "minor")


def test_empty_request_lists_every_major_block():
    fields = _fields(TripReportRequest(), "major")
    assert {
        "recipient.email",
        "school.name",
        "school.class_name",
        "trip.date",
        "trip.origin_station",
        "trip.destination_station",
        "education.subject",
        "education.activities",
        "teacher_feedback",
    } <= fields
    assert summarize(input_gaps(TripReportRequest())).startswith("9 major")


def test_planned_head_count_fallback_is_reported():
    request = TripReportRequest.model_validate(
        {"trip": {"planned_participants": {"total": 20}}, "teacher_feedback": {}}
    )
    gap = next(g for g in input_gaps(request) if g.field == "teacher_feedback.actual_participants")
    assert "planned" in gap.effect


def test_photo_without_consent_is_reported():
    request = TripReportRequest.model_validate(
        {"media": {"photos": [{"data_base64": "AAAA", "consent": False}, {"consent": True}]}}
    )
    fields = _fields(request)
    assert "media.photos[0].consent" in fields and "media.photos[1]" in fields


def test_summary_for_complete_request():
    assert summarize([]) == "request complete: no missing field"


def test_assemble_matches_committed_example():
    request = assemble(
        _load("inputs/travel_file.carcassonne.json"), _load("inputs/teacher.carcassonne.json")
    )
    dumped = request.model_dump(mode="json", by_alias=True, exclude_none=True)
    assert dumped == _load("01-carcassonne-complet.json")


def test_assemble_inherits_trip_from_travel_file():
    request = assemble(_load("inputs/travel_file.carcassonne.json"), None)
    assert request.trip.origin_station == "Toulouse Matabiau"
    assert request.trip.destination_station == "Carcassonne"
    assert request.trip.planned_participants.students == 27
    assert request.trip.simulated is True
    assert request.education.subject == "Histoire"
    assert [a.id for a in request.education.activities] == ["act-1", "act-2"]
    assert request.school is None and request.teacher_feedback is None


def test_assemble_tolerates_missing_and_odd_input():
    assert assemble(None, None) == TripReportRequest()
    assert from_travel_file({"itinerary": "oops", "places": [3, None]})["education"]["places"] == []
    request = assemble({"requirements": {"departure_station": "Albi"}}, {"school": None})
    assert request.trip.origin_station == "Albi"


def test_teacher_overlay_wins_and_merges():
    request = assemble(
        _load("inputs/travel_file.carcassonne.json"),
        {"trip": {"outbound": {"train_number": "871234"}}, "education": {"subject": "Géographie"}},
    )
    assert request.trip.outbound.train_number == "871234"
    assert request.trip.outbound.from_station == "Toulouse Matabiau"
    assert request.education.subject == "Géographie"
    assert request.education.theme == "Moyen Âge"
