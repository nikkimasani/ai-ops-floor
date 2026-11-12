import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseAck, applyAck, pruneAcks, incidentIdOf } from '../src/ack.js';
import { planIssues, syncIssues, issueBody } from '../src/incident-issues.js';
import { validateConfig } from '../src/config.js';

const inc = (id, service, end = null) => ({ id, service, name: service.toUpperCase(), start: 1000, end });

test('parseAck: only a line that starts with /ack counts; quotes and code fences do not', () => {
  assert.deepEqual(parseAck('/ack'), { ack: true });
  assert.deepEqual(parseAck('/ack investigating, ticket INC-1'), { ack: true }, 'text after /ack is accepted but never kept');
  assert.deepEqual(parseAck('looking now\n/ACK on it'), { ack: true });
  assert.equal(parseAck('> /ack').ack, false);
  assert.equal(parseAck('please /ack this').ack, false);
  assert.equal(parseAck('```\n/ack\n```').ack, false);
  assert.equal(parseAck('/acknowledge').ack, false);
  assert.equal(parseAck('').ack, false);
  assert.ok(!('note' in parseAck('/ack https://secret-host.internal/token=abc')), 'free text is never part of the result');
});

test('incidentIdOf reads the marker from the issue body', () => {
  assert.equal(incidentIdOf(issueBody({ id: 'model-router-123', name: 'Model Router', tier: 1, start: 0 })), 'model-router-123');
  assert.equal(incidentIdOf('no marker'), null);
  assert.equal(incidentIdOf(undefined), null);
});

test('applyAck: first ack wins, later ones are listed, closed/unknown incidents and odd logins are ignored', () => {
  const incidents = [inc('a-1', 'a'), inc('b-1', 'b', 5000)];
  const one = applyAck({}, { incidents, incidentId: 'a-1', by: 'octocat', at: 10, note: 'secret-host.internal' });
  assert.deepEqual(one, { a: { incidentId: 'a-1', by: 'octocat', at: 10 } }, 'a note passed in is never stored');
  const two = applyAck(one, { incidents, incidentId: 'a-1', by: 'hubot', at: 20 });
  assert.deepEqual(two.a, { incidentId: 'a-1', by: 'octocat', at: 10, also: ['hubot'] });
  assert.equal(applyAck(two, { incidents, incidentId: 'a-1', by: 'octocat', at: 30 }), two, 'same person again: no change');
  assert.equal(Object.keys(applyAck({}, { incidents, incidentId: 'b-1', by: 'octocat', at: 1 })).length, 0, 'closed incident');
  assert.equal(Object.keys(applyAck({}, { incidents, incidentId: 'zzz', by: 'octocat', at: 1 })).length, 0, 'unknown incident');
  assert.equal(Object.keys(applyAck({}, { incidents, incidentId: 'a-1', by: 'bad login!', at: 1 })).length, 0, 'invalid login');
});

test('pruneAcks removes acks once their incident closes (or a new incident replaces it)', () => {
  const acks = { a: { incidentId: 'a-1', by: 'x', at: 1 }, b: { incidentId: 'b-1', by: 'y', at: 1 } };
  assert.deepEqual(Object.keys(pruneAcks(acks, [inc('a-1', 'a'), inc('b-1', 'b', 9)])), ['a']);
  assert.deepEqual(pruneAcks(acks, [inc('a-2', 'a')]), {});
});

test('planIssues: open for new incidents, close on recovery, retry an open incident that has no issue', () => {
  const svc = [{ id: 'a', tier: 1 }];
  assert.deepEqual(planIssues([], [inc('a-1', 'a')], svc).open.map((i) => [i.id, i.tier]), [['a-1', 1]]);
  assert.deepEqual(planIssues([inc('a-1', 'a')], [{ ...inc('a-1', 'a'), issue: 7 }], svc), { open: [], close: [] });
  assert.deepEqual(planIssues([inc('a-1', 'a')], [{ ...inc('a-1', 'a', 9000), issue: 7 }], svc).close.map((i) => i.id), ['a-1']);
  const retry = { ...inc('a-1', 'a', 9000), issue: 7 };
  assert.deepEqual(planIssues([retry], [retry], svc).close.map((i) => i.id), ['a-1'], 'a recovery whose close failed is retried on later runs');
  assert.deepEqual(planIssues([retry], [{ ...retry, issueClosed: true }], svc).close, [], 'once closed, never again');
  assert.deepEqual(planIssues([inc('a-1', 'a', 9000)], [inc('a-1', 'a', 9000)], svc).close, [], 'no issue was ever created: nothing to close');
  assert.deepEqual(planIssues([inc('a-1', 'a')], [inc('a-1', 'a')], svc).open.map((i) => i.id), ['a-1'], 'no issue yet: retry');
});

