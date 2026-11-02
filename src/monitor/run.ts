import { CHECK_RETENTION_DAYS, SITES, type SiteConfig } from '../config.ts';
import { timezone, type Env } from '../env.ts';
import { buildAlert, recipientsFor, sendAlert } from './alerts.ts';
import { checkSite, type SiteCheck } from './check.ts';
import { decide, describeFailure, INITIAL_STATE, percentile, type SiteState } from './logic.ts';
import { histOf } from '../data/stats.ts';

const HOUR_MS = 3_600_000;

interface StateRow {
  site_id: string;
  status: SiteState['status'];
  consecutive_failures: number;
  failing_since: number | null;
  down_since: number | null;
  last_alert_at: number | null;
  incident_id: number | null;
}

/** One cron tick: check every site, update state, alert, record. */
export async function runAll(env: Env, now = Date.now()): Promise<SiteCheck[]> {
  const checks = await Promise.all(SITES.map((s) => checkSite(s)));
  await Promise.all(checks.map((c) => record(env, c, now)));
  await prune(env, now);
  return checks;
}

async function record(env: Env, check: SiteCheck, now: number): Promise<void> {
  const { site, results } = check;
  const db = env.DB;

  const row = await db
    .prepare('SELECT * FROM site_state WHERE site_id = ?')
    .bind(site.id)
    .first<StateRow>();
  const prev: SiteState = row
    ? {
        status: row.status,
        consecutiveFailures: row.consecutive_failures,
        failingSince: row.failing_since,
        downSince: row.down_since,
        lastAlertAt: row.last_alert_at,
      }
    : INITIAL_STATE;

  const decision = decide(prev, check.ok, site, now);
  const failure = describeFailure(results);
  let incidentId = row?.incident_id ?? null;

  if (decision.openIncident) {
    const inc = await db
      .prepare(
        'INSERT INTO incidents (site_id, started_at, detected_at, cause, last_error) VALUES (?, ?, ?, ?, ?) RETURNING id',
      )
      .bind(site.id, decision.next.downSince, now, failure, failure)
      .first<{ id: number }>();
    incidentId = inc?.id ?? null;
  } else if (!check.ok && incidentId !== null) {
    await db.prepare('UPDATE incidents SET last_error = ? WHERE id = ?').bind(failure, incidentId).run();
  }

  // Alert before closing so the recovery email can quote the outage length.
  let lastAlertAt = decision.next.lastAlertAt;
  let alertError: string | null | undefined;
  if (decision.alert) {
    const downSince = decision.alert === 'recovered' ? prev.downSince : decision.next.downSince;
    const input = {
      kind: decision.alert,
      site,
      now,
      downSince,
      results,
      dashboardUrl: env.DASHBOARD_URL || null,
    };
    const alert = buildAlert({ ...input, timeZone: timezone(env) });
    const sent = await sendAlert(env, recipientsFor(site, env), alert, input);
    // Keep partial failures too (e.g. email went out but PagerDuty didn't),
    // so the dashboard shows them.
    alertError = sent.error ?? (sent.ok ? null : 'failed to send');
    if (sent.ok && decision.alert !== 'recovered') {
      lastAlertAt = now;
      if (incidentId !== null) {
        await db.prepare('UPDATE incidents SET alerts_sent = alerts_sent + 1 WHERE id = ?').bind(incidentId).run();
      }
    }
    if (alertError) console.error(`[alert] ${site.id} ${decision.alert}: ${alertError}`);
  }

  if (decision.closeIncident && incidentId !== null) {
    await db.prepare('UPDATE incidents SET resolved_at = ? WHERE id = ?').bind(now, incidentId).run();
    incidentId = null;
  }

  const health = results.find((r) => r.kind === 'health');
  const home = results.find((r) => r.kind === 'home');

  await db.batch([
    db
      .prepare(
        `INSERT INTO checks (site_id, ts, ok, slow, retried, health_code, health_ms, home_code, home_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        site.id,
        now,
        check.ok ? 1 : 0,
        check.slow ? 1 : 0,
        check.retried ? 1 : 0,
        health?.code ?? null,
        health?.ms ?? null,
        home?.code ?? null,
        home?.ms ?? null,
        failure,
      ),
    db
      .prepare(
        `INSERT INTO site_state (site_id, status, consecutive_failures, failing_since, down_since,
           last_alert_at, last_alert_error, last_checked_at, incident_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (site_id) DO UPDATE SET
           status = ?2, consecutive_failures = ?3, failing_since = ?4, down_since = ?5,
           last_alert_at = ?6,
           last_alert_error = CASE WHEN ?10 = 1 THEN ?7 ELSE site_state.last_alert_error END,
           last_checked_at = ?8, incident_id = ?9`,
      )
      .bind(
        site.id,
        decision.next.status,
        decision.next.consecutiveFailures,
        decision.next.failingSince,
        decision.next.downSince,
        lastAlertAt,
        alertError ?? null,
        now,
        incidentId,
        alertError === undefined ? 0 : 1,
      ),
  ]);

  await rollupHour(env, site, now);
}

/** Recompute the current hour's rollup row from that hour's raw checks. */
export async function rollupHour(env: Env, site: SiteConfig, now: number): Promise<void> {
  const hourTs = Math.floor(now / HOUR_MS) * HOUR_MS;
  const { results } = await env.DB
    .prepare('SELECT ok, slow, home_ms FROM checks WHERE site_id = ? AND ts >= ? AND ts < ?')
    .bind(site.id, hourTs, hourTs + HOUR_MS)
    .all<{ ok: number; slow: number; home_ms: number | null }>();
  if (results.length === 0) return;
  const times = results.filter((r) => r.ok && r.home_ms !== null).map((r) => r.home_ms as number);
  await env.DB
    .prepare(
      `INSERT INTO hourly (site_id, hour_ts, checks, ok_checks, slow_checks, p50_ms, p95_ms, max_ms, hist)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, hour_ts) DO UPDATE SET
         checks = excluded.checks, ok_checks = excluded.ok_checks, slow_checks = excluded.slow_checks,
         p50_ms = excluded.p50_ms, p95_ms = excluded.p95_ms, max_ms = excluded.max_ms, hist = excluded.hist`,
    )
    .bind(
      site.id,
      hourTs,
      results.length,
      results.filter((r) => r.ok).length,
      results.filter((r) => r.slow).length,
      percentile(times, 50),
      percentile(times, 95),
      times.length ? Math.max(...times) : null,
      JSON.stringify(histOf(times)),
    )
    .run();
}

/** Once a day (the 03:00 UTC tick), drop raw checks past retention. */
async function prune(env: Env, now: number): Promise<void> {
  const d = new Date(now);
  if (d.getUTCHours() !== 3 || d.getUTCMinutes() >= 5) return;
  const cutoff = now - CHECK_RETENTION_DAYS * 86_400_000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM checks WHERE ts < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM hourly WHERE hour_ts < ?').bind(now - 400 * 86_400_000),
  ]);
}
