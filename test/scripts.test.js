// Drives restore-data.sh / publish-data.sh against a throwaway local "origin", the way the workflow does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const sh = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'ops-'));
  const origin = join(base, 'origin.git'), work = join(base, 'work');
  sh('git', ['init', '--bare', '-q', '-b', 'main', origin], base);
  sh('git', ['clone', '-q', origin, work], base);
  for (const d of ['src', 'scripts', 'public', 'config']) cpSync(join(ROOT, d), join(work, d), { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  // a real (non-demo) fixture config: two steady services
  writeFileSync(join(work, 'config/services.json'), JSON.stringify({ site: { categories: { hub: { label: 'Hub', room: 'bullpen' } } }, services: [{ id: 'a', name: 'A', category: 'hub', check: { adapter: 'fixture', scenario: 'steady' } }, { id: 'b', name: 'B', category: 'hub', dependsOn: ['a'], check: { adapter: 'fixture', scenario: 'steady' } }] }));
  const g = (...a) => sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], work);
  g('add', '-A'); g('commit', '-q', '-m', 'init'); g('push', '-q', 'origin', 'main');
  return { origin, work, g };
}

test('first run starts clean (demo data discarded); later runs continue the history; the data branch stays one commit', () => {
  const { origin, work } = sandbox();
  const probe = () => { sh('bash', ['scripts/restore-data.sh'], work); sh('node', ['src/probe.js'], work); sh('bash', ['scripts/publish-data.sh'], work); };
  const status = () => JSON.parse(readFileSync(join(work, 'public/data/status.json'), 'utf8'));
  const history = () => JSON.parse(readFileSync(join(work, 'public/data/history.json'), 'utf8'));

  assert.equal(status().demo, true, 'main ships demo data');
  probe();
  assert.ok(!status().demo, 'first real run discards demo data');
  assert.equal(history().a.length, 1);

  probe(); probe();
  assert.equal(history().a.length, 3, 'history continues across runs');

  const log = sh('git', ['--git-dir', origin, 'log', '--oneline', 'data'], work).trim().split('\n');
  assert.equal(log.length, 1, 'data branch is a single commit');
  const files = sh('git', ['--git-dir', origin, 'ls-tree', '--name-only', 'data'], work).trim().split('\n').sort();
  assert.deepEqual(files, ['history.json', 'incidents.json', 'status.json']);
  assert.equal(sh('git', ['branch', '--list', 'publish*'], work).trim(), '', 'no temporary branches are left behind');
});

test('publishing leaves the working tree and main branch untouched', () => {
  const { work, g } = sandbox();
  sh('bash', ['scripts/restore-data.sh'], work); sh('node', ['src/probe.js'], work); sh('bash', ['scripts/publish-data.sh'], work);
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.ok(existsSync(join(work, 'src/probe.js')));
  assert.equal(sh('git', ['worktree', 'list'], work).trim().split('\n').length, 1, 'temporary worktree was cleaned up');
});
