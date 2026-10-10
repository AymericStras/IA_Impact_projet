"""Inline SVG route map: the regional network as a quiet backdrop, the trip on top."""

from __future__ import annotations

import math
import zlib
from collections.abc import Sequence
from dataclasses import dataclass
from xml.sax.saxutils import escape

from .network import EARTH_RADIUS_KM, MapPoint, Network, Route, Station

NAVY = "#0f2149"
RED = "#c90c0f"
YELLOW = "#ffd500"
GREY = "#c9cdd8"
MUTED = "#5d6680"
PANEL = "#f5f6f9"
FONT = "Source Sans 3, sans-serif"

_MARGIN_X = 0.17  # share of the frame kept free on each side of the route
_MARGIN_Y = 0.2
_MAX_PX_PER_KM = 9.0  # a short hop is not blown up to fill the frame
_END_SIZE = 11.5
_STOP_SIZE = 8.5
_SCALE_STEPS = (1, 2, 5, 10, 20, 25, 50, 100, 200)


@dataclass(frozen=True)
class _Box:
    x0: float
    y0: float
    x1: float
    y1: float

    def grown(self, by: float) -> _Box:
        return _Box(self.x0 - by, self.y0 - by, self.x1 + by, self.y1 + by)

    def overlaps(self, other: _Box) -> bool:
        return (
            self.x0 < other.x1 and other.x0 < self.x1 and self.y0 < other.y1 and other.y0 < self.y1
        )

    def holds(self, x: float, y: float) -> bool:
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1

    def within(self, other: _Box) -> bool:
        return (
            self.x0 >= other.x0
            and self.y0 >= other.y0
            and self.x1 <= other.x1
            and self.y1 <= other.y1
        )


@dataclass(frozen=True)
class _Label:
    text: str
    x: float
    y: float  # baseline
    anchor: str
    size: float
    box: _Box


# Label positions around a marker: unit direction, text anchor.
_DIRECTIONS = (
    (1.0, 0.0, "start"),
    (-1.0, 0.0, "end"),
    (0.0, -1.0, "middle"),
    (0.0, 1.0, "middle"),
    (0.75, -0.75, "start"),
    (0.75, 0.75, "start"),
    (-0.75, -0.75, "end"),
    (-0.75, 0.75, "end"),
)


def _n(value: float) -> str:
    """One decimal, without a negative zero."""
    text = f"{value:.1f}"
    return "0.0" if text == "-0.0" else text


def _text_width(text: str, size: float, *, bold: bool) -> float:
    """Rough advance width of a Source Sans 3 string (no font metrics at hand)."""
    units = 0.0
    for ch in text:
        if ch in "iljtfI.,'’-·: ":
            units += 0.3
        elif ch in "mwMW":
            units += 0.85
        elif ch.isupper():
            units += 0.64
        else:
            units += 0.52
    return units * size * (1.06 if bold else 1.0)


def _candidate(text: str, x: float, y: float, radius: float, size: float, bold: bool, d) -> _Label:
    dx, dy, anchor = d
    width = _text_width(text, size, bold=bold)
    gap = radius + 4.0
    ax = x + dx * gap
    cy = y + dy * (gap + size * 0.36)  # vertical centre of the text
    left = ax if anchor == "start" else ax - width if anchor == "end" else ax - width / 2
    box = _Box(left, cy - size * 0.55, left + width, cy + size * 0.55)
    return _Label(text, ax, cy + size * 0.34, anchor, size, box)


