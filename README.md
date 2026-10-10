# sncf_bilan — trip recap: PDF + email

Give it the data of one trip; it produces a PDF recap with the SNCF Voyageurs
logo and emails it to the traveller from `zhaoyang.fr`.

It does not collect or complete data. What you send is what is shown. The
recap is not a ticket: the PDF and the email say so, and every PDF carries a
"SIMULATION" watermark (the condition under which SNCF allowed the logo).

- [What data the recap needs](#what-data-the-recap-needs) — read this first
- [Use it: three ways](#use-it-three-ways)
- [Prompt for Claude Code](#prompt-for-claude-code)
- [API](#api) · [Examples](#examples) · [Credentials](#credentials)

## What data the recap needs

One JSON object per trip. **Seven values are required; without any one of them
nothing is generated** (HTTP 422, no PDF, no email).

| Required | Field | Format | Example |
|---|---|---|---|
| ✔ | `schema_version` | the string `"1.0"` | `"1.0"` |
| ✔ | `idempotency_key` | 8–128 characters among `A–Z a–z 0–9 . _ : -`, **unique per recap** | `"booking-8841-recap"` |
| ✔ | `recipient.email` | email address | `"prof@ecole.fr"` |
| ✔ | `trip.participants_count` | integer ≥ 1 | `30` |
| ✔ | `trip.legs[].from_station` | departure station, 1–80 characters | `"Toulouse Matabiau"` |
| ✔ | `trip.legs[].to_station` | arrival station, 1–80 characters | `"Carcassonne"` |
| ✔ | `trip.legs[].departure` | date and time **with UTC offset** (ISO 8601) | `"2026-11-12T08:05+01:00"` |

`trip.legs` is a list of 1 to 12 train journeys: one for a one-way trip, two
for a simple round trip, more with connections. Order does not matter, they
are sorted by departure.

> **Where does `recipient.email` come from?** No existing module holds it: the
> chatbot does not collect it and the planner's travel file has none. The
> owner's decision (2026-10-10): **the teacher gives the email address when
> they submit their feedback / confirmation**, and the merged product passes it
> here. The same address feeds `sncf_rapport` (`recipient.email` too). If you
> merge with a coding agent, say so in the prompt: an agent that only maps
> existing data will not add the field to the form.

**Price.** The tariff is fixed and is not part of the request: every traveller
pays **1,00 €**, and the recap shows "Prix par personne : 1,00 €" and
"Prix total : participants × 1,00 €" (30 travellers → 30,00 €). A request that
carries a `price` field is refused.

**Optional values.** When one is absent, the recap says "non communiqué" or
leaves the line out. Nothing is guessed or computed for you.

| Field | Format | Shown as | When absent |
|---|---|---|---|
| `trip.travel_class` | `"1"` or `"2"` | "1re classe" / "2de classe" | "non communiquée" |
| `trip.legs[].arrival` | date-time with offset | arrival time, duration | "non communiquée", no duration |
| `trip.legs[].line` | text ≤ 120 | under the journey | line omitted |
| `trip.legs[].train_number`, `coach`, `seat` | text ≤ 40 | columns Train / Voiture / Place | columns omitted when no leg has any |
| `trip.reference` | text ≤ 40 | header, email, file name | omitted; the file is named by date |
| `trip.title` | text ≤ 160 | above the route | omitted |
| `recipient.name` | text ≤ 120 | "Bonjour Mme Martin," | "Bonjour," |
| `trip.simulated` | `true` / `false` (default `false`) | the notice "données simulées" in the PDF and the email | no notice (the watermark is always there) |
| `locale` | `"fr"` (default) | | |

**Rules that get a request refused (422):**

1. A date without offset (`"2026-11-12T08:05"`). Send `+01:00`, `+02:00` or
   `Z`. Times are displayed in French local time.
2. `arrival` earlier than `departure` on the same leg.
3. A `price` field: the tariff is fixed at 1,00 € per traveller and is not
   sent.
4. An unknown field anywhere. Field names are exact.
5. Line breaks or control characters in a text.

**How the summary is derived from the legs:** the origin is the first leg's
departure station. If the last leg ends at the origin, the trip is an
"Aller-retour" and the destination is the station where the travellers stay
longest; otherwise it is an "Aller simple" ending at the last station.

A complete request:

```json
{
  "schema_version": "1.0",
  "idempotency_key": "booking-8841-recap",
  "recipient": { "email": "prof@ecole.fr", "name": "Mme Martin" },
  "trip": {
    "reference": "SIM-050033B9",
    "title": "Sortie pédagogique — Cité médiévale de Carcassonne",
    "participants_count": 30,
    "travel_class": "2",
    "legs": [
      { "from_station": "Toulouse Matabiau", "to_station": "Carcassonne",
        "departure": "2026-11-12T08:05+01:00", "arrival": "2026-11-12T09:00+01:00",
        "line": "liO Toulouse Matabiau – Carcassonne" },
      { "from_station": "Carcassonne", "to_station": "Toulouse Matabiau",
        "departure": "2026-11-12T16:25+01:00", "arrival": "2026-11-12T17:20+01:00",
        "line": "liO Carcassonne – Toulouse Matabiau" }
    ],
    "simulated": true
  }
}
```

The smallest valid request is `contracts/examples/02-aller-simple-minimal.json`.
The machine-readable contract is `contracts/recap_request.schema.json`.

## Use it: three ways

All three need the **private bundle** from the project owner
(`sncf-bilan.private.zip`, sent privately, never committed). Unzip it at the
project root: it adds `credentials.env`, the keys.

```sh
unzip -o sncf-bilan.private.zip      # at the project root
```

Without the bundle everything still runs in dry-run (tests, preview, PDF);
only the hosted service and real sending are unavailable.

### A. Call the hosted service (nothing to install)

```sh
KEY=$(grep '^BILAN_API_KEY=' credentials.env | cut -d= -f2)

# PDF only, nothing recorded, nothing sent
curl -sS -H "X-Bilan-Key: $KEY" -H 'Content-Type: application/json' \
  --data @contracts/examples/01-aller-retour-complet.json \
  https://zhaoyang.fr/sncf-bilan/api/v1/render -o recap.pdf

# PDF + email to recipient.email (edit the example first: it has a placeholder address)
curl -sS -H "X-Bilan-Key: $KEY" -H 'Content-Type: application/json' \
  --data @my-request.json \
  https://zhaoyang.fr/sncf-bilan/api/v1/recaps
```

From Python:

```python
import json, urllib.request


def send_recap(request: dict, key: str, base="https://zhaoyang.fr/sncf-bilan") -> dict:
    call = urllib.request.Request(
        f"{base}/api/v1/recaps",
        data=json.dumps(request).encode(),
        headers={"X-Bilan-Key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(call, timeout=30) as response:
        return json.load(response)  # {"id": "...", "status": "queued", ...}
```

Call it from your server, never from a browser: the key must stay secret.

### B. Run it locally

Needs Python 3.12 or 3.13, [uv](https://docs.astral.sh/uv/) and Pango
(`brew install pango` on macOS; `apt install libpango-1.0-0 libpangoft2-1.0-0`
on Debian/Ubuntu).

```sh
uv sync
uv run pytest                                   # no network, sends nothing

# 1. Files only: PDF, email (.eml to open in a mail client), HTML and text bodies
uv run python scripts/preview.py contracts/examples/01-aller-retour-complet.json
open var/preview/

# 2. One real email to yourself (shows a summary; sends only with --yes)
uv run python scripts/send_example.py contracts/examples/01-aller-retour-complet.json \
  --to you@example.com --yes

# 3. The service on http://127.0.0.1:8770 — same routes as the hosted one
uv run uvicorn sncf_bilan.api:app --factory --port 8770
```

With the bundle's `credentials.env`, mode is `live`: `POST /api/v1/recaps`
really sends. Set `BILAN_MAIL_MODE=dry-run` in that file to write emails to
`var/outbox/` instead.

### C. Run it with Docker (no Python, no Pango)

```sh
docker compose up --build        # http://127.0.0.1:8770
curl -sS http://127.0.0.1:8770/healthz
```

## Prompt for Claude Code

Paste this into Claude Code (or another coding agent) opened in **your**
project, after cloning this branch next to it and unzipping the bundle.

```text
Integrate the trip recap service "sncf_bilan" into this project.

What it does: receives one trip as JSON, renders a PDF recap and emails it to
the traveller. Its README (section "What data the recap needs") and
contracts/recap_request.schema.json define the request; contracts/examples/
has valid and invalid samples. Read those three before writing code.

Where it is: the code is in ../sncf_bilan (adjust the path). A hosted instance
runs at https://zhaoyang.fr/sncf-bilan. The key is BILAN_API_KEY in
../sncf_bilan/credentials.env — read it from there or from the environment at
run time; never copy it into source, logs, commits or frontend code.

Do this:
1. Find where this project holds a confirmed trip (stations, departure and
   arrival times, number of travellers, class, reference). The recipient's
   email is NOT stored anywhere yet: the teacher's confirmation / feedback
   form must ask for it and keep it with the trip (same address is used by
   sncf_rapport). There is no price to send: the tariff is fixed at 1,00 € per
   traveller and the service computes the total. List which required fields we have and which are
   missing; stop and tell me if a required one has no source.
2. Write one server-side function that maps our trip object to the request
   JSON. Rules: datetimes with a UTC offset; no price field; travel_class
   "1" or "2"; omit any optional value we do not have instead of
   inventing it; no unknown fields; idempotency_key stable and unique per
   booking (for example "<booking id>-recap") so a retry never sends twice.
3. Send it with POST {base}/api/v1/recaps and header X-Bilan-Key, from the
   server only. 202 = accepted, 200 = this request was already accepted
   (not an error), 409 = that idempotency_key was used with other content,
   422 = invalid data (show which field), 429 = daily limit, 401 = wrong key.
4. Read the outcome with GET {base}/api/v1/recaps/{id}: status is queued,
   sent or failed (with an error text). Offer POST .../retry on failed.
5. Use POST {base}/api/v1/render (same body, returns the PDF, sends nothing)
   for a "preview / download PDF" action.
6. Make the base URL configurable: the hosted URL by default,
   http://127.0.0.1:8770 for a local instance.
7. Add tests for the mapping using the examples in contracts/examples/ as
   references, including one trip without class. Tests must not
   send email: call /render, or run the local service with
   BILAN_MAIL_MODE=dry-run.

Do not modify ../sncf_bilan. Do not send a real email without asking me first.
When done, tell me which fields are mapped from where, which optional ones we
never fill, and show the commands you ran.
```

## API

Every route except `/healthz` needs the header `X-Bilan-Key`. Base URL:
`https://zhaoyang.fr/sncf-bilan` hosted, `http://127.0.0.1:8770` local.

| Route | Does |
|---|---|
| `POST /api/v1/recaps` | renders the PDF, records the job, queues the email. `202` accepted · `200` same request repeated (existing job returned, not sent again) · `409` `idempotency_key` reused with different content · `422` invalid · `429` daily limit · `401` key |
| `GET /api/v1/recaps/{id}` | `queued`, `sent` or `failed`, with the provider's message id or the error |
| `GET /api/v1/recaps/{id}/document.pdf` | the PDF that was attached |
| `POST /api/v1/recaps/{id}/retry` | sends a failed job again (`409` if it is not failed) |
| `POST /api/v1/render` | same body; returns the PDF; records and sends nothing |
| `GET /healthz` | liveness and the mail mode |

Limits by default: 80 emails per 24 h in total, 5 per recipient. One recipient
per recap. Records and PDFs are deleted after 30 days.

## Examples

`contracts/examples/` — every example runs between Toulouse Matabiau and
Carcassonne; the recipient is a placeholder, `destinataire@example.fr`.

| File | Shows | Result |
|---|---|---|
| `01-aller-retour-complet.json` | round trip, 30 travellers, 2nd class, simulated | accepted, 30,00 € |
| `02-aller-simple-minimal.json` | one way, required values only | accepted, "non communiqué" |
| `03-correspondance-premiere-classe.json` | connection at Castelnaudary, 1st class, train/coach/seat, long name | accepted |
| `90-invalide-prix-transmis.json` | a `price` field although the tariff is fixed | 422 |
| `91-invalide-arrivee-avant-depart.json` | arrival before departure | 422 |

## Credentials

Nothing secret is in this repository. `credentials.env` is ignored by git and
read at start-up (a variable set in the shell wins over the file):

| Variable | For |
|---|---|
| `BILAN_API_KEY` | the `X-Bilan-Key` value; required to start the service |
| `RESEND_API_KEY` | sending from `zhaoyang.fr`; required in `live` mode only |
| `BILAN_MAIL_MODE` | `dry-run` (default) or `live` |
| `BILAN_COPY_TO` | optional, comma-separated: every email is also sent as a blind copy to these addresses (the recipient is never copied to itself) |

Template and optional settings: `credentials.env.example`. Do not commit the
file, paste the keys in an issue or chat, or call the service from frontend
code. If a key leaks, tell the owner so it can be revoked.

The emails come from `Sorties scolaires liO – démo <sorties@zhaoyang.fr>`.

## Layout

```text
src/sncf_bilan/
  models.py       request contract and validation
  formatting.py   French dates, times, amounts
  view.py         display values shared by the PDF and the email
  pdf/            recap.html.j2, recap.css, render.py (WeasyPrint)
  mail/           subject.txt.j2, body.txt.j2, body.html.j2, compose.py, deliver.py
  service.py      render, record, send, retry
  store.py        SQLite job record
  api.py          FastAPI routes
contracts/        JSON Schema and example requests
scripts/          preview.py, send_example.py, export_schema.py
assets/           logo (see assets/brand/PROVENANCE.md), fonts (Source Sans 3, OFL)
```

Email delivery uses [Mailato](https://github.com/ze2phyrzhenyin/Mailato) 0.4.0.
Rules for contributors and coding agents: `AGENTS.md`.
