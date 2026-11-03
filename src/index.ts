import { authState, clearCookie, passwordMatches, sameOrigin, sessionCookie } from './auth.ts';
import { findSite, SITES } from './config.ts';
import { checkLog, lastRunAt, overview, siteHourly, siteIncidents, siteSummary, type StateRow } from './data/queries.ts';
import { dailyAvailability, parseRange } from './data/stats.ts';
import { timezone, type Env } from './env.ts';
import { runAll } from './monitor/run.ts';
import { buildAlert, recipientsFor, sendAlert } from './monitor/alerts.ts';
import { makeFormatters } from './ui/format.ts';
import { html } from './ui/html.ts';
import { icon, plainPage, shell } from './ui/layout.ts';
import { fleetSentence, loginPage, notices, overviewBody, setupPage, siteBody, type Notices } from './ui/pages.ts';
import { handleApi } from './errors/api.ts';
import { handleIngest } from './errors/ingest.ts';
import {
  ACTIVE,
  drainState,
  errorCountsBySite,
  getGroup,
  groupEvents,
  listGroups,
  pruneErrorEvents,
  unmatchedProjects,
  updateGroup,
  STATUSES,
  type ErrorStatus,
  type Group,
} from './errors/store.ts';
import { errorDetailBody, errorsBody, overviewErrorsPanel, parseErrorsQuery, siteErrorsPanel } from './ui/errors.ts';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

function page(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra },
  });
}

function redirect(to: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: to, ...SECURITY_HEADERS, ...extra } });
}

/** Only same-site relative paths, so ?next= can't bounce users elsewhere. */
function safePath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  return raw;
}

