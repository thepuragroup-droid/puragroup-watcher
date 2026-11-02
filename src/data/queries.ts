import { SITES, type SiteConfig } from '../config.ts';
import type { Env } from '../env.ts';
import type { SiteStatus } from '../monitor/logic.ts';
import {
  emptyGrid,
  bucketsFromHourly,
  bucketsFromRaw,
  downtimeWithin,
  summarize,
  type Bucket,
  type HourRow,
  type RangeSpec,
  type RangeStats,
  type RawCheck,
} from './stats.ts';

export interface StateRow {
  site_id: string;
  status: SiteStatus;
  consecutive_failures: number;
  down_since: number | null;
  last_alert_at: number | null;
  last_alert_error: string | null;
  last_checked_at: number | null;
  pd_error?: string | null;
}

export interface IncidentRow {
  id: number;
  site_id: string;
  started_at: number;
  detected_at: number;
  resolved_at: number | null;
  cause: string | null;
  last_error: string | null;
  alerts_sent: number;
}

export interface CheckRow {
  id: number;
  ts: number;
  ok: number;
  slow: number;
  retried: number;
  health_code: number | null;
  health_ms: number | null;
  home_code: number | null;
  home_ms: number | null;
  error: string | null;
}

export interface SiteSummary {
  site: SiteConfig;
  state: StateRow | null;
  buckets: Bucket[];
  stats: RangeStats;
  downtimeMs: number;
  incidents: number;
  lastCheck: CheckRow | null;
}

/**
 * Start of the window the ribbon and chart actually draw (the first grid
 * bucket). Downtime and outage counts use the same window, so the numbers
 * beside a ribbon always agree with its brackets.
 */
export function windowStart(range: RangeSpec, now: number): number {
  return emptyGrid(range, now)[0].start;
}

async function siteSeries(env: Env, site: SiteConfig, range: RangeSpec, now: number) {
  const from = windowStart(range, now);
  if (range.source === 'raw') {
    const { results } = await env.DB
      .prepare('SELECT ts, ok, slow, home_ms FROM checks WHERE site_id = ? AND ts >= ? ORDER BY ts')
      .bind(site.id, from)
      .all<RawCheck>();
    const times = results.filter((r) => r.ok && r.home_ms !== null).map((r) => r.home_ms as number);
    const buckets = bucketsFromRaw(results, range, now);
    return { buckets, stats: summarize(buckets, range, times) };
  }
  const { results } = await env.DB
    .prepare(
      'SELECT hour_ts, checks, ok_checks, slow_checks, p50_ms, p95_ms, hist FROM hourly WHERE site_id = ? AND hour_ts >= ? ORDER BY hour_ts',
    )
    .bind(site.id, from)
    .all<HourRow>();
  const buckets = bucketsFromHourly(results, range, now);
  return { buckets, stats: summarize(buckets, range) };
}

export async function siteSummary(env: Env, site: SiteConfig, range: RangeSpec, now: number): Promise<SiteSummary> {
  const from = windowStart(range, now);
  const [series, state, incidents, lastCheck] = await Promise.all([
    siteSeries(env, site, range, now),
    env.DB.prepare('SELECT * FROM site_state WHERE site_id = ?').bind(site.id).first<StateRow>(),
    env.DB
      .prepare(
        'SELECT started_at, resolved_at FROM incidents WHERE site_id = ? AND (resolved_at IS NULL OR resolved_at > ?)',
      )
      .bind(site.id, from)
      .all<{ started_at: number; resolved_at: number | null }>(),
    env.DB.prepare('SELECT * FROM checks WHERE site_id = ? ORDER BY ts DESC LIMIT 1').bind(site.id).first<CheckRow>(),
  ]);
  return {
    site,
    state,
    ...series,
    downtimeMs: downtimeWithin(incidents.results, from, now),
    incidents: incidents.results.length,
    lastCheck,
  };
}

export async function overview(env: Env, range: RangeSpec, now: number) {
  const [sites, recent] = await Promise.all([
    Promise.all(SITES.map((s) => siteSummary(env, s, range, now))),
    env.DB.prepare('SELECT * FROM incidents ORDER BY started_at DESC LIMIT 12').all<IncidentRow>(),
  ]);
  return { sites, incidents: recent.results };
}

export async function siteIncidents(env: Env, siteId: string, limit = 25): Promise<IncidentRow[]> {
  const { results } = await env.DB
    .prepare('SELECT * FROM incidents WHERE site_id = ? ORDER BY started_at DESC LIMIT ?')
    .bind(siteId, limit)
    .all<IncidentRow>();
  return results;
}

export async function siteHourly(env: Env, siteId: string, from: number): Promise<HourRow[]> {
  const { results } = await env.DB
    .prepare(
      'SELECT hour_ts, checks, ok_checks, slow_checks, p50_ms, p95_ms, hist FROM hourly WHERE site_id = ? AND hour_ts >= ? ORDER BY hour_ts',
    )
    .bind(siteId, from)
    .all<HourRow>();
  return results;
}

export const LOG_PAGE_SIZE = 50;

/** Check log, newest first, keyset-paginated by timestamp. */
export async function checkLog(
  env: Env,
  siteId: string,
  opts: { before: number | null; failuresOnly: boolean },
): Promise<{ rows: CheckRow[]; nextBefore: number | null }> {
  const where = ['site_id = ?'];
  const binds: unknown[] = [siteId];
  if (opts.before) {
    where.push('ts < ?');
    binds.push(opts.before);
  }
  if (opts.failuresOnly) where.push('(ok = 0 OR slow = 1 OR retried = 1)');
  const { results } = await env.DB
    .prepare(`SELECT * FROM checks WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`)
    .bind(...binds, LOG_PAGE_SIZE + 1)
    .all<CheckRow>();
  const more = results.length > LOG_PAGE_SIZE;
  const rows = results.slice(0, LOG_PAGE_SIZE);
  return { rows, nextBefore: more ? rows[rows.length - 1].ts : null };
}

/** Most recent run across all sites — used to warn when the cron has stopped. */
export async function lastRunAt(env: Env): Promise<number | null> {
  const r = await env.DB.prepare('SELECT MAX(last_checked_at) AS t FROM site_state').first<{ t: number | null }>();
  return r?.t ?? null;
}
