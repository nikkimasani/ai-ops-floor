// GitHub Copilot seat usage for an organization, from the Copilot billing summary endpoint.
// Publishes AGGREGATE counts only: the per-user seat list is never requested.
//
//   { adapter: "copilot-seats", org: "env:COPILOT_ORG", token: "env:COPILOT_TOKEN",
//     maxSeats: 500,            // fail when more seats are assigned than you pay for / budgeted
//     maxInactivePct: 30 }      // fail when more than this % of seats were inactive this billing cycle
//
// Token: a fine-grained token or app with organization "Administration: read" / classic `manage_billing:copilot`
// (see GitHub's docs for "Get Copilot seat information and settings for an organization").
import { DEFAULTS } from '../../public/shared/ops.js';
import { resolveEnv } from './http.js';

/** Pure: seat_breakdown -> published numbers + verdict. */
export function evaluate(b, cfg) {
  const seats = Number(b?.total), inactive = Number(b?.inactive_this_cycle), pendingCancellation = Number(b?.pending_cancellation);
  if (!Number.isFinite(seats)) return { ok: false, error: 'unexpected response body' };
  const metrics = { seats, ...(Number.isFinite(inactive) && { inactiveSeats: inactive }), ...(Number.isFinite(pendingCancellation) && { pendingCancellation }) };
  const problems = [];
  if (cfg.maxSeats != null && seats > cfg.maxSeats) problems.push(`${seats} seats (max ${cfg.maxSeats})`);
  const pct = seats && Number.isFinite(inactive) ? Math.round((inactive / seats) * 100) : 0;
  if (cfg.maxInactivePct != null && pct > cfg.maxInactivePct) problems.push(`${pct}% inactive (max ${cfg.maxInactivePct}%)`);
  return { ok: !problems.length, metrics, error: problems.length ? `seat usage over limit: ${problems.join(', ')}` : undefined };
}

export async function check(cfg, ctx = {}) {
  const timeoutMs = cfg.timeoutMs ?? ctx.timeoutMs ?? DEFAULTS.timeoutMs;
  const doFetch = ctx.fetch || fetch;
  let org, token;
  try { org = String(resolveEnv(cfg.org, ctx.env)); token = String(resolveEnv(cfg.token, ctx.env)); if (!/^[A-Za-z0-9-_.]+$/.test(org)) throw new Error('bad org'); }
  catch { return { ok: false, ms: 0, error: 'configuration error: missing secret' }; }
  const t0 = performance.now();
  try {
    const res = await doFetch(`https://api.github.com/orgs/${org}/copilot/billing`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ai-ops-floor' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = performance.now() - t0;
    if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, ms, error: 'not authorized (check the token permissions)' };
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    return { ms, ...evaluate((await res.json())?.seat_breakdown, cfg) };
  } catch (err) {
    const ms = performance.now() - t0;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { ok: false, ms, error: `timeout after ${Math.round(timeoutMs / 1000)}s` };
    return { ok: false, ms, error: 'connection failed' };
  }
}
