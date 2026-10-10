"""Orchestration of a conversation: persistence, idempotency, pipeline, confirmation."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import ConversationRow, MessageRow, ProcessedMessageRow, SnapshotRow
from app.domain import dialogue
from app.domain.clock import PARIS, Clock, today
from app.domain.patch_merger import InvalidPatchError
from app.domain.pipeline import TurnResult, process_turn
from app.domain.state_machine import Action, decide_explicit_confirmation
from app.domain.validators import validate
from app.schemas.conversation import (
    ConversationResponse,
    ConversationState,
    Message,
    PendingClarification,
)
from app.schemas.patch import (
    FieldName,
    Operation,
    PartialDateTimePatch,
    ParticipantsMentioned,
    RequirementPatch,
    TeachingTypePatch,
    UserIntent,
)
from app.schemas.planning import (
    Adjustment,
    Booking,
    BookingScenario,
    Feedback,
    Journey,
    SearchScenario,
    TravelFile,
)
from app.schemas.requirements import (
    CompleteRequirements,
    ConfirmedRequirements,
    PartialRequirements,
)
from app.services import planner
from app.services.extraction import ExtractionService
from app.services.providers.base import ProviderError, TranscriptionProvider


class NotFoundError(Exception):
    pass


class VersionConflictError(Exception):
    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(f"expected version {expected}, current {actual}")
        self.expected, self.actual = expected, actual


class InvalidStateError(Exception):
    pass


class ConcurrentUpdateError(Exception):
    """The conversation changed while the model was working on this message."""


class IdempotencyConflictError(Exception):
    """A `client_message_id` was reused with different content."""


def _fingerprint(source: str, content: str) -> str:
    return hashlib.sha256(f"{source}\n{content}".encode()).hexdigest()


def _iso_paris(value: datetime) -> str:
    """SQLite does not keep the timezone: a naive value is the Paris wall-clock time as written."""
    aware = value if value.tzinfo is not None else value.replace(tzinfo=PARIS)
    return aware.astimezone(PARIS).isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


class ConversationService:
    def __init__(
        self,
        session: Session,
        extraction: ExtractionService,
        transcription: TranscriptionProvider,
        clock: Clock,
        planner_mode: str = "off",
    ) -> None:
        self._planner_mode = planner_mode
        self._session = session
        self._extraction = extraction
        self._transcription = transcription
        self._clock = clock

    # ----- read ----------------------------------------------------------------------------

    def _load(self, conversation_id: str, *, lock: bool = False) -> ConversationRow:
        # FOR UPDATE serialises writers on PostgreSQL; SQLite ignores it (single writer anyway).
        row = self._session.get(ConversationRow, conversation_id, with_for_update=lock or None)
        if row is None:
            raise NotFoundError(conversation_id)
        return row

    def _requirements(self, row: ConversationRow) -> PartialRequirements:
        return PartialRequirements.model_validate(row.requirements)

    def _messages(self, row: ConversationRow) -> list[Message]:
        return [
            Message(
                id=m.id,
                role=m.role,
                content=m.content,
                source=m.source,
                created_at=_iso_paris(m.created_at),
            )
            for m in row.messages
        ]

    def _response(
        self,
        row: ConversationRow,
        *,
        assistant_message: str | None,
        pending: PendingClarification | None = None,
        transcript: str | None = None,
    ) -> ConversationResponse:
        reqs = self._requirements(row)
        validation = validate(reqs, today(self._clock))
        state = ConversationState(row.state)
        return ConversationResponse(
            conversation_id=row.id,
            state=state,
            version=row.version,
            assistant_message=assistant_message,
            requirements=reqs,
            missing_fields=validation.missing_fields,
            pending_clarification=pending,
            ready_for_confirmation=validation.is_complete
            and state == ConversationState.AWAITING_CONFIRMATION,
            transcript=transcript,
            confirmed_requirements=(
                ConfirmedRequirements.model_validate(row.confirmed) if row.confirmed is not None else None
            ),
            messages=self._messages(row),
        )

    def get(self, conversation_id: str) -> ConversationResponse:
        row = self._load(conversation_id)
        last = next((m for m in reversed(row.messages) if m.role == "assistant"), None)
        return self._response(row, assistant_message=last.content if last else None)

    # ----- write ---------------------------------------------------------------------------

    def _add_message(self, row: ConversationRow, role: str, content: str, source: str | None = None) -> None:
        row.messages.append(
            MessageRow(
                id=_new_id("msg"),
                seq=len(row.messages),
                role=role,
                content=content,
                source=source,
                created_at=self._clock.now(),
            )
        )

    def create(self) -> ConversationResponse:
        now = self._clock.now()
        row = ConversationRow(
            id=_new_id("conv"),
            state=ConversationState.COLLECTING.value,
            version=0,
            requirements=PartialRequirements().model_dump(mode="json", by_alias=True),
            confirmed=None,
            created_at=now,
            updated_at=now,
        )
        self._session.add(row)
        self._add_message(row, "assistant", dialogue.WELCOME)
        self._session.commit()
        return self._response(row, assistant_message=dialogue.WELCOME)

    def _apply_turn(
        self, row: ConversationRow, result: TurnResult, *, source: str | None, user_text: str
    ) -> None:
        now = self._clock.now()
        self._add_message(row, "user", user_text, source)
        if result.changed:
            row.version += 1
            row.requirements = result.requirements.model_dump(mode="json", by_alias=True)
            self._session.add(
                SnapshotRow(
                    conversation_id=row.id, version=row.version, requirements=row.requirements, created_at=now
                )
            )
            if row.confirmed is not None:
                row.confirmed = None  # any modification invalidates the previous confirmation
                row.plan = None  # ...and the proposals computed for it
        if result.decision.state == ConversationState.CONFIRMED and row.confirmed is None:
            row.confirmed = self._build_confirmed(row, result.requirements, now)
        row.state = result.decision.state.value
        row.updated_at = now
        self._add_message(row, "assistant", result.assistant_message)

    def _pending(self, action: Action) -> PendingClarification | None:
        if action.kind.value in ("clarify", "conflict", "invalid") and action.field is not None:
            return PendingClarification(field=action.field, kind=action.detail or action.kind.value)
        return None

    def _processed(self, conversation_id: str, client_message_id: str) -> ProcessedMessageRow | None:
        return self._session.scalar(
            select(ProcessedMessageRow).where(
                ProcessedMessageRow.conversation_id == conversation_id,
                ProcessedMessageRow.client_message_id == client_message_id,
            )
        )

    def _replay(self, processed: ProcessedMessageRow, fingerprint: str) -> ConversationResponse:
        if processed.fingerprint is not None and processed.fingerprint != fingerprint:
            raise IdempotencyConflictError(processed.client_message_id)
        return ConversationResponse.model_validate(processed.response)

    def handle_message(
        self, conversation_id: str, *, content: str, client_message_id: str, source: str = "text"
    ) -> ConversationResponse:
        fingerprint = _fingerprint(source, content)
        row = self._load(conversation_id)
        processed = self._processed(row.id, client_message_id)
        if processed is not None:
            return self._replay(processed, fingerprint)

        requirements = self._requirements(row)
        recent = self._messages(row)
        marker = (row.version, len(row.messages), row.state)
        # Release the read transaction: no database transaction is held while the model works,
        # and nothing has been written, so a provider failure leaves the conversation untouched.
        self._session.rollback()

        patch = self._extraction.extract(content, requirements, recent)

        row = self._load(conversation_id, lock=True)
        if (row.version, len(row.messages), row.state) != marker:
            raise ConcurrentUpdateError(conversation_id)
        try:
            result = process_turn(ConversationState(row.state), requirements, patch, today(self._clock))
        except InvalidPatchError as exc:
            self._session.rollback()
            raise ProviderError("Extraction invalide.", code="INVALID_EXTRACTION") from exc
        self._apply_turn(row, result, source=source, user_text=content)
        response = self._response(
            row, assistant_message=result.assistant_message, pending=self._pending(result.decision.action)
        )
        self._session.add(
            ProcessedMessageRow(
                conversation_id=row.id,
                client_message_id=client_message_id,
                fingerprint=fingerprint,
                response=response.model_dump(mode="json", by_alias=True),
            )
        )
        try:
            self._session.commit()
        except IntegrityError:
            # The same client_message_id was committed by a concurrent request: return its response.
            self._session.rollback()
            duplicate = self._processed(conversation_id, client_message_id)
            if duplicate is None:
                raise
            return self._replay(duplicate, fingerprint)
        return response

    def transcribe(
        self, conversation_id: str, *, audio: bytes, filename: str, content_type: str
    ) -> ConversationResponse:
        row = self._load(conversation_id)
        text = self._transcription.transcribe(audio=audio, filename=filename, content_type=content_type)
        # Audio is never kept; the transcript is returned for correction, not extracted.
        return self._response(row, assistant_message=None, transcript=text)

    def edit(
        self,
        conversation_id: str,
        *,
        field: FieldName,
        value: int | str | PartialDateTimePatch | TeachingTypePatch | None,
        expected_version: int,
    ) -> ConversationResponse:
        row = self._load(conversation_id)
        if row.version != expected_version:
            raise VersionConflictError(expected_version, row.version)
        patch = RequirementPatch(
            user_intent=UserIntent.CORRECT_INFORMATION,
            operations=[
                Operation(
                    field=field,
                    operation="clear" if value is None else "replace",
                    value=value,
                    evidence="modification depuis le panneau",
                )
            ],
            participants_mentioned=ParticipantsMentioned(students=None, accompanying=None, total_stated=None),
            ambiguities=[],
            conflicts=[],
        )
        try:
            result = process_turn(
                ConversationState(row.state), self._requirements(row), patch, today(self._clock)
            )
        except InvalidPatchError as exc:
            raise AppError(422, "INVALID_VALUE", "La valeur saisie est invalide.") from exc
        label = dialogue.FIELD_LABELS[field]
        self._apply_turn(row, result, source="edit", user_text=f"Modification de {label}.")
        self._session.commit()
        return self._response(
            row, assistant_message=result.assistant_message, pending=self._pending(result.decision.action)
        )

    def confirm(self, conversation_id: str, *, expected_version: int) -> ConversationResponse:
        row = self._load(conversation_id)
        if row.version != expected_version:
            raise VersionConflictError(expected_version, row.version)
        reqs = self._requirements(row)
        validation = validate(reqs, today(self._clock))
        decision = decide_explicit_confirmation(ConversationState(row.state), validation.is_complete)
        if decision is None:
            raise InvalidStateError(
                "La confirmation n'est possible que lorsque les quatre informations sont complètes."
            )
        now = self._clock.now()
        row.confirmed = self._build_confirmed(row, reqs, now)
        row.state = decision.state.value
        row.updated_at = now
        message = dialogue.render(decision.action, reqs)
        self._add_message(row, "user", "Confirmer et continuer", "edit")
        self._add_message(row, "assistant", message)
        self._session.commit()
        return self._response(row, assistant_message=message)

    def export(self, conversation_id: str) -> ConfirmedRequirements:
        row = self._load(conversation_id)
        if row.confirmed is None:
            raise InvalidStateError("Le projet n'est pas encore confirmé.")
        return ConfirmedRequirements.model_validate(row.confirmed)

    # ----- journey after confirmation: teammates' modules, simulated (docs/PLANNER_CONTRACT.md) ---

    _OPEN_STAGES = ("destinations", "itineraries", "adjustments", "no_match", "review", "booking_refused")

    def _require_simulation(self) -> None:
        if self._planner_mode == "off":
            raise InvalidStateError("La planification n'est pas activée sur ce service.")
        if self._planner_mode != "simulated":
            raise AppError(
                501, "PLANNER_NOT_CONNECTED", "Le module de planification réel n'est pas encore connecté."
            )

    def _confirmed(self, row: ConversationRow) -> ConfirmedRequirements:
        if row.confirmed is None:
            raise InvalidStateError(
                "Confirmez d'abord vos informations avant de rechercher des propositions."
            )
        return ConfirmedRequirements.model_validate(row.confirmed)

    def _journey(self, row: ConversationRow) -> Journey:
        if row.plan is None or row.confirmed is None:
            raise InvalidStateError("Aucune recherche n'est en cours pour ce projet.")
        return Journey.model_validate(row.plan)

    def _save_journey(self, row: ConversationRow, journey: Journey) -> Journey:
        row.plan = journey.model_dump(mode="json", by_alias=True)
        row.updated_at = self._clock.now()
        self._session.commit()
        return journey

    def _search(self, journey: Journey, requirements: CompleteRequirements) -> None:
        """Itineraries for the current choice, or the adjustments that would make it work."""
        destination_id = journey.selected_destination_id or ""
        activities = journey.selected_activity_ids
        strict = journey.strict_minutes
        journey.itineraries = planner.build_itineraries(
            requirements, destination_id, activities, strict_minutes=strict
        )
        journey.adjustments = []
        journey.selected_itinerary_id = None
        journey.booking = None
        journey.alternatives = []
        if journey.itineraries:
            journey.stage = "itineraries"
            count = len(journey.itineraries)
            journey.message = (
                f"{count} itinéraire{'s' if count > 1 else ''} possible{'s' if count > 1 else ''}. "
                "Choisissez celui qui vous convient."
            )
            return
        journey.adjustments = planner.propose_adjustments(
            requirements, destination_id, activities, strict_minutes=strict
        )
        if journey.adjustments:
            journey.stage = "adjustments"
            journey.message = (
                "Aucun itinéraire ne correspond exactement à votre demande. "
                "Voici ce qui deviendrait possible ; rien n'est modifié sans votre accord."
            )
        else:
            journey.stage = "no_match"
            journey.message = (
                "Aucun itinéraire n'a été trouvé pour ce choix, même avec des ajustements raisonnables. "
                "Choisissez une autre destination ou modifiez votre demande."
            )

    def start_journey(
        self,
        conversation_id: str,
        *,
        search_scenario: SearchScenario | None = None,
        booking_scenario: BookingScenario | None = None,
    ) -> Journey:
        self._require_simulation()
        row = self._load(conversation_id, lock=True)
        confirmed = self._confirmed(row)
        scenario = search_scenario or "auto"
        if scenario == "error":
            raise planner.planner_error()
        requirements = confirmed.requirements
        journey = Journey(
            conversation_id=row.id,
            stage="destinations",
            requirements_version=row.version,
            planner_mode="simulated",
            simulated=True,
            departure_stations=planner.departure_stations(requirements.departure_station),
            notices=[planner.SIMULATION_NOTICE, planner.TRAVEL_TIME_NOTICE],
            message="Voici des destinations adaptées à votre thème. Choisissez une destination et vos activités.",
            search_scenario=scenario,
            booking_scenario=booking_scenario or "confirmed",
        )
        if scenario == "no_match":
            journey.stage = "no_match"
            journey.message = (
                "Aucune destination ne correspond à votre demande. Vos informations sont conservées ; "
                "vous pouvez les modifier et relancer la recherche."
            )
        else:
            journey.destinations = planner.recommend_destinations(requirements)
        return self._save_journey(row, journey)

    def get_journey(self, conversation_id: str) -> Journey:
        return self._journey(self._load(conversation_id))

    def choose_destination(
        self, conversation_id: str, destination_id: str, activity_ids: list[str]
    ) -> Journey:
        self._require_simulation()
        row = self._load(conversation_id, lock=True)
        journey = self._journey(row)
        if journey.stage not in self._OPEN_STAGES:
            raise InvalidStateError(
                "Une demande de réservation est en cours : ce choix ne peut plus être modifié."
            )
        if all(d.id != destination_id for d in journey.destinations):
            raise InvalidStateError("Cette destination n'est plus proposée. Relancez la recherche.")
        requirements = self._confirmed(row).requirements
        journey.selected_destination_id = destination_id
        journey.selected_activity_ids = activity_ids
        journey.strict_minutes = 0
        if journey.search_scenario == "adjustments" and not journey.accepted_adjustments:
            # Test lever: raise the time needed on site just enough that nothing fits as asked.
            for extra in range(15, 601, 15):
                if not planner.build_itineraries(
                    requirements, destination_id, activity_ids, strict_minutes=extra
                ):
                    journey.strict_minutes = extra
                    break
        self._search(journey, requirements)
        return self._save_journey(row, journey)

    def accept_adjustment(self, conversation_id: str, adjustment_id: str) -> Journey:
        self._require_simulation()
        row = self._load(conversation_id, lock=True)
        journey = self._journey(row)
        chosen = next((a for a in journey.adjustments if a.id == adjustment_id), None)
        if journey.stage != "adjustments" or chosen is None:
            raise InvalidStateError("Cet ajustement n'est plus proposé. Relancez la recherche.")
        if chosen.destination_id is not None:
            journey.selected_destination_id = chosen.destination_id
        if chosen.activity_ids is not None:
            journey.selected_activity_ids = chosen.activity_ids
        if chosen.changes:
            self._apply_accepted_changes(row, chosen)
            journey.requirements_version = row.version
        journey.accepted_adjustments.append(chosen)
        self._search(journey, self._confirmed(row).requirements)
        return self._save_journey(row, journey)

    def _apply_accepted_changes(self, row: ConversationRow, adjustment: Adjustment) -> None:
        """An accepted adjustment is an explicit consent to its before/after values: the requirements

        change and stay confirmed. Nothing else may change requirements without a new confirmation.
        """
        reqs = self._requirements(row)
        for change in adjustment.changes:
            current = reqs.return_ if change.field == "return" else reqs.departure
            if current is None or current.time != change.before:
                raise InvalidStateError(
                    "Votre demande a changé depuis cette proposition. Relancez la recherche."
                )
            updated = current.model_copy(update={"time": change.after})
            if change.field == "return":
                reqs.return_ = updated
            else:
                reqs.departure = updated
        now = self._clock.now()
        row.version += 1
        row.requirements = reqs.model_dump(mode="json", by_alias=True)
        self._session.add(
            SnapshotRow(
                conversation_id=row.id, version=row.version, requirements=row.requirements, created_at=now
            )
        )
        row.confirmed = self._build_confirmed(row, reqs, now)
        self._add_message(row, "user", f"Ajustement accepté : {adjustment.label}.", "edit")
        self._add_message(
            row, "assistant", f"C'est noté : {adjustment.label}. Votre demande a été mise à jour."
        )

    def choose_itinerary(self, conversation_id: str, itinerary_id: str) -> Journey:
        self._require_simulation()
        row = self._load(conversation_id, lock=True)
        journey = self._journey(row)
        offered = journey.itineraries + journey.alternatives
        if journey.stage not in ("itineraries", "review", "booking_refused") or all(
            i.id != itinerary_id for i in offered
        ):
            raise InvalidStateError("Cet itinéraire n'est plus proposé. Relancez la recherche.")
        journey.selected_itinerary_id = itinerary_id
        journey.booking = None
        journey.stage = "review"
        journey.message = (
            "Vérifiez une dernière fois l'itinéraire avant d'envoyer la demande de réservation. "
            "Rien n'est réservé tant que vous n'avez pas envoyé la demande."
        )
        return self._save_journey(row, journey)

    def submit_booking(self, conversation_id: str) -> Journey:
        self._require_simulation()
        row = self._load(conversation_id, lock=True)
        journey = self._journey(row)
        if journey.stage != "review" or journey.selected_itinerary_id is None:
            raise InvalidStateError("Choisissez d'abord un itinéraire à réserver.")
        if journey.booking_scenario == "error":
            raise planner.booking_error()
        journey.booking = Booking(
            reference=planner.booking_reference(row.id, journey.selected_itinerary_id),
            status="pending",
            itinerary_id=journey.selected_itinerary_id,
            message="Demande envoyée au service de réservation. En attente de confirmation.",
            simulated=True,
        )
        journey.stage = "booking_pending"
        journey.message = journey.booking.message
        return self._save_journey(row, journey)

    def check_booking(self, conversation_id: str) -> Journey:
        self._require_simulation()
        row = self._load(conversation_id, lock=True)
        journey = self._journey(row)
        if journey.stage != "booking_pending" or journey.booking is None:
            return journey  # nothing to wait for: the stage already tells what happened
        if journey.booking_scenario == "refused":
            journey.booking.status = "refused"
            journey.booking.message = (
                "La demande n'a pas pu être confirmée (simulation : plus de places pour ce groupe)."
            )
            journey.alternatives = [i for i in journey.itineraries if i.id != journey.booking.itinerary_id]
            journey.stage = "booking_refused"
            journey.message = "La réservation n'a pas été confirmée. " + (
                "Voici d'autres itinéraires possibles ; vous pouvez aussi modifier votre demande."
                if journey.alternatives
                else "Choisissez une autre destination ou modifiez votre demande."
            )
            journey.booking_scenario = "confirmed"  # the simulated refusal happens once
        else:
            journey.booking.status = "confirmed"
            journey.booking.message = (
                f"Réservation confirmée (simulation). Référence {journey.booking.reference}."
            )
            journey.stage = "booked"
            journey.message = "Votre réservation est confirmée. Votre dossier de voyage est prêt."
        return self._save_journey(row, journey)

    def travel_file(self, conversation_id: str) -> TravelFile:
        row = self._load(conversation_id)
        journey = self._journey(row)
        if journey.stage not in ("booked", "closed") or journey.booking is None:
            raise InvalidStateError("Le dossier de voyage est disponible une fois la réservation confirmée.")
        itinerary = next(
            i for i in journey.itineraries + journey.alternatives if i.id == journey.booking.itinerary_id
        )
        return planner.travel_file(self._confirmed(row).requirements, itinerary, journey.booking.reference)

    def give_feedback(self, conversation_id: str, feedback: Feedback) -> Journey:
        row = self._load(conversation_id, lock=True)
        journey = self._journey(row)
        if journey.stage not in ("booked", "closed"):
            raise InvalidStateError("Le retour d'expérience se donne après la sortie.")
        journey.feedback = feedback
        journey.stage = "closed"
        journey.message = "Merci pour votre retour d'expérience."
        return self._save_journey(row, journey)

    def _build_confirmed(
        self, row: ConversationRow, reqs: PartialRequirements, now: datetime
    ) -> dict[str, Any]:
        complete = CompleteRequirements.model_validate(
            reqs.model_dump(mode="json", by_alias=True, exclude_none=False)
        )
        confirmed = ConfirmedRequirements(
            conversation_id=row.id,
            confirmed_at=now.astimezone(PARIS).isoformat(timespec="seconds"),
            requirements=complete,
        )
        return confirmed.model_dump(mode="json", by_alias=True)
