"""Emission factors read from data/emission_factors.json (written by scripts/fetch_factors.py)."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TRAIN_MODE = "ter"


@dataclass(frozen=True)
class Factor:
    mode: str  # "ter" | "autocar" | "voiture"
    label: str  # French label shown in the report, e.g. "Autocar"
    g_co2e_per_pkm: float  # grams CO2e per passenger-kilometre
    source_name: str
    source_url: str
    version: str | None
    retrieved_at: str  # ISO date
    note: str | None = None  # e.g. the occupancy assumed by the source for a car
    # Set only when `g_co2e_per_pkm` is really per vehicle-km (a car with this many people
    # on board): the per-passenger figure is then the factor divided by the actual occupancy.
    default_occupancy: float | None = None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _positive(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) and number > 0 else None


def _parse(item: Any) -> Factor | None:
    if not isinstance(item, dict):
        return None
    mode, label = _text(item.get("mode")), _text(item.get("label"))
    grams = _positive(item.get("g_co2e_per_pkm"))
    source_name, source_url = _text(item.get("source_name")), _text(item.get("source_url"))
    retrieved_at = _text(item.get("retrieved_at"))
    if not (mode and label and grams and source_name and source_url and retrieved_at):
        return None
    return Factor(
        mode=mode,
        label=label,
        g_co2e_per_pkm=grams,
        source_name=source_name,
        source_url=source_url,
        version=_text(item.get("version")),
        retrieved_at=retrieved_at,
        note=_text(item.get("note")),
        default_occupancy=_positive(item.get("default_occupancy")),
    )


def load_factors(path: Path) -> dict[str, Factor]:
    """Factors by mode; an empty dict when the file is missing or unreadable.

    Malformed entries are skipped; this never raises.
    """
    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    items = document.get("factors") if isinstance(document, dict) else None
    if not isinstance(items, list):
        return {}
    factors: dict[str, Factor] = {}
    for item in items:
        factor = _parse(item)
        if factor is not None:
            factors[factor.mode] = factor
    return factors
