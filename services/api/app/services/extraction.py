"""Construction du prompt d'extraction et appel du fournisseur."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.domain.clock import PARIS, Clock, weekday_fr
from app.schemas.conversation import Message
from app.schemas.patch import RequirementPatch
from app.schemas.requirements import PartialRequirements
from app.services.providers.base import ExtractionProvider

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"
RECENT_MESSAGES = 8


@lru_cache
def load_system_prompt(name: str = "extract_requirements.md") -> str:
    """Le prompt est la partie du fichier Markdown comprise entre les deux premiers séparateurs `---`."""
    text = (PROMPTS_DIR / name).read_text(encoding="utf-8")
    parts = text.split("\n---\n")
    if len(parts) < 3:
        raise ValueError(f"{name}: séparateurs '---' attendus autour du prompt système")
    return parts[1].strip()


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
        return self._provider.extract(
            system_prompt=self.system_prompt(),
            user_content=build_user_content(message, requirements, recent),
        )
