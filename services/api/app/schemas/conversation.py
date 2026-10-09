"""Modèles d'entrée/sortie des endpoints de conversation."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import Field

from app.schemas.patch import FieldName, PartialDateTimePatch, TeachingTypePatch
from app.schemas.requirements import ConfirmedRequirements, ContractModel, PartialRequirements


class ConversationState(StrEnum):
    """États visibles par le client. EXTRACTING/VALIDATING sont internes à une requête."""

    COLLECTING = "COLLECTING"
    ASKING_USER = "ASKING_USER"
    AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION"
    EDITING = "EDITING"
    CONFIRMED = "CONFIRMED"
    HANDOFF = "HANDOFF"


class Message(ContractModel):
    id: str
    role: Literal["assistant", "user"]
    content: str
    source: Literal["text", "audio", "edit"] | None = None
    created_at: str


class PendingClarification(ContractModel):
    field: FieldName
    kind: str


class ConversationResponse(ContractModel):
    """Réponse de tous les endpoints : le client l'affiche telle quelle, sans recalculer."""

    conversation_id: str
    state: ConversationState
    version: int = Field(ge=0, description="Version monotone des informations ; +1 à chaque patch appliqué")
    assistant_message: str | None
    requirements: PartialRequirements
    missing_fields: list[FieldName]
    pending_clarification: PendingClarification | None = None
    ready_for_confirmation: bool
    transcript: str | None = Field(
        default=None, description="Uniquement après /audio : transcription à corriger"
    )
    confirmed_requirements: ConfirmedRequirements | None = Field(
        default=None, description="Charge utile finale, non nulle seulement en état CONFIRMED"
    )
    messages: list[Message]


class CreateConversationRequest(ContractModel):
    pass


class SendMessageRequest(ContractModel):
    content: str = Field(min_length=1, max_length=4000)
    client_message_id: str = Field(min_length=1, max_length=128)
    source: Literal["text", "audio"] = "text"


class EditRequirementRequest(ContractModel):
    field: FieldName
    value: int | PartialDateTimePatch | TeachingTypePatch | None
    expected_version: int = Field(ge=0)


class ConfirmRequest(ContractModel):
    expected_version: int = Field(ge=0)


class ProblemDetails(ContractModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str
