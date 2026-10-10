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
from app.schemas.planning import (
    AcceptAdjustmentRequest,
    ChooseDestinationRequest,
    ChooseItineraryRequest,
    Feedback,
    Journey,
    StartJourneyRequest,
    TravelFile,
)
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


# ----- journey after confirmation: teammates' modules, simulated and labelled as such -------------


@router.post("/conversations/{conversation_id}/journey", response_model=Journey)
def start_journey(
    conversation_id: str,
    body: StartJourneyRequest | None = None,
    service: ConversationService = Depends(get_service),
) -> Journey:
    return service.start_journey(
        conversation_id,
        search_scenario=body.search_scenario if body else None,
        booking_scenario=body.booking_scenario if body else None,
    )


@router.get("/conversations/{conversation_id}/journey", response_model=Journey)
def get_journey(conversation_id: str, service: ConversationService = Depends(get_service)) -> Journey:
    return service.get_journey(conversation_id)


@router.post("/conversations/{conversation_id}/journey/destination", response_model=Journey)
def choose_destination(
    conversation_id: str, body: ChooseDestinationRequest, service: ConversationService = Depends(get_service)
) -> Journey:
    return service.choose_destination(conversation_id, body.destination_id, body.activity_ids)


@router.post("/conversations/{conversation_id}/journey/adjustment", response_model=Journey)
def accept_adjustment(
    conversation_id: str, body: AcceptAdjustmentRequest, service: ConversationService = Depends(get_service)
) -> Journey:
    return service.accept_adjustment(conversation_id, body.adjustment_id)


@router.post("/conversations/{conversation_id}/journey/itinerary", response_model=Journey)
def choose_itinerary(
    conversation_id: str, body: ChooseItineraryRequest, service: ConversationService = Depends(get_service)
) -> Journey:
    return service.choose_itinerary(conversation_id, body.itinerary_id)


@router.post("/conversations/{conversation_id}/journey/booking", response_model=Journey)
def submit_booking(conversation_id: str, service: ConversationService = Depends(get_service)) -> Journey:
    return service.submit_booking(conversation_id)


@router.post("/conversations/{conversation_id}/journey/booking/check", response_model=Journey)
def check_booking(conversation_id: str, service: ConversationService = Depends(get_service)) -> Journey:
    return service.check_booking(conversation_id)


@router.get("/conversations/{conversation_id}/journey/travel-file", response_model=TravelFile)
def travel_file(conversation_id: str, service: ConversationService = Depends(get_service)) -> TravelFile:
    return service.travel_file(conversation_id)


@router.post("/conversations/{conversation_id}/journey/feedback", response_model=Journey)
def give_feedback(
    conversation_id: str, body: Feedback, service: ConversationService = Depends(get_service)
) -> Journey:
    return service.give_feedback(conversation_id, body)
