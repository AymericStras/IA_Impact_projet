"""Simulation of the modules owned by teammates: destinations, places and activities, trains,
itineraries, adjustments, booking and the travel file.

Deterministic code over a small illustrative catalogue. It never calls a model and never invents
train numbers, prices or availability; everything it returns is flagged `simulated`. Its purpose
is to let the whole journey — including the awkward branches — be exercised before the real
interfaces exist (docs/PLANNER_CONTRACT.md). Do not grow it into a real planner.
"""

from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.core.errors import AppError
from app.domain.clock import combine_paris, format_time_fr
from app.schemas.planning import (
    ActivityOption,
    Adjustment,
    DestinationOption,
    FeasibilityCheck,
    Itinerary,
    Place,
    RequirementChange,
    TimedActivity,
    TrainLeg,
    TravelFile,
)
from app.schemas.requirements import CompleteRequirements, DateTimeRequirement, TimeConstraint

SIMULATION_NOTICE = (
    "Simulation : destinations, horaires, lieux et réservation sont illustratifs, sans disponibilité réelle."
)
TRAVEL_TIME_NOTICE = "Les durées de trajet simulées ne dépendent pas de la gare de départ indiquée."
PLANNER_UNAVAILABLE = (
    "La recherche a rencontré un problème technique. Cela ne signifie pas qu'aucun trajet n'existe ; "
    "vos informations sont conservées, vous pouvez réessayer."
)
BOOKING_UNAVAILABLE = (
    "Le service de réservation ne répond pas. Votre demande n'a pas été envoyée ; vous pouvez réessayer."
)
WALK_BUFFER_MINUTES = 15
MAX_SHIFT_MINUTES = 90


def planner_error() -> AppError:
    return AppError(502, "PLANNER_ERROR", PLANNER_UNAVAILABLE)


def booking_error() -> AppError:
    return AppError(502, "BOOKING_ERROR", BOOKING_UNAVAILABLE)


# Illustrative expansion of a city into its stations (the real one belongs to the planner).
_CITY_STATIONS: dict[str, tuple[str, ...]] = {
    "toulouse": ("Toulouse Matabiau", "Toulouse Saint-Cyprien-Arènes", "Toulouse Saint-Agne"),
    "montpellier": ("Montpellier Saint-Roch", "Montpellier Sud de France"),
    "nimes": ("Nîmes Centre", "Nîmes Pont-du-Gard"),
    "albi": ("Albi-Ville", "Albi-Madeleine"),
    "narbonne": ("Narbonne",),
    "perpignan": ("Perpignan",),
    "montauban": ("Montauban Ville-Bourbon",),
    "carcassonne": ("Carcassonne",),
    "beziers": ("Béziers",),
    "tarbes": ("Tarbes",),
    "rodez": ("Rodez",),
}


@dataclass(frozen=True)
class _Destination:
    slug: str
    city: str
    station: str
    travel_minutes: int
    keywords: tuple[str, ...]
    title: str
    match: str
    places: tuple[tuple[str, int, str], ...]
    activities: tuple[tuple[str, str, int], ...]


