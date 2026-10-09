"""Horloge injectable et formatage des dates en français (fuseau Europe/Paris)."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Protocol
from zoneinfo import ZoneInfo

from app.schemas.requirements import TimeConstraint

PARIS = ZoneInfo("Europe/Paris")

WEEKDAYS_FR = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
MONTHS_FR = (
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
)


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(tz=PARIS)


class FixedClock:
    """Horloge figée pour les tests et les évaluations."""

    def __init__(self, at: datetime | date) -> None:
        if isinstance(at, datetime):
            self._now = at if at.tzinfo else at.replace(tzinfo=PARIS)
        else:
            self._now = datetime.combine(at, time(12, 0), tzinfo=PARIS)

    def now(self) -> datetime:
        return self._now


def today(clock: Clock) -> date:
    return clock.now().astimezone(PARIS).date()


def weekday_fr(day: date) -> str:
    return WEEKDAYS_FR[day.weekday()]


def format_date_fr(day: date, with_year: bool = True) -> str:
    text = f"{weekday_fr(day)} {day.day} {MONTHS_FR[day.month - 1]}"
    return f"{text} {day.year}" if with_year else text


def format_time_fr(hhmm: str) -> str:
    hour, minute = hhmm.split(":")
    return f"{int(hour)} h {minute}"


def format_constraint_fr(constraint: TimeConstraint | None, hhmm: str) -> str:
    """« vers 8 h 00 », « au plus tard à 17 h 00 »…"""
    time_text = format_time_fr(hhmm)
    prefixes = {
        TimeConstraint.EXACT: "à",
        TimeConstraint.APPROXIMATE: "vers",
        TimeConstraint.EARLIEST: "à partir de",
        TimeConstraint.LATEST: "au plus tard à",
    }
    prefix = prefixes[constraint] if constraint is not None else "à"
    return f"{prefix} {time_text}"


def combine_paris(day: date, hhmm: str) -> datetime:
    hour, minute = (int(part) for part in hhmm.split(":"))
    return datetime.combine(day, time(hour, minute), tzinfo=PARIS)
