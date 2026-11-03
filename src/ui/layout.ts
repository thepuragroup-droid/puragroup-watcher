import { CLIENT_JS } from './client.ts';
import { html, raw, type SafeHtml } from './html.ts';
import { CSS } from './styles.ts';

/** Authored icons, one stroke weight. */
export const icon = {
  mark: raw(
    `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="5" fill="currentColor" opacity=".14"/><rect x="5" y="9" width="2" height="8" rx="1" fill="currentColor"/><rect x="10" y="5" width="2" height="12" rx="1" fill="currentColor"/><rect x="15" y="11" width="2" height="6" rx="1" fill="currentColor"/></svg>`,
  ),
  run: raw(
    `<svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>`,
  ),
  alert: raw(
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18.5A2 2 0 0 0 3.5 21.5h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  ),
  external: raw(
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
  ),
};

export interface ShellOptions {
  title: string;
  timeZone: string;
  fleet: SafeHtml;
  lastRun: number | null;
  refreshSeconds?: number;
  returnTo: string;
  body: SafeHtml;
  showSignOut: boolean;
  /** Which top-level section is open (for the nav). */
  current?: 'uptime' | 'errors';
}

export function shell(o: ShellOptions): string {
  return `<!doctype html>${html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${o.title}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><rect width="22" height="22" rx="5" fill="#123A35"/><rect x="5" y="9" width="2" height="8" rx="1" fill="#EAF2EF"/><rect x="10" y="5" width="2" height="12" rx="1" fill="#EAF2EF"/><rect x="15" y="11" width="2" height="6" rx="1" fill="#EAF2EF"/></svg>')}">
<style>${raw(CSS)}</style>
</head>
<body data-tz="${o.timeZone}" ${o.refreshSeconds ? raw(`data-refresh="${o.refreshSeconds}"`) : ''}>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/">${icon.mark}<span>Pura Watcher</span></a>
    <nav class="topnav" aria-label="Sections">
      <a href="/" ${o.current !== 'errors' ? html`aria-current="page"` : ''}>Uptime</a>
      <a href="/errors" ${o.current === 'errors' ? html`aria-current="page"` : ''}>Errors</a>
    </nav>
    <div class="fleet" aria-live="polite">${o.fleet}</div>
    <div class="topbar-meta">
      <span class="last-run">Checked <span data-ts="${o.lastRun ?? ''}">${o.lastRun ? relativeText(o.lastRun) : 'never'}</span></span>
      <form method="post" action="/run" data-run>
        <input type="hidden" name="back" value="${o.returnTo}">
        <button class="btn btn-shell" type="submit">${icon.run}<span class="spin" aria-hidden="true"></span><span class="btn-label">Run checks now</span></button>
      </form>
      ${o.showSignOut ? html`<form method="post" action="/logout"><button class="btn btn-shell" type="submit" style="padding:0 10px">Sign out</button></form>` : ''}
    </div>
  </div>
</header>
<main class="container">${o.body}</main>
<script>${raw(CLIENT_JS)}</script>
</body>
</html>`}`;
}

function relativeText(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function plainPage(title: string, body: SafeHtml): string {
  return `<!doctype html>${html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title><style>${raw(CSS)}</style></head><body>${body}</body></html>`}`;
}
