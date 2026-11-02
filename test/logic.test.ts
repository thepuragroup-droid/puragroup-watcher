import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  describeFailure,
  formatDuration,
  INITIAL_STATE,
  judgeHealth,
  judgeHome,
  percentile,
  type SiteState,
} from '../src/monitor/logic.ts';
import { buildAlert, recipientsFor } from '../src/monitor/alerts.ts';
import type { SiteConfig } from '../src/config.ts';

const MIN = 60_000;
const t0 = Date.UTC(2026, 10, 2, 12, 0);
const opts = { failureThreshold: 1, reminderMinutes: 60 };

/** Feed a sequence of run results (5 min apart), simulating delivered alerts. */
function run(seq: boolean[], o = opts) {
  let s: SiteState = INITIAL_STATE;
  const alerts: (string | null)[] = [];
  seq.forEach((ok, i) => {
    const now = t0 + i * 5 * MIN;
    const d = decide(s, ok, o, now);
    alerts.push(d.alert);
    s = d.next;
    if (d.alert === 'down' || d.alert === 'reminder') s = { ...s, lastAlertAt: now };
  });
  return { s, alerts };
}

test('first failed run (already retried) declares an outage at threshold 1', () => {
  const { alerts, s } = run([true, false]);
  assert.deepEqual(alerts, [null, 'down']);
  assert.equal(s.status, 'down');
  assert.equal(s.downSince, t0 + 5 * MIN);
});

test('threshold 2 ignores a single failed run', () => {
  const { alerts, s } = run([true, false, true], { ...opts, failureThreshold: 2 });
  assert.deepEqual(alerts, [null, null, null]);
  assert.equal(s.status, 'up');
});

test('outage start is the first failure, not the detection', () => {
  const { s } = run([true, false, false], { ...opts, failureThreshold: 2 });
  assert.equal(s.downSince, t0 + 5 * MIN);
});

test('one reminder per hour while down', () => {
  // down at run 1, then 25 more failing runs = 125 minutes
  const { alerts } = run([true, ...Array(26).fill(false)]);
  assert.deepEqual(
    alerts.map((a, i) => (a ? `${i}:${a}` : null)).filter(Boolean),
    ['1:down', '13:reminder', '25:reminder'],
  );
});

test('recovery alerts once and resets', () => {
  const { alerts, s } = run([true, false, false, true, true]);
  assert.deepEqual(alerts, [null, 'down', null, 'recovered', null]);
  assert.equal(s.status, 'up');
  assert.equal(s.lastAlertAt, null);
});

test('undelivered DOWN alert is retried, and no recovery mail without one', () => {
  let s = decide({ ...INITIAL_STATE, status: 'up' }, false, opts, t0);
  assert.equal(s.alert, 'down');
  const retry = decide(s.next, false, opts, t0 + 5 * MIN); // lastAlertAt still null
  assert.equal(retry.alert, 'down');
  assert.equal(retry.openIncident, false);
  const back = decide(retry.next, true, opts, t0 + 10 * MIN);
  assert.equal(back.alert, null);
  assert.equal(back.closeIncident, true);
});

test('judgeHealth', () => {
  assert.equal(judgeHealth(200, '{"status":"ok"}'), null);
  assert.equal(judgeHealth(503, '{"status":"error"}'), 'HTTP 503');
  assert.equal(judgeHealth(200, '{"status":"error","checks":{"app":"ok","database":"error"}}'), 'Health check failing: database');
  assert.equal(judgeHealth(200, '<!doctype html>'), 'Health endpoint did not return JSON');
  assert.equal(judgeHealth(404, ''), 'HTTP 404');
});

test('judgeHome and describeFailure', () => {
  assert.equal(judgeHome(200), null);
  assert.equal(judgeHome(502), 'HTTP 502');
  assert.equal(
    describeFailure([
      { kind: 'health', url: 'x', ok: false, code: 503, ms: 1, error: 'HTTP 503' },
      { kind: 'home', url: 'y', ok: true, code: 200, ms: 1, error: null },
    ]),
    'Health: HTTP 503',
  );
  assert.equal(describeFailure([]), null);
});

test('percentile and formatDuration', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(formatDuration(30_000), '30s');
  assert.equal(formatDuration(65 * MIN), '1h 5m');
  assert.equal(formatDuration(49 * 60 * MIN), '2d 1h');
});

const site: SiteConfig = {
  id: 'aminoex',
  name: 'Aminoex',
  url: 'https://aminoex.com',
  repo: 'x/aminoex',
  healthPath: '/api/health',
  slowMs: 3000,
  alertEmails: ['Ops@Example.com'],
  failureThreshold: 1,
  reminderMinutes: 60,
};

test('recipients merge per-site and global, de-duplicated', () => {
  const env = { ALERT_EMAILS: 'ops@example.com, boss@example.com' } as never;
  assert.deepEqual(recipientsFor(site, env), ['ops@example.com', 'boss@example.com']);
});

test('alert email content and escaping', () => {
  const a = buildAlert({
    kind: 'down',
    site,
    now: t0 + 14 * MIN,
    downSince: t0,
    results: [{ kind: 'health', url: 'https://aminoex.com/api/health', ok: false, code: null, ms: 10000, error: '<b>timed out</b>' }],
    dashboardUrl: 'https://watch.example.com/',
    timeZone: 'America/Toronto',
  });
  assert.match(a.subject, /^DOWN: Aminoex \(aminoex\.com\)/);
  assert.match(a.text, /for 14m/);
  assert.match(a.html, /https:\/\/watch\.example\.com\/sites\/aminoex/);
  assert.ok(!a.html.includes('<b>timed out</b>'));
  const r = buildAlert({ kind: 'recovered', site, now: t0 + 30 * MIN, downSince: t0, results: [], dashboardUrl: null, timeZone: 'UTC' });
  assert.match(r.subject, /RECOVERED.*after 30m/);
});
