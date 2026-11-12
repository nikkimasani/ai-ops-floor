import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveHealth, parseWhen, activeMaintenance, uptime, trimHistory, updateIncidents, mttrMs, summarize, isStale, toPublic, diffForFloor, rebaseDemo, appearanceFor, fmtMs, SAMPLE, DAY, FLOOR_STATUS } from '../public/shared/ops.js';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const svc = (extra = {}) => ({ id: 's', name: 'Svc', ...extra });
const ok = (ms) => ({ ok: true, ms });
const bad = (error = 'HTTP 503') => ({ ok: false, ms: 20, error });

test('a fast success is healthy, a slow one is degraded', () => {
  assert.equal(deriveHealth({ service: svc(), result: ok(200), now: NOW }).health, 'healthy');
  const slow = deriveHealth({ service: svc(), result: ok(2500), now: NOW });
  assert.equal(slow.health, 'degraded');
  assert.match(slow.detail, /slow: 2\.5s/);
});

test('per-service thresholds override the defaults', () => {
  assert.equal(deriveHealth({ service: svc({ thresholds: { degradedMs: 100 } }), result: ok(200), now: NOW }).health, 'degraded');
});

test('failures are "failing" until they repeat downAfter times, then "down"', () => {
  let prev;
  const seen = [];
  for (let i = 0; i < 4; i++) { const h = deriveHealth({ service: svc(), result: bad(), prev, now: NOW }); seen.push(h.health); prev = h; }
  assert.deepEqual(seen, ['failing', 'failing', 'down', 'down']);
  assert.equal(prev.consecutiveFailures, 4);
});

test('one success clears the failure streak', () => {
  const h = deriveHealth({ service: svc(), result: ok(100), prev: { consecutiveFailures: 2 }, now: NOW });
  assert.equal(h.health, 'healthy'); assert.equal(h.consecutiveFailures, 0);
});

test('when a dependency is also failing, the service is failing "waiting on" it, never down', () => {
  const h = deriveHealth({ service: svc(), result: bad(), prev: { consecutiveFailures: 10 }, depsFailing: [{ id: 'router', name: 'Model Router' }], now: NOW });
  assert.equal(h.health, 'failing');
  assert.equal(h.detail, 'waiting on Model Router');
  assert.equal(h.rootCause, 'router');
});

test('maintenance windows override everything, including failures', () => {
  const s = svc({ maintenance: [{ from: '2026-11-12T11:00:00Z', to: '2026-11-12T13:00:00Z', note: 'upgrade' }] });
  const h = deriveHealth({ service: s, result: bad(), now: NOW });
  assert.equal(h.health, 'maintenance'); assert.equal(h.detail, 'upgrade');
  assert.equal(deriveHealth({ service: s, result: ok(100), now: NOW + 3 * 3600000 }).health, 'healthy');
});

test('relative maintenance times are measured from the anchor, not from "now"', () => {
  const s = svc({ maintenance: [{ from: 'now-10m', to: 'now+50m' }] });
  assert.ok(activeMaintenance(s, NOW, NOW));
  assert.equal(activeMaintenance(s, NOW - DAY, NOW), null, 'a day before the anchor the window did not exist yet');
  assert.equal(parseWhen('now+2h', NOW), NOW + 7200000);
  assert.equal(parseWhen('now-10m', NOW), NOW - 600000);
  assert.ok(Number.isNaN(parseWhen('nonsense', NOW)));
});

test('no result yet is "unknown"', () => {
  assert.equal(deriveHealth({ service: svc(), result: undefined, now: NOW }).health, 'unknown');
});

test('every health maps to a floor status', () => {
  for (const h of ['healthy', 'degraded', 'failing', 'down', 'maintenance', 'unknown']) assert.ok(FLOOR_STATUS[h]);
});

test('uptime counts successes, ignores maintenance, and is null with nothing to judge', () => {
  const samples = [[NOW - 100, SAMPLE.OK, 10], [NOW - 200, SAMPLE.FAIL, 10], [NOW - 300, SAMPLE.MAINT, 10], [NOW - 2 * DAY, SAMPLE.FAIL, 10]];
  assert.equal(uptime(samples, DAY, NOW), 0.5);
  assert.equal(uptime(samples, 3 * DAY, NOW), 1 / 3);
  assert.equal(uptime([[NOW - 1, SAMPLE.MAINT, 0]], DAY, NOW), null);
  assert.equal(uptime([], DAY, NOW), null);
});

test('history is trimmed to the retention window', () => {
  const kept = trimHistory([[NOW - 8 * DAY, 1, 1], [NOW - DAY, 1, 1]], NOW);
  assert.equal(kept.length, 1);
});

