// HTTP health check. The result is published to the dashboard, so error text is deliberately generic:
// it never contains the URL, hostname, headers or response body.
import { DEFAULTS } from '../../public/shared/ops.js';

/** "env:NAME" -> value of process.env.NAME (so secrets live in GitHub Actions secrets, never in config). */
export function resolveEnv(value, env = process.env) {
  if (typeof value !== 'string' || !value.startsWith('env:')) return value;
  const name = value.slice(4);
  if (env[name] === undefined) throw new Error(`missing environment variable ${name}`);
  return env[name];
}

const statusOk = (status, expect) => (Array.isArray(expect) ? expect.includes(status) : expect ? status === expect : status >= 200 && status < 300);

export async function check(cfg, ctx = {}) {
  const timeoutMs = cfg.timeoutMs ?? ctx.timeoutMs ?? DEFAULTS.timeoutMs;
  let url, headers = {};
  try {
    url = resolveEnv(cfg.url, ctx.env);
    for (const [k, v] of Object.entries(cfg.headers || {})) headers[k] = resolveEnv(v, ctx.env);
  } catch (err) {
    return { ok: false, ms: 0, error: 'configuration error: missing secret' };    // names the problem, not the secret
  }
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method: cfg.method || 'GET', headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const ms = performance.now() - t0;
    if (!statusOk(res.status, cfg.expectStatus)) return { ok: false, ms, error: `HTTP ${res.status}` };
    if (cfg.expectBodyIncludes) {
      const body = (await res.text()).slice(0, 65536);
      if (!body.includes(cfg.expectBodyIncludes)) return { ok: false, ms, error: 'unexpected response body' };
    } else await res.arrayBuffer().catch(() => {});
    return { ok: true, ms };
  } catch (err) {
    const ms = performance.now() - t0;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { ok: false, ms, error: `timeout after ${Math.round(timeoutMs / 1000)}s` };
    const code = String(err?.cause?.code || '').replace(/[^A-Z_]/g, '');
    return { ok: false, ms, error: code ? `connection failed (${code})` : 'connection failed' };
  }
}
