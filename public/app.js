// The office: owns motion (where each NPC walks), the camera, and the panels. The event source
// (source.js) owns truth about agent state; renderer (render.js) owns pixels.

import { View, drawFloor, sceneItems, drawAgent, drawBadge, drawNameTag, drawBubble, drawRoomLabels, drawCat, STATUS_ICON, FONT } from './render.js';
import { GRID, SEATS, SPOTS, CORRIDOR_Y, ENTRANCE, ROOMS } from './shared/layout.js';
import { connect } from './source.js';
import * as ops from './ops.js';
import * as board from './board.js';
import { setTheme, theme } from './theme.js';
import { store } from './store.js';
import * as edit from './edit.js';
import * as fun from './fun.js';
import * as looks from './looks.js';
import * as toolbox from './toolbox.js';
import { INTERACTIONS } from './shared/life.js';

const $ = (id) => document.getElementById(id);
const canvas = $('floor'), ctx = canvas.getContext('2d');
const view = new View();
const S = { agents: {}, order: [], walkins: [], feed: [], filter: 'all', selected: null, source: null, time: 'day', mode: 'demo' };
const npcs = {};
S.acks = store.get('acks', {}); S.opsData = null;   // acknowledged problems (this browser only) and the latest snapshot
const cat = { x: 26, y: 16, tx: 26, ty: 16, dir: 1, moving: false, wait: 2, say: null, sayUntil: 0 };
const { lookOf, nm } = looks;
const SPEED = 2.3;           // tiles per second
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mobile = () => innerWidth <= 760;

// ---------- walking ----------
const near = (a, b) => Math.abs(a - b) < 0.6;
const leavePath = (pl) => pl.aisle !== undefined ? [{ x: pl.aisle, y: pl.y }, { x: pl.aisle, y: CORRIDOR_Y }]
  : near(pl.y, CORRIDOR_Y) ? [{ x: pl.x, y: CORRIDOR_Y }]
  : [{ x: pl.x, y: pl.y > CORRIDOR_Y ? 12.6 : 9.4 }, { x: pl.x, y: CORRIDOR_Y }];
const dedupe = (pts) => pts.filter((p, i) => !i || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.01);
const route = (a, b) => dedupe([...leavePath(a), ...leavePath(b).reverse(), { x: b.x, y: b.y }]);
const routeFromHere = (n, b) => dedupe([{ x: n.x, y: CORRIDOR_Y }, ...leavePath(b).reverse(), { x: b.x, y: b.y }]);
const tag = (pts, place) => { if (pts.length) pts[pts.length - 1] = { ...pts[pts.length - 1], place }; return pts; };

function homeOf(a) {
  if (a.seat >= 0 && SEATS[a.seat]) return { ...SEATS[a.seat], seat: true };
  const sp = SPOTS.lounge[hash(a.id) % SPOTS.lounge.length];   // no desk free: waits off duty
  return { ...sp, room: 'lounge' };
}

function ensureNpc(a, spawn) {
  if (npcs[a.id]) return npcs[a.id];
  const h = homeOf(a), at = spawn || h;
  return (npcs[a.id] = { x: at.x, y: at.y, place: spawn ? { ...ENTRANCE, room: 'corridor' } : h, q: [], trip: null, phase: 0, seed: rand(0, 10), walking: false, seated: false, nextIdle: performance.now() / 1000 + rand(5, 14), say: null, sayUntil: 0, carry: false });
}

function startTrip(id, kind, to, dwell, onArrive, carry = false) {
  const n = npcs[id], a = S.agents[id]; if (!n || !a) return;
  const home = homeOf(a);
  const out = tag(n.trip ? routeFromHere(n, to) : route(n.place, to), to);
  const back = tag(route(to, home), home);
  n.q = [...out, { wait: dwell, fn: () => { n.carry = false; onArrive?.(); } }, ...back];
  n.trip = { kind }; n.carry = carry;
}
function goHome(id) {
  const n = npcs[id], a = S.agents[id]; if (!n || !a) return;
  const home = homeOf(a);
  n.q = tag(routeFromHere(n, home), home); n.trip = { kind: 'return' }; n.carry = false;
}

