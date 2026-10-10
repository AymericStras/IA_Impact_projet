# Collection and maintenance

Use an approved development environment or the host's existing resource admission tool. Database locks and request budgets do not replace host isolation. Production hosting is a separate read-only service; it does not run arbitrary crawling, builds or tests.

## Initialize

```sh
python3 -m sncf_events init
python3 -m sncf_events check
python3 -m sncf_events doctor
python3 -m sncf_events report
```

For a new empty database only, `sqlite3 new.sqlite3 < database/bootstrap.sql` creates the schema and disabled sources. Existing databases use `migrate` after a backup. Never change already applied migration files.

## Review and enable a source

Complete `examples/source-review.template.json` using actual terms, scope, attribution and expiry. Reading, factual reuse and description reuse are separate flags. Do not mark all allowed merely because a page opens.

```sh
python3 -m sncf_events review-source S001 /private/path/review.json
python3 -m sncf_events enable-source S001
python3 -m sncf_events enable-endpoint datatourisme-events
python3 -m sncf_events plan datatourisme-events
python3 -m sncf_events sync datatourisme-events --max-pages 1
python3 -m sncf_events runs
```

Supply DATATOURISME_API_KEY and OPENAGENDA_PUBLIC_KEY through a private mode-0600 `.env` or the process environment. No secrets belong in URL queries, endpoint JSON, exports or Git. `doctor` checks presence and local health, not current provider availability.

Partial batches may exit with code 2. Resume the returned run ID with `sync ENDPOINT --max-pages 3 --resume RUN_ID`. Changed configuration invalidates old cursors. Rate limits, denied access and human verification are not bypassed. No automatic retry storm or concurrency expansion is used.

## Discover calendars and schools

Enable a reviewed OpenAgenda discovery endpoint, inspect `agendas`, then configure a selected UID:

```sh
python3 -m sncf_events configure-endpoint oa-selected S002 openagenda_events --config '{"agenda_uid":"REAL_UID"}'
python3 -m sncf_events enable-endpoint oa-selected
python3 -m sncf_events plan oa-selected
```

National calendars are filtered by actual venue. Musée Fabre uses the fixed `fabre-school-offers` endpoint, with robots and layout checks. Other school websites require separate review; the parser is not universal.

## Inspect, back up and export

```sh
python3 -m sncf_events issues
python3 -m sncf_events quarantine
python3 -m sncf_events audit-data
python3 -m sncf_events backup var/backup.sqlite3
python3 -m sncf_events export var/public-facts.jsonl --public --limit 10000
python3 -m sncf_events.share --db var/occitanie.sqlite3 --output var/new-share
```

The legacy public JSONL export includes only active records with affirmative, unexpired factual reuse reviews, and descriptions only when allowed. The separately requested portable catalogue includes basic facts with explicit source reuse flags and no raw response bodies. It does not turn pending permission into permission. See SHARING.md.

Local scheduled collection requires the application to remain open. Server automatic refresh is not enabled. Increasing coverage or data budgets requires an explicit capacity review; do not delete source history to fit a budget.
