---
name: Pura Watcher
description: Uptime dashboard for The Pura Group storefronts, styled as a lab bench.
colors:
  ground: "#EDF0EE"
  surface: "#FFFFFF"
  surface-2: "#F5F7F6"
  line: "#D9DFDB"
  line-strong: "#C2CBC6"
  ink: "#16201D"
  ink-2: "#3F4D48"
  ink-3: "#5B6964"
  shell: "#123A35"
  shell-2: "#1A4A43"
  shell-line: "#2A5A52"
  shell-ink: "#EAF2EF"
  shell-ink-2: "#A8C4BC"
  accent: "#1D5C53"
  focus: "#2F8F80"
  pass: "#2E8B62"
  slow: "#C88A12"
  fail: "#C2372D"
  none: "#CBD3CF"
  pass-wash: "#E5F2EB"
  pass-ink: "#1D6646"
  slow-wash: "#FBF2DE"
  slow-ink: "#7E5A08"
  fail-wash: "#FBEAE8"
  fail-ink: "#9C271F"
  series: "#1D5C53"
  grid: "#E6EAE8"
typography:
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  page-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.25
  stat:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-0.01em"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  data-mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, Cascadia Mono, DejaVu Sans Mono, monospace"
    fontSize: "12.5px"
rounded:
  sm: "6px"
  md: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  section: "32px"
components:
  topbar:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-ink}"
    height: "60px"
  button-shell:
    backgroundColor: "{colors.shell-2}"
    textColor: "{colors.shell-ink}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 14px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    height: "34px"
  button-quiet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "34px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  tabs-current:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "5px"
    height: "28px"
  pill-down:
    backgroundColor: "{colors.fail-wash}"
    textColor: "{colors.fail-ink}"
    rounded: "{rounded.pill}"
    height: "28px"
  pill-up:
    backgroundColor: "{colors.pass-wash}"
    textColor: "{colors.pass-ink}"
    rounded: "{rounded.pill}"
    height: "28px"
---

## Overview

An Operate surface: a working monitor for a few staff at a desk, also usable
on a phone. The world is a **lab bench**. A pale, cool green-grey ground
carries white work surfaces edged with 1px hairlines. A deep pine shell bar
holds the product name and the fleet's status in one sentence. The world
contributes type, palette, density and one signature move; layout and
controls stay standard (tabs, tables, buttons, links).

**Signature: the tick ribbon.** Every check (24h) or rollup bucket (7d/30d/90d)
is a vertical tick in each site's row. Colour encodes the result and height
encodes the response time against that site's own p95, so the ribbon carries
availability and speed at once. Outages underline themselves with a red
bracket labelled with their length. Hovering shows a crosshair and a readout.
At 24h the 288 ticks are drawn gapless, so they read as one clean skyline; a
gap at under 2px per tick aliases into false stripes. Sparser ranges keep a
1-unit gap.

## Colors

- **Restrained palette with real jobs.** Neutrals are tinted green-grey. Pine
  (`shell`) owns the top bar and the login ground. `accent` marks the current
  tab and primary buttons, and is never decoration.
- **State colours appear only where state is meant:** `pass` (green),
  `slow` (amber), `fail` (red), `none` (grey, no data). Each has a `-wash`
  background and an `-ink` text tone with at least 4.5:1 contrast on its wash.
- A down site's row gets a light fail-wash tint. Failed log rows get a
  fail-wash; slow log rows get a slow-wash. No coloured side stripes.
- `series` (pine) draws the median line; p95 is the same hue at 45% opacity,
  1px.
- **Dark mode** follows `prefers-color-scheme` and keeps the same roles: a
  near-black green ground, lifted state colours, a darker shell. All tokens are
  redefined under the dark media query in `src/ui/styles.ts`.

## Typography

- **One family:** the platform UI sans, everywhere, with `tabular-nums` on
  the body so figures align.
- **Scale (ratio about 1.2):** 12 (labels and table headers), 12.5 (secondary),
  14 (body), 15 (section titles and site names), 20 (stat values), 26 (page
  title).
- **Weights:** 600–700 for emphasis. No display face.
- **Mono** is reserved for HTTP status codes, URLs, paths and environment
  variable names. Log timestamps stay in the sans.

