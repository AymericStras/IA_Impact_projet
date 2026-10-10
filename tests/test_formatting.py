from __future__ import annotations

from datetime import datetime

import pytest

from sncf_bilan import formatting as fmt

NB = " "


def at(text: str) -> datetime:
    return datetime.fromisoformat(text)


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        ("2026-11-12T08:05+01:00", "jeudi 12 novembre 2026"),
        ("2026-06-01T10:00+02:00", "lundi 1er juin 2026"),
        ("2026-08-16T23:30+02:00", "dimanche 16 août 2026"),
        # 23:30 UTC is already the next day in Paris.
        ("2026-12-31T23:30+00:00", "vendredi 1er janvier 2027"),
    ],
)
def test_date_long(moment, expected):
    assert fmt.date_long(at(moment)) == expected


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        ("2026-11-12T08:05+01:00", f"8{NB}h{NB}05"),
        ("2026-11-12T00:00+01:00", f"0{NB}h{NB}00"),
        ("2026-11-12T16:25+01:00", f"16{NB}h{NB}25"),
        # Times are shown on French clocks, in winter and in summer.
        ("2026-11-12T07:05+00:00", f"8{NB}h{NB}05"),
        ("2026-07-12T07:05+00:00", f"9{NB}h{NB}05"),
    ],
)
def test_clock(moment, expected):
    assert fmt.clock(at(moment)) == expected


def test_date_short():
    assert fmt.date_short(at("2026-01-05T08:05+01:00")) == "05/01/2026"


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        ("2026-11-12T08:05+01:00", "2026-11-12T09:00+01:00", f"55{NB}min"),
        ("2026-11-12T08:14+01:00", "2026-11-12T09:38+01:00", f"1{NB}h{NB}24"),
        ("2026-11-12T08:00+01:00", "2026-11-12T10:00+01:00", f"2{NB}h"),
        ("2026-11-12T08:00+01:00", "2026-11-12T08:00+01:00", f"0{NB}min"),
        # The night the clocks go back: 3 real hours between 01:30 and 03:30 local.
        ("2026-10-25T01:30+02:00", "2026-10-25T03:30+01:00", f"3{NB}h"),
    ],
)
def test_duration(start, end, expected):
    assert fmt.duration(at(start), at(end)) == expected


@pytest.mark.parametrize(
    ("cents", "expected"),
    [
        (0, f"0,00{NB}€"),
        (5, f"0,05{NB}€"),
        (1500, f"15,00{NB}€"),
        (45000, f"450,00{NB}€"),
        (123450, f"1 234,50{NB}€"),
        (123456789, f"1 234 567,89{NB}€"),
    ],
)
def test_euros(cents, expected):
    assert fmt.euros(cents) == expected


def test_travel_class_and_travellers():
    assert fmt.travel_class("1") == f"1re{NB}classe"
    assert fmt.travel_class("2") == f"2de{NB}classe"
    assert fmt.travel_class(None) is None
    assert fmt.travellers(1) == f"1{NB}voyageur"
    assert fmt.travellers(30) == f"30{NB}voyageurs"
