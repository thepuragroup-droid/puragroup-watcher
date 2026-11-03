/**
 * Server errors from Vercel: pure rules shared by the drain endpoint
 * (src/errors/ingest.ts) and the tests (test/errors.test.ts).
 *
 *   parseDrainBody   raw drain POST body (JSON array, one object, or NDJSON) → logs
 *   isErrorLog       is this line worth keeping (error/fatal level, or a 5xx)?
 *   resolveSite      which watched site a line belongs to (Vercel project id, then host)
 *   toErrorEvent     log → error_events row, with a stable fingerprint
 *   autoPriority     0–100 sort key for groups the triage skill hasn't scored yet
 *
 * The fingerprint decides what "the same error" means, so the dashboard shows
 * one row per bug rather than one per occurrence. It hashes:
 *   site | source | normalized route | normalized headline | first app stack frame
 * where "normalized" strips what changes between occurrences: timestamps,
 * request ids, UUIDs, long hex, emails, numbers, line:column, query strings.
 *
 * Only Web Crypto, so it runs in the Worker and under `node --test`.
 */

/** The fields we use from a Vercel Log Drain JSON line (all optional on the wire). */
export interface DrainLog {
  id?: string;
  message?: string;
  timestamp?: number;
  type?: string;            // stdout | stderr | request | ...
  source?: string;          // lambda | edge | build | static | external | firewall | redirect
  projectId?: string;
  deploymentId?: string;
  host?: string;
  path?: string;
  entrypoint?: string;
  requestId?: string;
  statusCode?: number;
  level?: string;           // info | warning | error | fatal
  environment?: string;     // production | preview
  branch?: string;
  executionRegion?: string;
  proxy?: {
    method?: string;
    path?: string;
    host?: string;
    statusCode?: number;
    region?: string;
  };
}

/** One row for vercel_error_events. */
export interface ErrorEventRow {
  vercel_log_id: string | null;
  fingerprint: string;
  site_id: string;
  title: string;
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
  route: string | null;
  status_code: number | null;
  request_id: string | null;
  region: string | null;
  entrypoint: string | null;
  message: string | null;
}

/** Lines from Vercel projects that no site in src/config.ts claims. */
export const UNMATCHED = 'unmatched';

const MAX_MESSAGE_CHARS = 8_000;
const MAX_TITLE_CHARS = 200;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * A drain body is a JSON array (format "json"), a single object, or NDJSON
 * (format "ndjson"). Lines that aren't objects are skipped, never fatal.
 */
