import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sncf_rapport.api import create_app
from sncf_rapport.config import Config

EXAMPLES = Path(__file__).resolve().parents[1] / "contracts" / "examples"
FULL = json.loads((EXAMPLES / "01-carcassonne-complet.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def client():
    return TestClient(create_app(Config(api_key="secret")))


AUTH = {"X-Rapport-Key": "secret"}


def test_health_is_open(client):
    assert client.get("/healthz").json()["status"] == "ok"


def test_key_is_required(client):
    assert client.post("/api/v1/render", json=FULL).status_code == 401
    assert client.post("/api/v1/check", json={}, headers={"X-Rapport-Key": "no"}).status_code == 401


def test_no_key_configured_means_open():
    open_client = TestClient(create_app(Config(api_key=None)))
    assert open_client.post("/api/v1/check", json={}).status_code == 200


def test_render_returns_pdf_and_gap_headers(client):
    response = client.post("/api/v1/render", json=FULL, headers=AUTH)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert response.headers["x-rapport-missing-major-count"] == "0"
    assert "trip.outbound.train_number" in response.headers["x-rapport-missing-minor"]
    assert "rapport-SIM-050033B9.pdf" in response.headers["content-disposition"]


def test_empty_request_renders_and_reports_major_gaps(client):
    response = client.post("/api/v1/render", json={}, headers=AUTH)
    assert response.status_code == 200 and response.content.startswith(b"%PDF")
    assert int(response.headers["x-rapport-missing-major-count"]) >= 8
    assert "school.name" in response.headers["x-rapport-missing-major"]


def test_check_lists_gaps_without_rendering(client):
    body = client.post("/api/v1/check", json={}, headers=AUTH).json()
    assert body["major"] >= 8
    assert {"field", "severity", "effect"} == set(body["gaps"][0])
    assert any(gap["field"] == "teacher_feedback" for gap in body["gaps"])


def test_invalid_value_is_422(client):
    bad = json.loads((EXAMPLES / "90-invalide-valeurs-inconnues.json").read_text(encoding="utf-8"))
    assert client.post("/api/v1/render", json=bad, headers=AUTH).status_code == 422


def test_oversized_body_is_413():
    small = TestClient(create_app(Config(api_key=None, max_body_bytes=10)))
    assert small.post("/api/v1/check", json={"school": {"name": "x" * 50}}).status_code == 413


def test_photo_path_is_ignored_over_http(client, tmp_path):
    from fuzzgen import png

    picture = tmp_path / "p.png"
    picture.write_bytes(png(40, 30))
    body = {"media": {"photos": [{"path": str(picture), "consent": True, "caption": "x"}]}}
    gaps = client.post("/api/v1/check", json=body, headers=AUTH).json()["gaps"]
    assert any(gap["field"].startswith("media.photos[0]") for gap in gaps)
    response = client.post("/api/v1/render", json=body, headers=AUTH)
    assert response.status_code == 200
    import io

    from pypdf import PdfReader

    text = "".join(page.extract_text() for page in PdfReader(io.BytesIO(response.content)).pages)
    assert "Photos du voyage" not in text


def test_render_reports_enrich_status(client):
    response = client.post("/api/v1/render", json=FULL, headers=AUTH)
    assert response.headers["x-rapport-enrich"] in ("no_key", "cached", "existing")
    off = client.post("/api/v1/render?enrich=off", json=FULL, headers=AUTH)
    assert off.headers["x-rapport-enrich"] == "off"
    body = client.post("/api/v1/enrich", json=FULL, headers=AUTH).json()
    assert body["outcome"]["status"] in ("no_key", "cached")
    assert body["request"]["trip"]["reference"] == "SIM-050033B9"


# --------------------------------------------------------------------------- sending


class Outbox:
    """Stands in for the mail provider; outcomes are scripted per call."""

    def __init__(self):
        self.messages = []
        self.outcomes = []

    def __call__(self, message, config, *, report_id):
        self.messages.append((report_id, message))
        outcome = self.outcomes.pop(0) if self.outcomes else None
        if isinstance(outcome, Exception):
            raise outcome
        from sncf_rapport.mail.deliver import Delivery

        return Delivery("resend", f"email_{len(self.messages)}", 1)


@pytest.fixture
def outbox():
    return Outbox()


@pytest.fixture
def mail_config(tmp_path):
    return Config(api_key="secret", data_dir=tmp_path, enrich_mode="off")


def make_client(config, outbox):
    from sncf_rapport.service import ReportService
    from sncf_rapport.store import Store

    service = ReportService(config, Store(config.data_dir), deliver=outbox)
    return TestClient(create_app(config, service=service))


@pytest.fixture
def mail_client(mail_config, outbox):
    with make_client(mail_config, outbox) as test_client:
        yield test_client


def addressed(**top):
    data = json.loads(json.dumps(FULL))
    data.get("education", {}).pop("insights", None)
    data.update(top)
    return data


def test_health_reveals_the_mail_mode(mail_client):
    assert mail_client.get("/healthz").json()["mail_mode"] == "dry-run"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/v1/reports"),
        ("get", "/api/v1/reports/some-id"),
        ("get", "/api/v1/reports/some-id/document.pdf"),
        ("post", "/api/v1/reports/some-id/retry"),
    ],
)
def test_report_routes_need_the_key(mail_client, outbox, method, path):
    kwargs = {"json": addressed()} if method == "post" else {}
    response = getattr(mail_client, method)(path, headers={"X-Rapport-Key": "wrong"}, **kwargs)
    assert response.status_code == 401
    assert outbox.messages == []


