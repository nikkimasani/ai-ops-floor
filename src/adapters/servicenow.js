// ServiceNow queue health. Reads ONLY ticket creation times from the Table API (read-only account) and
// publishes counts and ages: never ticket numbers, descriptions, callers or assignees.
//
//   { adapter: "servicenow", instance: "env:SN_INSTANCE",  // e.g. https://yourco.service-now.com
//     user: "env:SN_USER", password: "env:SN_PASSWORD",
//     table: "incident", query: "active=true^assignment_group=<sys_id>",   // query is never published
//     maxOpen: 30, maxOldestHours: 72, slaHours: 48 }
import { DEFAULTS } from '../../public/shared/ops.js';
import { resolveEnv } from './http.js';

const HOUR = 3600000;
const parseSnTime = (s) => Date.parse(`${String(s).replace(' ', 'T')}Z`);   // ServiceNow stores UTC "YYYY-MM-DD HH:mm:ss"

/** Pure: turn creation times into the numbers we publish, and decide whether the queue is within limits. */
export function evaluate(createdAt, cfg, now, total = createdAt.length) {
  const ages = createdAt.map(parseSnTime).filter(Number.isFinite).map((t) => Math.max(0, (now - t) / HOUR));
  const open = Math.max(total, ages.length);
  const oldestExact = ages.length ? Math.max(...ages) : 0, oldestHours = Math.round(oldestExact);   // compare unrounded, publish rounded
  const breaching = cfg.slaHours ? ages.filter((a) => a > cfg.slaHours).length : 0;
  const problems = [];
  if (cfg.maxOpen != null && open > cfg.maxOpen) problems.push(`${open} open (max ${cfg.maxOpen})`);
  if (cfg.maxOldestHours != null && oldestExact > cfg.maxOldestHours) problems.push(`oldest ${oldestHours}h (max ${cfg.maxOldestHours}h)`);
  return { ok: !problems.length, metrics: { open, oldestHours, breaching }, error: problems.length ? `queue over limit: ${problems.join(', ')}` : undefined };
}

export async function check(cfg, ctx = {}) {
  const timeoutMs = cfg.timeoutMs ?? ctx.timeoutMs ?? DEFAULTS.timeoutMs;
  const doFetch = ctx.fetch || fetch;
  let base, auth;
  try {
    base = String(resolveEnv(cfg.instance, ctx.env)).replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) throw new Error('bad instance');
    auth = Buffer.from(`${resolveEnv(cfg.user, ctx.env)}:${resolveEnv(cfg.password, ctx.env)}`).toString('base64');
  } catch { return { ok: false, ms: 0, error: 'configuration error: missing secret' }; }
  const limit = 1000;
  const params = new URLSearchParams({ sysparm_query: cfg.query || 'active=true', sysparm_fields: 'sys_created_on', sysparm_limit: String(limit) });
  const t0 = performance.now();
  try {
    const res = await doFetch(`${base}/api/now/table/${encodeURIComponent(cfg.table || 'incident')}?${params}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = performance.now() - t0;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    const body = await res.json();
    const rows = Array.isArray(body?.result) ? body.result : null;
    if (!rows) return { ok: false, ms, error: 'unexpected response body' };
    const total = Number(res.headers?.get?.('x-total-count')) || rows.length;
    return { ms, ...evaluate(rows.map((r) => r.sys_created_on), cfg, ctx.now ?? Date.now(), total) };
  } catch (err) {
    const ms = performance.now() - t0;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { ok: false, ms, error: `timeout after ${Math.round(timeoutMs / 1000)}s` };
    return { ok: false, ms, error: 'connection failed' };
  }
}
