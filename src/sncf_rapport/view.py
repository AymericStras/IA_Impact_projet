"""The one derived layer between the request and the PDF.

`build_report_view` turns a `TripReportRequest` into a `ReportView`: a frozen tree of
display-ready French strings, booleans and tuples. The template computes nothing and reads
nothing else. Whatever cannot be derived (unknown station, no emission factor, unreadable
photo) is dropped from the view and reported as a `Gap`; the report always renders.
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
import math
import sys
import warnings
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree  # noqa: S405 - parses the bundled logo only

from . import formatting as fmt
from .carbon import CarbonEstimate, Factor, ModeEstimate, estimate, load_factors
from .config import Config
from .gaps import Gap, input_gaps
from .geo import MapPoint, Network, Route, route_map_svg
from .models import COMPETENCY_KEYS, Insights, Photo, TrainLeg, TripReportRequest

log = logging.getLogger(__name__)

NBSP = fmt.NBSP
CO2E = "CO₂e"
KG_CO2E = f"kg{NBSP}{CO2E}"
MAP_WIDTH = 600
MAP_HEIGHT = 214
MAX_PHOTO_BYTES = 15 * 1024 * 1024
PHOTO_TYPES = ("image/png", "image/jpeg", "image/webp")

TITLE = "Notre voyage, nos apprentissages"
DOCUMENT_KIND = "Rapport de voyage scolaire"
CLASS_DISCLAIMER = (
    "Cette appréciation porte sur la classe dans son ensemble ; elle ne constitue pas "
    "une validation individuelle de chaque élève."
)
DISTANCE_ESTIMATED = "distance estimée"
DISTANCE_GIVEN = "distance communiquée"
AI_TAG = "texte rédigé avec l'aide d'une IA"
AI_NOTICE = (
    'Les textes "Pourquoi ce voyage", "Ce que la sortie a permis de travailler" et '
    "\"Pour en parler à la maison\" ont été rédigés avec l'aide d'une IA à partir du "
    "programme de la sortie"
)
AI_REVIEWED = ", puis relus par l'enseignant·e."
AI_NOT_REVIEWED = " ; ils n'ont pas encore été relus par l'enseignant·e."
ESTIMATE_DISCLAIMER = "Il s'agit d'une estimation, pas d'une mesure."
RAIL_DATA_LINE = "Gares et lignes : jeu de données du hackathon liO / SNCF open data"
SIMULATION_LINE = "Démonstration : horaires et réservation simulés."

# key, label, one-line gloss for parents
COMPETENCIES = (
    ("savoir", "Savoir", "Les connaissances : ce que la classe a appris."),
    ("savoir_faire", "Savoir-faire", "La pratique : observer, noter, réaliser."),
    ("savoir_se_deplacer", "Savoir se déplacer", "La mobilité : voyager en train, en groupe."),
    ("savoir_s_orienter", "Savoir s'orienter", "Le repérage : lire un plan, trouver son chemin."),
    ("savoir_etre", "Savoir-être", "Le comportement en groupe : écoute, entraide."),
)
STATUS_LABELS = {
    "acquise": "Acquise",
    "en_cours": "En cours d'acquisition",
    "non_evaluee": "Non évaluée",
}
_STATUS_KEYS = {"acquis": "acquise", "partiel": "en_cours", "non_evalue": "non_evaluee"}
_COMPLETION = {
    "completed": "Le voyage s'est déroulé comme prévu.",
    "partial": "Le voyage s'est déroulé en partie comme prévu.",
    "cancelled": "Le voyage n'a pas eu lieu.",
}
_THAN = {"autocar": "qu'en autocar", "voiture": "qu'en voiture"}
_MODE_NAMES = {"ter": "Train", "autocar": "Autocar", "voiture": "Voiture"}


# --------------------------------------------------------------------------- view tree


@dataclass(frozen=True)
class Fact:
    label: str
    value: str | None  # None prints « non communiqué »
    compact: bool = False  # short enough to stay on one line


@dataclass(frozen=True)
class KeyFigure:
    kind: str  # "people" | "skills" | "carbon" | "distance": a CSS hook only
    prefix: str  # small word before the number, e.g. "environ"
    value: str | None  # None prints « non communiqué »
    unit: str
    label: str
    note: str
    long: bool = False  # many digits: the template uses a smaller size


@dataclass(frozen=True)
class CoverView:
    document_kind: str
    title: str
    trip_title: str | None
    facts: tuple[Fact, ...]
    figures: tuple[KeyFigure, ...]


@dataclass(frozen=True)
class LegView:
    label: str  # "Aller" | "Retour"
    known: bool
    departure: str | None
    from_station: str | None
    arrival: str | None
    to_station: str | None
    duration: str | None
    train: str | None  # line and / or train number


@dataclass(frozen=True)
class PlaceView:
    title: str
    note: str | None
    walk: str | None


@dataclass(frozen=True)
class JourneyView:
    map_svg: str | None  # inline <svg> produced by geo.route_map_svg (the only |safe value)
    route_text: tuple[str, ...]  # fallback when there is no map: ("Origine", "Destination")
    distance: str | None
    distance_note: str | None
    legs: tuple[LegView, ...]
    places: tuple[PlaceView, ...]
    empty_note: str | None  # the only line of the section when nothing at all is known


@dataclass(frozen=True)
class ActivityView:
    title: str
    time: str | None
    description: str | None
    mark: str  # "done" | "not_done" | "none"
    mark_label: str  # "Réalisée" | "Non réalisée" | ""


@dataclass(frozen=True)
class DoneView:
    completion: str | None  # None prints « non communiqué »
    completion_kind: str  # "completed" | "partial" | "cancelled" | "unknown"
    why: tuple[str, ...]  # « Pourquoi ce voyage », one item per paragraph (education.insights)
    why_tag: str | None  # discreet origin tag next to the title, None for a teacher's text
    activities: tuple[ActivityView, ...]
    activities_note: str | None
    stacked: bool  # long lists: one under the other, so that they can run over pages
    objectives: tuple[str, ...]
    changes: str | None
    quote: tuple[str, ...]  # the teacher's words, one item per paragraph
    quote_author: str | None


@dataclass(frozen=True)
class CompetencyView:
    label: str
    gloss: str
    status: str  # "acquise" | "en_cours" | "non_evaluee"
    status_label: str
    step: str  # "2" | "1" | "0": filled steps of the indicator
    insight: str | None  # what the trip let the class work on: an opportunity, not a result
    comment: str | None  # the teacher's appreciation


@dataclass(frozen=True)
class CompetenciesView:
    rows: tuple[CompetencyView, ...]
    summary: str
    acquired: str  # "3"
    assessed: bool
    disclaimer: str
    questions: tuple[str, ...]  # « Pour en parler à la maison »
    questions_tag: str | None


@dataclass(frozen=True)
class CarbonRow:
    label: str
    kg: str
    per_person: str
    bar_percent: str  # "42.5", for a CSS width
    is_train: bool
    note: str | None  # assumption shown under the mode name, e.g. the car occupancy


@dataclass(frozen=True)
class CarbonView:
    intro: str
    rows: tuple[CarbonRow, ...]
    comparisons: tuple[str, ...]
    method_note: str | None  # the carbon module's own narrative, when it applies to this case
    method: tuple[str, ...]  # the figures actually used
    disclaimer: str


@dataclass(frozen=True)
class PhotoView:
    src: str  # data: URI
    caption: str | None
    fit: str = "cover"  # "contain" for a very wide or very tall picture, shown whole


@dataclass(frozen=True)
class PhotoGroup:
    title: str
    photos: tuple[PhotoView, ...]
    layout: str  # "one" | "two" | "three": columns of the grid


@dataclass(frozen=True)
class SourceView:
    label: str | None
    url: str | None
    detail: str | None


@dataclass(frozen=True)
class SourcesView:
    items: tuple[SourceView, ...]
    data_lines: tuple[SourceView, ...]
    validation: str
    validated: bool
    generated: str
    ai_notice: str | None  # mandatory attribution when insight texts come from a model


@dataclass(frozen=True)
class FooterView:
    basis: str
    trace: str
    simulation: str | None


@dataclass(frozen=True)
class ReportView:
    language: str
    document_title: str  # PDF metadata title
    logo_uri: str | None
    simulated: bool
    cover: CoverView
    journey: JourneyView
    done: DoneView
    competencies: CompetenciesView
    carbon: CarbonView | None
    photo_groups: tuple[PhotoGroup, ...]
    sources: SourcesView
    footer: FooterView
    gaps: tuple[Gap, ...]


# --------------------------------------------------------------------------- data caches

_networks: dict[tuple[Path, Path], Network] = {}
_factor_sets: dict[Path, dict[str, Factor]] = {}
_logos: dict[tuple[Path, int, int], str] = {}


def clear_caches() -> None:
    """Forget the loaded network and emission factors (tests, data refresh)."""
    _networks.clear()
    _factor_sets.clear()
    _logos.clear()


def _network(config: Config) -> Network | None:
    key = (config.stations_csv, config.connections_csv)
    if key not in _networks:
        try:
            _networks[key] = Network.load(*key)
        except NotImplementedError:
            return None
        except Exception as exc:  # noqa: BLE001 - a missing data file never breaks the report
            log.warning("rail network unavailable: %s", exc)
            return None
    return _networks[key]


def _factors(config: Config) -> dict[str, Factor]:
    path = config.emission_factors
    if path not in _factor_sets:
        try:
            loaded = dict(load_factors(path))
        except NotImplementedError:
            return {}
        except Exception as exc:  # noqa: BLE001
            log.warning("emission factors unavailable: %s", exc)
            return {}
        if not loaded:
            return {}  # not cached: the file may appear later
        _factor_sets[path] = loaded
    return _factor_sets[path]


# --------------------------------------------------------------------------- helpers


def _aware(moment: datetime) -> datetime:
    """A naive datetime is read as French local time (station clocks)."""
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=fmt.PARIS)


def _safe(function: Callable[..., str | None], *moments: Any) -> str | None:
    """A formatted date or time, or None when it cannot be formatted.

    Years 1 and 9999 overflow on time-zone conversion and a naive datetime cannot be
    compared with an aware one: such a value is shown as « non communiqué », never raised.
    """
    try:
        return function(*(_aware(m) if isinstance(m, datetime) else m for m in moments))
    except (OverflowError, ValueError, TypeError, OSError, ArithmeticError):
        return None


def _finite(*values: float | None) -> bool:
    return all(isinstance(v, int | float) and math.isfinite(v) for v in values)


def _text(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _paragraphs(value: str | None) -> tuple[str, ...]:
    return tuple(part.strip() for part in (value or "").splitlines() if part.strip())


def _join(parts: list[str | None], separator: str = " · ") -> str | None:
    kept = [part for part in parts if part]
    return separator.join(kept) if kept else None


def _count(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count}{NBSP}{fmt.plural(count, singular, plural)}"


def _kg(value: float) -> str:
    return f"{fmt.kilograms(value)}{NBSP}{KG_CO2E}"


# --------------------------------------------------------------------------- sections


@dataclass(frozen=True)
class _HeadCount:
    total: int | None
    students: int | None
    accompanying: int | None
    planned: bool  # True when the figure comes from the planner, not from the teacher


def _head_count(request: TripReportRequest) -> _HeadCount:
    feedback, trip = request.teacher_feedback, request.trip
    actual = feedback.actual_participants if feedback else None
    planned = trip.planned_participants if trip else None
    if actual and actual.resolved_total():
        return _HeadCount(actual.resolved_total(), actual.students, actual.accompanying, False)
    if planned and planned.resolved_total():
        return _HeadCount(planned.resolved_total(), planned.students, planned.accompanying, True)
    return _HeadCount(None, None, None, False)


def _people_figure(head: _HeadCount) -> KeyFigure:
    suffix = " prévus" if head.planned else ""
    if head.total is None:
        return KeyFigure("people", "", None, "", "élèves participants", "")
    if head.students:
        notes = []
        if head.accompanying:
            adults = _count(head.accompanying, "adulte")
            notes.append(f"accompagnés de {adults}" if head.students > 1 else f"avec {adults}")
        if head.total != head.students:
            notes.append(f"{_count(head.total, 'voyageur')} au total")
        label = fmt.plural(head.students, "élève participant", "élèves participants")
        if head.planned:
            label = fmt.plural(head.students, "élève prévu", "élèves prévus")
        return KeyFigure("people", "", str(head.students), "", label, _join(notes, ", ") or "")
    label = fmt.plural(head.total, "participant") + (suffix if head.total > 1 else suffix[:-1])
    return KeyFigure("people", "", str(head.total), "", label, "élèves et accompagnateurs")


def _competencies(request: TripReportRequest, insights: Insights | None) -> CompetenciesView:
    feedback = request.teacher_feedback
    given = feedback.competencies if feedback else None
    hints = insights.competencies if insights else None
    tag = AI_TAG if insights and insights.origin == "ai" else None
    questions = tuple(q for q in (_text(q) for q in (insights.questions if insights else [])) if q)
    rows = []
    for key, label, gloss in COMPETENCIES:
        item = getattr(given, key, None) if given else None
        # "acquise" only when the teacher said `acquis`; anything else is never upgraded.
        status = _STATUS_KEYS.get(item.status, "non_evaluee") if item else "non_evaluee"
        step = {"acquise": "2", "en_cours": "1", "non_evaluee": "0"}[status]
        rows.append(
            CompetencyView(
                label,
                gloss,
                status,
                STATUS_LABELS[status],
                step,
                # The insight is printed beside the status and never feeds it.
                _text(getattr(hints, key, None)) if hints else None,
                _text(item and item.comment),
            )
        )
    counts = {name: sum(1 for row in rows if row.status == name) for name in STATUS_LABELS}
    assessed = counts["non_evaluee"] < len(rows)
    if not assessed:
        summary = "L'enseignant·e n'a pas encore évalué les compétences travaillées."
    else:
        parts = []
        if counts["acquise"]:
            parts.append(_count(counts["acquise"], "compétence acquise", "compétences acquises"))
        if counts["en_cours"]:
            parts.append(f"{counts['en_cours']} en cours d'acquisition")
        if counts["non_evaluee"]:
            parts.append(
                _count(counts["non_evaluee"], "non évaluée", "non évaluées").replace(NBSP, " ")
            )
        summary = ", ".join(parts) + "."
    return CompetenciesView(
        rows=tuple(rows),
        summary=summary,
        acquired=str(counts["acquise"]),
        assessed=assessed,
        disclaimer=CLASS_DISCLAIMER,
        questions=questions,
        questions_tag=tag if questions else None,
    )


def _skills_figure(view: CompetenciesView) -> KeyFigure:
    total = len(view.rows)
    if not view.assessed:
        return KeyFigure(
            "skills", "", str(total), "", "compétences travaillées", "appréciation non communiquée"
        )
    pending = sum(1 for row in view.rows if row.status == "en_cours")
    acquired = int(view.acquired)
    if acquired == 0 and pending:
        # Nothing acquired yet: lead with what is under way rather than with a zero.
        label = fmt.plural(pending, "compétence", "compétences") + " en cours d'acquisition"
        return KeyFigure(
            "skills", "", str(pending), f"sur {total}", label, "appréciation de l'enseignant·e"
        )
    note = f"{pending} en cours d'acquisition" if pending else "appréciation de l'enseignant·e"
    label = fmt.plural(acquired, "compétence acquise", "compétences acquises")
    return KeyFigure("skills", "", view.acquired, f"sur {total}", label, note)


def _duration(start: datetime, end: datetime) -> str | None:
    """Travel time, only when it is plausible (arrival after departure, under two days)."""
    seconds = (end - start).total_seconds()
    return fmt.duration(start, end) if 0 < seconds <= 48 * 3600 else None


def _clock_range(start: datetime | None, end: datetime | None) -> str | None:
    first = _safe(fmt.clock, start) if start else None
    last = _safe(fmt.clock, end) if end else None
    return f"{first} – {last}" if first and last else first or last


def _leg(label: str, leg: TrainLeg | None, start: str | None, end: str | None) -> LegView:
    if leg is None:
        return LegView(label, False, None, None, None, None, None, None)
    number = f"train n°{NBSP}{leg.train_number}" if _text(leg.train_number) else None
    duration = None
    if leg.departure and leg.arrival:
        duration = _safe(_duration, leg.departure, leg.arrival)
    view = LegView(
        label=label,
        known=True,
        departure=_safe(fmt.clock, leg.departure) if leg.departure else None,
        from_station=_text(leg.from_station) or start,
        arrival=_safe(fmt.clock, leg.arrival) if leg.arrival else None,
        to_station=_text(leg.to_station) or end,
        duration=duration,
        train=_join([_text(leg.line), number]),
    )
    known = any((view.departure, view.from_station, view.arrival, view.to_station, view.train))
    return view if known else LegView(label, False, None, None, None, None, None, None)


def _activities(request: TripReportRequest, cancelled: bool) -> tuple[ActivityView, ...]:
    education, feedback = request.education, request.teacher_feedback
    done_ids = set(feedback.completed_activity_ids) if feedback else set()
    everything = bool(feedback and feedback.activities_completed == "all")
    out = []
    for activity in education.activities if education else []:
        title = _text(activity.title)
        if not title:
            continue
        if cancelled or not (everything or done_ids):
            mark, mark_label = "none", ""
        elif everything or (activity.id and activity.id in done_ids):
            mark, mark_label = "done", "Réalisée"
        else:
            mark, mark_label = "not_done", "Non réalisée"
        out.append(
            ActivityView(
                title,
                _clock_range(activity.start, activity.end),
                _text(activity.description),
                mark,
                mark_label,
            )
        )
    return tuple(out)


def _logo_uri(path: Path) -> str | None:
    """file: URI of the logo, or None unless the file is well-formed XML with an <svg> root.

    The file is the operator's own asset (never request data); parsing it here keeps a
    truncated or replaced file from reaching the PDF engine.
    """
    try:
        stat = path.stat()
        key = (path, stat.st_mtime_ns, stat.st_size)
        if key not in _logos:
            if stat.st_size > 2 * 1024 * 1024:
                return None
            root = ElementTree.fromstring(path.read_bytes())  # noqa: S314 - bundled asset
            if root.tag.rsplit("}", 1)[-1].lower() != "svg":
                return None
            _logos.clear()
            _logos[key] = path.resolve().as_uri()
        return _logos[key]
    except (OSError, ValueError, ElementTree.ParseError):
        return None


def _picture_fit(data: bytes) -> str | None:
    """ "cover" or "contain" for a readable picture, None when it cannot be decoded.

    Without the image library (it comes with WeasyPrint) the picture is trusted on its
    magic bytes and shown whole.
    """
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return "contain"
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                width, height = image.size
                image.verify()
    except Exception:  # noqa: BLE001 - any decoder failure means "not printable"
        return None
    if not (0 < width <= 20000 and 0 < height <= 20000):
        return None
    return "cover" if 0.5 <= width / height <= 2.4 else "contain"


def _sniff(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _photo_bytes(photo: Photo) -> tuple[bytes | None, str]:
    """Image bytes, or None and the reason (English, for the gap list)."""
    if _text(photo.data_base64):
        text = photo.data_base64 or ""
        if text.startswith("data:") and "," in text:
            text = text.split(",", 1)[1]
        try:
            return base64.b64decode("".join(text.split()), validate=True), ""
        except (binascii.Error, ValueError):
            return None, "data_base64 is not valid base64"
    if _text(photo.path):
        try:
            path = Path(photo.path or "")
            if path.stat().st_size > MAX_PHOTO_BYTES:
                return None, "file is larger than 15 MB"
            return path.read_bytes(), ""
        except OSError as exc:
            return None, f"file cannot be read ({exc.strerror or 'error'})"
        except ValueError:
            return None, "path is not a usable file name"
    return None, ""


def _photo(photo: Photo) -> tuple[PhotoView | None, str]:
    """The printable photo, or None and the reason (empty when there is simply no data)."""
    data, reason = _photo_bytes(photo)
    if data is None:
        return None, reason
    declared = (photo.media_type or "").split(";")[0].strip().lower().replace("/jpg", "/jpeg")
    actual = _sniff(data)
    if declared and declared not in PHOTO_TYPES:
        return None, f"media_type {declared[:40]!r} is not PNG, JPEG or WebP"
    if actual is None:
        return None, "the data is not a PNG, JPEG or WebP image"
    if len(data) > MAX_PHOTO_BYTES:
        return None, "image is larger than 15 MB"
    fit = _picture_fit(data)
    if fit is None:
        return None, "the image data is damaged"
    src = f"data:{actual};base64,{base64.b64encode(data).decode('ascii')}"
    return PhotoView(src, _text(photo.caption), fit), ""


def _photos(request: TripReportRequest, gaps: list[Gap]) -> tuple[PhotoGroup, ...]:
    groups: dict[str, list[PhotoView]] = {"trip": [], "documentary": []}
    for index, photo in enumerate(request.media.photos if request.media else []):
        if photo.consent is not True:
            continue  # already listed by gaps.input_gaps
        try:
            view, reason = _photo(photo)
        except Exception as exc:  # noqa: BLE001 - one bad photo never costs the report
            view, reason = None, f"unexpected error ({type(exc).__name__})"
        if view is None:
            if reason:
                gaps.append(Gap(f"media.photos[{index}]", "minor", f"Photo not printed: {reason}."))
            continue
        groups.setdefault(photo.kind, []).append(view)
    titles = {
        "trip": "Photos du voyage",
        "documentary": "Images d'illustration (documentation, non prises pendant le voyage)",
    }
    layouts = {1: "one", 2: "two", 4: "two"}
    return tuple(
        PhotoGroup(titles[kind], tuple(groups[kind]), layouts.get(len(groups[kind]), "three"))
        for kind in titles
        if groups.get(kind)
    )


def _factor_source(factor: Factor) -> str:
    consulted = fmt.iso_day_short(factor.retrieved_at)
    return (
        _join(
            [factor.source_name, factor.version, f"consulté le {consulted}" if consulted else None],
            ", ",
        )
        or "source non communiquée"
    )


def _mode_name(factor: Factor) -> str:
    name = _MODE_NAMES.get(factor.mode)
    label = _text(factor.label) or factor.mode
    if name is None or name.lower() == label.lower():
        return label
    return f"{name} ({label})"


def _carbon(
    result: CarbonEstimate, *, distance_label: str, distance_origin: str
) -> tuple[CarbonView, KeyFigure]:
    modes = (result.train, *result.baselines)
    for mode in modes:
        if not _finite(mode.kg_total, mode.kg_per_person, mode.factor.g_co2e_per_pkm):
            raise ValueError("non-finite emission figure")
        if mode.kg_total < 0 or mode.kg_per_person < 0:
            raise ValueError("negative emission figure")
    if not _finite(result.distance_km_one_way) or result.train.kg_total <= 0:
        raise ValueError("unusable estimate")
    if result.car_occupancy is not None and not _finite(result.car_occupancy):
        raise ValueError("non-finite car occupancy")
    car_people = None
    if result.car_occupancy is not None:
        decimals = 0 if float(result.car_occupancy).is_integer() else 1
        if result.car_occupancy < 0.95:
            decimals = 2
        people = fmt.number(result.car_occupancy, decimals)
        car_people = f"{people}{NBSP}{fmt.plural(result.car_occupancy, 'personne')}"
    top = max((mode.kg_total for mode in modes), default=0.0) or 1.0
    rows = tuple(
        CarbonRow(
            label=_mode_name(mode.factor),
            kg=_kg(mode.kg_total),
            per_person=f"{fmt.kilograms(mode.kg_per_person)}{NBSP}kg par personne",
            bar_percent=f"{max(mode.kg_total / top * 100, 1.5):.1f}",
            is_train=index == 0,
            note=f"{car_people} par voiture" if car_people and _is_car(mode.factor) else None,
        )
        for index, mode in enumerate(modes)
    )
    train_kg = _kg(result.train.kg_total)
    comparisons: list[str] = []
    figure: KeyFigure | None = None
    for mode in result.baselines:
        saving = result.saving_kg(mode.factor.mode)
        if saving is None:
            continue
        name = (_text(mode.factor.label) or mode.factor.mode).lower()
        than = _THAN.get(mode.factor.mode, f"qu'avec le mode « {name} »")
        if saving >= 0.05:
            comparisons.append(f"Environ {_kg(saving)} de moins {than} (estimation).")
            if figure is None:
                figure = KeyFigure(
                    "carbon",
                    "environ",
                    fmt.kilograms(saving),
                    "kg",
                    f"de {CO2E} de moins {than}",
                    "estimation, aller-retour du groupe",
                )
        else:
            # No boast when the train is not lower: both figures, stated neutrally.
            comparisons.append(
                f"Train : environ {train_kg} ; {name} : environ {_kg(mode.kg_total)} (estimations)."
            )
    if figure is None:
        figure = KeyFigure(
            "carbon",
            "environ",
            fmt.kilograms(result.train.kg_total),
            "kg",
            f"de {CO2E} pour le trajet en train",
            "estimation, aller-retour du groupe",
        )

    one_way = fmt.kilometres(result.distance_km_one_way)
    both_ways = fmt.kilometres(result.distance_km_one_way * 2)
    travellers = _count(result.passengers, "voyageur")
    intro = (
        f"Émissions estimées pour l'aller-retour du groupe ({both_ways}, {travellers}), "
        "selon le mode de transport."
    )

    def rate(mode: ModeEstimate) -> str:
        grams = f"{fmt.number(mode.factor.g_co2e_per_pkm, 1)}{NBSP}g {CO2E}"
        if _is_car(mode.factor) and car_people and _per_vehicle(mode.factor):
            return (
                f"{_mode_name(mode.factor)} {grams} par véhicule-kilomètre, "
                f"avec {car_people} par voiture"
            )
        return f"{_mode_name(mode.factor)} {grams} par voyageur-kilomètre"

    origins = {_factor_source(mode.factor) for mode in modes}
    if len(origins) == 1:
        factors = f"({origins.pop()}) : " + " ; ".join(rate(mode) for mode in modes)
    else:
        factors = ": " + " ; ".join(
            f"{rate(mode)} ({_factor_source(mode.factor)})" for mode in modes
        )
    method = (
        f"Calcul pour un aller-retour, soit 2 × {one_way} ({distance_label} : {distance_origin}), "
        f"pour {travellers}.",
        f"Facteurs d'émission {factors}.",
    )
    view = CarbonView(
        intro=intro,
        rows=rows,
        comparisons=tuple(comparisons),
        method_note=_method_note(
            result, car_people, estimated=distance_label == DISTANCE_ESTIMATED
        ),
        method=method,
        disclaimer=ESTIMATE_DISCLAIMER,
    )
    return view, figure


def _is_car(factor: Factor) -> bool:
    return factor.mode == "voiture"


def _per_vehicle(factor: Factor) -> bool:
    return getattr(factor, "default_occupancy", None) is not None


def _method_note(result: CarbonEstimate, car_people: str | None, *, estimated: bool) -> str | None:
    """The carbon module's French method paragraph, only where its wording is true.

    It speaks of an estimated distance and of both road baselines, so it is left out for a
    communicated distance or another set of baselines; the figures are printed either way.
    """
    module = sys.modules.get(f"{__package__}.carbon.estimate")
    template = getattr(module, "METHOD_NOTE_FR", None)
    modes = {mode.factor.mode for mode in result.baselines}
    if not isinstance(template, str) or not estimated or not car_people:
        return None
    if modes != {"autocar", "voiture"}:
        return None
    if car_people.startswith(f"1{NBSP}"):
        car_people = "une personne"
    try:
        return template.format(
            source_name=result.train.factor.source_name,
            retrieved_at=fmt.iso_day_short(result.train.factor.retrieved_at) or "",
            car_people=car_people,
        ).strip()
    except (KeyError, IndexError, ValueError):
        return None


# --------------------------------------------------------------------------- entry point


def build_report_view(
    request: TripReportRequest,
    *,
    config: Config | None = None,
    issued_at: datetime | None = None,
) -> ReportView:
    """Never raises for a valid request: what cannot be derived is left out and listed."""
    config = config or Config()
    try:
        return _build(request, config, issued_at)
    except Exception:  # noqa: BLE001 - last resort: a report with holes beats no report
        log.exception("report view failed; falling back to the bare report")
        bare = _build(TripReportRequest(), config, None)
        bug = Gap("view", "major", "Internal error while deriving the report: content left out.")
        return replace(bare, gaps=(bug, *bare.gaps))


def _build(request: TripReportRequest, config: Config, issued_at: datetime | None) -> ReportView:
    now = datetime.now(fmt.PARIS)
    issued_long = _safe(fmt.date_long, issued_at) if issued_at else None
    issued_short = _safe(fmt.date_short, issued_at) if issued_at else None
    if not (issued_long and issued_short):
        issued_long, issued_short = fmt.date_long(now), fmt.date_short(now)
    try:
        gaps: list[Gap] = list(input_gaps(request))
    except Exception:  # noqa: BLE001
        log.exception("input gap listing failed")
        gaps = [Gap("request", "minor", "The list of missing fields could not be computed.")]
    school, trip, education = request.school, request.trip, request.education
    feedback, environment = request.teacher_feedback, request.environment
    cancelled = bool(feedback and feedback.trip_completed == "cancelled")

    # ---- stations, route, distance
    outbound = trip.outbound if trip else None
    origin = _text(trip.origin_station if trip else None) or _text(
        outbound.from_station if outbound else None
    )
    destination = _text(trip.destination_station if trip else None) or _text(
        outbound.to_station if outbound else None
    )
    route: Route | None = None
    network = _network(config) if (origin or destination) else None
    if (origin or destination) and network is None:
        gaps.append(
            Gap(
                "data/stations.csv",
                "major",
                "Rail network data unavailable: no route map; distance needs "
                "environment.distance_km_override.",
            )
        )
    if network is not None and origin and destination:
        try:
            for field, name in (
                ("trip.origin_station", origin),
                ("trip.destination_station", destination),
            ):
                if network.find_station(name) is None:
                    gaps.append(
                        Gap(
                            field,
                            "major",
                            f"Station '{name}' is not in the bundled network: no route map; "
                            "distance needs environment.distance_km_override.",
                        )
                    )
            route = network.route(origin, destination)
            if route is not None and len(route.stations) < 2:
                route = None
            if route is None and not any(g.field.endswith("_station") for g in gaps):
                gaps.append(
                    Gap(
                        "trip.destination_station",
                        "major",
                        f"No rail path between '{origin}' and '{destination}' in the bundled "
                        "network: no route map; distance needs environment.distance_km_override.",
                    )
                )
        except NotImplementedError:
            route = None
        except Exception as exc:  # noqa: BLE001
            log.warning("route lookup failed: %s", exc)
            route = None
            gaps.append(Gap("trip.origin_station", "major", "Route lookup failed: no route map."))

    override = environment.distance_km_override if environment else None
    distance_km: float | None = None
    distance_label = distance_origin = ""
    if override:
        distance_km = override
        distance_label = DISTANCE_GIVEN
        distance_origin = "indiquée par l'organisateur du voyage"
    elif route is not None and route.distance_km > 0:
        distance_km = route.distance_km
        distance_label = DISTANCE_ESTIMATED
        distance_origin = "calculée de gare en gare le long de la ligne, à vol d'oiseau"

    map_svg: str | None = None
    places = [p for p in (education.places if education else []) if _text(p.title)]
    if route is not None and network is not None:
        try:
            points = [
                MapPoint(p.title or "", p.latitude, p.longitude)
                for p in places
                if p.latitude is not None and p.longitude is not None
            ]
            map_svg = route_map_svg(network, route, points, width=MAP_WIDTH, height=MAP_HEIGHT)
        except NotImplementedError:
            map_svg = None
        except Exception as exc:  # noqa: BLE001
            log.warning("route map failed: %s", exc)
            gaps.append(Gap("trip.origin_station", "minor", "Route map could not be drawn."))
    route_names = [name for name in (origin, destination) if name]
    if not destination and trip and _text(trip.destination_city):
        route_names.append(trip.destination_city or "")

    legs = (
        _leg("Aller", outbound, origin, destination),
        _leg("Retour", trip.return_ if trip else None, destination, origin),
    )
    place_views = tuple(
        PlaceView(
            p.title or "",
            _text(p.note),
            f"{fmt.minutes(p.walk_minutes)} à pied" if p.walk_minutes else None,
        )
        for p in places
    )
    distance_text = None
    if distance_km:
        distance_text = (
            f"{distance_label.capitalize()} : {fmt.kilometres(distance_km)} par trajet, "
            f"soit {fmt.kilometres(distance_km * 2)} aller-retour."
        )
    journey_known = bool(map_svg or route_names or place_views or any(leg.known for leg in legs))
    journey = JourneyView(
        map_svg=map_svg,
        route_text=tuple(route_names) if not map_svg else (),
        distance=distance_text,
        distance_note=distance_origin.capitalize() + "." if distance_text else None,
        legs=legs if journey_known else (),
        places=place_views,
        empty_note=None if journey_known else "Itinéraire et horaires des trains",
    )

    # ---- head count, competencies, carbon
    head = _head_count(request)
    if head.total is None and not any(
        gap.field == "teacher_feedback.actual_participants" for gap in gaps
    ):
        gaps.append(
            Gap(
                "trip.planned_participants",
                "major",
                "No head count: cover number and CO2 estimate are missing.",
            )
        )
    # Educational-value texts (model-written or supplied): shown for a trip that took place.
    insights = education.insights if education and not cancelled else None
    competencies = _competencies(request, insights)
    why = _paragraphs(insights.why if insights else None)
    insight_shown = bool(
        why or competencies.questions or any(row.insight for row in competencies.rows)
    )
    ai_notice = None
    if insights and insights.origin == "ai" and insight_shown:
        ai_notice = AI_NOTICE + (AI_REVIEWED if insights.reviewed_by_teacher else AI_NOT_REVIEWED)

    carbon: CarbonView | None = None
    carbon_figure: KeyFigure | None = None
    factors_used: tuple[Factor, ...] = ()
    factors = _factors(config)
    if not factors:
        # Reported even when this request could not have used it: the integrator must know.
        gaps.append(
            Gap("data/emission_factors.json", "major", "No emission factor file: CO2 block hidden.")
        )
    if not cancelled and distance_km and head.total:
        if factors:
            try:
                result = estimate(
                    distance_km=distance_km,
                    passengers=head.total,
                    factors=factors,
                    baselines=tuple(environment.baselines)
                    if environment
                    else ("autocar", "voiture"),
                    car_occupancy=(environment.car_occupancy if environment else None)
                    or config.default_car_occupancy,
                )
                if result is None:
                    gaps.append(
                        Gap(
                            "data/emission_factors.json",
                            "major",
                            "No emission factor for the train: CO2 block hidden.",
                        )
                    )
                else:
                    carbon, carbon_figure = _carbon(
                        result, distance_label=distance_label, distance_origin=distance_origin
                    )
                    factors_used = tuple(mode.factor for mode in (result.train, *result.baselines))
            except NotImplementedError:
                carbon = carbon_figure = None
                gaps.append(
                    Gap(
                        "data/emission_factors.json",
                        "major",
                        "CO2 estimate unavailable: block hidden.",
                    )
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("carbon estimate failed: %s", exc)
                carbon = carbon_figure = None
                gaps.append(
                    Gap("data/emission_factors.json", "major", "CO2 estimate failed: block hidden.")
                )

    figures: list[KeyFigure] = [_people_figure(head), _skills_figure(competencies)]
    if carbon_figure is not None:
        figures.append(carbon_figure)
    elif distance_km and not cancelled:
        figures.append(
            KeyFigure(
                "distance",
                "",
                fmt.number(distance_km * 2),
                "km",
                "en train, aller-retour",
                distance_label,
            )
        )

    # ---- cover
    day = None
    if trip and trip.date:
        day = _safe(fmt.day_long, trip.date)
        back = _safe(fmt.day_long, trip.return_date) if trip.return_date else None
        if day and back and trip.return_date != trip.date:
            day = f"du {day} au {back}"
    school_name = _text(school.name if school else None)
    if school_name and school and _text(school.city) and (school.city or "") not in school_name:
        school_name = f"{school_name}, {school.city}"
    subject = _join(
        [
            _text(education.subject if education else None),
            _text(education.theme if education else None),
        ],
        " — ",
    )
    cover = CoverView(
        document_kind=DOCUMENT_KIND,
        title=TITLE,
        trip_title=_text(trip.title if trip else None),
        facts=tuple(
            Fact(label, value, compact=bool(value) and len(value or "") <= 28)
            for label, value in (
                ("École", school_name),
                ("Classe", _text(school.class_name if school else None)),
                ("Date", day),
                ("Matière et thème", subject),
            )
        ),
        figures=tuple(replace(f, long=len(f.value or "") > 5) for f in figures),
    )

    # ---- what we did
    activities = _activities(request, cancelled)
    teacher = _text(school.teacher_name if school else None)
    activities_note = None
    if activities and feedback and not cancelled:
        if feedback.activities_completed == "none" and not feedback.completed_activity_ids:
            activities_note = "Les activités prévues n'ont pas pu être réalisées."
    objectives = tuple(
        text for text in (_text(o) for o in (education.objectives if education else [])) if text
    )
    done = DoneView(
        completion=_COMPLETION.get(feedback.trip_completed or "") if feedback else None,
        completion_kind=(feedback.trip_completed if feedback else None) or "unknown",
        why=why,
        why_tag=AI_TAG if why and insights and insights.origin == "ai" else None,
        activities=activities,
        activities_note=activities_note,
        stacked=len(activities) > 6 or len(objectives) > 6,
        objectives=objectives,
        changes=_text(feedback.changes if feedback else None),
        quote=_paragraphs(feedback.observations if feedback else None),
        quote_author=_join([teacher, _text(school.class_name if school else None)], ", "),
    )

    # ---- photos, logo
    photo_groups = _photos(request, gaps)
    logo_uri = _logo_uri(config.logo_svg)
    if logo_uri is None:
        gaps.append(
            Gap(
                "assets/brand/logo.svg",
                "minor",
                "Logo file is missing or not a readable SVG: masthead has no logo.",
            )
        )

    # ---- sources and validation
    items: list[SourceView] = []
    for source in request.sources:
        label, url = _text(source.label), _text(source.url)
        if label or url:
            when = _safe(fmt.date_short, source.retrieved_at) if source.retrieved_at else None
            consulted = f"consulté le {when}" if when else None
            items.append(SourceView(label, url, consulted))
    for place in places:
        if _text(place.official_url):
            items.append(
                SourceView(
                    place.title,
                    place.official_url,
                    _join([_text(place.license), _text(place.attribution)], " — "),
                )
            )
    data_lines: list[SourceView] = []
    if map_svg or (route is not None and not override):
        data_lines.append(SourceView(RAIL_DATA_LINE, None, None))
    seen: set[tuple[str, str]] = set()
    for factor in factors_used:
        key = (factor.source_name, factor.source_url)
        if key in seen:
            continue
        seen.add(key)
        data_lines.append(
            SourceView(
                f"Facteur d'émission {_mode_name(factor)} : {_factor_source(factor)}",
                _text(factor.source_url),
                None,
            )
        )
    validated_at = feedback.validated_at if feedback else None
    if validated_at:
        validated_on = _safe(fmt.date_long, validated_at)
        validation = f"Validé par {teacher or 'l’enseignant·e'}"
        if validated_on:
            validation += f" le {validated_on}"
    else:
        validation = "Rapport non encore validé par l'enseignant·e"
    sources = SourcesView(
        items=tuple(items),
        data_lines=tuple(data_lines),
        validation=validation,
        validated=bool(validated_at),
        generated=f"Rapport généré le {issued_long}",
        ai_notice=ai_notice,
    )

    reference = _text(trip.reference if trip else None)
    simulated = bool(trip and trip.simulated)
    footer = FooterView(
        basis="Document établi à partir des informations confirmées par l'enseignant·e."
        if feedback
        else "Document établi à partir du dossier de voyage, en attente de confirmation "
        "par l'enseignant·e.",
        trace=_join([f"Généré le {issued_short}", f"Réf. {reference}" if reference else None])
        or "",
        simulation=SIMULATION_LINE if simulated else None,
    )
    assert len(COMPETENCY_KEYS) == len(competencies.rows)
    return ReportView(
        language="fr",
        document_title=_join([DOCUMENT_KIND, cover.trip_title], " — ") or DOCUMENT_KIND,
        logo_uri=logo_uri,
        simulated=simulated,
        cover=cover,
        journey=journey,
        done=done,
        competencies=competencies,
        carbon=carbon,
        photo_groups=photo_groups,
        sources=sources,
        footer=footer,
        gaps=tuple(gaps),
    )


def view_summary(view: ReportView) -> dict[str, Any]:
    """Small log-friendly description of what the report contains."""
    return {
        "map": view.journey.map_svg is not None,
        "carbon": view.carbon is not None,
        "photos": sum(len(group.photos) for group in view.photo_groups),
        "gaps": len(view.gaps),
    }
