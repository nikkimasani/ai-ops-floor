// Runs YOUR triage command (e.g. the Copilot CLI with your /triage skill) for one item and keeps the result locally.
//
// Safety, because ticket text is untrusted input:
//  - the command is an argv ARRAY run with shell:false, so ticket text can never become shell syntax
//  - the child gets a minimal environment: the ServiceNow password and Azure DevOps token are NOT passed on
//  - only the fields in the prompt template ({ref} {title} {source} {kind} {state} {priority} {url}) are sent; the description is not
//  - it never auto-runs unless config.auto is true; one job at a time by default; hard timeout; output size caps
//  - results are saved under .local/ (git-ignored) and shown as AI output to be checked, never acted on automatically
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE_ENV = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'ComSpec', 'LANG'];
const OUT_CAP = 64 * 1024, ERR_CAP = 4 * 1024;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const safeName = (id) => String(id).replace(/[^\w.-]/g, '_').slice(0, 80);

/** Substitute {placeholders} inside each argv element. Values are cleaned and capped; unknown placeholders are left as they are. */
export function buildArgv(template, item) {
  if (!Array.isArray(template) || !template.length || template.some((p) => typeof p !== 'string')) throw new Error('triage.command must be a non-empty array of strings');
  const vars = { ref: clean(item.ref, 40), title: clean(item.title, 200), source: clean(item.source, 20), kind: clean(item.kind, 30), state: clean(item.state, 30), priority: String(item.priority ?? ''), url: clean(item.url, 300) };
  return template.map((p) => p.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
}

/** Kill the command AND everything it started. POSIX: the child leads its own process group, so signal the whole group. Windows: taskkill /T. */
export function killTree(child, spawn = nodeSpawn) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}

export const minimalEnv = (env, passEnv = []) => Object.fromEntries([...BASE_ENV, ...passEnv].filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));

export class TriageManager {
  constructor({ config = {}, dir, env = process.env, spawn = nodeSpawn, now = Date.now, onChange = () => {} } = {}) {
    Object.assign(this, { config, dir, env, spawn, now, onChange });
    this.jobs = new Map();                 // id -> { state, startedAt, endedAt, error }
    this.waiting = [];                     // items waiting for a free slot
    this.running = 0;
  }

  get enabled() { return Array.isArray(this.config.command) && this.config.command.length > 0; }
  file(id) { return join(this.dir, `${safeName(id)}.md`); }

  state(id) {
    const j = this.jobs.get(id);
    if (j) return { ...j };
    if (this.dir && existsSync(this.file(id))) return { state: 'done', endedAt: null };   // finished in an earlier run of the server
    return { state: 'none' };
  }

  result(id) { try { return readFileSync(this.file(id), 'utf8'); } catch { return null; } }

  /** Start (or re-use) a triage job for an item the server already knows about. */
  start(item) {
    if (!this.enabled) throw new Error('triage is not configured');
    const cur = this.jobs.get(item.id);
    if (cur && (cur.state === 'queued' || cur.state === 'running')) return { ...cur };
    this.jobs.set(item.id, { state: 'queued', startedAt: this.now() });
    this.waiting.push(item);
    this.#pump();
    return { ...this.jobs.get(item.id) };
  }

  #set(id, patch) { this.jobs.set(id, { ...this.jobs.get(id), ...patch }); this.onChange(id, this.state(id)); }

  #pump() {
    const limit = this.config.concurrency || 1;
    while (this.running < limit && this.waiting.length) { this.running++; this.#run(this.waiting.shift()).finally(() => { this.running--; this.#pump(); }); }
  }

  #run(item) {
    return new Promise((resolve) => {
      let argv;
      try { argv = buildArgv(this.config.command, item); } catch { this.#set(item.id, { state: 'failed', endedAt: this.now(), error: 'triage command is invalid' }); return resolve(); }
      this.#set(item.id, { state: 'running', startedAt: this.now() });
      let out = '', err = '', settled = false, timedOut = false, child;
      const finish = (patch) => { if (settled) return; settled = true; clearTimeout(timer); this.#set(item.id, { endedAt: this.now(), ...patch }); resolve(); };
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child, this.spawn);                                      // the command's own children too, or they keep the pipes (and this job) alive
        child?.stdout?.destroy(); child?.stderr?.destroy();
        finish({ state: 'failed', error: `timed out after ${this.config.timeoutSec || 300}s` });   // settle NOW: never wait for pipes that a surviving descendant holds open
      }, (this.config.timeoutSec || 300) * 1000);
      try {
        child = this.spawn(argv[0], argv.slice(1), { shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: minimalEnv(this.env, this.config.passEnv), cwd: this.config.cwd || process.cwd() });
      } catch { return finish({ state: 'failed', error: 'could not start the triage command' }); }
      child.stdout?.on('data', (d) => { if (out.length < OUT_CAP) out += d; });
      child.stderr?.on('data', (d) => { if (err.length < ERR_CAP) err += d; });
      child.on('error', (e) => finish({ state: 'failed', error: e.code === 'ENOENT' ? 'triage command not found' : 'could not start the triage command' }));
      child.on('close', (code) => {
        if (timedOut) return finish({ state: 'failed', error: `timed out after ${this.config.timeoutSec || 300}s` });
        if (code !== 0) return finish({ state: 'failed', error: `triage command exited with code ${code}` });
        if (!out.trim()) return finish({ state: 'failed', error: 'triage command produced no output' });
        try {
          mkdirSync(this.dir, { recursive: true, mode: 0o700 });
          writeFileSync(this.file(item.id), `# Triage: ${clean(item.ref, 40)}\n\n_${new Date(this.now()).toISOString()} · AI-generated: check it before acting on it._\n\n${out.slice(0, OUT_CAP)}\n`, { mode: 0o600 });
        } catch { return finish({ state: 'failed', error: 'could not save the triage result' }); }
        finish({ state: 'done' });
      });
    });
  }
}
