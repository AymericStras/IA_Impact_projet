"""API HTTP du calcul d'itinéraire.

    uvicorn app.main:app --reload        (depuis backend/)

    GET /health
    GET /stations?q=mont&limit=20
    GET /places                          gares + coordonnées
    GET /network                         liaisons
    GET /modes                           types de transport disponibles
    GET /info                            source des horaires, validité, jour de référence
    GET /route?from=Toulouse&to=Perpignan[&exclude=Car TER&exclude=INTERCITES][&transfer_min=5]

Les erreurs renvoient {"detail": {"code": ..., "message": ...}} : le front traduit
à partir de `code`, `message` (anglais) n'est là que pour le débogage.
"""
import json

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .routing import DATA_DIR, DEFAULT_TRANSFER_MIN, Network, SamePlace, UnknownPlace

app = FastAPI(title="IA Impact — routing API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

network = Network()
build_info = json.loads((DATA_DIR / "build_info.json").read_text(encoding="utf-8"))


def error(status, code, message):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@app.get("/health")
def health():
    return {"status": "ok", "stations": len(network.name)}


@app.get("/info")
def info():
    """D'où viennent les horaires : version du GTFS SNCF, période de validité, jour de référence des fréquences."""
    return build_info


@app.get("/stations")
def stations(q: str = "", limit: int = Query(20, ge=1, le=500)):
    return {"stations": network.stations(q, limit)}


@app.get("/places")
def places():
    """Gares avec coordonnées et département, pour la carte."""
    return {"places": network.places()}


@app.get("/network")
def network_edges():
    """Tronçons entre arrêts consécutifs, pour tracer le réseau."""
    return {"edges": network.edges()}


@app.get("/modes")
def modes():
    """Types de transport (Train TER, Car TER, INTERCITES…) avec leur nombre de tronçons et de missions."""
    return {"modes": network.modes()}


@app.get("/route")
def route(departure: str = Query(..., alias="from", min_length=1),
          destination: str = Query(..., alias="to", min_length=1),
          exclude: list[str] = Query([], description="Types de transport à ignorer (voir /modes)"),
          transfer_min: float = Query(DEFAULT_TRANSFER_MIN, ge=0, le=60,
                                      description="Minutes de changement par correspondance, en plus de l'attente estimée")):
    unknown = set(exclude) - {m["id"] for m in network.modes()}
    if unknown:
        error(400, "unknown_mode", f"Unknown transport mode(s): {', '.join(sorted(unknown))}")
    try:
        r = network.route(departure, destination, exclude=set(exclude), transfer_min=transfer_min)
    except UnknownPlace as e:
        error(404, "unknown_place", f"Unknown city or station: {e.args[0]}")
    except SamePlace:
        error(400, "same_place", "Departure and destination are the same place.")
    if r is None:
        error(404, "no_route", f"No route between {departure} and {destination}.")
    return r
