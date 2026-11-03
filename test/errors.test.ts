/**
 * Server errors: parsing, fingerprinting, site matching, the drain signature,
 * PATCH validation, sorting/grouping, and the real SQL (migrations + every
 * store.ts query) run on node:sqlite through a small D1 stand-in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  autoPriority,
  extractErrorEvents,
  headline,
  isErrorLog,
  normalizeRoute,
  normalizeText,
  parseDrainBody,
  resolveSite,
  toErrorEvent,
  topAppFrame,
  UNMATCHED,
  type DrainLog,
} from '../src/errors/normalize.ts';
import { signatureMatches, verifyValue } from '../src/errors/ingest.ts';
import { validatePatch } from '../src/errors/validate.ts';
import {
  drainState,
  errorCountsBySite,
  getGroup,
  groupEvents,
  insertEvents,
  listGroups,
  noteDrainReceived,
  noteDrainRejected,
  pruneErrorEvents,
  unmatchedProjects,
  updateGroup,
  type Group,
} from '../src/errors/store.ts';
import { sectionize, sortGroups } from '../src/ui/errors.ts';
import type { Env } from '../src/env.ts';

const SITES = [
  { id: 'vyta', url: 'https://www.vytabio.com', vercelProjectIds: ['prj_vyta'] },
  { id: 'aminoex', url: 'https://aminoex.com', vercelProjectIds: [] },
];

const stack = (id: string, line: number) =>
  `2026-11-02T12:00:00.000Z\t${id}\tERROR\tTypeError: Cannot read properties of undefined (reading 'total') for order ${id}\n` +
  `    at computeTotals (/var/task/.next/server/app/api/checkout/route.js:1:${line})\n` +
  `    at async POST (/var/task/node_modules/next/dist/server/foo.js:2:3)`;

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test('parseDrainBody: JSON array, single object, NDJSON, junk', () => {
  assert.equal(parseDrainBody('[{"id":"a"},{"id":"b"},3]').length, 2);
  assert.equal(parseDrainBody('{"id":"a"}').length, 1);
  assert.equal(parseDrainBody('{"id":"a"}\n{"id":"b"}\nnot json\n').length, 2);
  assert.equal(parseDrainBody('').length, 0);
});

test('isErrorLog keeps errors and 5xx, drops info, warnings and 4xx', () => {
  assert.equal(isErrorLog({ level: 'error' }), true);
  assert.equal(isErrorLog({ level: 'fatal' }), true);
  assert.equal(isErrorLog({ level: 'info', proxy: { statusCode: 502 } }), true);
  assert.equal(isErrorLog({ level: 'info', statusCode: 404 }), false);
  assert.equal(isErrorLog({ level: 'warning' }), false);
  assert.equal(isErrorLog({ type: 'stderr' }), true);
});

test('normalizeRoute and normalizeText strip what varies', () => {
  assert.equal(normalizeRoute('/api/orders/3f2a9c1e-1111-2222-3333-444455556666/items/42?x=1'), '/api/orders/:id/items/:id');
  assert.equal(normalizeRoute('/products/bpc-157'), '/products/bpc-157');
  assert.equal(
    normalizeText('Order 123 for bob@x.com at 2026-11-02T12:00:00.000Z id 3f2a9c1e-1111-2222-3333-444455556666'),
    'Order <n> for <email> at <time> id <uuid>',
  );
  assert.equal(normalizeText('fetch https://api.x.com/v1/a/123?k=s failed'), 'fetch https://api.x.com/v1/a/:id failed');
  // Prefixed ids, in URLs and in text, collapse so one outage is one group.
  assert.equal(
    normalizeText('request to https://api.easyship.com/2024-09/shipments/ESCA10002 failed'),
    normalizeText('request to https://api.easyship.com/2024-09/shipments/ESCA10000 failed'),
  );
  assert.equal(normalizeText('Invoice INV-20481 not found'), 'Invoice <id> not found');
  assert.equal(normalizeRoute('/api/invoices/INV-20481'), '/api/invoices/:id');
});

test('headline skips the Lambda prefix; topAppFrame skips dependencies', () => {
  const m = stack('req-1', 99);
  assert.match(headline(m), /^TypeError: Cannot read properties of undefined/);
  assert.equal(topAppFrame(m), 'at computeTotals (/.next/server/app/api/checkout/route.js)');
});

test('resolveSite: project id first, then host (with or without www), else unmatched', () => {
  assert.equal(resolveSite({ projectId: 'prj_vyta' }, SITES), 'vyta');
  assert.equal(resolveSite({ projectId: 'prj_other', proxy: { host: 'aminoex.com' } }, SITES), 'aminoex');
  assert.equal(resolveSite({ host: 'vytabio.com' }, SITES), 'vyta');
  assert.equal(resolveSite({ host: 'www.aminoex.com:443' }, SITES), 'aminoex');
  assert.equal(resolveSite({ projectId: 'prj_x', host: 'x.vercel.app' }, SITES), UNMATCHED);
});

test('fingerprints: same bug → same; other bug, route or site → different', async () => {
  const base: DrainLog = { source: 'lambda', level: 'error', proxy: { path: '/api/checkout', statusCode: 500 } };
  const a = await toErrorEvent({ ...base, id: '1', message: stack('aaaaaaaa-1111-2222-3333-444455556666', 10) }, 'vyta');
  const b = await toErrorEvent({ ...base, id: '2', message: stack('bbbbbbbb-1111-2222-3333-444455556666', 20) }, 'vyta');
  const c = await toErrorEvent({ ...base, id: '3', message: 'RangeError: Invalid time value' }, 'vyta');
  const d = await toErrorEvent({ ...base, id: '4', proxy: { path: '/api/orders' }, message: 'RangeError: Invalid time value' }, 'vyta');
  const e = await toErrorEvent({ ...base, id: '5', message: stack('cccccccc-1111-2222-3333-444455556666', 30) }, 'aminoex');
  assert.match(a.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.notEqual(c.fingerprint, d.fingerprint);
  assert.notEqual(a.fingerprint, e.fingerprint, 'the same bug on two sites is two groups');
});

test('a bare 5xx line gets a readable title; missing timestamp falls back to now', async () => {
  const e = await toErrorEvent({ source: 'lambda', proxy: { path: '/api/orders/42', method: 'POST', statusCode: 504 } }, 'vyta', 1000);
  assert.equal(e.title, 'HTTP 504 POST /api/orders/:id');
  assert.equal(e.ts, 1000);
  assert.equal(e.vercel_log_id, null);
});

test('extractErrorEvents filters a mixed batch and assigns sites', async () => {
  const body = JSON.stringify([
    { id: '1', level: 'info', message: 'ok', projectId: 'prj_vyta' },
    { id: '2', level: 'error', message: 'Error: boom', projectId: 'prj_vyta' },
    { id: '3', level: 'info', proxy: { statusCode: 500, path: '/', host: 'aminoex.com' } },
  ]);
  const rows = await extractErrorEvents(body, SITES);
  assert.deepEqual(rows.map((r) => [r.vercel_log_id, r.site_id]), [['2', 'vyta'], ['3', 'aminoex']]);
});

test('autoPriority: revenue path, volume and recency rank higher; fixed/ignored are 0', () => {
  const now = Date.UTC(2026, 10, 2, 12);
  const checkout = autoPriority({ route: '/api/checkout', level: 'error', last_status_code: 500, last_24h: 40, last_7d: 100, last_seen_at: now - 600_000, status: 'open' }, now);
  const page = autoPriority({ route: '/about', level: 'error', last_status_code: null, last_24h: 0, last_7d: 1, last_seen_at: now - 5 * 86_400_000, status: 'open' }, now);
  assert.ok(checkout > page && checkout <= 100);
  assert.equal(autoPriority({ route: '/api/checkout', level: 'fatal', last_status_code: 500, last_24h: 9, last_7d: 9, last_seen_at: now, status: 'ignored' }, now), 0);
});

test('signatureMatches: HMAC-SHA1 hex under any configured secret', async () => {
  const body = new TextEncoder().encode('[{"id":"1"}]').buffer as ArrayBuffer;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('team-b-secret'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, body))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(await signatureMatches(body, sig, ['team-a-secret', 'team-b-secret']), true);
  assert.equal(await signatureMatches(body, sig.toUpperCase(), ['team-b-secret']), true);
  assert.equal(await signatureMatches(body, sig, ['wrong']), false);
  assert.equal(await signatureMatches(body, null, ['team-b-secret']), false);
});

test('verifyValue: one plain value, or team=value pairs chosen by ?team=', () => {
  assert.equal(verifyValue('abc', null), 'abc');
  assert.equal(verifyValue('a=1, b=2', 'b'), '2');
  assert.equal(verifyValue('a=1,b=2', 'c'), null);
  assert.equal(verifyValue(undefined, null), null);
});

test('validatePatch accepts an analysis and rejects bad input', () => {
  const ok = validatePatch(
    { score: 82, severity: 'critical', category: 'bug', confidence: 'high', root_cause: ' x ', solution: 'y', affected_files: ['app/api/checkout/route.ts'], analyzed: true, status: 'analyzed' },
    5,
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.patch.root_cause, 'x');
    assert.equal(ok.patch.analyzed_at, 5);
  }
  assert.equal(validatePatch({ score: 101 }).ok, false);
  assert.equal(validatePatch({ status: 'done' }).ok, false);
  assert.equal(validatePatch({ fix_ref: 'javascript:alert(1)' }).ok, false);
  assert.ok(validatePatch({ fix_ref: 'https://github.com/o/r/pull/1' }).ok);
  assert.equal(validatePatch({ fixed_at: 1 }).ok, false, 'fixed_at is set by marking fixed, not directly');
  assert.equal(validatePatch({}).ok, false);
  assert.equal(validatePatch([]).ok, false);
});

// ---------------------------------------------------------------------------
// SQL, on node:sqlite through a minimal D1 stand-in
// ---------------------------------------------------------------------------

function d1(db: DatabaseSync) {
  class Stmt {
    sql: string;
    params: unknown[];
    constructor(sql: string, params: unknown[] = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...p: unknown[]) {
      return new Stmt(this.sql, p);
    }
    async all<T>() {
      return { results: db.prepare(this.sql).all(...(this.params as never[])) as T[] };
    }
    async first<T>() {
      return (db.prepare(this.sql).get(...(this.params as never[])) as T) ?? null;
    }
    async run() {
      const r = db.prepare(this.sql).run(...(this.params as never[]));
      return { meta: { changes: Number(r.changes) } };
    }
  }
  return {
    prepare: (sql: string) => new Stmt(sql),
    batch: async (stmts: Stmt[]) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function freshEnv(): Env {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  // Migrations are idempotent where they create things; re-running 0004 must be safe.
  db.exec(readFileSync(new URL('0004_vercel_errors.sql', dir), 'utf8'));
  return { DB: d1(db) } as unknown as Env;
}

const H = 3_600_000;

test('store: insert rolls up, dedupes retries, counts windows, flags regressions, prunes', async () => {
  const env = freshEnv();
  const now = Date.UTC(2026, 10, 2, 12);
  const mk = (id: string, ts: number, site = 'vyta', msg = 'Error: boom') =>
    toErrorEvent({ id, timestamp: ts, level: 'error', message: msg, source: 'lambda', proxy: { path: '/api/checkout', statusCode: 500 }, environment: 'production' }, site);

  const rows = await Promise.all([mk('a', now - 2 * H), mk('b', now - H), mk('c', now - 3 * 86_400_000), mk('d', now - 40 * 86_400_000, 'aminoex', 'Error: old')]);
  assert.equal(await insertEvents(env, rows, now), 4);
  assert.equal(await insertEvents(env, [await mk('a', now)], now), 0, 'a retried batch is ignored');

  const fp = rows[0].fingerprint;
  let g = (await getGroup(env, fp, now)) as Group;
  assert.equal(g.event_count, 3);
  assert.equal(g.last_24h, 2);
  assert.equal(g.last_7d, 3);
  assert.equal(g.first_seen_at, now - 3 * 86_400_000);
  assert.equal(g.last_seen_at, now - H);
  assert.equal(g.status, 'open');
  assert.equal(g.scored, false);

  // Analysis, then fixed, then a new occurrence → regressed.
  const v = validatePatch({ score: 77, severity: 'critical', root_cause: 'r', solution: 's', affected_files: ['a.ts'], analyzed: true, status: 'analyzed' }, now);
  assert.ok(v.ok);
  if (v.ok) g = (await updateGroup(env, fp, v.patch, now)) as Group;
  assert.equal(g.priority, 77);
  assert.deepEqual(g.affected_files, ['a.ts']);
  g = (await updateGroup(env, fp, { status: 'fixed' }, now)) as Group;
  assert.equal(g.fixed_at, now);
  await insertEvents(env, [await mk('e', now + H)], now + H);
  g = (await getGroup(env, fp, now + H)) as Group;
  assert.equal(g.status, 'regressed');
  assert.equal(g.event_count, 4);

  // Ignored stays ignored.
  const oldFp = rows[3].fingerprint;
  await updateGroup(env, oldFp, { status: 'ignored' }, now);
  await insertEvents(env, [await mk('f', now, 'aminoex', 'Error: old')], now);
  assert.equal((await getGroup(env, oldFp, now))?.status, 'ignored');

  // Lists and filters.
  assert.deepEqual((await listGroups(env, {}, now + H)).map((x) => x.fingerprint), [fp]);
  assert.equal((await listGroups(env, { status: 'all' }, now)).length, 2);
  assert.equal((await listGroups(env, { status: 'all', site: 'aminoex' }, now)).length, 1);
  assert.equal((await listGroups(env, { status: 'all', q: 'old' }, now)).length, 1);
  assert.equal((await listGroups(env, { status: 'all', environment: 'preview' }, now)).length, 0);
  assert.equal((await groupEvents(env, fp)).length, 4);

  const counts = await errorCountsBySite(env, now + H);
  assert.equal(counts.get('vyta')?.active, 1);
  assert.equal(counts.get('vyta')?.regressed, 1);
  assert.equal(counts.get('aminoex')?.active, 0);

  await pruneErrorEvents(env, now);
  assert.equal((await groupEvents(env, oldFp)).length, 1, 'the 40-day-old occurrence is pruned');
  assert.equal((await getGroup(env, oldFp, now))?.event_count, 2, 'group totals survive pruning');
});

test('store: unmatched projects and drain health', async () => {
  const env = freshEnv();
  const now = Date.UTC(2026, 10, 2, 12);
  const e = await toErrorEvent({ id: 'u', timestamp: now, level: 'error', message: 'Error: x', projectId: 'prj_new', host: 'new.vercel.app' }, UNMATCHED);
  await insertEvents(env, [e], now);
  const u = await unmatchedProjects(env, now);
  assert.equal(u[0].project_id, 'prj_new');
  assert.equal(u[0].n, 1);

  assert.equal((await drainState(env)).last_received_at, null);
  await noteDrainReceived(env, now);
  await noteDrainReceived(env, now + 1000); // within a minute: no write
  assert.equal((await drainState(env)).last_received_at, now);
  await noteDrainRejected(env, 'bad signature', now);
  assert.equal((await drainState(env)).last_rejected_reason, 'bad signature');
});

// ---------------------------------------------------------------------------
// Dashboard ordering
// ---------------------------------------------------------------------------

test('sortGroups and sectionize', () => {
  const g = (p: Partial<Group>): Group =>
    ({ fingerprint: 'x', site_id: 'vyta', title: 't', route: null, priority: 0, last_24h: 0, event_count: 0, last_seen_at: 0, first_seen_at: 0, severity: null, status: 'open', ...p }) as Group;
  const rows = [
    g({ fingerprint: 'a', priority: 10, last_24h: 50, site_id: 'aminoex', severity: 'low' }),
    g({ fingerprint: 'b', priority: 90, last_24h: 1, site_id: 'vyta', severity: 'critical' }),
    g({ fingerprint: 'c', priority: 40, last_24h: 5, site_id: UNMATCHED }),
  ];
  assert.deepEqual(sortGroups(rows, 'priority').map((r) => r.fingerprint), ['b', 'c', 'a']);
  assert.deepEqual(sortGroups(rows, 'recent').map((r) => r.fingerprint), ['a', 'c', 'b']);
  assert.deepEqual(sectionize(rows, 'site').map((s) => s.key), ['vyta', 'aminoex', UNMATCHED], 'config order, unmatched last');
  assert.deepEqual(sectionize(rows, 'severity').map((s) => s.label), ['Critical', 'Low', 'Not analysed yet']);
  assert.equal(sectionize(rows, 'none')[0].rows.length, 3);
});
