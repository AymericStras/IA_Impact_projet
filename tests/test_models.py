from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from sncf_bilan.models import RecapRequest

from .conftest import EXAMPLES, example, example_data

VALID = sorted(path.stem for path in EXAMPLES.glob("0*.json"))
INVALID = sorted(path.stem for path in EXAMPLES.glob("9*.json"))


def test_examples_are_present():
    assert len(VALID) == 3
    assert len(INVALID) == 2


@pytest.mark.parametrize("name", VALID)
def test_valid_examples_are_accepted(name):
    RecapRequest.model_validate(example_data(name))


@pytest.mark.parametrize(
    ("name", "fragment"),
    [
        ("90-invalide-prix-incoherent", "1500 × 30 = 45000, got 40000"),
        ("91-invalide-arrivee-avant-depart", "arrival is before departure"),
    ],
)
def test_invalid_examples_are_refused_for_the_documented_reason(name, fragment):
    with pytest.raises(ValidationError) as caught:
        RecapRequest.model_validate(example_data(name))
    assert fragment in str(caught.value)


def mutated(path: list, value):
    data = copy.deepcopy(example_data("01-aller-retour-complet"))
    target = data
    for key in path[:-1]:
        target = target[key]
    if value is ...:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return data


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (["schema_version"], "2.0"),
        (["idempotency_key"], "short"),
        (["idempotency_key"], "has spaces in it"),
        (["recipient", "email"], "not-an-address"),
        (["recipient", "email"], ...),
        (["recipient", "name"], "Line\nbreak"),
        (["trip", "participants_count"], 0),
        (["trip", "travel_class"], "3"),
        (["trip", "legs"], []),
        (["trip", "legs", 0, "from_station"], "   "),
        (["trip", "legs", 0, "from_station"], "x" * 81),
        (["trip", "legs", 0, "to_station"], "Carcassonne\r\nBcc: x@example.com"),
        (["trip", "legs", 0, "departure"], "2026-11-12T08:05"),
        (["trip", "legs", 0, "departure"], ...),
        (["trip", "price", "total_cents"], -1),
        (["trip", "price", "total_cents"], 450.5),
        (["trip", "price", "currency"], "USD"),
        (["trip", "unknown_field"], 1),
        (["locale"], "en"),
    ],
)
def test_malformed_requests_are_refused(path, value):
    with pytest.raises(ValidationError):
        RecapRequest.model_validate(mutated(path, value))


def test_price_and_class_may_be_absent_or_partial():
    assert example("01-aller-retour-complet", price=None, travel_class=None).trip.price is None
    partial = example("01-aller-retour-complet", price={"total_cents": 40000})
    assert partial.trip.price.per_person_cents is None
    only_unit = example("01-aller-retour-complet", price={"per_person_cents": 1500})
    assert only_unit.trip.price.total_cents is None


def test_arrival_equal_to_departure_is_accepted():
    data = example_data("02-aller-simple-minimal")
    data["trip"]["legs"][0]["arrival"] = data["trip"]["legs"][0]["departure"]
    RecapRequest.model_validate(data)


def test_legs_are_ordered_by_departure_whatever_the_input_order():
    data = example_data("01-aller-retour-complet")
    data["trip"]["legs"].reverse()
    trip = RecapRequest.model_validate(data).trip
    assert [leg.from_station for leg in trip.ordered_legs] == ["Toulouse Matabiau", "Carcassonne"]


def test_fingerprint_is_stable_and_content_sensitive():
    first = example("01-aller-retour-complet")
    assert first.fingerprint() == example("01-aller-retour-complet").fingerprint()
    assert (
        first.fingerprint()
        != example("01-aller-retour-complet", participants_count=1, price=None).fingerprint()
    )


def test_published_schema_matches_the_model():
    import json

    published = json.loads((EXAMPLES.parent / "recap_request.schema.json").read_text("utf-8"))
    published.pop("$schema")
    assert published == RecapRequest.model_json_schema()


def test_the_request_shown_in_the_readme_is_valid():
    import json
    import re

    readme = (EXAMPLES.parents[1] / "README.md").read_text(encoding="utf-8")
    blocks = re.findall(r"```json\n(.*?)```", readme, flags=re.S)
    assert len(blocks) == 1
    request = RecapRequest.model_validate(json.loads(blocks[0]))
    assert len(request.trip.legs) == 2
