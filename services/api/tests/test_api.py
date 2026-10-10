"""End-to-end multi-turn scenarios (matrix of the conversation-testing skill) with FakeProvider."""

from __future__ import annotations

import io
import json
import shutil
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_clock, get_extraction_provider, get_transcription_provider
from app.core.config import Settings
from app.main import create_app
from app.schemas.patch import AmbiguityKind, UserIntent
from app.services.providers.base import ProviderError
from app.services.providers.fake_provider import FakeProvider
from tests.conftest import COMPLETE_PATCH, dt, mk_patch, op, tt

FULL = "27 élèves et 3 accompagnateurs, le 12 novembre 2026 vers 8 h, retour avant 17 h, histoire, Moyen Âge"
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
    _send(client, conv["conversation_id"], FULL)
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
    _send(client, conv["conversation_id"], FULL)
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
    sent = _send(client, conv["conversation_id"], FULL)
    restored = client.get(f"/api/v1/conversations/{conv['conversation_id']}").json()
    for key in ("state", "version", "requirements", "missing_fields", "ready_for_confirmation", "messages"):
        assert restored[key] == sent[key]
    assert restored["assistant_message"] == sent["assistant_message"]


def test_confirm_edit_reconfirm_export(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    provider.queue(COMPLETE_PATCH)
    body = _send(client, conv["conversation_id"], FULL)
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
    _send(client, cid, FULL)
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


def wav_bytes(seconds: float = 0.3) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"\x00\x00" * int(seconds * 8000))
    return buffer.getvalue()


needs_ffprobe = pytest.mark.skipif(shutil.which("ffprobe") is None, reason="ffprobe not installed")


@needs_ffprobe
def test_audio_returns_transcript_without_extracting(client: TestClient, provider: FakeProvider) -> None:
    conv = _create(client)
    cid = conv["conversation_id"]
    response = client.post(
        f"/api/v1/conversations/{cid}/audio", files={"file": ("voix.wav", wav_bytes(), "audio/wav")}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["transcript"] == provider.transcript
    assert body["assistant_message"] is None
    assert body["version"] == 0 and provider.calls == []


@needs_ffprobe
def test_audio_that_is_not_audio_never_reaches_the_provider(
    client: TestClient, provider: FakeProvider
) -> None:
    cid = _create(client)["conversation_id"]
    transcribed: list[bytes] = []
    provider.transcribe = lambda **kwargs: transcribed.append(kwargs["audio"]) or "x"  # type: ignore[method-assign]
    fake = client.post(
        f"/api/v1/conversations/{cid}/audio", files={"file": ("v.webm", b"<script>x</script>", "audio/webm")}
    )
    assert fake.status_code == 400 and fake.json()["code"] == "AUDIO_INVALID"
    wrong_type = client.post(
        f"/api/v1/conversations/{cid}/audio", files={"file": ("x.txt", b"abc", "text/plain")}
    )
    assert wrong_type.status_code == 400 and wrong_type.json()["code"] == "AUDIO_FORMAT"
    assert transcribed == []


@needs_ffprobe
def test_audio_longer_than_the_limit_is_rejected(tmp_path, clock, provider) -> None:  # type: ignore[no-untyped-def]
    app = create_app(
        Settings(_env_file=None, database_url=f"sqlite:///{tmp_path / 'long.db'}", max_audio_seconds=1)
    )
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_extraction_provider] = lambda: provider
    app.dependency_overrides[get_transcription_provider] = lambda: provider
    with TestClient(app) as long_client:
        cid = _create(long_client)["conversation_id"]
        response = long_client.post(
            f"/api/v1/conversations/{cid}/audio", files={"file": ("v.wav", wav_bytes(2.0), "audio/wav")}
        )
        assert response.status_code == 413 and response.json()["code"] == "AUDIO_TOO_LONG"


def test_audio_for_unknown_conversation_is_404_before_any_work(client: TestClient) -> None:
    response = client.post(
        "/api/v1/conversations/conv_nope/audio", files={"file": ("v.wav", wav_bytes(), "audio/wav")}
    )
    assert response.status_code == 404


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
    body = _send(client, cid, FULL)
    Draft202012Validator(response_schema, format_checker=FormatChecker()).validate(body)
    confirmed = client.post(
        f"/api/v1/conversations/{cid}/confirm", json={"expected_version": body["version"]}
    ).json()
    Draft202012Validator(response_schema, format_checker=FormatChecker()).validate(confirmed)
    Draft202012Validator(confirmed_schema, format_checker=FormatChecker()).validate(
        confirmed["confirmed_requirements"]
    )


def test_reused_message_id_with_other_content_is_a_conflict(
    client: TestClient, provider: FakeProvider
) -> None:
    cid = _create(client)["conversation_id"]
    provider.queue(mk_patch(total=30))
    _send(client, cid, "Nous sommes 30.", cid="same")
    again = client.post(
        f"/api/v1/conversations/{cid}/messages",
        json={"content": "Nous sommes 32.", "client_message_id": "same"},
    )
    assert again.status_code == 409 and again.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert client.get(f"/api/v1/conversations/{cid}").json()["requirements"]["participants_count"] == 30