def test_report_is_rendered_recorded_and_sent(mail_client, outbox):
    response = mail_client.post("/api/v1/reports", json=addressed(), headers=AUTH)
    assert response.status_code == 202
    created = response.json()
    assert created["status"] == "queued"
    assert created["recipient"] == "destinataire@example.fr"
    assert response.headers["x-rapport-missing-major-count"] == "0"
    assert response.headers["x-rapport-enrich"] == "off"

    # The background task has run by the time the test client returns.
    status = mail_client.get(f"/api/v1/reports/{created['id']}", headers=AUTH).json()
    assert (status["status"], status["provider"], status["provider_message_id"]) == (
        "sent",
        "resend",
        "email_1",
    )
    assert status["attempts"] == 1 and status["error"] is None

    report_id, message = outbox.messages[0]
    assert report_id == created["id"]
    assert list(message.to) == ["destinataire@example.fr"]
    assert message.attachments[0].filename == "rapport-SIM-050033B9.pdf"

    document = mail_client.get(f"/api/v1/reports/{created['id']}/document.pdf", headers=AUTH)
    assert document.status_code == 200
    assert document.headers["content-type"] == "application/pdf"
    assert "rapport-SIM-050033B9.pdf" in document.headers["content-disposition"]
    assert document.content == message.attachments[0].content
    assert document.content.startswith(b"%PDF")


