/**
 * Dashboard login: one shared password (DASHBOARD_PASSWORD secret) exchanged
 * for an HMAC-signed, HttpOnly session cookie. Changing the password signs
 * everyone out. Alternatively, put the Worker behind Cloudflare Access and set
 * DASHBOARD_PUBLIC=1.
 */
import type { Env } from './env.ts';

const COOKIE = 'pw_session';
const MAX_AGE_S = 30 * 24 * 3600;
const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export type AuthState = 'ok' | 'login' | 'unconfigured';

export async function authState(req: Request, env: Env): Promise<AuthState> {
  if (env.DASHBOARD_PUBLIC === '1') return 'ok';
  if (!env.DASHBOARD_PASSWORD) return 'unconfigured';
  const raw = readCookie(req, COOKIE);
  if (!raw) return 'login';
  const [issued, sig] = raw.split('.');
  const age = Date.now() - Number(issued);
  if (!issued || !sig || !Number.isFinite(age) || age < 0 || age > MAX_AGE_S * 1000) return 'login';
  return safeEqual(sig, await hmac(env.DASHBOARD_PASSWORD, issued)) ? 'ok' : 'login';
}

export async function passwordMatches(env: Env, attempt: string): Promise<boolean> {
  if (!env.DASHBOARD_PASSWORD) return false;
  // Compare digests so length differences don't leak through timing.
  const [a, b] = await Promise.all([hmac('pw', attempt), hmac('pw', env.DASHBOARD_PASSWORD)]);
  return safeEqual(a, b);
}

export async function sessionCookie(env: Env): Promise<string> {
  const issued = String(Date.now());
  const sig = await hmac(env.DASHBOARD_PASSWORD ?? '', issued);
  return `${COOKIE}=${issued}.${sig}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** Reject cross-site form posts (the session cookie is SameSite=Lax). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');
  if (!origin) return true; // same-origin form posts from older browsers
  return origin === new URL(req.url).origin;
}
