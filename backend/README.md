# Backend — calcul d'itinéraire

API FastAPI qui renvoie le trajet le plus rapide (Dijkstra pondéré par `duration_min_mean`)
entre une ville ou gare de départ et une ville ou gare de destination, sur le réseau ferré d'Occitanie
(train TER, car TER, Intercités de jour et de nuit, TGV entre gares d'Occitanie).
Chaque type de transport peut être exclu du calcul.

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
python -m app.routing Toulouse Tarbes --exclude INTERCITES --exclude "Car TER"
```

## Endpoints

| Méthode | Route | Exemple |
|---|---|---|
| GET | `/health` | `{"status": "ok", "stations": 267}` |
| GET | `/stations?q=nimes&limit=20` | `{"stations": ["Nîmes Centre", "Nîmes Pont du Gard"]}` |
| GET | `/places` | gares avec `id, name, lat, lon, department, commune` |
| GET | `/network` | liaisons `from_id, to_id, mode, minutes` |
| GET | `/route?from=Toulouse&to=Perpignan` | voir ci-dessous |
| GET | `/modes` | `{"modes": [{"id": "Train TER", "links": 437}, {"id": "Car TER", …}, …]}` |
| GET | `/route?from=Toulouse&to=Tarbes&exclude=Car TER&exclude=INTERCITES` | même chose sans ces transports |

```json
{
  "from": "Toulouse Matabiau", "to": "Perpignan", "minutes": 106.2,
  "steps": [
    {"from": "Toulouse Matabiau", "to": "Carcassonne", "from_id": "87611004", "to_id": "87615286", "minutes": 42.8, "mode": "INTERCITES"},
    {"from": "Carcassonne", "to": "Narbonne", "from_id": "87615286", "to_id": "87781104", "minutes": 28.8, "mode": "INTERCITES"},
    {"from": "Narbonne", "to": "Perpignan", "from_id": "87781104", "to_id": "87784009", "minutes": 34.8, "mode": "TGV INOUI"}
  ]
}
```

`from` / `to` acceptent un nom de **ville** (toutes ses gares sont essayées : « Montpellier » couvre
Saint-Roch et Sud de France ; « Toulouse » part de Matabiau plutôt que d'une gare de banlieue) ou de **gare** précise. Accents, casse et tirets sont ignorés.

`exclude` (répétable) retire un type de transport du calcul. Valeurs possibles, données par `/modes` :
`Train TER`, `Car TER` (autocars régionaux), `INTERCITES`, `INTERCITES de nuit`, `TGV INOUI`.
Attention aux trous des données : sans Intercités ni cars, Toulouse → Perpignan n'a pas de solution,
car Carcassonne → Narbonne n'existe qu'en car ou en Intercités dans ce sens.

Erreurs — `{"detail": {"code", "message"}}` :

| Code HTTP | `code` | Cas |
|---|---|---|
| 404 | `unknown_place` | ville/gare absente du réseau (ex. Paris) |
| 404 | `no_route` | les deux existent mais ne sont pas reliées (ex. ligne d'Aigues-Mortes ; Toulouse → Lourdes si on exclut les Intercités) |
| 400 | `unknown_mode` | valeur de `exclude` absente de `/modes` |
| 400 | `same_place` | départ = destination |

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
