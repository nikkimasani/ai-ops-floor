// Everything playful. None of it touches real agent state — it is the office having a nice time:
// agents using the furniture you placed, friendship, costumed visitors, parties and a friendly UFO.

import { CATALOG, spotsOf } from './shared/catalog.js';
import { roomAt } from './shared/placement.js';
import { ENTRANCE, SEATS, SPOTS } from './shared/layout.js';
import { INTERACTIONS, interactionById, applyInteraction, levelOf, favoriteOf, VISITORS, visitorQuip, dueEvents, eventById } from './shared/life.js';
import { drawAgent, drawNameTag, drawBubble, circle, ellipse, poly, FONT } from './render.js';
import { placed } from './edit.js';
import { store } from './store.js';

let C;
const claims = new Map();                 // "uid:spot" -> agent id
const particles = [], visitors = [];
let social = store.get('social', {});
let visitorsOn = store.get('visitors', false);          // work mode: off until Fun mode is switched on
let ev = null, ufo = null, nextVisitor = 0, lastCalendar = 0;
const fired = new Set();
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nowMs = () => performance.now();

export function initFun(c) {
  C = c;
  nextVisitor = nowMs() + 22000;
}

// ---------- particles ----------
export function burst(x, y, z, emojis, count = 6) {
  for (let i = 0; i < count; i++) particles.push({ x: x + rand(-0.4, 0.4), y: y + rand(-0.4, 0.4), z, vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(0.9, 1.8), life: 0, max: rand(1.1, 1.9), text: pick(emojis), size: rand(13, 20) });
}
export const sparkle = (it) => { const r = { x: it.x, y: it.y }; burst(r.x + 0.8, r.y + 0.6, 0.6, ['✨', '💖', '⭐'], 7); };

// ---------- using furniture ----------
export const usersAt = (uid) => Object.values(C.npcs).filter((n) => n.use?.arrived && n.use.uid === uid).length;
export const fxFor = (uid) => ({ t: nowMs(), users: usersAt(uid) });

function findUser(uid, idx) {
  for (const [id, n] of Object.entries(C.npcs)) if (n.use?.arrived && n.use.uid === uid && n.use.idx === idx) return n;
  return null;
}

/** Choose a free spot on some placed furniture for an idle agent, or null to fall back to the old hangouts. */
export function chooseSpot(id) {
  const n = C.npcs[id]; if (!n) return null;
  const cands = [];
  for (const it of placed()) {
    const c = CATALOG[it.id];
    for (const sp of spotsOf(it)) {
      const key = `${it.uid}:${sp.idx}`;
      if (claims.has(key)) continue;
      let w = 2;
      if (c.kind === 'pair') w = claims.has(`${it.uid}:${1 - sp.idx}`) ? 9 : 1.5;   // join someone who's waiting
      cands.push({ it, sp, key, w, c });
    }
  }
  if (!cands.length || Math.random() < 0.15) return null;
  let r = Math.random() * cands.reduce((s, x) => s + x.w, 0), choice = cands[0];
  for (const x of cands) { r -= x.w; if (r <= 0) { choice = x; break; } }
  claims.set(choice.key, id); n.claim = choice.key;
  const { it, sp, c } = choice;
  return { place: { x: sp.x, y: sp.y, room: roomAt(sp.x, sp.y) || 'corridor' }, dwell: c.kind === 'pair' ? 14 : rand(7, 12), say: sp.say, pose: sp.pose || 'play', uid: it.uid, idx: sp.idx, kind: c.kind, emoji: c.emoji };
}

export function arrive(id, pick_) {
  const a = C.S.agents[id], n = C.npcs[id]; if (!a || !n) return;
  n.use = { uid: pick_.uid, idx: pick_.idx, pose: pick_.pose, arrived: true, kind: pick_.kind };
  C.h.pushFeed({ cat: 'funny', icon: pick_.emoji, id, text: `${C.h.nm(a)} ${pick_.say}` });
  if (pick_.kind === 'pair') {
    const partner = findUser(pick_.uid, 1 - pick_.idx);
    if (partner) {
      for (const m of [n, partner]) if (m.q[0]?.wait !== undefined) m.q[0].wait = Math.max(m.q[0].wait, 9);
      burst(n.x, n.y, 1, ['✨', '🎉'], 4);
    } else { n.say = 'Anyone up for a game? 🎮'; n.sayUntil = nowMs() + 3500; }
  }
}

