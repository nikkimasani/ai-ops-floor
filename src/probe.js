#!/usr/bin/env node
// The probe job: run every service's check, decide health, update history / incidents, write the snapshot
// the dashboard reads. Zero dependencies. `runOnce` is pure-ish (no file I/O) so tests and the demo
// generator can drive it with a fake clock.
//
//   node src/probe.js [--config config/services.json] [--data public/data] [--fail-on-down]

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters as defaultAdapters } from './adapters/index.js';
import { loadConfig } from './config.js';
import { DEFAULTS, SAMPLE, deriveHealth, mttrMs, summarize, toPublic, trimHistory, uptime, updateIncidents, activeMaintenance, DAY } from '../public/shared/ops.js';
import { SEATS } from '../public/shared/layout.js';

// Adapters may report a few counters (queue size, ages). Only known keys with finite numbers get through.
export const METRIC_KEYS = ['open', 'oldestHours', 'breaching', 'seats', 'inactiveSeats', 'pendingCancellation'];
export const cleanMetrics = (m) => {
  const out = {};
  for (const k of METRIC_KEYS) if (Number.isFinite(m?.[k])) out[k] = Math.round(m[k]);
  return Object.keys(out).length ? out : undefined;
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('adapter timeout')), ms).unref?.())]);

async function runCheck(service, { adapters, now, anchor, env, timeoutMs }) {
  const adapter = adapters[service.check.adapter];
  try {
    const r = await withTimeout(adapter.check(service.check, { serviceId: service.id, now, anchor, env, timeoutMs }), timeoutMs + 1000);
    return { ok: Boolean(r.ok), ms: Number(r.ms) || 0, error: r.ok ? undefined : String(r.error || 'check failed').slice(0, 120), metrics: cleanMetrics(r.metrics) };
  } catch {
    return { ok: false, ms: 0, error: 'check could not run' };      // adapter bug or hang: say so, never leak details
  }
}

/**
 * One probe run. `state` = { status, history, incidents } from the previous run (or empty).
 * Returns the new state; nothing is written.
 */
export async function runOnce({ config, state = {}, now = Date.now(), adapters = defaultAdapters, anchor, env = process.env }) {
  const intervalMin = config.site.intervalMin ?? DEFAULTS.intervalMin;
  const timeoutMs = config.site.timeoutMs ?? DEFAULTS.timeoutMs;
  const prevMap = new Map((state.status?.services || []).map((s) => [s.id, s]));
  const history = Object.fromEntries(Object.entries(state.history || {}).map(([k, v]) => [k, v.slice()]));
  const incidents = (state.incidents || []).map((i) => ({ ...i }));

  const results = Object.fromEntries(await Promise.all(config.services.map(async (s) => [s.id, await runCheck(s, { adapters, now, anchor, env, timeoutMs })])));
  const byId = Object.fromEntries(config.services.map((s) => [s.id, s]));
  const seats = SEATS.length;

  const records = config.services.map((s, i) => {
    const prev = prevMap.get(s.id);
    const result = results[s.id];
    const depsFailing = (s.dependsOn || []).filter((d) => results[d] && !results[d].ok && !activeMaintenance(byId[d], now, anchor ?? now)).map((d) => ({ id: d, name: byId[d].name }));
    const h = deriveHealth({ service: s, result, prev, depsFailing, now, anchor, defaults: { ...DEFAULTS, ...(config.site.defaults || {}) } });
    const maint = h.health === 'maintenance';
    (history[s.id] ||= []).push([now, maint ? SAMPLE.MAINT : result.ok ? SAMPLE.OK : SAMPLE.FAIL, Math.round(result.ms)]);
    history[s.id] = trimHistory(history[s.id], now);
    const rec = {
      id: s.id, name: s.name, category: s.category, room: config.site.categories[s.category].room, owner: s.owner, tier: s.tier,
      health: h.health, detail: h.detail, latencyMs: result.ok ? Math.round(result.ms) : null,
      uptime24h: uptime(history[s.id], DAY, now), uptime7d: uptime(history[s.id], 7 * DAY, now),
      lastCheck: now, since: prev && prev.health === h.health ? prev.since : now,
      consecutiveFailures: h.consecutiveFailures, rootCause: h.rootCause, dependsOn: s.dependsOn?.length ? s.dependsOn : undefined,
      onFloor: s.onFloor !== false && i < seats, metrics: result.metrics,
    };
    updateIncidents(incidents, s, prev?.health, rec, now);
    return rec;
  });

  const keepIncidents = incidents.filter((i) => i.end === null || i.end > now - 30 * DAY).slice(-200);
  const status = {
    generatedAt: now, intervalMin, demo: Boolean(config.site.demo),
    site: { title: config.site.title || 'AI Ops Floor', categories: config.site.categories },
    summary: summarize(records), mttrMs: mttrMs(keepIncidents, now), openIncidents: keepIncidents.filter((i) => i.end === null).length,
    services: records.map(toPublic),
  };
  return { status, history, incidents: keepIncidents };
}

// ---------- file I/O ----------
const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };
function writeJson(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);                       // atomic: the dashboard never reads a half-written file
}

export const loadState = (dir) => ({ status: readJson(join(dir, 'status.json'), null), history: readJson(join(dir, 'history.json'), {}), incidents: readJson(join(dir, 'incidents.json'), []) });
export function saveState(dir, s) {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'status.json'), s.status); writeJson(join(dir, 'history.json'), s.history); writeJson(join(dir, 'incidents.json'), s.incidents);
}

async function main() {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
  const config = loadConfig(arg('--config', 'config/services.json'));
  const dir = arg('--data', 'public/data');
  const next = await runOnce({ config, state: loadState(dir) });
  saveState(dir, next);
  const s = next.status.summary;
  console.log(`probed ${s.total} services: ${s.healthy} healthy, ${s.degraded} degraded, ${s.failing} failing, ${s.down} down, ${s.maintenance} maintenance`);
  if (process.argv.includes('--fail-on-down') && s.down) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
