# Verified connector contracts

Verification date: 2026-10-10. A documented endpoint is distinct from a credentialed live check or exhaustive collection.

## DATAtourisme

Official documentation: https://api.datatourisme.fr/v1/docs

REST v1 separates entertainmentAndEvent and placeOfInterest. The connector sends its key in a header, restricts the 13 departments, reads French labels, source dates and `meta.next`, and validates next-page URLs. Date predicates select candidates; the local occurrence query applies the final date intersection. Batches are sequential and bounded. Partial runs are not complete regional inventories.

## OpenAgenda

Official documentation: https://developers.openagenda.com/ and https://developers.openagenda.com/en/evenements/export-json-migration/

Discover calendars first, then configure selected UIDs. Filter by actual venue geography, not calendar names. Preserve numeric pagination cursors, explicit timestamps, timezones, states and removal records. Date searches convert Paris civil days to UTC. Change queries use updatedAt separately from timing filters so moves/cancellations/removals are not hidden by future-only searches. Completed change queries advance the watermark with a five-minute overlap.

## Région Occitanie

Official catalogue: https://data.laregion.fr/ ; Explore documentation: https://help.opendatasoft.com/apis/ods-explore-v2/

Use the fixed reviewed dataset, deterministic ordering, 50-record pages and date overlap predicates. Keep date_debut/date_fin as dates, original schedule text as evidence, and unknown exact times/statuses as unknown. Missing INSEE codes are quarantined; postal codes are not commune IDs. Offset pagination can shift if the upstream dataset changes. Stop at the supported offset boundary rather than claiming exhaustive coverage.

## Musée Fabre

Reviewed source: https://www.museefabre.fr/offre-de-visites-et-ateliers

The fixed school parser checks robots and reviewed content blocks. Seven educational offers were verified. Teacher meetings are excluded; separate venues and evidence for booking, grades and durations are preserved. Unknown exhibitions or changed layout fail for review instead of inheriting old dates or locations.

## IGN

See [WALKING-ACCESS.md](WALKING-ACCESS.md). Pedestrian routing is not a timetable or group inventory API. Raw responses and endpoint validation provide route evidence, with expiry-aware decisions.
