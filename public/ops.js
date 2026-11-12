// Ops wording for the floor: how health shows up in the legend, feed, inbox and the service card.
// (Pure presentation. The rules that decide health live in shared/ops.js.)
import { STATUS_ICON } from './render.js';
import { fmtMs } from './shared/ops.js';

export const STATUS_LABEL = { working: 'HEALTHY', thinking: 'DEGRADED', blocked: 'FAILING', dark: 'DOWN', bench: 'MAINTENANCE', idle: 'UNKNOWN', asking: 'NEEDS DECISION', ready: 'READY', done: 'DONE' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(x >= 0.9995 || x < 0.9 ? 1 : 2)}%`);
export const ago = (t, now = Date.now()) => { if (!t) return '—'; const s = Math.max(1, Math.round((now - t) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
export const dur = (ms) => { if (ms === null || ms === undefined) return '—'; const m = Math.round(ms / 60000); return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`; };

export const legendHtml = () => [['💻', 'healthy'], ['💭', 'degraded: slow'], ['🚧', 'failing: check failed, or waiting on a dependency'], ['🥀', 'down: failed several checks in a row'], ['💤', 'planned maintenance'], ['❔', 'unknown: no data, or data is stale']]
  .map(([i, t]) => `<li><b>${i}</b>${t}</li>`).join('') + '<li><b>📋</b>Board view: every service, with history</li><li><b>🙋</b>needs me: down or failing services you haven’t acknowledged</li>';

/** Feed lines for health changes. `cat` drives the feed tabs (down / failing / recovered). */
export function noteTransition(prev, a, push, nm) {
  if (!prev || prev === a.status) return;
  const add = (cat, icon, text, attn = false) => push({ cat, icon, id: a.id, text, attn });
  const why = a.note || a.blocker || a.task || '';
  switch (a.status) {
    case 'dark': add('dark', '🥀', `${nm(a)} is DOWN: ${why}`, true); break;
    case 'blocked': add('failing', '🚧', `${nm(a)} is failing: ${why}`, true); break;
    case 'thinking': add('failing', '💭', `${nm(a)} is degraded: ${why}`); break;
    case 'working': if (['dark', 'blocked', 'thinking'].includes(prev)) add('recovered', '✅', `${nm(a)} recovered (${why})`); else add('all', '💻', `${nm(a)} is healthy`); break;
    case 'bench': add('all', '💤', `${nm(a)} entered maintenance: ${why}`); break;
    case 'idle': add('all', '❔', `${nm(a)} has no current data`); break;
    default:
  }
}

export const actionButtons = (a, b) => (['dark', 'blocked'].includes(a.status) ? b('Acknowledge ✓', 'ack', '', 'mint') : '');
export const inboxText = (a, nm) => (a.status === 'dark' ? `${nm(a)} is DOWN: ${a.note || a.task || ''}` : `${nm(a)} is failing: ${a.blocker || a.task || ''}`);

/** The service card shown when you tap a character. */
export function inspectHtml(a, { nm, roomLabel, feed, buttons }) {
  const m = a.meta || {}, name = esc(nm(a));
  const rows = [
    ['status', `${STATUS_ICON[a.status] || ''} ${STATUS_LABEL[a.status] || a.status}`], ['detail', esc(m.health === 'healthy' ? `${fmtMs(m.latencyMs ?? 0)}` : a.task || a.note || '')],
    ['uptime 24h', pct(m.uptime24h)], ['uptime 7d', pct(m.uptime7d)], ['in this state', ago(a.since).replace(' ago', '')],
    ['last check', ago(m.lastCheck)], ['owner', esc(m.owner || '—')], ['tier', m.tier ? `Tier ${m.tier}` : '—'],
  ];
  if (m.rootCause) rows.splice(2, 0, ['root cause', esc(m.rootCause)]);
  return `<div class="shead"><div><h3>${name}</h3><div class="role">${esc(m.category || a.role)} · ${esc(roomLabel)}</div></div><button class="icon sm" data-close-inspect>✕</button></div>
    <dl>${rows.filter(([, v]) => v !== '').map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="row">${buttons}<button data-look="${a.id}" class="abtn alt">✨ Customize</button></div>
    <ol class="alog">${feed.filter((f) => f.id === a.id).slice(0, 4).map((f) => `<li>${f.icon} ${esc(f.text)}</li>`).join('')}</ol>`;
}

/** Header chip, stale banner and data-age badge. */
export function onMeta(m, $, now = Date.now()) {
  const d = m.data, banner = $('staleBanner');
  if (!d) { $('mode').textContent = 'no data'; $('mode').className = 'badge'; banner.hidden = false; banner.textContent = m.error ? `Can’t load status data (${m.error}). Showing what we last had.` : 'No status data yet.'; return; }
  const s = d.summary || {}, bad = (s.failing || 0) + (s.down || 0);
  $('opsSummary').innerHTML = `<span class="dotg"></span>${s.healthy || 0}<span class="dota"></span>${s.degraded || 0}<span class="dotr"></span>${bad}`;
  $('opsSummary').title = `${s.healthy || 0} healthy · ${s.degraded || 0} degraded · ${s.failing || 0} failing · ${s.down || 0} down · ${s.maintenance || 0} maintenance`;
  $('mode').textContent = d.demo ? 'DEMO DATA · not real' : m.stale ? `STALE · updated ${ago(d.generatedAt, now)}` : `live · updated ${ago(d.generatedAt, now)}`;
  $('mode').className = 'badge ' + (d.demo ? 'demo' : m.stale ? 'stale' : 'live');
  document.title = (bad ? `(${bad}) ` : '') + (d.site?.title || 'AI Ops Floor');
  banner.hidden = !m.stale && !m.error;
  if (!banner.hidden) banner.textContent = m.error ? `Can’t refresh status data (${m.error}). Showing the last data we have.` : `Status data is stale (updated ${ago(d.generatedAt, now)}). The probe job may have stopped — treat everything as unknown.`;
}

/** Floor tabs (only when there is more than one floor). Each tab shows how many services are failing/down on it. */
export function renderFloors(m, $, current) {
  const d = m?.data, n = d?.site?.floors || 1, el = $('floors');
  el.hidden = n < 2;
  if (n < 2) { el.innerHTML = ''; return; }
  const bad = (f) => d.services.filter((s) => (s.floor ?? 1) === f && (s.health === 'down' || s.health === 'failing')).length;
  el.innerHTML = Array.from({ length: n }, (_, i) => i + 1).map((f) => `<button class="chip fl${f === current ? ' on' : ''}" data-floor="${f}" aria-pressed="${f === current}" aria-label="Floor ${f}${bad(f) ? `, ${bad(f)} failing or down` : ''}">Floor ${f}${bad(f) ? `<b class="flbad">${bad(f)}</b>` : ''}</button>`).join('');
}
