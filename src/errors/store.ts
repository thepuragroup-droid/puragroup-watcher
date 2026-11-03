/** D1 reads and writes for server errors (tables in migrations/0004_vercel_errors.sql). */
import { ERROR_EVENT_RETENTION_DAYS } from '../config.ts';
import type { Env } from '../env.ts';
import { autoPriority, type ErrorEventRow } from './normalize.ts';

export const STATUSES = ['open', 'analyzed', 'fix_pending', 'fixed', 'ignored', 'regressed'] as const;
export type ErrorStatus = (typeof STATUSES)[number];
/** Statuses that still need attention. */
export const ACTIVE: ErrorStatus[] = ['open', 'analyzed', 'fix_pending', 'regressed'];

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface GroupRow {
  fingerprint: string;
  site_id: string;
  title: string;
  source: string | null;
  route: string | null;
  level: string | null;
  status: ErrorStatus;
  event_count: number;
  first_seen_at: number;
  last_seen_at: number;
  last_status_code: number | null;
  last_environment: string | null;
  last_deployment_id: string | null;
  sample_message: string | null;
  score: number | null;
  severity: Severity | null;
  category: string | null;
  root_cause: string | null;
  solution: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  affected_files: string; // JSON
  analyzed_at: number | null;
  fix_ref: string | null;
  fixed_at: number | null;
  status_note: string | null;
  updated_at: number;
}

/** A group with its recent volume and the priority the lists sort by. */
export interface Group extends Omit<GroupRow, 'affected_files'> {
  affected_files: string[];
  last_24h: number;
  last_7d: number;
  /** Claude's score once analysed, otherwise the automatic estimate. */
  priority: number;
  scored: boolean;
}