function advance(n, dt) {
  n.walking = false;
  if (n.trip?.kind === 'ufo') return;
  let budget = SPEED * dt;
  while (n.q.length && budget > 0) {
    const t = n.q[0];
    if (t.wait !== undefined) { if (!t.started) { t.started = true; t.fn?.(); } t.wait -= dt; if (t.wait <= 0) n.q.shift(); return; }
    if (t.x === undefined) { t.fn?.(); n.q.shift(); continue; }
    const dx = t.x - n.x, dy = t.y - n.y, d = Math.hypot(dx, dy);
    if (d <= budget) { n.x = t.x; n.y = t.y; budget -= d; if (t.place) n.place = t.place; n.q.shift(); }
    else { n.x += dx / d * budget; n.y += dy / d * budget; budget = 0; n.walking = true; }
  }
  if (!n.q.length) n.trip = null;
}

const ACTIVITIES = ['kitchen', 'rec', 'lounge', 'garden'];
function activity(id, long) {
  const choice = long ? null : fun.chooseSpot(id);
  if (choice) { startTrip(id, 'activity', choice.place, choice.dwell, () => fun.arrive(id, choice)); return; }
  const a = S.agents[id], room = pick(ACTIVITIES), sp = pick(SPOTS[room]);
  startTrip(id, long ? 'bench' : 'activity', { ...sp, room }, long ? 1e9 : rand(6, 10), () => pushFeed({ cat: 'funny', icon: '🌷', id, text: `${nm(a)} ${sp.say}` }));
}

function update(dt, nowS) {
  for (const id of S.order) {
    const a = S.agents[id], n = npcs[id]; if (!n) continue;
    n.phase += dt;
    const home = homeOf(a);
    advance(n, dt);
    n.seated = Boolean(home.seat) && !n.trip && Math.hypot(n.x - home.x, n.y - home.y) < 0.05;
    const kind = n.trip?.kind;
    if ((kind === 'activity' && !['idle', 'bench'].includes(a.status)) || (kind === 'bench' && a.status !== 'bench')) { goHome(id); continue; }
    if (n.trip) continue;
    if (Math.hypot(n.x - home.x, n.y - home.y) > 0.1) { goHome(id); continue; }
    if (a.status === 'bench') { activity(id, true); continue; }
    if (a.status === 'idle' && home.seat && nowS > n.nextIdle) { activity(id, false); n.nextIdle = nowS + rand(14, 28); }
  }
  fun.update(dt, nowS);
  // the garden cat wanders
  if (cat.wait > 0) { cat.wait -= dt; cat.moving = false; }
  else {
    const dx = cat.tx - cat.x, dy = cat.ty - cat.y, d = Math.hypot(dx, dy);
    if (d < 0.1) { cat.wait = rand(2, 6); cat.tx = rand(23.8, 29.2); cat.ty = rand(12.8, 19.2); }
    else { cat.x += dx / d * 0.9 * dt; cat.y += dy / d * 0.9 * dt; cat.dir = dx - dy >= 0 ? 1 : -1; cat.moving = true; }
  }
}

// ---------- events -> state, feed ----------
const STATUS_LABEL = { idle: 'IDLE', thinking: 'THINKING', working: 'WORKING', blocked: 'BLOCKED', asking: 'ASKING', ready: 'READY', dark: 'DARK', bench: 'ON BREAK', done: 'DONE' };

function pushFeed(e) {
  S.feed.unshift({ ts: new Date(), ...e });
  if (S.feed.length > 120) S.feed.length = 120;
  renderFeed();
}

