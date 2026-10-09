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


def test_dijkstra_is_optimal_on_small_graph(tmp_path):
    csv = tmp_path / "c.csv"
    csv.write_text(
        "stop_id,stop_name,next_stop_id,next_stop_name,duration_min_mean,stop_id_clean,next_stop_id_clean,departure_city,destination_city\n"
        "S:OCETrain TER-1,A,S:OCETrain TER-2,B,0 days 00:10:00,1,2,A,B\n"
        "S:OCETrain TER-2,B,S:OCETrain TER-3,C,0 days 00:10:00,2,3,B,C\n"
        "S:OCETrain TER-1,A,S:OCETrain TER-3,C,0 days 00:30:00,1,3,A,C\n")
    r = Network(csv).route("A", "C")
    assert r["minutes"] == 20 and [s["to"] for s in r["steps"]] == ["B", "C"]
