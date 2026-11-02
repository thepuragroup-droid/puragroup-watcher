# Pura Watcher

Uptime monitoring and a dashboard for The Pura Group's storefronts:

| Site | URL | Repo |
| --- | --- | --- |
| VYTA Biosciences | https://www.vytabio.com | vyta-rtl-x |
| Aminocan | https://www.aminocan.com | aminocan-cad |
| PURAMASS | https://puramass.com ⚠️ inferred from code, please confirm | aminocan-whl |
| Aminoex | https://aminoex.com | aminoex |

Every 5 minutes it checks each site's `/api/health` (the app plus its
database) and its homepage. It records every result, tracks outages, and
emails, or posts to Slack/Discord, the people assigned to each site when a
site goes down, stays down, and recovers.

The dashboard shows:
- every site's status
- a tick ribbon per site: one tick per check, coloured by result, with height
  showing response time
- uptime, median and p95 response time over 24h, 7d, 30d or 90d
- a response-time chart
- a 90-day availability grid
- an outage history
- a paginated check log per site

## Where it runs, and why not Vercel

All four sites run on **Vercel + Supabase**. A monitor hosted on either one
fails along with the sites in exactly the outages you most need to hear
about. The watcher therefore runs on **Cloudflare Workers**:

- **Cron Triggers** run the checks every 5 minutes, with no server to keep alive.
- **D1** (Cloudflare's SQLite) stores the checks, hourly rollups and outages.
- The same Worker serves the dashboard.
- It runs on separate infrastructure, so a Vercel or Supabase incident
  doesn't take the monitor down with it.

Alternatives considered: **Fly.io / Railway** (a small always-on Node
server with SQLite, about $3–5/mo; you maintain a container) and a **VPS**
(Hetzner or DigitalOcean, about $5/mo; most control, but you patch the box).
Both work. Cloudflare is cheaper and has less to maintain.

**Plan:** the free Workers plan runs the checks fine. Its 10 ms CPU limit per
request can be tight for rendering the full dashboard, so the **Workers Paid
plan ($5/mo)** is recommended. D1 usage is well within free limits: about
3,500 row writes a day, and about 1,300 row reads per dashboard load.

## Setup

You need a Cloudflare account and Node 20+.

1. Install and sign in:

   ```bash
   npm install
   ```

   ```bash
   npx wrangler login
   ```

2. Create the database, then paste the printed `database_id` into
   `wrangler.toml`:

   ```bash
   npx wrangler d1 create puragroup-watcher
   ```

3. Create the tables:

   ```bash
   npm run db:migrate
   ```

4. Set the dashboard password:

   ```bash
   npx wrangler secret put DASHBOARD_PASSWORD
   ```

5. Set up alerts. For phone calls, set up PagerDuty (see
   [Phone calls with PagerDuty](#phone-calls-with-pagerduty) below). For
   email, use [Resend](https://resend.com). A Slack or Discord incoming
   webhook is optional:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

   ```bash
   npx wrangler secret put ALERT_WEBHOOK_URL
   ```

   In `wrangler.toml [vars]`, set `ALERT_FROM` (an address on a domain
   verified in Resend), `ALERT_EMAILS` (people alerted for every site) and
   `DASHBOARD_URL` (used for links in alerts). Per-site recipients go in
   `alertEmails` in `src/config.ts`.

6. Deploy:

   ```bash
   npm run deploy
   ```

   The first check runs within 5 minutes. You can also press **Run checks
   now** on the dashboard.

7. Optional: add a custom domain (e.g. `status.puragroup.com`) under Workers
   → your worker → Settings → Domains & Routes.

### Before the first deploy: health endpoints

Each site needs the `/api/health` route merged and deployed:

- vyta-rtl-x: thepuragroup-droid/vyta-rtl-x#129
- aminocan-whl: thepuragroup-droid/aminocan-whl#491
- aminocan-cad: thepuragroup-droid/aminocan-cad#266
- aminoex: thepuragroup-droid/aminoex#88

Until a site has the route, its health check returns 404 and the site shows
as **down**. To monitor a site by its homepage alone in the meantime, set
`healthPath: null` for it in `src/config.ts`.

## Phone calls with PagerDuty

The free PagerDuty plan includes up to 5 users and 100 phone/SMS
notifications a month; push and email are unlimited. Phone and SMS coverage
on the free plan varies by country, so check yours.

1. Sign up at pagerduty.com and choose the **Free** plan.
2. In **My Profile → Contact Information**, add and verify your mobile
   number. In **Notification Rules**, set "High-urgency incidents" to
   **Phone call** immediately, then **SMS** after 1 minute, then
   **Push** after 2 minutes. Install the PagerDuty app for push and
   one-tap acknowledge.
3. Go to **Services → Service Directory → New Service** and name it
   "Pura Group storefronts". Use the default escalation policy (which pages
   you), and set urgency to **High, follow escalation rules**.
4. On the integrations step, add **Events API V2**. Copy the
   **Integration Key** (32 characters).
5. Store it as a secret. It takes effect immediately, with no redeploy:

   ```bash
   npx wrangler secret put PAGERDUTY_ROUTING_KEY
   ```

6. On the dashboard, open **Alert channels**. PagerDuty should read **On**.
   Press **Send test alert**: your phone should ring within about a
   minute. Resolve the test incident in the PagerDuty app.

How it behaves:
- When a site goes down, it **triggers** one incident per outage. PagerDuty
  then calls, texts and escalates on its own until someone acknowledges.
- When the site recovers, the watcher **resolves** that incident, so the
  calls stop.
- The hourly reminder isn't sent to PagerDuty, because PagerDuty already
  re-notifies an open incident.
- A failed send to PagerDuty is retried once. A remaining failure shows as
  a red banner on the dashboard.

To add a teammate, invite them in PagerDuty (**People → Users**) and put
them on the escalation policy. Everything about who gets called, and when,
lives in PagerDuty.

## How alerting works

- Each run checks health and homepage in parallel, with a 10 s timeout. A
  failed check is **retried once after 5 s**, so a single dropped request
  never pages anyone.
- An outage is declared after `failureThreshold` failed runs (default 1,
  i.e. within 5 minutes). Its start time is the first failed check.
- Alerts: one **DOWN**, a **reminder every `reminderMinutes`** while it stays
  down (default 60, 0 = off), and one **RECOVERED** with the total downtime.
  An alert that failed to send is retried on the next run, and the dashboard
  shows a banner until it gets through.
- A check that passes but takes longer than `slowMs` (default 3 s) is
  marked **slow**. Slow checks are tracked but never alert.

All of these settings are per site in `src/config.ts`.

## Dashboard notes

- **Tick ribbon:** each tick is one check (24h) or a rollup (1 h for 7d, 6 h
  for 30d, 1 day for 90d). Green means passed, amber slow (≥10% of the
  bucket's checks slow), red failed. Taller ticks are slower, relative to that
  site's own p95. An outage is underlined and labelled with its length.
- **Percentiles:** the 24h figures are exact. Longer ranges merge per-hour
  latency histograms, which stays accurate without reading every check.
- **Retention:** raw checks are kept for 90 days, hourly rollups for 400.
- The overview reloads itself every 2 minutes while the tab is visible.
- A red banner appears if the watcher itself hasn't run for 15 minutes,
  i.e. the cron has stopped.

## Local development

```bash
npm run db:migrate:local
```

```bash
npm run db:seed:local
```

```bash
echo 'DASHBOARD_PASSWORD=preview' > .dev.vars
```

```bash
npm run dev
```

The seed is **synthetic** preview data (7 days of checks, 90 days of
rollups, and one site currently down). It is for the local database only;
never run it against production. Open http://localhost:8787 and sign in
with `preview`. To trigger the cron handler locally:

```bash
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

Tests (Node's built-in runner) and type checks:

```bash
npm test
```

```bash
npm run typecheck
```

## Layout

```
src/
  config.ts          sites + per-site alert settings
  index.ts           Worker entry: routes, auth, cron handler
  auth.ts            password login (HMAC-signed cookie)
  monitor/           checks, state machine (logic.ts), alerts, run loop
  data/              D1 queries + pure stats (buckets, histograms, downtime)
  ui/                server-rendered HTML, CSS tokens, SVG charts, small client script
migrations/          D1 schema
scripts/seed.ts      synthetic local data
test/                unit tests
```

Design decisions for the dashboard are recorded in `DESIGN.md` and
`.impeccable/briefs/dashboard.md`.
