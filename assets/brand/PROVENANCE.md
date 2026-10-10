# Brand assets

| File | Used by | Content |
|---|---|---|
| `logo.svg` | PDF header | SNCF Voyageurs logotype (2020), unmodified |
| `logo.png` | email header (inline image) | the same logo on white, 224 px high, made from `logo.svg` with ImageMagick |

Other files can be used with `BILAN_LOGO_SVG` / `BILAN_LOGO_PNG`.

## Source

Downloaded on 2026-10-10 from French Wikipedia:
<https://fr.wikipedia.org/wiki/Fichier:Logotype_SNCF_Voyageurs_2020.svg>
(file SHA-1 `0f79ec1319b7695569e685a94ff3f8a37c112753`, uploaded 2022-10-23),
which credits <https://www.sncf.com/fr/groupe/marques/sncf/signatures-metiers>.

## Terms

The logo is a registered trademark of SNCF Voyageurs; it is not a free asset.

The project owner states (2026-10-10) that SNCF allowed its use in this
hackathon prototype, including in the public team repository, **on condition
that the PDF carries the "SIMULATION" watermark**. The permission was given to
the owner; no written copy is stored in this repository.

What follows from it:

- The watermark is on every PDF, whatever the request says
  (`src/sncf_bilan/pdf/recap.html.j2`, checked by `tests/test_pdf.py`). Do not
  make it optional or remove it.
- Do not redraw the logo, change its colours or proportions, or crop it.
- The permission covers this prototype. Do not reuse the files elsewhere.
- The PDF and the email also state that they are not a ticket and come from a
  demonstration prototype with no contractual link to SNCF Voyageurs.

## Fonts

`../fonts` holds Source Sans 3 (Adobe), SIL Open Font License 1.1, see
`../fonts/OFL.txt`. Used in the PDF only.
