import { SITES, findSite, CHECK_INTERVAL_MS, type SiteConfig } from '../config.ts';
import type { CheckRow, IncidentRow, SiteSummary, StateRow } from '../data/queries.ts';
import { RANGES, type RangeSpec } from '../data/stats.ts';
import { availabilityGrid, latencyChart, ribbon } from './charts.ts';
import { formatDuration, host, ms, pct, relative, type Formatters } from './format.ts';
import { html, type SafeHtml } from './html.ts';
import { icon, plainPage } from './layout.ts';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

type Status = 'up' | 'down' | 'unknown';

function statusOf(state: StateRow | null): Status {
  return state?.status ?? 'unknown';
}

const STATUS_WORD: Record<Status, string> = { up: 'Up', down: 'Down', unknown: 'Not checked' };

function statusBadge(s: Status): SafeHtml {
  return html`<span class="status is-${s}"><span class="dot"></span>${STATUS_WORD[s]}</span>`;
}

export function fleetSentence(states: Array<{ site: SiteConfig; state: StateRow | null }>, now: number): SafeHtml {
  const down = states.filter((s) => statusOf(s.state) === 'down');
  const unknown = states.filter((s) => statusOf(s.state) === 'unknown');
  const total = states.length;
  if (down.length === 1) {
    const d = down[0];
    const since = d.state?.down_since ? ` · ${formatDuration(now - d.state.down_since)}` : '';
    return html`<span class="dot is-down"></span><span class="fleet-text"><b>${d.site.name} is down</b>${since}</span>`;
  }
  if (down.length > 1) {
    return html`<span class="dot is-down"></span><span class="fleet-text"><b>${down.length} sites down:</b> ${down.map((d) => d.site.name).join(', ')}</span>`;
  }
  if (unknown.length === total) {
    return html`<span class="dot is-unknown"></span><span class="fleet-text">Waiting for the first check</span>`;
  }
  if (unknown.length > 0) {
    return html`<span class="dot is-up"></span><span class="fleet-text"><b>${total - unknown.length} up</b> · ${unknown.length} not checked yet</span>`;
  }
  return html`<span class="dot is-up"></span><span class="fleet-text"><b>All ${total} sites up</b></span>`;
}

function rangeTabs(current: RangeSpec, base: string): SafeHtml {
  return html`<nav class="tabs" aria-label="Time range">${Object.values(RANGES).map(
    (r) =>
      html`<a href="${`${base}?range=${r.key}`}" ${r.key === current.key ? html`aria-current="page"` : ''}>${r.key}</a>`,
  )}</nav>`;
}

function legend(): SafeHtml {
  return html`<div class="legend" aria-label="Legend">
    <span><i style="background:var(--pass)"></i>Passed</span>
    <span><i style="background:var(--slow)"></i>Slow</span>
    <span><i style="background:var(--fail)"></i>Failed</span>
    <span><i style="background:var(--none)"></i>No data</span>
    <span>Taller tick = slower response</span>
  </div>`;
}

function uptimeClass(v: number | null): string {
  if (v === null) return '';
  return v < 0.99 ? 'uptime-low' : v < 0.999 ? 'uptime-mid' : '';
}

export interface Notices {
  lastRun: number | null;
  now: number;
  alertsConfigured: boolean;
  alertErrors: Array<{ site: SiteConfig; error: string }>;
  ranNow?: boolean;
}

function notices(n: Notices, fmt: Formatters): SafeHtml {
  const out: SafeHtml[] = [];
  if (n.ranNow) {
    out.push(html`<div class="banner" style="background:var(--pass-wash);color:var(--pass-ink);border-color:transparent" role="status"><p>Checks finished just now. The results are below.</p></div>`);
  }
  if (n.lastRun === null) {
    out.push(
      html`<div class="banner" role="status">${icon.alert}<p><b>No checks recorded yet.</b> The cron trigger runs every 5 minutes after deploy. Use <b>Run checks now</b> to start immediately.</p></div>`,
    );
  } else if (n.now - n.lastRun > 3 * CHECK_INTERVAL_MS) {
    out.push(
      html`<div class="banner is-fail" role="alert">${icon.alert}<p><b>The watcher hasn't run since ${fmt.dayTime(n.lastRun)}.</b> Statuses below are out of date and no alerts are going out. Check the Worker's cron trigger in the Cloudflare dashboard.</p></div>`,
    );
  }
  if (!n.alertsConfigured) {
    out.push(
      html`<div class="banner" role="status">${icon.alert}<p><b>Alerts are off.</b> Outages are recorded but nobody is told. Set <span class="mono">RESEND_API_KEY</span> and <span class="mono">ALERT_FROM</span> (or <span class="mono">ALERT_WEBHOOK_URL</span>), and add recipients to <span class="mono">src/config.ts</span> or <span class="mono">ALERT_EMAILS</span>.</p></div>`,
    );
  }
  for (const e of n.alertErrors) {
    out.push(
      html`<div class="banner is-fail" role="alert">${icon.alert}<p><b>The last alert for ${e.site.name} wasn't delivered:</b> ${e.error}</p></div>`,
    );
  }
  return html`${out}`;
}

