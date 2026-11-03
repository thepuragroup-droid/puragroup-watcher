export interface Env {
  DB: D1Database;
  TIMEZONE?: string;
  DASHBOARD_URL?: string;
  ALERT_FROM?: string;
  ALERT_EMAILS?: string;
  // secrets
  DASHBOARD_PASSWORD?: string;
  RESEND_API_KEY?: string;
  ALERT_WEBHOOK_URL?: string;
  /** PagerDuty Events API v2 integration key (calls your phone). */
  PAGERDUTY_ROUTING_KEY?: string;
  /** Testing only: send PagerDuty events somewhere else (e.g. a local receiver). */
  PAGERDUTY_EVENTS_URL?: string;
  /** Set to "1" only when the Worker sits behind Cloudflare Access. */
  DASHBOARD_PUBLIC?: string;
  /**
   * Vercel Log Drain signing secret(s). Comma-separated when the sites live in
   * more than one Vercel team (one drain, and one secret, per team).
   */
  VERCEL_DRAIN_SECRETS?: string;
  /**
   * The value Vercel asks the drain endpoint to echo in `x-vercel-verify`.
   * One team: the plain value. Several: `team-a=value,team-b=value`, with
   * each drain's URL ending in `?team=team-a` etc.
   */
  VERCEL_DRAIN_VERIFY?: string;
  /** Bearer token for /api/errors (Claude's triage and fix skills). */
  WATCHER_API_TOKEN?: string;
}

export function timezone(env: Env): string {
  return env.TIMEZONE || 'America/Toronto';
}
