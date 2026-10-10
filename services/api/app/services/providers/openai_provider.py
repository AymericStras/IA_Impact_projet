"""OpenAI adapter: the only module allowed to import the SDK (AGENTS.md §5)."""

from __future__ import annotations

import logging
import time
from typing import Any

import openai
from openai import OpenAI

from app.schemas.patch import RequirementPatch
from app.services.providers.base import ProviderError

log = logging.getLogger(__name__)


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


class OpenAIProvider:
    def __init__(
        self,
        *,
        api_key: str | None,
        extraction_model: str,
        transcription_model: str,
        timeout_seconds: float = 30.0,
        reasoning_effort: str | None = "low",
        transcription_prompt: str | None = None,
    ) -> None:
        if not api_key:
            raise ProviderError("OPENAI_API_KEY absent : impossible d'initialiser le fournisseur.")
        # One SDK retry covers transient 429/5xx; there is no fallback to a fake provider.
        self._client = OpenAI(api_key=api_key, timeout=timeout_seconds, max_retries=1)
        self.extraction_model = extraction_model
        self.transcription_model = transcription_model
        self.reasoning_effort = reasoning_effort
        self.transcription_prompt = transcription_prompt

    def extract(self, *, system_prompt: str, user_content: str) -> RequirementPatch:
        kwargs: dict[str, Any] = {}
        if self.reasoning_effort and self.extraction_model.startswith("gpt-5"):
            kwargs["reasoning"] = {"effort": self.reasoning_effort}
        started = time.monotonic()
        try:
            response = self._client.responses.parse(
                model=self.extraction_model,
                input=[
                    {"role": "developer", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                text_format=RequirementPatch,
                store=False,  # do not keep teacher messages in the provider's response store
                **kwargs,
            )
        except openai.APITimeoutError as exc:
            raise ProviderError("Délai dépassé côté modèle.", timeout=True) from exc
        except openai.APIError as exc:
            log.warning("extraction provider error: %s", type(exc).__name__)
            raise ProviderError(f"Erreur du fournisseur : {type(exc).__name__}") from exc
        usage = getattr(response, "usage", None)
        # Latency and token usage only: never the message, the prompt or the output.
        log.info(
            "extraction model=%s elapsed_ms=%s input_tokens=%s output_tokens=%s response_id=%s",
            self.extraction_model,
            _elapsed_ms(started),
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
            getattr(response, "id", None),
        )
        parsed = response.output_parsed
        if parsed is None:
            raise ProviderError(
                "Le modèle n'a pas produit de patch structuré (refus ou sortie vide).",
                code="INVALID_EXTRACTION",
            )
        return parsed

    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str:
        kwargs: dict[str, Any] = {}
        if self.transcription_prompt:
            kwargs["prompt"] = self.transcription_prompt
        started = time.monotonic()
        try:
            result = self._client.audio.transcriptions.create(
                model=self.transcription_model,
                file=(filename, audio, content_type),
                language="fr",
                **kwargs,
            )
        except openai.APITimeoutError as exc:
            raise ProviderError("Délai dépassé lors de la transcription.", timeout=True) from exc
        except openai.APIError as exc:
            log.warning("transcription provider error: %s", type(exc).__name__)
            raise ProviderError(f"Erreur du fournisseur : {type(exc).__name__}") from exc
        log.info(
            "transcription model=%s elapsed_ms=%s bytes=%s",
            self.transcription_model,
            _elapsed_ms(started),
            len(audio),
        )
        text = getattr(result, "text", None)
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("Transcription vide.", code="EMPTY_TRANSCRIPT")
        return text.strip()
