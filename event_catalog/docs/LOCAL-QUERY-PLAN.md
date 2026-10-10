# Date query implementation

The delivered interface queries saved records by France civil dates, department, city, source and accent-insensitive keywords. Match individual occurrences before pagination. Preserve date precision and exclude cancelled/removed records by default. Use stable pagination and the same filters for CSV/JSON export.

School services and venues have separate tabs because they may lack fixed dates. Keep unknown group capacity and booking conditions explicit. Refresh jobs store independent date windows and pagination progress; complete means the selected source query reached its end, not complete Occitanie coverage.

Verification includes Paris daylight-saving boundaries, midnight end times, empty dates, partial cursors, removal handling, export consistency and read-only hosting. Walking access is a separate checked condition; see WALKING-ACCESS.md.