test('incidents open when a service goes down and close when it recovers, once each', () => {
  const s = svc(); const incidents = [];
  updateIncidents(incidents, s, 'failing', { health: 'down', since: NOW, detail: 'timeout' }, NOW);
  updateIncidents(incidents, s, 'down', { health: 'down', since: NOW, detail: 'timeout' }, NOW + 300000);
  assert.equal(incidents.length, 1); assert.equal(incidents[0].end, null);
  updateIncidents(incidents, s, 'down', { health: 'healthy' }, NOW + 900000);
  assert.equal(incidents[0].durationMs, 900000);
  assert.equal(mttrMs(incidents, NOW + 900000), 900000);
  updateIncidents(incidents, s, 'healthy', { health: 'healthy' }, NOW + 1200000);
  assert.equal(incidents.length, 1);
});

test('a dependent service that is only "failing" never opens an incident', () => {
  const incidents = [];
  updateIncidents(incidents, svc(), 'healthy', { health: 'failing' }, NOW);
  assert.equal(incidents.length, 0);
});

test('summary counts and average uptime', () => {
  const s = summarize([{ health: 'healthy', uptime24h: 1 }, { health: 'down', uptime24h: 0.5 }, { health: 'maintenance', uptime24h: null }]);
  assert.equal(s.total, 3); assert.equal(s.healthy, 1); assert.equal(s.down, 1); assert.equal(s.maintenance, 1); assert.equal(s.uptime24h, 0.75);
});

test('stale data is detected so the dashboard never claims "healthy" from old numbers', () => {
  assert.equal(isStale(NOW - 4 * 60000, NOW, 5), false);
  assert.equal(isStale(NOW - 16 * 60000, NOW, 5), true);
  assert.equal(isStale(undefined, NOW, 5), true);
  assert.equal(isStale('garbage', NOW, 5), true);
});

test('published records contain only whitelisted fields (no endpoints, headers or secrets)', () => {
  const pub = toPublic({ id: 'a', name: 'A', health: 'healthy', url: 'https://internal/health', headers: { x: 'secret' }, check: { token: 't' }, apiKey: 'k' });
  assert.deepEqual(Object.keys(pub).sort(), ['health', 'id', 'name']);
});

test('the floor diff: join, change, no-op, leave, and services without a desk are skipped', () => {
  const rec = (o) => ({ id: 'a', name: 'A', category: 'ai-hub', room: 'bullpen', health: 'healthy', detail: 'healthy · 100ms', latencyMs: 100, lastCheck: 1, since: 1, onFloor: true, ...o });
  const first = diffForFloor(new Map(), [rec(), rec({ id: 'hidden', onFloor: false })]);
  assert.deepEqual(first.events.map((e) => e.type), ['agent_join', 'status', 'tool']);
  assert.equal(first.events[0].info.id, 'a');
  assert.equal(diffForFloor(first.next, [rec()]).events.length, 0, 'identical snapshot => no events');
  const down = diffForFloor(first.next, [rec({ health: 'down', detail: 'timeout', latencyMs: null, lastCheck: 2 })]);
  assert.equal(down.events[0].status, 'dark'); assert.equal(down.events[0].note, 'timeout');
  const failing = diffForFloor(first.next, [rec({ health: 'failing', detail: 'waiting on X', lastCheck: 2 })]);
  assert.equal(failing.events[0].status, 'blocked'); assert.equal(failing.events[0].blocker, 'waiting on X');
  const gone = diffForFloor(first.next, []);
  assert.deepEqual(gone.events, [{ type: 'agent_leave', id: 'a' }]);
});

test('a service always gets the same look', () => {
  assert.deepEqual(appearanceFor('model-router'), appearanceFor('model-router'));
});

test('demo rebasing shifts times by one constant', () => {
  const d = rebaseDemo({ generatedAt: 1000, services: [{ lastCheck: 1000, since: 400 }] }, 500);
  assert.equal(d.generatedAt, 1500); assert.equal(d.services[0].lastCheck, 1500); assert.equal(d.services[0].since, 900);
});

test('millisecond formatting', () => { assert.equal(fmtMs(142), '142ms'); assert.equal(fmtMs(1800), '1.8s'); assert.equal(fmtMs(12000), '12s'); });

test('a service that never goes dark (downAfter >= 100) shows the reason without a counter', () => {
  const r = deriveHealth({ service: { thresholds: { downAfter: 9999 } }, result: { ok: false, ms: 5, error: 'queue over limit: 37 open (max 30)' }, prev: { consecutiveFailures: 200 }, depsFailing: [], now: 0 });
  assert.equal(r.health, 'failing');
  assert.equal(r.detail, 'queue over limit: 37 open (max 30)');
});
