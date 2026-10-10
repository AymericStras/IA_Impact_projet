from __future__ import annotations

import io
import threading
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from mailato import api as mailato
from pypdf import PdfReader

from sncf_bilan.api import create_app
from sncf_bilan.config import Config, ConfigurationError
from sncf_bilan.mail.deliver import Delivery
from sncf_bilan.service import RecapService
from sncf_bilan.store import Store

from .conftest import example_data

KEY = {"X-Bilan-Key": "test-key"}


class Outbox:
    """Stands in for the mail provider; outcomes are scripted per call."""

    def __init__(self):
        self.messages = []
        self.outcomes = []

    def __call__(self, message, config, *, recap_id):
        self.messages.append((recap_id, message))
        outcome = self.outcomes.pop(0) if self.outcomes else None
        if isinstance(outcome, Exception):
            raise outcome
        return Delivery("resend", f"email_{len(self.messages)}", 1)


@pytest.fixture
def outbox():
    return Outbox()


def make_client(config: Config, outbox: Outbox) -> TestClient:
    service = RecapService(config, Store(config.data_dir), deliver=outbox)
    return TestClient(create_app(config, service=service))


@pytest.fixture
def client(config, outbox):
    with make_client(config, outbox) as test_client:
        yield test_client


def body(name="01-aller-retour-complet", **top):
    data = example_data(name)
    data.update(top)
    return data


def test_health_needs_no_key_and_reveals_no_secret(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0", "mail_mode": "dry-run"}


@pytest.mark.parametrize("headers", [{}, {"X-Bilan-Key": "wrong"}, {"X-Bilan-Key": ""}])
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/v1/recaps"),
        ("post", "/api/v1/render"),
        ("get", "/api/v1/recaps/some-id"),
        ("get", "/api/v1/recaps/some-id/document.pdf"),
        ("post", "/api/v1/recaps/some-id/retry"),
    ],
)
def test_every_route_refuses_a_missing_or_wrong_key(client, outbox, method, path, headers):
    kwargs = {"json": body()} if method == "post" else {}
    response = getattr(client, method)(path, headers=headers, **kwargs)
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORISED"
    assert outbox.messages == []


def test_recap_is_rendered_recorded_and_sent(client, outbox):
    response = client.post("/api/v1/recaps", json=body(), headers=KEY)
    assert response.status_code == 202
    created = response.json()
    assert created["status"] == "queued"
    assert created["recipient"] == "destinataire@example.fr"

    # The background task has run by the time the test client returns.
    status = client.get(f"/api/v1/recaps/{created['id']}", headers=KEY).json()
    assert (status["status"], status["provider"], status["provider_message_id"]) == (
        "sent",
        "resend",
        "email_1",
    )
    assert status["attempts"] == 1 and status["error"] is None

    recap_id, message = outbox.messages[0]
    assert recap_id == created["id"]
    assert list(message.to) == ["destinataire@example.fr"]

    document = client.get(f"/api/v1/recaps/{created['id']}/document.pdf", headers=KEY)
    assert document.status_code == 200
    assert document.headers["content-type"] == "application/pdf"
    assert "recapitulatif-SIM-050033B9.pdf" in document.headers["content-disposition"]
    assert document.content == message.attachments[0].content
    assert "Toulouse Matabiau" in PdfReader(io.BytesIO(document.content)).pages[0].extract_text()


def test_repeating_a_request_does_not_send_twice(client, outbox):
    first = client.post("/api/v1/recaps", json=body(), headers=KEY)
    again = client.post("/api/v1/recaps", json=body(), headers=KEY)
    assert (first.status_code, again.status_code) == (202, 200)
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["status"] == "sent"
    assert len(outbox.messages) == 1


def test_same_key_with_other_content_is_a_conflict(client, outbox):
    client.post("/api/v1/recaps", json=body(), headers=KEY)
    changed = body()
    changed["trip"]["participants_count"] = 2
    response = client.post("/api/v1/recaps", json=changed, headers=KEY)
    assert response.status_code == 409
    assert response.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert len(outbox.messages) == 1


@pytest.mark.parametrize("name", ["90-invalide-prix-transmis", "91-invalide-arrivee-avant-depart"])
def test_invalid_examples_get_422_and_nothing_is_sent(client, outbox, name):
    response = client.post("/api/v1/recaps", json=example_data(name), headers=KEY)
    assert response.status_code == 422
    assert outbox.messages == []
    assert client.post("/api/v1/render", json=example_data(name), headers=KEY).status_code == 422


