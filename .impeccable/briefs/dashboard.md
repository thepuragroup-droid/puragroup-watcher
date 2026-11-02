# Surface brief: dashboard (overview + site pages)

Mode: Operate. Desk-first, a few staff, glanced at many times a day.
Build path: code-led (Operate surface; no image generation in this session).
Direction chosen by the agent: the user answered the product questions and
delegated the visual direction.

## Direction contract

THESIS: The four storefronts read as four lines of one timeline. Every
5-minute check is a visible tick, so an outage is a red run you can measure by
eye. This replaces the category default of a grid of cards with big uptime
percentages and sparklines.

OWN-WORLD: Lab bench. A pale, cool green-grey ground; white work surfaces with
1px hairlines; a deep pine shell bar that carries the product name and the
fleet's status. Ink is near-black green. State colours do real jobs only: pass
green, slow amber, fail red, and a quiet grey for no data. The latency series
is in pine. System UI sans with tabular numerals; monospace only for URLs,
HTTP codes and log timestamps. 6px radii, no decorative shadows.

STORY: First, are all four up? If not: which site, for how long, and the exact
failure (HTTP code or error). Then, per site: how often and how long it has
failed, and whether it is getting slower. They act by opening the site or its
repo, or by running a check on demand.

FIRST VIEWPORT: A full-width pine bar. On the left, "Pura Watcher" and one
sentence of fleet status ("All 4 sites up", or "Aminoex is down · 14m"). On
the right, "Checked 2 min ago" and a "Run checks now" button. Below, on the
grey ground: the range tabs (24h/7d/30d/90d) and a state legend. Then one
white table, one row per site: status, name + domain, the tick ribbon (about
half the width), uptime, median/p95 response, and the latest event. A
"Recent incidents" table follows.

FORM: The tick ribbon is the signature. Each check (or rollup bucket) is a
narrow vertical tick: colour encodes state and height encodes response time
against the site's own p95, so the ribbon carries availability and speed at
once. Outages underline themselves with a red bracket labelled with their
duration. Signature interaction: hovering the ribbon shows a crosshair readout
(time, state, response time). Clicking a row opens the site page.
seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
