import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servicenowAssigned, adoAssigned, fixtureAssigned, fetchQueue } from '../src/queue/sources.js';
import { rankQueue, nextUp, diffQueue, scoreItem } from '../src/queue/rank.js';
import { buildArgv, minimalEnv, TriageManager, safeName } from '../src/queue/triage.js';
import { createLocalApp } from '../src/queue/server.js';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0), H = 3600000;
const SN = { instance: 'env:SN_I', user: 'env:SN_U', password: 'env:SN_P', tables: ['incident'] };
const SN_ENV = { SN_I: 'https://acme-secret-corp.service-now.com/', SN_U: 'alice', SN_P: 'pw-SECRET-123' };
const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// ---------- sources ----------
test('servicenow: asks for MY active items, maps fields, builds a link, and uses basic auth', async () => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return res({ result: [
    { number: 'INC001', short_description: 'VPN\nbroken   for all', priority: '2', state: '1', opened_at: '2026-11-12 10:00:00', sys_updated_on: '2026-11-12 11:00:00', sys_id: 'a'.repeat(32) },
    { number: 'INC002', short_description: '', priority: '9', state: '3', opened_at: 'garbage', sys_id: 'not-a-sysid' }] }); };
  const r = await servicenowAssigned(SN, { env: SN_ENV, fetch });
  assert.equal(r.ok, true);
  const q = decodeURIComponent(calls[0].url);
  assert.match(q, /^https:\/\/acme-secret-corp\.service-now\.com\/api\/now\/table\/incident\?/);
  assert.match(q, /sysparm_query=assigned_to\.user_name=alice\^active=true/);
  assert.equal(calls[0].opts.headers.Authorization, `Basic ${Buffer.from('alice:pw-SECRET-123').toString('base64')}`);
  const [a, b] = r.items;
  assert.deepEqual([a.id, a.title, a.priority, a.state, a.kind], ['sn:INC001', 'VPN broken for all', 2, 'New', 'Incident']);
  assert.equal(a.openedAt, Date.UTC(2026, 10, 12, 10, 0, 0));
  assert.match(a.url, /^https:\/\/acme-secret-corp\.service-now\.com\/nav_to\.do\?uri=incident\.do%3Fsys_id%3Da{32}$/);
  assert.deepEqual([b.title, b.priority, b.state, b.openedAt, b.url], ['(no title)', 4, 'On hold', null, null]);
});

test('servicenow: refuses an assignedTo that could alter the query; errors never leak the instance, user or password', async () => {
  assert.match((await servicenowAssigned({ ...SN, assignedTo: 'x^ORactive=false' }, { env: SN_ENV, fetch: async () => { throw new Error('should not be called'); } })).error, /configuration error/);
  assert.match((await servicenowAssigned({ ...SN, instance: 'http://insecure.example' }, { env: { ...SN_ENV, SN_I: 'http://insecure.example' } })).error, /configuration error/);
  const outs = [
    await servicenowAssigned(SN, { env: SN_ENV, fetch: async () => res({}, 401) }),
    await servicenowAssigned(SN, { env: SN_ENV, fetch: async () => { throw new Error('ENOTFOUND acme-secret-corp.service-now.com alice pw-SECRET-123'); } }),
    await servicenowAssigned(SN, { env: SN_ENV, fetch: async () => res({ nope: 1 }) }),
    await servicenowAssigned(SN, { env: {} }),
  ];
  assert.deepEqual(outs.map((o) => o.error), ['HTTP 401', 'connection failed', 'unexpected response body', 'configuration error: missing or invalid setting']);
  const all = JSON.stringify(outs);
  for (const s of ['acme-secret-corp', 'alice', 'pw-SECRET']) assert.ok(!all.includes(s), `leaked ${s}`);
});

test('ado: runs the @Me query, then fetches the work items by id, and links to them', async () => {
  const calls = [];
  const fetch = async (url, opts = {}) => { calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body, auth: opts.headers?.Authorization });
    if (opts.method === 'POST') return res({ workItems: [{ id: 1042 }, { id: 7 }] });
    return res({ value: [{ id: 1042, fields: { 'System.Title': 'Add /api/health', 'System.State': 'Active', 'System.WorkItemType': 'Task', 'Microsoft.VSTS.Common.Priority': 2, 'System.ChangedDate': '2026-11-12T09:00:00Z', 'System.CreatedDate': '2026-11-10T09:00:00Z', 'System.TeamProject': 'AI Hub' } }] }); };
  const r = await adoAssigned({ org: 'env:O', pat: 'env:P' }, { env: { O: 'acme-org', P: 'pat-SECRET' }, fetch });
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /^https:\/\/dev\.azure\.com\/acme-org\/_apis\/wit\/wiql\?api-version=7\.1$/);
  assert.match(JSON.parse(calls[0].body).query, /\[System\.AssignedTo\] = @Me/);
  assert.equal(calls[0].auth, `Basic ${Buffer.from(':pat-SECRET').toString('base64')}`);
  assert.match(calls[1].url, /workitems\?ids=1042,7&fields=/);
  assert.deepEqual([r.items[0].id, r.items[0].ref, r.items[0].priority, r.items[0].kind], ['ado:1042', '#1042', 2, 'Task']);
  assert.equal(r.items[0].url, 'https://dev.azure.com/acme-org/AI%20Hub/_workitems/edit/1042');
  assert.deepEqual(await adoAssigned({ org: 'env:O', pat: 'env:P' }, { env: { O: 'acme-org', P: 'x' }, fetch: async () => res({ workItems: [] }) }), { ok: true, items: [] });
});

