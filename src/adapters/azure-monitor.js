// Azure Monitor metric check (Function apps, App Service, API Management, ...). Uses the Metrics REST API
// with an app registration (client credentials). No SDK, no dependencies.
//
//   { adapter: "azure-monitor",
//     tenantId: "env:AZ_TENANT_ID", clientId: "env:AZ_CLIENT_ID", clientSecret: "env:AZ_CLIENT_SECRET",
//     resourceId: "env:FUNC_INTAKE_RESOURCE_ID",     // /subscriptions/.../providers/Microsoft.Web/sites/<name>
//     metric: "Http5xx", aggregation: "Total",       // aggregation: Average | Total | Count | Minimum | Maximum
//     max: 5,                                        // fail when the latest value is above max ...
//     min: 100,                                      // ... or below min (give either or both)
//     windowMin: 15 }                                // look at the last N minutes (default 15)
//
// The service principal only needs the "Monitoring Reader" role on the resource. The published error text
// is generic: it never contains the resource id, tenant, client id or token.
import { DEFAULTS } from '../../public/shared/ops.js';
import { resolveEnv } from './http.js';

const API_VERSION = '2023-10-01';
const AGG_FIELD = { Average: 'average', Total: 'total', Count: 'count', Minimum: 'minimum', Maximum: 'maximum' };
const tokenCache = new Map();   // key -> { token, expiresAt }; one probe run = one process, so this just avoids a token per service

async function getToken({ tenantId, clientId, clientSecret }, doFetch, signal, now) {
  const key = `${tenantId}|${clientId}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > now + 60000) return hit.token;
  const res = await doFetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal,
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'https://management.azure.com/.default' }),
  });
  if (!res.ok) throw Object.assign(new Error('auth'), { auth: res.status });
  const body = await res.json();
  if (!body?.access_token) throw Object.assign(new Error('auth'), { auth: 0 });
  tokenCache.set(key, { token: body.access_token, expiresAt: now + (Number(body.expires_in) || 3000) * 1000 });
  return body.access_token;
}

/** Pure: latest non-null datapoint of the metric -> ok / reason. */
export function evaluate(json, cfg) {
  const field = AGG_FIELD[cfg.aggregation || 'Average'];
  const points = (json?.value?.[0]?.timeseries || []).flatMap((t) => t.data || []).filter((d) => Number.isFinite(d[field]));
  if (!points.length) return { ok: false, error: 'no recent data' };
  points.sort((a, b) => Date.parse(a.timeStamp) - Date.parse(b.timeStamp));
  const v = points[points.length - 1][field], r = Math.round(v * 100) / 100;
  if (cfg.max != null && v > cfg.max) return { ok: false, error: `metric over limit: ${r} (max ${cfg.max})` };
  if (cfg.min != null && v < cfg.min) return { ok: false, error: `metric below limit: ${r} (min ${cfg.min})` };
  return { ok: true };
}

export async function check(cfg, ctx = {}) {
  const timeoutMs = cfg.timeoutMs ?? ctx.timeoutMs ?? DEFAULTS.timeoutMs;
  const doFetch = ctx.fetch || fetch, now = ctx.now ?? Date.now();
  let creds, resourceId;
  try {
    creds = { tenantId: resolveEnv(cfg.tenantId, ctx.env), clientId: resolveEnv(cfg.clientId, ctx.env), clientSecret: resolveEnv(cfg.clientSecret, ctx.env) };
    resourceId = String(resolveEnv(cfg.resourceId, ctx.env));
    if (!resourceId.startsWith('/subscriptions/') || !cfg.metric || !AGG_FIELD[cfg.aggregation || 'Average']) throw new Error('bad config');
  } catch { return { ok: false, ms: 0, error: 'configuration error: missing secret' }; }
  const signal = AbortSignal.timeout(timeoutMs), t0 = performance.now();
  try {
    const token = await getToken(creds, doFetch, signal, now);
    const end = new Date(now), start = new Date(now - (cfg.windowMin ?? 15) * 60000);
    const qs = new URLSearchParams({
      'api-version': API_VERSION, metricnames: cfg.metric, aggregation: cfg.aggregation || 'Average', interval: 'PT1M',
      timespan: `${start.toISOString()}/${end.toISOString()}`,
    });
    const res = await doFetch(`https://management.azure.com${resourceId}/providers/microsoft.insights/metrics?${qs}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
    const ms = performance.now() - t0;
    if (!res.ok) return { ok: false, ms, error: res.status === 401 || res.status === 403 ? 'not authorized (check the Monitoring Reader role)' : `HTTP ${res.status}` };
    return { ms, ...evaluate(await res.json(), cfg) };
  } catch (err) {
    const ms = performance.now() - t0;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { ok: false, ms, error: `timeout after ${Math.round(timeoutMs / 1000)}s` };
    if (err?.auth !== undefined) return { ok: false, ms, error: 'authentication failed' };
    return { ok: false, ms, error: 'connection failed' };
  }
}

export const _clearTokenCache = () => tokenCache.clear();   // tests
