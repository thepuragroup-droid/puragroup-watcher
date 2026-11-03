/**
 * JSON API for Claude's triage and fix skills (.claude/skills/vercel-errors-*).
 * Auth: `Authorization: Bearer <WATCHER_API_TOKEN>`. Separate from the
 * dashboard password so it can be rotated, or left unset to turn the API off.
 *
 *   GET   /api/errors?site=&status=active|all|<status>&env=&q=&limit=
 *   GET   /api/errors/<fingerprint>               group + latest 50 occurrences
 *   PATCH /api/errors/<fingerprint>               analysis / status (validate.ts)
 *   GET   /api/sites                              site ids, names, repos, app folders
 *
 * Responses include each site's repo and app folder, so the fix skill knows
 * where to make the change.
 */
import { SITES, findSite } from '../config.ts';
import type { Env } from '../env.ts';
import { drainState, getGroup, groupEvents, listGroups, unmatchedProjects, updateGroup, type Group } from './store.ts';
import { validatePatch } from './validate.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function tokenOk(req: Request, env: Env): Promise<boolean> {
  const want = env.WATCHER_API_TOKEN;
  const got = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!want || !got) return false;
  // Compare digests so length differences don't leak through timing.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(got)), crypto.subtle.digest('SHA-256', enc.encode(want))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function withSite(g: Group) {
  const site = findSite(g.site_id);
  return { ...g, site: site ? { id: site.id, name: site.name, url: site.url, repo: site.repo, appDir: site.appDir } : null };
}

export async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  if (!env.WATCHER_API_TOKEN) return json({ error: 'API disabled: set the WATCHER_API_TOKEN secret' }, 503);
  if (!(await tokenOk(req, env))) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(req.url);
  const now = Date.now();

  if (path === '/api/sites' && req.method === 'GET') {
    return json({ sites: SITES.map((s) => ({ id: s.id, name: s.name, url: s.url, repo: s.repo, appDir: s.appDir, vercelProjectIds: s.vercelProjectIds })) });
  }

  if (path === '/api/errors' && req.method === 'GET') {
    const p = url.searchParams;
    const limit = Number(p.get('limit')) || 500;
    const [groups, drain, unmatched] = await Promise.all([
      listGroups(env, { site: p.get('site'), status: p.get('status'), environment: p.get('env'), q: p.get('q'), limit }, now),
      drainState(env),
      unmatchedProjects(env, now),
    ]);
    groups.sort((a, b) => b.priority - a.priority || b.last_24h - a.last_24h);
    return json({ now, drain, unmatched_projects: unmatched, count: groups.length, groups: groups.map(withSite) });
  }

  const m = path.match(/^\/api\/errors\/([0-9a-f]{16})$/);
  if (m) {
    const fp = m[1];
    if (req.method === 'GET') {
      const [group, events] = await Promise.all([getGroup(env, fp, now), groupEvents(env, fp, 50)]);
      if (!group) return json({ error: 'Not found' }, 404);
      return json({ group: withSite(group), events });
    }
    if (req.method === 'PATCH') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }
      const v = validatePatch(body, now);
      if (!v.ok) return json({ error: v.error }, 400);
      const group = await updateGroup(env, fp, v.patch, now);
      if (!group) return json({ error: 'Not found' }, 404);
      return json({ group: withSite(group) });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  return json({ error: 'Not found' }, 404);
}