test('syncIssues: creates the issue with name+tier only, comments and closes on recovery, never logs the token', async () => {
  const calls = [], logs = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body), auth: opts.headers?.Authorization });
    if (String(url).endsWith('/issues') && opts.method === 'POST') return { ok: true, status: 201, json: async () => ({ number: 42, html_url: 'https://github.com/o/r/issues/42' }) };
    if (String(url).endsWith('/issues/42') && !opts.method) return { ok: true, status: 200, json: async () => ({ number: 42, state: 'open' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const detail = { ...inc('a-1', 'a'), tier: 1, detail: 'timeout after 8s to secret-host.internal' };
  const r = await syncIssues({ open: [detail], close: [] }, { repo: 'o/r', token: 'ghs_SECRET', fetch: fakeFetch, log: (m) => logs.push(m) });
  assert.deepEqual(r.opened, { 'a-1': { number: 42, url: 'https://github.com/o/r/issues/42' } });
  const created = calls[0].body;
  assert.equal(created.title, 'Incident: A');
  assert.deepEqual(created.labels, ['incident']);
  assert.ok(!JSON.stringify(created).includes('secret-host'), 'no error detail in the issue');
  const c = await syncIssues({ open: [], close: [{ ...inc('a-1', 'a', 61000), durationMs: 60000, issue: 42 }] }, { repo: 'o/r', token: 'ghs_SECRET', fetch: fakeFetch, log: (m) => logs.push(m) });
  assert.equal(c.closed, 1);
  assert.deepEqual(c.closedIds, ['a-1']);
  assert.ok(calls.some((x) => x.method === 'PATCH' && x.body.state === 'closed'));
  assert.ok(calls.some((x) => x.url.endsWith('/issues/42/comments') && /Recovered after/.test(x.body.body)));
  const bad = await syncIssues({ open: [detail], close: [] }, { repo: 'o/r', token: 'ghs_SECRET', fetch: async () => ({ ok: false, status: 403 }), log: (m) => logs.push(m) });
  assert.equal(bad.failed, 1);
  assert.ok(!logs.join('\n').includes('ghs_SECRET'));
});

test('config: sharedAcks needs site.repo', () => {
  const base = { site: { categories: { q: { label: 'Q', room: 'bullpen' } } }, services: [{ id: 'x', name: 'X', category: 'q', check: { adapter: 'fixture', scenario: 'steady' } }] };
  assert.match(validateConfig({ ...base, site: { ...base.site, sharedAcks: true } }).join('\n'), /site\.sharedAcks needs site\.repo/);
  assert.deepEqual(validateConfig({ ...base, site: { ...base.site, sharedAcks: true, repo: 'acme/ai-ops-floor' } }), []);
});

test('ack CLI: records the ack from env, ignores non-acks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ack-'));
  writeFileSync(join(dir, 'incidents.json'), JSON.stringify([inc('a-1', 'a')]));
  const run = (env) => promisify(execFile)('node', ['src/ack.js', '--data', dir], { env: { ...process.env, ...env } }).then((r) => r.stdout);
  const issue = issueBody({ id: 'a-1', name: 'A', start: 0 });
  assert.match(await run({ COMMENT_BODY: 'thanks all', COMMENT_USER: 'octocat', ISSUE_BODY: issue }), /nothing to do/);
  assert.match(await run({ COMMENT_BODY: '/ack on it, see https://secret-host.internal', COMMENT_USER: 'octocat', ISSUE_BODY: issue }), /acknowledged a-1 by octocat/);
  const acks = JSON.parse(readFileSync(join(dir, 'acks.json'), 'utf8'));
  assert.equal(acks.a.by, 'octocat');
  assert.ok(!JSON.stringify(acks).includes('secret-host'), 'the note never reaches the published file');
  assert.match(await run({ COMMENT_BODY: '/ack', COMMENT_USER: 'octocat', ISSUE_BODY: issue }), /no change/);
});