function alertsConfigured(env: Env): boolean {
  if (env.ALERT_WEBHOOK_URL || env.PAGERDUTY_ROUTING_KEY) return true;
  const hasRecipients = SITES.some((s) => recipientsFor(s, env).length > 0);
  return Boolean(env.RESEND_API_KEY && env.ALERT_FROM && hasRecipients);
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // ---- Public routes --------------------------------------------------
  // Vercel Log Drain (signature-checked) and the skills' API (bearer token).
  if (path === '/ingest/vercel') return jsonGuard(() => handleIngest(req, env));
  if (path === '/api/sites' || path === '/api/errors' || path.startsWith('/api/errors/')) {
    return jsonGuard(() => handleApi(req, env, path));
  }

  if (path === '/login') {
    if (env.DASHBOARD_PUBLIC !== '1' && !env.DASHBOARD_PASSWORD) return page(setupPage(), 503);
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
      const form = await req.formData();
      const next = safePath(String(form.get('next') ?? '/'));
      if (await passwordMatches(env, String(form.get('password') ?? ''))) {
        return redirect(next, { 'Set-Cookie': await sessionCookie(env) });
      }
      return page(loginPage(true, next), 401);
    }
    return page(loginPage(false, safePath(url.searchParams.get('next'))));
  }

  if (path === '/logout' && req.method === 'POST') {
    return redirect('/login', { 'Set-Cookie': clearCookie() });
  }

  // ---- Everything else needs a session --------------------------------
  const auth = await authState(req, env);
  if (auth === 'unconfigured') return page(setupPage(), 503);
  if (auth === 'login') {
    if (req.method !== 'GET') return new Response('Unauthorized', { status: 401 });
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const now = Date.now();
  const tz = timezone(env);
  const fmt = makeFormatters(tz);
  const range = parseRange(url.searchParams.get('range'));
  const showSignOut = env.DASHBOARD_PUBLIC !== '1';

  if (path === '/run' && req.method === 'POST') {
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
    const form = await req.formData();
    await runAll(env);
    const back = new URL(safePath(String(form.get('back') ?? '/')), url.origin);
    back.searchParams.set('ran', '1');
    return redirect(back.pathname + back.search);
  }

  if (path === '/test-alert' && req.method === 'POST') {
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
    const site = SITES[0];
    const input = {
      kind: 'test' as const,
      site,
      now,
      downSince: null,
      results: [],
      dashboardUrl: env.DASHBOARD_URL || url.origin,
    };
    const everyone = [...new Set(SITES.flatMap((s) => recipientsFor(s, env)))];
    const sent = await sendAlert(env, everyone, buildAlert({ ...input, timeZone: tz }), input);
    const back = new URL('/', url.origin);
    back.searchParams.set('test', sent.ok && !sent.error ? 'ok' : sent.ok ? 'partial' : 'fail');
    if (sent.error) back.searchParams.set('why', sent.error.slice(0, 300));
    return redirect(back.pathname + back.search + '#alerts');
  }

  const statusPost = path.match(/^\/errors\/([0-9a-f]{16})\/status$/);
  if (statusPost && req.method === 'POST') {
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
    const form = await req.formData();
    const status = String(form.get('status') ?? '');
    if (!(STATUSES as readonly string[]).includes(status)) return new Response('Bad status', { status: 400 });
    const g = await updateGroup(env, statusPost[1], { status: status as ErrorStatus });
    if (!g) return notFound(tz);
    return redirect(`/errors/${statusPost[1]}?saved=1`);
  }

  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const lastRun = await lastRunAt(env);
  const configured = alertsConfigured(env);
  const baseNotices = (alertErrors: Notices['alertErrors']): Notices => ({
    lastRun,
    now,
    alertsConfigured: configured,
    // When alerting isn't set up at all, one "Alerts are off" banner says it.
    alertErrors: configured ? alertErrors : [],
    ranNow: url.searchParams.get('ran') === '1',
  });
  const returnTo = (() => {
    const p = new URLSearchParams(url.search);
    p.delete('ran');
    p.delete('test');
    p.delete('why');
    const q = p.toString();
    return url.pathname + (q ? `?${q}` : '');
  })();

  if (path === '/') {
    const [data, errorsPanel] = await Promise.all([overview(env, range, now), overviewErrors(env, now)]);
    const alertErrors = data.sites.flatMap((s) => [
      ...(s.state?.last_alert_error ? [{ site: s.site, error: s.state.last_alert_error }] : []),
      ...(s.state?.pd_error ? [{ site: s.site, error: s.state.pd_error }] : []),
    ]);
    const fleet = fleetSentence(data.sites, now);
    const anyDown = data.sites.some((s) => s.state?.status === 'down');
    return page(
      shell({
        title: `${anyDown ? 'Down · ' : ''}Pura Watcher`,
        timeZone: tz,
        fleet,
        lastRun,
        refreshSeconds: 120,
        returnTo,
        showSignOut,
        body: overviewBody(data, range, fmt, baseNotices(alertErrors), {
          pagerDuty: Boolean(env.PAGERDUTY_ROUTING_KEY),
          webhook: Boolean(env.ALERT_WEBHOOK_URL),
          email: Boolean(env.RESEND_API_KEY && env.ALERT_FROM),
          recipients: [...new Set(SITES.flatMap((s) => recipientsFor(s, env)))].length,
          test: url.searchParams.get('test'),
          why: url.searchParams.get('why'),
        }, errorsPanel),
      }),
    );
  }

  if (path === '/errors') {
    const q = parseErrorsQuery(url.searchParams);
    const [groups, everyStatus, counts, drain, unmatched, states] = await Promise.all([
      listGroups(env, { site: q.site, status: q.status, environment: q.env, q: q.q, limit: 1000 }, now),
      // Tab counts ignore the status filter but honour the others.
      listGroups(env, { site: q.site, status: 'all', environment: q.env, q: q.q, limit: 1000 }, now),
      errorCountsBySite(env, now),
      drainState(env),
      unmatchedProjects(env, now),
      env.DB.prepare('SELECT * FROM site_state').all<StateRow>(),
    ]);
    const statusCounts: Record<string, number> = { all: everyStatus.length, active: 0 };
    for (const g of everyStatus) {
      statusCounts[g.status] = (statusCounts[g.status] ?? 0) + 1;
      if (ACTIVE.includes(g.status)) statusCounts.active += 1;
    }
    const stateById = new Map(states.results.map((s) => [s.site_id, s]));
    return page(
      shell({
        title: 'Server errors · Pura Watcher',
        timeZone: tz,
        fleet: fleetSentence(SITES.map((s) => ({ site: s, state: stateById.get(s.id) ?? null })), now),
        lastRun,
        returnTo,
        showSignOut,
        current: 'errors',
        body: errorsBody({ groups, statusCounts, counts, drain, unmatched }, q, now, fmt, notices(baseNotices([]), fmt)),
      }),
    );
  }

  const errorPage = path.match(/^\/errors\/([0-9a-f]{16})$/);
  if (errorPage) {
    const [group, events, states] = await Promise.all([
      getGroup(env, errorPage[1], now),
      groupEvents(env, errorPage[1], 50),
      env.DB.prepare('SELECT * FROM site_state').all<StateRow>(),
    ]);
    if (!group) return notFound(tz);
    const stateById = new Map(states.results.map((s) => [s.site_id, s]));
    return page(
      shell({
        title: `${group.title.slice(0, 60)} · Server errors · Pura Watcher`,
        timeZone: tz,
        fleet: fleetSentence(SITES.map((s) => ({ site: s, state: stateById.get(s.id) ?? null })), now),
        lastRun,
        returnTo,
        showSignOut,
        current: 'errors',
        body: errorDetailBody(group, events, now, fmt, notices(baseNotices([]), fmt), url.searchParams.get('saved') === '1'),
      }),
    );
  }

  const m = path.match(/^\/sites\/([a-z0-9-]+)$/);
  if (m) {
    const site = findSite(m[1]);
    if (!site) return notFound(tz);
    const failuresOnly = url.searchParams.get('log') === 'problems';
    const before = Number(url.searchParams.get('before')) || null;
    const [summary, incidents, hourly, log, states, errorsPanel] = await Promise.all([
      siteSummary(env, site, range, now),
      siteIncidents(env, site.id),
      siteHourly(env, site.id, now - 91 * 86_400_000),
      checkLog(env, site.id, { before, failuresOnly }),
      env.DB.prepare('SELECT * FROM site_state').all<NonNullable<Awaited<ReturnType<typeof siteSummary>>['state']>>(),
      siteErrors(env, site, now, fmt),
    ]);
    const stateById = new Map(states.results.map((s) => [s.site_id, s]));
    const fleet = fleetSentence(
      SITES.map((s) => ({ site: s, state: stateById.get(s.id) ?? null })),
      now,
    );
    const alertErrors = [
      ...(summary.state?.last_alert_error ? [{ site, error: summary.state.last_alert_error }] : []),
      ...(summary.state?.pd_error ? [{ site, error: summary.state.pd_error }] : []),
    ];
    return page(
      shell({
        title: `${summary.state?.status === 'down' ? 'Down · ' : ''}${site.name} · Pura Watcher`,
        timeZone: tz,
        fleet,
        lastRun,
        returnTo,
        showSignOut,
        body: siteBody(
          site,
          { summary, incidents, daily: dailyAvailability(hourly, now, 90, tz), log, failuresOnly, before },
          range,
          fmt,
          baseNotices(alertErrors),
          errorsPanel,
        ),
      }),
    );
  }

  return notFound(tz);
}

