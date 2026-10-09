"""Orchestration d'une conversation : persistance, idempotence, pipeline, confirmation."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ConversationRow, MessageRow, ProcessedMessageRow, SnapshotRow
from app.domain import dialogue
from app.domain.clock import PARIS, Clock, today
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
from app.schemas.requirements import (
    CompleteRequirements,
    ConfirmedRequirements,
    PartialRequirements,
)
from app.services.extraction import ExtractionService
from app.services.providers.base import TranscriptionProvider


class NotFoundError(Exception):
    pass


class VersionConflictError(Exception):
    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(f"version attendue {expected}, actuelle {actual}")
        self.expected, self.actual = expected, actual


class InvalidStateError(Exception):
    pass


def _iso_paris(value: datetime) -> str:
    """SQLite ne conserve pas le fuseau : une valeur naïve est l'heure murale de Paris telle qu'écrite."""
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
    ) -> None:
        self._session = session
        self._extraction = extraction
        self._transcription = transcription
        self._clock = clock

    # ----- lecture -------------------------------------------------------------------------

    def _load(self, conversation_id: str) -> ConversationRow:
        row = self._session.get(ConversationRow, conversation_id)
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

    # ----- écriture ------------------------------------------------------------------------

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
                row.confirmed = None  # toute modification invalide la confirmation précédente
        if result.decision.state == ConversationState.CONFIRMED and row.confirmed is None:
            row.confirmed = self._build_confirmed(row, result.requirements, now)
        row.state = result.decision.state.value
        row.updated_at = now
        self._add_message(row, "assistant", result.assistant_message)

    def _pending(self, action: Action) -> PendingClarification | None:
        if action.kind.value in ("clarify", "conflict", "invalid") and action.field is not None:
            return PendingClarification(field=action.field, kind=action.detail or action.kind.value)
        return None

    def handle_message(
        self, conversation_id: str, *, content: str, client_message_id: str, source: str = "text"
    ) -> ConversationResponse:
        row = self._load(conversation_id)
        processed = self._session.scalar(
            select(ProcessedMessageRow).where(
                ProcessedMessageRow.conversation_id == row.id,
                ProcessedMessageRow.client_message_id == client_message_id,
            )
        )
        if processed is not None:
            return ConversationResponse.model_validate(processed.response)

        # L'appel au modèle a lieu AVANT toute écriture : en cas d'échec, rien n'est modifié.
        patch = self._extraction.extract(content, self._requirements(row), self._messages(row))
        result = process_turn(
            ConversationState(row.state), self._requirements(row), patch, today(self._clock)
        )
        self._apply_turn(row, result, source=source, user_text=content)
        response = self._response(
            row, assistant_message=result.assistant_message, pending=self._pending(result.decision.action)
        )
        self._session.add(
            ProcessedMessageRow(
                conversation_id=row.id,
                client_message_id=client_message_id,
                response=response.model_dump(mode="json", by_alias=True),
            )
        )
        self._session.commit()
        return response

    def transcribe(
        self, conversation_id: str, *, audio: bytes, filename: str, content_type: str
    ) -> ConversationResponse:
        row = self._load(conversation_id)
        text = self._transcription.transcribe(audio=audio, filename=filename, content_type=content_type)
        # L'audio n'est jamais conservé ; la transcription est renvoyée pour correction, pas extraite.
        return self._response(row, assistant_message=None, transcript=text)

    def edit(
        self,
        conversation_id: str,
        *,
        field: FieldName,
        value: int | PartialDateTimePatch | TeachingTypePatch | None,
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
        result = process_turn(
            ConversationState(row.state), self._requirements(row), patch, today(self._clock)
        )
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
