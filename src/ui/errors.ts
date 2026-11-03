/**
 * Server-error pages: /errors (every site, grouped and sorted), /errors/<fp>
 * (one error), and the summary panels on the overview and site pages.
 */
import { SITES, findSite, type SiteConfig } from '../config.ts';
import { ACTIVE, type DrainState, type ErrorStatus, type EventRow, type Group, type Severity, type SiteErrorCounts } from '../errors/store.ts';
import { UNMATCHED } from '../errors/normalize.ts';
import { relative, type Formatters } from './format.ts';
import { html, type SafeHtml } from './html.ts';
import { icon } from './layout.ts';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const STATUS_WORD: Record<ErrorStatus, string> = {
  open: 'Open',
  analyzed: 'Analyzed',
  fix_pending: 'Fix pending',
  fixed: 'Fixed',
  ignored: 'Ignored',
  regressed: 'Regressed',
};

const SEVERITY_WORD: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export const SORTS = {
  priority: 'Priority',
  recent: 'Most in 24h',
  total: 'Most overall',
  last: 'Last seen',
  new: 'Newest',
} as const;
export type SortKey = keyof typeof SORTS;

export const GROUPINGS = {
  site: 'Site',
  severity: 'Severity',
  route: 'Route',
  status: 'Status',
  none: 'No grouping',
} as const;
export type GroupKey = keyof typeof GROUPINGS;

export function siteName(id: string): string {
  if (id === UNMATCHED) return 'Unmatched project';
  return findSite(id)?.name ?? id;
}

function prioLevel(p: number): string {
  return p >= 75 ? 'crit' : p >= 50 ? 'high' : p >= 25 ? 'med' : 'low';
}

function priorityBadge(g: Group): SafeHtml {
  const title = g.scored ? `Claude's score: ${g.priority} of 100` : `Automatic estimate: ${g.priority} of 100. Not analysed yet.`;
  return html`<span class="prio is-${prioLevel(g.priority)} ${g.scored ? '' : 'is-est'}" title="${title}">${g.scored ? '' : '~'}${g.priority}</span>`;
}

function severityTag(s: Severity | null): SafeHtml | string {
  return s ? html`<span class="sev is-${s}">${SEVERITY_WORD[s]}</span>` : '';
}

export function statusTag(s: ErrorStatus): SafeHtml {
  return html`<span class="estatus is-${s}">${s === 'regressed' ? html`<span class="dot is-down"></span>` : ''}${STATUS_WORD[s]}</span>`;
}

// ---------------------------------------------------------------------------
// Sorting and grouping (pure, exported for tests)
// ---------------------------------------------------------------------------

export function sortGroups(rows: Group[], sort: SortKey): Group[] {
  const by: Record<SortKey, (a: Group, b: Group) => number> = {
    priority: (a, b) => b.priority - a.priority || b.last_24h - a.last_24h || b.last_seen_at - a.last_seen_at,
    recent: (a, b) => b.last_24h - a.last_24h || b.event_count - a.event_count,
    total: (a, b) => b.event_count - a.event_count,
    last: (a, b) => b.last_seen_at - a.last_seen_at,
    new: (a, b) => b.first_seen_at - a.first_seen_at,
  };
  return [...rows].sort(by[sort]);
}

const SEV_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