_CATALOGUE: tuple[_Destination, ...] = (
    _Destination(
        "carcassonne",
        "Carcassonne",
        "Carcassonne",
        55,
        ("moyen age", "medieval", "histoire", "chateau", "fortifi", "croisade"),
        "Cité médiévale de Carcassonne",
        "Une cité fortifiée pour aborder le Moyen Âge sur le terrain.",
        (
            ("Cité et remparts", 20, "Accueil des groupes sur réservation ; horaires à confirmer."),
            ("Château comtal", 22, "Visite commentée possible pour les scolaires."),
        ),
        (
            ("Visite guidée des remparts", "Parcours commenté des fortifications.", 90),
            ("Atelier « vie au Moyen Âge »", "Atelier pédagogique en demi-groupes.", 75),
            ("Jeu de piste dans la cité", "Enquête par équipes dans les ruelles.", 60),
        ),
    ),
    _Destination(
        "albi",
        "Albi",
        "Albi-Ville",
        65,
        ("architecture", "art", "cathedrale", "patrimoine", "peinture", "histoire"),
        "Albi, cité épiscopale",
        "Un ensemble en brique pour travailler l'architecture et le patrimoine.",
        (
            ("Cathédrale Sainte-Cécile", 12, "Entrée libre ; visite de groupe à annoncer."),
            ("Musée Toulouse-Lautrec", 14, "Créneaux scolaires sur réservation."),
        ),
        (
            ("Lecture d'architecture à la cathédrale", "Observation guidée du gothique méridional.", 75),
            ("Parcours dans la cité épiscopale", "Croquis et relevés en petits groupes.", 90),
            ("Atelier au musée", "Analyse d'œuvres avec un médiateur.", 60),
        ),
    ),
    _Destination(
        "sete",
        "Sète",
        "Sète",
        125,
        ("svt", "biodiversite", "sciences", "ecologie", "environnement", "mer", "biologie"),
        "Sète et l'étang de Thau",
        "Un milieu lagunaire pour étudier la biodiversité et les écosystèmes.",
        (
            ("Étang de Thau", 18, "Site naturel ; accès libre, médiation sur réservation."),
            ("Musée de la mer", 20, "Accueil des classes en matinée."),
        ),
        (
            ("Découverte de l'étang de Thau", "Observation du milieu avec un médiateur.", 105),
            ("Atelier d'analyse de l'eau", "Mesures simples et interprétation.", 75),
        ),
    ),
    _Destination(
        "castelnaudary",
        "Castelnaudary",
        "Castelnaudary",
        40,
        ("geographie", "canal", "eau", "territoire", "amenagement", "technologie", "patrimoine"),
        "Canal du Midi à Castelnaudary",
        "Un ouvrage d'aménagement pour relier géographie, histoire et technique.",
        (
            ("Grand Bassin", 10, "Accès libre toute l'année."),
            ("Écluses de Saint-Roch", 15, "Démonstration possible selon la navigation."),
        ),
        (
            ("Le Grand Bassin et les écluses", "Lecture de paysage et fonctionnement des écluses.", 75),
            ("Atelier cartographie", "Tracé du canal et repérage sur carte.", 60),
        ),
    ),
    _Destination(
        "montauban",
        "Montauban",
        "Montauban Ville-Bourbon",
        35,
        ("francais", "litterature", "arts plastiques", "musee", "dessin", "sculpture", "art"),
        "Montauban, musée Ingres Bourdelle",
        "Un musée pour travailler le dessin, la sculpture et le récit.",
        (
            ("Musée Ingres Bourdelle", 15, "Créneaux scolaires sur réservation."),
            ("Place Nationale", 12, "Espace public ; accès libre."),
        ),
        (
            ("Visite du musée", "Parcours thématique avec un médiateur.", 75),
            ("Atelier de pratique", "Croquis et écriture à partir des œuvres.", 75),
        ),
    ),
)
_BY_SLUG = {d.slug: d for d in _CATALOGUE}


def _fold(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text.casefold()) if unicodedata.category(c) != "Mn"
    )


def _stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:10]
    return f"{prefix}_{digest}"


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="minutes")


def departure_stations(station_or_city: str) -> list[str]:
    """A city means any of its stations; a station (or an unknown place) is kept as said."""
    return list(_CITY_STATIONS.get(_fold(station_or_city).strip(), (station_or_city,)))