function incidentsTable(rows: IncidentRow[], now: number, fmt: Formatters, showSite: boolean): SafeHtml {
  if (rows.length === 0) {
    return html`<div class="empty"><strong>No outages recorded</strong>When a site fails its checks, the outage shows here with its start, length and cause.</div>`;
  }
  return html`<div class="scroll-x"><table class="incidents">
    <thead><tr>
      ${showSite ? html`<th scope="col">Site</th>` : ''}
      <th scope="col">Started</th><th scope="col">Length</th><th scope="col" class="hide-sm">Cause</th><th scope="col" class="hide-sm">State</th>
    </tr></thead>
    <tbody>${rows.map((r) => {
      const site = findSite(r.site_id);
      const open = r.resolved_at === null;
      // On phones the Cause column is hidden; the cause moves under the first cell.
      const causeSm = r.cause ? html`<span class="sub show-sm cause-sm">${r.cause}</span>` : '';
      return html`<tr>
        ${showSite ? html`<td><a href="/sites/${r.site_id}">${site?.name ?? r.site_id}</a>${causeSm}</td>` : ''}
        <td style="white-space:nowrap">${fmt.dayTime(r.started_at)}${showSite ? '' : causeSm}</td>
        <td style="white-space:nowrap"><b>${formatDuration((r.resolved_at ?? now) - r.started_at)}</b>${open ? html`<span class="state-tag is-open show-sm">Ongoing</span>` : ''}</td>
        <td class="cause hide-sm">${r.cause ?? '—'}</td>
        <td class="hide-sm">${open
          ? html`<span class="state-tag is-open"><span class="dot is-down"></span>Ongoing</span>`
          : html`<span class="state-tag is-closed">Resolved</span>`}</td>
      </tr>`;
    })}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function overviewBody(
  data: { sites: SiteSummary[]; incidents: IncidentRow[] },
  range: RangeSpec,
  fmt: Formatters,
  n: Notices,
): SafeHtml {
  const rows = data.sites.map((s) => {
    const status = statusOf(s.state);
    const latest =
      status === 'down' && s.state?.down_since
        ? html`<span class="latest" style="color:var(--fail-ink)"><b>Down ${formatDuration(n.now - s.state.down_since)}</b><span class="sub cause-sub">${s.lastCheck?.error ?? ''}</span></span>`
        : s.lastCheck
          ? html`<span class="latest">${s.lastCheck.ok ? 'Passed' : 'Failed'} <span class="muted" data-ts="${s.lastCheck.ts}">${relative(s.lastCheck.ts, n.now)}</span><span class="sub">${s.incidents ? `${s.incidents} outage${s.incidents === 1 ? '' : 's'} · ${formatDuration(s.downtimeMs)} down` : `No outages in ${range.label}`}</span></span>`
          : html`<span class="latest muted">No checks yet</span>`;
    return html`<tr class="is-${status}" data-href="/sites/${s.site.id}?range=${range.key}">
      <td class="status-cell">${statusBadge(status)}</td>
      <td class="site-cell"><a class="site-name" href="/sites/${s.site.id}?range=${range.key}">${s.site.name}</a><span class="site-host">${host(s.site.url)}</span></td>
      <td class="ribbon-cell">${ribbon(
        s.buckets,
        range,
        fmt,
        s.stats.p95,
        status === 'down' && s.state?.down_since ? { since: s.state.down_since, now: n.now } : null,
      )}</td>
      <td class="uptime-cell num"><span class="big ${uptimeClass(s.stats.uptime)}">${pct(s.stats.uptime)}</span><span class="sub">uptime</span></td>
      <td class="resp-cell num"><span class="big">${ms(s.stats.p50)}</span><span class="sub">p95 ${ms(s.stats.p95)}</span></td>
      <td class="latest-cell">${latest}</td>
    </tr>`;
  });

  return html`
    ${notices(n, fmt)}
    <div class="toolbar">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <h2>Sites</h2>${rangeTabs(range, '/')}
      </div>
      ${legend()}
    </div>
    <div class="panel">
      <table class="sites">
        <caption class="sr-only">Status of every site over the last ${range.label}</caption>
        <thead><tr>
          <th scope="col" class="col-status">Status</th>
          <th scope="col" class="col-site">Site</th>
          <th scope="col" class="col-ribbon">Every check, last ${range.label}</th>
          <th scope="col" class="col-uptime num">Uptime</th>
          <th scope="col" class="col-resp num">Median response</th>
          <th scope="col" class="col-latest">Latest</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <section class="section">
      <div class="toolbar"><h2>Recent incidents</h2></div>
      <div class="panel">${incidentsTable(data.incidents, n.now, fmt, true)}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

export interface SitePageData {
  summary: SiteSummary;
  incidents: IncidentRow[];
  daily: Array<{ day: string; checks: number; ok: number; slow: number }>;
  log: { rows: CheckRow[]; nextBefore: number | null };
  failuresOnly: boolean;
  before: number | null;
}

function resultCell(r: CheckRow): SafeHtml {
  if (!r.ok) return html`<span class="res fail"><span class="dot is-down"></span>Failed</span>`;
  if (r.slow) return html`<span class="res slow"><span class="dot" style="background:var(--slow)"></span>Slow</span>`;
  return html`<span class="res ok"><span class="dot is-up"></span>Passed</span>`;
}

function target(code: number | null, t: number | null): SafeHtml {
  if (code === null && t === null) return html`<span class="muted">—</span>`;
  const bad = code === null || code < 200 || code >= 300;
  return html`<span class="code ${bad ? 'bad' : ''}">${code ?? 'no reply'}</span> <span class="muted">${ms(t)}</span>`;
}

export function siteBody(site: SiteConfig, d: SitePageData, range: RangeSpec, fmt: Formatters, n: Notices): SafeHtml {
  const s = d.summary;
  const status = statusOf(s.state);
  const base = `/sites/${site.id}`;
  const statusLine =
    status === 'down' && s.state?.down_since
      ? html`<span class="pill is-down"><span class="dot"></span>Down for ${formatDuration(n.now - s.state.down_since)}</span><span>since ${fmt.dayTime(s.state.down_since)}</span>`
      : html`<span class="pill is-${status}"><span class="dot"></span>${STATUS_WORD[status]}</span>${s.lastCheck ? html`<span>Last check <span data-ts="${s.lastCheck.ts}">${relative(s.lastCheck.ts, n.now)}</span></span>` : ''}`;

  const resolved = d.incidents.filter((i) => i.resolved_at !== null && i.resolved_at >= n.now - range.ms);
  const logQs = (extra: Record<string, string | number | null>) => {
    const p = new URLSearchParams({ range: range.key });
    if (d.failuresOnly) p.set('log', 'problems');
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) p.delete(k);
      else p.set(k, String(v));
    }
    return `${base}?${p.toString()}#log`;
  };

  return html`
    ${notices({ ...n, alertErrors: n.alertErrors.filter((e) => e.site.id === site.id) }, fmt)}
    <div class="crumbs"><a href="/?range=${range.key}">All sites</a> / ${site.name}</div>
    <div class="site-head">
      <div>
        <h1>${site.name}</h1>
        <div class="meta">
          ${statusLine}
          <a href="${site.url}" target="_blank" rel="noopener">${host(site.url)} ${icon.external}</a>
          <a href="https://github.com/${site.repo}" target="_blank" rel="noopener">${site.repo.split('/')[1]} ${icon.external}</a>
          ${site.healthPath ? html`<span class="mono">${site.healthPath}</span>` : ''}
        </div>
      </div>
      ${rangeTabs(range, base)}
    </div>

    <div class="panel">
      <dl class="stats">
        <div><dt>Uptime</dt><dd class="${uptimeClass(s.stats.uptime)}">${pct(s.stats.uptime)}</dd></div>
        <div><dt>Downtime</dt><dd>${s.downtimeMs ? formatDuration(s.downtimeMs) : '0m'}</dd></div>
        <div><dt>Outages</dt><dd>${s.incidents} ${resolved.length ? html`<small>avg ${formatDuration(resolved.reduce((a, i) => a + (i.resolved_at! - i.started_at), 0) / resolved.length)} to fix</small>` : ''}</dd></div>
        <div><dt>Median response</dt><dd>${ms(s.stats.p50)}</dd></div>
        <div><dt>p95 response</dt><dd>${ms(s.stats.p95)}</dd></div>
        <div><dt>Checks</dt><dd>${s.stats.checks.toLocaleString('en-CA')} ${s.stats.slowChecks ? html`<small>${s.stats.slowChecks} slow</small>` : ''}</dd></div>
      </dl>
    </div>

    <section class="section panel">
      <div class="panel-head">
        <div><h2>Response time</h2><p>Homepage, last ${range.label}${range.source === 'hourly' ? ' (hourly rollups)' : ''}</p></div>
        <div class="chart-key">
          <span><i style="background:var(--series);height:2px"></i>Median</span>
          ${range.source === 'hourly' ? html`<span><i style="background:var(--series);height:1px;opacity:.45"></i>p95</span>` : ''}
          <span><i style="background:var(--fail-band);box-shadow:inset 0 -2px 0 var(--fail)"></i>Failed checks</span>
        </div>
      </div>
      ${latencyChart(s.buckets, range, fmt)}
    </section>

    <div class="section split">
      <section class="panel">
        <div class="panel-head"><div><h2>Last 90 days</h2><p>One square per day</p></div>
          <div class="legend"><span><i style="background:var(--pass);width:10px;height:10px"></i>100%</span><span><i style="background:var(--slow);width:10px;height:10px"></i>99–99.9%</span><span><i style="background:var(--fail);width:10px;height:10px"></i>&lt;99%</span></div>
        </div>
        <div class="panel-body">${availabilityGrid(d.daily, fmt)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Outages</h2><p>${d.incidents.length ? `Latest ${d.incidents.length}` : ''}</p></div>
        ${incidentsTable(d.incidents, n.now, fmt, false)}
      </section>
    </div>

    <section class="section panel" id="log">
      <div class="panel-head">
        <div><h2>Check log</h2><p>Every run, newest first. Health and homepage are checked each time.</p></div>
        <nav class="tabs filters" aria-label="Log filter">
          <a href="${`${base}?range=${range.key}#log`}" ${!d.failuresOnly ? html`aria-current="page"` : ''}>All</a>
          <a href="${`${base}?range=${range.key}&log=problems#log`}" ${d.failuresOnly ? html`aria-current="page"` : ''}>Problems</a>
        </nav>
      </div>
      ${d.log.rows.length === 0
        ? html`<div class="empty"><strong>${d.failuresOnly ? 'No problems logged' : 'No checks logged yet'}</strong>${d.failuresOnly ? 'Failed, slow and retried checks appear here.' : 'The first check runs within 5 minutes of deploying.'}</div>`
        : html`<div class="scroll-x"><table class="log">
        <thead><tr><th scope="col">Time</th><th scope="col">Result</th><th scope="col">Health</th><th scope="col" class="hide-sm">Homepage</th><th scope="col" class="hide-sm">Detail</th></tr></thead>
        <tbody>${d.log.rows.map(
          (r) => html`<tr class="${!r.ok ? 'is-fail' : r.slow ? 'is-slow' : ''}">
            <td style="white-space:nowrap">${fmt.dayTime(r.ts)}</td>
            <td>${resultCell(r)}</td>
            <td style="white-space:nowrap">${target(r.health_code, r.health_ms)}</td>
            <td class="hide-sm" style="white-space:nowrap">${target(r.home_code, r.home_ms)}</td>
            <td class="cause hide-sm">${r.error ?? (r.retried ? 'Passed on retry' : '')}</td>
          </tr>`,
        )}</tbody>
      </table></div>`}
      ${d.before || d.log.nextBefore
        ? html`<div class="pager">
          ${d.before ? html`<a class="btn btn-quiet" href="${logQs({ before: null })}">Newest</a>` : html`<span></span>`}
          ${d.log.nextBefore ? html`<a class="btn btn-quiet" href="${logQs({ before: d.log.nextBefore })}">Older checks</a>` : html`<span>End of log</span>`}
        </div>`
        : ''}
    </section>`;
}

// ---------------------------------------------------------------------------
// Login / setup
// ---------------------------------------------------------------------------

export function loginPage(error: boolean, next: string): string {
  return plainPage(
    'Sign in · Pura Watcher',
    html`<main class="login">
      <form method="post" action="/login">
        <span style="color:var(--accent)">${icon.mark}</span>
        <h1>Pura Watcher</h1>
        <p>Uptime for VYTA, Aminocan, PURAMASS and Aminoex.</p>
        <input type="hidden" name="next" value="${next}">
        <label for="pw">Password</label>
        <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus ${error ? html`aria-invalid="true" aria-describedby="pw-err"` : ''}>
        ${error ? html`<p class="err" id="pw-err" role="alert">That password didn't match. Try again.</p>` : ''}
        <button class="btn btn-primary" type="submit">Sign in</button>
      </form>
    </main>`,
  );
}

export function setupPage(): string {
  return plainPage(
    'Set a password · Pura Watcher',
    html`<main class="login"><div class="card">
      <span style="color:var(--accent)">${icon.mark}</span>
      <h1>Set a dashboard password</h1>
      <p>The checks are running, but the dashboard stays locked until it has a password. From the project folder, run:</p>
      <p class="mono" style="background:var(--surface-2);padding:10px 12px;border-radius:6px;color:var(--ink)">npx wrangler secret put DASHBOARD_PASSWORD</p>
      <p style="margin:0">Then reload this page.</p>
    </div></main>`,
  );
}

export const ALL_SITES = SITES;
