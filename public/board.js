// The Board: every service at a glance, with filters, uptime, a latency sparkline and recent incidents.
import { STATUS_LABEL, pct, ago, dur } from './ops.js';
import { fmtMs, DAY } from './shared/ops.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const METRIC_LABELS = { open: 'Open', oldestHours: 'Oldest', breaching: 'Past SLA', seats: 'Seats', inactiveSeats: 'Inactive', pendingCancellation: 'Cancelling' };
const fmtMetric = (k, v) => (k === 'oldestHours' ? (v >= 48 ? `${Math.round(v / 24)}d` : `${v}h`) : v);
const HEALTH_CLASS = { healthy: 'ok', degraded: 'warn', failing: 'bad', down: 'down', maintenance: 'maint', unknown: 'unk' };
let S, history = {}, incidents = [], filter = { q: '', cat: 'all', health: 'all' }, timer = 0;

export function init(state) {
  S = state;
  $('boardBtn').onclick = open;
  $('boardClose').onclick = close;
  $('board').addEventListener('input', (e) => { if (e.target.id === 'boardSearch') { filter.q = e.target.value.toLowerCase(); render(); } });
  $('board').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bcat],[data-bhealth],[data-bshow]'); if (!b) return;
    if (b.dataset.bcat) filter.cat = b.dataset.bcat; if (b.dataset.bhealth) filter.health = b.dataset.bhealth;
    if (b.dataset.bshow) { close(); state.showOnFloor?.(b.dataset.bshow); return; }
    render();
  });
}

async function fetchExtras() {
  const base = new URLSearchParams(location.search).get('data') || 'data';
  const shift = S.opsData?.data?.demoShiftMs || 0;                          // demo data only; 0 for real data
  try { const h = await (await fetch(`${base}/history.json?ts=${Date.now()}`, { cache: 'no-store' })).json(); history = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.map((x) => [x[0] + shift, x[1], x[2]])])); } catch { /* keep last */ }
  try { incidents = (await (await fetch(`${base}/incidents.json?ts=${Date.now()}`, { cache: 'no-store' })).json()).map((i) => ({ ...i, start: i.start + shift, end: i.end === null ? null : i.end + shift })); } catch { /* keep last */ }
  render();
}
export function open() { $('board').hidden = false; document.body.classList.add('boardOpen'); render(); fetchExtras(); clearInterval(timer); timer = setInterval(fetchExtras, 60000); }
export function close() { $('board').hidden = true; document.body.classList.remove('boardOpen'); clearInterval(timer); }
export const update = () => { if (!$('board').hidden) render(); };

