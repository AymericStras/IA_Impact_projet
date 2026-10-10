"""CO2e estimate of the rail trip against road baselines.

Public interface (frozen; `view.py` depends on it):

    factors = load_factors(path)                 # dict[str, Factor]; {} when the file is absent
    result = estimate(distance_km=91.0, passengers=30, factors=factors,
                      baselines=("autocar", "voiture"), car_occupancy=None)
    # CarbonEstimate | None (None when distance, passengers or the train factor is missing)
"""

from __future__ import annotations

from .estimate import CarbonEstimate, ModeEstimate, estimate
from .factors import Factor, load_factors

__all__ = ["CarbonEstimate", "Factor", "ModeEstimate", "estimate", "load_factors"]
