# Backend — calcul d'itinéraire

API FastAPI qui renvoie le meilleur itinéraire entre une ville ou gare de départ et une ville ou gare
de destination en Occitanie, à partir des **horaires officiels SNCF** (GTFS TER + Intercités + TGV).

Un itinéraire est une suite de **trajets directs** (même train ou même car du début à la fin) reliés
par des **correspondances**. Le Dijkstra minimise :

```
temps à bord  +  pour chaque correspondance : 5 min de changement + attente moyenne du véhicule suivant
```

L'attente moyenne est déduite de la fréquence réelle : 16 trains/jour sur une journée de 16 h, c'est un
train par heure, donc 30 min d'attente en moyenne (plafond 2 h). Le premier départ n'est pas pénalisé :
le voyageur choisit son heure. Les horaires précis ne sont pas modélisés ; la durée est une estimation.

```
backend/
├── app/
│   ├── main.py                 # API HTTP (FastAPI)
│   └── routing.py              # graphe des trajets directs + Dijkstra, utilisable seul en CLI
├── data/                       # généré par scripts/build_from_gtfs.py
│   ├── stations_occitanie.csv  # 360 gares : id UIC, nom, coordonnées, département, commune
│   ├── missions_occitanie.csv  # 724 missions : suites d'arrêts + temps de passage médians + fréquence
│   ├── connections_occitanie.csv  # tronçons entre arrêts consécutifs, ancien format (notebook, Neo4j)
│   └── build_info.json         # version et validité des horaires, jour de référence
├── scripts/
│   └── build_from_gtfs.py      # télécharge les sources et reconstruit data/
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
python -m app.routing Toulouse Tarbes --exclude INTERCITES --exclude "Car TER" --transfer 10
```

## Mettre à jour les horaires

Les horaires SNCF changent (le GTFS actuel est valide du 09/10/2026 au 31/03/2027, voir `GET /info`) :

```bash
python scripts/build_from_gtfs.py --refresh   # ~2 s, ~100 Mo de RAM, sources dans backend/.cache/
```

Sources :
- GTFS SNCF TGV + Intercités + TER : `eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip`
  (référencé sur transport.data.gouv.fr, « Réseau SNCF TGV, Intercités et TER »)
- Liste des gares SNCF (département et commune par code UIC) : ressources.data.sncf.com, jeu `liste-des-gares`
- Contours des départements, pour les arrêts absents de la liste des gares : github.com/gregoiredavid/france-geojson

Ce que fait le script :
1. garde les gares (StopArea) situées dans les 13 départements d'Occitanie ;
2. découpe chaque train en morceaux contigus à l'intérieur de la région ;
3. regroupe les trains qui desservent les mêmes arrêts dans le même ordre en **missions**, avec les temps de
   passage médians, les arrêts où l'on peut monter ou descendre, et le nombre de circulations le **jour de
   référence** (le mardi/mercredi/jeudi le plus chargé de la période) ;
4. écrit aussi `connections_occitanie.csv` au format historique du projet, pour le notebook et Neo4j.

Le réseau couvre seulement l'offre SNCF (trains TER, cars TER, Intercités, TGV, OUIGO). Les lignes de cars
régionaux liO hors SNCF ont leur propre GTFS (transport.data.gouv.fr, « Réseau interurbain liO Occitanie »),
non intégré.

## Endpoints

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/health` | `{"status": "ok", "stations": 360}` |
| GET | `/info` | source, validité des horaires, jour de référence, volumes |
| GET | `/stations?q=nimes&limit=20` | `{"stations": ["Nîmes Centre", "Nîmes Pont du Gard"]}` |
| GET | `/places` | gares avec `id, name, lat, lon, department, commune` |
| GET | `/network` | tronçons entre arrêts consécutifs `from_id, to_id, mode, minutes` |
| GET | `/modes` | `[{"id": "Train TER", "links": 637, "missions": 403}, …]` |
| GET | `/route?from=Montpellier&to=Rodez` | voir ci-dessous |

Paramètres de `/route` :
- `from`, `to` : nom de **ville** (toutes ses gares sont essayées ; « Toulouse » part de Matabiau plutôt
  que d'une gare de banlieue) ou de **gare** précise. Accents, casse et tirets sont ignorés.
- `exclude` (répétable) : type de transport à ignorer, parmi les `id` de `/modes`
  (`Train TER`, `Car TER`, `Car à réservation`, `INTERCITES`, `INTERCITES de nuit`, `TGV INOUI`, `OUIGO`, `Navette`).
- `transfer_min` (défaut 5) : minutes de changement par correspondance, en plus de l'attente estimée.

```json
{
  "from": "Montpellier Saint-Roch", "to": "Rodez",
  "minutes": 339.6, "ride_minutes": 266.0, "transfers": 1, "transfer_min": 5.0,
  "legs": [
    {"mode": "INTERCITES", "line": "Bordeaux - Marseille",
     "from": "Montpellier Saint-Roch", "to": "Toulouse Matabiau", "from_id": "87773002", "to_id": "87611004",
     "minutes": 129.0, "wait_minutes": 0, "stops": ["87773002", "87773200", "…", "87611004"], "trips_per_day": 8},
    {"mode": "Train TER", "line": "Toulouse Matabiau - Rodez",
     "from": "Toulouse Matabiau", "to": "Rodez", "from_id": "87611004", "to_id": "87613422",
     "minutes": 137.0, "wait_minutes": 73.6, "stops": ["87611004", "87615344", "…", "87613422"], "trips_per_day": 7}
  ]
}
```

- `minutes` : durée estimée totale = `ride_minutes` + somme des `wait_minutes`
- `legs[].stops` : toutes les gares desservies par ce trajet direct, extrémités comprises
- `legs[].trips_per_day` : circulations le jour de référence qui font ce trajet sans changement

Erreurs — `{"detail": {"code", "message"}}` :

| Code HTTP | `code` | Cas |
|---|---|---|
| 404 | `unknown_place` | ville/gare absente du réseau (ex. Paris) |
| 404 | `no_route` | les deux existent mais ne sont pas reliées avec les transports autorisés |
| 400 | `same_place` | départ = destination |
| 400 | `unknown_mode` | valeur de `exclude` absente de `/modes` |

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