function noteTransition(prev, a) {
  if (!prev || prev === a.status) return;
  if (a.meta?.ops) return ops.noteTransition(prev, a, pushFeed, nm);
  const add = (c, icon, text) => pushFeed({ cat: c, icon, id: a.id, text, attn: c !== 'all' });
  switch (a.status) {
    case 'ready': add('ready', '📦', `${nm(a)} has a branch ready${a.branch ? ' — ' + a.branch : ''}`); break;
    case 'asking': add('decision', '❓', `${nm(a)} needs a call: ${a.decision?.id && a.decision.id !== 'ASK' ? a.decision.id + ' ' : ''}${a.decision?.q || ''}`); break;
    case 'dark': add('dark', '🥀', `${nm(a)} went dark${a.note ? ' — ' + a.note : ''}`); break;
    case 'blocked': add('all', '🚧', `${nm(a)} is blocked: ${a.blocker}`); break;
    case 'working':
      if (prev === 'blocked') add('all', '🟢', `${nm(a)} is unblocked`);
      else if (prev === 'dark') add('all', '✅', `${nm(a)} is back at the desk`);
      else if (prev === 'asking') add('all', '💬', `${nm(a)} got an answer and is back to work`);
      else if (['idle', 'bench'].includes(prev)) add('all', '⌨️', `${nm(a)} started ${a.task || 'working'}`);
      break;
    case 'done': add('all', '🎉', `${nm(a)} finished ${a.task || 'a task'}`); break;
    default:
  }
}

function applyEvent(ev) {
  switch (ev.type) {
    case 'agent_join': join(ev.info); return;
    case 'agent_leave': leave(ev.id); return;
    case 'walkin': S.walkins.push(ev); pushFeed({ cat: 'funny', icon: '🚪', text: `${ev.name} just arrived at the office` }); renderWalkin(); renderNeeds(); return;
    case 'walkin_resolved': S.walkins = S.walkins.filter((w) => w.id !== ev.id); renderWalkin(); renderNeeds(); return;
    case 'handoff': {
      const from = S.agents[ev.from], to = S.agents[ev.to];
      if (from && to && to.seat >= 0) {
        const rs = SEATS[to.seat];
        startTrip(from.id, 'handoff', { x: rs.x - 1.15, y: rs.y, room: rs.room, aisle: rs.aisle }, 1.1, null, true);
        pushFeed({ cat: 'all', icon: '💌', id: from.id, text: `${nm(from)} passed work to ${nm(to)}` });
      }
      return;
    }
    case 'say': { const n = npcs[ev.agent]; if (n) { n.say = ev.text; n.sayUntil = performance.now() + 5000; } return; }
    default:
  }
  const a = S.agents[ev.agent]; if (!a || !ev.state) return;
  const prev = a.status, prevAhead = a.ahead;
  Object.assign(a, ev.state);
  if (ev.type === 'git' && a.ahead > prevAhead) pushFeed({ cat: 'all', icon: '⌨️', id: a.id, text: `${nm(a)} committed (${a.ahead} ahead${a.branch ? ' of ' + a.branch : ''})` });
  noteTransition(prev, a);
  refresh(a.id);
}

function join(info) {
  S.agents[info.id] = info; S.order.push(info.id);
  const n = ensureNpc(info, { x: ENTRANCE.x, y: ENTRANCE.y });
  const home = homeOf(info);
  n.q = tag(route(n.place, home), home); n.trip = { kind: 'arrive' };
  pushFeed({ cat: 'funny', icon: '🎀', id: info.id, text: `${nm(info)} joined the office as ${info.role}` });
  refresh();
}
function leave(id) {
  const n = npcs[id], a = S.agents[id]; if (!n || !a) return;
  n.q = [...routeFromHere(n, { ...ENTRANCE, room: 'corridor' }), { fn: () => drop(id) }]; n.trip = { kind: 'leave' };
  pushFeed({ cat: 'funny', icon: '👋', text: `${nm(a)} headed out` });
}
function drop(id) {
  delete npcs[id]; delete S.agents[id]; S.order = S.order.filter((x) => x !== id);
  if (S.selected === id) S.selected = null;
  refresh();
}

