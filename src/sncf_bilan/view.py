"""Display values shared by the PDF and the email, so both always agree."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from . import formatting as fmt
from .models import Leg, Trip

# Fixed tariff decided by the owner: every traveller pays 1,00 €, whatever the
# trip. The total is participants × this amount. It is not read from the input.
PRICE_PER_PERSON_CENTS = 100


@dataclass(frozen=True)
class LegView:
    from_station: str
    to_station: str
    date: str
    departure: str
    arrival: str | None
    duration: str | None
    line: str | None
    train_number: str | None
    coach: str | None
    seat: str | None


@dataclass(frozen=True)
class TripView:
    origin: str
    destination: str
    round_trip: bool
    kind: str
    title: str | None
    reference: str | None
    date_long: str
    date_short: str
    departure: str
    arrival: str | None
    return_date_long: str | None
    return_departure: str | None
    return_from: str | None
    return_arrival: str | None
    travellers: str
    participants: int
    travel_class: str | None
    price_total: str
    price_per_person: str
    legs: list[LegView]
    has_seating: bool
    has_lines: bool
    simulated: bool


def _leg_view(leg: Leg) -> LegView:
    return LegView(
        from_station=leg.from_station,
        to_station=leg.to_station,
        date=fmt.date_short(leg.departure),
        departure=fmt.clock(leg.departure),
        arrival=fmt.clock(leg.arrival) if leg.arrival else None,
        duration=fmt.duration(leg.departure, leg.arrival) if leg.arrival else None,
        line=leg.line,
        train_number=leg.train_number,
        coach=leg.coach,
        seat=leg.seat,
    )


def _turnaround(legs: list[Leg]) -> int | None:
    """Index of the last outbound leg of a round trip, or None for a one-way trip.

    A trip that ends where it started is a round trip. The destination is where
    the travellers stay longest between two trains.
    """
    if len(legs) < 2 or legs[-1].to_station != legs[0].from_station:
        return None
    best_index, best_stay = 0, None
    for index in range(len(legs) - 1):
        end = legs[index].arrival or legs[index].departure
        stay = legs[index + 1].departure - end
        if best_stay is None or stay > best_stay:
            best_index, best_stay = index, stay
    return best_index


def build_trip_view(trip: Trip) -> TripView:
    legs = trip.ordered_legs
    first = legs[0]
    turn = _turnaround(legs)
    outbound_last = legs[turn] if turn is not None else legs[-1]
    return_first = legs[turn + 1] if turn is not None else None
    same_day_return = return_first is not None and fmt.date_short(
        return_first.departure
    ) == fmt.date_short(first.departure)

    return TripView(
        origin=first.from_station,
        destination=outbound_last.to_station,
        round_trip=turn is not None,
        kind="Aller-retour" if turn is not None else "Aller simple",
        title=trip.title,
        reference=trip.reference,
        date_long=fmt.date_long(first.departure),
        date_short=fmt.date_short(first.departure),
        departure=fmt.clock(first.departure),
        arrival=fmt.clock(outbound_last.arrival) if outbound_last.arrival else None,
        return_date_long=(
            fmt.date_long(return_first.departure)
            if return_first is not None and not same_day_return
            else None
        ),
        return_departure=fmt.clock(return_first.departure) if return_first else None,
        return_from=return_first.from_station if return_first else None,
        return_arrival=(fmt.clock(legs[-1].arrival) if return_first and legs[-1].arrival else None),
        travellers=fmt.travellers(trip.participants_count),
        participants=trip.participants_count,
        travel_class=fmt.travel_class(trip.travel_class),
        price_total=fmt.euros(PRICE_PER_PERSON_CENTS * trip.participants_count),
        price_per_person=fmt.euros(PRICE_PER_PERSON_CENTS),
        legs=[_leg_view(leg) for leg in legs],
        has_seating=any(leg.train_number or leg.coach or leg.seat for leg in legs),
        has_lines=any(leg.line for leg in legs),
        simulated=trip.simulated,
    )


def attachment_filename(trip: Trip) -> str:
    """recapitulatif-<reference or date>.pdf, built from safe characters only."""
    source = trip.reference or fmt.local(trip.ordered_legs[0].departure).strftime("%Y-%m-%d")
    ascii_text = unicodedata.normalize("NFKD", source).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_text).strip("-")
    return f"recapitulatif-{slug or 'voyage'}.pdf"
