// Loading and validating config/services.json. Validation reports EVERY problem at once, in plain words,
// because the person fixing it (or Copilot) shouldn't have to find them one at a time.
import { readFileSync } from 'node:fs';
import { adapterNames } from './adapters/index.js';
import { parseWhen } from '../public/shared/ops.js';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const SEATED_ROOMS = ['boardroom', 'bullpen', 'review'];   // the rooms that have desks on the floor

export function validateConfig(cfg) {
  const errors = [];
  const add = (m) => errors.push(m);
  if (!cfg || typeof cfg !== 'object') return ['config must be a JSON object'];
  const cats = cfg.site?.categories;
  if (!cats || typeof cats !== 'object' || !Object.keys(cats).length) add('site.categories is required: { "<key>": { "label": "...", "room": "boardroom|bullpen|review" } }');
  else for (const [k, c] of Object.entries(cats)) {
    if (!c.label) add(`category "${k}" needs a label`);
    if (!SEATED_ROOMS.includes(c.room)) add(`category "${k}" room must be one of ${SEATED_ROOMS.join(', ')} (got "${c.room}")`);
  }
  if (!Array.isArray(cfg.services) || !cfg.services.length) { add('services must be a non-empty array'); return errors; }
  const ids = new Set();
  for (const s of cfg.services) {
    const who = `service "${s?.id ?? '?'}"`;
    if (!s?.id || !SLUG.test(s.id)) add(`${who}: id must be lowercase letters, digits and dashes`);
    else if (ids.has(s.id)) add(`${who}: duplicate id`);
    ids.add(s?.id);
    if (!s?.name) add(`${who}: name is required`);
    if (cats && !cats[s?.category]) add(`${who}: category "${s?.category}" is not defined in site.categories`);
    if (!s?.check || !adapterNames().includes(s.check.adapter)) add(`${who}: check.adapter must be one of ${adapterNames().join(', ')}`);
    else if (s.check.adapter === 'http' && !s.check.url) add(`${who}: http check needs a url`);
    else if (s.check.adapter === 'servicenow' && (!s.check.instance || !s.check.user || !s.check.password)) add(`${who}: servicenow check needs instance, user and password (use "env:NAME" for all three)`);
    else if (s.check.adapter === 'copilot-seats' && (!s.check.org || !s.check.token)) add(`${who}: copilot-seats check needs org and token (use "env:NAME" for both)`);
    else if (s.check.adapter === 'copilot-seats' && s.check.maxSeats == null && s.check.maxInactivePct == null) add(`${who}: copilot-seats check needs maxSeats and/or maxInactivePct`);
    else if (s.check.adapter === 'fixture' && !s.check.scenario) add(`${who}: fixture check needs a scenario`);
    for (const w of s?.maintenance || []) {
      if (!Number.isFinite(parseWhen(w.from)) || !Number.isFinite(parseWhen(w.to))) add(`${who}: maintenance window needs valid "from" and "to" (ISO date, or now-10m / now+2h)`);
    }
  }
  for (const s of cfg.services) for (const d of s.dependsOn || []) if (!ids.has(d)) add(`service "${s.id}": dependsOn "${d}" is not a known service`);
  return errors;
}

export function loadConfig(path) {
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { throw new Error(`cannot read ${path}: ${err.message}`); }
  const errors = validateConfig(cfg);
  if (errors.length) throw new Error(`${path} has ${errors.length} problem${errors.length > 1 ? 's' : ''}:\n  - ${errors.join('\n  - ')}`);
  return cfg;
}
