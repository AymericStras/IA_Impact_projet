# Operational data model

The operational SQLite database stores source registration separately from collected facts. Seven immutable migrations define 38 tables plus query views; use `migrate` for upgrades and `database/bootstrap.sql` only for a new database.

Sources carry geographic scope, role, aliases, upstream relationships, access method and research status. Source reviews separately track reading, factual reuse, description reuse, attribution and expiry. Registered URLs do not imply implemented connectors.

Entities are keyed by provider, external ID and kind. Observations version each extraction. Snapshots retain original response bytes, URL, timestamp and SHA-256; field evidence identifies the source location for each extracted fact. Stable platform IDs prevent repeated ingestion from duplicating entities. Cross-platform matches remain review candidates, not automatic merges.

Occurrences belong to observations and preserve explicit dates, datetimes, timezone, precision, cancellation status, recurrence and exceptions. Date-only periods are never expanded into invented daily sessions. School conditions preserve grades, ages, duration, group size, booking and price only when evidenced. Supplier availability confirmations expire separately.

Upstream presence tracks removal from individual calendars. Removal is not automatically cancellation; a record may remain present in another calendar. Old or ambiguous revisions do not silently replace current facts. Invalid dates, missing geography and unsupported content are quarantined.

Rail datasets and stations retain the pinned source identity. Walking evidence stores route responses and derived values; cached routes are tied to coordinates, station, dataset and model. Search evaluates expiry before applying the 1,200-second limit.

Use `current_records`, `current_occurrences`, `events`, `educational_offers` and `venues` for current operational facts. The portable distribution has a separate simplified schema documented in [SHARING.md](SHARING.md).
