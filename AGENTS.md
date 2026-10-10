# Rules for coding agents

- Repository language is English (code, comments, docs, commits). Everything a
  traveller reads (PDF, email) is French. `docs/TECHNICAL_PLAN.zh-CN.md` is the
  owner's plan and stays in Chinese.
- This service renders and sends. It never collects, completes or guesses trip
  data. A missing price or class is shown as "non communiqué".
- The recap must never look like a ticket: no barcode or QR code, and the
  not-a-ticket sentence stays in the PDF footer and in both email bodies.
- Every PDF carries the "SIMULATION" watermark, whatever the data says. It is
  the condition under which SNCF allowed the logo; do not make it optional.
- PDF and email take their values from `view.py` only, so they cannot disagree.
- Sending: default mode is `dry-run`. Ask the owner before any real send,
  before any deployment and before changing DNS. Keys live in the environment
  or in the git-ignored `credentials.env`; never in tracked files, logs or
  commit messages.
- Email HTML: tables and inline styles, no remote resources, no tracking, logo
  as an inline image. `tests/test_mail.py` enforces this.
- Brand assets: only files with a recorded source in
  `assets/brand/PROVENANCE.md`.
- The team repository `AymericStras/IA_Impact_projet` is public. Publish there
  only with `scripts/publish_team_branch.sh`, which leaves out the owner's
  deployment files.
- Before handing over: `uv run ruff check . && uv run ruff format --check . &&
  uv run pytest && uv run python scripts/export_schema.py --check`.
- Mailato is a separate public repository with its own releases; this project
  pins a tag. Do not edit sibling projects from here.
