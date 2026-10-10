"""Build a `TripReportRequest` from what the trip planner already holds.

`travel_file` is the chatbot's TravelFile JSON (sncf_chatbot
`packages/contracts/travel_file.schema.json`). `teacher` is the small JSON the
teacher's confirmation step produces; it has the same shape as the request and
only carries what the planner does not know (school, teacher_feedback, and
optionally education.objectives, environment, media, sources).

Nothing is required: unknown or missing keys are skipped, never guessed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .models import TripReportRequest


def _get(data: Any, *keys: str) -> Any:
    for key in keys:
        if not isinstance(data, Mapping):
            return None
        data = data.get(key)
    return data


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _sequence(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _leg(leg: Any) -> dict[str, Any] | None:
    if not isinstance(leg, Mapping):
        return None
    names = ("line", "train_number", "from_station", "to_station", "departure", "arrival")
    return {name: leg.get(name) for name in names}


def _merge(base: dict[str, Any], overlay: Mapping[str, Any]) -> dict[str, Any]:
    """Overlay wins; dicts merge key by key; None in the overlay keeps the base value."""
    merged = dict(base)
    for key, value in overlay.items():
        if value is None:
            continue
        if isinstance(value, Mapping) and isinstance(merged.get(key), Mapping):
            merged[key] = _merge(dict(merged[key]), value)
        else:
            merged[key] = value
    return merged


def from_travel_file(travel_file: Mapping[str, Any]) -> dict[str, Any]:
    """The inherited part of the request: trip and education."""
    requirements = _mapping(travel_file.get("requirements"))
    itinerary = _mapping(travel_file.get("itinerary"))
    outbound = _leg(itinerary.get("outbound"))
    return_leg = _leg(itinerary.get("return"))
    breakdown = _mapping(requirements.get("participants_breakdown"))

    activities = []
    for index, item in enumerate(_sequence(itinerary.get("activities")), start=1):
        if not isinstance(item, Mapping):
            continue
        activities.append(
            {
                "id": item.get("id") or f"act-{index}",
                "title": item.get("title"),
                "description": item.get("description"),
                "start": item.get("start"),
                "end": item.get("end"),
            }
        )
    places = [
        {
            "title": item.get("title"),
            "note": item.get("note"),
            "walk_minutes": item.get("walk_minutes"),
            "entity_id": item.get("entity_id"),
            "official_url": item.get("official_url"),
            "latitude": item.get("latitude"),
            "longitude": item.get("longitude"),
            "license": item.get("license"),
            "attribution": item.get("attribution"),
        }
        for item in _sequence(travel_file.get("places"))
        if isinstance(item, Mapping)
    ]
    sources = [
        {"label": None, "url": url}
        for url in _sequence(travel_file.get("official_links"))
        if isinstance(url, str) and url
    ]
    return {
        "schema_version": "1.0",
        "trip": {
            "reference": travel_file.get("reference"),
            "title": travel_file.get("title"),
            "date": _get(requirements, "departure", "date"),
            "return_date": _get(requirements, "return", "date"),
            "origin_station": (outbound or {}).get("from_station")
            or requirements.get("departure_station"),
            "destination_station": (outbound or {}).get("to_station"),
            "destination_city": itinerary.get("destination_city"),
            "outbound": outbound,
            "return": return_leg,
            "planned_participants": {
                "total": requirements.get("participants_count")
                or itinerary.get("participants_count"),
                "students": breakdown.get("students"),
                "accompanying": breakdown.get("accompanying"),
            },
            "simulated": bool(travel_file.get("simulated") or itinerary.get("simulated")),
        },
        "education": {
            "subject": _get(requirements, "teaching_type", "subject"),
            "theme": _get(requirements, "teaching_type", "theme"),
            "places": places,
            "activities": activities,
        },
        "sources": sources,
    }


def assemble(
    travel_file: Mapping[str, Any] | None, teacher: Mapping[str, Any] | None
) -> TripReportRequest:
    data = from_travel_file(travel_file) if travel_file else {"schema_version": "1.0"}
    if teacher:
        data = _merge(data, teacher)
    return TripReportRequest.model_validate(data)
