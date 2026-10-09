"""Interfaces des fournisseurs d'IA. Le reste du code ne dépend que de ces protocoles."""

from __future__ import annotations

from typing import Protocol

from app.schemas.patch import RequirementPatch


class ProviderError(Exception):
    """Échec du fournisseur (réseau, quota, refus, sortie invalide). L'état n'est pas modifié."""

    def __init__(self, message: str, *, timeout: bool = False) -> None:
        super().__init__(message)
        self.timeout = timeout


class ExtractionProvider(Protocol):
    def extract(self, *, system_prompt: str, user_content: str) -> RequirementPatch: ...


class TranscriptionProvider(Protocol):
    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str: ...
