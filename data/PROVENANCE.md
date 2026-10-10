# Data files

| File | Origin | Terms |
|---|---|---|
| `stations.csv` | Copy of `sncf_events/var/share-v073/csv/stations.csv` (260 Occitanie rail stations: UIC id, name, latitude, longitude, department, commune, modes). Built by the team repository `AymericStras/IA_Impact_projet` from SNCF GTFS; see `sncf_events/data/STATION-SOURCE-NOTICE.md`. | Team repo is MIT; the MIT licence does not by itself cover redistribution of the underlying transit data. Hackathon use only. |
| `connections.csv` | `connections_occitanie.csv` from the liO hackathon kit (`kit_hackathon_lio_18h.zip`), supplied by the organisers: adjacent stop pairs with mean duration and UIC codes. | Supplied for the hackathon. |
| `emission_factors.json` | Written by `scripts/fetch_factors.py` from the public impactco2.fr API (ADEME Base Empreinte). Each entry records source URL, version and retrieval date. | Data ADEME, Licence Ouverte / Etalab 2.0 (check the API terms when refreshing). |