export function parseDrainBody(raw: string): DrainLog[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(isObject) as DrainLog[];
    if (isObject(parsed)) return [parsed as DrainLog];
    return [];
  } catch {
    // Not one JSON document — try NDJSON.
  }
  const out: DrainLog[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      const v = JSON.parse(l);
      if (isObject(v)) out.push(v as DrainLog);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function statusOf(log: DrainLog): number | null {
  const s = log.proxy?.statusCode ?? log.statusCode;
  return typeof s === 'number' && Number.isFinite(s) ? s : null;
}

function rawPath(log: DrainLog): string | null {
  const p = log.proxy?.path ?? log.path;
  return typeof p === 'string' && p ? p : null;
}

/** Keep error/fatal lines, any 5xx, and stderr lines with no level. */
export function isErrorLog(log: DrainLog): boolean {
  const level = (log.level ?? '').toLowerCase();
  if (level === 'error' || level === 'fatal') return true;

  const status = statusOf(log);
  if (status !== null && status >= 500) return true;

  if (!level && log.type === 'stderr') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function stripQuery(path: string): string {
  const q = path.search(/[?#]/);
  return q === -1 ? path : path.slice(0, q);
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Collapse id-like path segments: /api/orders/3f2a…/items/42 → /api/orders/:id/items/:id.
 * A segment is an id if it is a UUID, all digits, long hex, or long and contains a digit.
 */
export function normalizeRoute(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = stripQuery(path);
  const segs = clean.split('/').map((seg) => {
    if (!seg) return seg;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
    if (/^\d+$/.test(seg)) return ':id';
    if (/^[0-9a-f]{12,}$/i.test(seg)) return ':id';
    if (seg.length >= 16 && /\d/.test(seg)) return ':id';
    if (/\d{4,}/.test(seg)) return ':id'; // ESCA10000, 2024-09; keeps slugs like bpc-157
    return seg;
  });
  return segs.join('/') || '/';
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Lambda's stdout/stderr format prefixes each line with
 * "<ISO time>\t<request id>\t<LEVEL>\t". Drop it so the message starts at the error.
 */
function stripRuntimePrefix(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\t[^\t]*\t(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\t/, '');
}

/** Replace the parts of a line that vary between occurrences of the same error. */
export function normalizeText(s: string): string {
  return s
    .replace(ANSI_RE, '')
    .replace(UUID_RE, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/(https?:\/\/[^\s/'"`]+)([^\s'"`]*)/g, (_m, origin: string, rest: string) => origin + (normalizeRoute(rest) ?? ''))
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    // Ids with a letter prefix: ESCA10000, INV-20481, ORD_5532.
    .replace(/\b[A-Za-z]+[_-]?\d{4,}[A-Za-z0-9_-]*\b/g, '<id>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    // Long tokens mixing letters and digits: request ids, tx hashes, API keys.
    .replace(/\b(?=[A-Za-z0-9_-]{16,}\b)(?=[A-Za-z_-]*\d)(?=[0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b/g, '<id>')
    .replace(/:\d+:\d+\b/g, '')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lines of a message with the runtime prefix and colour codes removed. */
function messageLines(message: string): string[] {
  return message
    .replace(ANSI_RE, '')
    .split(/\r?\n/)
    .map((l) => stripRuntimePrefix(l).trimEnd())
    .filter((l) => l.trim().length > 0);
}

/** The first line that isn't a stack frame — the error's own description. */
export function headline(message: string | null | undefined): string {
  if (!message) return '';
  const lines = messageLines(message);
  const first = lines.find((l) => !/^\s*at\s/.test(l));
  return (first ?? lines[0] ?? '').trim();
}

/**
 * The first stack frame that points into the app rather than a dependency or
 * Node internals, with line:column dropped (they change every build).
 */
export function topAppFrame(message: string | null | undefined): string | null {
  if (!message) return null;
  for (const raw of messageLines(message)) {
    const l = raw.trim();
    if (!l.startsWith('at ')) continue;
    if (/node_modules|node:internal|\(node:|<anonymous>|internal\/|webpack-runtime|next-server|next\/dist/.test(l)) continue;
    return l
      .replace(/:\d+:\d+\)?$/, (m) => (m.endsWith(')') ? ')' : ''))
      .replace(/\/var\/task\//, '/')
      .replace(/\s+/g, ' ');
  }
  return null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---------------------------------------------------------------------------
// Event + fingerprint
// ---------------------------------------------------------------------------

export async function fingerprintOf(parts: {
  site: string;
  source: string | null;
  route: string | null;
  headline: string;
  frame: string | null;
}): Promise<string> {
  const key = [
    parts.site,
    parts.source ?? '',
    parts.route ?? '',
    normalizeText(parts.headline),
    parts.frame ? normalizeText(parts.frame) : '',
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/** What resolveSite needs from each configured site. */
export interface SiteMatcher {
  id: string;
  url: string;
  vercelProjectIds?: string[];
}

function bareHost(h: string): string {
  return h.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

/**
 * Which site a line belongs to: its Vercel project id if a site lists it,
 * otherwise the request host matched against each site's URL. Lines with
 * neither (e.g. a build of a project nobody listed) are UNMATCHED, and the
 * dashboard shows their project ids so they can be added to src/config.ts.
 */
export function resolveSite(log: DrainLog, sites: SiteMatcher[]): string {
  if (log.projectId) {
    const byProject = sites.find((s) => s.vercelProjectIds?.includes(log.projectId!));
    if (byProject) return byProject.id;
  }
  const h = log.proxy?.host ?? log.host;
  if (h) {
    const want = bareHost(h);
    for (const s of sites) {
      try {
        if (bareHost(new URL(s.url).host) === want) return s.id;
      } catch {
        /* bad url in config */
      }
    }
  }
  return UNMATCHED;
}

/** Map a kept drain line to an event row. `now` is for logs without a timestamp. */
export async function toErrorEvent(log: DrainLog, siteId: string, now: number = Date.now()): Promise<ErrorEventRow> {
  const source = log.source ?? null;
  const path = rawPath(log);
  const route = normalizeRoute(path);
  const status = statusOf(log);
  const method = log.proxy?.method ?? null;

  const message = typeof log.message === 'string' && log.message.trim() ? log.message : null;
  let head = headline(message);
  if (!head) {
    // A bare request line: name it after the response.
    head = status !== null
      ? `HTTP ${status}${method ? ` ${method}` : ''} ${route ?? ''}`.trim()
      : `${(log.level ?? 'error').toUpperCase()} from ${source ?? 'unknown source'}`;
  }
  const frame = topAppFrame(message);

  const ts = typeof log.timestamp === 'number' && Number.isFinite(log.timestamp) && log.timestamp > 0
    ? log.timestamp
    : now;

  return {
    vercel_log_id: typeof log.id === 'string' && log.id ? log.id : null,
    fingerprint: await fingerprintOf({ site: siteId, source, route, headline: head, frame }),
    site_id: siteId,
    title: truncate(head, MAX_TITLE_CHARS),
    ts,
    project_id: log.projectId ?? null,
    source,
    level: log.level ?? null,
    environment: log.environment ?? null,
    deployment_id: log.deploymentId ?? null,
    branch: log.branch ?? null,
    host: log.proxy?.host ?? log.host ?? null,
    method,
    path: path ? stripQuery(path) : null,
    route,
    status_code: status,
    request_id: log.requestId ?? null,
    region: log.proxy?.region ?? log.executionRegion ?? null,
    entrypoint: log.entrypoint ?? null,
    message: message ? truncate(message, MAX_MESSAGE_CHARS) : null,
  };
}

/** Parse a drain body and return only the error rows, each assigned to a site. */
export async function extractErrorEvents(raw: string, sites: SiteMatcher[], now: number = Date.now()): Promise<ErrorEventRow[]> {
  const logs = parseDrainBody(raw).filter(isErrorLog);
  return Promise.all(logs.map((l) => toErrorEvent(l, resolveSite(l, sites), now)));
}

// ---------------------------------------------------------------------------
// Default priority (until the triage skill sets a real score)
// ---------------------------------------------------------------------------

/** Routes where an error costs money or orders. */
const CRITICAL_ROUTE_RE = /checkout|payment|pay\b|order|invoice|webhook|cart|cron|auth|login|signup/i;

export interface PriorityInput {
  route: string | null;
  level: string | null;
  last_status_code: number | null;
  last_24h: number;
  last_7d: number;
  last_seen_at: number;
  status: string;
  source?: string | null;
}

/**
 * A rough 0–100 urgency for sorting before Claude has analysed a group.
 * Revenue paths, fatal/5xx, volume, recency and regressions push it up.
 */
export function autoPriority(g: PriorityInput, now: number = Date.now()): number {
  if (g.status === 'ignored' || g.status === 'fixed') return 0;
  let p = 0;
  if (g.route && CRITICAL_ROUTE_RE.test(g.route)) p += 30;
  else if (g.route?.startsWith('/api/')) p += 15;
  else p += 5;
  if (g.source === 'build') p += 20; // a failing build blocks every deploy
  if ((g.level ?? '').toLowerCase() === 'fatal') p += 20;
  if (g.last_status_code !== null && g.last_status_code >= 500) p += 10;
  p += Math.min(25, Math.round(Math.log2(1 + g.last_24h) * 5));
  p += Math.min(10, Math.round(Math.log2(1 + g.last_7d) * 2));
  const ageH = (now - g.last_seen_at) / 3_600_000;
  if (ageH < 1) p += 15;
  else if (ageH < 24) p += 10;
  else if (ageH < 24 * 7) p += 3;
  if (g.status === 'regressed') p += 15;
  return Math.max(0, Math.min(100, p));
}
