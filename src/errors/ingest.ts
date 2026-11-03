/**
 * Vercel Log Drain receiver: POST /ingest/vercel (public, signature-checked).
 *
 * One drain per Vercel team, covering the sites' projects, all pointed here.
 * Each POST carries `x-vercel-signature` = HMAC-SHA1(body, drain secret) hex.
 * Error/fatal lines and 5xx responses are kept; everything else is dropped.
 * When adding the drain, Vercel asks this URL to echo a verification value in
 * the `x-vercel-verify` header; every response here carries it.
 */
import { SITES } from '../config.ts';
import type { Env } from '../env.ts';
import { extractErrorEvents } from './normalize.ts';
import { insertEvents, noteDrainReceived, noteDrainRejected } from './store.ts';

/** Batches bigger than this are refused (Vercel's are far smaller). */
const MAX_BODY_BYTES = 5_000_000;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** True when `signature` is HMAC-SHA1 (or SHA-256) of `body` under any of the secrets. */
export async function signatureMatches(body: ArrayBuffer, signature: string | null, secrets: string[]): Promise<boolean> {
  if (!signature) return false;
  const given = signature.trim().toLowerCase();
  const enc = new TextEncoder();
  for (const secret of secrets) {
    for (const hash of ['SHA-1', 'SHA-256'] as const) {
      const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
      if (safeEqual(hex(await crypto.subtle.sign('HMAC', key, body)), given)) return true;
    }
  }
  return false;
}

export function splitList(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The value to echo in `x-vercel-verify`. VERCEL_DRAIN_VERIFY is either one
 * plain value, or `team=value` pairs picked by the URL's `?team=`.
 */
export function verifyValue(setting: string | undefined, team: string | null): string | null {
  const parts = splitList(setting);
  if (parts.length === 0) return null;
  const pairs = parts.filter((p) => p.includes('='));
  if (pairs.length === 0) return parts[0];
  const hit = pairs.find((p) => p.slice(0, p.indexOf('=')) === team);
  return hit ? hit.slice(hit.indexOf('=') + 1) : null;
}

function reply(env: Env, url: URL, body: unknown, status = 200): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const verify = verifyValue(env.VERCEL_DRAIN_VERIFY, url.searchParams.get('team'));
  if (verify) headers['x-vercel-verify'] = verify;
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleIngest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  // Vercel's ownership check, and a handy "is it deployed?" probe.
  if (req.method === 'GET' || req.method === 'HEAD') return reply(env, url, { ok: true });
  if (req.method !== 'POST') return reply(env, url, { error: 'Method not allowed' }, 405);

  const secrets = splitList(env.VERCEL_DRAIN_SECRETS);
  if (secrets.length === 0) {
    await noteDrainRejected(env, 'VERCEL_DRAIN_SECRETS is not set');
    return reply(env, url, { error: 'Drain not configured' }, 503);
  }

  const length = Number(req.headers.get('Content-Length') ?? 0);
  if (length > MAX_BODY_BYTES) return reply(env, url, { error: 'Too large' }, 413);
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return reply(env, url, { error: 'Too large' }, 413);

  if (!(await signatureMatches(body, req.headers.get('x-vercel-signature'), secrets))) {
    await noteDrainRejected(env, 'Signature did not match any VERCEL_DRAIN_SECRETS value');
    return reply(env, url, { error: 'Invalid signature' }, 401);
  }

  const now = Date.now();
  const rows = await extractErrorEvents(new TextDecoder().decode(body), SITES, now);
  // A store failure throws → 500 → Vercel retries the batch; retried lines
  // are deduplicated by their log id.
  const stored = rows.length ? await insertEvents(env, rows, now) : 0;
  await noteDrainReceived(env, now);
  return reply(env, url, { ok: true, errors: rows.length, stored });
}
