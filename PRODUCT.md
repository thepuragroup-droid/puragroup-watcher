# Pura Watcher

## Purpose
Uptime monitoring for The Pura Group's storefronts. Every 5 minutes it checks
each site's `/api/health` (app + database) and homepage, records the result,
tracks outages, and alerts the people assigned to that site.

## Users and situation
The owner and a few staff, at a desk (laptop or desktop) during the working
day. They open it to answer three questions in order: is every site up; if
not, which one, since when and why; and over time, how reliable and how fast
each site is. A link in an alert email often leads them in. Phone use is
secondary but must work.

## Server errors
Vercel sends each site's logs here through a Log Drain. Errors are grouped by
cause on the Errors page. Claude Code skills (`.claude/skills/vercel-errors-*`)
use `/api/errors` to analyse, score and fix them in the site's own repo. Staff
mark errors fixed or ignored on the dashboard.

## Sites watched
- VYTA Biosciences: www.vytabio.com (repo vyta-rtl-x)
- Aminocan: www.aminocan.com (repo aminocan-cad)
- PURAMASS: puramass.com (repo aminocan-whl; domain inferred from code, confirm)
- Aminoex: aminoex.com (repo aminoex)

## Constraints
- Must not depend on Vercel or Supabase, which all four sites run on.
- Hosted on Cloudflare Workers + D1; the 5-minute cron is a Worker trigger.
- Dashboard access: one shared password (secret), 30-day session.
- Times shown in America/Toronto.

## Platform
web

## Stack
Cloudflare Workers (TypeScript), D1, server-rendered HTML with hand-authored
SVG charts, no client framework. Chosen by the user from the options offered.
