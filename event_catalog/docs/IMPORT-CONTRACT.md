# Local import contract

`ingest-file` accepts attributed local exports in these formats: manual, jsonld, openagenda_events, openagenda_agendas, datatourisme_events, datatourisme_places, occitanie_region_events and fabre_school_offers. Use the organizer template in `examples/organizer-export.template.json` for manual submissions.

```sh
python3 -m sncf_events ingest-file SOURCE_ID /path/to/export.json --format manual --evidence-url https://organizer.example/programme
```

The evidence URL must identify the public source. Local import does not enable a source or grant redistribution rights. Preserve original source fields, provider IDs, actual venue, department/commune codes and published date precision. An event and its sessions differ from an undated educational service or a venue.

Unknown times, ages, group limits, prices and booking availability remain null/unknown. Do not infer the next edition from an annual festival, convert opening hours into workshop slots, or infer class capacity from retail tickets. Dates with times require timezone information. Contradictory or unsupported records are quarantined rather than silently repaired.

The database keeps raw snapshots, observation versions and field evidence. Duplicate JSON keys and non-finite numbers are rejected. Invalid geography, unsafe URLs and changed source structure produce explicit issues. Retry quarantined records only after the parser or source problem has been reviewed; preserve the original evidence.