function applySnapshot(snap) {
  S.mode = snap.mode;
  S.agents = {};
  S.order = snap.agents.map((a) => a.id);
  for (const a of snap.agents) { S.agents[a.id] = a; ensureNpc(a); }
  for (const id of Object.keys(npcs)) if (!S.agents[id]) delete npcs[id];
  S.walkins = snap.walkins || [];
  S.ops = snap.mode === 'ops';
  $('modeNote').textContent = 'Each character is a service. Health comes from the probe job’s latest snapshot (data/status.json); the page re-reads it every 30 seconds. Acknowledging a problem only hides it from your “needs me” list in this browser. Layout, looks and acknowledgements never leave this device.';
  $('legendList').innerHTML = ops.legendHtml();
  for (const a of snap.agents) if (['dark', 'blocked'].includes(a.status)) noteTransition('idle', a);
  refresh(); renderWalkin();
}

// ---------- panels ----------
function renderFeed() {
  const rows = S.feed.filter((f) => S.filter === 'all' || f.cat === S.filter).slice(0, 60);
  $('feed').innerHTML = rows.map((f, i) =>
    `<li class="${f.attn ? 'attn' : ''}" data-i="${S.feed.indexOf(f)}"><time>${f.ts.toTimeString().slice(0, 5)}</time><span>${f.icon} ${esc(f.text)}</span></li>`).join('');
}

const needs = () => {
  const out = Object.values(S.agents).filter((a) => ['asking', 'ready', 'dark', 'blocked'].includes(a.status) && !(a.meta?.ops && S.acks[a.id] === a.since))
    .map((a) => ({ kind: a.status, a, since: a.since || 0 }));
  for (const w of S.walkins) out.push({ kind: 'walkin', w, since: w.ts || 0 });
  return out.sort((x, y) => x.since - y.since);
};

function renderNeeds() {
  const n = needs().length;
  $('needsCount').textContent = n;
  $('needsBtn').classList.toggle('zero', n === 0); $('needsBtn').classList.toggle('pulse', n > 0);
  if (!$('inboxModal').hidden) renderInbox();
}

function actionButtons(a) {
  const b = (label, act, choice, cls = '') => `<button class="abtn ${cls}" data-act="${act}" data-agent="${a.id}" data-choice="${esc(choice || '')}">${label}</button>`;
  if (a.meta?.ops) return ops.actionButtons(a, b);
  if (a.status === 'asking') return a.decision?.options?.length ? a.decision.options.map((o, i) => b(o, 'answer', o, i ? 'alt' : '')).join('') : '<small>Answer this in the agent’s own terminal.</small>';
  if (a.status === 'ready') return b('Mark collected 📦', 'collect', '', 'mint');
  if (a.status === 'dark') return b('Poke 👋', 'nudge', '', 'alt');
  if (a.status === 'blocked') return b('Offer a hand 🤝', 'unblock', '', 'alt');
  return '';
}

function renderInbox() {
  $('inboxList').innerHTML = needs().map((it) => {
    if (it.kind === 'walkin') return `<li><div class="t">🚪 <b>${esc(it.w.name)}</b> is at the door — ${esc(it.w.role)}</div><button class="abtn mint" data-walk="${it.w.id}" data-yes="1">Let them stay</button> <button class="abtn ghost" data-walk="${it.w.id}">Send away</button></li>`;
    const a = it.a, icon = STATUS_ICON[a.status];
    const text = a.meta?.ops ? ops.inboxText(a, nm) : a.status === 'asking' ? `${nm(a)} needs a call: ${a.decision?.id && a.decision.id !== 'ASK' ? a.decision.id + ' ' : ''}${a.decision?.q}`
      : a.status === 'ready' ? `${nm(a)} has a branch ready${a.branch ? ' — ' + a.branch : ''}${a.ahead ? ` (${a.ahead} ahead)` : ''}`
      : a.status === 'dark' ? `${nm(a)} went dark${a.note ? ' — ' + a.note : ''}` : `${nm(a)} is blocked: ${a.blocker}`;
    return `<li><div class="t">${icon} ${esc(text)}</div><small>waiting ${ago(a.since)}</small><div class="row">${actionButtons(a)}<button class="abtn ghost" data-show="${a.id}">Show me</button></div></li>`;
  }).join('');
}
const ago = (t) => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 90 ? `${s}s` : `${Math.round(s / 60)}m`; };

