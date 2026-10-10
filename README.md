# IA Impact — réseau ferré d'Occitanie

- [`backend/`](backend/README.md) — API FastAPI : meilleur itinéraire (Dijkstra sur les horaires officiels : trains TER liO par défaut, base complète avec cars liO, Intercités, TGV disponible ; trajets directs + correspondances) entre deux villes ou gares d'Occitanie, avec filtre par type de transport.
- [`frontend/`](frontend/README.md) — React : carte des gares, liste des lieux et calcul d'itinéraire.

- [`event_catalog/`](event_catalog/README.md) — **Base d’activités et collecte** :
  catalogue SQLite et CSV, sources traçables, dates et lieux, services scolaires,
  et filtre piéton de 20 minutes depuis une gare. Interface et documentation
  en anglais, données sources en français.
