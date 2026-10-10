"""/api/v1 endpoints — thin: all the logic lives in services/ and domain/."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.api.deps import RateLimiter, get_rate_limiter, get_service
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.schemas.conversation import (
    ClientConfig,
    ConfirmRequest,
    ConversationResponse,
    CreateConversationRequest,
    EditRequirementRequest,
    SendMessageRequest,
)
from app.schemas.planning import Handoff, PlanRequest, PlanResult, SelectProposalRequest
from app.schemas.requirements import ConfirmedRequirements
from app.services.audio import inspect_audio, suffix_for
from app.services.conversation import ConversationService

router = APIRouter(prefix="/api/v1", tags=["conversations"])

MAX_MESSAGE_CHARS = 4000


def _check_rate(limiter: RateLimiter, key: str) -> None:
    if not limiter.allow(key):
        raise AppError(429, "RATE_LIMITED", "Trop de messages envoyés. Patientez quelques instants.")


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "status": "ok",
        "extraction_model": settings.extraction_model,
        "transcription_model": settings.transcription_model,
    }


@router.get("/config", response_model=ClientConfig)
def client_config(settings: Settings = Depends(get_settings)) -> ClientConfig:
    """Limits the client needs to mirror (recording length, upload size). No secrets."""
    return ClientConfig(
        max_audio_seconds=settings.max_audio_seconds,
        max_audio_bytes=settings.max_audio_bytes,
        max_message_chars=MAX_MESSAGE_CHARS,
        timezone=settings.app_timezone,
        planner_mode=settings.planner_mode,
    )


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
        raise AppError(400, "EMPTY_MESSAGE", "Le message est vide.")
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
    suffix = suffix_for(content_type)  # 400 before reading anything
    data = await file.read(settings.max_audio_bytes + 1)
    await file.close()
    if len(data) > settings.max_audio_bytes:
        raise AppError(413, "AUDIO_TOO_LARGE", "Enregistrement trop volumineux.")
    if not data:
        raise AppError(400, "AUDIO_EMPTY", "Enregistrement vide.")
    _check_rate(limiter, conversation_id)
    # Unknown conversation → 404 before spending a probe or a paid transcription.
    await run_in_threadpool(service.get, conversation_id)
    await run_in_threadpool(inspect_audio, data, content_type, settings.max_audio_seconds)
    return await run_in_threadpool(
        lambda: service.transcribe(
            conversation_id, audio=data, filename=f"recording{suffix}", content_type=content_type
        )
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


# ----- planning: the teammates' module, or its clearly labelled simulation ------------------------


@router.post("/conversations/{conversation_id}/plan", response_model=PlanResult)
def plan(
    conversation_id: str,
    body: PlanRequest | None = None,
    service: ConversationService = Depends(get_service),
) -> PlanResult:
    return service.plan(conversation_id, scenario=body.scenario if body else None)


@router.get("/conversations/{conversation_id}/plan", response_model=PlanResult)
def get_plan(conversation_id: str, service: ConversationService = Depends(get_service)) -> PlanResult:
    return service.get_plan(conversation_id)


@router.post("/conversations/{conversation_id}/plan/select", response_model=PlanResult)
def select_proposal(
    conversation_id: str,
    body: SelectProposalRequest,
    service: ConversationService = Depends(get_service),
) -> PlanResult:
    return service.select_proposal(conversation_id, body.proposal_id)


@router.get("/conversations/{conversation_id}/handoff", response_model=Handoff)
def handoff(conversation_id: str, service: ConversationService = Depends(get_service)) -> Handoff:
    return service.handoff(conversation_id)
