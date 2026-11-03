/**
 * Validation for writes to an error group (PATCH /api/errors/:fp from the
 * skills, and the dashboard's status buttons). Pure, so it's unit-tested.
 */
import { SEVERITIES, STATUSES, type GroupPatch } from './store.ts';

const TEXT_LIMITS: Record<string, number> = {
  category: 40,
  root_cause: 4000,
  solution: 6000,
  fix_ref: 500,
  status_note: 2000,
};

export type PatchResult = { ok: true; patch: GroupPatch } | { ok: false; error: string };

export function validatePatch(body: unknown, now = Date.now()): PatchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const patch: GroupPatch = {};
  const allowed = new Set(['status', 'score', 'severity', 'category', 'root_cause', 'solution', 'confidence', 'affected_files', 'fix_ref', 'status_note', 'analyzed']);
  const unknown = Object.keys(b).filter((k) => !allowed.has(k));
  if (unknown.length) return { ok: false, error: `Unknown field(s): ${unknown.join(', ')}` };

  if (b.status !== undefined) {
    if (!(STATUSES as readonly unknown[]).includes(b.status)) return { ok: false, error: `status must be one of ${STATUSES.join(', ')}` };
    patch.status = b.status as GroupPatch['status'];
  }
  if (b.score !== undefined) {
    if (b.score !== null && (typeof b.score !== 'number' || !Number.isInteger(b.score) || b.score < 0 || b.score > 100)) {
      return { ok: false, error: 'score must be an integer 0–100' };
    }
    patch.score = b.score as number | null;
  }
  if (b.severity !== undefined) {
    if (b.severity !== null && !(SEVERITIES as readonly unknown[]).includes(b.severity)) {
      return { ok: false, error: `severity must be one of ${SEVERITIES.join(', ')}` };
    }
    patch.severity = b.severity as GroupPatch['severity'];
  }
  if (b.confidence !== undefined) {
    if (b.confidence !== null && !['high', 'medium', 'low'].includes(b.confidence as string)) {
      return { ok: false, error: 'confidence must be high, medium or low' };
    }
    patch.confidence = b.confidence as GroupPatch['confidence'];
  }
  for (const [k, max] of Object.entries(TEXT_LIMITS)) {
    const v = b[k];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') return { ok: false, error: `${k} must be text` };
    const t = typeof v === 'string' ? v.trim() : null;
    if (t && t.length > max) return { ok: false, error: `${k} is longer than ${max} characters` };
    (patch as Record<string, unknown>)[k] = t || null;
  }
  if (b.fix_ref && !/^https?:\/\//.test(String(b.fix_ref)) && !/^[0-9a-f]{7,40}$/i.test(String(b.fix_ref))) {
    return { ok: false, error: 'fix_ref must be a URL or a commit sha' };
  }
  if (b.affected_files !== undefined) {
    const f = b.affected_files;
    if (!Array.isArray(f) || f.length > 30 || !f.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 300)) {
      return { ok: false, error: 'affected_files must be a list of up to 30 paths' };
    }
    patch.affected_files = f as string[];
  }
  // `analyzed: true` stamps analyzed_at (the triage skill sends it with its analysis).
  if (b.analyzed !== undefined) {
    if (typeof b.analyzed !== 'boolean') return { ok: false, error: 'analyzed must be true or false' };
    patch.analyzed_at = b.analyzed ? now : null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to update' };
  return { ok: true, patch };
}