## Layout

- The content column is 1360px max with 24px gutters (16px under 760px).
- The overview is one panel holding one table, one row per site. Columns:
  status 88, site 168, ribbon (flex, at least 280), uptime 92, response 130,
  latest 220. Under 1100px the latest column hides; under 760px each row
  becomes a three-row grid (site/uptime, ribbon, status/response), plus a
  full-width cause row for a down site.
- The site page stacks: breadcrumb and title with range tabs; a stats strip
  (six cells in one panel, separated by hairlines rather than six cards); the
  response chart; then the 90-day grid and the outages table side by side
  (5:7 split); then the check log.
- Sections are 32px apart. Inside panels the padding is 16px.

## Elevation & Depth

Flat. Surfaces separate by hairline borders and the ground/surface contrast,
not by shadow. The only shadow is the floating hover readout (`--shadow-pop`).

## Shapes

- Radius is 8px for panels and 6px for buttons and inputs. Pills are fully
  round.
- Ticks are rectangles with no rounding. Status dots are 8px circles; a down
  dot carries a 3px halo in its own hue.

## Components

- **Range tabs:** a segmented control of links (`aria-current="page"` on the
  active one). Active is the accent fill with white text; others are ink-2,
  with a surface-2 background on hover.
- **Run checks now:** a shell button that POSTs and shows a spinner plus
  "Checking all sites…" while the run takes about 10–20 s.
- **Banners:** amber for advisories (alerts off, no checks yet), red for
  failures (watcher stalled, alert not delivered), green for confirmation.
  Each has an icon and one bold lead phrase.
- **Response chart:** server-rendered SVG with HTML axis labels. Gridlines sit
  at quarter steps of a round axis top (1/2/3/4/6/8/10 × 10ⁿ). Axis marks fall
  on whole local hours or days. Failed checks get a red band and a 5px base
  tick. Spikes above the axis top are clipped, and the panel says so.
- **90-day grid:** 30 columns by 3 rows of day cells (15 columns on phones).
  Green is 100%, amber 99–99.9%, red under 99%, grey no data.
- **Tables:** header row on surface-2 with 12px labels and hairline row
  dividers. Whole site rows are clickable, and the link inside stays a real
  link.
- **States:** empty states say what will appear and when. Error and setup
  pages use the login card on the pine ground.

- **Top nav:** two links in the shell bar, Uptime and Errors, styled like
  the range tabs but in shell colours (current = `shell-2` fill).
- **Errors page:** the page title with drain health under it; a strip of
  per-site counts (one panel, hairline cells, like the stats strip); status
  tabs; a filter bar (search, site, environment, sort, group); then one panel
  per section, each holding one table (priority, error + meta line, 24h, 7d,
  total, last seen, status). Number columns have fixed widths, so they line
  up across sections. A regressed row gets the fail-wash tint, like a down
  site.
- **Priority badge:** a small bordered box. Uses `fail` colours at ≥75 and
  `slow` at 50–74; neutral below. An automatic estimate (not yet scored by
  Claude) has a dashed border and a `~` prefix. Severity and status are
  coloured words, not pills.
- **Error detail:** crumbs, the message as the title (20px, wraps), a
  six-cell stats strip, Root cause and Proposed fix side by side, a Status
  panel with the actions, the latest message in mono (marked untrusted),
  then the occurrences log. Claude Code commands are shown in mono with a
  Copy button.
- **Overview and site page:** a Server errors table between the sites table
  and Recent incidents (one row per site), and a top-5 panel above the check
  log on each site page.

## Do's and Don'ts

- **Do** keep one table per job. Don't turn site rows into cards, and don't
  replace the ribbon with sparklines or big-number tiles.
- **Do** keep numbers on one window. Brackets, downtime and outage counts all
  use the drawn grid's start.
- **Do** say what a number is: "Response" for one check, "Median" for many,
  and "p95 (hourly rollups)" where it is estimated from histograms.
- **Don't** use coloured left/right stripes on rows or callouts, gradient
  text, glass, or decorative shadows.
- **Don't** introduce a display font or a second sans. Mono stays on codes,
  URLs and env names.
