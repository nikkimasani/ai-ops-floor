// "Assigned to me" sources for the local My Queue view. These run ON YOUR MACHINE with YOUR credentials
// (env vars); ticket text is kept in memory only and is never written to public/data or published.
//
// Every source returns normalised items:
//   { id: "sn:INC0012345" | "ado:1042", source: "servicenow" | "ado" | "fixture", ref, title, kind, priority 1..4 (1 = most urgent),
//     state, openedAt, updatedAt, url }
// Errors are generic ("HTTP 401", "connection failed"): never the URL, host, user or token.
import { resolveEnv } from '../adapters/http.js';

const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);
const SN_TIME = (s) => { const t = Date.parse(`${String(s || '').replace(' ', 'T')}Z`); return Number.isFinite(t) ? t : null; };   // ServiceNow stores UTC "YYYY-MM-DD HH:mm:ss"
const SN_STATE = { 1: 'New', 2: 'In progress', 3: 'On hold', 4: 'On hold', 5: 'On hold' };
const SAFE_USER = /^[\w.@-]+$/;                                         // goes into an encoded query: no ^ or other query operators
const SAFE_NAME = /^[\w.-]+$/;

const generic = (err, timeoutMs) => {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `timeout after ${Math.round(timeoutMs / 1000)}s`;
  return 'connection failed';
};

