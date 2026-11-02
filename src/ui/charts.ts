import { CHECK_INTERVAL_MS } from '../config.ts';
import { bucketState, type Bucket, type RangeSpec } from '../data/stats.ts';
import { percentile } from '../monitor/logic.ts';
import { formatDuration, pct, type Formatters } from './format.ts';
import { html, raw, type SafeHtml } from './html.ts';

const TICK = 3; // viewBox units per bucket: 2 tick + 1 gap
const RIBBON_H = 40;

/** Compact series for the client-side readout: [start, checks, ok, slow, p50, p95]. */
function series(buckets: Bucket[]): string {
  return JSON.stringify(buckets.map((b) => [b.start, b.checks, b.ok, b.slow, b.p50, b.p95]));
}

/** Contiguous runs of buckets with failures, as [startIndex, length]. */
export function outageRuns(buckets: Bucket[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  buckets.forEach((b, i) => {
    const bad = b.checks > 0 && b.ok < b.checks;
    if (bad && start < 0) start = i;
    if (!bad && start >= 0) {
      runs.push([start, i - start]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, buckets.length - start]);
  return runs;
}

/**
 * The signature: one tick per bucket. Colour = state, height = median response
 * time against the site's own p95 for the range (taller = slower). Failed
 * buckets stand full height; outages get a labelled bracket underneath.
 */
export function ribbon(
  buckets: Bucket[],
  range: RangeSpec,
  fmt: Formatters,
  siteP95: number | null,
  ongoing: { since: number; now: number } | null = null,
): SafeHtml {
  const n = buckets.length;
  // Dense ranges (288 checks) draw gapless: a 1-unit gap at ~1.8px per tick
  // aliases into false pale stripes. Sparse ranges keep the gap.
  const tickW = n > 150 ? TICK : 2;
  const scale = Math.max(siteP95 ?? 0, 400);
  const ticks = buckets
    .map((b, i) => {
      const state = bucketState(b);
      let h: number;
      if (state === 'none') h = 5;
      else if (state === 'down' || state === 'partial') h = RIBBON_H;
      else h = 12 + (RIBBON_H - 12) * Math.min(1, (b.p50 ?? 0) / scale);
      return `<rect class="t-${state}" x="${i * TICK}" y="${(RIBBON_H - h).toFixed(1)}" width="${tickW}" height="${h.toFixed(1)}"/>`;
    })
    .join('');

  const runs = outageRuns(buckets);
  const labelCenters: number[] = [];
  const outages = runs.map(([i, len]) => {
    const atEnd = i + len === n;
    const atStart = i === 0;
    // Each failed check stands for one check interval of downtime; an outage
    // still running is measured from when it began, matching the header.
    const failedChecks = buckets.slice(i, i + len).reduce((a, b) => a + (b.checks - b.ok), 0);
    const dur = atEnd && ongoing ? ongoing.now - ongoing.since : failedChecks * CHECK_INTERVAL_MS;
    const left = (i / n) * 100;
    const width = Math.max((len / n) * 100, 0.6);
    labelCenters.push(atEnd ? 100 : atStart ? 0 : left + width / 2);
    const cls = atEnd ? 'outage at-end' : atStart ? 'outage at-start' : 'outage';
    return html`<div class="${cls}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"><span>${formatDuration(dur)}</span></div>`;
  });
  // Axis labels give way to outage labels that would sit on top of them.
  const clear = (pos: number) => !labelCenters.some((c) => Math.abs(c - pos) < 9);

  const first = buckets[0]?.start ?? 0;
  const mid = buckets[Math.floor(n / 2)]?.start ?? 0;

  return html`<div class="ribbon" data-ribbon data-range="${range.key}" data-bucket="${range.bucketMs}" data-series="${series(buckets)}">
    <svg viewBox="0 0 ${n * TICK - (TICK - tickW)} ${RIBBON_H}" preserveAspectRatio="none" role="img"
      aria-label="${`${range.label} of checks: ${runs.length} outage${runs.length === 1 ? '' : 's'}`}">
      ${raw(ticks)}<rect class="hover-col" x="0" y="-4" width="${TICK}" height="${RIBBON_H + 8}" visibility="hidden"/>
    </svg>
    ${outages}
    <div class="ribbon-axis" aria-hidden="true"><span>${clear(0) ? fmt.axis(first, range) : ''}</span><span>${clear(50) ? fmt.axis(mid, range) : ''}</span><span>${clear(100) ? 'now' : ''}</span></div>
  </div>`;
}

/**
 * Axis marks on whole local units: every 4 hours (24h), each midnight (7d),
 * every 5th day (30d), every 15th day (90d). Marks crowding "now" are dropped.
 */
export function axisMarks(buckets: Bucket[], range: RangeSpec, fmt: Formatters): Array<{ i: number; text: string }> {
  const n = buckets.length;
  const out: Array<{ i: number; text: string }> = [];
  let prevKey = '';
  buckets.forEach((b, i) => {
    const { hour, day, date } = fmt.parts(b.start);
    let key: string;
    let keep: boolean;
    if (range.key === '24h') {
      key = `${date}-${Math.floor(hour / 4)}`;
      keep = true;
    } else {
      key = date;
      keep = range.key === '7d' || (day - 1) % (range.key === '30d' ? 5 : 15) === 0;
    }
    if (i > 0 && key !== prevKey && keep && i < n * 0.94) {
      out.push({ i, text: range.key === '24h' ? `${String(Math.floor(hour / 4) * 4).padStart(2, '0')}:00` : fmt.axis(b.start, range) });
    }
    prevKey = key;
  });
  return out;
}

/** Short axis labels: "0", "500 ms", "1.5 s", "6 s". */
function axisMs(v: number): string {
  if (v === 0) return '0';
  if (v < 1000) return `${Math.round(v)} ms`;
  const s = v / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

function niceCeil(v: number): number {
  if (v <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  // Tops whose quarters are round numbers (gridlines sit at 1/4 steps).
  for (const m of [1, 2, 3, 4, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

/** Response-time chart: median line, faint p95 line, failures shaded, whole-hour/day axis. */
export function latencyChart(buckets: Bucket[], range: RangeSpec, fmt: Formatters): SafeHtml {
  const W = 1000;
  const H = 220;
  const n = buckets.length;
  // Scale to the typical band, not the single worst hour: a lone 6 s check
  // would otherwise flatten the median line. Anything above is clipped and
  // the panel says so.
  const p50s = buckets.flatMap((b) => (b.p50 === null ? [] : [b.p50]));
  const p95s = buckets.flatMap((b) => (b.p95 === null ? [] : [b.p95]));
  const robust = Math.max((percentile(p50s, 95) ?? 0) * 1.6, range.source === 'raw' ? 0 : percentile(p95s, 75) ?? 0, 200);
  const yMax = niceCeil(robust * 1.08);
  const clipped = p95s.some((v) => v > yMax);
  const yc = (v: number) => Math.min(v, yMax);
  const x = (i: number) => ((i + 0.5) / n) * W;
  const y = (v: number) => H - (v / yMax) * H;

  // Split into segments wherever data is missing, so gaps read as gaps.
  const segments: Array<Array<{ i: number; b: Bucket }>> = [];
  let cur: Array<{ i: number; b: Bucket }> = [];
  buckets.forEach((b, i) => {
    if (b.p50 === null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else cur.push({ i, b });
  });
  if (cur.length) segments.push(cur);

  const lines = segments
    .map((seg) => {
      if (seg.length === 1) {
        const p = seg[0];
        return `<circle cx="${x(p.i).toFixed(1)}" cy="${y(yc(p.b.p50!)).toFixed(1)}" r="1.6" fill="var(--series)"/>`;
      }
      const pt = (p: { i: number; b: Bucket }, v: number) => `${x(p.i).toFixed(1)},${y(yc(v)).toFixed(1)}`;
      const median = seg.map((p) => pt(p, p.b.p50!)).join(' ');
      // p95 only means something for rollups (a single check has no spread).
      const tail =
        range.source === 'raw'
          ? ''
          : `<polyline class="p95" vector-effect="non-scaling-stroke" points="${seg.map((p) => pt(p, p.b.p95 ?? p.b.p50!)).join(' ')}"/>`;
      return `${tail}<polyline class="p50" vector-effect="non-scaling-stroke" points="${median}"/>`;
    })
    .join('');

  const fails = buckets
    .map((b, i) => {
      if (b.checks === 0 || b.ok === b.checks) return '';
      const w = W / n;
      return `<rect class="fail" x="${(i * w).toFixed(1)}" y="0" width="${Math.max(w, 2).toFixed(1)}" height="${H}"/><rect class="fail-tick" x="${(i * w).toFixed(1)}" y="${H - 5}" width="${Math.max(w, 2).toFixed(1)}" height="5"/>`;
    })
    .join('');

  const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const grid = ticks.map((v) => `<line class="grid" vector-effect="non-scaling-stroke" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const yLabels = [0, ...ticks].map(
    (v) => html`<span class="y-label" style="top:${(8 + (1 - v / yMax) * H).toFixed(1)}px">${axisMs(v)}</span>`,
  );

  const xLabels = axisMarks(buckets, range, fmt).map(
    ({ i, text }) => html`<span style="left:${((x(i) / W) * 100).toFixed(2)}%">${text}</span>`,
  );
  xLabels.push(html`<span style="left:${((x(n - 1) / W) * 100).toFixed(2)}%">now</span>`);

  const hasData = segments.length > 0;
  return html`<div class="chart" data-chart data-range="${range.key}" data-bucket="${range.bucketMs}" data-series="${series(buckets)}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${`Response time over the last ${range.label}`}">
      ${raw(grid)}${raw(fails)}${raw(lines)}
      <line class="cursor" vector-effect="non-scaling-stroke" x1="0" x2="0" y1="0" y2="${H}"/>
      <line class="grid" vector-effect="non-scaling-stroke" x1="0" x2="${W}" y1="${H}" y2="${H}" style="stroke:var(--line-strong)"/>
    </svg>
    ${yLabels}
    <div class="x-labels" aria-hidden="true">${xLabels}</div>
    ${clipped ? html`<span class="clip-note">Spikes above ${axisMs(yMax)} are cut off. Hover for exact values.</span>` : ''}
    ${hasData ? '' : html`<div class="empty" style="position:absolute;inset:0;display:grid;place-items:center;"><span><strong>No response times yet</strong>They appear after the first passing check.</span></div>`}
  </div>`;
}

/** 90 days as a 30-wide grid of day cells, oldest first. */
export function availabilityGrid(
  days: Array<{ day: string; checks: number; ok: number; slow: number }>,
  fmt: Formatters,
): SafeHtml {
  // `day` is an ISO date in the dashboard's zone; noon UTC keeps it on that date.
  const nice = (iso: string) => fmt.day(Date.parse(`${iso}T12:00:00Z`));
  const cells = days.map((d) => {
    const up = d.checks ? d.ok / d.checks : null;
    const cls = up === null ? '' : up >= 1 ? 'a-up' : up >= 0.99 ? 'a-minor' : 'a-major';
    const failed = d.checks - d.ok;
    const label =
      up === null
        ? `${nice(d.day)}: no data`
        : `${nice(d.day)}: ${pct(up)} up${failed ? `, ${failed} failed check${failed === 1 ? '' : 's'}` : ''}`;
    return html`<i class="${cls}" role="img" title="${label}" aria-label="${label}"></i>`;
  });
  return html`<div class="avail" role="group" aria-label="Daily availability, last ${days.length} days">${cells}</div>
    <div class="avail-foot"><span>${days[0] ? nice(days[0].day) : ''}</span><span>Today</span></div>`;
}
