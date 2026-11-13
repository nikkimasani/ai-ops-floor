import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignFloors, dependencyGraph, deriveHealth, parseWhen, activeMaintenance, uptime, trimHistory, updateIncidents, mttrMs, summarize, isStale, toPublic, diffForFloor, rebaseDemo, appearanceFor, fmtMs, SAMPLE, DAY, FLOOR_STATUS } from '../public/shared/ops.js';

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

// ---------- dependency graph ----------
const gnode = (id, health, dependsOn) => ({ id, name: id.toUpperCase(), health, dependsOn });

test('dependencyGraph: layers follow the longest dependency chain; unrelated services are left out', () => {
  const g = dependencyGraph([gnode('idp', 'healthy'), gnode('router', 'down'), gnode('fn', 'healthy', ['idp']), gnode('app', 'failing', ['fn', 'router']), gnode('solo', 'healthy')]);
  const layer = Object.fromEntries(g.nodes.map((n) => [n.id, n.layer]));
  assert.deepEqual(layer, { idp: 0, router: 0, fn: 1, app: 2 });
  assert.ok(!('solo' in layer));
  assert.equal(g.layers, 3);
  assert.deepEqual(g.edges.map((e) => `${e.from}>${e.to}`).sort(), ['fn>app', 'idp>fn', 'router>app']);
  assert.deepEqual(g.edges.filter((e) => e.bad).map((e) => e.from), ['router']);
});

test('dependencyGraph: root causes are down services, or failing ones with no failing dependency', () => {
  const g = dependencyGraph([gnode('router', 'down'), gnode('app', 'failing', ['router']), gnode('db', 'failing'), gnode('api', 'failing', ['db']), gnode('ok', 'healthy', ['router'])]);
  assert.deepEqual(g.rootCauses.sort(), ['db', 'router']);
});

test('dependencyGraph: unknown dependencies, self-dependencies and cycles are survivable', () => {
  assert.equal(dependencyGraph([gnode('a', 'healthy', ['ghost', 'a'])]).edges.length, 0);
  const g = dependencyGraph([gnode('a', 'down', ['b']), gnode('b', 'failing', ['a'])]);
  assert.ok(g.nodes.length === 2 && g.edges.length === 1, 'the back edge of the cycle is dropped');
  assert.equal(dependencyGraph([]).layers, 0);
});

// ---------- floors ----------
const SEATS3 = [{ room: 'a' }, { room: 'a' }, { room: 'b' }];            // floor capacity: 2 in a, 1 in b
const CATS = { x: { room: 'a' }, y: { room: 'b' } };
const fs = (id, category, extra = {}) => ({ id, category, ...extra });

test('assignFloors: fills a floor room by room, spills to the next floor when it is full', () => {
  const f = assignFloors([fs('1', 'x'), fs('2', 'x'), fs('3', 'x'), fs('4', 'y'), fs('5', 'y')], CATS, SEATS3);
  // 3rd x service: room a is full but b has a desk, so it overflows into b on floor 1; then floor 1 is full
  assert.deepEqual([...f], [['1', 1], ['2', 1], ['3', 1], ['4', 2], ['5', 2]]);
});

test('assignFloors: a few services stay on floor 1; onFloor:false gets no floor; explicit floors are honoured', () => {
  assert.deepEqual([...assignFloors([fs('1', 'x'), fs('2', 'y')], CATS, SEATS3)], [['1', 1], ['2', 1]]);
  const f = assignFloors([fs('1', 'x'), fs('hidden', 'x', { onFloor: false }), fs('3', 'x', { floor: 3 })], CATS, SEATS3);
  assert.equal(f.has('hidden'), false);
  assert.equal(f.get('3'), 3);
  assert.equal(f.get('1'), 1);
});

test('diffForFloor only shows the active floor and swaps characters when the floor changes', () => {
  const recs = [{ id: 'a', name: 'A', health: 'healthy', room: 'bullpen', floor: 1, onFloor: true }, { id: 'b', name: 'B', health: 'down', room: 'bullpen', floor: 2, onFloor: true }];
  const one = diffForFloor(new Map(), recs, {}, 1);
  assert.deepEqual(one.events.filter((e) => e.type === 'agent_join').map((e) => e.info.id), ['a']);
  const two = diffForFloor(one.next, recs, {}, 2);
  assert.deepEqual(two.events.filter((e) => e.type === 'agent_leave').map((e) => e.id), ['a']);
  assert.deepEqual(two.events.filter((e) => e.type === 'agent_join').map((e) => e.info.id), ['b']);
});

test('assignFloors: pins beyond a floor\'s capacity spill instead of being published without a desk', () => {
  const pins = [fs('1', 'x', { floor: 1 }), fs('2', 'x', { floor: 1 }), fs('3', 'x', { floor: 1 }), fs('4', 'x', { floor: 1 })];
  const f = assignFloors(pins, CATS, SEATS3);                          // floor 1 has only 3 desks
  assert.equal([...f.values()].filter((n) => n === 1).length, 3);
  assert.equal(f.get('4'), 2);
});

test('diffForFloor: departures come before joins, so a replacement always finds a free desk', () => {
  const mk = (id, floor = 1) => ({ id, name: id, health: 'healthy', room: 'bullpen', floor, onFloor: true });
  const before = diffForFloor(new Map(), [mk('old')], {}, 1).next;
  const { events } = diffForFloor(before, [mk('new')], {}, 1);
  const kinds = events.map((e) => e.type);
  assert.ok(kinds.indexOf('agent_leave') < kinds.indexOf('agent_join'), `leave must precede join, got ${kinds.join(',')}`);
});

