from fastapi.testclient import TestClient

from app.main import app
from app.routing import Network, normalize, to_minutes

client = TestClient(app)


def test_helpers():
    assert normalize("Saint-Gaudéns") == "SAINT GAUDENS"
    assert to_minutes("0 days 00:12:54") == 12.9


def test_route_ok():
    r = client.get("/route", params={"from": "Toulouse", "to": "Perpignan"})
    assert r.status_code == 200
    body = r.json()
    assert body["from"] == "Toulouse Matabiau" and body["to"] == "Perpignan"
    assert abs(body["minutes"] - sum(s["minutes"] for s in body["steps"])) < 0.5
    # chaque tronçon part de là où le précédent arrive
    assert all(a["to"] == b["from"] for a, b in zip(body["steps"], body["steps"][1:]))


def test_no_intercites():
    modes = {e["mode"] for e in client.get("/network").json()["edges"]}
    assert not any("INTERCITES" in m for m in modes)
    # Toulouse–Lourdes n'existe qu'en Intercités dans les données
    assert client.get("/route", params={"from": "Toulouse", "to": "Lourdes"}).json()["detail"]["code"] == "no_route"


def test_city_prefers_station_named_after_it():
    # « Toulouse » part de Matabiau, pas d'une gare de banlieue (Montaudran, Saint-Agne…)
    assert client.get("/route", params={"from": "Toulouse", "to": "Tarbes"}).json()["from"] == "Toulouse Matabiau"


def test_trains_only():
    # Toulouse -> Tarbes : le plus rapide prend un car Boussens -> Saint-Gaudens ; en train seul, il existe un détour
    params = {"from": "Toulouse", "to": "Tarbes"}
    mixed = client.get("/route", params=params).json()
    trains = client.get("/route", params={**params, "trains_only": "true"}).json()
    assert any(s["mode"] == "Car TER" for s in mixed["steps"])
    assert trains["steps"] and all(s["mode"] != "Car TER" for s in trains["steps"])
    assert trains["minutes"] >= mixed["minutes"]
    # Toulouse -> Perpignan : dans les données, Carcassonne -> Narbonne n'existe qu'en car
    assert client.get("/route", params={"from": "Toulouse", "to": "Perpignan", "trains_only": "true"}).json()["detail"]["code"] == "no_route"


def test_route_case_and_accents():
    assert client.get("/route", params={"from": "montpellier", "to": "NIMES"}).status_code == 200


def test_route_errors():
    assert client.get("/route", params={"from": "Toulouse", "to": "Paris"}).json()["detail"]["code"] == "unknown_place"
    assert client.get("/route", params={"from": "Toulouse", "to": "Toulouse"}).json()["detail"]["code"] == "same_place"
    # ligne d'Aigues-Mortes : coupée du reste du réseau dans les données
    assert client.get("/route", params={"from": "Toulouse", "to": "Aigues-Mortes"}).json()["detail"]["code"] == "no_route"


def test_stations():
    names = client.get("/stations", params={"q": "montpellier"}).json()["stations"]
    assert "Montpellier Saint-Roch" in names and "Montpellier Sud de France" in names


def test_places_and_network():
    places = client.get("/places").json()["places"]
    assert len(places) == client.get("/health").json()["stations"]
    toulouse = next(p for p in places if p["name"] == "Toulouse Matabiau")
    assert toulouse["department"] == "Haute-Garonne" and 43 < toulouse["lat"] < 44
    ids = {p["id"] for p in places}
    edges = client.get("/network").json()["edges"]
    assert edges and all(e["from_id"] in ids and e["to_id"] in ids for e in edges)


def test_route_steps_have_ids():
    steps = client.get("/route", params={"from": "Toulouse", "to": "Perpignan"}).json()["steps"]
    assert all(s["from_id"] and s["to_id"] for s in steps)


def test_dijkstra_is_optimal_on_small_graph(tmp_path):
    csv = tmp_path / "c.csv"
    csv.write_text(
        "stop_id,stop_name,next_stop_id,next_stop_name,duration_min_mean,stop_id_clean,next_stop_id_clean,departure_city,destination_city\n"
        "S:OCETrain TER-1,A,S:OCETrain TER-2,B,0 days 00:10:00,1,2,A,B\n"
        "S:OCETrain TER-2,B,S:OCETrain TER-3,C,0 days 00:10:00,2,3,B,C\n"
        "S:OCETrain TER-1,A,S:OCETrain TER-3,C,0 days 00:30:00,1,3,A,C\n")
    r = Network(csv).route("A", "C")
    assert r["minutes"] == 20 and [s["to"] for s in r["steps"]] == ["B", "C"]
