"""The full conversation flow on PostgreSQL. Skipped unless TEST_POSTGRES_URL is set, e.g.

docker compose up -d db
TEST_POSTGRES_URL=postgresql+psycopg://sncf:sncf@localhost:5433/sncf_chatbot uv run pytest tests/test_postgres.py
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_clock, get_extraction_provider, get_transcription_provider
from app.core.config import Settings
from app.domain.clock import FixedClock
from app.main import create_app
from app.schemas.patch import UserIntent
from app.services.providers.fake_provider import FakeProvider
from tests.conftest import COMPLETE_PATCH, TODAY, mk_patch, op

POSTGRES_URL = os.environ.get("TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="TEST_POSTGRES_URL not set")

FULL = "27 élèves et 3 accompagnateurs, le 12 novembre 2026 vers 8 h, retour avant 17 h, histoire, Moyen Âge"


@pytest.fixture
def pg_client() -> Iterator[tuple[TestClient, FakeProvider]]:
    provider = FakeProvider()
    app = create_app(Settings(_env_file=None, database_url=POSTGRES_URL or ""))
    app.dependency_overrides[get_clock] = lambda: FixedClock(TODAY)
    app.dependency_overrides[get_extraction_provider] = lambda: provider
    app.dependency_overrides[get_transcription_provider] = lambda: provider
    with TestClient(app) as client:
        yield client, provider


def test_full_flow_on_postgres(pg_client: tuple[TestClient, FakeProvider]) -> None:
    client, provider = pg_client
    cid = client.post("/api/v1/conversations", json={}).json()["conversation_id"]
    base = f"/api/v1/conversations/{cid}"
    message_id = uuid.uuid4().hex

    provider.queue(COMPLETE_PATCH)
    body = {"content": FULL, "client_message_id": message_id}
    first = client.post(f"{base}/messages", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["state"] == "AWAITING_CONFIRMATION"
    # Idempotent replay and conflicting reuse.
    assert client.post(f"{base}/messages", json=body).json() == first.json()
    assert (
        client.post(f"{base}/messages", json={**body, "content": "autre"}).json()["code"]
        == "IDEMPOTENCY_CONFLICT"
    )

    provider.queue(
        mk_patch(op("participants_count", 32, "replace"), intent=UserIntent.CORRECT_INFORMATION, total=32)
    )
    corrected = client.post(
        f"{base}/messages",
        json={"content": "Finalement, nous serons 32.", "client_message_id": uuid.uuid4().hex},
    ).json()
    assert corrected["requirements"]["participants_count"] == 32
    assert corrected["requirements"]["participants_breakdown"] is None

    edited = client.patch(
        f"{base}/requirements",
        json={
            "field": "return",
            "value": {"date": "2026-11-12", "time": "18:00", "constraint": "latest"},
            "expected_version": corrected["version"],
        },
    ).json()
    assert edited["requirements"]["return"]["time"] == "18:00"
    assert client.post(f"{base}/confirm", json={"expected_version": corrected["version"]}).status_code == 409

    confirmed = client.post(f"{base}/confirm", json={"expected_version": edited["version"]}).json()
    assert confirmed["state"] == "CONFIRMED"
    exported = client.get(f"{base}/export").json()
    assert exported["requirements"]["participants_count"] == 32
    assert exported["confirmed_at"].endswith("+02:00")  # timezone survives the round trip

    restored = client.get(base).json()
    assert restored["state"] == "CONFIRMED" and len(restored["messages"]) == len(confirmed["messages"])
    assert all(m["created_at"].endswith("+02:00") for m in restored["messages"])
