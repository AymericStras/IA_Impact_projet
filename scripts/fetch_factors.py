#!/usr/bin/env python3
"""Refresh data/emission_factors.json from the public ADEME "Impact CO2" transport API.

    uv run python scripts/fetch_factors.py           # fetch and write
    uv run python scripts/fetch_factors.py --check   # fetch and show what would change

No emission figure is written in this script: every number in the JSON comes from the API
response. See docs/adr/0002-emission-factors.md for what the figures mean.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import httpx

TARGET = Path(__file__).resolve().parents[1] / "data" / "emission_factors.json"

SCHEMA_VERSION = "1.0"
API_URL = "https://impactco2.fr/api/v1/transport"
API_DOC_URL = "https://impactco2.fr/doc/api"
API_VERSION = "Impact CO2 API v1"
SOURCE_NAME = "ADEME, Impact CO2"
FAQ_URL = "https://impactco2.fr/outils/transport"

# The API returns kg CO2e for `km` kilometres; asking for one kilometre gives kg per km.
QUERY_KM = 1
# Persons per car requested from the API (`occupencyRate`, API default). With one person on
# board the car figure is the footprint of the whole vehicle per kilometre.
CAR_OCCUPANCY_REQUESTED = 1
TIMEOUT_S = 20.0

# mode -> (API transport id, French label for the report, page of the figure, note)
MODES: dict[str, dict[str, Any]] = {
    "ter": {
        "api_id": 15,
        "label": "TER",
        "page": "https://impactco2.fr/outils/transport/ter",
        "basis": "passenger_km",
        "note": (
            "Per passenger-km, French national average for regional trains (TER), not specific "
            "to liO Occitanie. Underlying source shown by Impact CO2: Base Empreinte ADEME. "
            "Train occupancy comes from operator data that Impact CO2 does not publish."
        ),
    },
    "autocar": {
        "api_id": 6,
        "label": "Autocar",
        "page": "https://impactco2.fr/outils/transport/autocar",
        "basis": "passenger_km",
        "note": (
            "Per passenger-km, diesel coach ('Autocar thermique'). Impact CO2 assumes an "
            "average of 30 passengers per coach. Underlying source shown by Impact CO2: "
            "Base Empreinte ADEME."
        ),
    },
    "voiture": {
        "api_id": 4,
        "label": "Voiture",
        "page": "https://impactco2.fr/outils/transport/voiturethermique",
        "basis": "vehicle_km",
        "note": (
            "'Voiture thermique' (Impact CO2 default: medium diesel car), requested with one "
            "person on board, so the figure is per vehicle-km: divide by the number of people "
            "in the car (driver included) to get a per-passenger figure. Underlying source "
            "shown by Impact CO2: 'Modélisation de l'empreinte carbone de la voiture - 2025'."
        ),
    },
}

SCOPE_NOTE = (
    "Usage (fuel or electricity) plus construction of the vehicle (includeConstruction=1). "
    "Construction and maintenance of roads, tracks and stations are not included."
)


class FetchError(RuntimeError):
    """The API could not be reached or answered something unusable."""


def _params(include_construction: bool) -> dict[str, str | int]:
    return {
        "km": QUERY_KM,
        "displayAll": 1,
        "transports": ",".join(str(m["api_id"]) for m in MODES.values()),
        "includeConstruction": 1 if include_construction else 0,
        "occupencyRate": CAR_OCCUPANCY_REQUESTED,
        "language": "fr",
    }


def _query(client: httpx.Client, include_construction: bool) -> tuple[str, dict[int, float]]:
    """(URL actually requested, grams CO2e per km by API id)."""
    try:
        response = client.get(API_URL, params=_params(include_construction))
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise FetchError(f"request to {API_URL} failed: {exc}") from exc

    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise FetchError("unexpected response: no 'data' list")
    grams: dict[int, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get("value")
        if isinstance(row.get("id"), int) and isinstance(value, int | float):
            # kg for QUERY_KM km -> g per km; 6 decimals only removes binary float noise.
            grams[row["id"]] = round(float(value) * 1000 / QUERY_KM, 6)
    for mode, spec in MODES.items():
        value = grams.get(spec["api_id"])
        if value is None or not math.isfinite(value) or value <= 0:
            raise FetchError(f"no usable value for {mode!r} (API id {spec['api_id']})")
    return str(response.url), grams


def build_document(client: httpx.Client, today: str) -> dict[str, Any]:
    url, total = _query(client, include_construction=True)
    _, usage = _query(client, include_construction=False)

    factors = []
    for mode in sorted(MODES):
        spec = MODES[mode]
        entry: dict[str, Any] = {
            "mode": mode,
            "label": spec["label"],
            "g_co2e_per_pkm": total[spec["api_id"]],
            "g_co2e_per_pkm_usage_only": usage[spec["api_id"]],
            "basis": spec["basis"],
            "source_name": SOURCE_NAME,
            "source_url": spec["page"],
            "api_url": url,
            "api_id": spec["api_id"],
            "version": API_VERSION,
            "retrieved_at": today,
            "note": spec["note"],
        }
        if spec["basis"] == "vehicle_km":
            entry["default_occupancy"] = CAR_OCCUPANCY_REQUESTED
            entry["default_occupancy_source"] = (
                f"Occupancy requested from the API (occupencyRate={CAR_OCCUPANCY_REQUESTED}, "
                f"its documented default, {API_DOC_URL}): one person per car. No sourced "
                "average occupancy is used; callers may pass their own."
            )
        factors.append(entry)

    return {
        "schema_version": SCHEMA_VERSION,
        "retrieved_at": today,
        "source": {
            "name": SOURCE_NAME,
            "publisher": "ADEME (Agence de la transition écologique)",
            "url": url,
            "documentation_url": API_DOC_URL,
            "methodology_url": FAQ_URL,
            "version": API_VERSION,
            "retrieval": "api",
            "unit": "g CO2e per km (per passenger, or per vehicle when basis is vehicle_km)",
            "scope": SCOPE_NOTE,
        },
        "factors": factors,
    }


def _values(document: dict[str, Any] | None) -> dict[str, tuple[Any, ...]]:
    """What matters for --check: the figures, not the retrieval date."""
    if not isinstance(document, dict):
        return {}
    out = {}
    for item in document.get("factors") or []:
        if isinstance(item, dict) and "mode" in item:
            out[str(item["mode"])] = (
                item.get("g_co2e_per_pkm"),
                item.get("g_co2e_per_pkm_usage_only"),
                item.get("default_occupancy"),
            )
    return out


def _read_existing() -> dict[str, Any] | None:
    try:
        return json.loads(TARGET.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_atomically(text: str) -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=TARGET.parent, prefix=".emission_factors.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(tmp, TARGET)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="print what would change without writing (exit 1 when figures differ)",
    )
    args = parser.parse_args(argv)

    today = dt.date.today().isoformat()
    headers = {"User-Agent": "sncf-rapport fetch_factors (school trip report)"}
    try:
        with httpx.Client(timeout=TIMEOUT_S, headers=headers, follow_redirects=True) as client:
            document = build_document(client, today)
    except FetchError as exc:
        print(f"error: {exc}; {TARGET.name} left untouched", file=sys.stderr)
        return 2

    before, after = _values(_read_existing()), _values(document)
    changed = False
    for mode in sorted(set(before) | set(after)):
        if before.get(mode) == after.get(mode):
            print(f"  {mode}: unchanged {after[mode]}")
        else:
            changed = True
            print(f"  {mode}: {before.get(mode)} -> {after.get(mode)}")

    if args.check:
        print("figures differ from the file" if changed else "figures match the file")
        return 1 if changed else 0

    _write_atomically(json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