class _Placer:
    """Greedy label placement against the route, the markers and the labels already set."""

    def __init__(self, frame: _Box, samples: Sequence[tuple[float, float]]) -> None:
        self.frame = frame
        self.samples = samples
        self.boxes: list[_Box] = []  # markers, scale bar, placed labels
        self.soft: list[tuple[float, float]] = []  # backdrop dots: avoided when possible

    def cost(self, label: _Label, away: tuple[float, float], d) -> tuple[int, float]:
        """(collisions that must not happen, preference among the positions without any)."""
        box = label.box
        near = box.grown(2.5)
        hard = 0 if box.within(self.frame) else 25
        hard += 25 * sum(1 for other in self.boxes if box.overlaps(other))
        hard += sum(1 for x, y in self.samples if near.holds(x, y))
        cost = 0.8 * sum(1 for x, y in self.soft if near.holds(x, y))
        cost -= 3.0 * (d[0] * away[0] + d[1] * away[1])
        cost += 0.5 if d[0] and d[1] else 0.0  # diagonals only when they help
        return hard, cost

    def place(
        self,
        text: str,
        x: float,
        y: float,
        *,
        radius: float,
        size: float,
        bold: bool,
        away: tuple[float, float] = (0.0, 0.0),
        strict: bool = False,
    ) -> _Label | None:
        best: tuple[tuple[int, float], _Label] | None = None
        for d in _DIRECTIONS:
            label = _candidate(text, x, y, radius, size, bold, d)
            cost = self.cost(label, away, d)
            if best is None or cost < best[0]:
                best = (cost, label)
        if best is None or (strict and best[0][0] > 0):
            return None
        self.boxes.append(best[1].box.grown(1.5))
        return best[1]


def _unit(dx: float, dy: float) -> tuple[float, float]:
    length = math.hypot(dx, dy)
    return (dx / length, dy / length) if length else (0.0, 0.0)


def _sample(points: Sequence[tuple[float, float]], step: float = 3.0) -> list[tuple[float, float]]:
    out = list(points[:1])
    for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
        pieces = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        out.extend(
            (x0 + (x1 - x0) * i / pieces, y0 + (y1 - y0) * i / pieces) for i in range(1, pieces + 1)
        )
    return out


def _text(label: _Label, *, fill: str, weight: int) -> str:
    """The text twice: a panel-coloured halo underneath, then the glyphs."""
    common = (
        f'x="{_n(label.x)}" y="{_n(label.y)}" text-anchor="{label.anchor}" '
        f'font-family="{FONT}" font-size="{_n(label.size)}" font-weight="{weight}"'
    )
    body = escape(label.text)
    return (
        f'<text {common} fill="{PANEL}" stroke="{PANEL}" stroke-width="3" '
        f'stroke-linejoin="round">{body}</text>'
        f'<text {common} fill="{fill}">{body}</text>'
    )


