import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupKey, pagerDutyEvent } from '../src/monitor/pagerduty.ts';
import type { SiteConfig } from '../src/config.ts';

const site: SiteConfig = {
  id: 'aminoex', name: 'Aminoex', url: 'https://aminoex.com', repo: 'x/aminoex',
  healthPath: '/api/health', slowMs: 3000, alertEmails: [], failureThreshold: 1, reminderMinutes: 60,
};
const downSince = Date.UTC(2026, 10, 2, 12, 0);
const base = { site, downSince, now: downSince + 5 * 60_000, dashboardUrl: 'https://watch.example.com/', results: [
  { kind: 'health' as const, url: 'https://aminoex.com/api/health', ok: false, code: 503, ms: 120, error: 'HTTP 503' },
  { kind: 'home' as const, url: 'https://aminoex.com/', ok: true, code: 200, ms: 400, error: null },
] };

test('down triggers a critical incident keyed to the outage', () => {
  const e = pagerDutyEvent('KEY', { ...base, kind: 'down' }) as any;
  assert.equal(e.routing_key, 'KEY');
  assert.equal(e.event_action, 'trigger');
  assert.equal(e.dedup_key, dedupKey('aminoex', downSince));
  assert.equal(e.payload.severity, 'critical');
  assert.equal(e.payload.source, 'aminoex.com');
  assert.match(e.payload.summary, /^Aminoex \(aminoex\.com\) is DOWN: health HTTP 503$/);
  assert.equal(e.payload.timestamp, new Date(downSince).toISOString());
  assert.equal(e.links[0].href, 'https://watch.example.com/sites/aminoex');
});

test('recovery resolves the same incident', () => {
  const e = pagerDutyEvent('KEY', { ...base, kind: 'recovered' }) as any;
  assert.deepEqual(e, { routing_key: 'KEY', event_action: 'resolve', dedup_key: dedupKey('aminoex', downSince) });
});

test('reminders are left to PagerDuty', () => {
  assert.equal(pagerDutyEvent('KEY', { ...base, kind: 'reminder' }), null);
});

test('test alerts get their own key and page like a real outage', () => {
  const e = pagerDutyEvent('KEY', { ...base, kind: 'test', downSince: null }) as any;
  assert.equal(e.event_action, 'trigger');
  assert.match(e.dedup_key, /^puragroup-watcher\/test\//);
  assert.equal(e.payload.severity, 'critical');
});

test('no outage start, no event', () => {
  assert.equal(pagerDutyEvent('KEY', { ...base, kind: 'down', downSince: null }), null);
});

import { pagerDutySync } from '../src/monitor/pagerduty.ts';

/**
 * Simulate cron runs: each step is the site's state after the run and
 * whether PagerDuty accepted what we sent. Returns every event sent.
 */
function simulate(steps: Array<{ status: 'up' | 'down'; downSince: number | null; pdUp: boolean }>) {
  let openKey: string | null = null;
  const sent: string[] = [];
  for (const s of steps) {
    const sync = pagerDutySync('aminoex', s.status, s.downSince, openKey);
    if (sync.resolve) {
      sent.push(`resolve ${sync.resolve}${s.pdUp ? '' : ' (failed)'}`);
      if (s.pdUp) openKey = null;
    }
    if (sync.trigger) {
      sent.push(`trigger ${sync.trigger}${s.pdUp ? '' : ' (failed)'}`);
      if (s.pdUp) openKey = sync.trigger;
    }
  }
  return sent;
}

const T = Date.UTC(2026, 10, 2, 12, 0);
const k = (t: number) => dedupKey('aminoex', t);

test('down for an hour: exactly one trigger (one call), one resolve on recovery', () => {
  const steps = [
    { status: 'up' as const, downSince: null, pdUp: true },
    ...Array.from({ length: 12 }, () => ({ status: 'down' as const, downSince: T, pdUp: true })),
    { status: 'up' as const, downSince: null, pdUp: true },
    { status: 'up' as const, downSince: null, pdUp: true },
  ];
  assert.deepEqual(simulate(steps), [`trigger ${k(T)}`, `resolve ${k(T)}`]);
});

test('PagerDuty unreachable at first: trigger retried each run until it lands, then never again', () => {
  const steps = [
    { status: 'down' as const, downSince: T, pdUp: false },
    { status: 'down' as const, downSince: T, pdUp: false },
    { status: 'down' as const, downSince: T, pdUp: true },
    { status: 'down' as const, downSince: T, pdUp: true },
    { status: 'down' as const, downSince: T, pdUp: true },
  ];
  assert.deepEqual(simulate(steps), [
    `trigger ${k(T)} (failed)`,
    `trigger ${k(T)} (failed)`,
    `trigger ${k(T)}`,
  ]);
});

test('resolve that fails is retried on the next run', () => {
  const steps = [
    { status: 'down' as const, downSince: T, pdUp: true },
    { status: 'up' as const, downSince: null, pdUp: false },
    { status: 'up' as const, downSince: null, pdUp: true },
    { status: 'up' as const, downSince: null, pdUp: true },
  ];
  assert.deepEqual(simulate(steps), [`trigger ${k(T)}`, `resolve ${k(T)} (failed)`, `resolve ${k(T)}`]);
});

test('a second, separate outage is a second incident; a stale one is closed first', () => {
  const T2 = T + 3_600_000;
  // recovery's resolve failed, then the site went down again
  const steps = [
    { status: 'down' as const, downSince: T, pdUp: true },
    { status: 'up' as const, downSince: null, pdUp: false },
    { status: 'down' as const, downSince: T2, pdUp: true },
    { status: 'down' as const, downSince: T2, pdUp: true },
  ];
  assert.deepEqual(simulate(steps), [
    `trigger ${k(T)}`,
    `resolve ${k(T)} (failed)`,
    `resolve ${k(T)}`,
    `trigger ${k(T2)}`,
  ]);
});
