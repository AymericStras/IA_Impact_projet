# 4. The report is emailed through the same pipeline as sncf_bilan

Date: 2026-10-10. Status: accepted.

## Context

Version 0.1.0 rendered only; the handoff said "hand the PDF to `sncf_bilan` if
needed". The owner then decided that this module sends its own email, like
`sncf_bilan`, and that the teacher gives the email address together with their
post-trip feedback.

## Decision

- Copy `sncf_bilan`'s workflow rather than share code: `mail/compose.py`,
  `mail/deliver.py`, `store.py`, `service.py`, the `/reports` routes. The two
  modules are merged separately into the team repository, so a shared package
  would be one more thing for the integrator to carry. Mailato stays the
  shared piece, pinned to the same tag.
- The address is a request field, `recipient.email` (+ `recipient.name`),
  optional like every other field. Rendering never needs it; sending does, and
  `/reports` answers `422 NO_RECIPIENT` instead of guessing.
- `idempotency_key` is optional here (in `sncf_bilan` it is required): without
  it the key is a digest of the content, so a repeated identical request sends
  once and a changed one is a new report.
- The email's values come from `view.build_mail_view`, built on the same
  `ReportView` as the PDF, so the two cannot disagree. Numbers without a value
  are left out of the email rather than printed as « non communiqué ».
- A missing `logo.png` degrades the email (no picture) instead of refusing to
  start, in line with this module's "always render" rule.

## Consequences

- The service now keeps state: `var/rapport.sqlite3`, `var/documents/`,
  `var/outbox/`, purged after 30 days. `/render` still leaves no trace.
- The integrator must collect the address: `docs/INTEGRATION.md` opens with
  that reminder, and `sncf_bilan`'s README carries the same one.
