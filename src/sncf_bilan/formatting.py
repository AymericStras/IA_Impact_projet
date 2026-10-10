"""French formatting of dates, times and amounts. No locale dependency."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
NBSP = " "
NNBSP = " "

_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
_MONTHS = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]  # fmt: skip


def local(moment: datetime) -> datetime:
    """Station clocks: every time is shown in French local time."""
    return moment.astimezone(PARIS)


def date_long(moment: datetime) -> str:
    """jeudi 12 novembre 2026, lundi 1er juin 2026."""
    value = local(moment)
    day = "1er" if value.day == 1 else str(value.day)
    return f"{_DAYS[value.weekday()]} {day} {_MONTHS[value.month - 1]} {value.year}"


def date_short(moment: datetime) -> str:
    """12/11/2026."""
    return local(moment).strftime("%d/%m/%Y")


def clock(moment: datetime) -> str:
    """8 h 05 (non-breaking spaces)."""
    value = local(moment)
    return f"{value.hour}{NBSP}h{NBSP}{value.minute:02d}"


def duration(start: datetime, end: datetime) -> str:
    """55 min, 1 h 24, 2 h."""
    minutes = int((end - start).total_seconds() // 60)
    hours, rest = divmod(minutes, 60)
    if hours == 0:
        return f"{rest}{NBSP}min"
    if rest == 0:
        return f"{hours}{NBSP}h"
    return f"{hours}{NBSP}h{NBSP}{rest:02d}"


def euros(cents: int) -> str:
    """450,00 €, 1 234,50 € (narrow non-breaking thousands separator)."""
    whole, fraction = divmod(cents, 100)
    digits = f"{whole:,}".replace(",", NNBSP)
    return f"{digits},{fraction:02d}{NBSP}€"


def travel_class(value: str | None) -> str | None:
    return {"1": f"1re{NBSP}classe", "2": f"2de{NBSP}classe"}.get(value or "")


def travellers(count: int) -> str:
    return f"{count}{NBSP}voyageur" if count == 1 else f"{count}{NBSP}voyageurs"
