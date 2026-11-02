import test from 'node:test';
import assert from 'node:assert/strict';
import {
  histOf,
  histPercentile,
  bucketsFromHourly,
  bucketsFromRaw,
  bucketState,
  dailyAvailability,
  downtimeWithin,
  emptyGrid,
  parseRange,
  RANGES,
  summarize,
} from '../src/data/stats.ts';
import { outageRuns } from '../src/ui/charts.ts';
import { html, raw } from '../src/ui/html.ts';
import { pct } from '../src/ui/format.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = Date.UTC(2026, 10, 2, 12, 2);

test('parseRange falls back to 24h', () => {
  assert.equal(parseRange('7d').key, '7d');
  assert.equal(parseRange('bogus').key, '24h');
  assert.equal(parseRange(null).key, '24h');
});

test('grids have one bucket per interval and end at now', () => {
  assert.equal(emptyGrid(RANGES['24h'], now).length, 288);
  assert.equal(emptyGrid(RANGES['7d'], now).length, 168);
  assert.equal(emptyGrid(RANGES['30d'], now).length, 120);
  assert.equal(emptyGrid(RANGES['90d'], now).length, 90);
  const g = emptyGrid(RANGES['24h'], now);
  assert.ok(g[g.length - 1].start <= now && now < g[g.length - 1].start + 5 * MIN);
});

test('raw checks land in their bucket; stats are exact', () => {
  const r = RANGES['24h'];
  const rows = [
    { ts: now - 10 * MIN, ok: 1, slow: 0, home_ms: 300 },
    { ts: now - 5 * MIN, ok: 0, slow: 0, home_ms: null },
    { ts: now, ok: 1, slow: 1, home_ms: 4000 },
  ];
  const b = bucketsFromRaw(rows, r, now);
  const used = b.filter((x) => x.checks > 0);
  assert.equal(used.length, 3);
  assert.deepEqual(used.map(bucketState), ['up', 'down', 'slow']);
  const s = summarize(b, r, [300, 4000]);
  assert.equal(s.checks, 3);
  assert.equal(s.uptime, 2 / 3);
  assert.equal(s.p95, 4000);
  assert.equal(s.slowChecks, 1);
});

test('hourly rollups merge into 6h buckets', () => {
  const r = RANGES['30d'];
  const start = Math.floor(now / r.bucketMs) * r.bucketMs;
  const rows = [0, 1, 2].map((h) => ({
    hour_ts: start + h * HOUR,
    checks: 12,
    ok_checks: h === 1 ? 10 : 12,
    slow_checks: 0,
    p50_ms: 200 + h * 100,
    p95_ms: 500 + h * 100,
  }));
  const b = bucketsFromHourly(rows, r, now);
  const last = b[b.length - 1];
  assert.equal(last.checks, 36);
  assert.equal(last.ok, 34);
  assert.equal(last.p50, 300);
  assert.equal(last.p95, 700);
  assert.equal(bucketState(last), 'partial');
});

test('histograms merge into honest percentiles', () => {
  const fast = Array.from({ length: 95 }, (_, i) => 300 + i); // 300..394
  const slow = Array.from({ length: 5 }, () => 6000);
  const h = histOf([...fast, ...slow]);
  assert.equal(h.reduce((a, c) => a + c, 0), 100);
  const p50 = histPercentile(h, 50)!;
  assert.ok(p50 >= 300 && p50 <= 400, `p50 ${p50}`);
  const p95 = histPercentile(h, 95)!;
  assert.ok(p95 <= 400, `p95 ${p95} should stay in the fast bin`);
  assert.ok(histPercentile(h, 99)! >= 5000);
  assert.equal(histPercentile(histOf([]), 50), null);

  // 6h bucket built from hourly rows that carry histograms.
  const r = RANGES['30d'];
  const start = Math.floor(now / r.bucketMs) * r.bucketMs;
  const rows = [0, 1].map((k) => ({
    hour_ts: start + k * HOUR, checks: 12, ok_checks: 12, slow_checks: 0,
    p50_ms: 9999, p95_ms: 9999, // ignored when histograms exist
    hist: JSON.stringify(histOf(Array(12).fill(450))),
  }));
  const b = bucketsFromHourly(rows, r, now);
  const last = b[b.length - 1];
  assert.ok(last.p50! > 400 && last.p50! <= 500);
  const sum = summarize(b, r);
  assert.ok(sum.p95! > 400 && sum.p95! <= 500);
});

test('downtime clips incidents to the window', () => {
  const from = now - 24 * HOUR;
  assert.equal(
    downtimeWithin(
      [
        { started_at: from - HOUR, resolved_at: from + 30 * MIN }, // straddles start: 30m
        { started_at: now - 10 * MIN, resolved_at: null }, // ongoing: 10m
        { started_at: from - 5 * HOUR, resolved_at: from - 4 * HOUR }, // outside
      ],
      from,
      now,
    ),
    40 * MIN,
  );
});

test('outage runs group consecutive failing buckets', () => {
  const mk = (checks: number, ok: number) => ({ start: 0, checks, ok, slow: 0, p50: null, p95: null });
  assert.deepEqual(outageRuns([mk(1, 1), mk(1, 0), mk(1, 0), mk(0, 0), mk(2, 1), mk(1, 0)]), [
    [1, 2],
    [4, 2],
  ]);
});

test('daily availability groups by local day', () => {
  const days = dailyAvailability(
    [{ hour_ts: now - HOUR, checks: 12, ok_checks: 11, slow_checks: 0, p50_ms: 1, p95_ms: 1 }],
    now,
    90,
    'America/Toronto',
  );
  assert.equal(days.length, 90);
  assert.equal(days[days.length - 1].checks, 12);
  assert.equal(days[days.length - 1].ok, 11);
});

test('html escapes by default, raw does not', () => {
  const evil = '<script>alert(1)</script>"';
  assert.equal(html`<p title="${evil}">${evil}</p>`.value, '<p title="&lt;script&gt;alert(1)&lt;/script&gt;&quot;">&lt;script&gt;alert(1)&lt;/script&gt;&quot;</p>');
  assert.equal(html`${raw('<b>x</b>')}`.value, '<b>x</b>');
  assert.equal(html`${['a', html`<i>b</i>`]}`.value, 'a<i>b</i>');
});

test('pct', () => {
  assert.equal(pct(null), '—');
  assert.equal(pct(1), '100%');
  assert.equal(pct(0.99954), '99.95%');
  assert.equal(pct(0.974), '97.4%');
});

test('axis marks land on whole local hours and days', async () => {
  const { axisMarks } = await import('../src/ui/charts.ts');
  const { makeFormatters } = await import('../src/ui/format.ts');
  const fmt = makeFormatters('America/Toronto');
  const day = emptyGrid(RANGES['24h'], now);
  const marks = axisMarks(day, RANGES['24h'], fmt);
  assert.ok(marks.length >= 4 && marks.length <= 6, `got ${marks.length}`);
  for (const m of marks) assert.match(m.text, /^(00|04|08|12|16|20):00$/);
  for (const m of marks) assert.equal(fmt.parts(day[m.i].start).hour % 4, 0);
  const week = axisMarks(emptyGrid(RANGES['7d'], now), RANGES['7d'], fmt);
  assert.ok(week.length >= 5 && week.length <= 7);
});