def test_provider_refusal_is_recorded_and_can_be_retried(client, outbox):
    refusal = mailato.ResendAPIError(403, "validation_error", "domain is not verified")
    refusal.attempts = 1
    outbox.outcomes = [refusal]
    created = client.post("/api/v1/recaps", json=body(), headers=KEY).json()

    failed = client.get(f"/api/v1/recaps/{created['id']}", headers=KEY).json()
    assert failed["status"] == "failed"
    assert "domain is not verified" in failed["error"]
    assert failed["attempts"] == 1

    retried = client.post(f"/api/v1/recaps/{created['id']}/retry", headers=KEY)
    assert retried.status_code == 202
    final = client.get(f"/api/v1/recaps/{created['id']}", headers=KEY).json()
    assert (final["status"], final["error"], final["attempts"]) == ("sent", None, 2)
    # Same recap id both times: the provider sees the same idempotency key.
    assert [recap_id for recap_id, _ in outbox.messages] == [created["id"]] * 2


def test_unexpected_failure_ends_in_a_failed_state_without_leaking_details(client, outbox):
    outbox.outcomes = [RuntimeError("secret internal detail")]
    created = client.post("/api/v1/recaps", json=body(), headers=KEY).json()
    failed = client.get(f"/api/v1/recaps/{created['id']}", headers=KEY).json()
    assert failed["status"] == "failed"
    assert failed["error"] == "Internal error: RuntimeError"


def test_refused_recipient_domain_is_recorded_as_not_sent(config, outbox):
    def real_policy(message, cfg, *, recap_id):
        settings = mailato.Settings(
            mail_from=cfg.mail_from, resend_api_key="re_test", allowed_domains=["school.fr"]
        )
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(mailato, "post_email", lambda *a, **k: pytest.fail("must not send"))
            mailato.send(message, settings)

    service = RecapService(config, Store(config.data_dir), deliver=real_policy)
    with TestClient(create_app(config, service=service)) as client:
        created = client.post("/api/v1/recaps", json=body(), headers=KEY).json()
        failed = client.get(f"/api/v1/recaps/{created['id']}", headers=KEY).json()
    assert failed["status"] == "failed"
    assert failed["error"].startswith("Not sent: Recipient domain is not allowed")
    assert failed["attempts"] == 0


def test_only_a_failed_recap_can_be_retried(client, outbox):
    created = client.post("/api/v1/recaps", json=body(), headers=KEY).json()
    response = client.post(f"/api/v1/recaps/{created['id']}/retry", headers=KEY)
    assert response.status_code == 409
    assert response.json()["code"] == "NOT_RETRYABLE"
    assert len(outbox.messages) == 1


def test_unknown_ids_are_404(client):
    for method, path in [
        ("get", "/api/v1/recaps/nope"),
        ("get", "/api/v1/recaps/nope/document.pdf"),
        ("post", "/api/v1/recaps/nope/retry"),
    ]:
        response = getattr(client, method)(path, headers=KEY)
        assert response.status_code == 404, path
        assert response.json()["code"] == "RECAP_NOT_FOUND"


def test_render_returns_a_pdf_and_leaves_no_trace(client, outbox, config):
    response = client.post("/api/v1/render", json=body("02-aller-simple-minimal"), headers=KEY)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert 'filename="recapitulatif-2026-10-20.pdf"' in response.headers["content-disposition"]
    assert "Carcassonne" in PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
    assert outbox.messages == []
    assert list((config.data_dir / "documents").iterdir()) == []


def test_recipient_daily_limit(config, outbox):
    with make_client(replace(config, recipient_daily_limit=2), outbox) as client:
        codes = [
            client.post(
                "/api/v1/recaps", json=body(idempotency_key=f"limit-key-{n}"), headers=KEY
            ).status_code
            for n in range(3)
        ]
        other = body(idempotency_key="limit-key-other")
        other["recipient"]["email"] = "Autre@Example.fr"
        assert client.post("/api/v1/recaps", json=other, headers=KEY).status_code == 202
        # A repeat of an accepted request is still answered once the limit is reached.
        assert (
            client.post(
                "/api/v1/recaps", json=body(idempotency_key="limit-key-0"), headers=KEY
            ).status_code
            == 200
        )
    assert codes == [202, 202, 429]
    assert len(outbox.messages) == 3


def test_global_daily_limit(config, outbox):
    with make_client(replace(config, daily_limit=1), outbox) as client:
        first = client.post("/api/v1/recaps", json=body(), headers=KEY)
        other = body(idempotency_key="another-key-1")
        other["recipient"]["email"] = "autre@example.fr"
        second = client.post("/api/v1/recaps", json=other, headers=KEY)
    assert (first.status_code, second.status_code) == (202, 429)
    assert second.json()["code"] == "LIMIT_REACHED"
    assert len(outbox.messages) == 1


