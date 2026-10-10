"""Trip-planning adapter: the real module belongs to teammates; this file holds the boundary.

`SimulatedPlanner` is a deterministic stand-in so the whole flow can be exercised before their
interface exists. It never calls a model and never invents train numbers, prices or availability;
everything it returns is flagged `simulated`. `HttpPlanner` sends the confirmed requirements to the
real service once it exists (see docs/PLANNER_CONTRACT.md).
"""

from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

import httpx
from pydantic import ValidationError

from app.core.errors import AppError
from app.domain.clock import combine_paris
from app.schemas.planning import Activity, PlanScenario, Proposal, TrainLeg
from app.schemas.requirements import ConfirmedRequirements, DateTimeRequirement, TimeConstraint

ORIGIN_STATION = "Toulouse Matabiau"
ORIGIN_ASSUMPTION = f"Gare de départ supposée pour la démonstration : {ORIGIN_STATION} (cette information n'est pas collectée)."
SIMULATION_NOTICE = (
    "Propositions simulées : horaires, lieux et activités illustratifs, sans disponibilité réelle."
)
MIN_VISIT_MINUTES = 90

PLANNER_UNAVAILABLE = (
    "La recherche de propositions a rencontré un problème technique. "
    "Cela ne signifie pas qu'aucun trajet n'existe ; vos informations sont conservées, vous pouvez réessayer."
)


def planner_error() -> AppError:
    return AppError(502, "PLANNER_ERROR", PLANNER_UNAVAILABLE)


class PlannerClient(Protocol):
    mode: str

    def plan(self, confirmed: ConfirmedRequirements, scenario: PlanScenario | None) -> list[Proposal]: ...


@dataclass(frozen=True)
class _Destination:
    city: str
    station: str
    travel_minutes: int
    keywords: tuple[str, ...]
    title: str
    match: str
    activities: tuple[tuple[str, str], ...]


# Illustrative catalogue for the simulation: plausible Occitanie outings, not a data source.
_CATALOGUE: tuple[_Destination, ...] = (
    _Destination(
        "Carcassonne",
        "Carcassonne",
        55,
        ("moyen age", "medieval", "histoire", "chateau", "fortifi", "croisade"),
        "Cité médiévale de Carcassonne",
        "Une cité fortifiée pour aborder le Moyen Âge sur le terrain.",
        (
            ("Visite guidée des remparts", "Parcours commenté des fortifications et du château comtal."),
            ("Atelier « vie au Moyen Âge »", "Atelier pédagogique en demi-groupes."),
        ),
    ),
    _Destination(
        "Albi",
        "Albi-Ville",
        65,
        ("architecture", "art", "cathedrale", "patrimoine", "peinture", "histoire"),
        "Albi, cité épiscopale",
        "Un ensemble architectural en brique pour travailler l'architecture et le patrimoine.",
        (
            ("Cathédrale Sainte-Cécile", "Lecture d'architecture gothique méridionale."),
            ("Parcours dans la cité épiscopale", "Observation et croquis en petits groupes."),
        ),
    ),
    _Destination(
        "Sète",
        "Sète",
        125,
        ("svt", "biodiversite", "sciences", "ecologie", "environnement", "mer", "biologie"),
        "Sète et l'étang de Thau",
        "Un milieu lagunaire pour étudier la biodiversité et les écosystèmes.",
        (
            ("Découverte de l'étang de Thau", "Observation du milieu et des espèces avec un médiateur."),
            ("Atelier d'analyse de l'eau", "Mesures simples et interprétation."),
        ),
    ),
    _Destination(
        "Castelnaudary",
        "Castelnaudary",
        40,
        ("geographie", "canal", "eau", "territoire", "amenagement", "technologie"),
        "Canal du Midi à Castelnaudary",
        "Un ouvrage d'aménagement pour relier géographie, histoire et technique.",
        (
            ("Le Grand Bassin et les écluses", "Lecture de paysage et fonctionnement des écluses."),
            ("Atelier cartographie", "Tracé du canal et repérage sur carte."),
        ),
    ),
    _Destination(
        "Montauban",
        "Montauban Ville-Bourbon",
        35,
        ("francais", "litterature", "arts plastiques", "musee", "dessin", "sculpture"),
        "Montauban, musée Ingres Bourdelle",
        "Un musée pour travailler le dessin, la sculpture et le récit.",
        (
            ("Visite du musée", "Parcours thématique avec un médiateur."),
            ("Atelier de pratique", "Croquis et écriture à partir des œuvres."),
        ),
    ),
)


