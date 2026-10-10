# Rules for coding agents

- Repository language is English (code, comments, docs, commits). Everything a
  parent or teacher reads (the PDF) is French. `docs/PLAN.zh-CN.md` is the
  owner's plan and stays in Chinese.
- This service renders and sends. Input is one `TripReportRequest` JSON;
  output is one PDF (`/render`) or that PDF emailed to `recipient.email`
  (`/reports`, same pipeline as `../sncf_bilan`). No form, no reading of
  sibling databases. The only thing stored is the sending job (SQLite + PDF
  under `var/`, purged after `RAPPORT_RETENTION_DAYS`).
- **Every input field is optional.** The request is never refused because a
  field is missing; the report shows « non communiqué » (or hides the block)
  and still renders. The one exception is sending: `/reports` answers 422
  `NO_RECIPIENT` when `recipient.email` is absent, because there is nobody to
  send to. The module will be merged into the team repository by someone
  else: `docs/INTEGRATION.md` tells them which fields matter most.
- **The email address comes from the teacher.** The teacher's feedback form of
  the merged product must ask for `recipient.email` (owner's decision,
  2026-10-10). Both this project and `../sncf_bilan` remind the integrator of
  it in their integration docs; keep those reminders when editing.
- Sending: default mode is `dry-run` (`.eml` files in `var/outbox/`). Ask the
  owner before any real send and before any deployment. Keys live in the
  environment or in the git-ignored `credentials.env`; never in tracked files,
  logs or commit messages.
- Email HTML: tables and inline styles, no remote resources, no tracking, logo
  as an inline image. `tests/test_mail.py` enforces this.
- Nothing is invented: distances and CO₂ are labelled as estimates with their
  method and sources; a competency is "acquise" only when the teacher said so;
  a photo renders only with `consent: true`; simulated trips keep the
  "SIMULATION" watermark.
- The PDF and the email take their values from `view.py` only (one derived
  layer: `build_report_view`, then `build_mail_view` on top of it), so they
  cannot disagree.
- Design bar for the PDF: clean, elegant, readable by a parent in two minutes.
  Brand palette only (navy #0f2149, navy-2 #1d3166, red #c90c0f for one accent,
  yellow #ffd500, greys #eceef3 / #c9cdd8, muted #5d6680). Font: Source Sans 3.
  No chart library: diagrams are inline SVG or CSS built by our own code.
- Data files in `data/` carry their origin in `data/PROVENANCE.md`; emission
  factors live in `data/emission_factors.json` with source URL and date, never
  as literals in code.
- Brand assets: only files with a recorded source in `assets/brand/PROVENANCE.md`.
  The SNCF Voyageurs logo is used with the permission the owner reported on 2026-10-10; do not alter it.
- Do not edit sibling projects (`../sncf_chatbot`, `../sncf_events`,
  `../sncf_resultat`, `../sncf_bilan`); read them only. Mailato is a separate
  public repository with its own releases; this project pins a tag.
- The team repository `AymericStras/IA_Impact_projet` is public. Publish there
  only with `scripts/publish_team_branch.sh` (branch
  `feature/rapport-pedagogique-pdf`), which leaves out the owner's deployment
  files.
- Do not commit unless the owner asks.
- Before handing over: `uv run ruff check . && uv run ruff format --check . &&
  uv run pytest && uv run python scripts/export_schema.py --check`.