export function onLayoutChanged() {
  const live = new Set(placed().map((i) => i.uid));
  for (const [key, id] of [...claims]) {
    if (live.has(key.split(':')[0])) continue;
    claims.delete(key);
    const n = C.npcs[id]; if (n) { n.use = null; n.claim = null; if (n.trip?.kind === 'activity') C.h.goHome(id); }
  }
  for (const n of Object.values(C.npcs)) if (n.use && !live.has(n.use.uid)) n.use = null;
}

// ---------- hanging out with agents ----------
export const socialOf = (id) => social[id] || { affection: 0, count: 0, last: 0 };

export function interact(id, action) {
  const a = C.S.agents[id], n = C.npcs[id], it = interactionById[action];
  if (!a || !n || !it) return false;
  const res = applyInteraction(social[id], action, Date.now());
  if (!res.changed) return false;
  social[id] = res.rec; store.set('social', social);
  const t = nowMs();
  n.ipose = it.pose; n.iposeUntil = t + (it.seconds || 3) * 1000;
  n.say = it.favourite ? `You remembered my favourite — ${favoriteOf(id)}!!` : pick(it.say); n.sayUntil = t + 3800;
  burst(n.x, n.y, 1.4, it.fx, 8);
  const verb = { pet: `gave ${C.h.nm(a)} a head pat`, cake: `treated ${C.h.nm(a)} to cake`, boba: `bought ${C.h.nm(a)} a boba`, dance: `started a dance party with ${C.h.nm(a)}`, highfive: `high-fived ${C.h.nm(a)}`, compliment: `told ${C.h.nm(a)} they’re doing great`, snack: `brought ${C.h.nm(a)} their favourite ${favoriteOf(id)}` }[action];
  C.h.pushFeed({ cat: 'funny', icon: it.emoji, id, text: `You ${verb}` });
  if (res.leveledUp) { const lv = levelOf(res.rec.affection); C.h.toast(`${C.h.nm(a)} is now your ${lv.label}! ${lv.emoji}`); burst(n.x, n.y, 1.6, ['💖', '✨', '🌸'], 14); }
  return true;
}

function petCat() {
  const cat = C.cat, t = nowMs();
  cat.wait = 4; cat.moving = false; cat.say = pick(['Purrrr…', 'Mrrrow!', '*headbutts you*', 'Prrp?']); cat.sayUntil = t + 2600;
  burst(cat.x, cat.y, 0.8, ['💗', '🐾', '✨'], 6);
  C.h.pushFeed({ cat: 'funny', icon: '🐈', text: 'You petted the office cat' });
}

// ---------- visitors ----------
export const visitorsEnabled = () => visitorsOn;
export function setVisitors(on) { visitorsOn = on; store.set('visitors', on); if (on) nextVisitor = nowMs() + 4000; }

export function inviteVisitor() {
  if (visitors.length >= 3) { C.h.toast('The office is full of visitors already!'); return false; }
  const def = pick(VISITORS.filter((d) => !visitors.some((v) => v.def === d))) || pick(VISITORS);
  const n = { x: ENTRANCE.x, y: ENTRANCE.y, q: [], trip: null, phase: 0, seed: rand(0, 10), walking: false, seated: false, place: { ...ENTRANCE, room: 'corridor' }, say: null, sayUntil: 0, def, vid: Math.random().toString(36).slice(2, 6) };
  visitors.push(n);
  const targets = C.S.order.map((i) => C.S.agents[i]).filter((a) => a && a.seat >= 0);
  const home = (x, y) => ({ x, y, room: roomAt(x, y) || 'corridor' });
  const spot = pick([...SPOTS.lounge, ...SPOTS.garden, ...SPOTS.kitchen]), spotPlace = home(spot.x, spot.y), door = { ...ENTRANCE, room: 'corridor' };
  const q = [];
  if (targets.length) {
    const a = pick(targets), rs = SEATS[a.seat], stand = { x: rs.x - 1.15, y: rs.y, room: rs.room, aisle: rs.aisle };
    q.push(...C.h.tag(C.h.route(n.place, stand), stand), { wait: 5, fn: () => greet(n, a) }, ...C.h.tag(C.h.route(stand, spotPlace), spotPlace));
  } else q.push(...C.h.tag(C.h.route(n.place, spotPlace), spotPlace));
  q.push({ wait: 7, fn: () => { n.say = pick(['What a lovely office!', 'So many cute desks 💕', 'Ooh, is that a ping-pong table?']); n.sayUntil = nowMs() + 3500; } },
    ...C.h.tag(C.h.route(spotPlace, door), door), { fn: () => { const i = visitors.indexOf(n); if (i >= 0) visitors.splice(i, 1); } });
  n.q = q; n.trip = { kind: 'visit' };
  C.h.pushFeed({ cat: 'funny', icon: '🎀', text: `${def.name} dropped by for a visit` });
  return true;
}