def _fold(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text.casefold()) if unicodedata.category(c) != "Mn"
    )


def _rank(confirmed: ConfirmedRequirements) -> list[_Destination]:
    teaching = confirmed.requirements.teaching_type
    wanted = _fold(" ".join(part for part in (teaching.subject, teaching.theme) if part))
    scored = [
        (sum(keyword in wanted for keyword in d.keywords), -index, d) for index, d in enumerate(_CATALOGUE)
    ]
    scored.sort(reverse=True)
    return [d for _, _, d in scored]


def _anchor(requirement: DateTimeRequirement, *, outbound: bool) -> datetime:
    """The simulated train time for a requested time and its constraint (never violating it)."""
    wanted = combine_paris(requirement.date, requirement.time)
    shift = {
        TimeConstraint.EXACT: 0,
        TimeConstraint.APPROXIMATE: 5 if outbound else -5,
        TimeConstraint.EARLIEST: 10,
        TimeConstraint.LATEST: -10,
    }[requirement.constraint]
    return wanted + timedelta(minutes=shift)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="minutes")


class SimulatedPlanner:
    mode = "simulated"

    def plan(self, confirmed: ConfirmedRequirements, scenario: PlanScenario | None) -> list[Proposal]:
        if scenario == "error":
            raise planner_error()
        if scenario == "no_match":
            return []
        requirements = confirmed.requirements
        leave = _anchor(requirements.departure, outbound=True)
        back = _anchor(requirements.return_, outbound=False)
        proposals: list[Proposal] = []
        for destination in _rank(confirmed)[:3]:
            travel = timedelta(minutes=destination.travel_minutes)
            arrive_there = leave + travel
            leave_there = back - travel
            visit_start = arrive_there + timedelta(minutes=20)
            visit_end = leave_there - timedelta(minutes=20)
            if (visit_end - visit_start) < timedelta(minutes=MIN_VISIT_MINUTES):
                continue  # the requested day is too short for this destination
            middle = visit_start + (visit_end - visit_start) / 2
            middle = middle.replace(minute=(middle.minute // 5) * 5, second=0, microsecond=0)
            slots = ((visit_start, middle), (middle, visit_end))
            proposals.append(
                Proposal(
                    id=f"sim_{_fold(destination.city)}_{uuid.uuid4().hex[:8]}",
                    title=destination.title,
                    destination=destination.city,
                    theme_match=destination.match,
                    outbound=TrainLeg(
                        line=f"liO {ORIGIN_STATION} – {destination.city} (horaire simulé)",
                        from_station=ORIGIN_STATION,
                        to_station=destination.station,
                        departure=_iso(leave),
                        arrival=_iso(arrive_there),
                    ),
                    return_=TrainLeg(
                        line=f"liO {destination.city} – {ORIGIN_STATION} (horaire simulé)",
                        from_station=destination.station,
                        to_station=ORIGIN_STATION,
                        departure=_iso(leave_there),
                        arrival=_iso(back),
                    ),
                    activities=[
                        Activity(title=title, description=text, start=_iso(start), end=_iso(end))
                        for (title, text), (start, end) in zip(destination.activities, slots, strict=True)
                    ],
                    participants_count=requirements.participants_count,
                    simulated=True,
                )
            )
        return proposals


class HttpPlanner:
    """Client for the teammates' planning service. Untested against a real service until it exists."""

    mode = "http"

    def __init__(
        self, base_url: str, api_key: str | None = None, *, transport: httpx.BaseTransport | None = None
    ) -> None:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(30, connect=5),
            transport=transport,
        )

    def plan(self, confirmed: ConfirmedRequirements, scenario: PlanScenario | None) -> list[Proposal]:
        try:
            response = self._client.post("/plan", json=confirmed.model_dump(mode="json", by_alias=True))
            response.raise_for_status()
            payload = response.json()
            proposals = [Proposal.model_validate(item) for item in payload["proposals"]]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, ValidationError) as exc:
            # A technical failure is never reported as "no proposal".
            raise planner_error() from exc
        if any(p.simulated for p in proposals):
            raise planner_error()  # a real service must not return simulated data
        return proposals
