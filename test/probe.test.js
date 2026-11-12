import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnce, loadState, saveState } from '../src/probe.js';
import { loadConfig } from '../src/config.js';
import { generate } from '../src/demo-data.js';
import { SEATS } from '../public/shared/layout.js';

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0), STEP = 5 * 60000;
const cfg = (services) => ({ site: { title: 'T', intervalMin: 5, categories: { hub: { label: 'Hub', room: 'bullpen' } } }, services: services.map((s) => ({ category: 'hub', name: s.id, check: { adapter: 'fake' }, ...s })) });
// A scripted adapter: each service id has a queue of results, one per probe run.
const scripted = (script) => ({ fake: { check: async (_cfg, ctx) => { const q = script[ctx.serviceId]; return q.length > 1 ? q.shift() : q[0]; } } });
const ok = (ms = 100) => ({ ok: true, ms }), bad = (e = 'HTTP 500') => ({ ok: false, ms: 10, error: e });
async function run(config, script, n) {
  let state = {}; const adapters = scripted(script), out = [];
  for (let i = 0; i < n; i++) { state = await runOnce({ config, state, now: T0 + i * STEP, adapters }); out.push(state); }
  return out;
}
const rec = (state, id) => state.status.services.find((s) => s.id === id);

test('a service walks healthy -> failing -> failing -> down -> healthy, with one incident', async () => {
  const runs = await run(cfg([{ id: 'a' }]), { a: [ok(), bad(), bad(), bad(), ok()] }, 5);
  assert.deepEqual(runs.map((r) => rec(r, 'a').health), ['healthy', 'failing', 'failing', 'down', 'healthy']);
  const last = runs.at(-1);
  assert.equal(last.incidents.length, 1);
  assert.equal(last.incidents[0].end, T0 + 4 * STEP);
  assert.equal(last.status.openIncidents, 0);
  assert.equal(runs[3].status.openIncidents, 1);
});

test('health "since" only moves when the health changes', async () => {
  const runs = await run(cfg([{ id: 'a' }]), { a: [ok(), ok(), bad()] }, 3);
  assert.equal(rec(runs[1], 'a').since, T0);
  assert.equal(rec(runs[2], 'a').since, T0 + 2 * STEP);
});

test('only the root cause goes down; dependents are failing "waiting on" it', async () => {
  const config = cfg([{ id: 'db' }, { id: 'api', dependsOn: ['db'] }]);
  const runs = await run(config, { db: [bad('timeout after 8s')], api: [bad()] }, 4);
  const s = runs.at(-1);
  assert.equal(rec(s, 'db').health, 'down');
  assert.equal(rec(s, 'api').health, 'failing'); assert.equal(rec(s, 'api').detail, 'waiting on db'); assert.equal(rec(s, 'api').rootCause, 'db');
  assert.deepEqual(s.incidents.map((i) => i.service), ['db']);
});

test('a dependency in maintenance does not blame the dependent', async () => {
  const config = cfg([{ id: 'db', maintenance: [{ from: 'now-1h', to: 'now+1h' }] }, { id: 'api', dependsOn: ['db'] }]);
  const [s] = await run(config, { db: [bad()], api: [bad('HTTP 500')] }, 1);
  assert.equal(rec(s, 'db').health, 'maintenance');
  assert.equal(rec(s, 'api').health, 'failing');
  assert.notEqual(rec(s, 'api').detail, 'waiting on db');
});

test('uptime comes from history, history is capped, and snapshots carry a summary', async () => {
  const runs = await run(cfg([{ id: 'a' }]), { a: [ok(), bad(), ok(), ok()] }, 4);
  const s = runs.at(-1);
  assert.equal(rec(s, 'a').uptime24h, 0.75);
  assert.equal(s.history.a.length, 4);
  assert.equal(s.status.summary.total, 1);
  assert.equal(s.status.generatedAt, T0 + 3 * STEP);
  const long = await run(cfg([{ id: 'a' }]), { a: [ok()] }, 3);
  assert.ok(long.at(-1).history.a.every((h) => h.length === 3));
});

test('a check that throws or hangs is reported as "could not run", not a crash', async () => {
  const adapters = { fake: { check: async () => { throw new Error('secret internal stack https://corp.internal/x'); } } };
  const s = await runOnce({ config: cfg([{ id: 'a' }]), state: {}, now: T0, adapters });
  assert.equal(rec(s.status ? s : { status: s.status }, 'a').health, 'failing');
  assert.ok(!JSON.stringify(s).includes('corp.internal'));
  assert.match(JSON.stringify(s.status), /check could not run/);
});

