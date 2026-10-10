"""The simulated journey after confirmation: destinations, itineraries, adjustments, booking, travel file."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.errors import AppError
from app.schemas.requirements import CompleteRequirements
from app.services import planner
from app.services.providers.fake_provider import FakeProvider
from tests.conftest import COMPLETE_PATCH

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
FULL = "27 élèves et 3 accompagnateurs, au départ de Toulouse, le 12 novembre 2026 vers 8 h, retour avant 17 h, histoire, Moyen Âge"


def requirements(**overrides: object) -> CompleteRequirements:
    data: dict[str, object] = {
        "participants_count": 30,
        "departure_station": "Toulouse",
        "departure": {"date": "2026-11-12", "time": "08:00", "constraint": "approximate"},
        "return": {"date": "2026-11-12", "time": "17:00", "constraint": "latest"},
        "teaching_type": {"subject": "Histoire", "theme": "Moyen Âge"},
    }
    data.update(overrides)
    return CompleteRequirements.model_validate(data)


# ----- engine ------------------------------------------------------------------------------------


def test_a_city_is_expanded_to_its_stations_and_a_station_is_kept() -> None:
    assert planner.departure_stations("Toulouse") == [
        "Toulouse Matabiau",
        "Toulouse Saint-Cyprien-Arènes",
        "Toulouse Saint-Agne",
    ]
    assert planner.departure_stations("Toulouse Matabiau") == ["Toulouse Matabiau"]
    assert planner.departure_stations("Villefranche-de-Rouergue") == ["Villefranche-de-Rouergue"]


def test_destinations_follow_the_theme_and_exclude_the_origin() -> None:
    history = planner.recommend_destinations(requirements())
    assert history[0].id == "carcassonne" and len(history) >= 3
    assert all(d.places and d.activities for d in history)
    science = planner.recommend_destinations(
        requirements(teaching_type={"subject": "SVT", "theme": "biodiversité"})
    )
    assert science[0].id == "sete"
    from_albi = planner.recommend_destinations(requirements(departure_station="Albi"))
    assert all(d.id != "albi" for d in from_albi)


def test_itineraries_never_violate_the_time_constraints() -> None:
    itineraries = planner.build_itineraries(requirements(), "carcassonne", ["carcassonne-1", "carcassonne-2"])
    assert itineraries and all(i.simulated for i in itineraries)
    limit = datetime.fromisoformat("2026-11-12T17:00:00+01:00")
    for itinerary in itineraries:
        assert datetime.fromisoformat(itinerary.return_.arrival) <= limit  # « au plus tard à 17 h »
        assert itinerary.outbound.departure >= "2026-11-12T08:05"  # « vers 8 h »
        assert itinerary.outbound.from_station.startswith("Toulouse")
        starts = [a.start for a in itinerary.activities]
        assert starts == sorted(starts)
        assert itinerary.activities[0].start > itinerary.outbound.arrival
        assert itinerary.activities[-1].end < itinerary.return_.departure
        assert not any(ch.isdigit() for ch in itinerary.outbound.line) and "simulé" in itinerary.outbound.line
    exact = planner.build_itineraries(
        requirements(departure={"date": "2026-11-12", "time": "09:00", "constraint": "exact"}),
        "albi",
        ["albi-1"],
    )
    assert {i.outbound.departure[11:16] for i in exact} == {"09:00"}  # an exact time is never shifted


def test_a_short_day_yields_several_real_adjustments() -> None:
    short = requirements(
        departure={"date": "2026-11-12", "time": "09:00", "constraint": "exact"},
        **{"return": {"date": "2026-11-12", "time": "13:30", "constraint": "latest"}},
    )
    chosen = ["carcassonne-1", "carcassonne-2"]
    assert planner.build_itineraries(short, "carcassonne", chosen) == []
    adjustments = planner.propose_adjustments(short, "carcassonne", chosen)
    kinds = [a.kind for a in adjustments]
    assert len(adjustments) >= 3 and len(set(kinds)) >= 3  # several different ways out, not one
    for adjustment in adjustments:
        assert adjustment.unlocks >= 1 and adjustment.label and adjustment.reason
    later = next(a for a in adjustments if a.kind == "return_later")
    assert later.changes[0].field == "return" and later.changes[0].before == "13:30"
    assert later.label.startswith("Retour à ") and "au lieu de 13 h 30" in later.label
    fewer = next(a for a in adjustments if a.kind == "fewer_activities")
    assert fewer.changes == [] and len(fewer.activity_ids or []) == 1
    # Every adjustment really unlocks what it claims.
    for adjustment in adjustments:
        changed = short
        for change in adjustment.changes:
            slot = changed.return_ if change.field == "return" else changed.departure
            changed = changed.model_copy(
                update={
                    "return_" if change.field == "return" else "departure": slot.model_copy(
                        update={"time": change.after}
                    )
                }
            )
        unlocked = planner.build_itineraries(
            changed, adjustment.destination_id or "carcassonne", adjustment.activity_ids or chosen
        )
        assert len(unlocked) == adjustment.unlocks


def test_unknown_choices_are_rejected() -> None:
    with pytest.raises(AppError):
        planner.build_itineraries(requirements(), "atlantis", [])
    with pytest.raises(AppError):
        planner.build_itineraries(requirements(), "albi", ["carcassonne-1"])


# ----- through the API ---------------------------------------------------------------------------


def _confirmed(client: TestClient, provider: FakeProvider) -> str:
    cid = client.post("/api/v1/conversations", json={}).json()["conversation_id"]
    provider.queue(COMPLETE_PATCH)
    body = client.post(
        f"/api/v1/conversations/{cid}/messages", json={"content": FULL, "client_message_id": "p1"}
    ).json()
    confirm = client.post(f"/api/v1/conversations/{cid}/confirm", json={"expected_version": body["version"]})
    assert confirm.status_code == 200, confirm.text
    return f"/api/v1/conversations/{cid}"


def test_full_journey_to_travel_file_and_feedback(client: TestClient, provider: FakeProvider) -> None:
    from jsonschema import Draft202012Validator, FormatChecker

    assert client.get("/api/v1/config").json()["planner_mode"] == "simulated"
    fresh = client.post("/api/v1/conversations", json={}).json()["conversation_id"]
    early = client.post(f"/api/v1/conversations/{fresh}/journey", json={})
    assert early.status_code == 409 and "Confirmez" in early.json()["detail"]

    base = _confirmed(client, provider)
    journey = client.post(f"{base}/journey", json={}).json()
    assert journey["stage"] == "destinations" and journey["simulated"] is True
    assert journey["departure_stations"] == ["Toulouse Matabiau"]  # the fixture names the station
    assert journey["destinations"][0]["id"] == "carcassonne"
    Draft202012Validator(
        json.loads((CONTRACTS / "journey.schema.json").read_text()), format_checker=FormatChecker()
    ).validate(journey)

    chosen = client.post(
        f"{base}/journey/destination",
        json={"destination_id": "carcassonne", "activity_ids": ["carcassonne-1", "carcassonne-2"]},
    ).json()
    assert chosen["stage"] == "itineraries" and len(chosen["itineraries"]) >= 2
    assert client.get(f"{base}/journey/travel-file").status_code == 409  # nothing booked yet
    assert client.post(f"{base}/journey/booking").status_code == 409  # nothing chosen yet

    itinerary_id = chosen["itineraries"][0]["id"]
    review = client.post(f"{base}/journey/itinerary", json={"itinerary_id": itinerary_id}).json()
    assert review["stage"] == "review" and "Rien n'est réservé" in review["message"]

    pending = client.post(f"{base}/journey/booking").json()
    assert pending["stage"] == "booking_pending" and pending["booking"]["status"] == "pending"
    assert pending["booking"]["reference"].startswith("SIM-")
    locked = client.post(f"{base}/journey/destination", json={"destination_id": "albi", "activity_ids": []})
    assert locked.status_code == 409  # no change while a request is waiting

    booked = client.post(f"{base}/journey/booking/check").json()
    assert booked["stage"] == "booked" and booked["booking"]["status"] == "confirmed"
    assert client.post(f"{base}/journey/booking/check").json()["stage"] == "booked"  # idempotent

    file = client.get(f"{base}/journey/travel-file").json()
    assert file["simulated"] is True and file["reference"] == booked["booking"]["reference"]
    assert file["itinerary"]["id"] == itinerary_id and file["official_links"] == []
    assert file["schedule"][0].startswith("8 h 05 — Départ de Toulouse") and len(file["safety_advice"]) >= 3
    Draft202012Validator(
        json.loads((CONTRACTS / "travel_file.schema.json").read_text()), format_checker=FormatChecker()
    ).validate(file)

    closed = client.post(f"{base}/journey/feedback", json={"rating": 5, "comment": "Très bien."}).json()
    assert closed["stage"] == "closed" and closed["feedback"]["rating"] == 5
    assert client.post(f"{base}/journey/feedback", json={"rating": 9}).status_code == 422


def test_adjustments_are_offered_and_only_applied_on_acceptance(
    client: TestClient, provider: FakeProvider
) -> None:
    base = _confirmed(client, provider)
    client.post(f"{base}/journey", json={"search_scenario": "adjustments"})
    stuck = client.post(
        f"{base}/journey/destination",
        json={"destination_id": "carcassonne", "activity_ids": ["carcassonne-1", "carcassonne-2"]},
    ).json()
    assert stuck["stage"] == "adjustments" and stuck["itineraries"] == []
    assert len(stuck["adjustments"]) >= 3 and "rien n'est modifié sans votre accord" in stuck["message"]
    before = client.get(base).json()
    assert before["requirements"]["return"]["time"] == "17:00"  # offering changed nothing

    later = next(a for a in stuck["adjustments"] if a["kind"] == "return_later")
    accepted = client.post(f"{base}/journey/adjustment", json={"adjustment_id": later["id"]}).json()
    assert accepted["stage"] == "itineraries" and len(accepted["itineraries"]) == later["unlocks"]
    assert accepted["accepted_adjustments"][0]["id"] == later["id"]
    after = client.get(base).json()
    assert after["requirements"]["return"]["time"] == later["changes"][0]["after"]
    assert (
        after["state"] == "CONFIRMED" and after["version"] == before["version"] + 1
    )  # explicit consent keeps it confirmed
    assert after["confirmed_requirements"]["requirements"]["return"]["time"] == later["changes"][0]["after"]
    assert "Ajustement accepté" in after["messages"][-2]["content"]
    assert (
        client.post(f"{base}/journey/adjustment", json={"adjustment_id": later["id"]}).status_code == 409
    )  # not twice


def test_other_adjustment_kinds_change_the_choice_not_the_requirements(
    client: TestClient, provider: FakeProvider
) -> None:
    base = _confirmed(client, provider)
    client.post(f"{base}/journey", json={"search_scenario": "adjustments"})
    stuck = client.post(
        f"{base}/journey/destination", json={"destination_id": "albi", "activity_ids": ["albi-1", "albi-2"]}
    ).json()
    fewer = next(a for a in stuck["adjustments"] if a["kind"] == "fewer_activities")
    version = client.get(base).json()["version"]
    accepted = client.post(f"{base}/journey/adjustment", json={"adjustment_id": fewer["id"]}).json()
    assert accepted["stage"] == "itineraries" and accepted["selected_activity_ids"] == fewer["activity_ids"]
    assert client.get(base).json()["version"] == version  # requirements untouched


def test_refused_booking_offers_alternatives_and_errors_are_not_refusals(
    client: TestClient, provider: FakeProvider
) -> None:
    base = _confirmed(client, provider)
    failed = client.post(f"{base}/journey", json={"search_scenario": "error"})
    assert failed.status_code == 502 and failed.json()["code"] == "PLANNER_ERROR"
    assert "ne signifie pas" in failed.json()["detail"]
    assert client.get(f"{base}/journey").status_code == 409  # a failed search left nothing behind

    none = client.post(f"{base}/journey", json={"search_scenario": "no_match"}).json()
    assert none["stage"] == "no_match" and none["destinations"] == []

    client.post(f"{base}/journey", json={"booking_scenario": "refused"})
    chosen = client.post(
        f"{base}/journey/destination",
        json={"destination_id": "carcassonne", "activity_ids": ["carcassonne-1"]},
    ).json()
    first = chosen["itineraries"][0]["id"]
    client.post(f"{base}/journey/itinerary", json={"itinerary_id": first})
    client.post(f"{base}/journey/booking")
    refused = client.post(f"{base}/journey/booking/check").json()
    assert refused["stage"] == "booking_refused" and refused["booking"]["status"] == "refused"
    assert refused["alternatives"] and all(a["id"] != first for a in refused["alternatives"])
    assert client.get(f"{base}/journey/travel-file").status_code == 409
    retry = client.post(
        f"{base}/journey/itinerary", json={"itinerary_id": refused["alternatives"][0]["id"]}
    ).json()
    assert retry["stage"] == "review"
    client.post(f"{base}/journey/booking")
    assert client.post(f"{base}/journey/booking/check").json()["stage"] == "booked"

    other = _confirmed(client, provider)
    client.post(f"{other}/journey", json={"booking_scenario": "error"})
    pick = client.post(
        f"{other}/journey/destination", json={"destination_id": "carcassonne", "activity_ids": []}
    ).json()
    client.post(f"{other}/journey/itinerary", json={"itinerary_id": pick["itineraries"][0]["id"]})
    broken = client.post(f"{other}/journey/booking")
    assert broken.status_code == 502 and broken.json()["code"] == "BOOKING_ERROR"
    assert client.get(f"{other}/journey").json()["stage"] == "review"  # still reviewable, nothing sent


def test_preferences_can_change_at_any_time(client: TestClient, provider: FakeProvider) -> None:
    base = _confirmed(client, provider)
    client.post(f"{base}/journey", json={})
    first = client.post(
        f"{base}/journey/destination",
        json={"destination_id": "carcassonne", "activity_ids": ["carcassonne-1"]},
    ).json()
    client.post(f"{base}/journey/itinerary", json={"itinerary_id": first["itineraries"][0]["id"]})
    # Change of mind at the review stage: another destination, no need to start over.
    switched = client.post(
        f"{base}/journey/destination", json={"destination_id": "albi", "activity_ids": ["albi-1"]}
    ).json()
    assert switched["stage"] == "itineraries" and switched["selected_itinerary_id"] is None
    assert all(i["destination_id"] == "albi" for i in switched["itineraries"])
    # Change of a requirement: confirmation and journey are cleared, a new confirmation is needed.
    version = client.get(base).json()["version"]
    edited = client.patch(
        f"{base}/requirements", json={"field": "participants_count", "value": 32, "expected_version": version}
    ).json()
    assert edited["confirmed_requirements"] is None and edited["state"] == "AWAITING_CONFIRMATION"
    assert client.get(f"{base}/journey").status_code == 409
    assert client.post(f"{base}/journey", json={}).status_code == 409
    client.post(f"{base}/confirm", json={"expected_version": edited["version"]})
    again = client.post(f"{base}/journey", json={}).json()
    assert again["stage"] == "destinations" and again["requirements_version"] == edited["version"]
