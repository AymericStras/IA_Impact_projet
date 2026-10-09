"""RequirementPatch : sortie structurée du modèle d'extraction pour UN message.

Tous les champs sont obligatoires (exigence du mode strict des Structured Outputs) ; les valeurs
inconnues sont `null`. Les descriptions sont en anglais car elles sont lues par le modèle.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.requirements import TimeConstraint, normalize_time

FieldName = Literal["participants_count", "departure", "return", "teaching_type"]
FIELD_NAMES: tuple[FieldName, ...] = ("participants_count", "departure", "return", "teaching_type")


class UserIntent(StrEnum):
    PROVIDE_INFORMATION = "provide_information"
    CORRECT_INFORMATION = "correct_information"
    CONFIRM = "confirm"
    REJECT = "reject"
    ASK_QUESTION = "ask_question"
    OTHER = "other"


class AmbiguityKind(StrEnum):
    STUDENTS_ONLY = "students_only"
    RELATIVE_DATE_UNRESOLVED = "relative_date_unresolved"
    VAGUE_QUANTITY = "vague_quantity"
    VAGUE_TIME = "vague_time"
    MULTIPLE_CANDIDATES = "multiple_candidates"
    UNCLEAR_SUBJECT = "unclear_subject"
    OTHER = "other"


class PatchModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PartialDateTimePatch(PatchModel):
    date: str | None = Field(description="ISO date YYYY-MM-DD, or null when unknown/unresolved")
    time: str | None = Field(description="24h time HH:MM, or null")
    constraint: TimeConstraint | None = Field(description="exact | approximate | earliest | latest, or null")

    @field_validator("time", mode="before")
    @classmethod
    def _normalize(cls, value: str | None) -> str | None:
        return normalize_time(value)


class TeachingTypePatch(PatchModel):
    subject: str | None = Field(description="Standard French school subject (Histoire, SVT, ...) or null")
    theme: str | None = Field(description="Teaching theme (Moyen Âge, architecture, ...) or null")


class Operation(PatchModel):
    field: FieldName
    operation: Literal["set", "replace", "clear"] = Field(
        description="set = field was unknown; replace = explicit correction of a known value; clear = teacher withdraws a value"
    )
    value: int | PartialDateTimePatch | TeachingTypePatch | None = Field(
        description="integer for participants_count; date/time object for departure or return; subject/theme object for teaching_type; null for clear"
    )
    evidence: str = Field(
        description="Verbatim French fragment from the teacher's message supporting this operation"
    )


class ParticipantsMentioned(PatchModel):
    students: int | None = Field(description="Number of students mentioned in this message, or null")
    accompanying: int | None = Field(description="Number of accompanying adults mentioned, or null")
    total_stated: int | None = Field(
        description="Only when the teacher explicitly states a total ('nous sommes 30')"
    )


class Ambiguity(PatchModel):
    field: FieldName
    kind: AmbiguityKind
    detail: str = Field(
        description="Short English explanation for the dialogue manager; never shown to the user"
    )


class Conflict(PatchModel):
    field: FieldName
    evidence: str = Field(
        description="Fragment that contradicts the current requirements without an explicit correction"
    )


class RequirementPatch(PatchModel):
    user_intent: UserIntent
    operations: list[Operation]
    participants_mentioned: ParticipantsMentioned
    ambiguities: list[Ambiguity]
    conflicts: list[Conflict]

    @classmethod
    def empty(cls, intent: UserIntent = UserIntent.OTHER) -> RequirementPatch:
        return cls(
            user_intent=intent,
            operations=[],
            participants_mentioned=ParticipantsMentioned(students=None, accompanying=None, total_stated=None),
            ambiguities=[],
            conflicts=[],
        )