test('services beyond the number of desks stay off the floor but stay on the Board', async () => {
  const many = Array.from({ length: SEATS.length + 3 }, (_, i) => ({ id: `s${i}` }));
  const [s] = await run(cfg(many), Object.fromEntries(many.map((m) => [m.id, [ok()]])), 1);
  assert.equal(s.status.services.length, SEATS.length + 3);
  assert.equal(s.status.services.filter((x) => x.onFloor).length, SEATS.length);
  assert.equal(rec(s, `s${SEATS.length + 2}`).onFloor, false);
});

test('state round-trips through the files the dashboard reads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'));
  const [s1] = await run(cfg([{ id: 'a' }]), { a: [ok()] }, 1);
  saveState(dir, s1);
  for (const f of ['status.json', 'history.json', 'incidents.json']) assert.ok(existsSync(join(dir, f)), f);
  const loaded = loadState(dir);
  assert.equal(loaded.status.services[0].id, 'a');
  assert.deepEqual(loaded.history, s1.history);
});

test('end to end over real HTTP: nothing sensitive reaches the published files', async () => {
  const server = http.createServer((req, res) => { res.statusCode = req.url === '/down' ? 500 : 200; res.end('internal-body-secret'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const config = cfg([
      { id: 'up', check: { adapter: 'http', url: `${base}/up?token=env:SECRET_TOKEN`, headers: { authorization: 'env:SECRET_TOKEN' } } },
      { id: 'down', check: { adapter: 'http', url: `${base}/down`, headers: { authorization: 'env:SECRET_TOKEN' } } },
    ]);
    const { adapters } = await import('../src/adapters/index.js');
    const state = await runOnce({ config, state: {}, now: T0, adapters, env: { SECRET_TOKEN: 'tok-SUPERSECRET-999' } });
    assert.equal(rec(state, 'up').health, 'healthy');
    assert.equal(rec(state, 'down').health, 'failing');
    const published = JSON.stringify(state);
    for (const needle of ['SUPERSECRET', '127.0.0.1', 'internal-body-secret', 'authorization', 'http://']) assert.ok(!published.includes(needle), `leaked: ${needle}`);
  } finally { server.close(); }
});

test('demo data replays 48h through the real pipeline and tells a coherent story', async () => {
  const anchor = Date.UTC(2026, 10, 12, 12, 0, 0);
  const state = await generate(loadConfig('config/services.json'), { anchor });
  const get = (id) => rec(state, id);
  assert.equal(state.status.demo, true);
  assert.equal(get('model-router').health, 'down');
  for (const id of ['document-review', 'knowledge-search']) { assert.equal(get(id).health, 'failing'); assert.equal(get(id).detail, 'waiting on Model Router'); }
  assert.equal(get('policy-qa').health, 'degraded');
  assert.equal(get('code-helper').health, 'maintenance');
  assert.equal(get('ai-gateway').health, 'healthy');
  assert.ok(state.incidents.some((i) => i.service === 'model-router' && i.end === null), 'model-router incident is open');
  assert.ok(state.incidents.some((i) => i.service === 'contract-checker' && i.end !== null), 'contract-checker incident was resolved');
  assert.ok(get('contract-checker').uptime24h < 1 && get('contract-checker').uptime24h > 0.9);
  assert.equal(state.status.services.length, 16);
  assert.equal(get('copilot-seats').health, 'failing');
  assert.match(get('copilot-seats').detail, /^seat usage over limit: \d+% inactive/);
  assert.equal(get('copilot-seats').metrics.seats, 412);
  assert.equal(get('licence-requests').health, 'failing');
  assert.match(get('licence-requests').detail, /^queue over limit: \d+ open/);
  assert.ok(get('licence-requests').metrics.open > 30);
  assert.ok(get('licence-requests').onFloor);
  assert.ok(state.history['ai-gateway'].length >= 576);
});

test('adapter metrics are published only for known keys and only as numbers', async () => {
  const config = cfg([{ id: 'q' }]);
  const adapters = { fake: { check: async () => ({ ok: true, ms: 5, metrics: { open: 7.4, oldestHours: 'ticket INC0012345', ticketText: 'secret', breaching: Infinity } }) } };
  const state = await runOnce({ config, state: {}, now: T0, adapters });
  assert.deepEqual(rec(state, 'q').metrics, { open: 7 });
  assert.ok(!JSON.stringify(state).includes('INC0012345'));
});
