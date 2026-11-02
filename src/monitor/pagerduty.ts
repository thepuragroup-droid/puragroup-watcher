/**
 * PagerDuty Events API v2. A site going down TRIGGERS an incident, which
 * PagerDuty turns into phone calls / SMS / push per your notification rules.
 * Recovery RESOLVES the same incident (matched by dedup_key), so it stops
 * calling on its own. Reminders aren't sent: PagerDuty re-notifies and
 * escalates by itself until someone acknowledges.
 *
 * https://developer.pagerduty.com/docs/events-api-v2/trigger-events/
 */
import type { SiteConfig } from '../config.ts';
import type { AlertKind, SiteStatus, TargetResult } from './logic.ts';

export const PAGERDUTY_URL = 'https://events.pagerduty.com/v2/enqueue';

/**
 * What to tell PagerDuty after a run, given the site's new state and the
 * incident PagerDuty has already accepted (if any).
 *
 *  - down, nothing accepted yet      -> trigger (retried every run until it lands)
 *  - down, this outage accepted      -> nothing (one incident = one call)
 *  - down, a stale earlier outage    -> resolve the old one, trigger the new one
 *  - up/unknown, something accepted  -> resolve (retried every run until it lands)
 */
export function pagerDutySync(
  siteId: string,
  status: SiteStatus,
  downSince: number | null,
  openKey: string | null,
): { trigger: string | null; resolve: string | null } {
  if (status === 'down' && downSince !== null) {
    const key = dedupKey(siteId, downSince);
    if (openKey === key) return { trigger: null, resolve: null };
    return { trigger: key, resolve: openKey };
  }
  return { trigger: null, resolve: openKey };
}

/** One stable key per outage, so the resolve closes the incident the trigger opened. */
export function dedupKey(siteId: string, downSince: number): string {
  return `puragroup-watcher/${siteId}/${downSince}`;
}

export interface PdInput {
  kind: AlertKind | 'test';
  site: SiteConfig;
  downSince: number | null;
  now: number;
  results: TargetResult[];
  dashboardUrl: string | null;
}

/** The Events API body, or null when PagerDuty shouldn't hear about this alert. */
export function pagerDutyEvent(routingKey: string, input: PdInput): Record<string, unknown> | null {
  const { kind, site } = input;
  if (kind === 'reminder') return null;
  const key =
    kind === 'test'
      ? `puragroup-watcher/test/${input.now}`
      : input.downSince !== null
        ? dedupKey(site.id, input.downSince)
        : null;
  if (!key) return null;

  if (kind === 'recovered') {
    return { routing_key: routingKey, event_action: 'resolve', dedup_key: key };
  }

  const host = new URL(site.url).host;
  const failed = input.results.filter((r) => !r.ok);
  const why = failed.map((r) => `${r.kind === 'health' ? 'health' : 'homepage'} ${r.error ?? 'failed'}`).join(', ');
  const summary =
    kind === 'test'
      ? 'TEST from Pura Watcher: site-down alerts reach you. Resolve this incident.'
      : `${site.name} (${host}) is DOWN${why ? `: ${why}` : ''}`;
  const base = input.dashboardUrl ? input.dashboardUrl.replace(/\/+$/, '') : null;
  const link = base ? (kind === 'test' ? `${base}/` : `${base}/sites/${site.id}`) : site.url;

  return {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: key,
    payload: {
      summary: summary.slice(0, 1024),
      source: host,
      // The test must take the same path as a real outage (high urgency = phone call).
      severity: 'critical',
      timestamp: new Date(input.downSince ?? input.now).toISOString(),
      component: kind === 'test' ? 'Pura Watcher (test)' : site.name,
      group: 'storefronts',
      class: 'uptime',
      custom_details: Object.fromEntries(
        input.results.map((r) => [
          r.kind === 'health' ? 'health_check' : 'homepage',
          r.ok ? `HTTP ${r.code} in ${r.ms} ms` : `${r.error ?? 'failed'} (${r.url})`,
        ]),
      ),
    },
    client: 'Pura Watcher',
    client_url: link,
    links: [{ href: link, text: kind === 'test' ? 'Pura Watcher dashboard' : `${site.name} on Pura Watcher` }],
  };
}

/**
 * Send one event, retrying once after 2 s on a network error, 429 or 5xx
 * (the phone call is the alert that matters most). Never throws; returns an
 * error string on failure.
 */
export async function sendPagerDuty(
  event: Record<string, unknown>,
  url: string = PAGERDUTY_URL,
  retryDelayMs = 2000,
): Promise<string | null> {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (res.ok) return null; // 202 Accepted
      last = `PagerDuty HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.status !== 429 && res.status < 500) return last; // bad key / payload: retrying won't help
    } catch (e) {
      last = `PagerDuty: ${(e as Error).message.replace(/;?\s*reference = \w+/i, '')}`;
    }
  }
  return last;
}