def recommend_destinations(requirements: CompleteRequirements) -> list[DestinationOption]:
    """Destinations ranked by how well they match the teacher's subject and theme."""
    teaching = requirements.teaching_type
    wanted = _fold(" ".join(part for part in (teaching.subject, teaching.theme) if part))
    origins = {_fold(s) for s in departure_stations(requirements.departure_station)}
    ranked = sorted(
        (d for d in _CATALOGUE if _fold(d.station) not in origins and _fold(d.city) not in origins),
        key=lambda d: (-sum(keyword in wanted for keyword in d.keywords), _CATALOGUE.index(d)),
    )
    return [
        DestinationOption(
            id=d.slug,
            city=d.city,
            station=d.station,
            title=d.title,
            theme_match=d.match,
            travel_minutes=d.travel_minutes,
            places=[Place(title=title, walk_minutes=walk, note=note) for title, walk, note in d.places],
            activities=[
                ActivityOption(
                    id=f"{d.slug}-{index + 1}", title=title, description=text, duration_minutes=minutes
                )
                for index, (title, text, minutes) in enumerate(d.activities)
            ],
        )
        for d in ranked[:4]
    ]


def _anchor(requirement: DateTimeRequirement, *, outbound: bool) -> datetime:
    """The simulated train time for a requested time: it never violates the constraint."""
    wanted = combine_paris(requirement.date, requirement.time)
    shift = {
        TimeConstraint.EXACT: 0,
        TimeConstraint.APPROXIMATE: 5 if outbound else -5,
        TimeConstraint.EARLIEST: 10,
        TimeConstraint.LATEST: -10,
    }[requirement.constraint]
    return wanted + timedelta(minutes=shift)


def _chosen(destination: _Destination, activity_ids: list[str]) -> list[tuple[str, int]]:
    by_id = {
        f"{destination.slug}-{i + 1}": (title, minutes)
        for i, (title, _, minutes) in enumerate(destination.activities)
    }
    unknown = [a for a in activity_ids if a not in by_id]
    if unknown:
        raise AppError(409, "UNKNOWN_ACTIVITY", "Cette activité n'existe pas pour la destination choisie.")
    return [by_id[a] for a in activity_ids] or [by_id[f"{destination.slug}-1"]]


def _walk(destination: _Destination) -> int:
    return max(walk for _, walk, _ in destination.places)