test('ado: errors are generic and never leak the org or the token', async () => {
  const env = { O: 'secret-org', P: 'pat-SECRET' };
  const outs = [await adoAssigned({ org: 'env:O', pat: 'env:P' }, { env, fetch: async () => res({}, 403) }), await adoAssigned({ org: 'env:O', pat: 'env:P' }, { env, fetch: async () => { throw new Error('dev.azure.com/secret-org pat-SECRET'); } }), await adoAssigned({ org: 'bad org!', pat: 'env:P' }, { env })];
  assert.deepEqual(outs.map((o) => o.error), ['HTTP 403', 'connection failed', 'configuration error: missing or invalid setting']);
  const all = JSON.stringify(outs);
  assert.ok(!all.includes('secret-org') && !all.includes('pat-SECRET'));
});

test('fetchQueue: one broken source never hides the others', async () => {
  const q = await fetchQueue([{ type: 'fixture', name: 'Demo' }, { type: 'servicenow', name: 'SN' }, { type: 'nope', name: 'X' }], { env: {}, now: NOW, startedAt: NOW });
  assert.equal(q.items.length, 3);
  assert.deepEqual(q.sources.map((s) => [s.name, s.ok, s.count]), [['Demo', true, 3], ['SN', false, 0], ['X', false, 0]]);
});

// ---------- rank ----------
const item = (o) => ({ id: 'x', priority: 3, state: 'In progress', openedAt: NOW - H, updatedAt: NOW - H, ...o });

test('rank: urgent and not-yet-started items come first, held items last, with a plain reason', () => {
  const ranked = rankQueue([
    item({ id: 'hold', priority: 1, state: 'On hold' }), item({ id: 'routine', priority: 3 }), item({ id: 'p1new', priority: 1, state: 'New' }),
    item({ id: 'stale', priority: 3, openedAt: NOW - 120 * H, updatedAt: NOW - 100 * H }),
  ], NOW);
  assert.deepEqual(ranked.map((i) => i.id), ['p1new', 'stale', 'routine', 'hold']);
  assert.match(ranked[0].why, /priority 1.*not started/);
  assert.match(scoreItem(item({ openedAt: NOW - 72 * H }), NOW).why, /open 3d/);
  assert.equal(nextUp(ranked).id, 'p1new');
  assert.equal(nextUp(rankQueue([item({ id: 'h', state: 'On hold' })], NOW)).id, 'h', 'if everything is on hold, still show something');
  assert.equal(nextUp([]), null);
});

test('diffQueue: finds new arrivals and resolved items', () => {
  const d = diffQueue(new Set(['a', 'b']), [{ id: 'b' }, { id: 'c' }]);
  assert.deepEqual([d.arrived.map((i) => i.id), d.gone], [['c'], ['a']]);
});

// ---------- triage ----------
test('buildArgv: ticket text stays inside one argument, so it can never become shell syntax', () => {
  const argv = buildArgv(['tool', '--prompt', '/triage {ref}: {title}', '{nope}'], { ref: 'INC1', title: '"; rm -rf ~ #\n$(whoami)' });
  assert.equal(argv.length, 4);
  assert.equal(argv[2], '/triage INC1: "; rm -rf ~ # $(whoami)');
  assert.equal(argv[3], '{nope}');
  assert.throws(() => buildArgv([], {}), /non-empty array/);
  assert.throws(() => buildArgv('gh copilot', {}), /non-empty array/);
});

test('minimalEnv: the triage command does not inherit the ServiceNow password or Azure DevOps token', () => {
  const env = minimalEnv({ PATH: '/bin', HOME: '/h', SN_P: 'secret', ADO_PAT: 'secret', GH_TOKEN: 'gh' }, ['GH_TOKEN']);
  assert.deepEqual(Object.keys(env).sort(), ['GH_TOKEN', 'HOME', 'PATH']);
});

