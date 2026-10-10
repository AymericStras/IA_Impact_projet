# Local browser interface

Run `python3 -m sncf_events serve` and open http://127.0.0.1:8766. The foreground session lasts at most 12 hours; Ctrl+C stops it. No daemon is installed. `--read-only` disables collection and settings writes.

Choose event dates, department, city, source and keywords. The default walking filter requires a checked route within 20 minutes; All records also shows unknown/outside results. Separate tabs list school services and venues without implying a booking on the selected dates. Details show all sessions; the results and CSV export show sessions matching the date window.

Local Refresh selected dates reads up to 12 pages per batch. Resume continues a saved cursor. Source changes/removals are checked separately from future sessions. Route checking follows collection serially, with up to 10 requests per batch and 500 target records per selection. Failures and missing coordinates remain unknown.

Scheduled updates run only while the local application is open and awake. Memory, request, response, storage and time limits pause work without discarding existing data. These application limits do not replace host resource admission.

Hosted mode is read-only, uses the `/sncf-events/` prefix and runs without crawler credentials or outbound network connections. The account-free deployment allows GET/HEAD; write methods remain denied. It reads a saved snapshot, not live provider inventory.
