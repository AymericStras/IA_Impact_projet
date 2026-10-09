"""Construit la base Occitanie à partir des horaires officiels SNCF (GTFS).

    python scripts/build_from_gtfs.py            # télécharge si besoin, puis construit
    python scripts/build_from_gtfs.py --refresh  # force le re-téléchargement

Sources (dans backend/.cache/, non versionné) :
  - GTFS SNCF TGV + Intercités + TER : https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip
  - Liste des gares SNCF (département, commune par code UIC) : ressources.data.sncf.com, jeu « liste-des-gares »
  - Contours des départements (repli pour les arrêts absents de la liste des gares) : github.com/gregoiredavid/france-geojson

Produit dans backend/data/ :
  - stations_occitanie.csv    une ligne par gare (StopArea) : id UIC, nom, coordonnées, département, commune
  - missions_occitanie.csv    une ligne par « mission » : suite d'arrêts identique parcourue par un ou plusieurs trains,
                              avec les temps de passage médians. C'est ce qui permet de savoir qu'un trajet est direct.
  - connections_occitanie.csv tronçons entre arrêts consécutifs, au format historique du projet (notebook, Neo4j)
  - build_info.json           dates de validité des horaires, jour de référence, volumes
"""
import argparse
import csv
import io
import json
import re
import statistics
import sys
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
DATA = ROOT / "data"

GTFS_URL = "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"
GARES_URL = "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/liste-des-gares/exports/csv?delimiter=%3B"
DEPTS_URL = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson"

OCCITANIE = {"09": "Ariège", "11": "Aude", "12": "Aveyron", "30": "Gard", "31": "Haute-Garonne", "32": "Gers",
             "34": "Hérault", "46": "Lot", "48": "Lozère", "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales",
             "81": "Tarn", "82": "Tarn-et-Garonne"}
# Libellés de la liste des gares (majuscules sans accents) -> nom propre
GARES_DEPT = {normalized: name for name in OCCITANIE.values()
              for normalized in [unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()]}