function greet(n, a) {
  const an = C.npcs[a.id];
  if (!an || !C.S.agents[a.id]) { n.say = 'Oh! Nobody’s home…'; n.sayUntil = nowMs() + 2800; return; }   // she left while we walked over
  n.say = visitorQuip(n.def, C.S.agents[a.id].status); n.sayUntil = nowMs() + 4200;
  burst(an.x, an.y, 1.5, ['✨', '💖'], 6);
  setTimeout(() => { if (C.npcs[a.id] === an) { an.say = pick(['Aww, hi there!', 'Thanks for stopping by!', 'Hehe 💕']); an.sayUntil = nowMs() + 2600; } }, 1400);
  C.h.pushFeed({ cat: 'funny', icon: '💬', id: a.id, text: `${n.def.name} to ${C.h.nm(a)}: “${n.say}”` });
}

// ---------- events ----------
export const currentEvent = () => ev;
const eligible = () => C.S.order.filter((id) => ['idle', 'bench'].includes(C.S.agents[id]?.status) && C.npcs[id] && !C.npcs[id].trip?.kind?.match(/^(handoff|ufo|arrive|leave)$/));

function gather(ids, placeFn, dwell, epose, line) {
  ids.forEach((id, i) => {
    const p = placeFn(i), a = C.S.agents[id];
    C.h.startTrip(id, 'activity', { x: p.x, y: p.y, room: roomAt(p.x, p.y) || 'corridor' }, dwell + rand(0, 3), () => {
      const n = C.npcs[id]; n.epose = epose; n.eposeUntil = nowMs() + dwell * 1000; n.say = line(a); n.sayUntil = nowMs() + 3600;
    });
  });
}

export function startEvent(id) {
  const e = eventById[id]; if (!e) return false;
  if (ev || ufo) { C.h.toast('One event at a time, sweetie 🎀'); return false; }
  if (id === 'ufo') return startUfo();
  const ids = eligible();
  if (!ids.length) { C.h.toast('Everyone is busy working — the party can wait ✨'); return false; }
  const t = nowMs();
  if (id === 'cake') {
    const names = C.S.order.map((i) => C.h.nm(C.S.agents[i])), honoree = pick(names);
    ev = { id, start: t, end: t + 26000, honoree };
    gather(ids, (i) => { const r = 1.5 + ids.length * 0.14; return { x: 19.6 + Math.cos((i / ids.length) * 6.283) * r, y: 16.0 + Math.sin((i / ids.length) * 6.283) * r * 0.75 }; }, 18, 'cheer', () => pick(['Happy birthday!! 🎂', 'Make a wish!', 'Cake time~']));
    C.h.pushFeed({ cat: 'funny', icon: '🎂', text: `Birthday cake for ${honoree}! Everyone’s gathering in the lounge` });
  } else if (id === 'boba') {
    ev = { id, start: t, end: t + 20000 };
    gather(ids, (i) => ({ x: 3.6 + (i % 4) * 1.35, y: 15.0 + Math.floor(i / 4) * 1.5 }), 12, 'sip', () => pick(['Boba o’clock! 🧋', 'Extra pearls!', 'Brown sugar, please!']));
    C.h.pushFeed({ cat: 'funny', icon: '🧋', text: 'It’s boba o’clock — a queue forms in the kitchen' });
  } else if (id === 'dance') {
    ev = { id, start: t, end: t + 26000 };
    gather(ids, (i) => ({ x: 17.4 + (i % 4) * 1.5, y: 14.3 + Math.floor(i / 4) * 1.6 }), 20, 'dance', () => pick(['Let’s dance!! 🪩', 'Twirl twirl~', 'This is my song!']));
    C.h.pushFeed({ cat: 'funny', icon: '🪩', text: 'Dance party in the lounge! The disco ball is out' });
  }
  return true;
}

