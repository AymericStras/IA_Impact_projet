"""Bridge for `evals/evaluate.py`: one extraction + merge turn without a database."""

from __future__ import annotations

from datetime import date
from functools import lru_cache
from typing import Any

from app.core.config import get_settings
from app.domain.clock import FixedClock
from app.domain.pipeline import process_turn
from app.schemas.conversation import ConversationState, Message
from app.schemas.requirements import PartialRequirements
from app.services.extraction import ExtractionService
from app.services.providers.openai_provider import OpenAIProvider


@lru_cache
def _provider(model: str | None) -> OpenAIProvider:
    settings = get_settings()
    return OpenAIProvider(
        api_key=settings.resolved_openai_api_key,
        extraction_model=model or settings.extraction_model,
        transcription_model=settings.transcription_model,
        timeout_seconds=settings.llm_timeout_seconds,
        reasoning_effort=settings.extraction_reasoning_effort,
    )


def run_turn(
    state: dict[str, Any],
    message: str,
    today: str,
    model: str | None = None,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    clock = FixedClock(date.fromisoformat(today))
    requirements = PartialRequirements.model_validate(state or {})
    extraction = ExtractionService(_provider(model), clock)
    recent = [
        Message(id=f"h{i}", role=h["role"], content=h["content"], created_at="")
        for i, h in enumerate(history or [])
    ]
    patch = extraction.extract(message, requirements, recent)
    result = process_turn(ConversationState.COLLECTING, requirements, patch, clock.now().date())
    return {
        "patch": patch.model_dump(mode="json"),
        "merged": result.requirements.model_dump(mode="json", by_alias=True),
        "missing_fields": list(result.validation.missing_fields),
        "state": result.decision.state.value,
        "assistant_message": result.assistant_message,
    }
