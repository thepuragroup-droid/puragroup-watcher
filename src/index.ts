import { authState, clearCookie, passwordMatches, sameOrigin, sessionCookie } from './auth.ts';
import { findSite, SITES } from './config.ts';
import { checkLog, lastRunAt, overview, siteHourly, siteIncidents, siteSummary } from './data/queries.ts';
import { dailyAvailability, parseRange } from './data/stats.ts';
import { timezone, type Env } from './env.ts';
import { runAll } from './monitor/run.ts';
import { buildAlert, recipientsFor, sendAlert } from './monitor/alerts.ts';
import { makeFormatters } from './ui/format.ts';
import { html } from './ui/html.ts';
import { plainPage, shell } from './ui/layout.ts';
import { fleetSentence, loginPage, overviewBody, setupPage, siteBody, type Notices } from './ui/pages.ts';

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
    const data = await overview(env, range, now);
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
        }),
      }),
    );
  }

  const m = path.match(/^\/sites\/([a-z0-9-]+)$/);
  if (m) {
    const site = findSite(m[1]);
    if (!site) return notFound(tz);
    const failuresOnly = url.searchParams.get('log') === 'problems';
    const before = Number(url.searchParams.get('before')) || null;
    const [summary, incidents, hourly, log, states] = await Promise.all([
      siteSummary(env, site, range, now),
      siteIncidents(env, site.id),
      siteHourly(env, site.id, now - 91 * 86_400_000),
      checkLog(env, site.id, { before, failuresOnly }),
      env.DB.prepare('SELECT * FROM site_state').all<NonNullable<Awaited<ReturnType<typeof siteSummary>>['state']>>(),
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
        ),
      }),
    );
  }

  return notFound(tz);
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
      return page(
        plainPage(
          'Error · Pura Watcher',
          html`<main class="login"><div class="card"><h1>Something went wrong</h1><p>The dashboard couldn't load. If this is a new deploy, check that the D1 migrations ran (<span class="mono">npm run db:migrate</span>).</p><a class="btn btn-primary" href="/">Try again</a></div></main>`,
        ),
        500,
      );
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runAll(env).then(
        (checks) => console.log(`[cron] ${checks.map((c) => `${c.site.id}:${c.ok ? 'ok' : 'FAIL'}`).join(' ')}`),
        (err) => console.error('[cron] run failed', err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
