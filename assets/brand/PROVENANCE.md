# Brand assets

| File | Used by | Content |
|---|---|---|
| `logo.svg` | PDF header | SNCF Voyageurs logotype (2020), unmodified — **or a placeholder** |
| `logo.png` | email header (inline image) | the same logo on white, 224 px high — **or a placeholder** |
| `placeholder/logo.svg`, `placeholder/logo.png` | public copies of this project | dashed box "LOGO", drawn for this repository |

Public copies of this project (the team repository) ship the placeholders as
`logo.svg` / `logo.png`. The real files come with the owner's private bundle
(`sncf-bilan.private.zip`), unzipped at the project root. Other files can be
used with `BILAN_LOGO_SVG` / `BILAN_LOGO_PNG`.

## Source of the logo

- Chosen by the owner on 2026-10-10 ("SNCF Voyageurs"), who asked for it to be
  fetched from the web.
- Downloaded on 2026-10-10 from French Wikipedia:
  <https://fr.wikipedia.org/wiki/Fichier:Logotype_SNCF_Voyageurs_2020.svg>
  (file SHA-1 `0f79ec1319b7695569e685a94ff3f8a37c112753`, uploaded 2022-10-23).
  That page credits <https://www.sncf.com/fr/groupe/marques/sncf/signatures-metiers>.
  The official site `sncf-voyageurs.com` refused automated access (HTTP 403),
  so the file was not taken from the brand owner directly.

## Terms: this is not a free asset

The logo is a **registered trademark of SNCF Voyageurs**. Wikipedia hosts it as
a non-free image under its trademark exception; that exception does not extend
to this project. No licence or written permission from SNCF is recorded here.

Consequences:

- Use is the owner's decision, made for a hackathon prototype run with SNCF.
  Confirm with the organisers before showing the recap outside the event.
- The two real files stay out of public repositories; they travel in the
  private bundle only.
- Do not redraw the logo, change its colours or proportions, or crop it.
- The PDF and the email state that they are not a ticket and come from a
  demonstration prototype with no contractual link to SNCF Voyageurs. Keep
  those sentences: next to this logo they are what prevents a reader from
  taking the document for an official one.

## Fonts

`../fonts` holds Source Sans 3 (Adobe), SIL Open Font License 1.1, see
`../fonts/OFL.txt`. Used in the PDF only.
