import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { check as httpCheck, resolveEnv } from '../src/adapters/http.js';
import { check as fixtureCheck, SCENARIOS } from '../src/adapters/fixture.js';

let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url;
    if (url === '/ok') { res.end('all ok'); }
    else if (url === '/slow') { setTimeout(() => res.end('late'), 400); }
    else if (url === '/503') { res.statusCode = 503; res.end('boom internal-detail-secret'); }
    else if (url === '/auth') { res.statusCode = req.headers['x-functions-key'] === 'k-123' ? 200 : 401; res.end(); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('a good response is ok with a latency', async () => {
  const r = await httpCheck({ url: `${base}/ok` });
  assert.equal(r.ok, true); assert.ok(r.ms >= 0);
});

test('expectStatus and expectBodyIncludes are honoured', async () => {
  assert.equal((await httpCheck({ url: `${base}/404`, expectStatus: 404 })).ok, true);
  assert.equal((await httpCheck({ url: `${base}/ok`, expectBodyIncludes: 'all ok' })).ok, true);
  const miss = await httpCheck({ url: `${base}/ok`, expectBodyIncludes: 'nope' });
  assert.equal(miss.ok, false); assert.equal(miss.error, 'unexpected response body');
});

test('error statuses fail with a generic message that never echoes the response body', async () => {
  const r = await httpCheck({ url: `${base}/503` });
  assert.equal(r.ok, false); assert.equal(r.error, 'HTTP 503');
  assert.ok(!JSON.stringify(r).includes('internal-detail-secret'));
});

test('timeouts and refused connections are reported without leaking the URL or host', async () => {
  const slow = await httpCheck({ url: `${base}/slow`, timeoutMs: 100 });
  assert.equal(slow.ok, false); assert.match(slow.error, /^timeout after \d+s$/);
  const refused = await httpCheck({ url: 'http://127.0.0.1:1/never' });
  assert.equal(refused.ok, false); assert.match(refused.error, /^connection failed/);
  for (const r of [slow, refused]) assert.ok(!/127\.0\.0\.1|http:/.test(r.error), r.error);
});

test('headers can come from environment variables (GitHub Actions secrets)', async () => {
  const cfg = { url: `${base}/auth`, headers: { 'x-functions-key': 'env:FUNC_KEY' } };
  assert.equal((await httpCheck(cfg, { env: { FUNC_KEY: 'k-123' } })).ok, true);
  assert.equal((await httpCheck(cfg, { env: { FUNC_KEY: 'wrong' } })).error, 'HTTP 401');
});

test('a missing secret fails safely and names neither the variable value nor the URL', async () => {
  const r = await httpCheck({ url: `${base}/auth`, headers: { a: 'env:NOT_SET' } }, { env: {} });
  assert.equal(r.ok, false); assert.equal(r.error, 'configuration error: missing secret');
  assert.throws(() => resolveEnv('env:NOT_SET', {}), /missing environment variable NOT_SET/);
  assert.equal(resolveEnv('plain', {}), 'plain');
});

test('fixture scenarios are deterministic and behave as named', async () => {
  const ctx = { serviceId: 'x', now: 1_000_000_000_000, anchor: 1_000_000_000_000 };
  assert.deepEqual(await fixtureCheck({ scenario: 'steady' }, ctx), await fixtureCheck({ scenario: 'steady' }, ctx));
  assert.equal((await fixtureCheck({ scenario: 'steady' }, ctx)).ok, true);
  assert.ok((await fixtureCheck({ scenario: 'slow' }, ctx)).ms > 1500);
  assert.equal((await fixtureCheck({ scenario: 'outage-now' }, ctx)).ok, false);
  assert.equal((await fixtureCheck({ scenario: 'outage-now' }, { ...ctx, now: ctx.anchor - 3600000 })).ok, true);
  assert.equal((await fixtureCheck({ scenario: 'recovered' }, { ...ctx, now: ctx.anchor - 4.6 * 3600000 })).ok, false);
  assert.equal((await fixtureCheck({ scenario: 'nope' }, ctx)).ok, false);
  assert.ok(Object.keys(SCENARIOS).length >= 6);
});

// ---------- servicenow ----------
import { check as snCheck, evaluate as snEvaluate } from '../src/adapters/servicenow.js';
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const sn = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const snCfg = { instance: 'https://acme-secret-corp.service-now.com', user: 'svc-user', password: 'pw-123', maxOpen: 3, maxOldestHours: 72, slaHours: 48, query: 'active=true^assignment_group=SECRETGROUP' };
const fakeFetch = (rows, { status = 200, headers = {} } = {}) => async () => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => ({ result: rows }) });

test('servicenow: counts, oldest age and past-SLA tickets; within limits is ok', async () => {
  const r = await snCheck({ ...snCfg, maxOpen: 10 }, { now: NOW, fetch: fakeFetch([{ sys_created_on: sn(1) }, { sys_created_on: sn(50) }, { sys_created_on: sn(5) }]) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.metrics, { open: 3, oldestHours: 50, breaching: 1 });
});

test('servicenow: over the limits fails with a numbers-only reason', () => {
  const r = snEvaluate([sn(1), sn(2), sn(3), sn(80)], snCfg, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'queue over limit: 4 open (max 3), oldest 80h (max 72h)');
});

test('servicenow: uses the total count header when the page is capped', async () => {
  const r = await snCheck({ ...snCfg, maxOpen: 5000 }, { now: NOW, fetch: fakeFetch([{ sys_created_on: sn(1) }], { headers: { 'x-total-count': '1500' } }) });
  assert.equal(r.metrics.open, 1500);
});

test('servicenow: errors never leak the instance, credentials, query or ticket data', async () => {
  const rows = [{ sys_created_on: sn(1), number: 'INC0099999', short_description: 'VPN broken for jsmith' }];
  const results = [
    await snCheck(snCfg, { now: NOW, fetch: fakeFetch(rows) }),
    await snCheck(snCfg, { now: NOW, fetch: fakeFetch([], { status: 401 }) }),
    await snCheck(snCfg, { now: NOW, fetch: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND acme-secret-corp.service-now.com'), { cause: { code: 'ENOTFOUND' } }); } }),
    await snCheck({ ...snCfg, instance: 'env:NOPE' }, { now: NOW, env: {} }),
    await snCheck(snCfg, { now: NOW, fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ nope: 1 }) }) }),
  ];
  assert.deepEqual(results.map((r) => r.error ?? null), [null, 'HTTP 401', 'connection failed', 'configuration error: missing secret', 'unexpected response body']);
  const all = JSON.stringify(results);
  for (const secret of ['acme-secret-corp', 'svc-user', 'pw-123', 'SECRETGROUP', 'INC0099999', 'jsmith', 'VPN']) assert.ok(!all.includes(secret), `leaked ${secret}`);
});

test('servicenow: sends basic auth and the configured query, and asks only for creation time', async () => {
  let seen;
  await snCheck(snCfg, { now: NOW, fetch: async (url, opts) => { seen = { url, opts }; return fakeFetch([])(); } });
  assert.match(seen.url, /^https:\/\/acme-secret-corp\.service-now\.com\/api\/now\/table\/incident\?/);
  assert.match(seen.url, /sysparm_fields=sys_created_on/);
  assert.match(decodeURIComponent(seen.url), /assignment_group=SECRETGROUP/);
  assert.equal(seen.opts.headers.Authorization, `Basic ${Buffer.from('svc-user:pw-123').toString('base64')}`);
});
