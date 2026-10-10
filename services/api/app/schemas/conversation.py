"""Input/output models of the conversation endpoints."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import Field

from app.schemas.patch import FieldName, PartialDateTimePatch, TeachingTypePatch
from app.schemas.requirements import ConfirmedRequirements, ContractModel, PartialRequirements


class ConversationState(StrEnum):
    """States visible to the client. EXTRACTING/VALIDATING are internal to a request."""

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
    """Response of all endpoints: the client renders it as is, without recomputing."""

    conversation_id: str
    state: ConversationState
    version: int = Field(ge=0, description="Monotonic version of the requirements; +1 for each applied patch")
    assistant_message: str | None
    requirements: PartialRequirements
    missing_fields: list[FieldName]
    pending_clarification: PendingClarification | None = None
    ready_for_confirmation: bool
    transcript: str | None = Field(default=None, description="Only after /audio: transcript to be corrected")
    confirmed_requirements: ConfirmedRequirements | None = Field(
        default=None, description="Final payload, non-null only in the CONFIRMED state"
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
    value: int | str | PartialDateTimePatch | TeachingTypePatch | None
    expected_version: int = Field(ge=0)


class ConfirmRequest(ContractModel):
    expected_version: int = Field(ge=0)


class ProblemDetails(ContractModel):
    type: str = "about:blank"
    title: str
    status: int
    code: str = Field(description="Stable machine-readable error code")
    detail: str


class ClientConfig(ContractModel):
    max_audio_seconds: int
    max_audio_bytes: int
    max_message_chars: int
    timezone: str
    planner_mode: Literal["off", "simulated", "http"] = "off"
