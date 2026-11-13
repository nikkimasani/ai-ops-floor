#!/usr/bin/env node
// npm run queue -- --config .local/queue.json     (your real sources, your credentials from env vars)
// npm run queue:demo                              (fictional tickets and a canned triage: no credentials needed)
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApp } from './server.js';
import { validateQueueConfig } from './config.js';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
let config;
if (process.argv.includes('--demo')) {
  config = { pollSec: 5, sources: [{ type: 'fixture', name: 'Demo tickets', lateArrivalSec: 20 }], triage: { command: [process.execPath, 'scripts/demo-triage.mjs', '{ref}', '{title}'], auto: false, timeoutSec: 30 } };
} else {
  const path = arg('--config', '.local/queue.json');
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`cannot read ${path}: copy config/queue.example.json to .local/queue.json and edit it (see docs/MY-QUEUE.md)`); process.exit(1); }
  const problems = validateQueueConfig(config);
  if (problems.length) { console.error(`${path} has ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n  - ${problems.join('\n  - ')}`); process.exit(1); }
}
const app = createLocalApp({ config, ...(process.argv.includes('--demo') && { dir: mkdtempSync(join(tmpdir(), 'ops-demo-triage-')) }) });   // demo results start fresh every time
const port = await app.listen(Number(arg('--port', config.port ?? 3100)));
console.log(`My Queue (local only) → http://localhost:${port}`);