/** JSON routes report their own failures as JSON, not the HTML error page. */
async function jsonGuard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    console.error('[json]', err);
    const message = String((err as Error)?.message ?? err).slice(0, 300);
    const hint = /no such (column|table)/i.test(message) ? ' Run `npm run db:migrate`.' : '';
    return new Response(JSON.stringify({ error: `${message}${hint}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

const MIGRATE_HINT = html`<div class="banner" role="status">${icon.alert}<p><b>Server errors are not set up in the database yet.</b> From the project folder run <span class="mono">npm run db:migrate</span>.</p></div>`;

function missingTable(err: unknown): boolean {
  return /no such (column|table)/i.test(String((err as Error)?.message ?? err));
}

/** The overview's errors panel. Never takes the uptime dashboard down with it. */
async function overviewErrors(env: Env, now: number) {
  try {
    const [counts, drain, active] = await Promise.all([
      errorCountsBySite(env, now),
      drainState(env),
      listGroups(env, { status: 'active', limit: 1000 }, now),
    ]);
    const top = new Map<string, Group>();
    for (const g of active) {
      const cur = top.get(g.site_id);
      if (!cur || g.priority > cur.priority || (g.priority === cur.priority && g.last_24h > cur.last_24h)) top.set(g.site_id, g);
    }
    return overviewErrorsPanel(counts, top, drain, now);
  } catch (err) {
    if (missingTable(err)) return MIGRATE_HINT;
    console.error('[overview errors]', err);
    return html``;
  }
}

async function siteErrors(env: Env, site: (typeof SITES)[number], now: number, fmt: ReturnType<typeof makeFormatters>) {
  try {
    const [groups, counts, drain] = await Promise.all([
      listGroups(env, { site: site.id, status: 'active', limit: 200 }, now),
      errorCountsBySite(env, now),
      drainState(env),
    ]);
    return siteErrorsPanel(site, groups, counts.get(site.id), drain, now, fmt);
  } catch (err) {
    if (missingTable(err)) return MIGRATE_HINT;
    console.error('[site errors]', err);
    return html``;
  }
}

function notFound(_tz: string): Response {
  return page(
    plainPage(
      'Not found · Pura Watcher',
      html`<main class="login"><div class="card"><h1>Nothing here</h1><p>That page doesn't exist.</p><a class="btn btn-primary" href="/">Back to all sites</a></div></main>`,
    ),
    404,
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handle(req, env);
    } catch (err) {
      console.error('[fetch]', err);
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      const path = new URL(req.url).pathname;
      // D1 reports a schema older than the code as a missing column/table.
      const schemaBehind = /no such (column|table)|has no column/i.test(message);
      const what = path === '/run' ? 'The check run failed.' : "The dashboard couldn't load.";
      const hint = schemaBehind
        ? html`The database is missing an update. From the project folder run <span class="mono">npm run db:migrate</span>, then try again. Until then, scheduled checks fail too.`
        : html`If this keeps happening, run <span class="mono">npx wrangler tail</span> and try again to see the full error.`;
      return page(
        plainPage(
          'Error · Pura Watcher',
          html`<main class="login"><div class="card"><h1>Something went wrong</h1><p>${what} ${hint}</p><p class="mono" style="background:var(--surface-2);padding:10px 12px;border-radius:6px;color:var(--ink-2);overflow-wrap:anywhere">${message}</p><a class="btn btn-primary" href="/">Back to the dashboard</a></div></main>`,
        ),
        500,
      );
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Once an hour is plenty for pruning old error occurrences.
    if (new Date(event.scheduledTime).getUTCMinutes() < 5) {
      ctx.waitUntil(pruneErrorEvents(env).catch((err) => console.error('[cron] error prune failed', err)));
    }
    ctx.waitUntil(
      runAll(env).then(
        (checks) => console.log(`[cron] ${checks.map((c) => `${c.site.id}:${c.ok ? 'ok' : 'FAIL'}`).join(' ')}`),
        (err) => console.error('[cron] run failed', err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
