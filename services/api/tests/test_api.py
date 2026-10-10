"""End-to-end multi-turn scenarios (matrix of the conversation-testing skill) with FakeProvider."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.schemas.patch import AmbiguityKind, UserIntent
from app.services.providers.base import ProviderError
from app.services.providers.fake_provider import FakeProvider
from tests.conftest import COMPLETE_PATCH, dt, mk_patch, op, tt

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"


def _create(client: TestClient) -> dict:
    response = client.post("/api/v1/conversations", json={})
    assert response.status_code == 201
    body: dict = response.json()
    assert body["state"] == "COLLECTING"
    assert body["messages"][0]["role"] == "assistant"
    assert body["messages"][0]["content"].startswith("Bonjour !")
    return body


def _send(client: TestClient, conv_id: str, text: str, cid: str = "m1") -> dict:
    response = client.post(
        f"/api/v1/conversations/{conv_id}/messages", json={"content": text, "client_message_id": cid}
    )
    assert response.status_code == 200, response.text
    result: dict = response.json()
    return result


def test_complete_message_goes_straight_to_confirmation(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(COMPLETE_PATCH)
    body = _send(client, conv["conversation_id"], "Bonjour, 27 élèves et 3 accompagnateurs…")
    assert body["state"] == "AWAITING_CONFIRMATION"
    assert body["ready_for_confirmation"] is True
    assert body["missing_fields"] == []
    assert body["version"] == 1
    assert body["requirements"]["participants_count"] == 30
    assert body["requirements"]["return"]["constraint"] == "latest"
    assert body["assistant_message"].startswith("J'ai bien compris votre projet")
    assert [m["role"] for m in body["messages"]] == ["assistant", "user", "assistant"]


def test_missing_return_then_follow_up(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(
        mk_patch(
            op("departure", dt("2026-11-15", "09:00", "exact")),
            op("teaching_type", tt("SVT")),
            total=25,
        )
    )
    body = _send(
        client, conv["conversation_id"], "Je suis prof de SVT, 25 personnes, départ le 15 novembre à 9 h."
    )
    assert body["state"] == "COLLECTING"
    assert body["missing_fields"] == ["return"]
    assert (
        body["assistant_message"] == "À quelle heure souhaitez-vous être de retour le dimanche 15 novembre ?"
    )

    provider.queue(mk_patch(op("return", dt(None, "18:00", "latest"))))
    body = _send(client, conv["conversation_id"], "Avant 18 h.", cid="m2")
    assert body["state"] == "AWAITING_CONFIRMATION"
    assert body["requirements"]["return"] == {"date": "2026-11-15", "time": "18:00", "constraint": "latest"}
    assert body["version"] == 2


def test_students_only_asks_for_accompanying(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(mk_patch(students=25, ambiguities=[("participants_count", AmbiguityKind.STUDENTS_ONLY)]))
    body = _send(client, conv["conversation_id"], "J'ai 25 élèves.")
    assert body["state"] == "ASKING_USER"
    assert body["requirements"]["participants_count"] is None
    assert body["pending_clarification"] == {"field": "participants_count", "kind": "students_only"}
    assert (
        body["assistant_message"]
        == "Combien d'accompagnateurs participeront à la sortie avec les 25 élèves ?"
    )

    provider.queue(mk_patch(accompanying=3))
    body = _send(client, conv["conversation_id"], "Trois accompagnateurs.", cid="m2")
    assert body["requirements"]["participants_count"] == 28
    assert body["state"] == "COLLECTING"
    assert body["missing_fields"] == ["departure", "return", "teaching_type"]


def test_correction_replaces_and_never_re_asks(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(COMPLETE_PATCH)
    _send(client, conv["conversation_id"], "…")
    provider.queue(
        mk_patch(op("participants_count", 32, "replace"), intent=UserIntent.CORRECT_INFORMATION, total=32)
    )
    body = _send(client, conv["conversation_id"], "Finalement, nous serons 32 en tout.", cid="m2")
    assert body["requirements"]["participants_count"] == 32
    assert body["requirements"]["teaching_type"] == {"subject": "Histoire", "theme": "Moyen Âge"}
    assert body["state"] == "AWAITING_CONFIRMATION"
    assert "32 participants" in body["assistant_message"]


def test_conflict_without_correction_asks_which_value(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(mk_patch(total=30))
    _send(client, conv["conversation_id"], "Nous sommes 30.")
    provider.queue(
        mk_patch(op("teaching_type", tt("Géographie")), total=28, conflicts=["participants_count"])
    )
    body = _send(client, conv["conversation_id"], "Nous sommes 28 et je suis prof de géographie.", cid="m2")
    assert body["state"] == "ASKING_USER"
    assert body["requirements"]["participants_count"] == 30
    assert body["requirements"]["teaching_type"]["subject"] == "Géographie"
    assert body["assistant_message"].startswith("J'ai noté 30 participants pour le nombre de participants")


def test_return_before_departure_is_rejected_and_state_kept(
    client: TestClient, provider: FakeProvider
) -> None:
    conv = _create(client)
    provider.queue(mk_patch(op("departure", dt("2026-11-12", "14:00", "exact")), total=30))
    _send(client, conv["conversation_id"], "…")
    provider.queue(mk_patch(op("return", dt("2026-11-12", "10:00", "exact"))))
    body = _send(client, conv["conversation_id"], "Retour à 10 h.", cid="m2")
    assert body["state"] == "ASKING_USER"
    assert body["requirements"]["return"] is None
    assert "antérieure au départ" in body["assistant_message"]
    assert body["version"] == 1  # no snapshot for an inconsistent state


def test_vague_date_asks_exact_date(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(
        mk_patch(
            students=30, accompanying=2, ambiguities=[("departure", AmbiguityKind.RELATIVE_DATE_UNRESOLVED)]
        )
    )
    body = _send(client, conv["conversation_id"], "Le mois prochain, 30 élèves et 2 accompagnateurs.")
    assert body["requirements"]["participants_count"] == 32
    assert body["state"] == "ASKING_USER"
    assert body["assistant_message"] == "Pouvez-vous me préciser la date exacte ?"


def test_duplicate_submission_is_idempotent(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(mk_patch(total=30))
    first = _send(client, conv["conversation_id"], "Nous sommes 30.", cid="dup")
    second = _send(client, conv["conversation_id"], "Nous sommes 30.", cid="dup")
    assert first == second
    assert len(provider.calls) == 1
    assert len(second["messages"]) == 3


def test_session_restore_returns_same_state(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(COMPLETE_PATCH)
    sent = _send(client, conv["conversation_id"], "…")
    restored = client.get(f"/api/v1/conversations/{conv['conversation_id']}").json()
    for key in ("state", "version", "requirements", "missing_fields", "ready_for_confirmation", "messages"):
        assert restored[key] == sent[key]
    assert restored["assistant_message"] == sent["assistant_message"]


def test_confirm_edit_reconfirm_export(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(COMPLETE_PATCH)
    body = _send(client, conv["conversation_id"], "…")
    cid = conv["conversation_id"]

    # Export impossible before confirmation.
    assert client.get(f"/api/v1/conversations/{cid}/export").status_code == 409

    confirmed = client.post(
        f"/api/v1/conversations/{cid}/confirm", json={"expected_version": body["version"]}
    )
    assert confirmed.status_code == 200
    payload = confirmed.json()
    assert payload["state"] == "CONFIRMED"
    assert payload["confirmed_requirements"]["schema_version"] == "1.0"
    assert payload["confirmed_requirements"]["requirements"]["participants_count"] == 30
    assert payload["confirmed_requirements"]["confirmed_at"].endswith("+02:00")

    exported = client.get(f"/api/v1/conversations/{cid}/export").json()
    assert exported == payload["confirmed_requirements"]

    # Edit after confirmation → back to awaiting confirmation, export invalidated.
    edited = client.patch(
        f"/api/v1/conversations/{cid}/requirements",
        json={"field": "participants_count", "value": 32, "expected_version": payload["version"]},
    )
    assert edited.status_code == 200
    body = edited.json()
    assert body["state"] == "AWAITING_CONFIRMATION"
    assert body["requirements"]["participants_count"] == 32
    assert body["confirmed_requirements"] is None
    assert body["assistant_message"].startswith(
        "Très bien, j'ai mis à jour le nombre de participants : 32 participants."
    )
    assert client.get(f"/api/v1/conversations/{cid}/export").status_code == 409

    reconfirmed = client.post(
        f"/api/v1/conversations/{cid}/confirm", json={"expected_version": body["version"]}
    )
    assert reconfirmed.json()["confirmed_requirements"]["requirements"]["participants_count"] == 32


def test_confirm_requires_complete_state_and_fresh_version(
    client: TestClient, provider: FakeProvider
) -> None:
    conv = _create(client)
    cid = conv["conversation_id"]
    assert (
        client.post(f"/api/v1/conversations/{cid}/confirm", json={"expected_version": 0}).status_code == 409
    )
    provider.queue(COMPLETE_PATCH)
    _send(client, cid, "…")
    stale = client.post(f"/api/v1/conversations/{cid}/confirm", json={"expected_version": 0})
    assert stale.status_code == 409
    assert stale.headers["content-type"].startswith("application/problem+json")
    assert "Rechargez" in stale.json()["detail"]


def test_panel_edit_of_datetime_and_stale_version(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    cid = conv["conversation_id"]
    body = client.patch(
        f"/api/v1/conversations/{cid}/requirements",
        json={
            "field": "departure",
            "value": {"date": "2026-11-12", "time": "8:00", "constraint": "exact"},
            "expected_version": 0,
        },
    ).json()
    assert body["requirements"]["departure"] == {"date": "2026-11-12", "time": "08:00", "constraint": "exact"}
    assert body["version"] == 1
    stale = client.patch(
        f"/api/v1/conversations/{cid}/requirements",
        json={"field": "participants_count", "value": 30, "expected_version": 0},
    )
    assert stale.status_code == 409


def test_provider_failure_keeps_state_and_is_retryable(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    cid = conv["conversation_id"]
    provider.fail_next = ProviderError("boom")
    failed = client.post(
        f"/api/v1/conversations/{cid}/messages", json={"content": "Nous sommes 30.", "client_message_id": "x"}
    )
    assert failed.status_code == 502
    assert failed.json()["detail"] == "Désolé, je n'ai pas pu traiter votre message. Pouvez-vous réessayer ?"
    unchanged = client.get(f"/api/v1/conversations/{cid}").json()
    assert unchanged["version"] == 0 and len(unchanged["messages"]) == 1

    provider.fail_next = ProviderError("slow", timeout=True)
    assert (
        client.post(
            f"/api/v1/conversations/{cid}/messages", json={"content": "x", "client_message_id": "y"}
        ).status_code
        == 504
    )

    provider.queue(mk_patch(total=30))
    retried = _send(
        client, cid, "Nous sommes 30.", cid="x"
    )  # same client_message_id: accepted because never processed
    assert retried["requirements"]["participants_count"] == 30


def test_audio_returns_transcript_without_extracting(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    cid = conv["conversation_id"]
    response = client.post(
        f"/api/v1/conversations/{cid}/audio",
        files={"file": ("voix.webm", b"\x1aE\xdf\xa3fake", "audio/webm")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == provider.transcript
    assert body["assistant_message"] is None
    assert body["version"] == 0 and provider.calls == []

    bad = client.post(f"/api/v1/conversations/{cid}/audio", files={"file": ("x.txt", b"abc", "text/plain")})
    assert bad.status_code == 400


def test_audio_too_large_is_rejected(tmp_path, clock, provider) -> None:  # type: ignore[no-untyped-def]
    from app.api.deps import get_clock, get_extraction_provider, get_transcription_provider
    from app.core.config import Settings
    from app.main import create_app

    app = create_app(Settings(database_url=f"sqlite:///{tmp_path / 'small.db'}", max_audio_bytes=10))
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_extraction_provider] = lambda: provider
    app.dependency_overrides[get_transcription_provider] = lambda: provider
    with TestClient(app) as small_client:
        cid = _create(small_client)["conversation_id"]
        response = small_client.post(
            f"/api/v1/conversations/{cid}/audio", files={"file": ("v.webm", b"0" * 11, "audio/webm")}
        )
        assert response.status_code == 413


def test_unknown_conversation_and_empty_message(client: TestClient) -> None:
    assert client.get("/api/v1/conversations/conv_nope").status_code == 404
    conv = _create(client)
    response = client.post(
        f"/api/v1/conversations/{conv['conversation_id']}/messages",
        json={"content": "   ", "client_message_id": "e"},
    )
    assert response.status_code == 400


def test_responses_match_published_contract(client: TestClient, provider: FakeProvider) -> None:
    from jsonschema import Draft202012Validator, FormatChecker

    response_schema = json.loads((CONTRACTS / "conversation_response.schema.json").read_text())
    confirmed_schema = json.loads((CONTRACTS / "requirements.schema.json").read_text())
    conv = _create(client)
    cid = conv["conversation_id"]
    provider.queue(COMPLETE_PATCH)
    body = _send(client, cid, "…")
    Draft202012Validator(response_schema, format_checker=FormatChecker()).validate(body)
    confirmed = client.post(
        f"/api/v1/conversations/{cid}/confirm", json={"expected_version": body["version"]}
    ).json()
    Draft202012Validator(response_schema, format_checker=FormatChecker()).validate(confirmed)
    Draft202012Validator(confirmed_schema, format_checker=FormatChecker()).validate(
        confirmed["confirmed_requirements"]
    )