export interface EventRow {
  id: number;
  ts: number;
  project_id: string | null;
  source: string | null;
  level: string | null;
  environment: string | null;
  deployment_id: string | null;
  branch: string | null;
  host: string | null;
  method: string | null;
  path: string | null;
  status_code: number | null;
  request_id: string | null;
  region: string | null;
  entrypoint: string | null;
  message: string | null;
}

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const INSERT_EVENT = `INSERT OR IGNORE INTO error_events (
  vercel_log_id, fingerprint, site_id, title, ts, received_at, project_id, source, level, environment,
  deployment_id, branch, host, method, path, route, status_code, request_id, region, entrypoint, message
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Insert occurrences; the trigger rolls them into groups. Duplicates (same
 * Vercel log id, i.e. a retried batch) are skipped. Returns rows inserted.
 */
export async function insertEvents(env: Env, rows: ErrorEventRow[], now = Date.now()): Promise<number> {
  let inserted = 0;
  // D1 batches run in one transaction; keep each one modest.
  for (let i = 0; i < rows.length; i += 50) {
    const stmt = env.DB.prepare(INSERT_EVENT);
    const results = await env.DB.batch(
      rows.slice(i, i + 50).map((r) =>
        stmt.bind(
          r.vercel_log_id, r.fingerprint, r.site_id, r.title, r.ts, now, r.project_id, r.source, r.level,
          r.environment, r.deployment_id, r.branch, r.host, r.method, r.path, r.route, r.status_code,
          r.request_id, r.region, r.entrypoint, r.message,
        ),
      ),
    );
    for (const res of results) inserted += res.meta?.changes ? 1 : 0;
  }
  return inserted;
}

/** Drop occurrences past retention. Called from the cron. */
export async function pruneErrorEvents(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare('DELETE FROM error_events WHERE ts < ?').bind(now - ERROR_EVENT_RETENTION_DAYS * DAY).run();
}

/** Fields the API and dashboard may change. Validated by validate.ts first. */
export interface GroupPatch {
  status?: ErrorStatus;
  score?: number | null;
  severity?: Severity | null;
  category?: string | null;
  root_cause?: string | null;
  solution?: string | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  affected_files?: string[];
  analyzed_at?: number | null;
  fix_ref?: string | null;
  status_note?: string | null;
}

export async function updateGroup(env: Env, fingerprint: string, patch: GroupPatch, now = Date.now()): Promise<Group | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    binds.push(k === 'affected_files' ? JSON.stringify(v) : v);
  }
  // Marking fixed starts the regression clock; moving away from fixed clears it.
  if (patch.status === 'fixed') {
    sets.push('fixed_at = ?');
    binds.push(now);
  } else if (patch.status) {
    sets.push('fixed_at = NULL');
  }
  if (sets.length === 0) return getGroup(env, fingerprint, now);
  sets.push('updated_at = ?');
  binds.push(now);
  const res = await env.DB
    .prepare(`UPDATE error_groups SET ${sets.join(', ')} WHERE fingerprint = ?`)
    .bind(...binds, fingerprint)
    .run();
  if (!res.meta?.changes) return null;
  return getGroup(env, fingerprint, now);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function hydrate(row: GroupRow & { last_24h: number | null; last_7d: number | null }, now: number): Group {
  let files: string[] = [];
  try {
    const parsed = JSON.parse(row.affected_files || '[]');
    if (Array.isArray(parsed)) files = parsed.filter((f): f is string => typeof f === 'string');
  } catch {
    /* leave empty */
  }
  const last_24h = row.last_24h ?? 0;
  const last_7d = row.last_7d ?? 0;
  const scored = row.score !== null;
  return {
    ...row,
    affected_files: files,
    last_24h,
    last_7d,
    scored,
    priority: scored ? (row.score as number) : autoPriority({ ...row, last_24h, last_7d }, now),
  };
}

const WINDOW_JOIN = `LEFT JOIN (
  SELECT fingerprint AS wfp,
         SUM(CASE WHEN ts > ?1 THEN 1 ELSE 0 END) AS last_24h,
         COUNT(*) AS last_7d
    FROM error_events WHERE ts > ?2 GROUP BY fingerprint
) w ON w.wfp = g.fingerprint`;

export interface GroupFilter {
  site?: string | null;
  /** 'active' (default), 'all', or one status. */
  status?: string | null;
  environment?: string | null;
  q?: string | null;
  limit?: number;
}

/** Every group matching the filter, newest activity first (callers re-sort). */
export async function listGroups(env: Env, f: GroupFilter = {}, now = Date.now()): Promise<Group[]> {
  const where: string[] = [];
  const binds: unknown[] = [now - DAY, now - 7 * DAY];
  const status = f.status || 'active';
  if (status === 'active') where.push(`g.status IN (${ACTIVE.map((s) => `'${s}'`).join(',')})`);
  else if ((STATUSES as readonly string[]).includes(status)) {
    where.push(`g.status = ?${binds.length + 1}`);
    binds.push(status);
  }
  if (f.site) {
    where.push(`g.site_id = ?${binds.length + 1}`);
    binds.push(f.site);
  }
  if (f.environment) {
    where.push(`g.last_environment = ?${binds.length + 1}`);
    binds.push(f.environment);
  }
  if (f.q) {
    const n = binds.length + 1;
    where.push(`(g.title LIKE ?${n} OR g.route LIKE ?${n} OR g.fingerprint LIKE ?${n} OR g.root_cause LIKE ?${n} OR g.category LIKE ?${n})`);
    binds.push(`%${f.q.replace(/[%_]/g, '')}%`);
  }
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 1000);
  const { results } = await env.DB
    .prepare(
      `SELECT g.*, w.last_24h, w.last_7d FROM error_groups g ${WINDOW_JOIN}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY g.last_seen_at DESC LIMIT ${limit}`,
    )
    .bind(...binds)
    .all<GroupRow & { last_24h: number | null; last_7d: number | null }>();
  return results.map((r) => hydrate(r, now));
}

export async function getGroup(env: Env, fingerprint: string, now = Date.now()): Promise<Group | null> {
  const row = await env.DB
    .prepare(`SELECT g.*, w.last_24h, w.last_7d FROM error_groups g ${WINDOW_JOIN} WHERE g.fingerprint = ?3`)
    .bind(now - DAY, now - 7 * DAY, fingerprint)
    .first<GroupRow & { last_24h: number | null; last_7d: number | null }>();
  return row ? hydrate(row, now) : null;
}

export async function groupEvents(env: Env, fingerprint: string, limit = 50): Promise<EventRow[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT id, ts, project_id, source, level, environment, deployment_id, branch, host, method, path,
              status_code, request_id, region, entrypoint, message
         FROM error_events WHERE fingerprint = ? ORDER BY ts DESC LIMIT ?`,
    )
    .bind(fingerprint, limit)
    .all<EventRow>();
  return results;
}

