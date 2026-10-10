# ADR 0002: Emission factors for the CO2e estimate

Status: accepted (2026-10-10)

## Context

The report shows an estimate of the CO2e of the group's TER round trip next to two road
baselines, coach and private car. The owner's rule: these are estimates with a stated
baseline, source and method, never measured savings, and no emission number is written in
Python code.

## Decision

**Source.** ADEME's "Impact CO2" public API, `GET https://impactco2.fr/api/v1/transport`
(documentation: <https://impactco2.fr/doc/api>). It answers without a key, with a warning that
anonymous access may be cut; a free key can be requested from impactco2@ademe.fr.
`scripts/fetch_factors.py` writes `data/emission_factors.json`; the code only reads that file.

| Mode | API id | API name | Underlying source named by Impact CO2 |
|---|---|---|---|
| `ter` | 15 | TER | Base Empreinte ADEME |
| `autocar` | 6 | Autocar thermique | Base Empreinte ADEME |
| `voiture` | 4 | Voiture thermique (medium diesel car) | "Modélisation de l'empreinte carbone de la voiture - 2025" |

The values themselves are in the JSON file only, on purpose.

**What a figure means.** The API returns kg CO2e for the requested `km`; the script asks for
one kilometre and stores grams per kilometre.

- Scope: usage (fuel or electricity) plus construction of the vehicle (`includeConstruction=1`,
  the scope the impactco2.fr pages display). The usage-only value is kept beside it as
  `g_co2e_per_pkm_usage_only`, for information. Roads, tracks and stations are not included
  (Impact CO2 FAQ, <https://impactco2.fr/outils/transport>).
- `ter` and `autocar` are per passenger-km at the average load assumed by the source: 30
  passengers per coach; for trains, operator data that Impact CO2 does not publish.
- `voiture` is requested with `occupencyRate=1`, so it is the whole car per kilometre
  (`"basis": "vehicle_km"`). Impact CO2 divides by the number of people on board, driver
  included; we do the same.

**Car occupancy.** The default is the JSON field `default_occupancy` of the car entry: one
person per car, which is exactly what the stored figure means. We found no sourced average
occupancy on the pages consulted, so none is used. One person per car is the least favourable
assumption for the car and therefore the most flattering for the train: the report must print
the occupancy used, and a caller can pass `car_occupancy` (for example the number of pupils a
parent would drive). The occupancy applied is returned in `CarbonEstimate.car_occupancy`.

**Formula.** Round trip always: `kg_total = passengers x distance_km x 2 x g_per_pkm / 1000`,
`kg_per_person = kg_total / passengers`, with `g_per_pkm = factor / occupancy` for the car and
the factor itself otherwise. `saving_kg(mode) = baseline kg_total - train kg_total`, never
clamped, so it can be negative. Nothing is rounded before the view layer.

## Known limits

- An estimate, not a measurement. It says nothing about what the group would really have done.
- The distance comes from the `geo` package (straight-line estimate between stops), so it is
  shorter than the rail or road route; the same distance is applied to all three modes.
- The TER factor is a French national average, not liO-specific, and independent of the rolling
  stock (electric or diesel) and of the load of the actual train.
- The train ran anyway; the figure is an average allocation per passenger, not a marginal one.
- The car baseline does not round to whole cars, and the coach baseline assumes the source's
  average load rather than one coach hired for the group.
- The scope excludes infrastructure for every mode.

## Refreshing

`uv run python scripts/fetch_factors.py --check` shows what would change (exit 1 when figures
differ); without `--check` it rewrites the file with today's date. On a network or format
error it exits non-zero and leaves the file untouched. Review the diff before committing: a
changed figure changes every report.

## Addendum, same day — default car occupancy in the report

The factor file keeps `default_occupancy: 1`, which is what the source figure
means. The report layer does not use that default: `Config.default_car_occupancy`
is 4, so the "voiture" baseline assumes full cars unless the request sets
`environment.car_occupancy`. With one person per car the car bar was five times
the train bar and dominated the page; full cars is the assumption least
favourable to the train, and the report prints it under the bar and in the
method note.