def route_map_svg(
    network: Network,
    route: Route,
    points: Sequence[MapPoint] = (),
    *,
    width: int = 520,
    height: int = 300,
) -> str:
    """A self-contained `<svg>` element (no external resource, no script)."""
    stops = route.stations
    lats = [s.latitude for s in stops]
    lons = [s.longitude for s in stops]
    lat0 = (min(lats) + max(lats)) / 2
    lon0 = (min(lons) + max(lons)) / 2
    km_per_lon = math.radians(1) * EARTH_RADIUS_KM * math.cos(math.radians(lat0))
    km_per_lat = math.radians(1) * EARTH_RADIUS_KM

    span_x = (max(lons) - min(lons)) * km_per_lon
    span_y = (max(lats) - min(lats)) * km_per_lat
    scale = min(
        width * (1 - 2 * _MARGIN_X) / max(span_x, 1e-6),
        height * (1 - 2 * _MARGIN_Y) / max(span_y, 1e-6),
        _MAX_PX_PER_KM,
    )

    def project(latitude: float, longitude: float) -> tuple[float, float]:
        return (
            width / 2 + (longitude - lon0) * km_per_lon * scale,
            height / 2 - (latitude - lat0) * km_per_lat * scale,
        )

    frame = _Box(0, 0, width, height)
    view = frame.grown(12)
    line = [project(s.latitude, s.longitude) for s in stops]
    on_route = {s.id for s in stops}
    clip_id = f"geo-{zlib.crc32('-'.join(s.id for s in stops).encode()):08x}-{width}x{height}"

    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" '
        f'aria-label="{escape(f"{stops[0].name} – {stops[-1].name}", {chr(34): "&quot;"})}">',
        f'<defs><clipPath id="{clip_id}"><rect width="{width}" height="{height}" rx="10"/>'
        "</clipPath></defs>",
        f'<rect width="{width}" height="{height}" rx="10" fill="{PANEL}"/>',
        f'<g clip-path="url(#{clip_id})">',
    ]

    # Backdrop: the regional network.
    backdrop: list[str] = []
    quiet: list[tuple[float, float]] = []  # backdrop geometry that labels avoid when they can
    for a, b in network.segments:
        xa, ya = project(a.latitude, a.longitude)
        xb, yb = project(b.latitude, b.longitude)
        if _Box(min(xa, xb), min(ya, yb), max(xa, xb), max(ya, yb)).overlaps(view):
            backdrop.append(f"M{_n(xa)} {_n(ya)}L{_n(xb)} {_n(yb)}")
            if a.id not in on_route or b.id not in on_route:
                quiet.extend(_sample([(xa, ya), (xb, yb)], 4.0))
    if backdrop:
        out.append(
            f'<path d="{"".join(backdrop)}" fill="none" stroke="{GREY}" stroke-width="1.2" '
            'stroke-linecap="round"/>'
        )
    others: list[tuple[Station, float, float]] = []
    for station in network.stations:
        if station.id in on_route or not network.degree(station):
            continue
        x, y = project(station.latitude, station.longitude)
        if view.holds(x, y):
            others.append((station, x, y))
    dot = 1.5 if scale >= 2.5 else 1.1
    out.append(f'<g fill="{GREY}">')
    out.extend(f'<circle cx="{_n(x)}" cy="{_n(y)}" r="{_n(dot)}"/>' for _, x, y in others)
    out.append("</g>")

    # Route.
    path = "M" + "L".join(f"{_n(x)} {_n(y)}" for x, y in line)
    out.append(
        f'<path d="{path}" fill="none" stroke="{PANEL}" stroke-width="6" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{path}" fill="none" stroke="{NAVY}" stroke-width="3" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
    )
    stop_radius = 2.4 if scale >= 2.0 else 1.9
    inner = list(zip(stops[1:-1], line[1:-1], strict=False))
    out.append(f'<g fill="#ffffff" stroke="{NAVY}" stroke-width="1.2">')
    out.extend(f'<circle cx="{_n(x)}" cy="{_n(y)}" r="{_n(stop_radius)}"/>' for _, (x, y) in inner)
    out.append("</g>")

    # Scale bar, bottom-left.
    target_km = width * 0.16 / scale
    bar_km = max((s for s in _SCALE_STEPS if s <= target_km), default=_SCALE_STEPS[0])
    bar_px = bar_km * scale
    bar_x, bar_y = 16.0, height - 14.0
    scale_box = _Box(bar_x - 6, bar_y - 18, bar_x + max(bar_px, 30) + 8, height)

    placer = _Placer(frame.grown(-6), _sample(line))
    placer.soft = quiet
    placer.boxes.append(scale_box)
    (ox, oy), (dx, dy) = line[0], line[-1]
    end_radius = 5.5
    placer.boxes.append(_Box(ox, oy, ox, oy).grown(end_radius + 2))
    placer.boxes.append(_Box(dx, dy, dx, dy).grown(end_radius + 2))

    labels: list[tuple[_Label, str, int]] = []
    origin_label = placer.place(
        stops[0].name,
        ox,
        oy,
        radius=end_radius,
        size=_END_SIZE,
        bold=True,
        away=_unit(ox - line[1][0], oy - line[1][1]),
    )
    destination_label = placer.place(
        stops[-1].name,
        dx,
        dy,
        radius=end_radius,
        size=_END_SIZE,
        bold=True,
        away=_unit(dx - line[-2][0], dy - line[-2][1]),
    )
    labels += [(origin_label, NAVY, 600), (destination_label, NAVY, 600)]

    # Visited places: only when they do not sit on an end marker.
    shown: list[tuple[MapPoint, float, float]] = []
    for point in points:
        try:
            px, py = project(float(point.latitude), float(point.longitude))
        except (TypeError, ValueError):
            continue
        if not frame.grown(-8).holds(px, py):
            continue
        clear = 16.0
        if math.hypot(px - dx, py - dy) < clear or math.hypot(px - ox, py - oy) < clear:
            continue
        if any(math.hypot(px - qx, py - qy) < 7.0 for _, qx, qy in shown):
            continue
        shown.append((point, px, py))
    for _, px, py in shown:
        placer.boxes.append(_Box(px, py, px, py).grown(5))
    if len(shown) <= 2:
        for point, px, py in shown:
            if not point.label:
                continue
            label = placer.place(
                point.label, px, py, radius=3.5, size=_STOP_SIZE, bold=False, strict=True
            )
            if label:
                labels.append((label, NAVY, 400))

    # A few major intermediate stops, when there is room.
    for sx, sy in line[1:-1]:
        placer.boxes.append(_Box(sx, sy, sx, sy).grown(stop_radius + 1))
    major = sorted(
        (item for item in inner if network.degree(item[0]) >= 3),
        key=lambda item: (-network.importance(item[0]), item[0].name),
    )
    named: list[tuple[float, float]] = [(ox, oy), (dx, dy)]
    for station, (sx, sy) in major:
        if len(named) == 5:
            break
        if any(math.hypot(sx - qx, sy - qy) < 30 for qx, qy in named):
            continue
        index = stops.index(station)
        (ax, ay), (bx, by) = line[index - 1], line[index + 1]
        tx, ty = _unit(bx - ax, by - ay)
        # Perpendicular to the route, on the side with more free room.
        normal = (-ty, tx)
        if (normal[1] > 0 and sy > height * 0.6) or (normal[1] < 0 and sy < height * 0.4):
            normal = (ty, -tx)
        placer.boxes.remove(_Box(sx, sy, sx, sy).grown(stop_radius + 1))
        label = placer.place(
            station.name,
            sx,
            sy,
            radius=stop_radius,
            size=_STOP_SIZE,
            bold=False,
            away=normal,
            strict=True,
        )
        placer.boxes.append(_Box(sx, sy, sx, sy).grown(stop_radius + 1))
        if label:
            labels.append((label, MUTED, 400))
            named.append((sx, sy))

    for _, px, py in shown:
        out.append(
            f'<circle cx="{_n(px)}" cy="{_n(py)}" r="3.5" fill="{YELLOW}" stroke="{NAVY}" '
            'stroke-width="1.2"/>'
        )
    out.append(
        f'<circle cx="{_n(ox)}" cy="{_n(oy)}" r="{_n(end_radius)}" fill="{NAVY}" '
        'stroke="#ffffff" stroke-width="2"/>'
        f'<circle cx="{_n(dx)}" cy="{_n(dy)}" r="{_n(end_radius)}" fill="{RED}" '
        'stroke="#ffffff" stroke-width="2"/>'
    )
    out.extend(_text(label, fill=fill, weight=weight) for label, fill, weight in labels if label)

    out.append(
        f'<path d="M{_n(bar_x)} {_n(bar_y - 3)}V{_n(bar_y)}H{_n(bar_x + bar_px)}V{_n(bar_y - 3)}" '
        f'fill="none" stroke="{MUTED}" stroke-width="1"/>'
        f'<text x="{_n(bar_x)}" y="{_n(bar_y - 6)}" font-family="{FONT}" font-size="8" '
        f'fill="{MUTED}">{bar_km} km</text>'
    )
    out.append("</g></svg>")
    return "".join(out)