// ---------- the friendly UFO ----------
function startUfo() {
  const ids = eligible();
  if (!ids.length) { C.h.toast('Nobody is on a break for the UFO to borrow 👀'); return false; }
  const id = pick(ids), n = C.npcs[id];
  n.q = []; n.trip = { kind: 'ufo' }; n.carry = false;
  ufo = { id, t0: nowMs(), x: n.x, y: n.y };
  C.h.pushFeed({ cat: 'funny', icon: '🛸', id, text: `A pink UFO is hovering over ${C.h.nm(C.S.agents[id])}…` });
  return true;
}

function updateUfo(t) {
  const n = C.npcs[ufo.id], a = C.S.agents[ufo.id];
  if (!n || !a) { ufo = null; return; }
  if (!['idle', 'bench'].includes(a.status)) {      // real work resumed: call off the abduction
    n.lift = 0; n.fade = undefined; n.trip = null; n.q = [];
    const id = ufo.id; ufo = null; C.h.goHome(id); return;
  }
  const s = (t - ufo.t0) / 1000;
  if (s < 2.2) { n.lift = 0; n.fade = undefined; }
  else if (s < 4.4) { const k = (s - 2.2) / 2.2; n.lift = k * 80; n.fade = 1 - k; }
  else if (s < 6.6) { n.lift = 80; n.fade = 0; }
  else if (s < 8.8) { const k = (s - 6.6) / 2.2; n.lift = 80 * (1 - k); n.fade = k; }
  else if (s < 10.8) { n.lift = 0; n.fade = undefined; if (!ufo.said) { ufo.said = true; n.say = '👽 …that was fun!'; n.sayUntil = t + 3500; burst(n.x, n.y, 1.4, ['⭐', '✨', '👽'], 8); C.h.pushFeed({ cat: 'funny', icon: '👽', id: ufo.id, text: `${C.h.nm(C.S.agents[ufo.id])} was returned safely by the UFO` }); } }
  else { n.lift = 0; n.fade = undefined; n.trip = null; ufo = null; return; }
  if (s > 2.2 && s < 4.4 && Math.random() < 0.4) burst(n.x, n.y, 1 + (n.lift / 40), ['✨'], 1);
}

function drawUfo(ctx, v, t) {
  const s = (t - ufo.t0) / 1000;
  let h, dx = 0;
  if (s < 2.2) { const k = 1 - (s / 2.2); h = 3.3 + k * 3; dx = k * 6; }
  else if (s < 8.8) h = 3.3 + Math.sin(s * 2) * 0.1;
  else { const k = (s - 8.8) / 2; h = 3.3 + k * 4; dx = k * 6; }
  const [x, y] = v.p(ufo.x + dx, ufo.y - dx * 0.6, h), [gx, gy] = v.p(ufo.x, ufo.y, 0), z = v.s;
  if (s > 2.0 && s < 8.8) {   // tractor beam
    const a = Math.min(1, (s - 2.0) * 2, (8.8 - s) * 2);
    poly(ctx, [[x - 16 * z, y + 6 * z], [x + 16 * z, y + 6 * z], [gx + 34 * z, gy + 2 * z], [gx - 34 * z, gy + 2 * z]], `rgba(255,245,170,${0.42 * a})`);
    ellipse(ctx, gx, gy + 2 * z, 34 * z, 11 * z, `rgba(255,245,170,${0.4 * a})`);
  }
  ellipse(ctx, x, y + 3 * z, 38 * z, 12 * z, '#ff7fb0'); ellipse(ctx, x, y, 38 * z, 11 * z, '#ffb3d1'); ellipse(ctx, x, y - 2 * z, 30 * z, 8 * z, '#ffd1e3');
  ctx.beginPath(); ctx.arc(x, y - 6 * z, 15 * z, Math.PI, 0); ctx.fillStyle = 'rgba(190,230,255,.85)'; ctx.fill();
  for (let i = -2; i <= 2; i++) circle(ctx, x + i * 10 * z, y + 3 * z, 2.2 * z, ['#ffe58a', '#b9a2ee', '#7ad6c8'][Math.abs(i) % 3]);
}

