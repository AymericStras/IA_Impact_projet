"""Input contract: `TripReportRequest`.

Every field is optional on purpose. The module is merged into the team
repository by someone else and the upstream field names are not final, so a
request is never refused for a missing value; the report shows
« non communiqué » instead and `gaps.py` tells the integrator what was missing.
"""

from __future__ import annotations

from datetime import date as Date  # noqa: N812 - `date` is also a field name
from datetime import datetime
from typing import Literal

from annotated_types import MaxLen
from pydantic import BaseModel, ConfigDict, Field, model_validator

CompetencyStatus = Literal["acquis", "partiel", "non_evalue"]
TripCompletion = Literal["completed", "partial", "cancelled"]
ActivitiesCompletion = Literal["all", "partial", "none"]
Baseline = Literal["autocar", "voiture"]
PhotoKind = Literal["trip", "documentary"]

COMPETENCY_KEYS = (
    "savoir",
    "savoir_faire",
    "savoir_se_deplacer",
    "savoir_s_orienter",
    "savoir_etre",
)


# Lists longer than this are cut, not refused: a report with 400 activities is
# a wiring mistake upstream, and the PDF must still come out.
LIST_CAPS = {
    "questions": 4,
    "objectives": 12,
    "places": 20,
    "activities": 30,
    "completed_activity_ids": 60,
    "photos": 12,
    "sources": 40,
    "baselines": 4,
}
# Lists of plain text: every item is cleaned and cut to this length.
TEXT_LISTS = {"objectives": 300, "questions": 220, "completed_activity_ids": 80}
ELLIPSIS = "…"


def clean_text(value: str) -> str:
    """Drop control and unpaired-surrogate characters; keep newlines and tabs as spaces."""
    cleaned = []
    for char in value:
        code = ord(char)
        if char in "\n\r\t":
            cleaned.append(" " if char != "\n" else "\n")
        elif code < 32 or 127 <= code < 160 or 0xD800 <= code <= 0xDFFF:
            continue
        elif code in (0xFFFE, 0xFFFF) or 0x202A <= code <= 0x202E or 0x2066 <= code <= 0x2069:
            continue  # non-characters and bidirectional overrides
        else:
            cleaned.append(char)
    return "".join(cleaned)


