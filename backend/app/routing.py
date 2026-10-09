"""Itinéraire le plus court (Dijkstra) sur les horaires officiels SNCF en Occitanie.

Le graphe est construit à partir des **missions** (data/missions_occitanie.csv, voir
scripts/build_from_gtfs.py) : une mission est une suite d'arrêts parcourue par un ou plusieurs
trains ou cars. Chaque arête relie deux gares desservies **par le même véhicule, sans changer** ;
un itinéraire est donc une suite de trajets directs, et le nombre de correspondances est connu.

Coût d'un itinéraire = temps passé à bord + pour chaque correspondance :
  - `transfer_min` minutes de changement (descendre, changer de quai),
  - l'attente moyenne du véhicule suivant, estimée par sa fréquence : la moitié de l'intervalle entre
    deux passages sur une journée de service de 16 h (19 trains/jour -> ~25 min).
Le premier départ n'est pas pénalisé : le voyageur choisit son heure. Les heures précises ne sont pas
modélisées ; la durée annoncée est une estimation moyenne.

Le départ et la destination sont des noms de ville ou de gare, tels que les sort le NER (FROM / TO).

    python -m app.routing Toulouse Perpignan
    python -m app.routing Toulouse Tarbes --exclude INTERCITES --transfer 5

    from app.routing import Network
    route = Network().route("Toulouse", "Perpignan")
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
DEFAULT_TRANSFER_MIN = 5
SERVICE_DAY_MIN = 16 * 60   # amplitude d'une journée de service, pour estimer l'attente
MAX_WAIT_MIN = 120          # plafond : un car à 1 passage/jour ne coûte pas 8 h d'attente moyenne


def expected_wait(per_day):
    """Attente moyenne avant le prochain passage, en minutes, pour une fréquence donnée (trains/jour)."""
    return min(SERVICE_DAY_MIN / (2 * max(per_day, 0.5)), MAX_WAIT_MIN)

# Ordre d'affichage des types de transport ; ceux qui n'y sont pas viennent après
MODES = ("Train TER", "Car TER", "Car à réservation", "INTERCITES", "INTERCITES de nuit", "TGV INOUI", "OUIGO")


def normalize(s):
    """'Saint-Gaudens' / 'SAINT GAUDENS' / 'saint-gaudéns' -> 'SAINT GAUDENS'."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", " ", s.upper()).strip()


class UnknownPlace(KeyError):
    pass


class SamePlace(ValueError):
    pass


