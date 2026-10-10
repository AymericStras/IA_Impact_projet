# 0001 — Reuse the sncf_bilan PDF pipeline; no chart or map library

Date: 2026-10-10. Status: accepted.

**Decision.** HTML + CSS rendered by WeasyPrint, with the mechanics copied from
`sncf_bilan` (font faces, A4 page with running footer, watermark, the macOS
Pango path fix, one render at a time). The route map and the CO₂ comparison are
inline SVG and CSS produced by our own code. No matplotlib, folium or plotly.

**Why.** The sibling pipeline already works on the target host. A plotting
stack would add ~100 MB of dependencies for two simple figures, raster output
that prints worse than vector, and fonts that do not match the document.

**Consequences.** Code is copied, not imported: the two services stay
independent and can be merged separately. The map is a schematic of the bundled
network, not a geographic base map.

# Also decided the same day

- Every contract field is optional (owner, 2026-10-10): the module is handed to
  someone else for merging and upstream field availability is unknown. Missing
  data is reported through `gaps.py` instead of being refused.
- Source Sans 3 instead of the chatbot's Barlow: already bundled with its
  licence, no download.
