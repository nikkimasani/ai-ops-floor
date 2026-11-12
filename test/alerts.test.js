import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAlerts, sendAlerts, formatAlert } from '../src/alerts.js';
import { validateConfig } from '../src/config.js';

const services = [{ id: 'a', tier: 1 }, { id: 'b', tier: 3 }];
const open = (id, service, name = service) => ({ id, service, name, start: 1000, end: null, detail: 'timeout after 8s to secret-host.internal' });
const closed = (i) => ({ ...i, end: 61000, durationMs: 60000 });

test('one alert when an incident opens, none while it stays open, one when it closes', () => {
  const none = planAlerts([], [], services);
  assert.deepEqual(none, []);
  const opened = planAlerts([], [open('a-1', 'a', 'Model Router')], services);
  assert.deepEqual(opened.map((a) => [a.kind, a.name, a.tier]), [['down', 'Model Router', 1]]);
  assert.deepEqual(planAlerts([open('a-1', 'a')], [open('a-1', 'a')], services), []);
  const rec = planAlerts([open('a-1', 'a', 'Model Router')], [closed(open('a-1', 'a', 'Model Router'))], services);
  assert.deepEqual(rec.map((a) => [a.kind, a.durationMs]), [['recovered', 60000]]);
  assert.deepEqual(planAlerts([closed(open('a-1', 'a'))], [closed(open('a-1', 'a'))], services), [], 'already-closed incidents are never re-announced');
});

test('maxTier filters out low-priority services', () => {
  const next = [open('a-1', 'a'), open('b-1', 'b')];
  assert.deepEqual(planAlerts([], next, services, { maxTier: 2 }).map((a) => a.incident), ['a-1']);
});

test('messages contain the service name and tier, never the incident detail', () => {
  const [a] = planAlerts([], [open('a-1', 'a', 'Model Router')], services);
  const text = formatAlert(a);
  assert.equal(text, '🥀 Model Router (Tier 1) is DOWN');
  assert.ok(!text.includes('secret-host') && !JSON.stringify(a).includes('secret-host'));
  assert.match(formatAlert({ kind: 'recovered', name: 'X', tier: 2, durationMs: 90 * 60000 }), /^✅ X \(Tier 2\) recovered after/);
});

test('sends one POST per alert; the webhook URL is never logged', async () => {
  const posts = [], logs = [];
  const fakeFetch = async (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; };
  const env = { HOOK: 'https://hooks.example.test/T000/SECRET-PATH' };
  const alerts = [{ kind: 'down', name: 'A', tier: 1 }, { kind: 'recovered', name: 'B', tier: 2, durationMs: 60000 }];
  const r = await sendAlerts(alerts, { webhook: 'env:HOOK' }, { env, fetch: fakeFetch, log: (m) => logs.push(m) });
  assert.deepEqual(r, { sent: 2, failed: 0 });
  assert.equal(posts[0].url, env.HOOK);
  assert.deepEqual(Object.keys(posts[0].body), ['text']);
  const j = await sendAlerts([alerts[0]], { webhook: 'env:HOOK', format: 'json' }, { env, fetch: fakeFetch, log: () => {} });
  assert.deepEqual(posts[2].body, { event: 'down', service: 'A', tier: 1, text: '🥀 A (Tier 1) is DOWN' });
  assert.equal(j.sent, 1);
  assert.deepEqual(logs, []);
});

test('failures are counted and logged without the URL; a missing secret sends nothing', async () => {
  const logs = [];
  const env = { HOOK: 'https://hooks.example.test/T000/SECRET-PATH' };
  const a = [{ kind: 'down', name: 'A', tier: 1 }];
  assert.deepEqual(await sendAlerts(a, { webhook: 'env:HOOK' }, { env, fetch: async () => ({ ok: false, status: 500 }), log: (m) => logs.push(m) }), { sent: 0, failed: 1 });
  assert.deepEqual(await sendAlerts(a, { webhook: 'env:HOOK' }, { env, fetch: async () => { throw new Error('ECONNREFUSED hooks.example.test/T000/SECRET-PATH'); }, log: (m) => logs.push(m) }), { sent: 0, failed: 1 });
  let called = false;
  assert.deepEqual(await sendAlerts(a, { webhook: 'env:NOPE' }, { env: {}, fetch: async () => { called = true; }, log: (m) => logs.push(m) }), { sent: 0, failed: 1 });
  assert.equal(called, false);
  assert.ok(!logs.join('\n').includes('SECRET-PATH') && !logs.join('\n').includes('hooks.example.test'));
  assert.deepEqual(await sendAlerts([], { webhook: 'env:HOOK' }, { env, log: (m) => logs.push(m) }), { sent: 0, failed: 0 });
});

test('config: the webhook must be an env: reference', () => {
  const base = { site: { categories: { q: { label: 'Q', room: 'bullpen' } } }, services: [{ id: 'x', name: 'X', category: 'q', check: { adapter: 'fixture', scenario: 'steady' } }] };
  assert.match(validateConfig({ ...base, alerts: { webhook: 'https://hooks.example.test/abc' } }).join('\n'), /alerts\.webhook must be an "env:NAME" reference/);
  assert.match(validateConfig({ ...base, alerts: { webhook: 'env:H', format: 'xml' } }).join('\n'), /alerts\.format/);
  assert.deepEqual(validateConfig({ ...base, alerts: { webhook: 'env:H', maxTier: 2 } }), []);
});

// ---------- end to end: the real CLI with a failing endpoint ----------
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('CLI: an outage triggers one alert attempt, a re-run sends nothing, and a failed delivery never prints the webhook URL', async () => {
  const target = http.createServer((req, res) => { res.statusCode = 500; res.end('internal-detail-xyz'); });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'alerts-'));
  const cfgPath = join(dir, 'services.json');
  writeFileSync(cfgPath, JSON.stringify({
    site: { categories: { q: { label: 'Q', room: 'bullpen' } } },
    alerts: { webhook: 'env:HOOK' },
    services: [{ id: 'svc', name: 'Model Router', category: 'q', tier: 1, thresholds: { downAfter: 1 }, check: { adapter: 'http', url: `http://127.0.0.1:${target.address().port}/` } }],
  }));
  // The webhook must be https, so a local http server can't receive it: point it at a closed port and check the failure path.
  const run = async () => {
    const { stdout, stderr } = await promisify(execFile)('node', ['src/probe.js', '--config', cfgPath, '--data', join(dir, 'data')], { env: { ...process.env, HOOK: 'https://127.0.0.1:1/secret-token', NODE_NO_WARNINGS: '1' } });
    return stdout + stderr;
  };
  const out1 = await run();
  assert.match(out1, /alerts: 0 sent, 1 failed/);
  assert.ok(!out1.includes('secret-token') && !out1.includes('127.0.0.1:1/'));
  const out2 = await run();
  assert.ok(!out2.includes('alerts:'), 'second run: the incident is already known, so nothing is sent');
  target.close();
});
