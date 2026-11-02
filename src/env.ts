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
}

export function timezone(env: Env): string {
  return env.TIMEZONE || 'America/Toronto';
}
