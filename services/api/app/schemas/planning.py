"""Contract with the trip-planning module owned by teammates, and its simulation.

The request we send is `ConfirmedRequirements` (already published). These models describe what we
expect back. They are a proposal until the teammates' real interface exists; `simulated` is true on
everything produced by the built-in simulation so it can never be mistaken for real availability.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.requirements import CompleteRequirements, ContractModel

PlannerMode = Literal["off", "simulated", "http"]
PlanScenario = Literal["match", "no_match", "error"]


class TrainLeg(ContractModel):
    line: str = Field(
        description="Line label, e.g. 'liO Toulouse – Carcassonne'. No train number in simulation."
    )
    from_station: str
    to_station: str
    departure: str = Field(description="Local ISO date-time with offset (Europe/Paris)")
    arrival: str = Field(description="Local ISO date-time with offset (Europe/Paris)")


class Activity(ContractModel):
    title: str
    description: str
    start: str = Field(description="Local ISO date-time with offset")
    end: str = Field(description="Local ISO date-time with offset")


class Proposal(ContractModel):
    id: str
    title: str
    destination: str
    theme_match: str = Field(description="Why this proposal fits the teacher's subject or theme")
    outbound: TrainLeg
    return_: TrainLeg = Field(alias="return")
    activities: list[Activity]
    participants_count: int = Field(ge=1)
    simulated: bool = Field(
        description="True when produced by the built-in simulation, never real availability"
    )


class PlanResult(ContractModel):
    """What the planner answers for one confirmed set of requirements."""

    request_id: str
    conversation_id: str
    requirements_version: int = Field(ge=0, description="Version of the requirements this plan answers")
    status: Literal["proposals", "no_match"]
    proposals: list[Proposal]
    selected_proposal_id: str | None = None
    planner_mode: Literal["simulated", "http"]
    simulated: bool
    assumptions: list[str] = Field(
        default_factory=list,
        description="French notes shown to the teacher, e.g. the assumed departure station",
    )


class PlanRequest(ContractModel):
    scenario: PlanScenario | None = Field(
        default=None, description="Simulation only: force a scenario to exercise the interface"
    )


class SelectProposalRequest(ContractModel):
    proposal_id: str = Field(min_length=1)


class Handoff(ContractModel):
    """Final payload for the booking step, which is not part of this project."""

    schema_version: Literal["1.0"] = "1.0"
    conversation_id: str
    booking_status: Literal["NOT_RESERVED"] = "NOT_RESERVED"
    requirements: CompleteRequirements
    proposal: Proposal
    simulated: bool
