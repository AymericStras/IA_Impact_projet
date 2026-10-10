"""Station lookup and shortest rail path over the bundled Occitanie data set.

The connection file mixes omnibus pairs (consecutive TER stops) with long non-stop pairs
(TGV, Intercités). A route is chosen by mean duration, then every long non-stop pair is
replaced by the chain of consecutive stops lying along it, so that the geometry follows the
track and the distance is not the length of a straight chord.
"""

from __future__ import annotations

import csv
import heapq
import math
import re
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

EARTH_RADIUS_KM = 6371.0088

# A non-stop pair is replaced by a chain of shorter pairs when the chain is at most this much
# longer than the chord: a chain that follows the same track is only slightly longer, while
# a chain going around through another line is not the same track.
_MAX_DETOUR = 1.4
# The chain may only use pairs clearly shorter than the pair it replaces.
_FINER = 0.8

_DURATION = re.compile(r"(?:(\d+)\s+days?\s+)?(\d+):(\d+):(\d+(?:\.\d+)?)")
_LEADING_WORDS = re.compile(r"^(?:gare\s+)?(?:sncf\s+)?(?:(?:de\s+la|de|du|des|d)\s+)?")


@dataclass(frozen=True)
class Station:
    id: str  # UIC code, 8 digits
    name: str
    latitude: float
    longitude: float
    commune: str = ""


