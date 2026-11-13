// My Queue (LOCAL mode only). Present only when this page is served by `npm run queue`, which exposes /api/queue.
// On the public/static site that endpoint doesn't exist, so this module does nothing and the button stays hidden.
//
// It does two things:
//  1. a calm panel: ONE "do this next" card, a short list after it, and a "show all" toggle
//  2. an AGENT per assigned item: when a ticket is assigned to you, a triage agent walks in and takes a desk;
//     it waits (thinking) until triage is started, works while your triage command runs, and goes on a break when done.
import { ago } from './ops.js';
import { nextHidden, triageRecords } from './shared/queue-view.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOURCE = { servicenow: 'ServiceNow', ado: 'Azure DevOps', fixture: 'Demo' };
const SHOW_FIRST = 3;
let S, data = null, showAll = false, openResult = null, resultText = '', toast = () => {}, notified = new Set(), timer = 0;

export async function init(state, helpers = {}) {
  S = state; toast = helpers.toast || toast;
  if (!(await refresh())) return false;                                // not served by the local server: feature stays off
  $('queueBtn').hidden = false;
  $('queueBtn').onclick = () => toggle();
  $('queuePanel').addEventListener('click', onClick);
  timer = setInterval(refresh, 15000);
  return true;
}

export async function refresh() {
  try {
    const res = await fetch('/api/queue', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return false;
    data = await res.json();
  } catch { return false; }
  for (const i of data.items) if (i.arrivedAt && !notified.has(i.id)) { notified.add(i.id); toast(`📥 New for you: ${i.ref}: ${i.title}`.slice(0, 120)); }
  $('queueCount').textContent = data.items.length;
  S.source?.reapply?.();                                               // let characters walk in / change state
  if (!$('queuePanel').hidden) render();
  return true;
}

export const extraRecords = (now = Date.now()) => (data ? triageRecords(data.items, now) : []);

function toggle(open) { const p = $('queuePanel'); p.hidden = nextHidden(p.hidden, open); if (!p.hidden) render(); }   // open: true = show, false = hide, undefined = flip

const TRI_LABEL = { none: '', queued: '⏳ waiting for a slot', running: '🤖 triaging…', done: '✅ triage ready', failed: '⚠️ triage failed' };

function actions(i, big) {
  const t = i.triage?.state || 'none', canTriage = data.triage.enabled;
  const btns = [];
  if (i.url) btns.push(`<a class="abtn alt sm" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>`);
  if (t === 'done') btns.push(`<button class="abtn mint sm" data-qview="${esc(i.id)}">View triage</button>`);
  else if (t === 'queued' || t === 'running') btns.push(`<button class="abtn sm" disabled>${TRI_LABEL[t]}</button>`);
  else if (canTriage) btns.push(`<button class="abtn ${big ? 'mint' : 'alt'} sm" data-qtri="${esc(i.id)}">${t === 'failed' ? 'Retry triage' : 'Triage with Copilot'}</button>`);
  return btns.join(' ');
}

function card(i, big) {
  const t = i.triage || { state: 'none' };
  return `<article class="qitem ${big ? 'next' : ''}">
    <div class="qtop"><span class="qsrc ${esc(i.source)}">${esc(SOURCE[i.source] || i.source)}</span><b>${esc(i.ref)}</b><span class="qpri p${Number(i.priority) || 3}">P${Number(i.priority) || 3}</span><span class="qstate">${esc(i.state)}</span></div>
    <div class="qtitle">${esc(i.title)}</div>
    <div class="qmeta">${esc(i.why)}${i.updatedAt ? ` · updated ${ago(i.updatedAt)}` : ''}${t.state !== 'none' ? ` · ${TRI_LABEL[t.state]}${t.state === 'failed' && t.error ? `: ${esc(t.error)}` : ''}` : ''}</div>
    <div class="qact">${actions(i, big)}</div>
  </article>`;
}

function render() {
  const p = $('queuePanel');
  if (!data) { p.innerHTML = ''; return; }
  const items = data.items, next = items.find((i) => i.id === data.next), rest = items.filter((i) => i.id !== data.next);
  const shown = showAll ? rest : rest.slice(0, SHOW_FIRST);
  const srcLine = data.sources.map((s) => `${esc(SOURCE[s.name] || s.name)} ${s.ok ? '✓' : `✗ ${esc(s.error || 'unavailable')}`}`).join(' · ');
  p.innerHTML = `
    <div class="qhead"><b>📥 My Queue</b><button class="icon sm" data-qclose aria-label="Close My Queue">✕</button></div>
    <p class="fine">Only on this computer. Ticket text is never published or stored in the repo. ${srcLine} · updated ${ago(data.generatedAt)}</p>
    ${items.length ? '' : '<p class="qempty">Nothing assigned to you. 🌸</p>'}
    ${next ? `<h5>Do this next</h5>${card(next, true)}` : ''}
    ${rest.length ? `<h5>Then</h5>${shown.map((i) => card(i, false)).join('')}${rest.length > SHOW_FIRST ? `<button class="abtn ghost sm" data-qall>${showAll ? 'Show fewer' : `Show all (${rest.length})`}</button>` : ''}` : ''}
    ${openResult ? `<h5>Triage result</h5><pre class="qresult">${esc(resultText)}</pre><p class="fine">AI-generated: check it before acting on it. It was saved on this computer only.</p>` : ''}
    ${data.triage.enabled ? '' : '<p class="fine">Triage is not set up. See docs/MY-QUEUE.md to connect your Copilot triage skill.</p>'}`;
}

async function onClick(e) {
  const b = e.target.closest('[data-qclose],[data-qall],[data-qtri],[data-qview]');
  if (!b) return;
  if ('qclose' in b.dataset) return toggle(false);       // close
  if ('qall' in b.dataset) { showAll = !showAll; return render(); }
  if (b.dataset.qtri) {
    const id = b.dataset.qtri;
    const r = await fetch(`/api/triage/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'X-Ops-Local': '1' } }).catch(() => null);
    if (!r || !r.ok) toast(r ? ((await r.json().catch(() => ({}))).error || 'Could not start triage') : 'Could not reach the local server');
    return refresh();
  }
  if (b.dataset.qview) {
    openResult = b.dataset.qview;
    const r = await fetch(`/api/triage/${encodeURIComponent(openResult)}`).then((x) => x.json()).catch(() => null);
    resultText = r?.result || 'No result found.';
    return render();
  }
}
