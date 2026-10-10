from __future__ import annotations

from sncf_bilan.models import RecapRequest
from sncf_bilan.view import PRICE_PER_PERSON_CENTS, attachment_filename, build_trip_view

from .conftest import example, example_data

NB = " "
NN = " "


def test_round_trip_summary():
    view = build_trip_view(example("01-aller-retour-complet").trip)
    assert (view.origin, view.destination, view.kind) == (
        "Toulouse Matabiau",
        "Carcassonne",
        "Aller-retour",
    )
    assert view.round_trip
    assert (view.departure, view.arrival) == (f"8{NB}h{NB}05", f"9{NB}h{NB}00")
    assert (view.return_from, view.return_departure, view.return_arrival) == (
        "Carcassonne",
        f"16{NB}h{NB}25",
        f"17{NB}h{NB}20",
    )
    assert view.return_date_long is None  # same day: the date is not repeated
    assert (view.price_total, view.price_per_person) == (f"30,00{NB}€", f"1,00{NB}€")
    assert view.travel_class == f"2de{NB}classe"
    assert not view.has_seating


def test_one_way_with_connection_ends_at_the_last_station():
    view = build_trip_view(example("03-correspondance-premiere-classe").trip)
    assert (view.origin, view.destination, view.kind) == (
        "Perpignan",
        "Toulouse Matabiau",
        "Aller simple",
    )
    assert not view.round_trip
    assert view.arrival == f"9{NB}h{NB}38"
    assert view.return_departure is None
    assert view.has_seating
    assert [leg.duration for leg in view.legs] == [f"38{NB}min", f"1{NB}h{NB}24"]
    assert (view.price_total, view.price_per_person) == (f"2,00{NB}€", f"1,00{NB}€")


def test_round_trip_with_connections_picks_the_longest_stay_as_destination():
    data = example_data("01-aller-retour-complet")
    leg = data["trip"]["legs"][0]
    data["trip"]["legs"] = [
        {
            **leg,
            "from_station": "Toulouse Matabiau",
            "to_station": "Narbonne",
            "departure": "2026-11-12T07:00+01:00",
            "arrival": "2026-11-12T08:10+01:00",
        },
        {
            **leg,
            "from_station": "Narbonne",
            "to_station": "Perpignan",
            "departure": "2026-11-12T08:30+01:00",
            "arrival": "2026-11-12T09:10+01:00",
        },
        {
            **leg,
            "from_station": "Perpignan",
            "to_station": "Narbonne",
            "departure": "2026-11-13T16:00+01:00",
            "arrival": "2026-11-13T16:40+01:00",
        },
        {
            **leg,
            "from_station": "Narbonne",
            "to_station": "Toulouse Matabiau",
            "departure": "2026-11-13T17:00+01:00",
            "arrival": "2026-11-13T18:10+01:00",
        },
    ]
    view = build_trip_view(RecapRequest.model_validate(data).trip)
    assert view.destination == "Perpignan"
    assert view.arrival == f"9{NB}h{NB}10"
    assert view.return_from == "Perpignan"
    assert view.return_date_long == "vendredi 13 novembre 2026"
    assert view.return_arrival == f"18{NB}h{NB}10"


def test_missing_values_stay_missing():
    view = build_trip_view(example("02-aller-simple-minimal").trip)
    assert view.travel_class is None
    assert view.arrival is None
    assert view.legs[0].arrival is None and view.legs[0].duration is None
    assert view.reference is None and view.title is None
    assert not view.has_lines


def test_price_is_the_fixed_tariff_times_the_number_of_travellers():
    assert PRICE_PER_PERSON_CENTS == 100
    view = build_trip_view(example("02-aller-simple-minimal", participants_count=1234).trip)
    assert (view.price_total, view.price_per_person) == (f"1{NN}234,00{NB}€", f"1,00{NB}€")
    assert build_trip_view(example("02-aller-simple-minimal").trip).price_total == f"1,00{NB}€"


def test_attachment_filename_uses_only_safe_characters():
    assert attachment_filename(example("01-aller-retour-complet").trip) == (
        "recapitulatif-SIM-050033B9.pdf"
    )
    assert attachment_filename(example("02-aller-simple-minimal").trip) == (
        "recapitulatif-2026-10-20.pdf"
    )
    odd = example("01-aller-retour-complet", reference='../Réf "42"/été')
    assert attachment_filename(odd.trip) == "recapitulatif-Ref-42-ete.pdf"
    assert attachment_filename(example("01-aller-retour-complet", reference="///").trip) == (
        "recapitulatif-voyage.pdf"
    )
