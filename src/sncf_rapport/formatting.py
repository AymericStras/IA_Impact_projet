"""French formatting of dates, times and amounts. No locale dependency."""

from __future__ import annotations

from datetime import date as Date  # noqa: N812
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


def day_long(day: Date) -> str:
    """jeudi 12 novembre 2026 for a calendar date (no time zone involved)."""
    number = "1er" if day.day == 1 else str(day.day)
    return f"{_DAYS[day.weekday()]} {number} {_MONTHS[day.month - 1]} {day.year}"


def day_short(day: Date) -> str:
    """12/11/2026 for a calendar date."""
    return day.strftime("%d/%m/%Y")


def iso_day_short(text: str | None) -> str | None:
    """'2026-10-10' (or an ISO datetime) as 10/10/2026; the text itself if it is not ISO."""
    if not text:
        return None
    try:
        return day_short(Date.fromisoformat(text[:10]))
    except ValueError:
        return text


def clock_range(start: datetime | None, end: datetime | None) -> str | None:
    """9 h 37 – 11 h 07, or the single time that is known."""
    if start and end:
        return f"{clock(start)} – {clock(end)}"
    moment = start or end
    return clock(moment) if moment else None


def number(value: float, decimals: int = 0) -> str:
    """1 234 or 2,5: comma decimal, narrow non-breaking thousands separator."""
    text = f"{value:,.{decimals}f}".replace(",", NNBSP).replace(".", ",")
    return "0" + text[2:] if text.startswith("-0") and not text.strip("-0,") else text


def kilograms(value: float) -> str:
    """Whole kilograms from 10 kg up, one decimal below: '123', '4,2'. No unit."""
    return number(value, 0) if abs(value) >= 9.95 else number(value, 1)


def kilometres(value: float) -> str:
    """88 km."""
    return f"{number(value, 0)}{NBSP}km"


def minutes(count: int) -> str:
    """20 min, 1 h 05."""
    hours, rest = divmod(count, 60)
    if hours == 0:
        return f"{rest}{NBSP}min"
    return f"{hours}{NBSP}h" if rest == 0 else f"{hours}{NBSP}h{NBSP}{rest:02d}"


def plural(count: float, singular: str, plural_form: str | None = None) -> str:
    """French plural: 0 and 1 are singular."""
    return singular if abs(count) < 2 else (plural_form or singular + "s")
