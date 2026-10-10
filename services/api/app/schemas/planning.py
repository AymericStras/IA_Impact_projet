"""Everything after the confirmed requirements: the journey a teacher goes through with the
planning and booking modules owned by teammates.

These models are the proposed contract with those modules and the shape of the built-in simulation.
`simulated` is true on everything the simulation produces, so it can never be mistaken for real
availability, a real booking or a real document.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.requirements import CompleteRequirements, ContractModel

PlannerMode = Literal["off", "simulated", "http"]

JourneyStage = Literal[
    "destinations",  # recommended destinations with places and activities: the teacher chooses
    "itineraries",  # feasible itineraries for the choice: the teacher chooses one
    "adjustments",  # nothing fits as asked: several adjustments that would make it work
    "no_match",  # nothing fits and no reasonable adjustment helps
    "review",  # final check of the chosen itinerary before the booking request
    "booking_pending",  # request submitted, waiting for the booking service
    "booked",  # confirmed by the booking service: the travel file is available
    "booking_refused",  # refused: alternatives are offered
    "closed",  # feedback given after the trip
]
SearchScenario = Literal["auto", "adjustments", "no_match", "error"]
BookingScenario = Literal["confirmed", "refused", "error"]


class Place(ContractModel):
    title: str
    walk_minutes: int = Field(ge=0, description="Walking time from the arrival station")
    note: str = Field(
        description="Opening hours, group access, booking conditions — illustrative in simulation"
    )


class ActivityOption(ContractModel):
    id: str
    title: str
    description: str
    duration_minutes: int = Field(ge=15)


class DestinationOption(ContractModel):
    id: str
    city: str
    station: str
    title: str
    theme_match: str = Field(description="Why it fits the teacher's subject or theme")
    travel_minutes: int = Field(ge=1)
    places: list[Place]
    activities: list[ActivityOption]


class TrainLeg(ContractModel):
    line: str = Field(description="Line label. No train number in simulation.")
    from_station: str
    to_station: str
    departure: str = Field(description="Local ISO date-time with offset (Europe/Paris)")
    arrival: str = Field(description="Local ISO date-time with offset (Europe/Paris)")


class TimedActivity(ContractModel):
    title: str
    start: str
    end: str


class FeasibilityCheck(ContractModel):
    label: str = Field(description="French label of what was checked")
    ok: bool


class Itinerary(ContractModel):
    id: str
    destination_id: str
    title: str
    label: str = Field(description="What distinguishes this option, e.g. « Journée complète »")
    outbound: TrainLeg
    return_: TrainLeg = Field(alias="return")
    activities: list[TimedActivity]
    free_minutes: int = Field(ge=0, description="Time on site not taken by activities or walking")
    checks: list[FeasibilityCheck]
    participants_count: int = Field(ge=1)
    simulated: bool


class RequirementChange(ContractModel):
    field: Literal["departure", "return"]
    before: str = Field(description="HH:MM currently requested")
    after: str = Field(description="HH:MM proposed")


class Adjustment(ContractModel):
    """One way to make the request feasible. Nothing is applied until the teacher accepts it."""

    id: str
    kind: Literal["return_later", "departure_earlier", "fewer_activities", "other_destination"]
    label: str = Field(description="French sentence: what changes")
    reason: str = Field(description="French sentence: why the request does not fit as asked")
    changes: list[RequirementChange] = Field(description="Changes to the confirmed requirements, if any")
    destination_id: str | None = Field(default=None, description="For other_destination")
    activity_ids: list[str] | None = Field(default=None, description="For fewer_activities")
    unlocks: int = Field(ge=1, description="Number of itineraries that become feasible")


class Booking(ContractModel):
    reference: str
    status: Literal["pending", "confirmed", "refused"]
    itinerary_id: str
    message: str = Field(description="French status line for the teacher")
    simulated: bool


class TravelFile(ContractModel):
    """The travel file given to the teacher once the booking is confirmed."""

    reference: str
    title: str
    requirements: CompleteRequirements
    itinerary: Itinerary
    places: list[Place]
    schedule: list[str] = Field(description="French lines of the day's timetable")
    safety_advice: list[str]
    useful_contacts: list[str]
    official_links: list[str] = Field(
        description="Empty in simulation: real links come from the real modules"
    )
    simulated: bool


class Feedback(ContractModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class Journey(ContractModel):
    """Server state of everything after confirmation. The client renders it; it decides nothing."""

    conversation_id: str
    stage: JourneyStage
    requirements_version: int = Field(ge=0)
    planner_mode: Literal["simulated", "http"]
    simulated: bool
    departure_stations: list[str] = Field(description="Stations the departure may use (a city is expanded)")
    notices: list[str] = Field(description="French notes for the teacher (simulation label, assumptions)")
    message: str = Field(description="French line describing the current stage")
    destinations: list[DestinationOption] = Field(default_factory=list)
    selected_destination_id: str | None = None
    selected_activity_ids: list[str] = Field(default_factory=list)
    itineraries: list[Itinerary] = Field(default_factory=list)
    adjustments: list[Adjustment] = Field(default_factory=list)
    accepted_adjustments: list[Adjustment] = Field(default_factory=list)
    selected_itinerary_id: str | None = None
    booking: Booking | None = None
    alternatives: list[Itinerary] = Field(default_factory=list, description="Offered after a refused booking")
    feedback: Feedback | None = None
    search_scenario: SearchScenario = "auto"
    booking_scenario: BookingScenario = "confirmed"
    strict_minutes: int = Field(
        default=0,
        ge=0,
        description="Simulation lever: extra time required on site to exercise the adjustment branch",
    )


class StartJourneyRequest(ContractModel):
    """Scenario switches exist in simulation only, to exercise every branch of the interface."""

    search_scenario: SearchScenario | None = None
    booking_scenario: BookingScenario | None = None


class ChooseDestinationRequest(ContractModel):
    destination_id: str = Field(min_length=1)
    activity_ids: list[str] = Field(default_factory=list, max_length=6)


class AcceptAdjustmentRequest(ContractModel):
    adjustment_id: str = Field(min_length=1)


class ChooseItineraryRequest(ContractModel):
    itinerary_id: str = Field(min_length=1)
