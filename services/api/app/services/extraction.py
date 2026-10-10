"""Builds the extraction prompt, calls the provider and verifies the evidence of every operation."""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from app.domain.clock import PARIS, Clock, weekday_fr
from app.schemas.conversation import Message
from app.schemas.patch import RequirementPatch
from app.schemas.requirements import PartialRequirements
from app.services.providers.base import ExtractionProvider, ProviderError

log = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"
RECENT_MESSAGES = 8

_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "ʼ": "'", "`": "'", " ": " ", " ": " "})
_EDGE = " \t\n«»\"“”'.,;:!?()"
_ELLIPSIS = re.compile(r"\s*(?:…|\.{3})\s*")


@lru_cache
def load_system_prompt(name: str = "extract_requirements.md") -> str:
    """The prompt is the part of the Markdown file between the first two `---` separators."""
    text = (PROMPTS_DIR / name).read_text(encoding="utf-8")
    parts = text.split("\n---\n")
    if len(parts) < 3:
        raise ValueError(f"{name}: '---' separators expected around the system prompt")
    return parts[1].strip()


@lru_cache
def load_transcription_context() -> str:
    return (PROMPTS_DIR / "transcription_context.txt").read_text(encoding="utf-8").strip()


def _normalize(text: str) -> str:
    """Typography-insensitive form: transcripts use curly apostrophes and non-breaking spaces."""
    text = unicodedata.normalize("NFKC", text).translate(_APOSTROPHES).casefold()
    return " ".join(text.split())


def evidence_supported(evidence: str, message: str) -> bool:
    """True when every fragment of `evidence` is a verbatim quote of the teacher's message."""
    haystack = _normalize(message)
    fragments = [_normalize(part).strip(_EDGE) for part in _ELLIPSIS.split(evidence)]
    fragments = [fragment for fragment in fragments if fragment]
    return bool(fragments) and all(fragment in haystack for fragment in fragments)


def unsupported_operations(patch: RequirementPatch, message: str) -> list[str]:
    return [op.field for op in patch.operations if not evidence_supported(op.evidence, message)]


def describe_patch(patch: RequirementPatch) -> str:
    """Shape of a patch for the logs: fields, operations and which parts are filled — never the text."""
    operations = []
    for op in patch.operations:
        value = op.value
        if value is None or isinstance(value, int | str):
            shape = "null" if value is None else type(value).__name__
        else:
            shape = "+".join(name for name, part in value.model_dump().items() if part is not None) or "empty"
        operations.append(f"{op.field}:{op.operation}:{shape}")
    ambiguities = [f"{a.field}:{a.kind.value}" for a in patch.ambiguities]
    conflicts = [c.field for c in patch.conflicts]
    return (
        f"intent={patch.user_intent.value} ops={operations} ambiguities={ambiguities} conflicts={conflicts}"
    )


def build_user_content(message: str, requirements: PartialRequirements, recent: list[Message]) -> str:
    history = "\n".join(f"{m.role}: {m.content}" for m in recent[-RECENT_MESSAGES:]) or "(aucun)"
    current = json.dumps(requirements.model_dump(mode="json", by_alias=True), ensure_ascii=False)
    return f"CURRENT REQUIREMENTS (JSON): {current}\nRECENT CONVERSATION (oldest first):\n{history}\nTEACHER MESSAGE: {message}"


class ExtractionService:
    def __init__(self, provider: ExtractionProvider, clock: Clock) -> None:
        self._provider = provider
        self._clock = clock

    def system_prompt(self) -> str:
        now = self._clock.now().astimezone(PARIS)
        return (
            load_system_prompt()
            .replace("{{now_paris}}", now.strftime("%Y-%m-%d %H:%M"))
            .replace("{{weekday_fr}}", weekday_fr(now.date()))
        )

    def extract(
        self, message: str, requirements: PartialRequirements, recent: list[Message]
    ) -> RequirementPatch:
        """An operation whose evidence is not a quote of the message is an unsupported fill (AGENTS.md §3.3).

        The model gets one more attempt; a second failure is a provider error and nothing is applied.
        """
        system_prompt = self.system_prompt()
        user_content = build_user_content(message, requirements, recent)
        for attempt in (1, 2):
            patch = self._provider.extract(system_prompt=system_prompt, user_content=user_content)
            log.info("patch %s", describe_patch(patch))
            unsupported = unsupported_operations(patch, message)
            if not unsupported:
                return patch
            log.warning("extraction evidence rejected attempt=%s fields=%s", attempt, unsupported)
        raise ProviderError(
            "Une modification proposée ne peut pas être reliée au message.", code="INVALID_EVIDENCE"
        )