// ---------- ServiceNow ----------
/** cfg: { type:"servicenow", instance:"env:SN_INSTANCE", user:"env:SN_USER", password:"env:SN_PASSWORD", assignedTo?: username, tables?: ["incident","sc_task"] } */
export async function servicenowAssigned(cfg, ctx = {}) {
  const doFetch = ctx.fetch || fetch, timeoutMs = cfg.timeoutMs ?? 10000;
  let base, user, auth, who;
  try {
    base = String(resolveEnv(cfg.instance, ctx.env)).replace(/\/+$/, '');
    user = String(resolveEnv(cfg.user, ctx.env));
    who = String(cfg.assignedTo ? resolveEnv(cfg.assignedTo, ctx.env) : user);
    if (!/^https:\/\//.test(base) || !SAFE_USER.test(who)) throw new Error('bad');
    auth = Buffer.from(`${user}:${resolveEnv(cfg.password, ctx.env)}`).toString('base64');
  } catch { return { ok: false, error: 'configuration error: missing or invalid setting', items: [] }; }
  const tables = (cfg.tables?.length ? cfg.tables : ['incident']).filter((t) => SAFE_NAME.test(t));
  const items = [];
  for (const table of tables) {
    const params = new URLSearchParams({
      sysparm_query: `assigned_to.user_name=${who}^active=true^ORDERBYpriority`,
      sysparm_fields: 'number,short_description,priority,state,opened_at,sys_updated_on,sys_id',
      sysparm_limit: '50',
    });
    try {
      const res = await doFetch(`${base}/api/now/table/${table}?${params}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, items: [] };
      const body = await res.json();
      if (!Array.isArray(body?.result)) return { ok: false, error: 'unexpected response body', items: [] };
      for (const r of body.result) {
        if (!r.number) continue;
        items.push({
          id: `sn:${clip(r.number, 40)}`, source: 'servicenow', ref: clip(r.number, 40), title: clip(r.short_description, 200) || '(no title)',
          kind: table === 'incident' ? 'Incident' : table === 'sc_task' ? 'Task' : table, priority: Math.min(4, Math.max(1, num(r.priority, 3))),
          state: SN_STATE[num(r.state, 0)] || 'Open', openedAt: SN_TIME(r.opened_at), updatedAt: SN_TIME(r.sys_updated_on),
          url: r.sys_id && /^[0-9a-f]{32}$/i.test(r.sys_id) ? `${base}/nav_to.do?uri=${encodeURIComponent(`${table}.do?sys_id=${r.sys_id}`)}` : null,
        });
      }
    } catch (err) { return { ok: false, error: generic(err, timeoutMs), items: [] }; }
  }
  return { ok: true, items };
}

// ---------- Azure DevOps ----------
/** cfg: { type:"ado", org:"env:ADO_ORG", project?:"env:ADO_PROJECT", pat:"env:ADO_PAT" }   (PAT needs: Work Items (Read)) */
export async function adoAssigned(cfg, ctx = {}) {
  const doFetch = ctx.fetch || fetch, timeoutMs = cfg.timeoutMs ?? 10000;
  let org, project, auth;
  try {
    org = String(resolveEnv(cfg.org, ctx.env));
    project = cfg.project ? String(resolveEnv(cfg.project, ctx.env)) : '';
    if (!SAFE_NAME.test(org)) throw new Error('bad');
    auth = Buffer.from(`:${resolveEnv(cfg.pat, ctx.env)}`).toString('base64');
  } catch { return { ok: false, error: 'configuration error: missing or invalid setting', items: [] }; }
  const root = `https://dev.azure.com/${org}`;
  const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
  const signal = () => AbortSignal.timeout(timeoutMs);
  try {
    const query = "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Done','Removed','Resolved') ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC";
    const wiql = await doFetch(`${root}/${project ? `${encodeURIComponent(project)}/` : ''}_apis/wit/wiql?api-version=7.1`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: signal() });
    if (!wiql.ok || wiql.status === 203) return { ok: false, error: `HTTP ${wiql.status === 203 ? 401 : wiql.status}`, items: [] };   // Azure DevOps answers a bad token with 203 + a sign-in page
    const ids = ((await wiql.json())?.workItems || []).map((w) => Number(w.id)).filter(Number.isInteger).slice(0, 50);
    if (!ids.length) return { ok: true, items: [] };
    const fields = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'Microsoft.VSTS.Common.Priority', 'System.ChangedDate', 'System.CreatedDate', 'System.TeamProject'].join(',');
    const res = await doFetch(`${root}/_apis/wit/workitems?ids=${ids.join(',')}&fields=${fields}&api-version=7.1`, { headers, signal: signal() });
    if (!res.ok || res.status === 203) return { ok: false, error: `HTTP ${res.status === 203 ? 401 : res.status}`, items: [] };
    const value = (await res.json())?.value;
    if (!Array.isArray(value)) return { ok: false, error: 'unexpected response body', items: [] };
    const items = value.map((w) => {
      const f = w.fields || {};
      return {
        id: `ado:${w.id}`, source: 'ado', ref: `#${w.id}`, title: clip(f['System.Title'], 200) || '(no title)', kind: clip(f['System.WorkItemType'], 30) || 'Work item',
        priority: Math.min(4, Math.max(1, num(f['Microsoft.VSTS.Common.Priority'], 3))), state: clip(f['System.State'], 30) || 'Open',
        openedAt: Date.parse(f['System.CreatedDate']) || null, updatedAt: Date.parse(f['System.ChangedDate']) || null,
        url: f['System.TeamProject'] ? `${root}/${encodeURIComponent(f['System.TeamProject'])}/_workitems/edit/${w.id}` : null,
      };
    });
    return { ok: true, items };
  } catch (err) { return { ok: false, error: generic(err, timeoutMs), items: [] }; }
}

// ---------- fictional demo items (for `npm run queue:demo`) ----------
/** cfg: { type:"fixture", lateArrivalSec?: 20 }: the last item "gets assigned" that many seconds after start, to show the agent walking in. */
export async function fixtureAssigned(cfg, ctx = {}) {
  const now = ctx.now ?? Date.now(), started = ctx.startedAt ?? now, h = 3600000;
  const items = [
    { id: 'sn:INC0010001', source: 'servicenow', ref: 'INC0010001', title: 'Copilot licence not assigned after onboarding (new hire, Legal Ops)', kind: 'Incident', priority: 2, state: 'New', openedAt: now - 5 * h, updatedAt: now - 5 * h, url: null },
    { id: 'ado:1042', source: 'ado', ref: '#1042', title: 'Add /api/health endpoint to func-intake', kind: 'Task', priority: 2, state: 'Active', openedAt: now - 30 * h, updatedAt: now - 3 * h, url: null },
    { id: 'sn:SCTASK0020007', source: 'servicenow', ref: 'SCTASK0020007', title: 'Request: access to the AI Hub sandbox for the Localization team', kind: 'Task', priority: 3, state: 'In progress', openedAt: now - 52 * h, updatedAt: now - 20 * h, url: null },
  ];
  if (now - started >= (cfg.lateArrivalSec ?? 20) * 1000) {
    items.push({ id: 'sn:INC0010002', source: 'servicenow', ref: 'INC0010002', title: 'Resume summarizer returns 502 for some users (urgent)', kind: 'Incident', priority: 1, state: 'New', openedAt: now - 60000, updatedAt: now - 60000, url: null });
  }
  return { ok: true, items };
}

export const SOURCES = { servicenow: servicenowAssigned, ado: adoAssigned, fixture: fixtureAssigned };

/** Run every configured source in parallel. One failing source never hides the others. */
export async function fetchQueue(sourceConfigs, ctx = {}) {
  const perType = {};
  for (const c of sourceConfigs || []) perType[c.type] = (perType[c.type] || 0) + 1;
  // Two sources of the same kind (say two Azure DevOps organisations) can both have "item 1". When the CONFIG has more than one of a
  // kind, every ticket id from that kind is prefixed with its source's position: stable (it depends on the config, not on the data) and
  // unique across sources. With one source per kind the ids stay readable ("sn:INC0012345").
  const scope = (cfg, idx, r) => (perType[cfg.type] > 1 ? { ...r, items: r.items.map((i) => ({ ...i, id: `${idx}:${i.id}` })) } : r);
  const results = await Promise.all((sourceConfigs || []).map(async (cfg, idx) => {
    const name = cfg.name || cfg.type, key = `${idx}:${cfg.type}`;     // key = which configured source this is (two sources may share a name)
    const fn = SOURCES[cfg.type];
    if (!fn) return { key, name, ok: false, error: 'unknown source type', items: [] };
    try { const r = scope(cfg, idx, await fn(cfg, ctx)); return { key, name, ...r }; }
    catch { return { key, name, ok: false, error: 'source could not run', items: [] }; }
  }));
  return { items: results.flatMap((r) => r.items), sources: results.map((r) => ({ name: r.name, ok: r.ok, error: r.error, count: r.items.length })), results };
}
