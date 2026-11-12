import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, loadConfig } from '../src/config.js';

const good = () => ({
  site: { categories: { hub: { label: 'Hub', room: 'bullpen' } } },
  services: [{ id: 'a', name: 'A', category: 'hub', check: { adapter: 'fixture', scenario: 'steady' } }, { id: 'b', name: 'B', category: 'hub', dependsOn: ['a'], check: { adapter: 'http', url: 'https://x.example.invalid' } }],
});

test('the shipped demo config is valid', () => { assert.doesNotThrow(() => loadConfig('config/services.json')); });

test('a good config has no problems', () => { assert.deepEqual(validateConfig(good()), []); });

test('every problem is reported at once, in plain words', () => {
  const c = good();
  c.site.categories.bad = { room: 'kitchen' };
  c.services.push({ id: 'a', name: '', category: 'nope', check: { adapter: 'carrier-pigeon' }, dependsOn: ['ghost'] });
  c.services.push({ id: 'Bad Id', name: 'X', category: 'hub', check: { adapter: 'http' }, maintenance: [{ from: 'soon', to: 'later' }] });
  const errors = validateConfig(c).join('\n');
  for (const needle of ['category "bad" needs a label', 'room must be one of', 'duplicate id', 'name is required', 'category "nope" is not defined', 'check.adapter must be one of', 'dependsOn "ghost"', 'id must be lowercase', 'http check needs a url', 'maintenance window']) {
    assert.ok(errors.includes(needle), `missing: ${needle}\n${errors}`);
  }
});

test('structural mistakes are caught', () => {
  assert.ok(validateConfig(null)[0]);
  assert.ok(validateConfig({ site: {}, services: [] }).some((e) => e.includes('site.categories')));
  assert.ok(validateConfig({ site: good().site, services: [] }).some((e) => e.includes('services must be')));
});

test('loadConfig throws one readable error listing every problem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'c.json');
  writeFileSync(path, JSON.stringify({ site: good().site, services: [{ id: 'x' }] }));
  assert.throws(() => loadConfig(path), /has \d+ problems?:\n {2}- /);
  assert.throws(() => loadConfig(join(dir, 'missing.json')), /cannot read/);
});

test('the http example config also validates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  assert.doesNotThrow(() => loadConfig('config/services.example-http.json'));
});

test('servicenow checks need instance, user and password', async () => {
  const { validateConfig } = await import('../src/config.js');
  const base = { site: { categories: { q: { label: 'Q', room: 'bullpen' } } }, services: [{ id: 'q1', name: 'Q', category: 'q', check: { adapter: 'servicenow', instance: 'env:A' } }] };
  assert.match(validateConfig(base).join('\n'), /servicenow check needs instance, user and password/);
  base.services[0].check = { adapter: 'servicenow', instance: 'env:A', user: 'env:B', password: 'env:C' };
  assert.deepEqual(validateConfig(base), []);
});

test('azure-monitor checks need credentials, a resource, a metric and a limit', async () => {
  const { validateConfig } = await import('../src/config.js');
  const mk = (check) => ({ site: { categories: { q: { label: 'Q', room: 'bullpen' } } }, services: [{ id: 'f1', name: 'F', category: 'q', check: { adapter: 'azure-monitor', ...check } }] });
  assert.match(validateConfig(mk({ metric: 'Http5xx' })).join('\n'), /azure-monitor check needs tenantId/);
  const full = { tenantId: 'env:A', clientId: 'env:B', clientSecret: 'env:C', resourceId: 'env:D', metric: 'Http5xx' };
  assert.match(validateConfig(mk(full)).join('\n'), /needs max and\/or min/);
  assert.deepEqual(validateConfig(mk({ ...full, max: 5 })), []);
});

test('copilot-seats checks need org, token and a limit', async () => {
  const { validateConfig } = await import('../src/config.js');
  const mk = (check) => ({ site: { categories: { q: { label: 'Q', room: 'bullpen' } } }, services: [{ id: 'c1', name: 'C', category: 'q', check: { adapter: 'copilot-seats', ...check } }] });
  assert.match(validateConfig(mk({ org: 'env:A' })).join('\n'), /copilot-seats check needs org and token/);
  assert.match(validateConfig(mk({ org: 'env:A', token: 'env:B' })).join('\n'), /needs maxSeats and\/or maxInactivePct/);
  assert.deepEqual(validateConfig(mk({ org: 'env:A', token: 'env:B', maxSeats: 10 })), []);
});
