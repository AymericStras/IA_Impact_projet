# Backend — calcul d'itinéraire

API FastAPI qui renvoie le trajet le plus rapide (Dijkstra pondéré par `duration_min_mean`)
entre une ville ou gare de départ et une ville ou gare de destination, sur le réseau ferré d'Occitanie
(TER liO, Intercités, TGV entre gares d'Occitanie).

```
backend/
├── app/
│   ├── main.py       # API HTTP (FastAPI)
│   └── routing.py    # graphe + Dijkstra, utilisable seul en CLI
├── data/
│   ├── connections_occitanie.csv
│   └── stations_occitanie.csv   # coordonnées (open data SNCF « liste des gares »)
└── tests/
```

## Lancer

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload       # http://127.0.0.1:8000/docs
```

En ligne de commande, sans serveur et sans dépendance :

```bash
python -m app.routing Toulouse Perpignan
```

## Endpoints

| Méthode | Route | Exemple |
|---|---|---|
| GET | `/health` | `{"status": "ok", "stations": 267}` |
| GET | `/stations?q=nimes&limit=20` | `{"stations": ["Nîmes Centre", "Nîmes Pont du Gard"]}` |
| GET | `/places` | gares avec `id, name, lat, lon, department, commune` |
| GET | `/network` | liaisons `from_id, to_id, mode, minutes` |
| GET | `/route?from=Toulouse&to=Lourdes` | voir ci-dessous |

```json
{
  "from": "Toulouse Matabiau", "to": "Lourdes", "minutes": 103.2,
  "steps": [
    {"from": "Toulouse Matabiau", "to": "Montréjeau - Gourdan-Polignan", "minutes": 55.4, "mode": "INTERCITES"},
    {"from": "Montréjeau - Gourdan-Polignan", "to": "Tarbes", "minutes": 33.4, "mode": "INTERCITES"},
    {"from": "Tarbes", "to": "Lourdes", "minutes": 14.4, "mode": "INTERCITES"}
  ]
}
```

`from` / `to` acceptent un nom de **ville** (toutes ses gares sont essayées : « Montpellier » couvre
Saint-Roch et Sud de France) ou de **gare** précise. Accents, casse et tirets sont ignorés.

Erreurs — `{"detail": {"code", "message"}}` :

| Code HTTP | `code` | Cas |
|---|---|---|
| 404 | `unknown_place` | ville/gare absente du réseau (ex. Paris) |
| 404 | `no_route` | les deux existent mais ne sont pas reliées (ex. ligne d'Aigues-Mortes, isolée dans les données) |
| 400 | `same_place` | départ = destination |

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