def fetch(url, path, refresh):
    if path.exists() and not refresh:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"téléchargement {url}", file=sys.stderr)
    with urllib.request.urlopen(url) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def seconds(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def ascii_upper(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.upper()).strip()


def point_in_polygon(lon, lat, rings):
    inside = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def load_departments(path):
    polys = []
    for f in json.load(open(path))["features"]:
        code = f["properties"]["code"]
        if code not in OCCITANIE:
            continue
        g = f["geometry"]
        parts = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        polys += [(OCCITANIE[code], p) for p in parts]
    return polys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-télécharger les sources")
    args = ap.parse_args()

    gtfs = zipfile.ZipFile(fetch(GTFS_URL, CACHE / "gtfs" / "sncf.zip", args.refresh))
    gares_path = fetch(GARES_URL, CACHE / "liste-des-gares.csv", args.refresh)
    depts = load_departments(fetch(DEPTS_URL, CACHE / "departements.geojson", args.refresh))

    def table(name):
        return csv.DictReader(io.TextIOWrapper(gtfs.open(name), encoding="utf-8-sig"))

    # ── Gares d'Occitanie ────────────────────────────────────────────────────
    gares = {r["code_uic"][:8]: r for r in csv.DictReader(open(gares_path, encoding="utf-8-sig"), delimiter=";")}
    stations, point_area, point_mode = {}, {}, {}
    for r in table("stops.txt"):
        if r["location_type"] == "1":  # StopArea = la gare
            uic = r["stop_id"].removeprefix("StopArea:OCE")
            lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
            g = gares.get(uic)
            if g:
                dept = GARES_DEPT.get(g["departemen"])
                commune = g["commune"].title()
            else:
                dept = next((d for d, rings in depts if point_in_polygon(lon, lat, rings)), None)
                commune = ""
            if dept:
                stations[r["stop_id"]] = {"id": uic, "name": r["stop_name"], "lat": round(lat, 6), "lon": round(lon, 6),
                                          "department": dept, "commune": commune}
        else:  # StopPoint = un quai pour un mode : "StopPoint:OCETrain TER-87611004"
            point_area[r["stop_id"]] = r["parent_station"]
            point_mode[r["stop_id"]] = r["stop_id"].split(":", 1)[1].rsplit("-", 1)[0].removeprefix("OCE")
    print(f"{len(stations)} gares en Occitanie", file=sys.stderr)

    # ── Jour de référence : le mardi, mercredi ou jeudi où roulent le plus de services ──
    active = defaultdict(set)
    for r in table("calendar_dates.txt"):
        if r["exception_type"] == "1":
            active[r["date"]].add(r["service_id"])
    weekdays = {d: s for d, s in active.items() if date(int(d[:4]), int(d[4:6]), int(d[6:])).weekday() in (1, 2, 3)}
    ref_day = max(weekdays, key=lambda d: len(weekdays[d]))
    ref_services = weekdays[ref_day]

    trips = {r["trip_id"]: (r["route_id"], r["service_id"]) for r in table("trips.txt")}
    routes = {r["route_id"]: r["route_long_name"] or r["route_short_name"] for r in table("routes.txt")}

    # ── Horaires : on ne garde que les morceaux de trajets à l'intérieur de l'Occitanie ──
    def runs(rows):
        """Découpe un trajet en suites contiguës d'arrêts en Occitanie (un train peut sortir de la région)."""
        rows.sort(key=lambda r: int(r["stop_sequence"]))
        run = []
        for r in rows:
            area = point_area.get(r["stop_id"])
            if area in stations:
                run.append(r)
            else:
                if len(run) > 1:
                    yield run
                run = []
        if len(run) > 1:
            yield run

    missions = defaultdict(lambda: {"trips": 0, "ref": 0, "arr": defaultdict(list), "dep": defaultdict(list), "routes": Counter()})
    n_rows = 0
    current, rows = None, []

    def flush(trip_id, rows):
        route_id, service = trips[trip_id]
        for run in runs(rows):
            mode = point_mode[run[0]["stop_id"]]
            areas = tuple(point_area[r["stop_id"]] for r in run)
            pickup = tuple(r["pickup_type"] != "1" for r in run)
            dropoff = tuple(r["drop_off_type"] != "1" for r in run)
            m = missions[(mode, areas, pickup, dropoff)]
            t0 = seconds(run[0]["departure_time"])
            for k, r in enumerate(run):
                m["arr"][k].append((seconds(r["arrival_time"]) - t0) / 60)
                m["dep"][k].append((seconds(r["departure_time"]) - t0) / 60)
            m["trips"] += 1
            m["ref"] += service in ref_services
            m["routes"][routes.get(route_id, "")] += 1

    for r in table("stop_times.txt"):  # le fichier est groupé par trajet
        n_rows += 1
        if r["trip_id"] != current:
            if rows:
                flush(current, rows)
            current, rows = r["trip_id"], []
        rows.append(r)
    if rows:
        flush(current, rows)
    print(f"{n_rows} horaires lus, {len(missions)} missions en Occitanie", file=sys.stderr)

    # ── Écriture ─────────────────────────────────────────────────────────────
    DATA.mkdir(exist_ok=True)
    used = set()
    mission_rows = []
    for i, ((mode, areas, pickup, dropoff), m) in enumerate(sorted(missions.items(), key=lambda kv: (kv[0][0], -kv[1]["trips"]))):
        used.update(areas)
        arr = [round(statistics.median(m["arr"][k]), 1) for k in range(len(areas))]
        dep = [round(statistics.median(m["dep"][k]), 1) for k in range(len(areas))]
        mission_rows.append({
            "mission_id": f"M{i:05d}", "mode": mode, "line": m["routes"].most_common(1)[0][0],
            "trips": m["trips"], "trips_ref_day": m["ref"],
            "stops": "|".join(stations[a]["id"] for a in areas),
            "arrival_min": "|".join(f"{x:g}" for x in arr), "departure_min": "|".join(f"{x:g}" for x in dep),
            "pickup": "".join("1" if p else "0" for p in pickup), "dropoff": "".join("1" if d else "0" for d in dropoff),
        })
    with open(DATA / "missions_occitanie.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(mission_rows[0]))
        w.writeheader()
        w.writerows(mission_rows)

    by_id = {s["id"]: s for a, s in stations.items() if a in used}
    with open(DATA / "stations_occitanie.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["stop_id", "name", "lat", "lon", "department", "commune"])
        w.writeheader()
        for s in sorted(by_id.values(), key=lambda s: ascii_upper(s["name"])):
            w.writerow({"stop_id": s["id"], **{k: s[k] for k in ("name", "lat", "lon", "department", "commune")}})

    # Format historique : un tronçon entre deux arrêts consécutifs, durée moyenne pondérée par le nombre de trains
    seg = defaultdict(lambda: [0.0, 0])
    for m in mission_rows:
        ids = m["stops"].split("|")
        arr = [float(x) for x in m["arrival_min"].split("|")]
        dep = [float(x) for x in m["departure_min"].split("|")]
        for k in range(len(ids) - 1):
            s = seg[(m["mode"], ids[k], ids[k + 1])]
            s[0] += (arr[k + 1] - dep[k]) * m["trips"]
            s[1] += m["trips"]

    def city(s):
        return ascii_upper(s["commune"] or s["name"])

    def td(minutes):
        total = round(minutes * 60)
        return f"0 days {total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}"

    with open(DATA / "connections_occitanie.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["stop_id", "stop_name", "next_stop_id", "next_stop_name", "duration_min_mean",
                    "stop_id_clean", "next_stop_id_clean", "departure_city", "destination_city"])
        for (mode, a, b), (total, n) in sorted(seg.items(), key=lambda kv: (by_id[kv[0][1]]["name"], kv[0][0], by_id[kv[0][2]]["name"])):
            sa, sb = by_id[a], by_id[b]
            w.writerow([f"StopPoint:OCE{mode}-{a}", sa["name"], f"StopPoint:OCE{mode}-{b}", sb["name"], td(total / n),
                        a, b, city(sa), city(sb)])

    feed = next(table("feed_info.txt"))
    info = {"source": GTFS_URL, "feed_version": feed["feed_version"], "valid_from": feed["feed_start_date"],
            "valid_until": feed["feed_end_date"], "reference_day": ref_day, "stations": len(by_id),
            "missions": len(mission_rows), "segments": len(seg),
            "modes": dict(Counter(m["mode"] for m in mission_rows))}
    json.dump(info, open(DATA / "build_info.json", "w"), ensure_ascii=False, indent=2)
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