/** Latency sparkline for the last 24h, downsampled to ~48 points. Failures are red ticks on the baseline. */
export function sparkline(samples, now = Date.now(), width = 120, height = 28) {
  const recent = (samples || []).filter((s) => s[0] > now - DAY);
  if (recent.length < 2) return '';
  const step = Math.max(1, Math.floor(recent.length / 48)), pts = recent.filter((_, i) => i % step === 0);
  const maxMs = Math.max(500, ...pts.filter((p) => p[1] === 1).map((p) => p[2]));
  const x = (i) => (i / (pts.length - 1)) * (width - 2) + 1, y = (ms) => height - 3 - Math.min(1, ms / maxMs) * (height - 8);
  const line = pts.map((p, i) => (p[1] === 1 ? `${x(i).toFixed(1)},${y(p[2]).toFixed(1)}` : null)).filter(Boolean).join(' ');
  const fails = pts.map((p, i) => (p[1] === 0 ? `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${height - 2}" y2="${height - 10}" stroke="#f0647a" stroke-width="2"/>` : '')).join('');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline fill="none" stroke="#b387f5" stroke-width="1.6" stroke-linejoin="round" points="${line}"/>${fails}</svg>`;
}

function render() {
  const d = S.opsData?.data; if (!d) { $('boardBody').innerHTML = '<p class="fine">No status data yet.</p>'; return; }
  const sum = d.summary, now = Date.now(), cats = d.site?.categories || {};
  const stale = S.opsData.stale;
  const tile = (n, label, cls) => `<button class="tile ${cls} ${filter.health === label.toLowerCase() ? 'on' : ''}" data-bhealth="${label.toLowerCase()}"><b>${n}</b><small>${label}</small></button>`;
  const rows = d.services.filter((s) => (filter.cat === 'all' || s.category === filter.cat) && (filter.health === 'all' || s.health === filter.health) && (!filter.q || `${s.name} ${s.owner} ${s.category}`.toLowerCase().includes(filter.q)));
  const order = { down: 0, failing: 1, degraded: 2, unknown: 3, maintenance: 4, healthy: 5 };
  rows.sort((a, b) => order[a.health] - order[b.health] || (a.tier || 9) - (b.tier || 9) || a.name.localeCompare(b.name));
  $('boardBody').innerHTML = `
    ${stale ? `<div class="stalebox">⚠️ Data is stale (updated ${ago(d.generatedAt)}): statuses below are the last known values and shouldn’t be trusted.</div>` : ''}
    <div class="tiles">
      ${tile(sum.healthy, 'Healthy', 'ok')}${tile(sum.degraded, 'Degraded', 'warn')}${tile(sum.failing, 'Failing', 'bad')}${tile(sum.down, 'Down', 'down')}${tile(sum.maintenance, 'Maintenance', 'maint')}
      <div class="tile plain"><b>${pct(sum.uptime24h)}</b><small>Uptime 24h</small></div><div class="tile plain"><b>${dur(d.mttrMs)}</b><small>MTTR 30d</small></div>
    </div>
    <div class="bfilters"><input id="boardSearch" type="search" placeholder="Search services, owners…" value="${esc(filter.q)}">
      <div class="chips"><button class="chip2 ${filter.cat === 'all' ? 'on' : ''}" data-bcat="all">All</button>${Object.entries(cats).map(([k, c]) => `<button class="chip2 ${filter.cat === k ? 'on' : ''}" data-bcat="${esc(k)}">${esc(c.label)}</button>`).join('')}
        ${filter.health !== 'all' ? '<button class="chip2" data-bhealth="all">✕ clear status filter</button>' : ''}</div></div>
    <div class="bgrid">${rows.map((s) => `
      <article class="bcard ${HEALTH_CLASS[s.health]}">
        <div class="btop"><b>${esc(s.name)}</b><span class="spill ${HEALTH_CLASS[s.health]}">${s.health}</span></div>
        <div class="bsub">${esc(cats[s.category]?.label || s.category)} · ${esc(s.owner || '—')}${s.tier ? ` · Tier ${s.tier}` : ''}</div>
        <div class="bdetail">${esc(s.detail || '')}</div>
        ${s.metrics ? `<div class="bmetrics">${Object.keys(METRIC_LABELS).filter((k) => s.metrics[k] != null).map((k) => `<span>${METRIC_LABELS[k]} <b>${fmtMetric(k, s.metrics[k])}</b></span>`).join('')}</div>` : ''}
        ${sparkline(history[s.id], now)}
        <div class="bstats"><span>24h <b>${pct(s.uptime24h)}</b></span><span>7d <b>${pct(s.uptime7d)}</b></span><span>${s.latencyMs != null ? `<b>${fmtMs(s.latencyMs)}</b>` : '<b>—</b>'}</span><span class="muted">${ago(s.since).replace(' ago', '')} in state</span></div>
        ${s.onFloor !== false ? `<button class="abtn ghost sm" data-bshow="${esc(s.id)}">Show on floor</button>` : ''}
      </article>`).join('') || '<p class="fine">No services match.</p>'}</div>
    <h5>Recent incidents</h5>
    <ul class="incidents">${[...incidents].reverse().slice(0, 12).map((i) => `<li class="${i.end ? '' : 'open'}"><b>${esc(i.name)}</b> <span>${i.end ? `resolved · lasted ${dur(i.durationMs)}` : 'OPEN'}</span> <small>${ago(i.start)} · ${esc(i.detail || '')}</small></li>`).join('') || '<li class="muted">No incidents recorded.</li>'}</ul>`;
}