class _Model(BaseModel):
    """Shared input hygiene: bad text is cleaned and long text is cut, never refused.

    Only a value of the wrong kind (unknown enum value, text where a number is
    expected, a count out of range) fails validation.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    @model_validator(mode="before")
    @classmethod
    def _sanitize(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        result = dict(data)
        for name, info in cls.model_fields.items():
            key = info.alias if info.alias in result else name
            value = result.get(key)
            if isinstance(value, str):
                value = clean_text(value).strip()
                limit = next((m.max_length for m in info.metadata if isinstance(m, MaxLen)), None)
                if limit is not None and len(value) > limit:
                    value = value[: limit - 1].rstrip() + ELLIPSIS
                # An empty string means "not supplied".
                result[key] = value if value else None
            elif isinstance(value, list):
                cap = LIST_CAPS.get(name)
                items = value[:cap] if cap is not None else value
                limit = TEXT_LISTS.get(name)
                if limit is not None:
                    texts = [clean_text(item).strip() for item in items if isinstance(item, str)]
                    items = [
                        text if len(text) <= limit else text[: limit - 1].rstrip() + ELLIPSIS
                        for text in texts
                        if text
                    ]
                result[key] = items
        return result


class School(_Model):
    name: str | None = Field(default=None, max_length=120)
    class_name: str | None = Field(default=None, max_length=60)
    teacher_name: str | None = Field(default=None, max_length=80)
    city: str | None = Field(default=None, max_length=80)


class Participants(_Model):
    total: int | None = Field(default=None, ge=0, le=2000)
    students: int | None = Field(default=None, ge=0, le=2000)
    accompanying: int | None = Field(default=None, ge=0, le=500)

    def resolved_total(self) -> int | None:
        if self.total is not None:
            return self.total
        if self.students is None and self.accompanying is None:
            return None
        return (self.students or 0) + (self.accompanying or 0)


class TrainLeg(_Model):
    line: str | None = Field(default=None, max_length=160)
    train_number: str | None = Field(default=None, max_length=20)
    from_station: str | None = Field(default=None, max_length=120)
    to_station: str | None = Field(default=None, max_length=120)
    departure: datetime | None = None
    arrival: datetime | None = None


class Trip(_Model):
    reference: str | None = Field(default=None, max_length=40)
    title: str | None = Field(default=None, max_length=160)
    date: Date | None = None
    return_date: Date | None = None
    origin_station: str | None = Field(default=None, max_length=120)
    destination_station: str | None = Field(default=None, max_length=120)
    destination_city: str | None = Field(default=None, max_length=80)
    outbound: TrainLeg | None = None
    return_: TrainLeg | None = Field(default=None, alias="return")
    planned_participants: Participants | None = None
    simulated: bool = False

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True, populate_by_name=True)


class Place(_Model):
    title: str | None = Field(default=None, max_length=160)
    note: str | None = Field(default=None, max_length=400)
    entity_id: str | None = Field(default=None, max_length=80)
    official_url: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    license: str | None = Field(default=None, max_length=120)
    attribution: str | None = Field(default=None, max_length=200)
    walk_minutes: int | None = Field(default=None, ge=0, le=600)


class Activity(_Model):
    id: str | None = Field(default=None, max_length=80)
    title: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=600)
    start: datetime | None = None
    end: datetime | None = None


class CompetencyInsights(_Model):
    savoir: str | None = Field(default=None, max_length=280)
    savoir_faire: str | None = Field(default=None, max_length=280)
    savoir_se_deplacer: str | None = Field(default=None, max_length=280)
    savoir_s_orienter: str | None = Field(default=None, max_length=280)
    savoir_etre: str | None = Field(default=None, max_length=280)


class Insights(_Model):
    """Short texts on the educational value of the trip.

    Written by `enrich.py` with a language model, or supplied by the caller.
    They describe what the trip let the class work on; they never state a
    result, which only `teacher_feedback.competencies` does.
    """

    why: str | None = Field(default=None, max_length=700)
    competencies: CompetencyInsights | None = None
    questions: list[str] = Field(default_factory=list)
    origin: Literal["ai", "teacher"] = "ai"
    model: str | None = Field(default=None, max_length=80)
    generated_at: datetime | None = None
    reviewed_by_teacher: bool = False


class Education(_Model):
    subject: str | None = Field(default=None, max_length=80)
    theme: str | None = Field(default=None, max_length=120)
    objectives: list[str] = Field(default_factory=list)
    places: list[Place] = Field(default_factory=list)
    activities: list[Activity] = Field(default_factory=list)
    insights: Insights | None = None


class Competency(_Model):
    status: CompetencyStatus = "non_evalue"
    comment: str | None = Field(default=None, max_length=600)


class Competencies(_Model):
    savoir: Competency = Field(default_factory=Competency)
    savoir_faire: Competency = Field(default_factory=Competency)
    savoir_se_deplacer: Competency = Field(default_factory=Competency)
    savoir_s_orienter: Competency = Field(default_factory=Competency)
    savoir_etre: Competency = Field(default_factory=Competency)


class TeacherFeedback(_Model):
    trip_completed: TripCompletion | None = None
    actual_participants: Participants | None = None
    activities_completed: ActivitiesCompletion | None = None
    completed_activity_ids: list[str] = Field(default_factory=list)
    changes: str | None = Field(default=None, max_length=1500)
    competencies: Competencies | None = None
    observations: str | None = Field(default=None, max_length=3000)
    validated_at: datetime | None = None


class Environment(_Model):
    baselines: list[Baseline] = Field(default_factory=lambda: ["autocar", "voiture"])
    distance_km_override: float | None = Field(default=None, ge=0, le=5000)
    car_occupancy: float | None = Field(default=None, gt=0, le=9)


class Photo(_Model):
    data_base64: str | None = None
    path: str | None = Field(default=None, max_length=500)
    media_type: str | None = Field(default=None, max_length=60)
    caption: str | None = Field(default=None, max_length=300)
    taken_at: datetime | None = None
    consent: bool = False
    kind: PhotoKind = "trip"


class Media(_Model):
    photos: list[Photo] = Field(default_factory=list)


class Source(_Model):
    label: str | None = Field(default=None, max_length=200)
    url: str | None = Field(default=None, max_length=500)
    retrieved_at: datetime | None = None


class TripReportRequest(_Model):
    schema_version: Literal["1.0"] = "1.0"
    locale: Literal["fr"] = "fr"
    school: School | None = None
    trip: Trip | None = None
    education: Education | None = None
    teacher_feedback: TeacherFeedback | None = None
    environment: Environment | None = None
    media: Media | None = None
    sources: list[Source] = Field(default_factory=list)
