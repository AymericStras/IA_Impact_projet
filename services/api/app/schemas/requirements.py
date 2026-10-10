"""Pydantic models of the data contract (source of truth; the JSON Schemas in
`packages/contracts` are exported from these classes by `scripts/export_schemas.py`).
"""

from __future__ import annotations

import datetime as dt
import re
from enum import StrEnum
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

TIME_PATTERN = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"
_LOOSE_TIME = re.compile(r"^\s*(\d{1,2})\s*[:hH]\s*(\d{2})?\s*$")

SCHEMA_VERSION: Final = "1.1"
TIMEZONE: Final = "Europe/Paris"


def normalize_time(value: str | None) -> str | None:
    """Accepts « 8:00 », « 8h », « 08h30 » and returns « HH:MM »."""
    if value is None:
        return None
    match = _LOOSE_TIME.match(value)
    if not match:
        return value
    hour, minute = int(match.group(1)), int(match.group(2) or 0)
    return f"{hour:02d}:{minute:02d}"


class ContractModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )


class TimeConstraint(StrEnum):
    """exact = « à 8 h »; approximate = « vers 8 h »; earliest = « après 8 h »; latest = « avant 17 h »."""

    EXACT = "exact"
    APPROXIMATE = "approximate"
    EARLIEST = "earliest"
    LATEST = "latest"


class PartialDateTime(ContractModel):
    """Partially known date/time. Complete only if all three fields are filled in."""

    date: dt.date | None = Field(default=None, description="ISO 8601 calendar date (Europe/Paris)")
    time: str | None = Field(default=None, pattern=TIME_PATTERN, description="Local time HH:MM")
    constraint: TimeConstraint | None = Field(default=None, description="Nature of the time constraint")

    @field_validator("time", mode="before")
    @classmethod
    def _normalize(cls, value: str | None) -> str | None:
        return normalize_time(value)

    @property
    def is_complete(self) -> bool:
        return self.date is not None and self.time is not None and self.constraint is not None


class TeachingType(ContractModel):
    """Subject and/or teaching theme: either one is enough."""

    subject: str | None = Field(default=None, description="School subject, e.g. « Histoire », « SVT »")
    theme: str | None = Field(default=None, description="Teaching theme, e.g. « Moyen Âge »")

    @field_validator("subject", "theme", mode="before")
    @classmethod
    def _strip_empty(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @property
    def is_complete(self) -> bool:
        return self.subject is not None or self.theme is not None


class ParticipantsBreakdown(ContractModel):
    students: int | None = Field(default=None, ge=0)
    accompanying: int | None = Field(default=None, ge=0)


class PartialRequirements(ContractModel):
    """Current state of the four requirements, as returned to the client on every turn."""

    participants_count: int | None = Field(default=None, ge=1, description="Students + accompanying adults")
    participants_breakdown: ParticipantsBreakdown | None = None
    departure_station: str | None = Field(
        default=None,
        max_length=80,
        description="Departure station OR city, as the teacher said it. A city means any station of that city.",
    )
    departure: PartialDateTime | None = None
    return_: PartialDateTime | None = Field(default=None, alias="return")
    teaching_type: TeachingType | None = None


class DateTimeRequirement(ContractModel):
    date: dt.date
    time: str = Field(pattern=TIME_PATTERN)
    constraint: TimeConstraint


class CompleteTeachingType(ContractModel):
    subject: str | None
    theme: str | None

    @model_validator(mode="after")
    def _at_least_one(self) -> CompleteTeachingType:
        if self.subject is None and self.theme is None:
            raise ValueError("subject or theme must be provided")
        return self


class CompleteRequirements(ContractModel):
    participants_count: int = Field(ge=1)
    participants_breakdown: ParticipantsBreakdown | None = None
    departure_station: str = Field(
        min_length=1,
        max_length=80,
        description="Departure station OR city, as the teacher said it. A city means any station of that city: the planner expands it.",
    )
    departure: DateTimeRequirement
    return_: DateTimeRequirement = Field(alias="return")
    teaching_type: CompleteTeachingType


class ConfirmedRequirements(ContractModel):
    """Payload handed to the planning module after explicit confirmation."""

    schema_version: Literal["1.1"] = SCHEMA_VERSION
    conversation_id: str = Field(min_length=1)
    status: Literal["confirmed"] = "confirmed"
    timezone: Literal["Europe/Paris"] = TIMEZONE
    confirmed_at: str = Field(description="ISO 8601 timestamp with offset, e.g. 2026-10-10T14:32:05+02:00")
    requirements: CompleteRequirements
