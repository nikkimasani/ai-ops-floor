// Alerts: one message when an incident opens, one when it closes. Nothing else.
//
// Dedupe comes from comparing the incident lists before and after a probe run (incident ids are stable),
// so a service that stays down sends nothing more, and a re-run with unchanged state sends nothing.
// Delivery is at-most-once: the probe saves its state first, then sends; a failed send is logged (without
// the webhook URL) and not retried.
//
// Messages carry the service NAME and TIER only: no error text, hosts or other details.
//
//   "alerts": { "webhook": "env:ALERT_WEBHOOK", "maxTier": 2, "format": "text" }   // format: text | json
import { resolveEnv } from './adapters/http.js';
import { fmtMs } from '../public/shared/ops.js';

/** Pure: what changed between two incident lists. */
export function planAlerts(prevIncidents = [], nextIncidents = [], services = [], { maxTier = 99 } = {}) {
  const prev = new Map(prevIncidents.map((i) => [i.id, i]));
  const tierOf = new Map(services.map((s) => [s.id, s.tier]));
  const out = [];
  for (const i of nextIncidents) {
    const tier = tierOf.get(i.service);
    if ((tier ?? 99) > maxTier) continue;
    const before = prev.get(i.id);
    if (!before && i.end === null) out.push({ kind: 'down', name: i.name, tier, incident: i.id });
    else if (before && before.end === null && i.end !== null) out.push({ kind: 'recovered', name: i.name, tier, incident: i.id, durationMs: i.durationMs ?? i.end - i.start });
  }
  return out;
}

export const formatAlert = (a) => {
  const tier = a.tier ? ` (Tier ${a.tier})` : '';
  return a.kind === 'down' ? `🥀 ${a.name}${tier} is DOWN` : `✅ ${a.name}${tier} recovered after ${fmtMs(a.durationMs)}`;
};

/** Send alerts to the webhook. Returns { sent, failed }. Never throws and never logs the URL. */
export async function sendAlerts(alerts, cfg, { env = process.env, fetch: doFetch = fetch, log = console.warn } = {}) {
  if (!alerts.length) return { sent: 0, failed: 0 };
  let url;
  try { url = resolveEnv(cfg.webhook, env); if (!/^https:\/\//.test(String(url))) throw new Error('bad'); }
  catch { log(`alerts: webhook not configured (${alerts.length} alert(s) not sent)`); return { sent: 0, failed: alerts.length }; }
  let sent = 0, failed = 0;
  for (const a of alerts) {
    const text = formatAlert(a);
    const body = cfg.format === 'json' ? { event: a.kind, service: a.name, tier: a.tier ?? null, text } : { text };
    try {
      const res = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (res.ok) sent++; else { failed++; log(`alerts: delivery failed (HTTP ${res.status})`); }
    } catch { failed++; log('alerts: delivery failed (connection error)'); }
  }
  return { sent, failed };
}
