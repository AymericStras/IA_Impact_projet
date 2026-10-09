"""Fournisseur factice pour les tests : patches scriptés, erreurs à la demande."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable

from app.schemas.patch import RequirementPatch
from app.services.providers.base import ProviderError

PatchFactory = Callable[[str], RequirementPatch]


class FakeProvider:
    def __init__(
        self,
        patches: list[RequirementPatch] | None = None,
        *,
        factory: PatchFactory | None = None,
        transcript: str = "Nous sommes trente et nous partons le douze novembre à huit heures.",
    ) -> None:
        self._queue: deque[RequirementPatch] = deque(patches or [])
        self._factory = factory
        self.transcript = transcript
        self.fail_next: ProviderError | None = None
        self.calls: list[str] = []

    def queue(self, *patches: RequirementPatch) -> None:
        self._queue.extend(patches)

    def extract(self, *, system_prompt: str, user_content: str) -> RequirementPatch:
        self.calls.append(user_content)
        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error
        if self._queue:
            return self._queue.popleft()
        if self._factory is not None:
            return self._factory(user_content)
        return RequirementPatch.empty()

    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str:
        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error
        return self.transcript
