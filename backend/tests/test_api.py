from fastapi.testclient import TestClient

from app.main import app
from app.routing import Network, expected_wait, normalize

client = TestClient(app)
ALL_BUT_TER_TRAIN = ["Car TER", "Car à réservation", "INTERCITES", "INTERCITES de nuit", "TGV INOUI", "OUIGO"]


def route(**params):
    return client.get("/route", params=params)


def code(response):
    return response.json()["detail"]["code"]


def test_helpers():
    assert normalize("Saint-Gaudéns") == "SAINT GAUDENS"
    assert expected_wait(16) == 30            # 16 passages sur 16 h -> un par heure -> 30 min d'attente moyenne
    assert expected_wait(0) == 120            # plafonné


def test_route_shape():
    body = route(**{"from": "Toulouse", "to": "Perpignan"}).json()
    assert body["from"] == "Toulouse Matabiau" and body["to"] == "Perpignan"
    legs = body["legs"]
    assert body["transfers"] == len(legs) - 1
    assert all(a["to_id"] == b["from_id"] for a, b in zip(legs, legs[1:]))       # les legs s'enchaînent
    assert all(leg["stops"][0] == leg["from_id"] and leg["stops"][-1] == leg["to_id"] for leg in legs)
    assert legs[0]["wait_minutes"] == 0
    assert abs(body["minutes"] - sum(l["minutes"] + l["wait_minutes"] for l in legs)) < 0.5


def test_direct_trains_are_found():
    # Le trou de l'ancienne base : il existe bien des TER directs Toulouse -> Narbonne -> Perpignan
    ter = route(**{"from": "Toulouse", "to": "Perpignan", "exclude": ALL_BUT_TER_TRAIN}).json()
    assert ter["transfers"] == 0 and ter["legs"][0]["mode"] == "Train TER"
    places = {p["id"]: p["name"] for p in client.get("/places").json()["places"]}
    assert "Narbonne" in {places[s] for s in ter["legs"][0]["stops"]}
    assert route(**{"from": "Toulouse", "to": "Narbonne"}).json()["transfers"] == 0


def test_exclude_modes():
    full = route(**{"from": "Toulouse", "to": "Tarbes"}).json()
    no_ic = route(**{"from": "Toulouse", "to": "Tarbes", "exclude": ["INTERCITES", "INTERCITES de nuit"]}).json()
    assert not any("INTERCITES" in leg["mode"] for leg in no_ic["legs"])
    assert full["minutes"] <= no_ic["minutes"]


def test_city_prefers_station_named_after_it():
    assert route(**{"from": "Toulouse", "to": "Tarbes"}).json()["from"] == "Toulouse Matabiau"
    assert route(**{"from": "montpellier", "to": "NIMES"}).status_code == 200


def test_errors():
    assert code(route(**{"from": "Toulouse", "to": "Paris"})) == "unknown_place"
    assert code(route(**{"from": "Toulouse", "to": "Toulouse"})) == "same_place"
    assert code(route(**{"from": "Toulouse", "to": "Tarbes", "exclude": "Avion"})) == "unknown_mode"
    every_mode = [m["id"] for m in client.get("/modes").json()["modes"]]
    assert code(route(**{"from": "Toulouse", "to": "Tarbes", "exclude": every_mode})) == "no_route"


def test_places_network_modes_info():
    places = client.get("/places").json()["places"]
    assert len(places) == client.get("/health").json()["stations"]
    toulouse = next(p for p in places if p["name"] == "Toulouse Matabiau")
    assert toulouse["department"] == "Haute-Garonne" and 43 < toulouse["lat"] < 44
    ids = {p["id"] for p in places}
    edges = client.get("/network").json()["edges"]
    assert edges and all(e["from_id"] in ids and e["to_id"] in ids for e in edges)
    modes = {m["id"] for m in client.get("/modes").json()["modes"]}
    assert {"Train TER", "Car TER", "INTERCITES"} <= modes
    info = client.get("/info").json()
    assert info["valid_until"] > info["valid_from"]


def test_dijkstra_on_small_network(tmp_path):
    # Trois gares A, B, C et quatre missions
    (tmp_path / "stations_occitanie.csv").write_text(
        "stop_id,name,lat,lon,department,commune\n"
        "1,A,43,1,Aude,A\n2,B,43,2,Aude,B\n3,C,43,3,Aude,C\n", encoding="utf-8")
    header = "mission_id,mode,line,trips,trips_ref_day,stops,arrival_min,departure_min,pickup,dropoff\n"
    missions = [
        "M1,Train TER,lente,10,10,1|2|3,0|30|60,0|31|60,111,111",   # A -> C direct en 60 min
        "M2,Train TER,rapide AB,16,16,1|2,0|20,0|20,11,11",          # A -> B en 20 min
        "M3,Car TER,rapide BC,16,16,2|3,0|10,0|10,11,11",            # B -> C en 10 min, 16/jour -> 30 min d'attente
        "M4,INTERCITES,sans arrêt en B,5,5,1|2|3,0|5|15,0|5|15,101,101",  # passe en B sans prendre ni déposer
    ]
    (tmp_path / "missions_occitanie.csv").write_text(header + "\n".join(missions) + "\n", encoding="utf-8")
    net = Network(tmp_path)

    # Le plus rapide : M4, direct en 15 min
    r = net.route("A", "C")
    assert r["transfers"] == 0 and r["ride_minutes"] == 15 and r["legs"][0]["line"] == "sans arrêt en B"
    # M4 ne dessert pas B : A -> B se fait avec M2
    assert net.route("A", "B")["legs"][0]["line"] == "rapide AB"
    # Sans Intercités : le direct lent (60 min) bat la correspondance 20 + 5 + 30 (attente) + 10 = 65
    r = net.route("A", "C", exclude={"INTERCITES"})
    assert r["transfers"] == 0 and r["legs"][0]["line"] == "lente"
    # Si le direct mettait 70 min, la correspondance (65) gagnerait
    net.rides[("1", "3", "Train TER")][0] = 70
    r = net.route("A", "C", exclude={"INTERCITES"})
    assert r["transfers"] == 1 and r["minutes"] == 65 and r["legs"][1]["wait_minutes"] == 35
