# Brand assets

| File | Used by | Content |
|---|---|---|
| `logo.svg` | PDF header | SNCF Voyageurs logotype (2020), unmodified — **or a placeholder** |
| `logo.png` | email (inline picture, `cid:logo`) | the same logo on white, 224 px high — **or a placeholder** |
| `placeholder/logo.svg`, `placeholder/logo.png` | public copies of this project | dashed box "LOGO", drawn for this repository |

Public copies of this project (the team repository) ship the placeholders as
`logo.svg` / `logo.png`. The real files come with the owner's private bundle
(`sncf-rapport.private.zip`), unzipped at the project root. Other files can be
used with `RAPPORT_LOGO_SVG` / `RAPPORT_LOGO_PNG`.

## Source of the logo

- Chosen by the owner on 2026-10-10 ("SNCF Voyageurs"), who asked for it to be
  fetched from the web.
- Downloaded on 2026-10-10 from French Wikipedia:
  <https://fr.wikipedia.org/wiki/Fichier:Logotype_SNCF_Voyageurs_2020.svg>
  (file SHA-1 `0f79ec1319b7695569e685a94ff3f8a37c112753`, uploaded 2022-10-23).
  That page credits <https://www.sncf.com/fr/groupe/marques/sncf/signatures-metiers>.
  The official site `sncf-voyageurs.com` refused automated access (HTTP 403),
  so the file was not taken from the brand owner directly.

## Terms

The logo is a **registered trademark of SNCF Voyageurs**.

- Permission: on 2026-10-10 the owner stated that SNCF has allowed the use of
  this logo for this project. No written document is stored in this
  repository; whoever merges or republishes the module should hold or obtain
  that confirmation for their own use.
- Do not redraw the logo, change its colours or proportions, or crop it.
- The report states that it comes from a demonstration prototype when the trip
  is simulated. Keep that sentence and the watermark.
- Placeholders stay available under `placeholder/` for copies that must ship
  without the trademark.

## Fonts

`../fonts` holds Source Sans 3 (Adobe), SIL Open Font License 1.1, see
`../fonts/OFL.txt`. Used in the PDF only.
