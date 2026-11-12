// Shared acknowledgements. A teammate comments `/ack` on an incident's GitHub issue; the ack workflow (which has
// already checked the commenter's repo permission) runs this to record WHO acknowledged WHICH service.
//
// acks.json:  { "<serviceId>": { incidentId, by: "<github login>", at: <ms>, note?: "...", also?: ["<login>", ...] } }
// First ack wins; later ones are added to `also`. Acks vanish when their incident closes (pruneAcks).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = /<!--\s*incident:([A-Za-z0-9._-]+)\s*-->/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The incident id embedded in a tracking issue's body (or null). */
export const incidentIdOf = (issueBody) => String(issueBody || '').match(MARKER)?.[1] ?? null;

/**
 * Does this comment acknowledge? Only a line that STARTS with `/ack` counts: quoted replies (`> /ack`) and code
 * fences are ignored. The note is the rest of that line, plain text, capped at 140 chars.
 */
export function parseAck(body) {
  let fenced = false;
  for (const raw of String(body || '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = raw.match(/^\/ack(?:\s+(.*))?$/i);
    if (m) return { ack: true, note: (m[1] || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 140) || undefined };
  }
  return { ack: false };
}

/** Pure: record an ack for the service whose open incident has this id. Returns a new acks object. */
export function applyAck(acks, { incidents, incidentId, by, at, note }) {
  const inc = incidents.find((i) => i.id === incidentId && i.end === null);
  if (!inc || !LOGIN.test(String(by))) return acks;                     // unknown/closed incident or odd login: ignore
  const next = { ...acks }, cur = next[inc.service];
  if (cur && cur.incidentId === inc.id) {
    if (cur.by === by || (cur.also || []).includes(by)) return acks;
    next[inc.service] = { ...cur, also: [...(cur.also || []), by].slice(0, 10) };
  } else next[inc.service] = { incidentId: inc.id, by, at, ...(note && { note }) };
  return next;
}

/** Pure: drop acks whose incident is no longer open. */
export function pruneAcks(acks, incidents) {
  const open = new Set(incidents.filter((i) => i.end === null).map((i) => i.id));
  return Object.fromEntries(Object.entries(acks || {}).filter(([, a]) => open.has(a.incidentId)));
}

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
export const loadAcks = (dir) => readJson(join(dir, 'acks.json'), {});
export function saveAcks(dir, acks) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'acks.json'), JSON.stringify(acks)); }

// CLI, run by .github/workflows/ack.yml. Inputs come from env (never interpolated into a shell command).
async function main() {
  const dir = process.argv[process.argv.indexOf('--data') + 1] || 'public/data';
  const { ack, note } = parseAck(process.env.COMMENT_BODY);
  const incidentId = incidentIdOf(process.env.ISSUE_BODY);
  if (!ack || !incidentId) { console.log('not an acknowledgement of a tracked incident: nothing to do'); return; }
  const incidents = readJson(join(dir, 'incidents.json'), []);
  const before = loadAcks(dir);
  const after = applyAck(before, { incidents, incidentId, by: process.env.COMMENT_USER, at: Date.now(), note });
  if (after === before) { console.log('no change (unknown or closed incident, or already acknowledged by this person)'); return; }
  saveAcks(dir, after);
  console.log(`acknowledged ${incidentId} by ${process.env.COMMENT_USER}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
