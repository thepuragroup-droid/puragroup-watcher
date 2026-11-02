/**
 * The sites the watcher checks. Edit this list and redeploy to add, remove or
 * re-point a site.
 *
 *   id           stable key stored in the database — never rename once live
 *   name         shown on the dashboard and in alert emails
 *   url          production origin, no trailing slash
 *   repo         GitHub repository (for the dashboard's "source" link)
 *   healthPath   JSON health endpoint ({"status":"ok"}); null = homepage only
 *   slowMs       a passing check slower than this is marked "slow"
 *   alertEmails  people alerted for THIS site, on top of the ALERT_EMAILS var
 *   failureThreshold  failed runs (5 min apart, each already retried once)
 *                     before an outage is declared. 1 = alert on first failed run.
 *   reminderMinutes   re-alert interval while still down; 0 = never
 */
export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  repo: string;
  healthPath: string | null;
  slowMs: number;
  alertEmails: string[];
  failureThreshold: number;
  reminderMinutes: number;
}

const defaults = {
  healthPath: '/api/health',
  slowMs: 3000,
  alertEmails: [] as string[],
  failureThreshold: 1,
  reminderMinutes: 60,
};

export const SITES: SiteConfig[] = [
  {
    ...defaults,
    id: 'vyta',
    name: 'VYTA Biosciences',
    url: 'https://www.vytabio.com',
    repo: 'thepuragroup-droid/vyta-rtl-x',
  },
  {
    ...defaults,
    id: 'aminocan',
    name: 'Aminocan',
    url: 'https://www.aminocan.com',
    repo: 'thepuragroup-droid/aminocan-cad',
  },
  {
    ...defaults,
    id: 'puramass',
    name: 'PURAMASS',
    url: 'https://puramass.com',
    repo: 'thepuragroup-droid/aminocan-whl',
  },
  {
    ...defaults,
    id: 'aminoex',
    name: 'Aminoex',
    url: 'https://aminoex.com',
    repo: 'thepuragroup-droid/aminoex',
  },
];

export function findSite(id: string): SiteConfig | undefined {
  return SITES.find((s) => s.id === id);
}

/** How often the cron runs. Keep in sync with wrangler.toml [triggers]. */
export const CHECK_INTERVAL_MS = 5 * 60_000;
/** Raw checks older than this are deleted (hourly rollups are kept). */
export const CHECK_RETENTION_DAYS = 90;