def test_concurrent_identical_requests_send_once(config, outbox):
    with make_client(config, outbox) as client:
        results = []

        def post():
            results.append(client.post("/api/v1/recaps", json=body(), headers=KEY))

        threads = [threading.Thread(target=post) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    assert sorted(r.status_code for r in results) == [200] * 5 + [202]
    assert len({r.json()["id"] for r in results}) == 1
    assert len(outbox.messages) == 1


def test_queued_jobs_are_sent_when_the_service_starts_again(config, outbox):
    store = Store(config.data_dir)
    stalled = RecapService(config, store, deliver=outbox)
    from sncf_bilan.models import RecapRequest

    recap, _ = stalled.submit(RecapRequest.model_validate(body()))  # accepted, never sent
    store.close()

    with make_client(config, outbox) as client:
        for _ in range(200):
            status = client.get(f"/api/v1/recaps/{recap.id}", headers=KEY).json()
            if status["status"] != "queued":
                break
            threading.Event().wait(0.01)
    assert status["status"] == "sent"
    assert len(outbox.messages) == 1


def test_expired_records_and_documents_are_purged(config, outbox):
    store = Store(config.data_dir)
    service = RecapService(config, store, deliver=outbox)
    from sncf_bilan.models import RecapRequest

    old, _ = service.submit(RecapRequest.model_validate(body(idempotency_key="old-request-1")))
    new, _ = service.submit(RecapRequest.model_validate(body(idempotency_key="new-request-1")))
    stamp = (datetime.now(UTC) - timedelta(days=31)).isoformat(timespec="seconds")
    with store._db:
        store._db.execute("UPDATE recaps SET created_at = ? WHERE id = ?", (stamp, old.id))

    assert store.purge(older_than_days=30) == 1
    assert store.get(old.id) is None and not store.pdf_path(old.id).exists()
    assert store.get(new.id) is not None and store.pdf_path(new.id).exists()


def test_service_refuses_to_start_misconfigured(config, tmp_path):
    with pytest.raises(ConfigurationError, match="BILAN_API_KEY"):
        create_app(replace(config, api_key=None))
    with pytest.raises(ConfigurationError, match="RESEND_API_KEY"):
        create_app(replace(config, mail_mode="live"))
    with pytest.raises(ConfigurationError, match="Logo file is missing"):
        create_app(replace(config, logo_png=tmp_path / "absent.png"))


def test_config_from_env_reads_secret_files_and_ignores_shell_mail_from(tmp_path):
    key_file = tmp_path / "key"
    key_file.write_text("file-key\n")
    config = Config.from_env(
        {
            "BILAN_API_KEY_FILE": str(key_file),
            "RESEND_API_KEY": "re_env",
            "MAIL_FROM": "Someone Else <other@example.com>",
            "BILAN_MAIL_MODE": "LIVE",
            "BILAN_ALLOWED_DOMAINS": "Example.fr, school.fr",
            "BILAN_ROOT_PATH": "/sncf-bilan/",
        }
    )
    assert config.api_key == "file-key"
    assert config.resend_api_key == "re_env"
    assert config.mail_from == "Sorties scolaires liO – démo <sorties@zhaoyang.fr>"
    assert config.mail_mode == "live"
    assert config.allowed_domains == ("example.fr", "school.fr")
    assert config.root_path == "/sncf-bilan"
    assert "file-key" not in repr(config) and "re_env" not in repr(config)
    with pytest.raises(ConfigurationError):
        Config.from_env({"BILAN_MAIL_MODE": "send-everything"})
    with pytest.raises(ConfigurationError):
        Config.from_env({"BILAN_DAILY_LIMIT": "many"})


def test_credentials_file_completes_the_environment_and_the_shell_wins(tmp_path, monkeypatch):
    from sncf_bilan.config import read_credentials_file

    file = tmp_path / "credentials.env"
    file.write_text(
        "# comment\n\nBILAN_API_KEY=from-file\nexport RESEND_API_KEY='re_file'\n"
        'BILAN_MAIL_MODE="live"\nBILAN_REPLY_TO=contact@example.fr # not a comment\n'
        "BILAN_DAILY_LIMIT=$(rm -rf /)\n"
    )
    values = read_credentials_file(file)
    assert values["RESEND_API_KEY"] == "re_file"
    assert values["BILAN_MAIL_MODE"] == "live"
    assert values["BILAN_DAILY_LIMIT"] == "$(rm -rf /)"  # literal text, never executed

    file.write_text("BILAN_API_KEY=from-file\nRESEND_API_KEY=re_file\nBILAN_MAIL_MODE=live\n")
    monkeypatch.setenv("BILAN_CREDENTIALS_FILE", str(file))
    monkeypatch.setenv("BILAN_API_KEY", "from-shell")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("BILAN_MAIL_MODE", raising=False)
    config = Config.from_env()
    assert (config.api_key, config.resend_api_key, config.mail_mode) == (
        "from-shell",
        "re_file",
        "live",
    )

    file.write_text("this is not an assignment\n")
    with pytest.raises(ConfigurationError, match="line 1"):
        Config.from_env()
    monkeypatch.setenv("BILAN_CREDENTIALS_FILE", str(tmp_path / "absent.env"))
    with pytest.raises(ConfigurationError, match="does not exist"):
        Config.from_env()
