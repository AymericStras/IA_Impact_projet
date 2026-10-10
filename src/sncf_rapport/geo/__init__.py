"""Rail network of the bundled data set: station lookup, route, distance, SVG map.

Public interface (frozen; `view.py` depends on it):

    network = Network.load(stations_csv, connections_csv)
    station = network.find_station("Toulouse Matabiau")      # Station | None
    route = network.route("Toulouse", "Carcassonne")         # Route | None
    svg = route_map_svg(network, route, points=[MapPoint(...)])  # str (inline <svg>)
"""

from __future__ import annotations

from .network import MapPoint, Network, Route, Station
from .svg import route_map_svg

__all__ = ["MapPoint", "Network", "Route", "Station", "route_map_svg"]
