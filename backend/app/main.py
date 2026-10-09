"""API HTTP du calcul d'itinéraire.

    uvicorn app.main:app --reload        (depuis backend/)

    GET /health
    GET /stations?q=mont&limit=20
    GET /route?from=Toulouse&to=Perpignan

Les erreurs renvoient {"detail": {"code": ..., "message": ...}} : le front traduit
à partir de `code`, `message` (anglais) n'est là que pour le débogage.
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .routing import Network, UnknownPlace

app = FastAPI(title="IA Impact — routing API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

network = Network()


def error(status, code, message):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@app.get("/health")
def health():
    return {"status": "ok", "stations": len(network.name)}


@app.get("/stations")
def stations(q: str = "", limit: int = Query(20, ge=1, le=500)):
    return {"stations": network.stations(q, limit)}


@app.get("/route")
def route(departure: str = Query(..., alias="from", min_length=1),
          destination: str = Query(..., alias="to", min_length=1)):
    try:
        r = network.route(departure, destination)
    except UnknownPlace as e:
        error(404, "unknown_place", f"Unknown city or station: {e.args[0]}")
    except ValueError:
        error(400, "same_place", "Departure and destination are the same place.")
    if r is None:
        error(404, "no_route", f"No route between {departure} and {destination}.")
    return r
