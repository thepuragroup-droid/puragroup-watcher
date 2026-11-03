# Pura Watcher

Uptime monitoring, server-error tracking and a dashboard for The Pura Group's
storefronts:

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
- **server errors** from Vercel for every site, grouped by cause, scored and
  tracked to a fix (see [Server errors](#server-errors))

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

How it behaves (one outage = one incident = one call):
- When a site goes down, it **triggers** one incident for that outage. If
  PagerDuty can't be reached, the trigger is retried on every 5-minute run
  until PagerDuty accepts it. After that, nothing more is sent for that
  outage. PagerDuty's own notification rules decide how it contacts you
  (call, then SMS, then push) and keep going until someone acknowledges.
- When the site recovers, the watcher **resolves** that incident, retrying
  the same way until PagerDuty accepts it.
- If the site comes back and then fails again, that's a new outage and a new
  incident.
- If you resolve the incident in PagerDuty while the site is still down, the
  watcher won't page you again for that outage.
- PagerDuty runs on its own track: an email or webhook problem never blocks
  a phone call, and a PagerDuty problem never causes duplicate emails.
  Failures show as a red banner on the dashboard.
- **Send test alert** pages exactly like a real outage (critical
  severity), so if the test calls you, a real outage will too.

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

## Server errors

Every error the four sites log on Vercel (API routes, pages, middleware and
builds) lands on the **Errors** page. Errors are grouped by cause, sorted by
priority, and tracked through Open → Analyzed → Fix pending → Fixed. Claude
Code analyses and fixes them with two skills in this repo.

```
Vercel (all four projects) ─ Log Drain ─▶ POST /ingest/vercel   signature-checked
                                            └─ keeps error/fatal lines + 5xx
                                               └─ D1 error_events ─trigger─▶ error_groups
Errors page                       grouped by site, severity, route or status; filter, search, sort
Claude Code /vercel-errors-triage ─ GET/PATCH /api/errors ─▶ root cause, 0–100 score, proposed fix
Claude Code /vercel-errors-fix    ─ PR in the site's repo ─▶ "Fix pending" ─ verify ─▶ "Fixed"
```

- **No code in the sites.** The drain is configured in Vercel, so
  vyta-rtl-x, aminocan-cad, aminocan-whl and aminoex need no changes. It
  lands here, off Vercel and Supabase, like the uptime checks.
- **Grouping:** `src/errors/normalize.ts` fingerprints each error from its
  site, source, route (ids collapsed: `/api/orders/:id`), the first line of
  the message with variable parts removed (ids, numbers, emails, times), and
  the first stack frame in the app's own code. One bug hit by a thousand
  requests is one row. The same message on two routes, or on two sites, is
  two rows.
- **Which site:** by Vercel project id (`vercelProjectIds` in
  `src/config.ts`), falling back to the request host. Lines that match
  neither, such as builds or preview URLs of a project not listed yet, show
  under **Unmatched project**. A banner names the project ids to add.
- **Regressions:** a Fixed error that occurs again is flagged **Regressed**
  automatically.
- **Retention:** occurrences are kept 30 days. Group counts and analysis are
  kept for good.
- **Priority:** Claude's score once an error is analysed. Before that, an
  automatic estimate shown as `~NN`, based on revenue paths, 5xx/fatal,
  volume and recency.

### Setup

1. Create the tables (also part of a normal deploy):

   ```bash
   npm run db:migrate
   ```

2. Add the drain in Vercel → **Team Settings → Drains** (older dashboards:
   *Log Drains*) → Add:
   - Data: **Logs**. Projects: the four sites (or all projects).
   - Sources: **Functions**, **Edge** and **Build**. Static and external
     aren't needed.
   - Environments: **Production**. Add Preview if you want preview errors
     too; the page can filter by environment.
   - Endpoint: `https://<watcher>/ingest/vercel`, format **JSON**, sampling 100%.

   If the sites are in **more than one Vercel team**, add one drain per team,
   all pointing at the same endpoint, with `?team=<name>` on the URL (see
   step 3).

3. Store the drain's secrets. These take effect immediately, with no redeploy:

   ```bash
   npx wrangler secret put VERCEL_DRAIN_SECRETS
   ```

   ```bash
   npx wrangler secret put VERCEL_DRAIN_VERIFY
   ```

   - `VERCEL_DRAIN_SECRETS`: the drain's signing secret. With several teams,
     comma-separate them: `secretA,secretB`.
   - `VERCEL_DRAIN_VERIFY`: the verification value Vercel shows when you add
     the drain. With several teams: `teamA=value1,teamB=value2`, matching
     each drain URL's `?team=`.

   Then finish adding the drain in Vercel. `GET /ingest/vercel` returns
   `{"ok":true}` with the `x-vercel-verify` header, so you can check it.

4. Add each site's Vercel project id (Project → Settings → General →
   Project ID) to `vercelProjectIds` in `src/config.ts`, then
   `npm run deploy`. Errors still match by host without it, but builds and
   preview URLs need the id. The Errors page lists any ids it sees but can't
   place.

5. For Claude Code, create an API token:

   ```bash
   openssl rand -hex 32
   ```

   ```bash
   npx wrangler secret put WATCHER_API_TOKEN
   ```

   Then give Claude Code the dashboard address and the token as the
   environment variables `WATCHER_URL` and `WATCHER_API_TOKEN`. In a Claude
   Code cloud environment, set them in the environment's settings, and add
   the Watcher host under **Allowed domains** in its network access settings.

The Errors page shows **Drain connected** once the first batch arrives (even
a batch with no errors in it). If Vercel's deliveries are refused, a red
banner says why.

**Cost:** Vercel bills drains by data volume on Pro. It sends every line from
the chosen sources, and Watcher keeps only the errors, so choose sources and
environments with that in mind (Vercel → Usage shows the volume). Each batch
costs Watcher one D1 write per error stored, plus at most one write a minute
for drain health.

### With Claude Code

| Command | What it does |
| --- | --- |
| `/vercel-errors-triage` | Lists every active error, grouped and sorted. Then, for the ones not analysed yet and regressions, it opens the site's repo, finds the cause, scores it 0–100, writes a concrete fix and saves it here. |
| `/vercel-errors-triage all` / `site aminoex` / `<fp>` | Re-analyse everything, one site, or specific errors (the detail page has copy buttons). |
| `/vercel-errors-fix <fp>` / `top 3` / `critical` | Implements the recorded fix in the site's repo: re-checks the cause, adds a test, type-checks and builds, opens a draft PR, sets **Fix pending**. |
| `/vercel-errors-fix verify` | Marks merged fixes **Fixed** once production has been quiet for a day, and reports fixes that didn't work. |

The skills are in `.claude/skills/vercel-errors-*/SKILL.md`. Log text is
treated as untrusted: instructions inside an error message are never
followed.

### API

All endpoints require `Authorization: Bearer <WATCHER_API_TOKEN>`. With no
token set, the API is off.

| Request | Returns |
| --- | --- |
| `GET /api/errors?site=&status=active\|all\|<status>&env=&q=&limit=` | groups sorted by priority, drain health, unmatched projects |
| `GET /api/errors/<fingerprint>` | one group and its latest 50 occurrences |
| `PATCH /api/errors/<fingerprint>` | update `status`, `score`, `severity`, `category`, `root_cause`, `solution`, `confidence`, `affected_files`, `fix_ref`, `status_note`, `analyzed` (validated in `src/errors/validate.ts`) |
| `GET /api/sites` | ids, names, repos, app folders |

Each group includes its `site` (repo and `appDir`), so the fix skill knows
where the code lives.

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
  errors/            Vercel drain receiver, fingerprinting, D1 store, API, validation
  data/              D1 queries + pure stats (buckets, histograms, downtime)
  ui/                server-rendered HTML, CSS tokens, SVG charts, small client script
                     (errors.ts: the Errors pages and panels)
migrations/          D1 schema
scripts/seed.ts      synthetic local data
.claude/skills/      Claude Code skills: vercel-errors-triage, vercel-errors-fix
test/                unit tests
```

Design decisions for the dashboard are recorded in `DESIGN.md` and
`.impeccable/briefs/dashboard.md`.
