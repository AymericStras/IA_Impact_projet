"""FastAPI dependencies (overridable in tests)."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Iterator
from functools import lru_cache

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.domain.clock import Clock, SystemClock
from app.services.conversation import ConversationService
from app.services.extraction import ExtractionService
from app.services.providers.base import ExtractionProvider, TranscriptionProvider
from app.services.providers.openai_provider import OpenAIProvider


def get_clock() -> Clock:
    return SystemClock()


@lru_cache
def _openai_provider(
    api_key: str | None, extraction_model: str, transcription_model: str, timeout: float, effort: str
) -> OpenAIProvider:
    return OpenAIProvider(
        api_key=api_key,
        extraction_model=extraction_model,
        transcription_model=transcription_model,
        timeout_seconds=timeout,
        reasoning_effort=effort,
    )


def get_extraction_provider(settings: Settings = Depends(get_settings)) -> ExtractionProvider:
    return _openai_provider(
        settings.openai_api_key,
        settings.extraction_model,
        settings.transcription_model,
        settings.llm_timeout_seconds,
        settings.extraction_reasoning_effort,
    )


def get_transcription_provider(settings: Settings = Depends(get_settings)) -> TranscriptionProvider:
    return _openai_provider(
        settings.openai_api_key,
        settings.extraction_model,
        settings.transcription_model,
        settings.llm_timeout_seconds,
        settings.extraction_reasoning_effort,
    )


def get_session(request: Request) -> Iterator[Session]:
    session: Session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()


def get_service(
    session: Session = Depends(get_session),
    extraction: ExtractionProvider = Depends(get_extraction_provider),
    transcription: TranscriptionProvider = Depends(get_transcription_provider),
    clock: Clock = Depends(get_clock),
) -> ConversationService:
    return ConversationService(session, ExtractionService(extraction, clock), transcription, clock)


class RateLimiter:
    """Simple in-memory per-conversation limit (one-minute sliding window)."""

    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= self.per_minute:
            return False
        hits.append(now)
        return True


def get_rate_limiter(request: Request) -> RateLimiter:
    limiter: RateLimiter = request.app.state.rate_limiter
    return limiter
