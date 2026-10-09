# Backend — calcul d'itinéraire

API FastAPI qui renvoie le trajet le plus rapide (Dijkstra pondéré par `duration_min_mean`)
entre une ville ou gare de départ et une ville ou gare de destination, sur le réseau ferré d'Occitanie
(TER liO train et car, plus les TGV entre gares d'Occitanie ; **sans Intercités**).

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
python -m app.routing Toulouse Tarbes --trains-only   # sans les cars TER
```

## Endpoints

| Méthode | Route | Exemple |
|---|---|---|
| GET | `/health` | `{"status": "ok", "stations": 243}` |
| GET | `/stations?q=nimes&limit=20` | `{"stations": ["Nîmes Centre", "Nîmes Pont du Gard"]}` |
| GET | `/places` | gares avec `id, name, lat, lon, department, commune` |
| GET | `/network` | liaisons `from_id, to_id, mode, minutes` |
| GET | `/route?from=Toulouse&to=Perpignan` | voir ci-dessous |
| GET | `/route?from=Toulouse&to=Tarbes&trains_only=true` | même chose sans les cars TER |

```json
{
  "from": "Toulouse Matabiau", "to": "Perpignan", "minutes": 117.8,
  "steps": [
    {"from": "Toulouse Matabiau", "to": "Labège Innopole", "from_id": "87611004", "to_id": "87612002", "minutes": 8.0, "mode": "Train TER"},
    {"from": "Labège Innopole", "to": "Baziège", "from_id": "87612002", "to_id": "87611723", "minutes": 8.3, "mode": "Train TER"},
    …
    {"from": "Narbonne", "to": "Perpignan", "from_id": "87781104", "to_id": "87784009", "minutes": 34.8, "mode": "TGV INOUI"}
  ]
}
```

`from` / `to` acceptent un nom de **ville** (toutes ses gares sont essayées : « Montpellier » couvre
Saint-Roch et Sud de France ; « Toulouse » part de Matabiau plutôt que d'une gare de banlieue) ou de **gare** précise. Accents, casse et tirets sont ignorés.

`trains_only=true` ignore les **cars TER** (autocars régionaux) : seuls les tronçons en train sont parcourus.
Attention aux trous des données : Toulouse → Perpignan n'a pas de solution en train seul, car
Carcassonne → Narbonne n'existe qu'en car dans ce sens.

Erreurs — `{"detail": {"code", "message"}}` :

| Code HTTP | `code` | Cas |
|---|---|---|
| 404 | `unknown_place` | ville/gare absente du réseau (ex. Paris) |
| 404 | `no_route` | les deux existent mais ne sont pas reliées (ex. Toulouse → Lourdes, desservi seulement en Intercités ; ligne d'Aigues-Mortes) |
| 400 | `same_place` | départ = destination |

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