const nodeCmd = (code) => [process.execPath, '-e', code, '{ref}'];
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timed out waiting'); };

test('triage manager: runs the command, saves the result locally, and reports each state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tri-')), seen = [];
  const m = new TriageManager({ config: { command: nodeCmd("console.log('Likely: licence request for ' + process.argv[1] + '; secret=' + (process.env.SN_P || 'unset'))") }, dir, env: { PATH: process.env.PATH, SN_P: 'pw-SECRET' }, onChange: (id, s) => seen.push(s.state) });
  assert.equal(m.state('sn:INC1').state, 'none');
  m.start({ id: 'sn:INC1', ref: 'INC1', title: 't' });
  await waitFor(() => m.state('sn:INC1').state === 'done');
  const text = m.result('sn:INC1');
  assert.match(text, /^# Triage: INC1/);
  assert.match(text, /AI-generated: check it before acting on it/);
  assert.match(text, /licence request for INC1/);
  assert.match(text, /secret=unset/, 'the child never saw the password');
  assert.deepEqual([...new Set(seen)], ['running', 'done']);
  assert.equal(safeName('sn:INC/../1'), 'sn_INC_.._1');
  assert.ok(existsSync(join(dir, 'sn_INC1.md')));
  assert.equal(new TriageManager({ config: m.config, dir }).state('sn:INC1').state, 'done', 'a result from an earlier run is still found');
});

test('triage manager: failures are reported plainly (bad exit, no output, timeout, missing command, unconfigured)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tri-'));
  const run = async (command, extra = {}) => { const m = new TriageManager({ config: { command, ...extra }, dir }); m.start({ id: 'x', ref: 'X', title: 't' }); await waitFor(() => ['done', 'failed'].includes(m.state('x').state)); return m.state('x'); };
  assert.equal((await run(nodeCmd('process.exit(3)'))).error, 'triage command exited with code 3');
  assert.equal((await run(nodeCmd(''))).error, 'triage command produced no output');
  assert.match((await run(nodeCmd('setTimeout(()=>{}, 60000)'), { timeoutSec: 0.2 })).error, /timed out/);
  assert.equal((await run(['definitely-not-a-real-command-xyz'])).error, 'triage command not found');
  assert.throws(() => new TriageManager({ config: {}, dir }).start({ id: 'x' }), /not configured/);
});

test('triage manager: one job at a time by default, and starting twice does not run twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tri-')), order = [];
  const m = new TriageManager({ config: { command: nodeCmd("setTimeout(()=>console.log('ok'), 150)") }, dir, onChange: (id, s) => order.push(`${id}:${s.state}`) });
  m.start({ id: 'a', ref: 'A', title: '' }); m.start({ id: 'b', ref: 'B', title: '' });
  const again = m.start({ id: 'a', ref: 'A', title: '' });
  assert.ok(['queued', 'running'].includes(again.state));
  await waitFor(() => m.state('a').state === 'done' && m.state('b').state === 'done');
  assert.ok(order.indexOf('a:done') < order.indexOf('b:running'), `b must wait for a: ${order.join(' ')}`);
  assert.equal(order.filter((o) => o === 'a:running').length, 1);
});

// ---------- local server ----------
const get = (port, path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b, json: () => JSON.parse(b) })); });
  r.on('error', reject); r.end();
});

test('local server: serves the ranked queue only to localhost, guards the triage button, and runs triage end to end', async () => {
  let now = NOW, started = NOW;
  const app = createLocalApp({ config: { sources: [{ type: 'fixture', name: 'Demo', lateArrivalSec: 20 }], triage: { command: nodeCmd("console.log('Triage note for ' + process.argv[1])"), auto: false } }, dir: mkdtempSync(join(tmpdir(), 'tri-')), now: () => now, log: () => {} });
  const port = await app.listen(0);
  try {
    let q = (await get(port, '/api/queue')).json();
    assert.equal(q.items.length, 3);
    assert.equal(q.triage.enabled, true);
    assert.equal(q.items.every((i) => i.arrivedAt === null), true, 'items present at startup are not "arrivals"');
    assert.equal(q.next, q.items[0].id);
    assert.equal((await get(port, '/api/queue', { headers: { host: 'evil.example' } })).status, 421, 'DNS-rebinding guard');
    assert.equal((await get(port, '/api/queue', { headers: { host: `localhost:${port}` } })).status, 200);

    now = NOW + 30000; await app.refresh();                                   // the late ticket gets assigned
    q = (await get(port, '/api/queue')).json();
    const late = q.items.find((i) => i.id === 'sn:INC0010002');
    assert.ok(late && late.arrivedAt === NOW + 30000, 'a ticket assigned while running is marked as an arrival');
    assert.equal(q.items[0].id, 'sn:INC0010002', 'a new P1 jumps to the top');

    const id = encodeURIComponent('sn:INC0010002');
    assert.equal((await get(port, `/api/triage/${id}`, { method: 'POST' })).status, 403, 'needs the local header');
    assert.equal((await get(port, `/api/triage/${id}`, { method: 'POST', headers: { 'x-ops-local': '1', origin: 'http://evil.example' } })).status, 403, 'wrong origin');
    assert.equal((await get(port, '/api/triage/nope', { method: 'POST', headers: { 'x-ops-local': '1' } })).status, 404, 'only known items');
    assert.equal((await get(port, `/api/triage/${id}`, { method: 'POST', headers: { 'x-ops-local': '1', origin: `http://127.0.0.1:${port}` } })).status, 202);
    await waitFor(() => app.triage.state('sn:INC0010002').state === 'done');
    const done = (await get(port, `/api/triage/${id}`)).json();
    assert.equal(done.state, 'done');
    assert.match(done.result, /Triage note for INC0010002/);

    assert.equal((await get(port, '/')).status, 200);
    const escape = await get(port, '/..%2f..%2fpackage.json');
    assert.notEqual(escape.status, 200, 'cannot read files outside public/');
    assert.ok(!escape.body.includes('"name": "ai-ops-floor"'));
    assert.equal((await get(port, '/api/nothing')).status, 404);
  } finally { await app.close(); }
});

