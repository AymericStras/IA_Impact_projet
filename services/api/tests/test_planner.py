"""Planner adapter: simulation (deterministic, labelled) and the HTTP client's failure handling."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.errors import AppError
from app.schemas.requirements import ConfirmedRequirements
from app.services.planner import HttpPlanner, SimulatedPlanner
from app.services.providers.fake_provider import FakeProvider
from tests.conftest import COMPLETE_PATCH, mk_patch, op, tt

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
FULL = "27 élèves et 3 accompagnateurs, au départ de Toulouse Matabiau, le 12 novembre 2026 vers 8 h, retour avant 17 h, histoire, Moyen Âge"


def confirmed(**overrides: object) -> ConfirmedRequirements:
    requirements = {
        "participants_count": 30,
        "departure_station": "Toulouse Matabiau",
        "departure": {"date": "2026-11-12", "time": "08:00", "constraint": "approximate"},
        "return": {"date": "2026-11-12", "time": "17:00", "constraint": "latest"},
        "teaching_type": {"subject": "Histoire", "theme": "Moyen Âge"},
    }
    requirements.update(overrides)
    return ConfirmedRequirements.model_validate(
        {
            "conversation_id": "conv_x",
            "confirmed_at": "2026-10-10T12:00:00+02:00",
            "requirements": requirements,
        }
    )


def test_simulation_respects_time_constraints_and_theme() -> None:
    proposals = SimulatedPlanner().plan(confirmed(), None)
    assert [p.destination for p in proposals][0] == "Carcassonne"  # best match for « Moyen Âge »
    assert 1 <= len(proposals) <= 3
    for proposal in proposals:
        assert proposal.simulated is True
        assert proposal.participants_count == 30
        leave = datetime.fromisoformat(proposal.outbound.departure)
        back = datetime.fromisoformat(proposal.return_.arrival)
        assert leave.isoformat().startswith("2026-11-12T08:05")  # « vers 8 h »
        assert back <= datetime.fromisoformat("2026-11-12T17:00:00+01:00")  # « au plus tard à 17 h »
        assert datetime.fromisoformat(proposal.outbound.arrival) < datetime.fromisoformat(
            proposal.return_.departure
        )
        starts = [datetime.fromisoformat(a.start) for a in proposal.activities]
        ends = [datetime.fromisoformat(a.end) for a in proposal.activities]
        assert starts[0] > datetime.fromisoformat(proposal.outbound.arrival)
        assert ends[-1] < datetime.fromisoformat(proposal.return_.departure)
        assert "simulé" in proposal.outbound.line and not any(ch.isdigit() for ch in proposal.outbound.line)


def test_simulation_matches_other_themes_and_short_days() -> None:
    science = SimulatedPlanner().plan(
        confirmed(teaching_type={"subject": "SVT", "theme": "biodiversité"}), None
    )
    assert science[0].destination == "Sète"
    exact = SimulatedPlanner().plan(
        confirmed(departure={"date": "2026-11-12", "time": "09:00", "constraint": "exact"}), None
    )
    assert exact[0].outbound.departure.startswith("2026-11-12T09:00")
    too_short = SimulatedPlanner().plan(
        confirmed(
            departure={"date": "2026-11-12", "time": "13:00", "constraint": "exact"},
            **{"return": {"date": "2026-11-12", "time": "15:00", "constraint": "latest"}},
        ),
        None,
    )
    assert too_short == []


def test_scenarios() -> None:
    assert SimulatedPlanner().plan(confirmed(), "no_match") == []
    with pytest.raises(AppError) as error:
        SimulatedPlanner().plan(confirmed(), "error")
    assert error.value.code == "PLANNER_ERROR" and error.value.status == 502


def test_http_planner_never_turns_a_failure_into_no_match() -> None:
    def failing(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    with pytest.raises(AppError):
        HttpPlanner("http://planner.test", transport=httpx.MockTransport(failing)).plan(confirmed(), None)
    with pytest.raises(AppError):
        HttpPlanner(
            "http://planner.test",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"oops": 1})),
        ).plan(confirmed(), None)
    real = SimulatedPlanner().plan(confirmed(), None)[0].model_dump(mode="json", by_alias=True)
    with pytest.raises(AppError):  # a real service must not hand back simulated data
        HttpPlanner(
            "http://planner.test",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"proposals": [real]})),
        ).plan(confirmed(), None)
    real["simulated"] = False
    seen: list[dict] = []

    def ok(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"proposals": [real]})

    proposals = HttpPlanner("http://planner.test", "token", transport=httpx.MockTransport(ok)).plan(
        confirmed(), None
    )
    assert proposals[0].destination == "Carcassonne"
    assert seen[0]["schema_version"] == "1.1" and seen[0]["requirements"]["return"]["constraint"] == "latest"


def _confirmed_conversation(client: TestClient, provider: FakeProvider) -> str:
    cid = client.post("/api/v1/conversations", json={}).json()["conversation_id"]
    provider.queue(COMPLETE_PATCH)
    body = client.post(
        f"/api/v1/conversations/{cid}/messages", json={"content": FULL, "client_message_id": "p1"}
    ).json()
    assert (
        client.post(
            f"/api/v1/conversations/{cid}/confirm", json={"expected_version": body["version"]}
        ).status_code
        == 200
    )
    return cid


def test_full_flow_plan_select_handoff(client: TestClient, provider: FakeProvider) -> None:
    from jsonschema import Draft202012Validator, FormatChecker

    assert client.get("/api/v1/config").json()["planner_mode"] == "simulated"
    cid = client.post("/api/v1/conversations", json={}).json()["conversation_id"]
    base = f"/api/v1/conversations/{cid}"
    early = client.post(f"{base}/plan", json={})
    assert early.status_code == 409 and "Confirmez" in early.json()["detail"]  # not before confirmation

    cid = _confirmed_conversation(client, provider)
    base = f"/api/v1/conversations/{cid}"
    assert client.get(f"{base}/plan").status_code == 409
    plan = client.post(f"{base}/plan", json={})
    assert plan.status_code == 200, plan.text
    result = plan.json()
    assert (
        result["status"] == "proposals"
        and result["simulated"] is True
        and result["planner_mode"] == "simulated"
    )
    assert result["proposals"][0]["outbound"]["from_station"] == "Toulouse Matabiau"
    Draft202012Validator(
        json.loads((CONTRACTS / "plan_result.schema.json").read_text()), format_checker=FormatChecker()
    ).validate(result)

    assert client.get(f"{base}/handoff").status_code == 409  # nothing chosen yet
    assert client.post(f"{base}/plan/select", json={"proposal_id": "nope"}).status_code == 409
    chosen = result["proposals"][0]["id"]
    selected = client.post(f"{base}/plan/select", json={"proposal_id": chosen}).json()
    assert selected["selected_proposal_id"] == chosen
    handoff = client.get(f"{base}/handoff").json()
    assert handoff["booking_status"] == "NOT_RESERVED" and handoff["simulated"] is True
    assert handoff["proposal"]["id"] == chosen and handoff["requirements"]["participants_count"] == 30
    Draft202012Validator(
        json.loads((CONTRACTS / "handoff.schema.json").read_text()), format_checker=FormatChecker()
    ).validate(handoff)


def test_scenarios_and_invalidation_through_the_api(client: TestClient, provider: FakeProvider) -> None:
    cid = _confirmed_conversation(client, provider)
    base = f"/api/v1/conversations/{cid}"
    none = client.post(f"{base}/plan", json={"scenario": "no_match"}).json()
    assert none["status"] == "no_match" and none["proposals"] == []
    failed = client.post(f"{base}/plan", json={"scenario": "error"})
    assert failed.status_code == 502 and failed.json()["code"] == "PLANNER_ERROR"
    assert "ne signifie pas" in failed.json()["detail"]  # a failure is not « no proposal »
    assert client.get(f"{base}/plan").json()["status"] == "no_match"  # the failed call changed nothing

    ok = client.post(f"{base}/plan", json={}).json()
    client.post(f"{base}/plan/select", json={"proposal_id": ok["proposals"][0]["id"]})
    # Editing a requirement after planning invalidates confirmation, proposals and selection.
    version = client.get(base).json()["version"]
    edited = client.patch(
        f"{base}/requirements", json={"field": "participants_count", "value": 32, "expected_version": version}
    )
    assert edited.status_code == 200 and edited.json()["confirmed_requirements"] is None
    assert client.get(f"{base}/plan").status_code == 409
    assert client.get(f"{base}/handoff").status_code == 409
    assert client.post(f"{base}/plan", json={}).status_code == 409  # must confirm again first
    provider.queue(
        mk_patch(op("teaching_type", tt("SVT", "biodiversité"), "replace"))
    )  # unused: keeps the fixture honest