function renderInspect() {
  const a = S.agents[S.selected], el = $('inspect');
  if (!a) { el.hidden = true; return; }
  el.hidden = false;
  const room = ROOMS[a.room]?.label || a.room;
  if (a.meta?.ops) { el.innerHTML = ops.inspectHtml(a, { nm, roomLabel: room, feed: S.feed, buttons: actionButtons(a) }); return; }
  el.innerHTML = `<div class="shead"><div><h3>${esc(nm(a))}</h3><div class="role">${esc(a.role)} · ${esc(room)}</div></div><button class="icon sm" data-close-inspect>✕</button></div>
    <span class="stat">${STATUS_ICON[a.status] || '🌸'} ${STATUS_LABEL[a.status] || a.status}</span>
    <dl>${a.task ? `<dt>task</dt><dd>${esc(a.task)}</dd>` : ''}${a.tool ? `<dt>tool</dt><dd>${esc(a.tool)}</dd>` : ''}
    ${a.branch ? `<dt>branch</dt><dd>${esc(a.branch)}</dd>` : ''}${a.branch ? `<dt>ahead</dt><dd>${a.ahead || 0} commit${a.ahead === 1 ? '' : 's'}</dd><dt>uncommitted</dt><dd>${a.dirty || 0} file${a.dirty === 1 ? '' : 's'}</dd>` : ''}
    ${a.blocker ? `<dt>blocker</dt><dd>${esc(a.blocker)}</dd>` : ''}${a.decision ? `<dt>decision</dt><dd>${esc((a.decision.id !== 'ASK' ? a.decision.id + ' ' : '') + a.decision.q)}</dd>` : ''}
    ${a.note ? `<dt>note</dt><dd>${esc(a.note)}</dd>` : ''}<dt>tool calls</dt><dd>${a.toolCalls || 0}</dd><dt>finished</dt><dd>${a.tasksDone || 0}</dd></dl>
    <div class="row">${actionButtons(a)}</div>
    <div class="funrow">${INTERACTIONS.slice(0, 5).map((i) => `<button data-fun="${i.id}" data-agent="${a.id}" title="${i.label}">${i.emoji}</button>`).join('')}<button data-look="${a.id}" class="abtn alt">✨ Customize</button></div>
    <ol class="alog">${S.feed.filter((f) => f.id === a.id).slice(0, 4).map((f) => `<li>${f.icon} ${esc(f.text)}</li>`).join('')}</ol>`;
}

function refresh() { renderNeeds(); renderInspect(); renderFeed(); }

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}

async function doAct(agent, action, choice) {
  if (action === 'ack') {
    S.acks[agent] = S.agents[agent]?.since; store.set('acks', S.acks);
    toast('Acknowledged: it stays on the floor, but leaves your “needs me” list until it changes'); refresh(); return;
  }
  const r = await S.source.act(agent, action, choice);
  if (r?.error) toast(r.error.startsWith('view-only') ? 'View-only here — answer it in the agent itself 💌' : r.error);
}

// ---------- walk-in modal ----------
function renderWalkin() {
  const w = S.walkins[0];
  $('walkinModal').hidden = !w;
  if (!w) return;
  $('walkinName').textContent = w.name;
  $('walkinText').textContent = `${w.name} just arrived at your office as ${w.role}. Let them stay?`;
  const c = $('walkinFace').getContext('2d'), v = new View(); v.s = 1.9; v.ox = 75; v.oy = 130;
  c.clearRect(0, 0, 150, 150);
  drawAgent(c, v, { ...w, status: 'idle' }, { x: 0, y: 0, phase: 0, seed: 1, walking: false, seated: false }, 0, false);
}
async function answerWalkin(accepted) {
  const w = S.walkins[0]; if (!w) return;
  const r = await S.source.walkin(w.id, accepted);
  if (r?.error) toast(r.error);
}

