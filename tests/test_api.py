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
