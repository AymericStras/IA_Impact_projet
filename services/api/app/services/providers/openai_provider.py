"""OpenAI adapter: the only module allowed to import the SDK (AGENTS.md §5)."""

from __future__ import annotations

import logging
from typing import Any

import openai
from openai import OpenAI

from app.schemas.patch import RequirementPatch
from app.services.providers.base import ProviderError

log = logging.getLogger(__name__)


class OpenAIProvider:
    def __init__(
        self,
        *,
        api_key: str | None,
        extraction_model: str,
        transcription_model: str,
        timeout_seconds: float = 30.0,
        reasoning_effort: str | None = "low",
    ) -> None:
        if not api_key:
            raise ProviderError("OPENAI_API_KEY absent : impossible d'initialiser le fournisseur.")
        self._client = OpenAI(api_key=api_key, timeout=timeout_seconds, max_retries=1)
        self.extraction_model = extraction_model
        self.transcription_model = transcription_model
        self.reasoning_effort = reasoning_effort

    def extract(self, *, system_prompt: str, user_content: str) -> RequirementPatch:
        kwargs: dict[str, Any] = {}
        if self.reasoning_effort and self.extraction_model.startswith("gpt-5"):
            kwargs["reasoning"] = {"effort": self.reasoning_effort}
        try:
            response = self._client.responses.parse(
                model=self.extraction_model,
                input=[
                    {"role": "developer", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                text_format=RequirementPatch,
                **kwargs,
            )
        except openai.APITimeoutError as exc:
            raise ProviderError("Délai dépassé côté modèle.", timeout=True) from exc
        except openai.APIError as exc:
            log.warning("extraction provider error: %s", type(exc).__name__)
            raise ProviderError(f"Erreur du fournisseur : {type(exc).__name__}") from exc
        parsed = response.output_parsed
        if parsed is None:
            raise ProviderError("Le modèle n'a pas produit de patch structuré (refus ou sortie vide).")
        return parsed

    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str:
        try:
            result = self._client.audio.transcriptions.create(
                model=self.transcription_model,
                file=(filename, audio, content_type),
                language="fr",
            )
        except openai.APITimeoutError as exc:
            raise ProviderError("Délai dépassé lors de la transcription.", timeout=True) from exc
        except openai.APIError as exc:
            log.warning("transcription provider error: %s", type(exc).__name__)
            raise ProviderError(f"Erreur du fournisseur : {type(exc).__name__}") from exc
        text = getattr(result, "text", None)
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("Transcription vide.")
        return text.strip()
