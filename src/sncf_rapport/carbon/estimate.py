"""Round-trip CO2e estimate of a group's train trip against road baselines.

An estimate, not a measurement: see docs/adr/0002-emission-factors.md. Nothing is rounded
here; the view layer formats.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .factors import TRAIN_MODE, Factor

CAR_MODE = "voiture"

# Method paragraph for the report. Fill with `.format(...)`:
#   source_name   Factor.source_name of the train factor
#   retrieved_at  Factor.retrieved_at, formatted for the reader
#   car_people    the car-occupancy clause, e.g. "une personne" or "4 personnes"
METHOD_NOTE_FR = (
    "Ces chiffres sont des estimations, pas des mesures : ils sont obtenus en multipliant la "
    "distance estimée du trajet aller-retour par le nombre de voyageurs et par les facteurs "
    "d'émission moyens publiés par l'ADEME ({source_name}, consultés le {retrieved_at}), qui "
    "couvrent l'usage et la fabrication des véhicules, hors infrastructures. Le train est "
    "comparé à deux trajets de référence sur la même distance : en autocar, et en voiture "
    "thermique avec {car_people} par voiture. Le facteur du TER est une moyenne nationale et "
    "ne reflète pas précisément la ligne empruntée."
)


@dataclass(frozen=True)
class ModeEstimate:
    factor: Factor
    kg_total: float  # whole group, round trip
    kg_per_person: float
    # Grams per passenger-km actually applied: the factor itself, or for a car the factor
    # divided by the occupancy. None only when built by hand without it.
    g_co2e_per_pkm: float | None = None


@dataclass(frozen=True)
class CarbonEstimate:
    distance_km_one_way: float
    passengers: int
    train: ModeEstimate
    baselines: tuple[ModeEstimate, ...]  # in the order requested, modes without a factor skipped
    car_occupancy: float | None  # persons per car used for "voiture", None if not applicable

    def saving_kg(self, mode: str) -> float | None:
        """Baseline minus train for the whole group; None if that baseline is absent."""
        for baseline in self.baselines:
            if baseline.factor.mode == mode:
                return baseline.kg_total - self.train.kg_total
        return None


def _positive(value: float | int | None) -> bool:
    if value is None or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value) and value > 0
    except TypeError:
        return False


def _mode_estimate(
    factor: Factor, g_per_pkm: float, distance_km: float, passengers: int
) -> ModeEstimate:
    kg_total = passengers * distance_km * 2 * g_per_pkm / 1000
    return ModeEstimate(
        factor=factor,
        kg_total=kg_total,
        kg_per_person=kg_total / passengers,
        g_co2e_per_pkm=g_per_pkm,
    )


def estimate(
    *,
    distance_km: float | None,
    passengers: int | None,
    factors: Mapping[str, Factor],
    baselines: Sequence[str] = ("autocar", "voiture"),
    car_occupancy: float | None = None,
) -> CarbonEstimate | None:
    """Estimate for `passengers` people over twice the one-way `distance_km`.

    None when the distance, the head count or the train factor is missing. For "voiture" a
    factor that carries `default_occupancy` is per vehicle-km: it is divided by
    `car_occupancy`, or by that default when the caller gives none.
    """
    train_factor = factors.get(TRAIN_MODE) if factors else None
    if not _positive(distance_km) or not _positive(passengers) or train_factor is None:
        return None

    used_occupancy: float | None = None
    results: list[ModeEstimate] = []
    seen: set[str] = set()
    for mode in baselines:
        factor = factors.get(mode)
        if factor is None or mode == TRAIN_MODE or mode in seen:
            continue
        seen.add(mode)
        g_per_pkm = factor.g_co2e_per_pkm
        if mode == CAR_MODE and factor.default_occupancy is not None:
            used_occupancy = float(
                car_occupancy if _positive(car_occupancy) else factor.default_occupancy
            )
            g_per_pkm = factor.g_co2e_per_pkm / used_occupancy
        results.append(_mode_estimate(factor, g_per_pkm, distance_km, passengers))

    return CarbonEstimate(
        distance_km_one_way=distance_km,
        passengers=passengers,
        train=_mode_estimate(train_factor, train_factor.g_co2e_per_pkm, distance_km, passengers),
        baselines=tuple(results),
        car_occupancy=used_occupancy,
    )
