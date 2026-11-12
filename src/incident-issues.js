// One GitHub issue per incident: opened when the incident opens, closed (with a comment) when it recovers.
// The issue is where people `/ack` and where notes and the resolution live. Only enable this in a PRIVATE repo:
// issue titles name services.
//
// Needs GITHUB_REPOSITORY and GITHUB_TOKEN (provided by Actions; the probe workflow needs `issues: write`).
// Failures are logged without the token and never stop the probe.
import { fmtMs } from '../public/shared/ops.js';

/** Pure: which incidents need an issue opened / closed, comparing the incident lists before and after a run. */
export function planIssues(prevIncidents = [], nextIncidents = [], services = []) {
  const prev = new Map(prevIncidents.map((i) => [i.id, i]));
  const tier = new Map(services.map((s) => [s.id, s.tier]));
  const open = [], close = [];
  for (const i of nextIncidents) {
    const before = prev.get(i.id);
    if (!before && i.end === null) open.push({ ...i, tier: tier.get(i.service) });
    else if (i.end !== null && i.issue && !i.issueClosed) close.push({ ...i, tier: tier.get(i.service) });   // recovered but its issue is still open (also retries earlier failures)
    else if (i.end === null && !i.issue && before) open.push({ ...i, tier: tier.get(i.service) });   // open incident that never got an issue (earlier failure): retry
  }
  return { open, close };
}

export const issueBody = (i) => `<!-- incident:${i.id} -->
**Service:** ${i.name}${i.tier ? ` (Tier ${i.tier})` : ''}
**Detected:** ${new Date(i.start).toISOString()}

This issue is the incident record. Comment \`/ack\` to acknowledge it (people with write or triage access only). Add notes as comments; it closes by itself when the service recovers.`;

export const issueTitle = (i) => `Incident: ${i.name}`;

/** Create/close issues. Returns { opened: {incidentId: {number, url}}, closed, failed }. Never throws. */
export async function syncIssues(plan, { repo, token, fetch: doFetch = fetch, log = console.warn }) {
  const out = { opened: {}, closed: 0, closedIds: [], failed: 0 };
  if (!plan.open.length && !plan.close.length) return out;
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo)) || !token) { log('incident issues: GITHUB_REPOSITORY / GITHUB_TOKEN not available, skipping'); out.failed = plan.open.length + plan.close.length; return out; }
  const api = (path, opts = {}) => doFetch(`https://api.github.com/repos/${repo}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ai-ops-floor', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
  const fail = (what, res) => { out.failed++; log(`incident issues: ${what} failed (${res ? `HTTP ${res.status}` : 'connection error'})`); };
  for (const i of plan.open) {
    try {
      const res = await api('/issues', { method: 'POST', body: JSON.stringify({ title: issueTitle(i), body: issueBody(i), labels: ['incident'] }) });
      if (!res.ok) { fail('open', res); continue; }
      const j = await res.json();
      out.opened[i.id] = { number: j.number, url: j.html_url };
    } catch { fail('open'); }
  }
  for (const i of plan.close) {                                          // look each issue up by number: no paging, no guessing
    try {
      const got = await api(`/issues/${i.issue}`);
      if (got.status === 404 || got.status === 410) { out.closedIds.push(i.id); continue; }   // deleted: nothing left to do
      if (!got.ok) { fail('read', got); continue; }
      const issue = await got.json();
      if (issue.state === 'closed') { out.closedIds.push(i.id); continue; }                    // already closed (maybe by a person)
      await api(`/issues/${i.issue}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ Recovered after ${fmtMs(i.durationMs ?? i.end - i.start)}.` }) });
      const res = await api(`/issues/${i.issue}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      if (res.ok) { out.closed++; out.closedIds.push(i.id); } else fail('close', res);
    } catch { fail('close'); }
  }
  return out;
}