// ---------- camera ----------
let sized = false;
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!sized) { sized = true; center(true); }
}
function center(fit) {
  const w = canvas.clientWidth, h = canvas.clientHeight, side = mobile() ? 0 : 380;
  if (fit) view.s = Math.max(0.2, Math.min((w - side) / 1700, (h - 20) / 960, 1.4), mobile() ? 0.5 : 0);
  const [tx, ty] = mobile() ? [15.5, 5.5] : [15, 10.5];
  view.ox = 0; view.oy = 0;
  const [px, py] = view.p(tx, ty);
  view.ox = (w - side) / 2 - px; view.oy = h * (mobile() ? 0.36 : 0.52) - py;
}
function zoomAt(f, sx, sy) {
  const ns = Math.max(0.2, Math.min(2.4, view.s * f)), k = ns / view.s;
  view.ox = sx - (sx - view.ox) * k; view.oy = sy - (sy - view.oy) * k; view.s = ns;
}
const pts = new Map(); let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  drag = { moved: 0, pinch: pts.size === 2 ? pinchDist() : 0 };
});
canvas.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2) {
    const d = pinchDist(), r = canvas.getBoundingClientRect(), m = pinchMid();
    if (drag.pinch) zoomAt(d / drag.pinch, m.x - r.left, m.y - r.top);
    drag.pinch = d; drag.moved = 99;
  } else { view.ox += dx; view.oy += dy; drag.moved += Math.abs(dx) + Math.abs(dy); }
});
canvas.addEventListener('pointerup', (e) => {
  pts.delete(e.pointerId);
  if (drag && pts.size === 0 && drag.moved < 6) { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (!edit.onTap(x, y) && !fun.tap(x, y)) pick2(x, y); }
  if (pts.size < 2 && drag) drag.pinch = 0;
});
canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && e.buttons === 0) { const r = canvas.getBoundingClientRect(); edit.onHover(e.clientX - r.left, e.clientY - r.top); } });
canvas.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
const pinchDist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
const pinchMid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

function pick2(sx, sy) {
  const u = Math.max(0.35, view.s) * 1.05; let best = null, bd = 30 * u;
  for (const id of S.order) {
    const n = npcs[id]; if (!n) continue;
    const [fx, fy] = view.p(n.x, n.y), d = Math.hypot(sx - fx, sy - (fy - 30 * u));
    if (d < bd) { bd = d; best = id; }
  }
  select(best === S.selected ? null : best);
}
function select(id) { S.selected = id; renderInspect(); }
function focus(id) {
  const n = npcs[id]; if (!n) return;
  const [px, py] = view.p(n.x, n.y), side = mobile() ? 0 : 380;
  view.ox += (canvas.clientWidth - side) / 2 - px; view.oy += canvas.clientHeight * 0.42 - py;
  if (view.s < 0.7) zoomAt(0.9 / view.s, (canvas.clientWidth - side) / 2, canvas.clientHeight * 0.42);
}

// ---------- time of day ----------
function timeOfDay() {
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  const auto = h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
  return { phase: S.time === 'auto' ? auto : S.time, d };
}
const TINT = { day: null, dusk: '#ffd9c2', night: '#a9a6e6' };
function renderClock() {
  const { phase, d } = timeOfDay();
  $('clock').textContent = d.toTimeString().slice(0, 5);
  $('timeIcon').textContent = { day: '☀️', dusk: '🌇', night: '🌙' }[phase];
}

