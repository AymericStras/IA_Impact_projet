"""Fixtures : fabrique de patches, horloge figée, application avec fournisseur factice et SQLite temporaire."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_clock, get_extraction_provider, get_transcription_provider
from app.core.config import Settings
from app.domain.clock import FixedClock
from app.main import create_app
from app.schemas.patch import (
    Ambiguity,
    AmbiguityKind,
    Conflict,
    FieldName,
    Operation,
    PartialDateTimePatch,
    ParticipantsMentioned,
    RequirementPatch,
    TeachingTypePatch,
    UserIntent,
)
from app.services.providers.fake_provider import FakeProvider

TODAY = date(2026, 10, 10)  # samedi


def dt(
    date_: str | None = None, time_: str | None = None, constraint: str | None = None
) -> PartialDateTimePatch:
    return PartialDateTimePatch(date=date_, time=time_, constraint=constraint)  # type: ignore[arg-type]


def tt(subject: str | None = None, theme: str | None = None) -> TeachingTypePatch:
    return TeachingTypePatch(subject=subject, theme=theme)


def op(field: FieldName, value: object, operation: str = "set", evidence: str = "…") -> Operation:
    return Operation(field=field, operation=operation, value=value, evidence=evidence)  # type: ignore[arg-type]


def mk_patch(
    *ops: Operation,
    intent: UserIntent = UserIntent.PROVIDE_INFORMATION,
    students: int | None = None,
    accompanying: int | None = None,
    total: int | None = None,
    ambiguities: list[tuple[FieldName, AmbiguityKind]] | None = None,
    conflicts: list[FieldName] | None = None,
) -> RequirementPatch:
    return RequirementPatch(
        user_intent=intent,
        operations=list(ops),
        participants_mentioned=ParticipantsMentioned(
            students=students, accompanying=accompanying, total_stated=total
        ),
        ambiguities=[Ambiguity(field=f, kind=k, detail="test") for f, k in (ambiguities or [])],
        conflicts=[Conflict(field=f, evidence="test") for f in (conflicts or [])],
    )


COMPLETE_PATCH = mk_patch(
    op("departure", dt("2026-11-12", "08:00", "approximate")),
    op("return", dt("2026-11-12", "17:00", "latest")),
    op("teaching_type", tt("Histoire", "Moyen Âge")),
    students=27,
    accompanying=3,
)


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock(TODAY)


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def client(tmp_path: Path, clock: FixedClock, provider: FakeProvider) -> Iterator[TestClient]:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}", openai_api_key=None, rate_limit_per_minute=1000
    )
    app = create_app(settings)
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_extraction_provider] = lambda: provider
    app.dependency_overrides[get_transcription_provider] = lambda: provider
    with TestClient(app) as test_client:
        yield test_client