/** Per-site counts for the overview and site pages. */
export interface SiteErrorCounts {
  site_id: string;
  active: number;
  unanalyzed: number;
  critical: number;
  regressed: number;
  events_24h: number;
}

export async function errorCountsBySite(env: Env, now = Date.now()): Promise<Map<string, SiteErrorCounts>> {
  const active = ACTIVE.map((s) => `'${s}'`).join(',');
  const [groups, events] = await Promise.all([
    env.DB
      .prepare(
        `SELECT site_id,
                SUM(CASE WHEN status IN (${active}) THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status IN (${active}) AND analyzed_at IS NULL THEN 1 ELSE 0 END) AS unanalyzed,
                SUM(CASE WHEN status IN (${active}) AND severity = 'critical' THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN status = 'regressed' THEN 1 ELSE 0 END) AS regressed
           FROM error_groups GROUP BY site_id`,
      )
      .all<Omit<SiteErrorCounts, 'events_24h'>>(),
    env.DB
      .prepare('SELECT site_id, COUNT(*) AS n FROM error_events WHERE ts > ? GROUP BY site_id')
      .bind(now - DAY)
      .all<{ site_id: string; n: number }>(),
  ]);
  const out = new Map<string, SiteErrorCounts>();
  for (const r of groups.results) out.set(r.site_id, { ...r, events_24h: 0 });
  for (const r of events.results) {
    const c = out.get(r.site_id) ?? { site_id: r.site_id, active: 0, unanalyzed: 0, critical: 0, regressed: 0, events_24h: 0 };
    c.events_24h = r.n;
    out.set(r.site_id, c);
  }
  return out;
}

/** Vercel projects whose errors matched no site — so they can be added to config. */
export async function unmatchedProjects(env: Env, now = Date.now()): Promise<Array<{ project_id: string | null; host: string | null; n: number; last: number }>> {
  const { results } = await env.DB
    .prepare(
      `SELECT project_id, MAX(host) AS host, COUNT(*) AS n, MAX(ts) AS last
         FROM error_events WHERE site_id = 'unmatched' AND ts > ?
        GROUP BY project_id ORDER BY n DESC LIMIT 10`,
    )
    .bind(now - 30 * DAY)
    .all<{ project_id: string | null; host: string | null; n: number; last: number }>();
  return results;
}

// ---------------------------------------------------------------------------
// Drain health
// ---------------------------------------------------------------------------

export interface DrainState {
  last_received_at: number | null;
  last_rejected_at: number | null;
  last_rejected_reason: string | null;
}

/** Note an accepted batch. Writes at most once a minute. */
export async function noteDrainReceived(env: Env, now = Date.now()): Promise<void> {
  await env.DB
    .prepare('UPDATE drain_state SET last_received_at = ?1 WHERE id = 1 AND (last_received_at IS NULL OR last_received_at < ?2)')
    .bind(now, now - 60_000)
    .run();
}

/** Note a refused batch (shown on the Errors page). Writes at most once a minute. */
export async function noteDrainRejected(env: Env, reason: string, now = Date.now()): Promise<void> {
  await env.DB
    .prepare(
      'UPDATE drain_state SET last_rejected_at = ?1, last_rejected_reason = ?2 WHERE id = 1 AND (last_rejected_at IS NULL OR last_rejected_at < ?3)',
    )
    .bind(now, reason.slice(0, 200), now - 60_000)
    .run();
}

export async function drainState(env: Env): Promise<DrainState> {
  const r = await env.DB.prepare('SELECT last_received_at, last_rejected_at, last_rejected_reason FROM drain_state WHERE id = 1').first<DrainState>();
  return r ?? { last_received_at: null, last_rejected_at: null, last_rejected_reason: null };
}
