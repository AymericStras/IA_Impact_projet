"""Itinéraire le plus court en temps (Dijkstra) sur connections_occitanie.csv.

Le départ et la destination sont des noms de ville ou de gare, tels que les
sort le NER (FROM / TO) : "Toulouse", "montpellier", "Perpignan", "Nîmes Pont du Gard"...

    python -m app.routing Toulouse Perpignan
    python -m app.routing "Montpellier" "Rodez" --csv chemin/vers/connections_final.csv

    from app.routing import Network
    net = Network()
    route = net.route("Toulouse", "Perpignan")
"""
import argparse
import csv
import heapq
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_CSV = DATA_DIR / "connections_occitanie.csv"
DEFAULT_STATIONS = DATA_DIR / "stations_occitanie.csv"


def normalize(s):
    """'Saint-Gaudens' / 'SAINT GAUDENS' / 'saint-gaudéns' -> 'SAINT GAUDENS'."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", " ", s.upper()).strip()


def to_minutes(v):
    """'0 days 00:12:54' -> 12.9"""
    m = re.search(r"(?:(\d+) days? )?(\d+):(\d+):(\d+)", v)
    if not m:
        return float(v)
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mi + s / 60


def mode_of(stop_id):
    """'StopPoint:OCETrain TER-87781278' -> 'Train TER'"""
    return stop_id.split(":", 1)[1].rsplit("-", 1)[0].removeprefix("OCE")


# Services routiers : exclus quand on demande « train seulement »
COACH_MODES = {"Car TER"}


class UnknownPlace(KeyError):
    pass


class Network:
    def __init__(self, path=DEFAULT_CSV, stations_path=DEFAULT_STATIONS):
        self.adj = defaultdict(list)  # stop -> [(minutes, next_stop, mode)]
        self.place = {}               # stop -> {"id", "name", "lat", "lon", "department", "commune"}
        self.name = {}                # stop -> nom de gare
        self.by_key = defaultdict(set)  # nom normalisé (ville ou gare) -> stops
        with open(path, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                a, b = r["stop_id_clean"], r["next_stop_id_clean"]
                self.adj[a].append((to_minutes(r["duration_min_mean"]), b, mode_of(r["stop_id"])))
                for stop, station, city in ((a, r["stop_name"], r["departure_city"]),
                                            (b, r["next_stop_name"], r["destination_city"])):
                    self.name[stop] = station
                    self.by_key[normalize(city)].add(stop)
                    self.by_key[normalize(station)].add(stop)
        # Coordonnées des gares (référentiel SNCF « liste des gares ») : optionnel, sert au front
        if stations_path and Path(stations_path).exists():
            with open(stations_path, encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    if r["stop_id"] in self.name:
                        self.place[r["stop_id"]] = {"id": r["stop_id"], "name": r["name"], "lat": float(r["lat"]),
                                                    "lon": float(r["lon"]), "department": r["department"],
                                                    "commune": r["commune"]}

    def resolve(self, query):
        """Toutes les gares d'une ville (ou la gare exacte). Repli : gares dont le nom commence par la requête."""
        key = normalize(query)
        if key in self.by_key:
            stops = self.by_key[key]
            # « Toulouse » -> Toulouse Matabiau plutôt que Montaudran ou Saint-Agne :
            # les gares qui portent le nom de la ville passent avant celles de la banlieue.
            named = {s for s in stops if (normalize(self.name[s]) + " ").startswith(key + " ")}
            return named or stops
        hits = {s for k, stops in self.by_key.items() if k.startswith(key + " ") for s in stops}
        if not hits:
            raise UnknownPlace(query)
        return hits

    def stations(self, query="", limit=20):
        """Gares dont le nom normalisé contient la requête, triées par nom."""
        key = normalize(query)
        names = sorted({n for n in self.name.values() if key in normalize(n)})
        return names[:limit]

    def places(self):
        """Toutes les gares avec coordonnées, triées par nom."""
        return sorted(self.place.values(), key=lambda p: normalize(p["name"]))

    def edges(self):
        """Liaisons dédoublonnées (a, b, mode) avec la durée la plus courte."""
        best = {}
        for a, out in self.adj.items():
            for w, b, mode in out:
                k = (a, b, mode)
                best[k] = min(w, best.get(k, w))
        return [{"from_id": a, "to_id": b, "mode": m, "minutes": round(w, 1)} for (a, b, m), w in best.items()]

    def route(self, departure, destination, trains_only=False):
        """Plus court chemin en minutes entre n'importe quelle gare de départ et n'importe quelle gare d'arrivée.

        trains_only=True ignore les cars TER : seuls les tronçons en train sont parcourus.

        Renvoie None s'il n'existe aucun chemin, sinon
        {"from", "to", "minutes", "steps": [{"from", "to", "from_id", "to_id", "minutes", "mode"}, ...]}.
        """
        sources, targets = self.resolve(departure), self.resolve(destination)
        if sources & targets:
            raise ValueError("Le départ et la destination désignent la même gare ou la même ville.")
        dist = {s: 0.0 for s in sources}
        prev = {}
        heap = [(0.0, s) for s in sources]
        heapq.heapify(heap)
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist[u]:
                continue
            if u in targets:
                steps = []
                while u in prev:
                    p, minutes, mode = prev[u]
                    steps.append({"from": self.name[p], "to": self.name[u], "from_id": p, "to_id": u,
                                  "minutes": round(minutes, 1), "mode": mode})
                    u = p
                steps.reverse()
                return {"from": steps[0]["from"] if steps else self.name[u],
                        "to": steps[-1]["to"] if steps else self.name[u],
                        "minutes": round(d, 1), "steps": steps}
            for w, v, mode in self.adj[u]:
                if trains_only and mode in COACH_MODES:
                    continue
                nd = d + w
                if nd < dist.get(v, float("inf")):
                    dist[v] = nd
                    prev[v] = (u, w, mode)
                    heapq.heappush(heap, (nd, v))
        return None


def fmt(minutes):
    m = round(minutes)
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


def main():
    p = argparse.ArgumentParser(description="Plus court chemin en temps entre deux villes/gares.")
    p.add_argument("departure")
    p.add_argument("destination")
    p.add_argument("--csv", default=DEFAULT_CSV)
    p.add_argument("--trains-only", action="store_true", help="ignorer les cars TER")
    args = p.parse_args()

    try:
        r = Network(args.csv).route(args.departure, args.destination, trains_only=args.trains_only)
    except UnknownPlace as e:
        sys.exit(f"Ville ou gare inconnue : {e.args[0]!r}")
    except ValueError as e:
        sys.exit(str(e))
    if r is None:
        sys.exit(f"Aucun itinéraire entre {args.departure} et {args.destination}.")
    print(f"{r['from']} -> {r['to']} : {fmt(r['minutes'])} ({len(r['steps'])} tronçon{'s' if len(r['steps']) > 1 else ''})")
    for s in r["steps"]:
        print(f"  {s['from']} -> {s['to']}  {fmt(s['minutes'])}  [{s['mode']}]")


if __name__ == "__main__":
    main()