// ---------- frame ----------
let last = 0;
function frame(t) {
  requestAnimationFrame(frame);
  try { render(t); } catch (err) { console.error('frame failed', err); }
}
function render(t) {
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  try { update(dt, t / 1000); } catch (err) { console.error('update failed', err); }
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  drawFloor(ctx, view);
  const heads = {};
  const items = sceneItems(view);
  for (const id of S.order) {
    const a = S.agents[id], n = npcs[id]; if (!a || !n) continue;
    items.push({ key: n.x + n.y + 0.02, draw: () => { heads[id] = drawAgent(ctx, view, lookOf(a), n, t, id === S.selected); if (n.carry) envelope(heads[id]); } });
  }
  items.push({ key: cat.x + cat.y, draw: () => drawCat(ctx, view, cat, t) });
  items.push(...edit.sceneItems(view, fun.fxFor), ...fun.sceneItems(view));
  items.sort((p, q) => p.key - q.key).forEach((i) => i.draw(ctx));
  drawRoomLabels(ctx, view);
  const tint = TINT[timeOfDay().phase];
  if (tint && !theme.t.dark) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tint; ctx.fillRect(0, 0, w, h); ctx.restore(); }
  // Bubbles: all of them when zoomed in; zoomed out only the three agents who have waited longest.
  const waiting = S.order.map((i) => S.agents[i]).filter((a) => a && ['asking', 'ready', 'dark', 'blocked'].includes(a.status)).sort((p, q) => p.since - q.since);
  const bubbled = new Set(view.s > 0.85 ? waiting.map((a) => a.id) : waiting.slice(0, 3).map((a) => a.id));
  for (const id of S.order) {      // overlays: name tags, badges, bubbles (never occluded)
    const a = S.agents[id], n = npcs[id], hd = heads[id]; if (!a || !n || !hd) continue;
    if (view.s > 0.3 || id === S.selected) drawNameTag(ctx, hd.x, hd.y + 62 * hd.u * 0.9 + 12, nm(a), lookOf(a).accent);
    const icon = STATUS_ICON[a.status];
    const attn = ['asking', 'ready', 'dark', 'blocked'].includes(a.status);
    drawBadge(ctx, hd.x, hd.y - 6 * hd.u, hd.u, icon, attn ? 'rgba(255,200,90,.45)' : null);
    const talk = n.say && performance.now() < n.sayUntil;
    const sel = id === S.selected, bx = hd.x, by = hd.y - 6 * hd.u - Math.max(8, 9.5 * hd.u) - 4;
    if (talk) drawBubble(ctx, bx, by, n.say);
    else if (sel || (attn && bubbled.has(id))) {
      if (a.status === 'asking') drawBubble(ctx, bx, by, `${a.decision?.id && a.decision.id !== 'ASK' ? a.decision.id + ' ' : ''}${a.decision?.q || 'needs a call'}`, '#fff3c4');
      else if (a.status === 'ready') drawBubble(ctx, bx, by, `Branch ready${a.branch ? ' — ' + a.branch : ''}`, '#d9f7ea');
      else if (a.status === 'blocked') drawBubble(ctx, bx, by, a.blocker || 'blocked', '#ffe0d6');
      else if (a.status === 'dark') drawBubble(ctx, bx, by, `went dark${a.note ? ' — ' + a.note : ''}`, '#ece6f5', '#6b5a78');
      else if (sel && a.tool) drawBubble(ctx, bx, by, a.tool, '#ece2ff');
    } else if (a.status === 'working' && a.tool && view.s > 0.75) drawBubble(ctx, bx, by, a.tool, '#ece2ff', '#4a2c4a', 150);
  }
  fun.overlay(ctx, view, t); edit.overlay(ctx, view, t);
}
function envelope(hd) {
  const x = hd.x + 14 * hd.u, y = hd.y + 26 * hd.u, w = 15 * hd.u;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff6fa8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(x - w / 2, y - w * 0.35, w, w * 0.7, 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - w / 2, y - w * 0.35); ctx.lineTo(x, y + w * 0.05); ctx.lineTo(x + w / 2, y - w * 0.35); ctx.stroke();
}

// ---------- wiring ----------
$('legendList').innerHTML = [['💻', 'working'], ['💭', 'thinking'], ['❓', 'asking — needs your call'], ['📦', 'branch ready for PR'], ['🚧', 'blocked'], ['🥀', 'went dark'], ['💤', 'on a break'], ['✅', 'done']]
  .map(([i, t]) => `<li><b>${i}</b>${t}</li>`).join('') + '<li><b>🌷</b>funny: off-duty fun, never real state</li><li><b>🙋</b>needs me inbox (N)</li>';
