/**
 * SYNTHETIC preview data for local development only — never run against the
 * production database. Prints SQL to stdout:
 *
 *   npm run db:seed:local
 *
 * 7 days of raw 5-minute checks + 90 days of hourly rollups for every site,
 * a handful of outages, and one site that is down right now.
 */
import { SITES } from '../src/config.ts';
import { percentile } from '../src/monitor/logic.ts';
import { histOf } from '../src/data/stats.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Math.floor(Date.now() / (5 * MIN)) * (5 * MIN);

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());

interface Outage {
  site: string;
  start: number;
  end: number | null; // null = ongoing
  cause: string;
}

const outages: Outage[] = [
  { site: 'vyta', start: now - 3 * DAY - 4 * HOUR, end: now - 3 * DAY - 3 * HOUR - 45 * MIN, cause: 'Health: HTTP 503 · Homepage: HTTP 500' },
  { site: 'vyta', start: now - 41 * DAY, end: now - 41 * DAY + 35 * MIN, cause: 'Health: Health check failing: database' },
  { site: 'aminocan', start: now - 20 * DAY - 6 * HOUR, end: now - 20 * DAY - 4 * HOUR, cause: 'Health: timed out after 10s · Homepage: timed out after 10s' },
  { site: 'aminocan', start: now - 63 * DAY, end: now - 63 * DAY + 20 * MIN, cause: 'Homepage: HTTP 502' },
  { site: 'puramass', start: now - 25 * MIN, end: null, cause: 'Health: HTTP 502 · Homepage: HTTP 502' },
  { site: 'puramass', start: now - 5 * DAY - 2 * HOUR, end: now - 5 * DAY - 2 * HOUR + 10 * MIN, cause: 'Health: connection failed (network connection lost)' },
  { site: 'puramass', start: now - 52 * DAY, end: now - 52 * DAY + 3 * HOUR, cause: 'Health: HTTP 500' },
  { site: 'aminoex', start: now - 9 * HOUR, end: now - 9 * HOUR + 10 * MIN, cause: 'Health: timed out after 10s' },
  { site: 'aminoex', start: now - 30 * DAY, end: now - 30 * DAY + 45 * MIN, cause: 'Health: HTTP 503' },
];

const profile: Record<string, { base: number; spread: number; slowRate: number }> = {
  vyta: { base: 340, spread: 60, slowRate: 0.002 },
  aminocan: { base: 410, spread: 80, slowRate: 0.004 },
  puramass: { base: 560, spread: 120, slowRate: 0.01 },
  aminoex: { base: 880, spread: 260, slowRate: 0.03 },
};

function down(site: string, ts: number): Outage | undefined {
  return outages.find((o) => o.site === site && ts >= o.start && ts < (o.end ?? Infinity));
}

function sample(site: string, ts: number) {
  const p = profile[site];
  const o = down(site, ts);
  if (o) return { ok: 0, slow: 0, ms: null as number | null, error: o.cause };
  // Daily rhythm: a little slower in the local evening rush.
  const hour = new Date(ts).getUTCHours();
  const wave = 1 + 0.18 * Math.sin(((hour - 18) / 24) * 2 * Math.PI);
  let ms = Math.max(90, Math.round(p.base * wave + gauss() * p.spread));
  const slow = rand() < p.slowRate;
  if (slow) ms = 3100 + Math.round(rand() * 2500);
  return { ok: 1, slow: slow ? 1 : 0, ms, error: null as string | null };
}

const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const out: string[] = ['DELETE FROM checks;', 'DELETE FROM hourly;', 'DELETE FROM incidents;', 'DELETE FROM site_state;'];

for (const site of SITES) {
  const id = site.id;
  // Raw checks: last 7 days.
  const hourBuckets = new Map<number, { checks: number; ok: number; slow: number; times: number[] }>();
  const rows: string[] = [];
  for (let ts = now - 7 * DAY + 5 * MIN; ts <= now; ts += 5 * MIN) {
    const s = sample(id, ts);
    const healthMs = s.ms === null ? (s.error?.includes('timed out') ? 10000 : 140) : Math.round(s.ms * 0.45);
    const code = s.ok ? 200 : s.error?.includes('HTTP 5') ? Number(s.error.match(/HTTP (\d+)/)?.[1] ?? 500) : null;
    rows.push(
      `(${q(id)},${ts},${s.ok},${s.slow},${s.ok ? (rand() < 0.01 ? 1 : 0) : 1},${q(code)},${healthMs},${q(s.ok ? 200 : code)},${q(s.ms ?? (code ? 380 : 10000))},${q(s.error)})`,
    );
    const h = Math.floor(ts / HOUR) * HOUR;
    const b = hourBuckets.get(h) ?? { checks: 0, ok: 0, slow: 0, times: [] };
    b.checks++;
    b.ok += s.ok;
    b.slow += s.slow;
    if (s.ms !== null) b.times.push(s.ms);
    hourBuckets.set(h, b);
  }
  for (let i = 0; i < rows.length; i += 400) {
    out.push(
      `INSERT INTO checks (site_id, ts, ok, slow, retried, health_code, health_ms, home_code, home_ms, error) VALUES ${rows.slice(i, i + 400).join(',')};`,
    );
  }
  // Hourly rollups: 90 days (older hours synthesized directly).
  for (let h = Math.floor((now - 90 * DAY) / HOUR) * HOUR; h <= now; h += HOUR) {
    let b = hourBuckets.get(h);
    if (!b) {
      b = { checks: 0, ok: 0, slow: 0, times: [] };
      for (let ts = h; ts < h + HOUR; ts += 5 * MIN) {
        const s = sample(id, ts);
        b.checks++;
        b.ok += s.ok;
        b.slow += s.slow;
        if (s.ms !== null) b.times.push(s.ms);
      }
    }
    out.push(
      `INSERT INTO hourly VALUES (${q(id)},${h},${b.checks},${b.ok},${b.slow},${q(percentile(b.times, 50))},${q(percentile(b.times, 95))},${q(b.times.length ? Math.max(...b.times) : null)},${q(JSON.stringify(histOf(b.times)))});`,
    );
  }
  // Incidents + state.
  let openId: number | null = null;
  for (const o of outages.filter((x) => x.site === id)) {
    out.push(
      `INSERT INTO incidents (site_id, started_at, detected_at, resolved_at, cause, last_error, alerts_sent) VALUES (${q(id)},${o.start},${o.start + 5 * MIN},${q(o.end)},${q(o.cause)},${q(o.cause)},${o.end ? 1 : 1});`,
    );
    if (o.end === null) openId = -1;
  }
  const ongoing = outages.find((o) => o.site === id && o.end === null);
  out.push(
    `INSERT INTO site_state (site_id, status, consecutive_failures, failing_since, down_since, last_alert_at, last_checked_at, incident_id) VALUES (${q(id)},${q(ongoing ? 'down' : 'up')},${ongoing ? Math.round((now - ongoing.start) / (5 * MIN)) : 0},${q(ongoing?.start ?? null)},${q(ongoing?.start ?? null)},${q(ongoing ? ongoing.start + 5 * MIN : null)},${now},${openId === null ? 'NULL' : `(SELECT id FROM incidents WHERE site_id = ${q(id)} AND resolved_at IS NULL)`});`,
  );
}

console.log(out.join('\n'));
