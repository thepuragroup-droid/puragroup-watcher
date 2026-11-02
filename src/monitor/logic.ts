/**
 * Pure alerting rules — no I/O, unit-tested in test/logic.test.ts.
 *
 * Per site, a small state machine:
 *
 *   unknown/up --(failureThreshold failed runs)--> down  => DOWN alert
 *   down       --(still failing, reminderMinutes)-> down  => reminder
 *   down       --(one passing run)---------------> up    => RECOVERED alert
 *
 * Every failed target is retried once inside a run before the run counts as
 * failed, so one dropped request never pages anyone. A DOWN alert that failed
 * to send leaves lastAlertAt null, and the next failing run retries it.
 */

export type SiteStatus = 'up' | 'down' | 'unknown';
export type AlertKind = 'down' | 'reminder' | 'recovered';

export interface SiteState {
  status: SiteStatus;
  consecutiveFailures: number;
  failingSince: number | null;
  downSince: number | null;
  lastAlertAt: number | null;
}

export interface Decision {
  next: SiteState;
  alert: AlertKind | null;
  openIncident: boolean;
  closeIncident: boolean;
}

export const INITIAL_STATE: SiteState = {
  status: 'unknown',
  consecutiveFailures: 0,
  failingSince: null,
  downSince: null,
  lastAlertAt: null,
};

export function decide(
  prev: SiteState,
  ok: boolean,
  opts: { failureThreshold: number; reminderMinutes: number },
  now: number,
): Decision {
  const threshold = Math.max(1, Math.round(opts.failureThreshold) || 1);
  const reminderMs = Math.max(0, Math.round(opts.reminderMinutes) || 0) * 60_000;

  if (ok) {
    const wasDown = prev.status === 'down';
    return {
      next: { ...INITIAL_STATE, status: 'up' },
      alert: wasDown && prev.lastAlertAt !== null ? 'recovered' : null,
      openIncident: false,
      closeIncident: wasDown,
    };
  }

  const consecutiveFailures = prev.consecutiveFailures + 1;
  const failingSince = prev.failingSince ?? now;

  if (prev.status === 'down') {
    let alert: AlertKind | null = null;
    if (prev.lastAlertAt === null) alert = 'down';
    else if (reminderMs > 0 && now - prev.lastAlertAt >= reminderMs) alert = 'reminder';
    return {
      next: { ...prev, consecutiveFailures, failingSince },
      alert,
      openIncident: false,
      closeIncident: false,
    };
  }

  if (consecutiveFailures >= threshold) {
    return {
      next: {
        status: 'down',
        consecutiveFailures,
        failingSince,
        downSince: failingSince,
        lastAlertAt: null,
      },
      alert: 'down',
      openIncident: true,
      closeIncident: false,
    };
  }

  return {
    next: { ...prev, consecutiveFailures, failingSince },
    alert: null,
    openIncident: false,
    closeIncident: false,
  };
}

// ---------------------------------------------------------------------------
// Judging a response
// ---------------------------------------------------------------------------

export interface TargetResult {
  kind: 'health' | 'home';
  url: string;
  ok: boolean;
  code: number | null;
  ms: number;
  error: string | null;
}

/** Health endpoints must answer 200 with JSON `{ "status": "ok" }`. */
export function judgeHealth(code: number, body: string): string | null {
  if (code !== 200) return `HTTP ${code}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'Health endpoint did not return JSON';
  }
  const p = parsed as { status?: unknown; checks?: Record<string, unknown> };
  if (p?.status === 'ok') return null;
  const failing = p?.checks
    ? Object.entries(p.checks)
        .filter(([, v]) => v !== 'ok')
        .map(([k]) => k)
    : [];
  return failing.length ? `Health check failing: ${failing.join(', ')}` : 'Health check reported an error';
}

/** Homepages pass on any 2xx after redirects. */
export function judgeHome(code: number): string | null {
  return code >= 200 && code < 300 ? null : `HTTP ${code}`;
}

/** "Health: HTTP 503 · Homepage: timed out after 10s" */
export function describeFailure(results: TargetResult[]): string | null {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;
  return failed
    .map((r) => `${r.kind === 'health' ? 'Health' : 'Homepage'}: ${r.error ?? 'failed'}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Nearest-rank percentile of an unsorted list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** "45s", "4m", "1h 12m", "2d 3h". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
