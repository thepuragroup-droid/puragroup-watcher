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

test('test alerts get their own key and info severity', () => {
  const e = pagerDutyEvent('KEY', { ...base, kind: 'test', downSince: null }) as any;
  assert.equal(e.event_action, 'trigger');
  assert.match(e.dedup_key, /^puragroup-watcher\/test\//);
  assert.equal(e.payload.severity, 'info');
});

test('no outage start, no event', () => {
  assert.equal(pagerDutyEvent('KEY', { ...base, kind: 'down', downSince: null }), null);
});
