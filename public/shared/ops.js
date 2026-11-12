// The heart of the health board. Pure functions (no I/O, no DOM) used by BOTH the probe job (Node)
// and the dashboard (browser), so "what counts as down" is defined in exactly one place.
//
//   check result  { ok, ms, error? }              what one probe observed
//   health        healthy | degraded | failing | down | maintenance | unknown
//   floor status  working | thinking | blocked | dark | bench | idle     (what the little characters show)

import { HAIR, HAIR_COLORS, DRESS, ACCENT } from './agents.js';

export const HEALTH = ['healthy', 'degraded', 'failing', 'down', 'maintenance', 'unknown'];
export const FLOOR_STATUS = { healthy: 'working', degraded: 'thinking', failing: 'blocked', down: 'dark', maintenance: 'bench', unknown: 'idle' };
export const DEFAULTS = { degradedMs: 1500, timeoutMs: 8000, downAfter: 3, intervalMin: 5, staleAfterIntervals: 3 };
export const SAMPLE = { OK: 1, FAIL: 0, MAINT: 2 };           // history sample codes: [timestamp, code, ms]
export const DAY = 24 * 3600 * 1000;

export const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${Math.round(ms)}ms`);

/** "now", "now-10m", "now+2h" or any ISO date → epoch ms. Relative forms make demo maintenance windows possible. */
export function parseWhen(value, now = Date.now()) {
  const m = /^now(?:([+-])(\d+)([mhd]))?$/.exec(String(value).trim());
  if (m) {
    if (!m[1]) return now;
    const unit = { m: 60000, h: 3600000, d: DAY }[m[3]];
    return now + (m[1] === '-' ? -1 : 1) * Number(m[2]) * unit;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

/** `anchor` is what relative times ("now-10m") are measured from; it only differs from `now` when replaying demo history. */
export function activeMaintenance(service, now, anchor = now) {
  return (service.maintenance || []).find((w) => {
    const from = parseWhen(w.from, anchor), to = parseWhen(w.to, anchor);
    return from <= now && now < to;
  }) || null;
}

/**
 * Decide one service's health from its latest check result.
 *  - a slow success is "degraded"
 *  - a failure is "failing" until it has failed `downAfter` times in a row, then "down"
 *  - a failure while a dependency is also failing is "failing, waiting on <dependency>" (never "down"):
 *    only the root cause pages anyone
 *  - a maintenance window overrides everything
 * `depsFailing` = [{ id, name }] for dependencies whose own check failed in this same run.
 */
export function deriveHealth({ service, result, prev, depsFailing = [], now = Date.now(), anchor = now, defaults = DEFAULTS }) {
  const cfg = { ...defaults, ...(service.thresholds || {}) };
  const prevFails = prev?.consecutiveFailures || 0;
  const maint = activeMaintenance(service, now, anchor);
  if (maint) return { health: 'maintenance', consecutiveFailures: result && !result.ok ? prevFails + 1 : 0, detail: maint.note || 'planned maintenance' };
  if (!result) return { health: 'unknown', consecutiveFailures: prevFails, detail: 'no data yet' };
  if (result.ok) {
    return result.ms > cfg.degradedMs
      ? { health: 'degraded', consecutiveFailures: 0, detail: `slow: ${fmtMs(result.ms)} (limit ${fmtMs(cfg.degradedMs)})` }
      : { health: 'healthy', consecutiveFailures: 0, detail: `healthy · ${fmtMs(result.ms)}` };
  }
  const fails = prevFails + 1, error = result.error || 'no response';
  if (depsFailing.length) return { health: 'failing', consecutiveFailures: fails, detail: `waiting on ${depsFailing.map((d) => d.name).join(', ')}`, rootCause: depsFailing[0].id };
  if (fails >= cfg.downAfter) return { health: 'down', consecutiveFailures: fails, detail: error };
  return { health: 'failing', consecutiveFailures: fails, detail: cfg.downAfter >= 100 ? error : `check failing (${fails}/${cfg.downAfter}): ${error}` };   // downAfter >= 100 = "never goes dark" (queues): no counter
}

// ---------- history & uptime ----------
export const trimHistory = (samples, now, keepMs = 7 * DAY) => samples.filter((s) => s[0] > now - keepMs);

/** Share of successful samples in the window (maintenance samples are ignored). null when there is nothing to judge. */
export function uptime(samples, windowMs, now = Date.now()) {
  let ok = 0, total = 0;
  for (const [t, code] of samples) {
    if (t <= now - windowMs || code === SAMPLE.MAINT) continue;
    total++; if (code === SAMPLE.OK) ok++;
  }
  return total ? ok / total : null;
}

// ---------- incidents ----------
/** Open an incident when a service goes down; close it when it comes back. Returns the (mutated) list. */
export function updateIncidents(incidents, service, prevHealth, record, now) {
  const open = incidents.find((i) => i.service === service.id && i.end === null);
  if (record.health === 'down' && !open && prevHealth !== 'down') {
    incidents.push({ id: `${service.id}-${now}`, service: service.id, name: service.name, start: record.since || now, end: null, detail: record.detail });
  } else if (open && (record.health === 'healthy' || record.health === 'degraded')) {
    open.end = now; open.durationMs = now - open.start;
  }
  return incidents;
}

export function mttrMs(incidents, now = Date.now(), windowMs = 30 * DAY) {
  const closed = incidents.filter((i) => i.end !== null && i.end > now - windowMs);
  return closed.length ? closed.reduce((s, i) => s + (i.durationMs || i.end - i.start), 0) / closed.length : null;
}

// ---------- the published snapshot ----------
export function summarize(records) {
  const by = Object.fromEntries(HEALTH.map((h) => [h, 0]));
  for (const r of records) by[r.health]++;
  const u = records.map((r) => r.uptime24h).filter((x) => x !== null && x !== undefined);
  return { total: records.length, ...by, uptime24h: u.length ? u.reduce((a, b) => a + b, 0) / u.length : null };
}

/** The dashboard must never claim "healthy" from data that stopped arriving. */
export function isStale(generatedAt, now = Date.now(), intervalMin = DEFAULTS.intervalMin, intervals = DEFAULTS.staleAfterIntervals) {
  const t = typeof generatedAt === 'number' ? generatedAt : Date.parse(generatedAt);
  return !Number.isFinite(t) || now - t > intervalMin * intervals * 60000;
}

/**
 * Demo snapshots are generated once and committed, so by the time anyone opens the page they are old.
 * Shift every timestamp by one constant so the data looks freshly probed. (Never used for real data.)
 */
export function rebaseDemo(d, shiftMs) {
  d.demoShiftMs = shiftMs; d.generatedAt += shiftMs;
  for (const s of d.services) { if (s.lastCheck) s.lastCheck += shiftMs; if (s.since) s.since += shiftMs; }
  return d;
}

/** Fields that are safe to publish. Endpoints, headers and credentials are never part of a record. */
export const PUBLIC_FIELDS = ['id', 'name', 'category', 'room', 'owner', 'tier', 'health', 'detail', 'latencyMs', 'uptime24h', 'uptime7d', 'lastCheck', 'since', 'consecutiveFailures', 'rootCause', 'onFloor', 'metrics', 'dependsOn'];
// ---------- dependency graph ----------
/**
 * Layered dependency graph for the Board. Layer 0 = services that depend on nothing; a service sits one layer
 * after the deepest thing it waits on. Unknown dependency ids are ignored; cycles can't loop forever (back
 * edges are dropped). `rootCauses` = failing/down services that no failing service of theirs explains.
 */
export function dependencyGraph(services) {
  const byId = new Map(services.map((s) => [s.id, s]));
  const deps = (s) => (s.dependsOn || []).filter((d) => byId.has(d) && d !== s.id);
  const layer = new Map(), visiting = new Set();
  const depth = (id) => {
    if (layer.has(id)) return layer.get(id);
    if (visiting.has(id)) return 0;                                  // cycle: break it here
    visiting.add(id);
    const l = Math.max(-1, ...deps(byId.get(id)).map(depth)) + 1;
    visiting.delete(id); layer.set(id, l);
    return l;
  };
  const involved = new Set();
  for (const s of services) for (const d of deps(s)) { involved.add(s.id); involved.add(d); }
  const nodes = services.filter((s) => involved.has(s.id)).map((s) => ({ id: s.id, name: s.name, health: s.health, layer: depth(s.id) }));
  const bad = (h) => h === 'down' || h === 'failing';
  const edges = [];
  for (const s of services) for (const d of deps(s)) if (layer.get(d) < layer.get(s.id)) edges.push({ from: d, to: s.id, bad: bad(byId.get(d).health) });
  const rootCauses = nodes.filter((n) => n.health === 'down' || (n.health === 'failing' && !deps(byId.get(n.id)).some((d) => bad(byId.get(d).health)))).map((n) => n.id);
  return { nodes, edges, rootCauses, layers: nodes.length ? Math.max(...nodes.map((n) => n.layer)) + 1 : 0 };
}

export const toPublic = (rec) => Object.fromEntries(PUBLIC_FIELDS.filter((k) => rec[k] !== undefined).map((k) => [k, rec[k]]));

// ---------- bridging to the office floor ----------
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** Each service always gets the same look, whatever order they join in. */
export function appearanceFor(id) {
  const h = hash(id);
  return { color: DRESS[h % DRESS.length], accent: ACCENT[(h >> 3) % ACCENT.length], hair: HAIR[(h >> 5) % HAIR.length], hairColor: HAIR_COLORS[(h >> 7) % HAIR_COLORS.length] };
}

export const metaOf = (r) => ({ ops: true, category: r.category, owner: r.owner, tier: r.tier, health: r.health, latencyMs: r.latencyMs, uptime24h: r.uptime24h, uptime7d: r.uptime7d, lastCheck: r.lastCheck, since: r.since, rootCause: r.rootCause });

/**
 * Turn a new snapshot into office events, given what the floor currently shows (`current`: id -> record).
 * Only services marked onFloor get a character; the Board view always shows everything.
 */
export function diffForFloor(current, records, roomLabels = {}) {
  const events = [], next = new Map();
  for (const r of records.filter((x) => x.onFloor !== false)) {
    next.set(r.id, r);
    const prev = current.get(r.id), floor = FLOOR_STATUS[r.health];
    if (!prev) {
      events.push({ type: 'agent_join', info: { id: r.id, name: r.name, role: roomLabels[r.room] || r.category, room: r.room, since: r.since, ...appearanceFor(r.id), meta: metaOf(r) } });
      events.push(...statusEvents(r, floor, true));
    } else if (prev.health !== r.health || prev.detail !== r.detail || prev.latencyMs !== r.latencyMs || prev.lastCheck !== r.lastCheck) {
      events.push(...statusEvents(r, floor, prev.health !== r.health));
    }
  }
  for (const id of current.keys()) if (!next.has(id)) events.push({ type: 'agent_leave', id });
  return { events, next };
}

function statusEvents(r, floor, changed) {
  const meta = metaOf(r), since = r.since;
  if (floor === 'working') return [{ type: 'status', agent: r.id, status: 'working', task: r.detail, meta, since }, { type: 'tool', agent: r.id, tool: fmtMs(r.latencyMs ?? 0), detail: r.detail }];
  if (floor === 'blocked') return [{ type: 'status', agent: r.id, status: 'blocked', blocker: r.detail, task: r.detail, meta, since }];
  if (floor === 'dark') return [{ type: 'status', agent: r.id, status: 'dark', note: r.detail, task: r.detail, meta, since }];
  return [{ type: 'status', agent: r.id, status: floor, task: r.detail, note: floor === 'bench' ? r.detail : null, meta, since }];
}
