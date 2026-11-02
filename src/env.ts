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
  /** Set to "1" only when the Worker sits behind Cloudflare Access. */
  DASHBOARD_PUBLIC?: string;
}

export function timezone(env: Env): string {
  return env.TIMEZONE || 'America/Toronto';
}
