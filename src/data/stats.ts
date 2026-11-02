/**
 * Pure aggregation for the dashboard — bucketing, uptime, downtime. No I/O;
 * unit-tested in test/stats.test.ts.
 */
import { percentile } from '../monitor/logic.ts';

export type RangeKey = '24h' | '7d' | '30d' | '90d';

export interface RangeSpec {
  key: RangeKey;
  label: string;
  ms: number;
  bucketMs: number;
  /** raw = one bucket per check; hourly = from the rollup table */
  source: 'raw' | 'hourly';
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const RANGES: Record<RangeKey, RangeSpec> = {
  '24h': { key: '24h', label: '24 hours', ms: DAY, bucketMs: 5 * MIN, source: 'raw' },
  '7d': { key: '7d', label: '7 days', ms: 7 * DAY, bucketMs: HOUR, source: 'hourly' },
  '30d': { key: '30d', label: '30 days', ms: 30 * DAY, bucketMs: 6 * HOUR, source: 'hourly' },
  '90d': { key: '90d', label: '90 days', ms: 90 * DAY, bucketMs: DAY, source: 'hourly' },
};

export function parseRange(raw: string | null | undefined): RangeSpec {
  return RANGES[(raw ?? '') as RangeKey] ?? RANGES['24h'];
}

/** One slot on a timeline: a single check (24h) or a rollup of many. */
export interface Bucket {
  start: number;
  checks: number;
  ok: number;
  slow: number;
  p50: number | null;
  p95: number | null;
}

export type BucketState = 'up' | 'slow' | 'partial' | 'down' | 'none';

/**
 * up: every check passed · slow: passed but slow · partial: some failed ·
 * down: every check failed · none: no data (watcher not running yet).
 */
export function bucketState(b: Bucket): BucketState {
  if (b.checks === 0) return 'none';
  if (b.ok === 0) return 'down';
  if (b.ok < b.checks) return 'partial';
  // One slow check in a 6-hour bucket isn't a slow period: need >= 10%.
  if (b.slow / b.checks >= 0.1) return 'slow';
  return 'up';
}

// ---------------------------------------------------------------------------
// Latency histograms (mergeable percentiles)
// ---------------------------------------------------------------------------

/** Upper edges (ms) of each histogram bin; one extra bin catches the rest. */
export const HIST_EDGES = [100, 150, 200, 250, 300, 400, 500, 650, 800, 1000, 1300, 1600, 2000, 2500, 3000, 4000, 5000, 7000, 10000];

export function histOf(values: number[]): number[] {
  const h = new Array(HIST_EDGES.length + 1).fill(0);
  for (const v of values) {
    let i = HIST_EDGES.findIndex((e) => v <= e);
    if (i < 0) i = HIST_EDGES.length;
    h[i]++;
  }
  return h;
}

export function mergeHist(into: number[], add: number[]): number[] {
  for (let i = 0; i < into.length; i++) into[i] += add[i] ?? 0;
  return into;
}

export function parseHist(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const h = JSON.parse(raw);
    return Array.isArray(h) && h.length === HIST_EDGES.length + 1 ? h.map(Number) : null;
  } catch {
    return null;
  }
}

/** Percentile from a histogram, linearly interpolated inside the bin. */
export function histPercentile(h: number[], p: number): number | null {
  const total = h.reduce((a, c) => a + c, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * total));
  let seen = 0;
  for (let i = 0; i < h.length; i++) {
    if (h[i] === 0) continue;
    if (seen + h[i] >= rank) {
      const lo = i === 0 ? 0 : HIST_EDGES[i - 1];
      const hi = i < HIST_EDGES.length ? HIST_EDGES[i] : HIST_EDGES[HIST_EDGES.length - 1] * 1.5;
      return Math.round(lo + ((hi - lo) * (rank - seen)) / h[i]);
    }
    seen += h[i];
  }
  return null;
}

export interface RawCheck {
  ts: number;
  ok: number;
  slow: number;
  home_ms: number | null;
}

export interface HourRow {
  hour_ts: number;
  checks: number;
  ok_checks: number;
  slow_checks: number;
  p50_ms: number | null;
  p95_ms: number | null;
  hist?: string | null;
}

/** Fixed grid of empty buckets ending at `now`, oldest first. */
export function emptyGrid(range: RangeSpec, now: number): Bucket[] {
  const end = Math.floor(now / range.bucketMs) * range.bucketMs;
  const count = Math.round(range.ms / range.bucketMs);
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push({ start: end - i * range.bucketMs, checks: 0, ok: 0, slow: 0, p50: null, p95: null });
  }
  return out;
}

function slot(grid: Bucket[], range: RangeSpec, ts: number): Bucket | undefined {
  const first = grid[0]?.start ?? 0;
  const i = Math.floor((ts - first) / range.bucketMs);
  return grid[i];
}

