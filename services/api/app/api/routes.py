"""/api/v1 endpoints — thin: all the logic lives in services/ and domain/."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.deps import RateLimiter, get_rate_limiter, get_service
from app.core.config import Settings, get_settings
from app.schemas.conversation import (
    ConfirmRequest,
    ConversationResponse,
    CreateConversationRequest,
    EditRequirementRequest,
    SendMessageRequest,
)
from app.schemas.requirements import ConfirmedRequirements
from app.services.conversation import ConversationService

router = APIRouter(prefix="/api/v1", tags=["conversations"])

ALLOWED_AUDIO = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "audio/flac",
}


def _check_rate(limiter: RateLimiter, key: str) -> None:
    if not limiter.allow(key):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Trop de messages envoyés. Patientez quelques instants."
        )


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "status": "ok",
        "extraction_model": settings.extraction_model,
        "transcription_model": settings.transcription_model,
    }


@router.post("/conversations", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def create_conversation(
    _body: CreateConversationRequest | None = None,
    service: ConversationService = Depends(get_service),
) -> ConversationResponse:
    return service.create()


@router.get("/conversations/{conversation_id}", response_model=ConversationResponse)
def get_conversation(
    conversation_id: str, service: ConversationService = Depends(get_service)
) -> ConversationResponse:
    return service.get(conversation_id)


@router.post("/conversations/{conversation_id}/messages", response_model=ConversationResponse)
def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    service: ConversationService = Depends(get_service),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> ConversationResponse:
    if not body.content.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Le message est vide.")
    _check_rate(limiter, conversation_id)
    return service.handle_message(
        conversation_id,
        content=body.content.strip(),
        client_message_id=body.client_message_id,
        source=body.source,
    )


@router.post("/conversations/{conversation_id}/audio", response_model=ConversationResponse)
async def transcribe_audio(
    conversation_id: str,
    file: UploadFile = File(...),
    service: ConversationService = Depends(get_service),
    settings: Settings = Depends(get_settings),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> ConversationResponse:
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_AUDIO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Format audio non pris en charge.")
    data = await file.read(settings.max_audio_bytes + 1)
    if len(data) > settings.max_audio_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="Enregistrement trop volumineux.")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Enregistrement vide.")
    _check_rate(limiter, conversation_id)
    return service.transcribe(
        conversation_id, audio=data, filename=file.filename or "audio.webm", content_type=content_type
    )


@router.get("/conversations/{conversation_id}/requirements", response_model=ConversationResponse)
def get_requirements(
    conversation_id: str, service: ConversationService = Depends(get_service)
) -> ConversationResponse:
    return service.get(conversation_id)


@router.patch("/conversations/{conversation_id}/requirements", response_model=ConversationResponse)
def edit_requirement(
    conversation_id: str,
    body: EditRequirementRequest,
    service: ConversationService = Depends(get_service),
) -> ConversationResponse:
    return service.edit(
        conversation_id, field=body.field, value=body.value, expected_version=body.expected_version
    )


@router.post("/conversations/{conversation_id}/confirm", response_model=ConversationResponse)
def confirm(
    conversation_id: str,
    body: ConfirmRequest,
    service: ConversationService = Depends(get_service),
) -> ConversationResponse:
    return service.confirm(conversation_id, expected_version=body.expected_version)


@router.get("/conversations/{conversation_id}/export", response_model=ConfirmedRequirements)
def export(
    conversation_id: str, service: ConversationService = Depends(get_service)
) -> ConfirmedRequirements:
    return service.export(conversation_id)
