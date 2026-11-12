// Eventual consistency for acknowledgements. The `ack` workflow records an ack quickly, but GitHub keeps only ONE
// pending run per concurrency group, so a queued ack run can be cancelled by a newer run. To make that harmless,
// every probe run also re-reads the comments on each open incident's issue and records any `/ack` from a person
// with write/triage access that isn't recorded yet. Worst case an ack shows up one probe interval later.
import { applyAck, parseAck } from './ack.js';

const ALLOWED = new Set(['admin', 'maintain', 'write', 'triage']);

export async function reconcileAcks(acks, incidents, { repo, token, fetch: doFetch = fetch, log = console.warn }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo)) || !token) return acks;
  const api = (path) => doFetch(`https://api.github.com/repos/${repo}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ai-ops-floor' }, signal: AbortSignal.timeout(10000) });
  const roleOf = new Map();                                              // login -> allowed? (one lookup per person per run)
  const allowed = async (login) => {
    if (!roleOf.has(login)) {
      try { const r = await api(`/collaborators/${encodeURIComponent(login)}/permission`); roleOf.set(login, r.ok && ALLOWED.has((await r.json()).role_name)); }
      catch { roleOf.set(login, false); }
    }
    return roleOf.get(login);
  };
  let next = acks;
  for (const inc of incidents.filter((i) => i.end === null && i.issue)) {
    if (next[inc.service]?.incidentId === inc.id) continue;              // already acknowledged: first ack wins
    try {
      const res = await api(`/issues/${inc.issue}/comments?per_page=100`);
      if (!res.ok) { log(`ack reconcile: reading comments failed (HTTP ${res.status})`); continue; }
      for (const c of await res.json()) {                                 // oldest first: the first authorised /ack wins
        if (!parseAck(c.body).ack || !(await allowed(c.user?.login))) continue;
        next = applyAck(next, { incidents, incidentId: inc.id, by: c.user.login, at: Date.parse(c.created_at) || Date.now() });
        break;
      }
    } catch { log('ack reconcile: reading comments failed (connection error)'); }
  }
  return next;
}