def test_change_during_model_call_is_rejected_not_overwritten(
    client: TestClient, provider: FakeProvider
) -> None:
    """A panel edit lands while the model is still working on a chat message."""
    cid = _create(client)["conversation_id"]

    def extract_while_someone_edits(**_: object):  # type: ignore[no-untyped-def]
        edited = client.patch(
            f"/api/v1/conversations/{cid}/requirements",
            json={"field": "participants_count", "value": 40, "expected_version": 0},
        )
        assert edited.status_code == 200
        return mk_patch(op("teaching_type", tt("Histoire"), evidence="prof d'histoire"))

    provider.extract = extract_while_someone_edits  # type: ignore[method-assign]
    stale = client.post(
        f"/api/v1/conversations/{cid}/messages",
        json={"content": "Je suis prof d'histoire.", "client_message_id": "c1"},
    )
    assert stale.status_code == 409 and stale.json()["code"] == "CONCURRENT_UPDATE"
    state = client.get(f"/api/v1/conversations/{cid}").json()
    assert state["requirements"]["participants_count"] == 40
    assert state["requirements"]["teaching_type"] is None


def test_evidence_must_quote_the_message(client: TestClient, provider: FakeProvider) -> None:
    cid = _create(client)["conversation_id"]
    invented = mk_patch(op("participants_count", 500, evidence="500 participants"), total=500)
    provider.queue(invented, invented)  # first attempt and the single retry
    rejected = client.post(
        f"/api/v1/conversations/{cid}/messages", json={"content": "Bonjour.", "client_message_id": "e1"}
    )
    assert rejected.status_code == 502 and rejected.json()["code"] == "INVALID_EVIDENCE"
    assert len(provider.calls) == 2
    assert client.get(f"/api/v1/conversations/{cid}").json()["version"] == 0

    provider.queue(invented, mk_patch(op("participants_count", 30, evidence="Nous sommes 30"), total=30))
    recovered = _send(client, cid, "Nous sommes 30.", cid="e2")  # the retry produced a supported patch
    assert recovered["requirements"]["participants_count"] == 30


def test_impossible_date_from_the_model_is_a_provider_error_not_a_500(
    client: TestClient, provider: FakeProvider
) -> None:
    cid = _create(client)["conversation_id"]
    provider.queue(mk_patch(op("departure", dt("2026-02-30", "08:00", "exact"), evidence="30 février")))
    response = client.post(
        f"/api/v1/conversations/{cid}/messages",
        json={"content": "Départ le 30 février à 8 h.", "client_message_id": "d1"},
    )
    assert response.status_code == 502 and response.json()["code"] == "INVALID_EXTRACTION"
    assert client.get(f"/api/v1/conversations/{cid}").json()["version"] == 0


def test_invalid_panel_value_is_422(client: TestClient) -> None:
    cid = _create(client)["conversation_id"]
    zero = client.patch(
        f"/api/v1/conversations/{cid}/requirements",
        json={"field": "participants_count", "value": 0, "expected_version": 0},
    )
    assert zero.status_code == 422 and zero.json()["code"] == "INVALID_VALUE"
    bad_date = client.patch(
        f"/api/v1/conversations/{cid}/requirements",
        json={
            "field": "departure",
            "value": {"date": "2026-13-40", "time": "08:00", "constraint": "exact"},
            "expected_version": 0,
        },
    )
    assert bad_date.status_code == 422


def test_vague_correction_of_a_known_value_asks_instead_of_confirming(
    client: TestClient, provider: FakeProvider
) -> None:
    cid = _create(client)["conversation_id"]
    provider.queue(COMPLETE_PATCH)
    _send(
        client,
        cid,
        "27 élèves et 3 accompagnateurs, le 12 novembre 2026 vers 8 h, retour avant 17 h, histoire, Moyen Âge",
    )
    provider.queue(
        mk_patch(
            intent=UserIntent.CORRECT_INFORMATION,
            ambiguities=[("participants_count", AmbiguityKind.VAGUE_QUANTITY)],
        )
    )
    body = _send(client, cid, "Finalement, environ 35.", cid="m2")
    assert body["state"] == "ASKING_USER"
    assert body["ready_for_confirmation"] is False
    assert body["requirements"]["participants_count"] == 30
    assert body["assistant_message"] == "Pouvez-vous me donner le nombre exact de participants ?"


def test_security_headers_error_codes_and_client_config(client: TestClient) -> None:
    missing = client.get("/api/v1/conversations/conv_nope")
    assert missing.json()["code"] == "CONVERSATION_NOT_FOUND"
    assert missing.headers["x-content-type-options"] == "nosniff"
    assert missing.headers["cache-control"] == "no-store"
    assert len(missing.headers["x-request-id"]) == 32
    config = client.get("/api/v1/config").json()
    assert config == {
        "max_audio_seconds": 120,
        "max_audio_bytes": 10485760,
        "max_message_chars": 4000,
        "timezone": "Europe/Paris",
    }
    huge = client.post(
        "/api/v1/conversations",
        content=b"{}",
        headers={"content-length": str(50 * 1024 * 1024), "content-type": "application/json"},
    )
    assert huge.status_code == 413 and huge.json()["code"] == "BODY_TOO_LARGE"


def test_overwriting_a_known_value_is_always_announced(client: TestClient, provider: FakeProvider) -> None:
    """Whether or not the model flags a correction, the teacher is told that a value changed."""
    cid = _create(client)["conversation_id"]
    provider.queue(mk_patch(total=30))
    first = _send(client, cid, "Nous sommes 30.")
    assert "au lieu de" not in first["assistant_message"]  # first value: nothing was replaced
    provider.queue(
        mk_patch(op("participants_count", 28, "replace"), intent=UserIntent.CORRECT_INFORMATION, total=28)
    )
    body = _send(client, cid, "Nous sommes 28 personnes.", cid="m2")
    assert body["requirements"]["participants_count"] == 28
    assert body["assistant_message"].startswith(
        "C'est noté, j'ai mis à jour le nombre de participants : 28 participants (au lieu de 30 participants). "
    )
    assert body["assistant_message"].endswith("Quel jour et à quelle heure souhaitez-vous partir ?")