class Network:
    def __init__(self, data_dir=DATA_DIR):
        data_dir = Path(data_dir)
        self.place = {}                 # id UIC -> {"id", "name", "lat", "lon", "department", "commune"}
        self.by_key = defaultdict(set)  # nom normalisé (gare ou commune) -> ids
        with open(data_dir / "stations_occitanie.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                self.place[r["stop_id"]] = {"id": r["stop_id"], "name": r["name"], "lat": float(r["lat"]),
                                            "lon": float(r["lon"]), "department": r["department"], "commune": r["commune"]}
                self.by_key[normalize(r["name"])].add(r["stop_id"])
                if r["commune"]:
                    self.by_key[normalize(r["commune"])].add(r["stop_id"])
        self.name = {i: p["name"] for i, p in self.place.items()}

        self.missions = []
        # Trajets directs : (a, b, mode) -> [minutes, mission, i, j, trains/jour]. On garde la mission la plus rapide,
        # et on additionne les fréquences de toutes les missions qui font a -> b sans changement dans ce mode.
        self.rides = {}
        self.segments = {}              # (a, b, mode) -> minutes : arrêts consécutifs, pour dessiner le réseau
        with open(data_dir / "missions_occitanie.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                m = {"mode": r["mode"], "line": r["line"], "trips": int(r["trips"]), "per_day": int(r["trips_ref_day"]),
                     "stops": r["stops"].split("|"),
                     "arr": [float(x) for x in r["arrival_min"].split("|")],
                     "dep": [float(x) for x in r["departure_min"].split("|")],
                     "pickup": [c == "1" for c in r["pickup"]], "dropoff": [c == "1" for c in r["dropoff"]]}
                k = len(self.missions)
                self.missions.append(m)
                stops = m["stops"]
                for i in range(len(stops) - 1):
                    seg = (stops[i], stops[i + 1], m["mode"])
                    t = m["arr"][i + 1] - m["dep"][i]
                    self.segments[seg] = min(t, self.segments.get(seg, t))
                    if not m["pickup"][i]:
                        continue
                    for j in range(i + 1, len(stops)):
                        if not m["dropoff"][j] or stops[j] == stops[i]:
                            continue
                        key = (stops[i], stops[j], m["mode"])
                        t = m["arr"][j] - m["dep"][i]
                        best = self.rides.get(key)
                        if best is None:
                            self.rides[key] = [t, k, i, j, m["per_day"]]
                        else:
                            best[4] += m["per_day"]
                            if t < best[0]:
                                best[:4] = [t, k, i, j]
        self.adj = defaultdict(list)    # a -> [(b, mode)]
        for a, b, mode in self.rides:
            self.adj[a].append((b, mode))

    # ── Recherche de lieux ───────────────────────────────────────────────────
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
        return sorted({n for n in self.name.values() if key in normalize(n)})[:limit]

    def places(self):
        return sorted(self.place.values(), key=lambda p: normalize(p["name"]))

    def edges(self):
        """Tronçons entre arrêts consécutifs (pour tracer le réseau)."""
        return [{"from_id": a, "to_id": b, "mode": m, "minutes": round(t, 1)} for (a, b, m), t in self.segments.items()]

    def modes(self):
        """Types de transport présents, avec leur nombre de tronçons et de missions."""
        links, missions = defaultdict(int), defaultdict(int)
        for _, _, m in self.segments:
            links[m] += 1
        for m in self.missions:
            missions[m["mode"]] += 1
        order = {m: i for i, m in enumerate(MODES)}
        return [{"id": m, "links": links[m], "missions": missions[m]}
                for m in sorted(links, key=lambda m: (order.get(m, len(MODES)), m))]

    # ── Dijkstra ─────────────────────────────────────────────────────────────
    def route(self, departure, destination, exclude=(), transfer_min=DEFAULT_TRANSFER_MIN):
        """Itinéraire le plus court entre une gare (ou ville) de départ et une gare (ou ville) d'arrivée.

        exclude      : types de transport à ignorer, ex. {"Car TER", "INTERCITES de nuit"}
        transfer_min : minutes de changement par correspondance (en plus de l'attente estimée)

        Renvoie None s'il n'existe aucun chemin, sinon
        {"from", "to", "minutes", "ride_minutes", "transfers", "transfer_min",
         "legs": [{"mode", "line", "from", "to", "from_id", "to_id", "minutes", "wait_minutes",
                   "stops", "trips_per_day"}, ...]}
        où chaque leg est un trajet direct (même train ou même car du début à la fin) et wait_minutes
        le changement + l'attente estimée avant ce leg (0 pour le premier).
        """
        sources, targets = self.resolve(departure), self.resolve(destination)
        if sources & targets:
            raise SamePlace(departure)
        dist = {s: 0.0 for s in sources}
        prev = {}
        heap = [(0.0, s) for s in sources]
        heapq.heapify(heap)
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist[u]:
                continue
            if u in targets:
                return self._itinerary(u, prev, transfer_min, d)
            first = u in sources  # depuis une gare de départ, pas de correspondance
            for v, mode in self.adj[u]:
                if mode in exclude:
                    continue
                ride, _, _, _, per_day = self.rides[(u, v, mode)]
                nd = d + ride + (0 if first else transfer_min + expected_wait(per_day))
                if nd < dist.get(v, float("inf")):
                    dist[v] = nd
                    prev[v] = (u, mode)
                    heapq.heappush(heap, (nd, v))
        return None

    def _itinerary(self, u, prev, transfer_min, total):
        legs = []
        while u in prev:
            p, mode = prev[u]
            minutes, k, i, j, per_day = self.rides[(p, u, mode)]
            m = self.missions[k]
            legs.append({"mode": mode, "line": m["line"], "from": self.name[p], "to": self.name[u],
                         "from_id": p, "to_id": u, "minutes": round(minutes, 1),
                         "wait_minutes": 0 if p not in prev else round(transfer_min + expected_wait(per_day), 1),
                         "stops": m["stops"][i:j + 1], "trips_per_day": per_day})
            u = p
        legs.reverse()
        ride = sum(leg["minutes"] for leg in legs)
        transfers = max(len(legs) - 1, 0)
        return {"from": legs[0]["from"], "to": legs[-1]["to"], "minutes": round(total, 1),
                "ride_minutes": round(ride, 1), "transfers": transfers, "transfer_min": transfer_min, "legs": legs}


def fmt(minutes):
    m = round(minutes)
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


def main():
    p = argparse.ArgumentParser(description="Plus court chemin entre deux villes/gares d'Occitanie.")
    p.add_argument("departure")
    p.add_argument("destination")
    p.add_argument("--exclude", action="append", default=[], metavar="MODE",
                   help="type de transport à ignorer (répétable) : " + ", ".join(MODES))
    p.add_argument("--transfer", type=float, default=DEFAULT_TRANSFER_MIN,
                   help="minutes de changement par correspondance, en plus de l'attente estimée")
    args = p.parse_args()

    net = Network()
    unknown = set(args.exclude) - {m["id"] for m in net.modes()}
    if unknown:
        sys.exit(f"Type de transport inconnu : {', '.join(sorted(unknown))}")
    try:
        r = net.route(args.departure, args.destination, exclude=set(args.exclude), transfer_min=args.transfer)
    except UnknownPlace as e:
        sys.exit(f"Ville ou gare inconnue : {e.args[0]!r}")
    except SamePlace:
        sys.exit("Le départ et la destination désignent la même gare ou la même ville.")
    if r is None:
        sys.exit(f"Aucun itinéraire entre {args.departure} et {args.destination}.")
    n = r["transfers"]
    print(f"{r['from']} -> {r['to']} : {fmt(r['minutes'])} "
          f"({'direct' if n == 0 else f'{n} correspondance' + ('s' if n > 1 else '')})")
    for leg in r["legs"]:
        if leg["wait_minutes"]:
            print(f"  ~{fmt(leg['wait_minutes'])} de correspondance à {leg['from']}")
        print(f"  {leg['from']} -> {leg['to']}  {fmt(leg['minutes'])}  [{leg['mode']} · {leg['line']}]"
              f"  {len(leg['stops']) - 2} arrêt(s) intermédiaire(s), {leg['trips_per_day']}/jour")


if __name__ == "__main__":
    main()
