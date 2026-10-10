"""Fake provider for tests: scripted patches, errors on demand."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable

from app.schemas.patch import RequirementPatch
from app.services.providers.base import ProviderError

PatchFactory = Callable[[str], RequirementPatch]


PLACEHOLDER_EVIDENCE = "…"


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

    @staticmethod
    def _quote(patch: RequirementPatch, user_content: str) -> RequirementPatch:
        """Scripted operations left with the placeholder evidence quote the whole teacher message,

        so tests exercise the real evidence check without spelling a quote for every operation.
        """
        message = user_content.rsplit("TEACHER MESSAGE: ", 1)[-1]
        operations = [
            op.model_copy(update={"evidence": message}) if op.evidence == PLACEHOLDER_EVIDENCE else op
            for op in patch.operations
        ]
        return patch.model_copy(update={"operations": operations})

    def extract(self, *, system_prompt: str, user_content: str) -> RequirementPatch:
        self.calls.append(user_content)
        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error
        if self._queue:
            return self._quote(self._queue.popleft(), user_content)
        if self._factory is not None:
            return self._factory(user_content)
        return RequirementPatch.empty()

    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str:
        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error
        return self.transcript
