import type { SiteConfig } from '../config.ts';
import type { Env } from '../env.ts';
import { formatDuration, type AlertKind, type TargetResult } from './logic.ts';
import { pagerDutyEvent, sendPagerDuty, type PdInput } from './pagerduty.ts';

export interface AlertInput {
  kind: AlertKind | 'test';
  site: SiteConfig;
  now: number;
  downSince: number | null;
  results: TargetResult[];
  dashboardUrl: string | null;
  timeZone: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Recipients: the site's own list plus the global ALERT_EMAILS, de-duplicated. */
export function recipientsFor(site: SiteConfig, env: Env): string[] {
  const global = (env.ALERT_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...site.alertEmails.map((e) => e.toLowerCase()), ...global])];
}

export function buildAlert(input: AlertInput): { subject: string; text: string; html: string; summary: string } {
  const { site, kind, now } = input;
  const h = host(site.url);
  const downFor = input.downSince ? formatDuration(now - input.downSince) : null;
  const when = new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const copy = {
    down: {
      subject: `DOWN: ${site.name} (${h}) is not responding`,
      title: `${site.name} is down`,
      lead: `${h} failed its checks${downFor ? ` for ${downFor}` : ''}.`,
      color: '#B3261E',
    },
    reminder: {
      subject: `STILL DOWN ${downFor ?? ''}: ${site.name} (${h})`.replace(/\s+/g, ' '),
      title: `${site.name} is still down`,
      lead: `${h} has been unreachable for ${downFor ?? 'an unknown time'}.`,
      color: '#B3261E',
    },
    recovered: {
      subject: `RECOVERED: ${site.name} (${h}) is back${downFor ? ` after ${downFor}` : ''}`,
      title: `${site.name} is back up`,
      lead: `${h} is passing its checks again${downFor ? ` after ${downFor} of downtime` : ''}.`,
      color: '#1E6B4F',
    },
    test: {
      subject: 'Test alert from Pura Watcher',
      title: 'Alert test',
      lead: 'This is a test from Pura Watcher. Real alerts look like this and go to the same people.',
      color: '#173F3A',
    },
  }[kind];

  const base = input.dashboardUrl ? input.dashboardUrl.replace(/\/+$/, '') : null;
  const link = base ? (kind === 'test' ? `${base}/` : `${base}/sites/${site.id}`) : null;
  const rows = input.results.map((r) => {
    const label = r.kind === 'health' ? 'Health check' : 'Homepage';
    const detail = r.ok ? `HTTP ${r.code} in ${r.ms} ms` : r.error ?? 'failed';
    return { label, url: r.url, ok: r.ok, detail };
  });

  const text = [
    kind === 'test' ? copy.title : copy.title,
    '',
    copy.lead,
    input.downSince && kind !== 'test' ? `Down since ${when.format(input.downSince)}` : null,
    `Checked ${when.format(now)}`,
    '',
    ...rows.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.label}  ${r.url}  ${r.detail}`),
    '',
    link ? `Dashboard: ${link}` : `Site: ${site.url}`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#17201E;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D9DED9;border-radius:10px;overflow:hidden;">
  <div style="padding:18px 22px;background:${copy.color};color:#FFFFFF;">
    <div style="font-size:18px;font-weight:600;">${esc(copy.title)}</div>
  </div>
  <div style="padding:22px;">
    <p style="margin:0 0 14px;font-size:15px;line-height:1.5;">${esc(copy.lead)}</p>
    ${input.downSince && kind !== 'test' ? `<p style="margin:0 0 4px;font-size:13px;color:#56635F;">Down since ${esc(when.format(input.downSince))}</p>` : ''}
    <p style="margin:0 0 16px;font-size:13px;color:#56635F;">Checked ${esc(when.format(now))}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${rows
        .map(
          (r) => `<tr>
        <td style="padding:8px 0;border-top:1px solid #E6E9E6;font-weight:600;color:${r.ok ? '#1E6B4F' : '#B3261E'};width:44px;">${r.ok ? 'PASS' : 'FAIL'}</td>
        <td style="padding:8px 0;border-top:1px solid #E6E9E6;">${esc(r.label)}<br><span style="color:#56635F;font-family:ui-monospace,Menlo,monospace;font-size:12px;">${esc(r.url)}</span></td>
        <td style="padding:8px 0;border-top:1px solid #E6E9E6;text-align:right;color:#56635F;">${esc(r.detail)}</td>
      </tr>`,
        )
        .join('')}
    </table>
    ${link ? `<p style="margin:20px 0 0;"><a href="${esc(link)}" style="display:inline-block;padding:9px 14px;background:#173F3A;color:#FFFFFF;border-radius:6px;text-decoration:none;font-size:14px;">${kind === 'test' ? 'Open the dashboard' : `Open ${esc(site.name)} on the dashboard`}</a></p>` : ''}
  </div>
</div>
<p style="max-width:560px;margin:12px auto 0;font-size:12px;color:#6B7773;">Sent by Pura Watcher. Recipients are set per site in the watcher's config.</p>
</body></html>`;

  return { subject: copy.subject, text, html, summary: `${copy.title}. ${copy.lead}${link ? ` ${link}` : ''}` };
}

export interface SendResult {
  /** At least one channel delivered. */
  ok: boolean;
  /** Problems on any channel, even when another one delivered. */
  error?: string;
}

/**
 * Deliver one alert on every configured channel: PagerDuty (phone calls),
 * the chat webhook, and email via Resend. Never throws.
 */
export async function sendAlert(
  env: Env,
  to: string[],
  alert: ReturnType<typeof buildAlert>,
  /** Only for the dashboard's test alert; outages page PagerDuty via run.ts. */
  pd: PdInput | null = null,
): Promise<SendResult> {
  const errors: string[] = [];
  let delivered = false;
  let attempted = false;

  if (env.PAGERDUTY_ROUTING_KEY && pd) {
    const event = pagerDutyEvent(env.PAGERDUTY_ROUTING_KEY, pd);
    if (event) {
      attempted = true;
      const err = await sendPagerDuty(event, env.PAGERDUTY_EVENTS_URL || undefined);
      if (err) errors.push(err);
      else delivered = true;
    }
  }

  if (env.ALERT_WEBHOOK_URL) {
    attempted = true;
    try {
      // `text` for Slack, `content` for Discord.
      const res = await fetch(env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: alert.summary, content: alert.summary }),
      });
      if (res.ok) delivered = true;
      else errors.push(`webhook HTTP ${res.status}`);
    } catch (e) {
      errors.push(`webhook: ${(e as Error).message}`);
    }
  }

  if (to.length > 0) {
    attempted = true;
    if (!env.RESEND_API_KEY || !env.ALERT_FROM) {
      errors.push('email not configured (RESEND_API_KEY / ALERT_FROM)');
    } else {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.ALERT_FROM, to, subject: alert.subject, text: alert.text, html: alert.html }),
        });
        if (res.ok) delivered = true;
        else errors.push(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } catch (e) {
        errors.push(`Resend: ${(e as Error).message}`);
      }
    }
  }

  if (!attempted) {
    // Nothing to send here. Fine when PagerDuty is set up (the run loop pages
    // it separately); otherwise nobody is being told.
    return env.PAGERDUTY_ROUTING_KEY ? { ok: true } : { ok: false, error: 'no recipients configured' };
  }
  return { ok: delivered, error: errors.length ? errors.join('; ') : undefined };
}
