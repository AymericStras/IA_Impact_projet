import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from sncf_rapport.models import TripReportRequest

EXAMPLES = Path(__file__).resolve().parents[1] / "contracts" / "examples"


@pytest.mark.parametrize("path", sorted(EXAMPLES.glob("0*.json")), ids=lambda p: p.stem)
def test_valid_examples_load(path):
    TripReportRequest.model_validate_json(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", sorted(EXAMPLES.glob("9*.json")), ids=lambda p: p.stem)
def test_invalid_examples_are_refused(path):
    with pytest.raises(ValidationError):
        TripReportRequest.model_validate_json(path.read_text(encoding="utf-8"))


def test_empty_request_is_valid():
    request = TripReportRequest.model_validate({})
    assert request.school is None and request.trip is None and request.sources == []


def test_unknown_keys_are_ignored_not_refused():
    request = TripReportRequest.model_validate(
        {"school": {"name": "A", "budget": 12}, "upstream_extra": {"x": 1}}
    )
    assert request.school.name == "A"


def test_return_leg_alias_round_trip():
    data = {"trip": {"return": {"from_station": "Carcassonne"}}}
    request = TripReportRequest.model_validate(data)
    assert request.trip.return_.from_station == "Carcassonne"
    dumped = request.model_dump(mode="json", by_alias=True, exclude_none=True)
    assert dumped["trip"]["return"] == {"from_station": "Carcassonne"}


def test_competency_defaults_to_not_assessed():
    request = TripReportRequest.model_validate({"teacher_feedback": {"competencies": {}}})
    assert request.teacher_feedback.competencies.savoir_etre.status == "non_evalue"


def test_schema_file_is_current():
    schema = TripReportRequest.model_json_schema(by_alias=True)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    stored = json.loads(
        (EXAMPLES.parent / "trip_report_request.schema.json").read_text(encoding="utf-8")
    )
    assert stored == schema
    assert "required" not in stored