@dataclass(frozen=True)
class MapPoint:
    """A visited place to mark on the map."""

    label: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class Route:
    stations: tuple[Station, ...]  # origin first, destination last, every stop in between
    distance_km: float  # sum of great-circle segment lengths: an estimate
    duration_min: float | None  # sum of mean segment durations from the data set

    @property
    def origin(self) -> Station:
        return self.stations[0]

    @property
    def destination(self) -> Station:
        return self.stations[-1]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in kilometres."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def normalize_name(text: str | None) -> str:
    """Comparison key: no case, accents, punctuation, "gare de" prefix; "st" reads "saint"."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text.replace("œ", "oe").replace("Œ", "OE"))
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    plain = re.sub(r"[^a-z0-9]+", " ", plain).strip()
    plain = _LEADING_WORDS.sub("", plain)
    words = ["saint" if w == "st" else "sainte" if w == "ste" else w for w in plain.split()]
    return " ".join(words)


def _parse_duration_min(text: str | None) -> float | None:
    """Minutes from pandas timedelta text ("0 days 00:12:54"); None when unreadable."""
    match = _DURATION.search(text or "")
    if not match:
        return None
    days, hours, minutes, seconds = match.groups()
    total = int(days or 0) * 1440 + int(hours) * 60 + int(minutes) + float(seconds) / 60
    return total if total > 0 else None


class Network:
    def __init__(
        self,
        stations: Iterable[Station],
        durations: dict[tuple[str, str], float | None],
    ) -> None:
        self._stations: dict[str, Station] = {s.id: s for s in stations}
        self._durations: dict[tuple[str, str], float | None] = {}
        self._adjacent: dict[str, dict[str, float]] = {sid: {} for sid in self._stations}
        for (a, b), minutes in durations.items():
            if a == b or a not in self._stations or b not in self._stations:
                continue
            key = (a, b) if a < b else (b, a)
            known = self._durations.get(key)
            if key not in self._durations or (
                minutes is not None and (known is None or minutes < known)
            ):
                self._durations[key] = minutes
            length = self._km(a, b)
            self._adjacent[a][b] = length
            self._adjacent[b][a] = length
        self._by_name: dict[str, list[Station]] = {}
        self._by_commune: dict[str, list[Station]] = {}
        for station in self._stations.values():
            self._by_name.setdefault(normalize_name(station.name), []).append(station)
            commune = normalize_name(station.commune)
            if commune:
                self._by_commune.setdefault(commune, []).append(station)
        self._expansions: dict[tuple[str, str], tuple[str, ...]] = {}

    @classmethod
    def load(cls, stations_csv: Path, connections_csv: Path) -> Network:
        stations: list[Station] = []
        with Path(stations_csv).open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                try:
                    station = Station(
                        id=(row.get("id") or "").strip(),
                        name=(row.get("name") or "").strip(),
                        latitude=float(row["latitude"]),
                        longitude=float(row["longitude"]),
                        commune=(row.get("commune") or "").strip(),
                    )
                except (KeyError, TypeError, ValueError):
                    continue
                if station.id and station.name:
                    stations.append(station)
        durations: dict[tuple[str, str], float | None] = {}
        with Path(connections_csv).open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                a = (row.get("stop_id_clean") or "").strip()
                b = (row.get("next_stop_id_clean") or "").strip()
                if not a or not b or a == b:
                    continue
                key = (a, b) if a < b else (b, a)
                minutes = _parse_duration_min(row.get("duration_min_mean"))
                known = durations.get(key)
                if key not in durations or (
                    minutes is not None and (known is None or minutes < known)
                ):
                    durations[key] = minutes
        return cls(stations, durations)

    # ------------------------------------------------------------------ public helpers

    @property
    def stations(self) -> tuple[Station, ...]:
        """Every station of the data set, connected or not."""
        return tuple(self._stations.values())

    @property
    def segments(self) -> tuple[tuple[Station, Station], ...]:
        """Pairs of consecutive stops: the drawable network, without long non-stop chords."""
        pairs = []
        for a, b in self._durations:
            if len(self._expand(a, b)) == 2:
                pairs.append((self._stations[a], self._stations[b]))
        return tuple(pairs)

    def degree(self, station: Station) -> int:
        """Number of stations directly connected to this one."""
        return len(self._adjacent.get(station.id, ()))

    def importance(self, station: Station) -> float:
        """Total length of the direct connections: high where long non-stop trains call."""
        return sum(self._adjacent.get(station.id, {}).values())

    # ------------------------------------------------------------------ station lookup

    def find_station(self, name: str | None) -> Station | None:
        """Station matching a free-text name or a city ("Toulouse" -> Toulouse Matabiau)."""
        if not isinstance(name, str):
            return None
        query = normalize_name(name)
        if not query:
            return None
        exact = self._by_name.get(query, [])
        if len(exact) == 1:
            return exact[0]
        if exact:
            return self._clear_winner(exact)
        in_commune = self._by_commune.get(query)
        if in_commune:
            return self._clear_winner(in_commune)
        padded = f" {query} "
        prefixed = [
            s for key, group in self._by_name.items() if key.startswith(query + " ") for s in group
        ]
        if prefixed:
            return prefixed[0] if len(prefixed) == 1 else None
        containing = [
            s for key, group in self._by_name.items() if padded in f" {key} " for s in group
        ]
        if len(containing) == 1:
            return containing[0]
        if containing:
            return None
        # The text may hold more than the name ("Toulouse Matabiau (Haute-Garonne)").
        inside = [s for key, group in self._by_name.items() if f" {key} " in padded for s in group]
        if inside:
            longest = max(len(normalize_name(s.name)) for s in inside)
            best = [s for s in inside if len(normalize_name(s.name)) == longest]
            return best[0] if len(best) == 1 else None
        return None

    def _clear_winner(self, candidates: list[Station]) -> Station | None:
        """The candidate with strictly the most connections (the main station), else None."""
        if len(candidates) == 1:
            return candidates[0]
        ranked = sorted(candidates, key=self.degree, reverse=True)
        if self.degree(ranked[0]) > self.degree(ranked[1]):
            return ranked[0]
        return None

    # ------------------------------------------------------------------ routing

    def route(self, origin: str | None, destination: str | None) -> Route | None:
        """Shortest path by mean duration; None when a station is unknown or unreachable."""
        start = self.find_station(origin)
        end = self.find_station(destination)
        if start is None or end is None or start.id == end.id:
            return None
        # Tiny distance term: breaks ties and keeps pairs without a duration usable.
        fastest = self._shortest(start.id, end.id, self._time_cost)
        if fastest is None:
            return None
        minutes: float | None = 0.0
        for a, b in zip(fastest, fastest[1:], strict=False):
            step = self._durations.get((a, b) if a < b else (b, a))
            if step is None or minutes is None:
                minutes = None
            else:
                minutes += step
        stops = [fastest[0]]
        for a, b in zip(fastest, fastest[1:], strict=False):
            stops.extend(self._expand(a, b)[1:])
        stops = _without_loops(stops)
        km = sum(self._km(a, b) for a, b in zip(stops, stops[1:], strict=False))
        return Route(
            stations=tuple(self._stations[sid] for sid in stops),
            distance_km=round(km, 1),
            duration_min=None if minutes is None else round(minutes, 1),
        )

    def _km(self, a: str, b: str) -> float:
        sa, sb = self._stations[a], self._stations[b]
        return haversine_km(sa.latitude, sa.longitude, sb.latitude, sb.longitude)

    def _time_cost(self, a: str, b: str, length: float) -> float:
        minutes = self._durations.get((a, b) if a < b else (b, a))
        if minutes is None:
            minutes = length * 1.5  # no measured duration: assume a slow 40 km/h
        return minutes + length * 1e-6

    def _shortest(
        self,
        start: str,
        end: str,
        cost: Callable[[str, str, float], float | None],
        limit: float = math.inf,
    ) -> list[str] | None:
        """Dijkstra; `cost` returns None for an edge that may not be used."""
        best = {start: 0.0}
        previous: dict[str, str] = {}
        heap = [(0.0, start)]
        while heap:
            total, node = heapq.heappop(heap)
            if node == end:
                path = [node]
                while node in previous:
                    node = previous[node]
                    path.append(node)
                return path[::-1]
            if total > best.get(node, math.inf):
                continue
            for neighbour, length in self._adjacent[node].items():
                step = cost(node, neighbour, length)
                if step is None:
                    continue
                candidate = total + step
                if candidate <= limit and candidate < best.get(neighbour, math.inf):
                    best[neighbour] = candidate
                    previous[neighbour] = node
                    heapq.heappush(heap, (candidate, neighbour))
        return None

    def _expand(self, a: str, b: str) -> tuple[str, ...]:
        """The chain of consecutive stops along the pair a-b (just (a, b) when it has none)."""
        cached = self._expansions.get((a, b))
        if cached is not None:
            return cached
        chord = self._adjacent[a][b]
        ceiling = chord * _FINER

        def finer(_a: str, _b: str, length: float) -> float | None:
            return length if length < ceiling else None

        lo, hi = (a, b) if a < b else (b, a)
        chain = self._shortest(lo, hi, finer, limit=chord * _MAX_DETOUR)
        if chain is None:
            result: tuple[str, ...] = (lo, hi)
        else:
            stops = [chain[0]]
            for x, y in zip(chain, chain[1:], strict=False):
                stops.extend(self._expand(x, y)[1:])
            result = tuple(_without_loops(stops))
        self._expansions[(lo, hi)] = result
        self._expansions[(hi, lo)] = result[::-1]
        return self._expansions[(a, b)]


def _without_loops(stops: list[str]) -> list[str]:
    """Drop any excursion that comes back to a stop already on the path."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for stop in stops:
        if stop in seen:
            del out[seen[stop] + 1 :]
            seen = {s: i for i, s in enumerate(out)}
        else:
            seen[stop] = len(out)
            out.append(stop)
    return out