test('syncIssues: looks the issue up by number; failures stay pending; closed or deleted issues count as done', async () => {
  const rec = { ...inc('a-1', 'a', 61000), durationMs: 60000, issue: 42 };
  const calls = [];
  const mk = (read, patch = { ok: true, status: 200 }) => async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${String(url).replace('https://api.github.com/repos/o/r', '')}`);
    if (!opts.method) return read;
    return opts.method === 'PATCH' ? { ...patch, json: async () => ({}) } : { ok: true, status: 201, json: async () => ({}) };
  };
  const json = (state) => ({ ok: true, status: 200, json: async () => ({ number: 42, state }) });
  const run = (read, patch) => syncIssues({ open: [], close: [rec] }, { repo: 'o/r', token: 't', fetch: mk(read, patch), log: () => {} });
  assert.deepEqual((await run(json('open'))).closedIds, ['a-1']);
  assert.ok(calls.includes('GET /issues/42') && calls.includes('PATCH /issues/42'), 'direct lookup by number, never a paged list');
  assert.ok(!calls.some((c) => c.includes('per_page')), 'no listing');
  calls.length = 0;
  assert.deepEqual((await run(json('closed'))).closedIds, ['a-1'], 'already closed (by a person): done');
  assert.ok(!calls.some((c) => c.startsWith('PATCH')), 'and not touched again');
  assert.deepEqual((await run({ ok: false, status: 404 })).closedIds, ['a-1'], 'deleted: done');
  assert.deepEqual((await run({ ok: false, status: 502 })).closedIds, [], 'GitHub error: stays pending, retried next run');
  const failed = await run(json('open'), { ok: false, status: 500 });
  assert.deepEqual(failed.closedIds, []);
  assert.equal(failed.failed, 1);
});

test('reconcileAcks: picks up an /ack whose workflow run was cancelled, only from people with write or triage access', async () => {
  const { reconcileAcks } = await import('../src/ack-reconcile.js');
  const incidents = [{ ...inc('a-1', 'a'), issue: 5 }, { ...inc('b-1', 'b'), issue: 6 }, { ...inc('c-1', 'c') }];
  const comments = { 5: [{ user: { login: 'drive-by' }, body: '/ack', created_at: '2026-11-12T01:00:00Z' }, { user: { login: 'octocat' }, body: 'on it\n/ack', created_at: '2026-11-12T01:05:00Z' }], 6: [{ user: { login: 'octocat' }, body: 'thanks', created_at: '2026-11-12T01:05:00Z' }] };
  const roles = { 'drive-by': 'read', octocat: 'triage' };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    const m = String(url).match(/issues\/(\d+)\/comments/), perm = String(url).match(/collaborators\/([^/]+)\/permission/);
    if (m) return { ok: true, status: 200, json: async () => comments[m[1]] };
    if (perm) return { ok: true, status: 200, json: async () => ({ role_name: roles[perm[1]] }) };
    return { ok: false, status: 404 };
  };
  const acks = await reconcileAcks({}, incidents, { repo: 'o/r', token: 't', fetch: fakeFetch, log: () => {} });
  assert.deepEqual(Object.keys(acks), ['a'], 'only the incident with an authorised /ack; none for b (no /ack) or c (no issue)');
  assert.equal(acks.a.by, 'octocat', 'a read-only user is ignored');
  assert.equal(acks.a.at, Date.parse('2026-11-12T01:05:00Z'));
  const again = await reconcileAcks(acks, incidents, { repo: 'o/r', token: 't', fetch: fakeFetch, log: () => {} });
  assert.deepEqual(again, acks, 'nothing new to record');
  const none = await reconcileAcks({}, incidents, { repo: 'o/r', token: 't', fetch: async () => { throw new Error('boom'); }, log: () => {} });
  assert.deepEqual(none, {}, 'GitHub unreachable: no change, no crash');
  assert.deepEqual(await reconcileAcks({}, incidents, { repo: 'bad repo', token: '', fetch: fakeFetch }), {});
});

test('validAck: an ack only counts for the incident that is open now', async () => {
  const { validAck } = await import('../public/shared/ops.js');
  const acks = { a: { incidentId: 'a-1', by: 'octocat', at: 1 } };
  assert.equal(validAck(acks, [{ id: 'a', incidentId: 'a-1' }], 'a').by, 'octocat');
  assert.equal(validAck(acks, [{ id: 'a', incidentId: 'a-2' }], 'a'), null, 'a newer incident: the old ack does not apply');
  assert.equal(validAck(acks, [{ id: 'a' }], 'a'), null, 'no open incident known: not acknowledged');
  assert.equal(validAck({}, [{ id: 'a', incidentId: 'a-1' }], 'a'), null);
});
