"""Input contract: what the upstream module sends for one trip recap."""

from __future__ import annotations

import hashlib
import json
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

SCHEMA_VERSION = "1.0"


def _no_control_characters(value: str) -> str:
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("control characters are not allowed")
    return value


def _text(max_length: int):
    return Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length),
        AfterValidator(_no_control_characters),
    ]


Station = _text(80)
ShortText = _text(40)
LineText = _text(120)
TitleText = _text(160)
NameText = _text(120)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Recipient(_Model):
    email: EmailStr
    name: NameText | None = None


class Leg(_Model):
    from_station: Station
    to_station: Station
    departure: AwareDatetime
    arrival: AwareDatetime | None = None
    line: LineText | None = None
    train_number: ShortText | None = None
    coach: ShortText | None = None
    seat: ShortText | None = None

    @model_validator(mode="after")
    def _arrival_not_before_departure(self) -> Leg:
        if self.arrival is not None and self.arrival < self.departure:
            raise ValueError("arrival is before departure")
        return self


class Trip(_Model):
    """The price is not part of the input: it is a fixed tariff, see view.PRICE_PER_PERSON_CENTS."""

    reference: ShortText | None = None
    title: TitleText | None = None
    participants_count: Annotated[int, Field(ge=1, le=10_000)]
    travel_class: Literal["1", "2"] | None = None
    legs: Annotated[list[Leg], Field(min_length=1, max_length=12)]
    simulated: bool = False

    @property
    def ordered_legs(self) -> list[Leg]:
        return sorted(self.legs, key=lambda leg: leg.departure)


class RecapRequest(_Model):
    schema_version: Literal["1.0"]
    idempotency_key: Annotated[
        str, StringConstraints(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    ]
    recipient: Recipient
    trip: Trip
    locale: Literal["fr"] = "fr"

    def fingerprint(self) -> str:
        """Digest of the request content; identical requests share it."""
        canonical = json.dumps(
            self.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, separators=(",", ":")
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