def build_itineraries(
    requirements: CompleteRequirements,
    destination_id: str,
    activity_ids: list[str],
    *,
    strict_minutes: int = 0,
) -> list[Itinerary]:
    """Feasible itineraries for one destination and the chosen activities (empty when none fits).

    `strict_minutes` is a test lever: it inflates the time needed on site so that the
    adjustment branch can be exercised on any request.
    """
    destination = _BY_SLUG.get(destination_id)
    if destination is None:
        raise AppError(
            409, "UNKNOWN_DESTINATION", "Cette destination n'est plus proposée. Relancez la recherche."
        )
    activities = _chosen(destination, activity_ids)
    needed = sum(minutes for _, minutes in activities) + strict_minutes
    walk = _walk(destination)
    travel = timedelta(minutes=destination.travel_minutes)
    leave = _anchor(requirements.departure, outbound=True)
    back = _anchor(requirements.return_, outbound=False)
    origins = departure_stations(requirements.departure_station)

    variants: list[tuple[str, timedelta, timedelta]] = [("Journée complète", timedelta(0), timedelta(0))]
    if requirements.return_.constraint in (TimeConstraint.LATEST, TimeConstraint.APPROXIMATE):
        variants.append(("Retour anticipé", timedelta(0), timedelta(minutes=-60)))
    if requirements.departure.constraint in (TimeConstraint.EARLIEST, TimeConstraint.APPROXIMATE):
        variants.append(("Départ décalé", timedelta(minutes=30), timedelta(0)))

    itineraries: list[Itinerary] = []
    for index, (label, leave_shift, back_shift) in enumerate(variants):
        depart, arrive_home = leave + leave_shift, back + back_shift
        arrive_there, leave_there = depart + travel, arrive_home - travel
        on_site = int((leave_there - arrive_there).total_seconds() // 60) - 2 * walk - WALK_BUFFER_MINUTES
        if on_site < needed:
            continue
        origin = origins[index % len(origins)]
        cursor = arrive_there + timedelta(minutes=walk + WALK_BUFFER_MINUTES)
        timed: list[TimedActivity] = []
        gap = max(0, (on_site - (needed - strict_minutes)) // max(1, len(activities)))
        for title, minutes in activities:
            end = cursor + timedelta(minutes=minutes)
            timed.append(TimedActivity(title=title, start=_iso(cursor), end=_iso(end)))
            cursor = end + timedelta(minutes=min(gap, 60))
        itineraries.append(
            Itinerary(
                id=_stable_id("iti", destination.slug, label, _iso(depart), _iso(arrive_home), *activity_ids),
                destination_id=destination.slug,
                title=destination.title,
                label=label,
                outbound=TrainLeg(
                    line=f"liO {origin} – {destination.city} (horaire simulé)",
                    from_station=origin,
                    to_station=destination.station,
                    departure=_iso(depart),
                    arrival=_iso(arrive_there),
                ),
                return_=TrainLeg(
                    line=f"liO {destination.city} – {origin} (horaire simulé)",
                    from_station=destination.station,
                    to_station=origin,
                    departure=_iso(leave_there),
                    arrival=_iso(arrive_home),
                ),
                activities=timed,
                free_minutes=max(0, on_site - (needed - strict_minutes)),
                checks=[
                    FeasibilityCheck(label="Horaires de départ et de retour respectés", ok=True),
                    FeasibilityCheck(
                        label=f"Capacité pour {requirements.participants_count} participants (simulée)",
                        ok=True,
                    ),
                    FeasibilityCheck(label=f"Lieux à {walk} minutes à pied de la gare au plus", ok=True),
                    FeasibilityCheck(label="Temps sur place suffisant pour les activités choisies", ok=True),
                ],
                participants_count=requirements.participants_count,
                simulated=True,
            )
        )
    return itineraries


def _shifted(
    requirements: CompleteRequirements, field: str, minutes: int
) -> tuple[CompleteRequirements, RequirementChange]:
    current: DateTimeRequirement = requirements.return_ if field == "return" else requirements.departure
    moved = combine_paris(current.date, current.time) + timedelta(minutes=minutes)
    after = moved.strftime("%H:%M")
    update = current.model_copy(update={"time": after})
    changed = requirements.model_copy(update={"return_" if field == "return" else "departure": update})
    return changed, RequirementChange(field=field, before=current.time, after=after)


def propose_adjustments(
    requirements: CompleteRequirements,
    destination_id: str,
    activity_ids: list[str],
    *,
    strict_minutes: int = 0,
) -> list[Adjustment]:
    """Several concrete ways to make the request feasible; only those that really unlock itineraries."""
    destination = _BY_SLUG[destination_id]
    reason = (
        f"Le temps disponible à {destination.city} entre l'arrivée et le départ du train de retour "
        "est trop court pour les activités choisies."
    )
    options: list[Adjustment] = []

    def add(kind: str, label: str, unlocked: list[Itinerary], **extra: object) -> None:
        if unlocked:
            options.append(
                Adjustment(
                    id=_stable_id("adj", kind, label),
                    kind=kind,
                    label=label,
                    reason=reason,
                    unlocks=len(unlocked),
                    **extra,
                )
            )

    same_day_limit = combine_paris(requirements.return_.date, "23:00")
    for minutes in (30, 60, MAX_SHIFT_MINUTES):
        if (
            combine_paris(requirements.return_.date, requirements.return_.time) + timedelta(minutes=minutes)
            > same_day_limit
        ):
            continue
        changed, change = _shifted(requirements, "return", minutes)
        add(
            "return_later",
            f"Retour à {format_time_fr(change.after)} au lieu de {format_time_fr(change.before)}",
            build_itineraries(changed, destination_id, activity_ids, strict_minutes=strict_minutes),
            changes=[change],
        )
    for minutes in (30, 60, MAX_SHIFT_MINUTES):
        if combine_paris(requirements.departure.date, requirements.departure.time) - timedelta(
            minutes=minutes
        ) < combine_paris(requirements.departure.date, "06:00"):
            continue
        changed, change = _shifted(requirements, "departure", -minutes)
        add(
            "departure_earlier",
            f"Départ à {format_time_fr(change.after)} au lieu de {format_time_fr(change.before)}",
            build_itineraries(changed, destination_id, activity_ids, strict_minutes=strict_minutes),
            changes=[change],
        )
    chosen_ids = activity_ids or [f"{destination.slug}-1"]
    if len(chosen_ids) > 1:
        shortest = min(chosen_ids, key=lambda a: _chosen(destination, [a])[0][1])
        title = _chosen(destination, [shortest])[0][0]
        add(
            "fewer_activities",
            f"Une seule activité : {title}",
            build_itineraries(requirements, destination_id, [shortest], strict_minutes=strict_minutes),
            changes=[],
            activity_ids=[shortest],
        )
    for other in recommend_destinations(requirements):
        if other.id == destination_id or other.travel_minutes >= destination.travel_minutes:
            continue
        first = [other.activities[0].id]
        add(
            "other_destination",
            f"Une destination plus proche : {other.title} ({other.travel_minutes} min de trajet)",
            build_itineraries(requirements, other.id, first, strict_minutes=strict_minutes),
            changes=[],
            destination_id=other.id,
            activity_ids=first,
        )
    # Keep the list readable: the smallest change of each kind first, then the larger ones.
    primary: list[Adjustment] = []
    for option in options:
        if all(option.kind != kept.kind for kept in primary):
            primary.append(option)
    return (primary + [o for o in options if o not in primary])[:6]


def booking_reference(conversation_id: str, itinerary_id: str) -> str:
    return "SIM-" + hashlib.sha256(f"{conversation_id}|{itinerary_id}".encode()).hexdigest()[:8].upper()


def travel_file(requirements: CompleteRequirements, itinerary: Itinerary, reference: str) -> TravelFile:
    destination = _BY_SLUG[itinerary.destination_id]

    def hhmm(value: str) -> str:
        return format_time_fr(datetime.fromisoformat(value).strftime("%H:%M"))

    schedule = [
        f"{hhmm(itinerary.outbound.departure)} — Départ de {itinerary.outbound.from_station}",
        f"{hhmm(itinerary.outbound.arrival)} — Arrivée à {itinerary.outbound.to_station}",
        *[f"{hhmm(a.start)} – {hhmm(a.end)} — {a.title}" for a in itinerary.activities],
        f"{hhmm(itinerary.return_.departure)} — Départ de {itinerary.return_.from_station}",
        f"{hhmm(itinerary.return_.arrival)} — Retour à {itinerary.return_.to_station}",
    ]
    return TravelFile(
        reference=reference,
        title=f"Sortie pédagogique — {destination.title}",
        requirements=requirements,
        itinerary=itinerary,
        places=[Place(title=title, walk_minutes=walk, note=note) for title, walk, note in destination.places],
        schedule=schedule,
        safety_advice=[
            "Compter les élèves à chaque montée et descente de train.",
            "Prévoir la liste des participants et les numéros d'urgence des familles.",
            "Désigner un adulte en tête et un adulte en fin de groupe pour les trajets à pied.",
            "Arriver en gare 20 minutes avant le départ.",
        ],
        useful_contacts=[
            "Accueil groupes de la gare de départ (coordonnées fournies par le module de réservation)",
            "Lieu d'accueil sur place (coordonnées fournies par le module d'activités)",
            "Numéro d'urgence européen : 112",
        ],
        official_links=[],
        simulated=True,
    )