export function bucketsFromRaw(rows: RawCheck[], range: RangeSpec, now: number): Bucket[] {
  const grid = emptyGrid(range, now);
  const times = new Map<Bucket, number[]>();
  for (const r of rows) {
    const b = slot(grid, range, r.ts);
    if (!b) continue;
    b.checks += 1;
    b.ok += r.ok ? 1 : 0;
    b.slow += r.slow ? 1 : 0;
    if (r.ok && r.home_ms !== null) {
      const list = times.get(b) ?? [];
      list.push(r.home_ms);
      times.set(b, list);
    }
  }
  for (const [b, list] of times) {
    b.p50 = percentile(list, 50);
    b.p95 = percentile(list, 95);
  }
  return grid;
}

/**
 * Merge hourly rollups into the range's buckets. A bucket of exactly one hour
 * keeps that hour's exact percentiles; wider buckets use merged histograms.
 * Also returns the whole range's merged histogram for the summary.
 */
export function bucketsFromHourly(
  rows: HourRow[],
  range: RangeSpec,
  now: number,
): Bucket[] & { hist?: number[] } {
  const grid = emptyGrid(range, now) as Bucket[] & { hist?: number[] };
  const hists = new Map<Bucket, number[]>();
  const legacyP50 = new Map<Bucket, number[]>();
  const rangeHist = new Array(HIST_EDGES.length + 1).fill(0);
  for (const r of rows) {
    const b = slot(grid, range, r.hour_ts);
    if (!b) continue;
    b.checks += r.checks;
    b.ok += r.ok_checks;
    b.slow += r.slow_checks;
    const h = parseHist(r.hist);
    if (h) {
      mergeHist(rangeHist, h);
      hists.set(b, mergeHist(hists.get(b) ?? new Array(HIST_EDGES.length + 1).fill(0), h));
    }
    if (r.p50_ms !== null) legacyP50.set(b, [...(legacyP50.get(b) ?? []), r.p50_ms]);
    if (r.p95_ms !== null) b.p95 = Math.max(b.p95 ?? 0, r.p95_ms);
  }
  for (const b of grid) {
    const h = hists.get(b);
    if (range.bucketMs > 3_600_000 && h && h.some((c) => c > 0)) {
      b.p50 = histPercentile(h, 50);
      b.p95 = histPercentile(h, 95);
    } else {
      // One hour per bucket (exact), or rollups from before histograms.
      const list = legacyP50.get(b);
      if (list) b.p50 = Math.round(list.reduce((a, c) => a + c, 0) / list.length);
    }
  }
  grid.hist = rangeHist;
  return grid;
}

export interface IncidentSpan {
  started_at: number;
  resolved_at: number | null;
}

/** Total downtime inside [from, to], clipping incidents that straddle the edges. */
export function downtimeWithin(incidents: IncidentSpan[], from: number, to: number): number {
  let total = 0;
  for (const i of incidents) {
    const s = Math.max(i.started_at, from);
    const e = Math.min(i.resolved_at ?? to, to);
    if (e > s) total += e - s;
  }
  return total;
}

export interface RangeStats {
  checks: number;
  uptime: number | null; // 0..1
  p50: number | null;
  p95: number | null;
  slowChecks: number;
}

export function summarize(
  buckets: Bucket[] & { hist?: number[] },
  range: RangeSpec,
  rawTimes?: number[],
): RangeStats {
  const checks = buckets.reduce((a, b) => a + b.checks, 0);
  const ok = buckets.reduce((a, b) => a + b.ok, 0);
  const slowChecks = buckets.reduce((a, b) => a + b.slow, 0);
  let p50: number | null;
  let p95: number | null;
  if (range.source === 'raw' && rawTimes) {
    p50 = percentile(rawTimes, 50);
    p95 = percentile(rawTimes, 95);
  } else if (buckets.hist && buckets.hist.some((c) => c > 0)) {
    p50 = histPercentile(buckets.hist, 50);
    p95 = histPercentile(buckets.hist, 95);
  } else {
    // Rollups written before histograms existed: median of hourly medians.
    p50 = percentile(buckets.flatMap((b) => (b.p50 === null ? [] : [b.p50])), 50);
    p95 = percentile(buckets.flatMap((b) => (b.p95 === null ? [] : [b.p95])), 50);
  }
  return { checks, uptime: checks ? ok / checks : null, p50, p95, slowChecks };
}

/** Group hourly rows into local calendar days (for the 90-day availability strip). */
export function dailyAvailability(
  rows: HourRow[],
  now: number,
  days: number,
  timeZone: string,
): Array<{ day: string; checks: number; ok: number; slow: number }> {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const byDay = new Map<string, { day: string; checks: number; ok: number; slow: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = fmt.format(now - i * DAY);
    if (!byDay.has(d)) byDay.set(d, { day: d, checks: 0, ok: 0, slow: 0 });
  }
  for (const r of rows) {
    const d = byDay.get(fmt.format(r.hour_ts));
    if (!d) continue;
    d.checks += r.checks;
    d.ok += r.ok_checks;
    d.slow += r.slow_checks;
  }
  return [...byDay.values()].slice(-days);
}
