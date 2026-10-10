"""What the request did not supply, and what the report loses because of it.

Every field of the contract is optional, so a request with holes still gives a
PDF. This module is how the integrator finds out: the API returns the list in
its response, the CLI prints it, and the service logs it.

`input_gaps` looks at the request only. Gaps found while deriving the report
(unknown station, no emission factor) are added by `view.build_report_view`
with the same `Gap` type.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

from .models import COMPETENCY_KEYS, TripReportRequest

Severity = Literal["major", "minor"]


@dataclass(frozen=True)
class Gap:
    field: str  # dotted path in the request, e.g. "school.name"
    severity: Severity  # major: a block of the report is empty or missing
    effect: str  # what the reader of the PDF sees instead

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


def _blank(value: object) -> bool:
    return value is None or value == "" or value == [] or value == {}


def input_gaps(request: TripReportRequest) -> list[Gap]:
    gaps: list[Gap] = []

    def need(value: object, field: str, severity: Severity, effect: str) -> None:
        if _blank(value):
            gaps.append(Gap(field, severity, effect))

    school = request.school
    need(school and school.name, "school.name", "major", "Cover shows no school name.")
    need(school and school.class_name, "school.class_name", "major", "Cover shows no class.")
    need(
        school and school.teacher_name,
        "school.teacher_name",
        "minor",
        "The validation block does not name the teacher.",
    )

    trip = request.trip
    need(trip and trip.date, "trip.date", "major", "No trip date anywhere in the report.")
    origin = trip and (trip.origin_station or (trip.outbound and trip.outbound.from_station))
    destination = trip and (
        trip.destination_station or (trip.outbound and trip.outbound.to_station)
    )
    need(origin, "trip.origin_station", "major", "No route map, no distance, no CO2 estimate.")
    need(
        destination,
        "trip.destination_station",
        "major",
        "No route map, no distance, no CO2 estimate.",
    )
    need(trip and trip.outbound, "trip.outbound", "minor", "Outbound train row is empty.")
    need(trip and trip.return_, "trip.return", "minor", "Return train row is empty.")
    for name, leg in (("outbound", trip and trip.outbound), ("return", trip and trip.return_)):
        if leg and _blank(leg.train_number):
            gaps.append(
                Gap(
                    f"trip.{name}.train_number",
                    "minor",
                    "Train number not shown (the planner's simulation has none).",
                )
            )

    education = request.education
    need(
        education and (education.subject or education.theme),
        "education.subject",
        "major",
        "No teaching subject or theme on the cover.",
    )
    need(
        education and education.objectives,
        "education.objectives",
        "minor",
        "The objectives list is hidden.",
    )
    need(
        education and education.activities,
        "education.activities",
        "major",
        "The 'what we did' section has no activity.",
    )
    need(education and education.places, "education.places", "minor", "No visited place listed.")
    for index, place in enumerate((education.places if education else []) or []):
        if _blank(place.official_url):
            gaps.append(
                Gap(
                    f"education.places[{index}].official_url",
                    "minor",
                    "No official link for this place in the sources section.",
                )
            )

    insights = education.insights if education else None
    if not (insights and (insights.why or insights.questions or insights.competencies)):
        gaps.append(
            Gap(
                "education.insights",
                "minor",
                "No 'Pourquoi ce voyage' / 'Pour en parler à la maison' texts: run the enrich "
                "step (needs OPENAI_API_KEY) or supply education.insights.",
            )
        )

    feedback = request.teacher_feedback
    need(
        feedback,
        "teacher_feedback",
        "major",
        "No teacher confirmation: competencies all 'non évaluée', report marked unvalidated.",
    )
    if feedback:
        actual = feedback.actual_participants
        planned = trip and trip.planned_participants
        if _blank(actual and actual.resolved_total()):
            fallback = planned and planned.resolved_total()
            gaps.append(
                Gap(
                    "teacher_feedback.actual_participants",
                    "major",
                    "CO2 estimate uses the planned head count."
                    if fallback
                    else "No head count: cover number and CO2 estimate are missing.",
                )
            )
        need(
            feedback.trip_completed,
            "teacher_feedback.trip_completed",
            "major",
            "The report does not say whether the trip took place as planned.",
        )
        need(
            feedback.competencies,
            "teacher_feedback.competencies",
            "major",
            "All five competencies show 'non évaluée'.",
        )
        if feedback.competencies:
            for key in COMPETENCY_KEYS:
                if getattr(feedback.competencies, key).status == "non_evalue":
                    gaps.append(
                        Gap(
                            f"teacher_feedback.competencies.{key}",
                            "minor",
                            "Shown as 'non évaluée'.",
                        )
                    )
        if education and education.activities and _blank(feedback.completed_activity_ids):
            if feedback.activities_completed != "all":
                gaps.append(
                    Gap(
                        "teacher_feedback.completed_activity_ids",
                        "minor",
                        "Activities are listed without a done / not done mark.",
                    )
                )
        need(
            feedback.observations,
            "teacher_feedback.observations",
            "minor",
            "The teacher's words block is hidden.",
        )
        need(
            feedback.validated_at,
            "teacher_feedback.validated_at",
            "major",
            "The report says it has not been validated by the teacher.",
        )

    photos = request.media.photos if request.media else []
    if not photos:
        gaps.append(Gap("media.photos", "minor", "No photo page."))
    for index, photo in enumerate(photos):
        if not photo.consent:
            gaps.append(
                Gap(
                    f"media.photos[{index}].consent",
                    "minor",
                    "Photo not printed: consent is not true.",
                )
            )
        elif _blank(photo.data_base64) and _blank(photo.path):
            gaps.append(Gap(f"media.photos[{index}]", "minor", "Photo not printed: no image data."))
    return gaps


def summarize(gaps: list[Gap]) -> str:
    """One log line: counts, then the major fields."""
    major = [gap.field for gap in gaps if gap.severity == "major"]
    minor = sum(1 for gap in gaps if gap.severity == "minor")
    if not gaps:
        return "request complete: no missing field"
    text = f"{len(major)} major and {minor} minor missing field(s)"
    return f"{text}; major: {', '.join(major)}" if major else text