def test_no_recipient_is_refused_with_a_clear_message_and_nothing_stored(
    mail_client, outbox, mail_config
):
    body = addressed()
    del body["recipient"]
    response = mail_client.post("/api/v1/reports", json=body, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["code"] == "NO_RECIPIENT"
    assert "recipient.email" in response.json()["detail"]
    assert outbox.messages == []
    assert list((mail_config.data_dir / "documents").iterdir()) == []
    # The same body still renders.
    assert mail_client.post("/api/v1/render", json=body, headers=AUTH).status_code == 200
    gaps = mail_client.post("/api/v1/check", json=body, headers=AUTH).json()["gaps"]
    assert any(g["field"] == "recipient.email" and g["severity"] == "major" for g in gaps)


def test_repeating_a_request_does_not_send_twice(mail_client, outbox):
    first = mail_client.post("/api/v1/reports", json=addressed(), headers=AUTH)
    again = mail_client.post("/api/v1/reports", json=addressed(), headers=AUTH)
    assert (first.status_code, again.status_code) == (202, 200)
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["status"] == "sent"
    assert len(outbox.messages) == 1


def test_same_key_with_other_content_is_a_conflict(mail_client, outbox):
    mail_client.post("/api/v1/reports", json=addressed(idempotency_key="trip-8841"), headers=AUTH)
    changed = addressed(idempotency_key="trip-8841")
    changed["school"]["class_name"] = "CM1"
    response = mail_client.post("/api/v1/reports", json=changed, headers=AUTH)
    assert response.status_code == 409
    assert response.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert len(outbox.messages) == 1


def test_changed_content_without_a_key_is_a_new_report(mail_client, outbox):
    mail_client.post("/api/v1/reports", json=addressed(), headers=AUTH)
    changed = addressed()
    changed["school"]["class_name"] = "CM1"
    assert mail_client.post("/api/v1/reports", json=changed, headers=AUTH).status_code == 202
    assert len(outbox.messages) == 2


def test_invalid_value_gets_422_and_nothing_is_sent(mail_client, outbox):
    bad = json.loads((EXAMPLES / "90-invalide-valeurs-inconnues.json").read_text(encoding="utf-8"))
    assert mail_client.post("/api/v1/reports", json=bad, headers=AUTH).status_code == 422
    assert outbox.messages == []


def test_provider_refusal_is_recorded_and_can_be_retried(mail_client, outbox):
    from mailato import api as mailato

    refusal = mailato.ResendAPIError(403, "validation_error", "domain is not verified")
    refusal.attempts = 1
    outbox.outcomes = [refusal]
    created = mail_client.post("/api/v1/reports", json=addressed(), headers=AUTH).json()

    failed = mail_client.get(f"/api/v1/reports/{created['id']}", headers=AUTH).json()
    assert failed["status"] == "failed"
    assert "domain is not verified" in failed["error"]
    assert failed["attempts"] == 1

    retried = mail_client.post(f"/api/v1/reports/{created['id']}/retry", headers=AUTH)
    assert retried.status_code == 202
    final = mail_client.get(f"/api/v1/reports/{created['id']}", headers=AUTH).json()
    assert (final["status"], final["error"], final["attempts"]) == ("sent", None, 2)
    # Same report id both times: the provider sees the same idempotency key.
    assert [report_id for report_id, _ in outbox.messages] == [created["id"]] * 2


def test_unexpected_failure_ends_in_a_failed_state_without_leaking_details(mail_client, outbox):
    outbox.outcomes = [RuntimeError("secret internal detail")]
    created = mail_client.post("/api/v1/reports", json=addressed(), headers=AUTH).json()
    failed = mail_client.get(f"/api/v1/reports/{created['id']}", headers=AUTH).json()
    assert failed["status"] == "failed"
    assert failed["error"] == "Internal error: RuntimeError"


def test_refused_recipient_domain_is_recorded_as_not_sent(mail_config, outbox):
    from mailato import api as mailato

    def real_policy(message, cfg, *, report_id):
        settings = mailato.Settings(
            mail_from=cfg.mail_from, resend_api_key="re_test", allowed_domains=["school.fr"]
        )
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(mailato, "post_email", lambda *a, **k: pytest.fail("must not send"))
            mailato.send(message, settings)

    with make_client(mail_config, real_policy) as client:
        created = client.post("/api/v1/reports", json=addressed(), headers=AUTH).json()
        failed = client.get(f"/api/v1/reports/{created['id']}", headers=AUTH).json()
    assert failed["status"] == "failed"
    assert failed["error"].startswith("Not sent: Recipient domain is not allowed")
    assert failed["attempts"] == 0


def test_only_a_failed_report_can_be_retried(mail_client, outbox):
    created = mail_client.post("/api/v1/reports", json=addressed(), headers=AUTH).json()
    response = mail_client.post(f"/api/v1/reports/{created['id']}/retry", headers=AUTH)
    assert response.status_code == 409
    assert response.json()["code"] == "NOT_RETRYABLE"
    assert len(outbox.messages) == 1


def test_unknown_ids_are_404(mail_client):
    for method, path in [
        ("get", "/api/v1/reports/nope"),
        ("get", "/api/v1/reports/nope/document.pdf"),
        ("post", "/api/v1/reports/nope/retry"),
    ]:
        response = getattr(mail_client, method)(path, headers=AUTH)
        assert response.status_code == 404, path
        assert response.json()["code"] == "REPORT_NOT_FOUND"


def test_render_leaves_no_trace(mail_client, outbox, mail_config):
    response = mail_client.post("/api/v1/render", json=addressed(), headers=AUTH)
    assert response.status_code == 200
    assert outbox.messages == []
    assert list((mail_config.data_dir / "documents").iterdir()) == []


def test_recipient_daily_limit(mail_config, outbox):
    from dataclasses import replace

    with make_client(replace(mail_config, recipient_daily_limit=2), outbox) as client:
        codes = [
            client.post(
                "/api/v1/reports", json=addressed(idempotency_key=f"limit-key-{n}"), headers=AUTH
            ).status_code
            for n in range(3)
        ]
        other = addressed(idempotency_key="limit-key-other")
        other["recipient"]["email"] = "Autre@Example.fr"
        assert client.post("/api/v1/reports", json=other, headers=AUTH).status_code == 202
        # A repeat of an accepted request is still answered once the limit is reached.
        assert (
            client.post(
                "/api/v1/reports", json=addressed(idempotency_key="limit-key-0"), headers=AUTH
            ).status_code
            == 200
        )
    assert codes == [202, 202, 429]
    assert len(outbox.messages) == 3


def test_global_daily_limit(mail_config, outbox):
    from dataclasses import replace

    with make_client(replace(mail_config, daily_limit=1), outbox) as client:
        first = client.post("/api/v1/reports", json=addressed(), headers=AUTH)
        other = addressed(idempotency_key="another-key-1")
        other["recipient"]["email"] = "autre@example.fr"
        second = client.post("/api/v1/reports", json=other, headers=AUTH)
    assert (first.status_code, second.status_code) == (202, 429)
    assert second.json()["code"] == "LIMIT_REACHED"
    assert len(outbox.messages) == 1


def test_concurrent_identical_requests_send_once(mail_config, outbox):
    import threading

    with make_client(mail_config, outbox) as client:
        results = []

        def post():
            results.append(client.post("/api/v1/reports", json=addressed(), headers=AUTH))

        threads = [threading.Thread(target=post) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    assert sorted(r.status_code for r in results) == [200] * 5 + [202]
    assert len({r.json()["id"] for r in results}) == 1
    assert len(outbox.messages) == 1


def test_queued_jobs_are_sent_when_the_service_starts_again(mail_config, outbox):
    import threading

    from sncf_rapport.models import TripReportRequest
    from sncf_rapport.service import ReportService
    from sncf_rapport.store import Store

    store = Store(mail_config.data_dir)
    stalled = ReportService(mail_config, store, deliver=outbox)
    report, _ = stalled.submit(TripReportRequest.model_validate(addressed()))  # never sent
    store.close()

    with make_client(mail_config, outbox) as client:
        for _ in range(200):
            status = client.get(f"/api/v1/reports/{report.id}", headers=AUTH).json()
            if status["status"] != "queued":
                break
            threading.Event().wait(0.01)
    assert status["status"] == "sent"
    assert len(outbox.messages) == 1


def test_expired_records_and_documents_are_purged(mail_config, outbox):
    from datetime import UTC, datetime, timedelta

    from sncf_rapport.models import TripReportRequest
    from sncf_rapport.service import ReportService
    from sncf_rapport.store import Store

    store = Store(mail_config.data_dir)
    service = ReportService(mail_config, store, deliver=outbox)
    old, _ = service.submit(
        TripReportRequest.model_validate(addressed(idempotency_key="old-request-1"))
    )
    new, _ = service.submit(
        TripReportRequest.model_validate(addressed(idempotency_key="new-request-1"))
    )
    stamp = (datetime.now(UTC) - timedelta(days=31)).isoformat(timespec="seconds")
    with store._db:
        store._db.execute("UPDATE reports SET created_at = ? WHERE id = ?", (stamp, old.id))

    assert store.purge(older_than_days=30) == 1
    assert store.get(old.id) is None and not store.pdf_path(old.id).exists()
    assert store.get(new.id) is not None and store.pdf_path(new.id).exists()


def test_live_mode_refuses_to_start_without_keys(mail_config):
    from dataclasses import replace

    from sncf_rapport.config import ConfigurationError

    with pytest.raises(ConfigurationError, match="RESEND_API_KEY"):
        create_app(replace(mail_config, mail_mode="live"))
    with pytest.raises(ConfigurationError, match="RAPPORT_API_KEY"):
        create_app(replace(mail_config, mail_mode="live", resend_api_key="re_x", api_key=None))


def test_config_from_env_reads_mail_settings(tmp_path):
    from sncf_rapport.config import ConfigurationError

    key_file = tmp_path / "key"
    key_file.write_text("file-key\n")
    config = Config.from_env(
        {
            "RAPPORT_API_KEY_FILE": str(key_file),
            "RESEND_API_KEY": "re_env",
            "MAIL_FROM": "Someone Else <other@example.com>",
            "RAPPORT_MAIL_MODE": "LIVE",
            "RAPPORT_ALLOWED_DOMAINS": "Example.fr, school.fr",
            "RAPPORT_RECIPIENT_DAILY_LIMIT": "2",
        }
    )
    assert config.api_key == "file-key"
    assert config.resend_api_key == "re_env"
    assert config.mail_from == "Sorties scolaires liO – démo <sorties@zhaoyang.fr>"
    assert config.mail_mode == "live"
    assert config.allowed_domains == ("example.fr", "school.fr")
    assert config.recipient_daily_limit == 2
    assert "file-key" not in repr(config) and "re_env" not in repr(config)
    with pytest.raises(ConfigurationError):
        Config.from_env({"RAPPORT_MAIL_MODE": "send-everything"})
    with pytest.raises(ConfigurationError):
        Config.from_env({"RAPPORT_DAILY_LIMIT": "many"})


def test_credentials_file_completes_the_environment_and_the_shell_wins(tmp_path, monkeypatch):
    from sncf_rapport.config import ConfigurationError, read_credentials_file

    file = tmp_path / "credentials.env"
    file.write_text(
        "# comment\n\nRAPPORT_API_KEY=from-file\nexport RESEND_API_KEY='re_file'\n"
        'RAPPORT_MAIL_MODE="live"\nRAPPORT_DAILY_LIMIT=$(rm -rf /)\n'
    )
    values = read_credentials_file(file)
    assert values["RESEND_API_KEY"] == "re_file"
    assert values["RAPPORT_MAIL_MODE"] == "live"
    assert values["RAPPORT_DAILY_LIMIT"] == "$(rm -rf /)"  # literal text, never executed

    file.write_text("RAPPORT_API_KEY=from-file\nRESEND_API_KEY=re_file\nRAPPORT_MAIL_MODE=live\n")
    monkeypatch.setenv("RAPPORT_CREDENTIALS_FILE", str(file))
    monkeypatch.setenv("RAPPORT_API_KEY", "from-shell")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("RAPPORT_MAIL_MODE", raising=False)
    config = Config.from_env()
    assert (config.api_key, config.resend_api_key, config.mail_mode) == (
        "from-shell",
        "re_file",
        "live",
    )

    file.write_text("this is not an assignment\n")
    with pytest.raises(ConfigurationError, match="line 1"):
        Config.from_env()
    monkeypatch.setenv("RAPPORT_CREDENTIALS_FILE", str(tmp_path / "absent.env"))
    with pytest.raises(ConfigurationError, match="does not exist"):
        Config.from_env()
