"""Station lookup, route geometry and the inline SVG map."""

from __future__ import annotations

import xml.etree.ElementTree as ET  # noqa: S405 - parses our own output only
from dataclasses import replace

import pytest

from sncf_rapport.config import Config
from sncf_rapport.geo import MapPoint, Network, Route, route_map_svg

SVG_NS = "http://www.w3.org/2000/svg"


@pytest.fixture(scope="module")
def network() -> Network:
    config = Config()
    return Network.load(config.stations_csv, config.connections_csv)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Toulouse Matabiau", "Toulouse Matabiau"),
        ("TOULOUSE-MATABIAU", "Toulouse Matabiau"),
        ("Gare de Toulouse Matabiau", "Toulouse Matabiau"),
        ("beziers", "Béziers"),
        ("  Sete ", "Sète"),
        ("nimes centre", "Nîmes Centre"),
        ("gare d'Agde", "Agde"),
        ("St Gaudens", "Saint-Gaudens"),
        ("Latour de Carol", "Latour-de-Carol - Enveitg"),
    ],
)
def test_station_name_is_matched_loosely(network: Network, text: str, expected: str) -> None:
    station = network.find_station(text)
    assert station is not None
    assert station.name == expected


@pytest.mark.parametrize(
    ("city", "expected"),
    [
        ("Toulouse", "Toulouse Matabiau"),
        ("Montpellier", "Montpellier Saint-Roch"),
        ("Nîmes", "Nîmes Centre"),
        ("Albi", "Albi Ville"),
        ("Montauban", "Montauban Ville Bourbon"),
    ],
)
def test_city_gives_its_main_station(network: Network, city: str, expected: str) -> None:
    station = network.find_station(city)
    assert station is not None
    assert station.name == expected


@pytest.mark.parametrize("text", [None, "", "   ", "Paris", "Zzyzx", "---"])
def test_unknown_station_is_none(network: Network, text: str | None) -> None:
    assert network.find_station(text) is None


@pytest.mark.parametrize("text", ["Saint", "Villefranche", "Les"])
def test_ambiguous_station_is_none(network: Network, text: str) -> None:
    assert network.find_station(text) is None


def test_load_builds_a_connected_regional_graph(network: Network) -> None:
    assert len(network.stations) == 260
    assert len(network.segments) > 200
    toulouse = network.find_station("Toulouse")
    assert toulouse is not None
    assert network.degree(toulouse) > 5


def test_route_follows_the_intermediate_stops(network: Network) -> None:
    route = network.route("Toulouse", "Carcassonne")
    assert route is not None
    names = [s.name for s in route.stations]
    assert names[0] == "Toulouse Matabiau"
    assert names[-1] == "Carcassonne"
    assert route.origin.name == names[0]
    assert route.destination.name == names[-1]
    assert "Castelnaudary" in names
    assert "Villefranche-de-Lauragais" in names
    assert len(names) == len(set(names))
    assert 80 <= route.distance_km <= 100
    assert route.distance_km == round(route.distance_km, 1)
    assert route.duration_min is not None
    assert 30 <= route.duration_min <= 90


@pytest.mark.parametrize(
    ("origin", "destination", "low", "high", "via"),
    [
        ("Toulouse", "Narbonne", 135, 155, "Carcassonne"),
        ("Montpellier", "Nîmes", 44, 54, "Lunel"),
        ("Montpellier", "Perpignan", 140, 165, "Narbonne"),
        ("Toulouse", "Tarbes", 135, 160, "Saint-Gaudens"),
    ],
)
def test_distances_are_close_to_rail_distances(
    network: Network, origin: str, destination: str, low: float, high: float, via: str
) -> None:
    route = network.route(origin, destination)
    assert route is not None
    assert low <= route.distance_km <= high
    assert via in [s.name for s in route.stations]


def test_route_is_symmetric(network: Network) -> None:
    there = network.route("Toulouse", "Montpellier")
    back = network.route("Montpellier", "Toulouse")
    assert there is not None
    assert back is not None
    assert there.distance_km == back.distance_km
    assert there.duration_min == back.duration_min
    assert [s.id for s in there.stations] == [s.id for s in back.stations][::-1]


def test_route_without_two_known_stations_is_none(network: Network) -> None:
    assert network.route("Toulouse", "Paris") is None
    assert network.route("Atlantide", "Toulouse") is None
    assert network.route(None, "Toulouse") is None
    assert network.route("Toulouse", "") is None
    assert network.route("Toulouse", "Toulouse Matabiau") is None


@pytest.mark.parametrize(
    ("origin", "destination"),
    [
        ("Toulouse", "Carcassonne"),
        ("Toulouse", "Montpellier"),
        ("Perpignan", "Nîmes"),
        ("Toulouse", "Montaudran"),
    ],
)
def test_svg_is_well_formed_and_self_contained(
    network: Network, origin: str, destination: str
) -> None:
    route = network.route(origin, destination)
    assert route is not None
    svg = route_map_svg(network, route)
    root = ET.fromstring(svg)  # noqa: S314 - our own output
    assert root.tag == f"{{{SVG_NS}}}svg"
    assert root.get("viewBox") == "0 0 520 300"
    texts = ["".join(node.itertext()) for node in root.iter(f"{{{SVG_NS}}}text")]
    assert route.origin.name in texts
    assert route.destination.name in texts
    assert svg.count("http") == 1  # the xmlns, nothing else
    lowered = svg.lower()
    for forbidden in ("<script", "<style", "<image", "href", "@import", "url(http"):
        assert forbidden not in lowered
    assert any(text.endswith(" km") for text in texts)


def test_svg_respects_the_requested_size(network: Network) -> None:
    route = network.route("Toulouse", "Albi")
    assert route is not None
    root = ET.fromstring(route_map_svg(network, route, width=400, height=400))  # noqa: S314
    assert root.get("viewBox") == "0 0 400 400"


def test_svg_escapes_names(network: Network) -> None:
    route = network.route("Toulouse", "Carcassonne")
    assert route is not None
    odd = replace(route.destination, name='Bram & <Cie> "Sud"')
    renamed = Route((*route.stations[:-1], odd), route.distance_km, route.duration_min)
    svg = route_map_svg(network, renamed)
    assert "Bram &amp; &lt;Cie&gt;" in svg
    assert "& <Cie>" not in svg
    root = ET.fromstring(svg)  # noqa: S314 - our own output
    texts = ["".join(node.itertext()) for node in root.iter(f"{{{SVG_NS}}}text")]
    assert odd.name in texts


def test_svg_shows_only_places_away_from_the_end_markers(network: Network) -> None:
    route = network.route("Toulouse", "Carcassonne")
    assert route is not None
    end = route.destination
    plain = route_map_svg(network, route)
    near = MapPoint("Cité & remparts", end.latitude - 0.008, end.longitude + 0.012)
    far = MapPoint("Lac & plage", end.latitude + 0.12, end.longitude - 0.15)
    assert route_map_svg(network, route, [near]) == plain
    with_far = route_map_svg(network, route, [near, far])
    assert "#ffd500" in with_far
    assert "Lac &amp; plage" in with_far
    assert "remparts" not in with_far
    ET.fromstring(with_far)  # noqa: S314 - our own output
