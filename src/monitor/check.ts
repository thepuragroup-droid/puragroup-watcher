import type { SiteConfig } from '../config.ts';
import { judgeHealth, judgeHome, type TargetResult } from './logic.ts';

const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 5_000;

async function probe(site: SiteConfig, kind: 'health' | 'home'): Promise<TargetResult> {
  const url = kind === 'health' ? `${site.url}${site.healthPath}` : `${site.url}/`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'PuraWatcher/1.0 (+uptime monitor)',
        'Cache-Control': 'no-cache',
      },
    });
    // Read the body either way so the timing covers the full response.
    const body = await res.text();
    const ms = Date.now() - started;
    const error = kind === 'health' ? judgeHealth(res.status, body) : judgeHome(res.status);
    return { kind, url, ok: error === null, code: res.status, ms, error };
  } catch (err) {
    const e = err as Error;
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return {
      kind,
      url,
      ok: false,
      code: null,
      ms: Date.now() - started,
      error: timedOut
        ? `timed out after ${TIMEOUT_MS / 1000}s`
        : `connection failed (${(e?.message ?? String(err)).replace(/;?\s*reference = \w+/i, '').slice(0, 160)})`,
    };
  }
}

export interface SiteCheck {
  site: SiteConfig;
  results: TargetResult[];
  ok: boolean;
  slow: boolean;
  retried: boolean;
}

/** Check one site: health + homepage in parallel, failures retried once. */
export async function checkSite(site: SiteConfig): Promise<SiteCheck> {
  const kinds: Array<'health' | 'home'> = site.healthPath ? ['health', 'home'] : ['home'];
  let results = await Promise.all(kinds.map((k) => probe(site, k)));
  let retried = false;
  if (results.some((r) => !r.ok)) {
    retried = true;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    results = await Promise.all(results.map((r) => (r.ok ? r : probe(site, r.kind))));
  }
  const ok = results.every((r) => r.ok);
  const slow = ok && results.some((r) => r.ms > site.slowMs);
  return { site, results, ok, slow, retried };
}
