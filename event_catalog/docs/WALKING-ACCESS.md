# Activities within a 20-minute walk of a station

The default query requires a checked pedestrian estimate of at most 1,200 seconds. Unknown, failed or expired routes do not pass. All records remains available for review; original activities are not deleted.

Stations come from IA_Impact_projet commit `5029e9d0b5f64c12e2b01e931f4ab63ef887d747`. The importer pins hashes for stations, missions and build_info. Of 5,050 multimodal stops, 260 are referenced by railway modes across the 13 departments. The dataset describes SNCF GTFS generated on 2026-10-09, valid through 2027-03-31. Station presence does not establish a useful train on any chosen day.

The verified route endpoint is `https://data.geopf.fr/navigation/itineraire`, resource `bdtopo-osrm`, profile `pedestrian`, units seconds/metres. Live checks on 2026-10-10 needed no key and returned resource version 2026-10-07. Source: https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/

The estimate is the larger of API duration and route distance at 4 km/h, plus endpoint connection estimates. Reject offsets over 50 metres. Small connections are not field-verified. Check entrances, closures, accessibility and whole-class pace before travel.

Successful routes expire after 30 days; failures are cached for one hour. Cache keys include destination, station coordinates, dataset and model. Activities at the same location reuse routes. Original responses, hashes and derived values remain in the private operational evidence database.

```sh
python3 -m sncf_events import-stations var/station-source-v05/backend/data
python3 -m sncf_events search --from-date 2026-10-12 --to-date 2026-10-12
python3 -m sncf_events search --from-date 2026-10-12 --to-date 2026-10-12 --rail-filter all
python3 -m sncf_events walk-check --from-date 2026-10-12 --to-date 2026-10-12 --budget 6
python3 -m sncf_events walk-check --resume JOB_ID
```

Station-first lookups (`near`, `collect-near`, `sncf_events.nearby`) evaluate the route from each requested station rather than the best station per activity, with the same model and limit; see [INTEGRATION.md](../INTEGRATION.md). They pace IGN requests at one per second and count them in their own hourly budget.

GET `/api/search` accepts `rail_filter=within_20_min|all|unknown|outside` and returns rail_counts. Prefix hosted routes with `/sncf-events`. Local writes require Origin and CSRF checks; hosted writes are denied. Historical `records`/`export` commands return source archives without the walking filter; use search or the viewer for trip selection.