test('diffForFloor + a full floor: a service shifting onto the viewed floor still gets a desk when another leaves in the same poll', async () => {
  const { Office } = await import('../public/shared/state.js');
  const { SEATS } = await import('../public/shared/layout.js');
  const mk = (id) => ({ id, name: id, health: 'healthy', room: 'bullpen', floor: 1, onFloor: true });
  const full = Array.from({ length: SEATS.length }, (_, i) => mk(`s${i}`));
  const office = new Office({ empty: true });
  let current = new Map();
  const step = (records) => { const r = diffForFloor(current, records, {}, 1); current = r.next; for (const e of r.events) office.emit(e); };
  step(full);
  assert.equal(Object.keys(office.agents).length, SEATS.length);
  step([...full.slice(1), mk('s-newcomer')]);                 // one leaves, one arrives, floor was full
  assert.equal(Object.keys(office.agents).length, SEATS.length);
  assert.ok(office.agents['s-newcomer'], 'the newcomer was seated');
});

test('a seatless agent (My Queue triage agent) can join a full office; a normal one cannot', async () => {
  const { Office } = await import('../public/shared/state.js');
  const { SEATS } = await import('../public/shared/layout.js');
  const mk = (id, extra = {}) => ({ id, name: id, health: 'healthy', room: 'review', floor: 1, onFloor: true, ...extra });
  const fullOffice = () => {
    const office = new Office({ empty: true }), services = Array.from({ length: SEATS.length }, (_, i) => mk(`s${i}`));
    const r = diffForFloor(new Map(), services, {}, 1);
    for (const e of r.events) office.emit(e);
    return { office, services, current: r.next };
  };
  const errorsFor = (office, events) => events.flatMap((e) => { try { office.emit(e); return []; } catch (err) { return [err.message]; } });

  let f = fullOffice();
  assert.ok(errorsFor(f.office, diffForFloor(f.current, [...f.services, mk('overflow')], {}, 1).events).includes('office is full'), 'a normal agent is refused');

  f = fullOffice();
  assert.deepEqual(errorsFor(f.office, diffForFloor(f.current, [...f.services, mk('tri:INC1', { seatless: true })], {}, 1).events), []);
  assert.equal(f.office.agents['tri:INC1'].seat, -1, 'waits off duty instead of taking a desk');
});

test('a seatless agent never takes a desk, even when desks are free, so a service added later can still join', async () => {
  const { Office } = await import('../public/shared/state.js');
  const { SEATS } = await import('../public/shared/layout.js');
  const mk = (id, extra = {}) => ({ id, name: id, health: 'healthy', room: 'review', floor: 1, onFloor: true, ...extra });
  const office = new Office({ empty: true });
  let current = new Map();
  const step = (records) => { const r = diffForFloor(current, records, {}, 1); current = r.next; return r.events.flatMap((e) => { try { office.emit(e); return []; } catch (err) { return [err.message]; } }); };
  const services = Array.from({ length: SEATS.length - 1 }, (_, i) => mk(`s${i}`));
  assert.deepEqual(step([...services, mk('tri:A', { seatless: true })]), []);
  assert.equal(office.agents['tri:A'].seat, -1, 'free desks exist, but the triage agent still does not take one');
  assert.deepEqual(step([...services, mk('tri:A', { seatless: true }), mk('last-service')]), [], 'the last desk is still there for a service');
  assert.ok(office.agents['last-service'].seat >= 0);
});

// ---------- calm bubbles ----------
test('chooseBubbles: calm shows only the most urgent problem plus the tapped character; all shows the busy view', async () => {
  const { chooseBubbles } = await import('../public/shared/bubbles.js');
  const agents = [
    { id: 'slow', status: 'thinking', since: 1 }, { id: 'failA', status: 'blocked', since: 5 }, { id: 'failB', status: 'blocked', since: 2 },
    { id: 'down', status: 'dark', since: 9 }, { id: 'ok', status: 'working', since: 1 },
  ];
  const calm = chooseBubbles(agents, { mode: 'calm', zoomedIn: true });
  assert.deepEqual([...calm.problems], ['down'], 'down beats failing, even if it started later');
  assert.equal(calm.latency, false);
  assert.equal(calm.chatter, false);
  assert.deepEqual([...chooseBubbles(agents, { mode: 'calm', selected: 'ok' }).problems].sort(), ['down', 'ok']);
  assert.deepEqual([...chooseBubbles(agents.filter((a) => a.id !== 'down'), { mode: 'calm' }).problems], ['failB'], 'oldest failing next');
  assert.equal(chooseBubbles(agents, { mode: 'calm', fun: true }).chatter, true, 'Fun mode brings chatter back');
  assert.deepEqual([...chooseBubbles([{ id: 'ok', status: 'working' }], { mode: 'calm' }).problems], [], 'all healthy: no bubbles');
  const all = chooseBubbles(agents, { mode: 'all', zoomedIn: true });
  assert.deepEqual([...all.problems].sort(), ['down', 'failA', 'failB']);
  assert.equal(all.latency, true);
  assert.equal(chooseBubbles(agents, { mode: 'all', zoomedIn: false }).problems.size, 3, 'zoomed out: at most three');
});