const open = (id) => { $(id).hidden = false; };
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, li'); if (!t) return;
  if (t.matches('[data-close]')) t.closest('.modal').hidden = true;
  else if (t.matches('[data-close-inspect]')) select(null);
  else if (t.dataset.fun && t.dataset.agent) fun.interact(t.dataset.agent, t.dataset.fun) && renderInspect();
  else if (t.dataset.look && !t.closest('#mgrModal')) looks.openManager(t.dataset.look);
  else if (t.dataset.act) doAct(t.dataset.agent, t.dataset.act, t.dataset.choice);
  else if (t.dataset.walk) S.source.walkin(t.dataset.walk, Boolean(t.dataset.yes)).then((r) => r?.error && toast(r.error));
  else if (t.dataset.show) { $('inboxModal').hidden = true; select(t.dataset.show); focus(t.dataset.show); }
  else if (t.dataset.i !== undefined && t.closest('#feed')) { const f = S.feed[t.dataset.i]; if (f?.id && S.agents[f.id]) { select(f.id); focus(f.id); } }
  else if (t.closest('#tabs') && t.dataset.f) { S.filter = t.dataset.f; document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b === t)); renderFeed(); }
});
$('needsBtn').onclick = () => { renderInbox(); open('inboxModal'); };
$('legendPill').onclick = () => open('legendModal');
$('menuBtn').onclick = () => toolbox.open();
$('collapse').onclick = () => { const c = $('activity').classList.toggle('collapsed'); $('collapse').textContent = c ? '▴' : '▾'; };
$('timeBtn').onclick = () => { S.time = { auto: 'day', day: 'dusk', dusk: 'night', night: 'auto' }[S.time]; renderClock(); toast(S.time === 'auto' ? 'Office time follows your clock' : `Forced ${S.time}`); };
$('walkinYes').onclick = () => answerWalkin(true); $('walkinNo').onclick = () => answerWalkin(false);
$('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const input = $('taskInput'), title = input.value.trim(); if (!title) return;
  input.value = ''; const r = await S.source.dispatch(title); if (r?.error) toast(r.error);
});
addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  const k = e.key.toLowerCase();
  if (!$('walkinModal').hidden && (k === 'y' || k === 'n')) answerWalkin(k === 'y');
  else if (k === 'n') { renderInbox(); open('inboxModal'); }
  else if (k === 'c') center(true);
  else if (k === 'escape') { document.querySelectorAll('.modal').forEach((m) => { if (m.id !== 'walkinModal') m.hidden = true; }); select(null); }
});
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'walkinModal') m.hidden = true; }));
addEventListener('resize', () => { resize(); });
if (mobile()) $('activity').classList.add('collapsed');

const C = { S, npcs, view, canvas, ctx, cat, fun, fx: { sparkle: fun.sparkle },
  h: { route, routeFromHere, tag, startTrip, goHome, advance, homeOf, hash, rand, pick, toast, pushFeed, select, focus, nm, refreshPanels: () => refresh(), refresh: () => { refresh(); looks.refreshManager(); } } };
setTheme(store.get('theme', 'blossom'), false);
edit.initEdit(C); fun.initFun(C); looks.initLooks(C); toolbox.initToolbox(C);
window.agv = C;     // handy for poking around in the console
resize(); renderClock(); setInterval(renderClock, 15000);
setInterval(() => { if (!$('inboxModal').hidden) renderInbox(); }, 5000);
S.showOnFloor = (id) => { if (S.agents[id]) { select(id); focus(id); } };
board.init(S);
$('opsSummary').onclick = () => board.open();
connect({
  onSnapshot: applySnapshot, onEvent: applyEvent,
  onMeta: (m) => { if (m.data || !S.opsData?.data) S.opsData = m; else S.opsData = { ...S.opsData, stale: true, error: m.error }; ops.onMeta(S.opsData, $); board.update(); },
}).then((src) => { S.source = src; });
setInterval(() => { if (S.opsData) ops.onMeta(S.opsData, $); }, 15000);          // keep "updated 3m ago" honest between polls
requestAnimationFrame(frame);