/** Sections in display order; rows keep their sort inside each. */
export function sectionize(rows: Group[], by: GroupKey): Array<{ key: string; label: string; rows: Group[] }> {
  if (by === 'none') return [{ key: 'all', label: '', rows }];
  const keyOf = (g: Group): [string, string] => {
    switch (by) {
      case 'site': return [g.site_id, siteName(g.site_id)];
      case 'severity': return g.severity ? [g.severity, SEVERITY_WORD[g.severity]] : ['none', 'Not analysed yet'];
      case 'route': return [g.route ?? '', g.route ?? 'No route (build or background)'];
      case 'status': return [g.status, STATUS_WORD[g.status]];
    }
  };
  const map = new Map<string, { key: string; label: string; rows: Group[] }>();
  for (const g of rows) {
    const [key, label] = keyOf(g);
    const sec = map.get(key) ?? { key, label, rows: [] };
    sec.rows.push(g);
    map.set(key, sec);
  }
  const list = [...map.values()];
  if (by === 'severity') return list.sort((a, b) => (SEV_RANK[b.label] ?? 0) - (SEV_RANK[a.label] ?? 0));
  if (by === 'site') {
    const order = (k: string) => (k === UNMATCHED ? 99 : SITES.findIndex((s) => s.id === k));
    return list.sort((a, b) => order(a.key) - order(b.key));
  }
  // Otherwise the busiest section first.
  const vol = (s: { rows: Group[] }) => s.rows.reduce((n, r) => n + r.last_24h, 0);
  return list.sort((a, b) => vol(b) - vol(a) || b.rows.length - a.rows.length);
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function groupTable(rows: Group[], now: number, fmt: Formatters, showSite: boolean): SafeHtml {
  return html`<div class="scroll-x"><table class="errors">
    <thead><tr>
      <th scope="col" class="col-prio">Priority</th>
      <th scope="col">Error</th>
      ${showSite ? html`<th scope="col" class="hide-md col-site">Site</th>` : ''}
      <th scope="col" class="num col-n">24h</th>
      <th scope="col" class="num hide-sm col-n">7d</th>
      <th scope="col" class="num hide-sm col-n">Total</th>
      <th scope="col" class="hide-sm col-seen">Last seen</th>
      <th scope="col" class="hide-sm col-estatus">Status</th>
    </tr></thead>
    <tbody>${rows.map(
      (g) => html`<tr class="${g.status === 'regressed' ? 'is-regressed' : ''}" data-href="/errors/${g.fingerprint}">
        <td class="col-prio">${priorityBadge(g)}</td>
        <td class="err-cell">
          <a class="err-title" href="/errors/${g.fingerprint}">${g.title}</a>
          <span class="err-meta">
            ${g.route ? html`<span class="mono">${g.route}</span>` : ''}
            ${g.source ? html`<span>${g.source}</span>` : ''}
            ${g.last_status_code !== null ? html`<span class="code ${g.last_status_code >= 500 ? 'bad' : ''}">${g.last_status_code}</span>` : ''}
            ${g.last_environment && g.last_environment !== 'production' ? html`<span>${g.last_environment}</span>` : ''}
            ${severityTag(g.severity)}
            ${showSite ? html`<span class="show-md">${siteName(g.site_id)}</span>` : ''}
            <span class="show-sm-inline">${statusTag(g.status)}</span>
          </span>
        </td>
        ${showSite ? html`<td class="hide-md" style="white-space:nowrap">${siteName(g.site_id)}</td>` : ''}
        <td class="num"><b>${g.last_24h}</b></td>
        <td class="num hide-sm">${g.last_7d}</td>
        <td class="num hide-sm muted">${g.event_count.toLocaleString('en-CA')}</td>
        <td class="hide-sm" style="white-space:nowrap" title="${fmt.full(g.last_seen_at)}"><span data-ts="${g.last_seen_at}">${relative(g.last_seen_at, now)}</span></td>
        <td class="hide-sm">${statusTag(g.status)}</td>
      </tr>`,
    )}</tbody>
  </table></div>`;
}

function drainLine(d: DrainState, now: number): SafeHtml {
  if (!d.last_received_at) return html`<span class="status is-unknown"><span class="dot"></span>Drain not connected yet</span>`;
  const stale = now - d.last_received_at > 6 * 3_600_000;
  return html`<span class="status ${stale ? 'is-unknown' : 'is-up'}"><span class="dot"></span>Drain ${stale ? 'quiet' : 'connected'}</span><span>last batch <span data-ts="${d.last_received_at}">${relative(d.last_received_at, now)}</span></span>`;
}

// ---------------------------------------------------------------------------
// /errors
// ---------------------------------------------------------------------------

export interface ErrorsQuery {
  site: string | null;
  status: string; // 'active' | 'all' | ErrorStatus
  env: string | null;
  q: string;
  sort: SortKey;
  group: GroupKey;
}

export function parseErrorsQuery(p: URLSearchParams): ErrorsQuery {
  const sort = p.get('sort') as SortKey;
  const group = p.get('group') as GroupKey;
  const status = p.get('status') ?? 'active';
  const site = p.get('site');
  return {
    site: site && (site === UNMATCHED || findSite(site)) ? site : null,
    status: ['active', 'all', ...Object.keys(STATUS_WORD)].includes(status) ? status : 'active',
    env: p.get('env') === 'production' || p.get('env') === 'preview' ? p.get('env') : null,
    q: (p.get('q') ?? '').slice(0, 100),
    sort: sort in SORTS ? sort : 'priority',
    group: group in GROUPINGS ? group : 'site',
  };
}

function qs(q: ErrorsQuery, over: Partial<ErrorsQuery>): string {
  const m = { ...q, ...over };
  const p = new URLSearchParams();
  if (m.site) p.set('site', m.site);
  if (m.status !== 'active') p.set('status', m.status);
  if (m.env) p.set('env', m.env);
  if (m.q) p.set('q', m.q);
  if (m.sort !== 'priority') p.set('sort', m.sort);
  if (m.group !== 'site') p.set('group', m.group);
  const s = p.toString();
  return `/errors${s ? `?${s}` : ''}`;
}

function select(name: string, label: string, value: string, options: Array<[string, string]>): SafeHtml {
  return html`<label class="field"><span>${label}</span><select name="${name}">${options.map(
    ([v, l]) => html`<option value="${v}" ${v === value ? html`selected` : ''}>${l}</option>`,
  )}</select></label>`;
}

export interface ErrorsPageData {
  groups: Group[];
  statusCounts: Record<string, number>;
  counts: Map<string, SiteErrorCounts>;
  drain: DrainState;
  unmatched: Array<{ project_id: string | null; host: string | null; n: number; last: number }>;
}

export function errorsBody(d: ErrorsPageData, q: ErrorsQuery, now: number, fmt: Formatters, banners: SafeHtml): SafeHtml {
  const notices: SafeHtml[] = [];
  if (!d.drain.last_received_at) {
    notices.push(
      html`<div class="banner" role="status">${icon.alert}<p><b>No logs received yet.</b> Errors appear here once a Vercel Log Drain points at <span class="mono">/ingest/vercel</span>. See README → Server errors for the setup.</p></div>`,
    );
  }
  if (d.drain.last_rejected_at && (!d.drain.last_received_at || d.drain.last_rejected_at > d.drain.last_received_at)) {
    notices.push(
      html`<div class="banner is-fail" role="alert">${icon.alert}<p><b>The drain's last delivery was refused ${relative(d.drain.last_rejected_at, now)}:</b> ${d.drain.last_rejected_reason ?? 'unknown reason'}. Check <span class="mono">VERCEL_DRAIN_SECRETS</span>.</p></div>`,
    );
  }
  if (d.unmatched.length) {
    notices.push(
      html`<div class="banner" role="status">${icon.alert}<p><b>Errors from ${d.unmatched.length === 1 ? 'a Vercel project' : `${d.unmatched.length} Vercel projects`} that no site claims.</b> Add the id to that site's <span class="mono">vercelProjectIds</span> in <span class="mono">src/config.ts</span>: ${d.unmatched.map(
        (u, i) => html`${i ? ', ' : ''}<span class="mono">${u.project_id ?? 'no project id'}</span>${u.host ? ` (${u.host})` : ''}`,
      )}.</p></div>`,
    );
  }

  const sorted = sortGroups(d.groups, q.sort);
  const sections = sectionize(sorted, q.group);
  const statusTabs: Array<[string, string]> = [
    ['active', 'Active'],
    ['regressed', 'Regressed'],
    ['open', 'Open'],
    ['analyzed', 'Analyzed'],
    ['fix_pending', 'Fix pending'],
    ['fixed', 'Fixed'],
    ['ignored', 'Ignored'],
    ['all', 'All'],
  ];
  const siteCells = [...SITES.map((s) => s.id), ...(d.counts.has(UNMATCHED) ? [UNMATCHED] : [])];

  return html`
    ${banners}${notices}
    <div class="site-head">
      <div>
        <h1>Server errors</h1>
        <div class="meta">${drainLine(d.drain, now)}<span>From Vercel, grouped by cause. Raw occurrences kept 30 days.</span></div>
      </div>
    </div>

    <div class="panel">
      <dl class="stats err-sites" style="grid-template-columns:repeat(${siteCells.length},minmax(0,1fr))">${siteCells.map((id) => {
        const c = d.counts.get(id);
        return html`<div><dt><a href="${qs(q, { site: id })}">${siteName(id)}</a></dt><dd>${c?.active ?? 0} <small>active · ${c?.events_24h ?? 0} in 24h${c?.critical ? html` · <span style="color:var(--fail-ink)">${c.critical} critical</span>` : ''}${c?.regressed ? html` · <span style="color:var(--fail-ink)">${c.regressed} regressed</span>` : ''}</small></dd></div>`;
      })}</dl>
    </div>

    <section class="section">
      <div class="toolbar">
        <nav class="tabs status-tabs" aria-label="Status">${statusTabs.map(
          ([k, l]) => html`<a href="${qs(q, { status: k })}" ${q.status === k ? html`aria-current="page"` : ''}>${l}${d.statusCounts[k] ? html` <span class="tab-n">${d.statusCounts[k]}</span>` : ''}</a>`,
        )}</nav>
      </div>
      <form class="filter-bar panel" method="get" action="/errors" data-autosubmit>
        ${q.status !== 'active' ? html`<input type="hidden" name="status" value="${q.status}">` : ''}
        <label class="field grow"><span>Search</span><input type="search" name="q" value="${q.q}" placeholder="Message, route, fingerprint, cause"></label>
        ${select('site', 'Site', q.site ?? '', [['', 'All sites'], ...SITES.map((s): [string, string] => [s.id, s.name]), ...(d.counts.has(UNMATCHED) ? [[UNMATCHED, 'Unmatched'] as [string, string]] : [])])}
        ${select('env', 'Environment', q.env ?? '', [['', 'All'], ['production', 'Production'], ['preview', 'Preview']])}
        ${select('sort', 'Sort by', q.sort, Object.entries(SORTS))}
        ${select('group', 'Group by', q.group, Object.entries(GROUPINGS))}
        <button class="btn btn-quiet" type="submit">Apply</button>
      </form>
    </section>

    ${sorted.length === 0
      ? html`<div class="section panel"><div class="empty"><strong>${d.drain.last_received_at ? (q.q || q.site || q.env || q.status !== 'active' ? 'Nothing matches these filters' : 'No active errors') : 'No errors yet'}</strong>${d.drain.last_received_at ? 'New errors appear here within seconds of happening.' : 'Errors appear here once the Vercel drain is connected.'}</div></div>`
      : sections.map(
          (sec) => html`<section class="section panel">
            ${sec.label ? html`<div class="panel-head"><h2>${sec.label}</h2><p>${sec.rows.length} error${sec.rows.length === 1 ? '' : 's'} · ${sec.rows.reduce((n, r) => n + r.last_24h, 0)} in 24h</p></div>` : ''}
            ${groupTable(sec.rows, now, fmt, q.group !== 'site')}
          </section>`,
        )}
    <p class="muted foot-note">Priority is Claude's score once an error is analysed, otherwise an automatic estimate shown as ~NN. In Claude Code, <span class="mono">/vercel-errors-triage</span> analyses them and <span class="mono">/vercel-errors-fix</span> fixes them.</p>`;
}

// ---------------------------------------------------------------------------
// /errors/<fp>
// ---------------------------------------------------------------------------

function copyable(text: string): SafeHtml {
  return html`<span class="copy"><span class="mono">${text}</span><button class="btn btn-quiet btn-sm" type="button" data-copy="${text}">Copy</button></span>`;
}

export function errorDetailBody(g: Group, events: EventRow[], now: number, fmt: Formatters, banners: SafeHtml, saved: boolean): SafeHtml {
  const site = findSite(g.site_id);
  const actions: Array<[ErrorStatus, string]> = (
    [
      ['fixed', 'Mark fixed'],
      ['ignored', 'Ignore'],
      ['open', 'Re-open'],
    ] as Array<[ErrorStatus, string]>
  ).filter(([s]) => s !== g.status && !(s === 'open' && ACTIVE.includes(g.status)));
  const latest = events[0]?.message ?? g.sample_message;

  return html`
    ${banners}
    ${saved ? html`<div class="banner" style="background:var(--pass-wash);color:var(--pass-ink);border-color:transparent" role="status"><p>Status updated.</p></div>` : ''}
    <div class="crumbs"><a href="/errors">Server errors</a> / <a href="/errors?site=${g.site_id}">${siteName(g.site_id)}</a></div>
    <div class="site-head">
      <div style="min-width:0">
        <h1 class="err-h1">${g.title}</h1>
        <div class="meta">
          ${statusTag(g.status)} ${severityTag(g.severity)}
          ${g.route ? html`<span class="mono">${g.route}</span>` : ''}
          ${g.source ? html`<span>${g.source}</span>` : ''}
          ${g.last_status_code !== null ? html`<span class="code ${g.last_status_code >= 500 ? 'bad' : ''}">HTTP ${g.last_status_code}</span>` : ''}
          ${g.last_environment ? html`<span>${g.last_environment}</span>` : ''}
          ${site ? html`<a href="https://github.com/${site.repo}" target="_blank" rel="noopener">${site.repo.split('/')[1]} ${icon.external}</a>` : ''}
        </div>
      </div>
    </div>

    <div class="panel">
      <dl class="stats">
        <div><dt>${g.scored ? 'Score' : 'Estimated priority'}</dt><dd>${priorityBadge(g)}</dd></div>
        <div><dt>Last 24h</dt><dd>${g.last_24h}</dd></div>
        <div><dt>Last 7 days</dt><dd>${g.last_7d}</dd></div>
        <div><dt>All time</dt><dd>${g.event_count.toLocaleString('en-CA')}</dd></div>
        <div><dt>First seen</dt><dd class="dd-time">${fmt.dayTime(g.first_seen_at)}</dd></div>
        <div><dt>Last seen</dt><dd class="dd-time"><span data-ts="${g.last_seen_at}">${relative(g.last_seen_at, now)}</span></dd></div>
      </dl>
    </div>

    <div class="section split split-even">
      <section class="panel">
        <div class="panel-head"><div><h2>Root cause</h2><p>${g.analyzed_at ? `Analysed ${fmt.dayTime(g.analyzed_at)}${g.confidence ? ` · ${g.confidence} confidence` : ''}${g.category ? ` · ${g.category}` : ''}` : 'Not analysed yet'}</p></div></div>
        <div class="panel-body prose">${g.root_cause
          ? html`<p>${g.root_cause}</p>${g.affected_files.length ? html`<p class="files">${g.affected_files.map((f) => html`<span class="mono">${f}</span>`)}</p>` : ''}`
          : html`<p class="muted">In Claude Code, run the command below to trace this to the code, score it and propose a fix.</p>${copyable(`/vercel-errors-triage ${g.fingerprint}`)}`}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Proposed fix</h2><p>${g.fix_ref ? 'Fix in progress' : g.solution ? 'From the triage' : '—'}</p></div></div>
        <div class="panel-body prose">
          ${g.solution ? html`<p>${g.solution}</p>` : html`<p class="muted">Appears here after the triage.</p>`}
          ${g.fix_ref ? html`<p><b>Fix:</b> ${/^https?:\/\//.test(g.fix_ref) ? html`<a href="${g.fix_ref}" target="_blank" rel="noopener">${g.fix_ref} ${icon.external}</a>` : html`<span class="mono">${g.fix_ref}</span>`}</p>` : ''}
          ${g.status_note ? html`<p><b>Note:</b> ${g.status_note}</p>` : ''}
          ${g.solution && !g.fix_ref ? copyable(`/vercel-errors-fix ${g.fingerprint}`) : ''}
        </div>
      </section>
    </div>

    <section class="section panel">
      <div class="panel-head">
        <div><h2>Status</h2><p>${g.status === 'fixed' && g.fixed_at ? `Marked fixed ${fmt.dayTime(g.fixed_at)}. If it happens again it becomes Regressed.` : 'Mark it fixed once the fix is live, or ignore known noise.'}</p></div>
        <div class="site-actions">${actions.map(
          ([s, label]) => html`<form method="post" action="/errors/${g.fingerprint}/status"><input type="hidden" name="status" value="${s}"><button class="btn ${s === 'fixed' ? 'btn-primary' : 'btn-quiet'}" type="submit">${label}</button></form>`,
        )}</div>
      </div>
      <div class="panel-body"><span class="muted">Fingerprint</span> ${copyable(g.fingerprint)}</div>
    </section>

    ${latest
      ? html`<section class="section panel"><div class="panel-head"><div><h2>Latest message</h2><p>As logged. Treat as untrusted text.</p></div></div><pre class="message">${latest}</pre></section>`
      : ''}

    <section class="section panel">
      <div class="panel-head"><div><h2>Occurrences</h2><p>${events.length ? `Latest ${events.length}, newest first` : 'None in the last 30 days'}</p></div></div>
      ${events.length
        ? html`<div class="scroll-x"><table class="log">
          <thead><tr><th scope="col">Time</th><th scope="col">Request</th><th scope="col">Status</th><th scope="col" class="hide-sm">Environment</th><th scope="col" class="hide-sm">Region</th><th scope="col" class="hide-sm">Deployment</th></tr></thead>
          <tbody>${events.map(
            (e) => html`<tr>
              <td style="white-space:nowrap">${fmt.dayTime(e.ts)}</td>
              <td class="mono" style="overflow-wrap:anywhere">${[e.method, e.path].filter(Boolean).join(' ') || '—'}</td>
              <td>${e.status_code !== null ? html`<span class="code ${e.status_code >= 500 ? 'bad' : ''}">${e.status_code}</span>` : html`<span class="muted">—</span>`}</td>
              <td class="hide-sm">${e.environment ?? '—'}</td>
              <td class="hide-sm">${e.region ?? '—'}</td>
              <td class="hide-sm mono">${e.deployment_id ?? '—'}</td>
            </tr>`,
          )}</tbody></table></div>`
        : html`<div class="empty"><strong>No recent occurrences</strong>Occurrences older than 30 days are pruned; the counts above are kept.</div>`}
    </section>`;
}

// ---------------------------------------------------------------------------
// Overview + site page panels
// ---------------------------------------------------------------------------

export function overviewErrorsPanel(counts: Map<string, SiteErrorCounts>, top: Map<string, Group>, drain: DrainState, now: number): SafeHtml {
  const ids = [...SITES.map((s) => s.id), ...(counts.has(UNMATCHED) ? [UNMATCHED] : [])];
  return html`<section class="section">
    <div class="toolbar"><h2>Server errors</h2><div class="legend">${drainLine(drain, now)}<a href="/errors">All errors</a></div></div>
    <div class="panel">${!drain.last_received_at
      ? html`<div class="empty"><strong>Not connected yet</strong>Point a Vercel Log Drain at <span class="mono">/ingest/vercel</span> (README → Server errors) and each site's errors show here.</div>`
      : html`<div class="scroll-x"><table class="errors">
        <thead><tr><th scope="col">Site</th><th scope="col" class="num">Active</th><th scope="col" class="num hide-sm">Critical</th><th scope="col" class="num hide-sm">Not analysed</th><th scope="col" class="num">Events 24h</th><th scope="col" class="hide-sm">Top error</th></tr></thead>
        <tbody>${ids.map((id) => {
          const c = counts.get(id);
          const t = top.get(id);
          return html`<tr data-href="/errors?site=${id}">
            <td><a class="site-name" href="/errors?site=${id}">${siteName(id)}</a></td>
            <td class="num"><b>${c?.active ?? 0}</b></td>
            <td class="num hide-sm" ${c?.critical ? html`style="color:var(--fail-ink);font-weight:650"` : ''}>${c?.critical ?? 0}</td>
            <td class="num hide-sm">${c?.unanalyzed ?? 0}</td>
            <td class="num">${c?.events_24h ?? 0}</td>
            <td class="hide-sm err-cell">${t ? html`${priorityBadge(t)} <a class="err-title inline" href="/errors/${t.fingerprint}">${t.title}</a>` : html`<span class="muted">None</span>`}</td>
          </tr>`;
        })}</tbody></table></div>`}</div>
  </section>`;
}

export function siteErrorsPanel(site: SiteConfig, groups: Group[], c: SiteErrorCounts | undefined, drain: DrainState, now: number, fmt: Formatters): SafeHtml {
  const top = sortGroups(groups, 'priority').slice(0, 5);
  return html`<section class="section panel">
    <div class="panel-head">
      <div><h2>Server errors</h2><p>${c ? `${c.active} active · ${c.events_24h} in 24h` : 'From Vercel'}</p></div>
      <a class="btn btn-quiet" href="/errors?site=${site.id}">All errors for ${site.name}</a>
    </div>
    ${top.length
      ? groupTable(top, now, fmt, false)
      : html`<div class="empty"><strong>${drain.last_received_at ? 'No active errors' : 'Not connected yet'}</strong>${drain.last_received_at ? 'Server errors from Vercel appear here within seconds.' : 'See README → Server errors to connect the Vercel drain.'}</div>`}
  </section>`;
}
