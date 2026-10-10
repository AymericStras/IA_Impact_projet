# Railway walking access plan and implementation

1. Pin the user-supplied IA_Impact_projet dataset and verify file digests.
2. Select stations actually referenced by railway modes, excluding bus-only stops.
3. Geolocate the actual activity venue; missing coordinates remain unknown.
4. Use the straight-line radius only to find candidate stations. Validate a pedestrian route before accepting a record.
5. Compare a conservative walking estimate to 1,200 seconds. Cache by station, venue, dataset and model, with expiry.
6. Apply the same condition in browser queries and exports; retain unknown/outside records for review.

Implemented and checked on 2026-10-10: 260 railway stations, bounded IGN requests, 49 live route calls and 54 completed target checks. No train timetable, school-group pace, entrance opening or booking availability is inferred. Technical details and commands are in WALKING-ACCESS.md.