// ---------- per-frame ----------
export function update(dt, nowS) {
  const t = nowMs();
  for (const id of C.S.order) {
    const n = C.npcs[id]; if (!n) continue;
    // pose priority: something you just did > the party > using furniture
    let pose = null;
    if (n.iposeUntil && t < n.iposeUntil) pose = n.ipose;
    else if (n.eposeUntil && t < n.eposeUntil && !n.walking) pose = n.epose;
    else if (n.use?.arrived && !n.walking && (n.use.kind !== 'pair' || usersAt(n.use.uid) >= 2)) pose = n.use.pose;
    n.pose = n.lift ? null : pose;
    // let go of furniture once she walks away from it
    if (n.use?.arrived && n.walking || (n.claim && (!n.trip || n.trip.kind === 'return'))) {
      if (n.claim) claims.delete(n.claim); n.claim = null; n.use = null;
    }
  }
  // ambient music notes and sparkles around busy furniture
  for (const it of placed()) {
    const users = usersAt(it.uid);
    if (users && Math.random() < dt * 2.2) {
      const emojis = it.id === 'jukebox' || it.id === 'dancepad' ? ['🎵', '🎶'] : it.id === 'pingpong' || it.id === 'foosball' || it.id === 'pool' ? ['✨'] : it.id === 'bubbletea' ? ['💧'] : ['✨', '⭐'];
      burst(it.x + 0.6, it.y + 0.5, 1.1, emojis, 1);
    }
  }
  for (const v of visitors) { C.h.advance(v, dt); v.phase += dt; }
  if (ufo) updateUfo(t);
  if (ev && t > ev.end) { C.h.pushFeed({ cat: 'funny', icon: eventById[ev.id].emoji, text: `${eventById[ev.id].name} is over — back to work, lovelies` }); ev = null; }
  if (ev && ev.id === 'dance' && Math.random() < dt * 5) burst(19.5 + rand(-2.5, 2.5), 15.5 + rand(-1.5, 1.5), 1.2, ['🎵', '✨', '💖', '🎶'], 1);
  if (ev && ev.id === 'cake' && Math.random() < dt * 3) burst(19.6, 16, 1.0, ['✨', '🎈', '💖'], 1);
  if (visitorsOn && t > nextVisitor) { inviteVisitor(); nextVisitor = t + rand(50000, 90000); }
  if (t - lastCalendar > 20000) {
    lastCalendar = t;
    if (store.get('fun', false)) for (const d of dueEvents(new Date(), fired)) { fired.add(d.key); if (startEvent(d.event.id)) C.h.toast(`${d.event.emoji} ${d.event.name}!`); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt * 0.7;
    if (p.life > p.max) particles.splice(i, 1);
  }
}

// ---------- drawing ----------
export function sceneItems(v) {
  const out = [];
  for (const n of visitors) out.push({ key: n.x + n.y + 0.02, draw: (ctx) => { n.hd = drawAgent(ctx, v, { ...n.def, status: 'idle', acc: n.def.acc }, n, nowMs(), false); } });
  if (ev?.id === 'cake') out.push({ key: 19.6 + 16, draw: (ctx) => {
    const [x, y] = v.p(19.6, 16.0, 0.45), z = v.s, t = nowMs();
    ellipse(ctx, x, y + 9 * z, 17 * z, 7 * z, 'rgba(90,50,80,.18)'); ellipse(ctx, x, y + 4 * z, 16 * z, 7 * z, '#ffb3d1'); ellipse(ctx, x, y - 3 * z, 16 * z, 7 * z, '#fff'); ellipse(ctx, x, y - 8 * z, 12 * z, 5 * z, '#ffd1e3');
    for (let i = -1; i <= 1; i++) { ctx.fillStyle = '#7ad6c8'; ctx.fillRect(x + i * 6 * z - z, y - 18 * z, 2 * z, 9 * z); ellipse(ctx, x + i * 6 * z, y - 21 * z + Math.sin(t / 90 + i) * z, 2 * z, 3.2 * z, '#ffd95a'); }
  } });
  if (ufo) out.push({ key: 9999, draw: (ctx) => drawUfo(ctx, v, nowMs()) });
  return out;
}

export function overlay(ctx, v, t) {
  const w = ctx.canvas.clientWidth, h = ctx.canvas.clientHeight;
  if (ev?.id === 'dance') {            // disco light wash + ball
    const k = t / 600;
    for (let i = 0; i < 3; i++) {
      const [cx, cy] = v.p(19.5 + Math.cos(k + i * 2.1) * 3, 15.5 + Math.sin(k * 1.3 + i * 2.1) * 2, 0), r = 170 * v.s + 40, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `hsla(${(k * 60 + i * 120) % 360},95%,72%,.34)`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    const [bx, by] = v.p(19.5, 13.4, 2.8), r = 15 * v.s + 4;
    ctx.strokeStyle = '#c9b6c9'; ctx.beginPath(); ctx.moveTo(bx, by - 40 * v.s); ctx.lineTo(bx, by - r); ctx.stroke(); circle(ctx, bx, by, r, '#e9e0f5');
    for (let i = 0; i < 7; i++) circle(ctx, bx + Math.cos(k * 2 + i) * r * 0.6, by + Math.sin(k * 2 + i * 1.3) * r * 0.6, r * 0.14, '#fff');
  }
  for (const p of particles) {
    const [x, y] = v.p(p.x, p.y, p.z), a = Math.max(0, 1 - p.life / p.max);
    ctx.globalAlpha = a; ctx.font = `${Math.round(p.size * Math.max(0.8, Math.min(1.5, v.s * 1.4)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.text, x, y); ctx.globalAlpha = 1;
  }
  for (const n of visitors) {
    if (!n.hd) continue;
    drawNameTag(ctx, n.hd.x, n.hd.y + 62 * n.hd.u * 0.9 + 12, '✨ ' + n.def.name, '#b387f5');
    if (n.say && t < n.sayUntil) drawBubble(ctx, n.hd.x, n.hd.y - 10, n.say, '#f3e8ff');
  }
  const cat = C.cat;
  if (cat.say && t < cat.sayUntil) { const [x, y] = v.p(cat.x, cat.y, 0.8); drawBubble(ctx, x, y - 16, cat.say, '#fff', '#4a2c4a', 120); }
  if (ev) {
    const e = eventById[ev.id], txt = ev.id === 'cake' ? `${e.emoji} Happy birthday, ${ev.honoree}!` : `${e.emoji} ${e.name}!`;
    ctx.font = `800 14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(txt).width + 34, bx = w / 2, by = 22 + 6 * Math.sin(t / 300);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.roundRect(bx - tw / 2, by - 15, tw, 30, 15); ctx.fill();
    ctx.strokeStyle = '#ff9ec4'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#9a4f7e'; ctx.fillText(txt, bx, by + 1);
  }
}

/** Taps on the cat or a visitor. Returns true if used. */
export function tap(sx, sy) {
  const v = C.view, u = Math.max(0.35, v.s) * 1.05;
  const [cx, cy] = v.p(C.cat.x, C.cat.y, 0.3);
  if (Math.hypot(sx - cx, sy - (cy - 8 * v.s)) < 20 * u) { petCat(); return true; }
  for (const n of visitors) {
    const [fx, fy] = v.p(n.x, n.y);
    if (Math.hypot(sx - fx, sy - (fy - 30 * u)) < 28 * u) {
      n.say = pick(['Hello hello! 💕', 'Lovely office you have!', `${n.def.name} says hi!`]); n.sayUntil = nowMs() + 2800; burst(n.x, n.y, 1.5, ['✨', '💖'], 5); return true;
    }
  }
  return false;
}

export const funApi = { onLayoutChanged, chooseSpot, arrive, interact };
