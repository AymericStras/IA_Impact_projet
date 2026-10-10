"""AI provider interfaces. The rest of the code depends only on these protocols."""

from __future__ import annotations

from typing import Protocol

from app.schemas.patch import RequirementPatch


class ProviderError(Exception):
    """Provider failure (network, quota, refusal, invalid output). The state is not modified."""

    def __init__(self, message: str, *, timeout: bool = False) -> None:
        super().__init__(message)
        self.timeout = timeout


class ExtractionProvider(Protocol):
    def extract(self, *, system_prompt: str, user_content: str) -> RequirementPatch: ...


class TranscriptionProvider(Protocol):
    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str: ...