test('local server: auto-triage starts on a new arrival only when switched on, and never for items present at startup', async () => {
  let now = NOW; const started = [];
  const app = createLocalApp({ config: { sources: [{ type: 'fixture', name: 'Demo', lateArrivalSec: 20 }], triage: { command: nodeCmd("console.log('x')"), auto: true } }, dir: mkdtempSync(join(tmpdir(), 'tri-')), now: () => now, log: () => {} });
  const port = await app.listen(0);
  try {
    assert.equal(app.triage.jobs.size, 0, 'nothing runs for the tickets that were already assigned');
    now = NOW + 30000; await app.refresh();
    assert.deepEqual([...app.triage.jobs.keys()], ['sn:INC0010002']);
    void started; void port;
  } finally { await app.close(); }
});

// ---------- config ----------
import { validateQueueConfig } from '../src/queue/config.js';
import { readFileSync as readJson } from 'node:fs';

test('queue config: secrets must be env: references, the triage command must be real and must not be a shell', () => {
  const ok = { sources: [{ type: 'servicenow', instance: 'env:A', user: 'env:B', password: 'env:C' }, { type: 'ado', org: 'env:D', pat: 'env:E' }], triage: { command: ['copilot', '-p', '/triage {ref}'] } };
  assert.deepEqual(validateQueueConfig(ok), []);
  const bad = validateQueueConfig({ sources: [{ type: 'servicenow', instance: 'https://real.service-now.com', user: 'env:B', password: 'hunter2' }, { type: 'ado', org: 'env:D' }, { type: 'jira' }], triage: { command: ['bash', '-c', 'x'], passEnv: ['ADO_PAT'], auto: 'yes' } }).join('\n');
  for (const re of [/"instance" must be an "env:NAME"/, /"password" must be an "env:NAME"/, /"pat" must be an "env:NAME"/, /type must be servicenow, ado or fixture/, /must not start a shell/, /passEnv/, /auto must be true or false/]) assert.match(bad, re);
  assert.match(validateQueueConfig({ sources: [{ type: 'fixture' }], triage: { command: ['gh', 'REPLACE-WITH-x'] } }).join('\n'), /REPLACE-WITH placeholder/);
  assert.match(validateQueueConfig({ sources: [] }).join('\n'), /non-empty array/);
  assert.match(validateQueueConfig({ sources: [{ type: 'fixture' }], triage: { command: 'gh copilot' } }).join('\n'), /array of strings/);
});

test('the shipped example config is valid except for the one placeholder you must fill in, and holds no real values', () => {
  const raw = readJson('config/queue.example.json', 'utf8'), cfg = JSON.parse(raw);
  const problems = validateQueueConfig(cfg);
  assert.deepEqual(problems.map((p) => p.replace(/:.*/, '')), ['triage.command still has a REPLACE-WITH placeholder'], 'fails safe until the command is filled in');
  assert.ok(!/https?:\/\//.test(raw), 'no URLs in the example');
});

test('ado: a bad token is reported as an auth failure (Azure DevOps answers 203 with a sign-in page)', async () => {
  const r = await adoAssigned({ org: 'env:O', pat: 'env:P' }, { env: { O: 'acme', P: 'x' }, fetch: async () => ({ ok: true, status: 203, json: async () => { throw new Error('<html>sign in</html>'); } }) });
  assert.equal(r.error, 'HTTP 401');
});
