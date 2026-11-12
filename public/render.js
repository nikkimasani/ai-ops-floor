// Isometric drawing: floor, furniture, little characters, speech bubbles. No state lives here.

import { GRID, ROOMS, FURNITURE } from './shared/layout.js';
import { theme } from './theme.js';

export const TW = 64, TH = 32, ZU = 34;   // tile width/height in px, px per unit of height
export const STATUS_ICON = { working: '💻', thinking: '💭', blocked: '🚧', asking: '❓', ready: '📦', dark: '🥀', bench: '💤', done: '✅', idle: '' };
export const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';

// ---------- colour + projection helpers ----------
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mix = (h, t, to = 255) => '#' + rgb(h).map((v) => Math.round(v + (to - v) * t).toString(16).padStart(2, '0')).join('');
export const lighten = (h, t) => mix(h, t, 255);
export const darken = (h, t) => mix(h, t, 0);

export class View {
  constructor() { this.s = 1; this.ox = 0; this.oy = 0; }
  p(x, y, z = 0) { return [(x - y) * TW / 2 * this.s + this.ox, (x + y) * TH / 2 * this.s - z * ZU * this.s + this.oy]; }
  inv(sx, sy) { const a = (sx - this.ox) / (TW / 2 * this.s), b = (sy - this.oy) / (TH / 2 * this.s); return [(a + b) / 2, (b - a) / 2]; }
}

export function poly(ctx, pts, fill, stroke) {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

export function box(ctx, v, x, y, w, d, h, c, z0 = 0) {
  const z1 = z0 + h;
  poly(ctx, [v.p(x + w, y, z1), v.p(x + w, y + d, z1), v.p(x + w, y + d, z0), v.p(x + w, y, z0)], darken(c, 0.18));           // right face
  poly(ctx, [v.p(x, y + d, z1), v.p(x + w, y + d, z1), v.p(x + w, y + d, z0), v.p(x, y + d, z0)], darken(c, 0.07));           // left face
  poly(ctx, [v.p(x, y, z1), v.p(x + w, y, z1), v.p(x + w, y + d, z1), v.p(x, y + d, z1)], lighten(c, 0.12), 'rgba(255,255,255,.35)'); // top
}

export function circle(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, 7); ctx.fillStyle = fill; ctx.fill(); }
export function ellipse(ctx, x, y, rx, ry, fill, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, 7); ctx.fillStyle = fill; ctx.fill(); }

// ---------- static scene ----------
// Drawn first, in order: base plate, floors, rugs, back walls. Nothing here can overlap a character.
export function drawFloor(ctx, v) {
  const { w, d } = GRID;
  const t = 0.8;   // plate thickness
  const base = theme.t.plate;
  poly(ctx, [v.p(0, d, 0), v.p(w, d, 0), v.p(w, d, -t), v.p(0, d, -t)], darken(base, 0.08));
  poly(ctx, [v.p(w, 0, 0), v.p(w, d, 0), v.p(w, d, -t), v.p(w, 0, -t)], darken(base, 0.2));
  const roomAt = (x, y) => Object.values(ROOMS).find((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) {
    const r = roomAt(x + 0.5, y + 0.5);
    const key = r && Object.keys(ROOMS).find((k) => ROOMS[k] === r);
    const pal = r ? (theme.t.floors[key] || r.floor) : theme.t.corridor;
    poly(ctx, [v.p(x, y), v.p(x + 1, y), v.p(x + 1, y + 1), v.p(x, y + 1)], pal[(x + y) & 1]);
  }
  for (const it of FURNITURE) if (it.k === 'flat') {
    poly(ctx, [v.p(it.x, it.y), v.p(it.x + it.w, it.y), v.p(it.x + it.w, it.y + it.d), v.p(it.x, it.y + it.d)], it.c, lighten(it.c, 0.5));
    const g = 0.35;
    poly(ctx, [v.p(it.x + g, it.y + g), v.p(it.x + it.w - g, it.y + g), v.p(it.x + it.w - g, it.y + it.d - g), v.p(it.x + g, it.y + it.d - g)], lighten(it.c, 0.35));
  }
  for (const it of FURNITURE) if (it.k === 'pond') {
    const [cx, cy] = v.p(it.x + it.w / 2, it.y + it.d / 2);
    ellipse(ctx, cx, cy, it.w * TW / 3 * v.s, it.d * TH / 2.6 * v.s, '#9ad6f2');
    ellipse(ctx, cx - 6 * v.s, cy - 2 * v.s, it.w * TW / 7 * v.s, it.d * TH / 8 * v.s, '#c8ecfb');
    ellipse(ctx, cx + 12 * v.s, cy + 3 * v.s, 5 * v.s, 2.5 * v.s, '#8fd9a8');
  }
  // back walls (north + west), cream with a rose trim, soft windows and fairy lights
  const H = 1.9;
  box(ctx, v, 0, -0.25, w, 0.25, H, theme.t.wall[0]);
  box(ctx, v, -0.25, 0, 0.25, d, H, theme.t.wall[1]);
  box(ctx, v, 0, -0.25, w, 0.25, 0.12, theme.t.trim[0], H); box(ctx, v, -0.25, 0, 0.25, d, 0.12, theme.t.trim[1], H);
  for (let x = 2; x < w - 2; x += 4.5) {
    poly(ctx, [v.p(x, 0, 0.9), v.p(x + 2.4, 0, 0.9), v.p(x + 2.4, 0, 1.65), v.p(x, 0, 1.65)], '#cdeafc', '#fff');
    poly(ctx, [v.p(x + 1.2, 0, 0.9), v.p(x + 1.2, 0, 1.65)], null, '#fff');
  }
  for (let y = 2; y < d - 2; y += 5) poly(ctx, [v.p(0, y, 0.9), v.p(0, y + 2.4, 0.9), v.p(0, y + 2.4, 1.65), v.p(0, y, 1.65)], '#cdeafc', '#fff');
  for (let i = 0; i <= 40; i++) {                                      // fairy lights along the north wall
    const x = (i / 40) * w, sag = Math.sin((i / 40) * Math.PI * 6) * 0.12;
    const [sx, sy] = v.p(x, 0.05, 1.55 - Math.abs(sag));
    circle(ctx, sx, sy, 2.2 * v.s + 0.6, ['#ffd86b', '#ff9ec4', '#b9a2ee', '#8fe3c4'][i % 4]);
  }
}

// Depth-sorted scene items (everything that can overlap characters).
export function sceneItems(v) {
  const items = [];
  for (const it of FURNITURE) {
    if (it.k === 'flat' || it.k === 'pond') continue;
    const cx = it.k === 'box' ? it.x + it.w / 2 : it.x, cy = it.k === 'box' ? it.y + it.d / 2 : it.y;
    items.push({ key: cx + cy + (it.z || 0) * 0.01, draw: (ctx) => drawItem(ctx, v, it) });
  }
  // low dividers between rooms, as short segments so depth sorting stays honest
  const seg = (x, y, w, d) => items.push({ key: x + w / 2 + y + d / 2, draw: (ctx) => box(ctx, v, x, y, w, d, 0.75, theme.t.divider) });
  for (const x of [9, 22]) for (let y = 1; y < 10; y++) if (y < 4 || y >= 7) seg(x - 0.1, y, 0.2, 1);
  for (const x of [9, 16, 23]) for (let y = 12; y < 20; y++) if (y < 14.5 || y >= 17.5) seg(x - 0.1, y, 0.2, 1);
  return items;
}

function drawItem(ctx, v, it) {
  const s = v.s;
  if (it.k === 'box') return box(ctx, v, it.x, it.y, it.w, it.d, it.h, it.c, it.z || 0);
  if (it.k === 'bush') {
    const [x, y] = v.p(it.x, it.y, 0.12), r = 17 * (it.s || 1) * s;
    ellipse(ctx, x, y + r * 0.55, r * 0.9, r * 0.35, 'rgba(0,0,0,.1)');
    circle(ctx, x, y, r, darken(it.c, 0.08)); circle(ctx, x - r * 0.25, y - r * 0.25, r * 0.72, it.c); circle(ctx, x - r * 0.35, y - r * 0.4, r * 0.3, lighten(it.c, 0.5));
  } else if (it.k === 'tree') {
    const sc = it.s || 1;
    box(ctx, v, it.x - 0.14, it.y - 0.14, 0.28, 0.28, 1.2 * sc, '#c99a7a');
    const [x, y] = v.p(it.x, it.y, 1.2 * sc);
    for (const [dx, dy, r, c] of [[0, -6, 34, '#a9dca0'], [-18, 10, 26, '#9bd391'], [18, 8, 26, '#b7e4ab'], [0, -26, 24, '#c2ebb6']]) circle(ctx, x + dx * sc * s, y + dy * sc * s, r * sc * s, c);
    for (const [dx, dy] of [[-12, -4], [10, -20], [16, 8], [-20, 14]]) circle(ctx, x + dx * sc * s, y + dy * sc * s, 3.5 * sc * s, '#ffc2da');
  } else if (it.k === 'flowers') {
    for (let i = 0; i < it.n; i++) {
      const [x, y] = v.p(it.x + (i % 2) * 0.3, it.y + Math.floor(i / 2) * 0.28, it.z || 0);
      const c = ['#ff9ec4', '#fff', '#ffd86b', '#c9b6f2'][i % 4];
      ctx.strokeStyle = '#7cc58a'; ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 9 * s); ctx.stroke();
      circle(ctx, x, y - 11 * s, 4.5 * s, c); circle(ctx, x, y - 11 * s, 1.8 * s, '#ffe08a');
    }
  } else if (it.k === 'lamp') {
    box(ctx, v, it.x - 0.06, it.y - 0.06, 0.12, 0.12, 1.5, '#d9c3a8');
    const [x, y] = v.p(it.x, it.y, 1.55);
    ellipse(ctx, x, y, 22 * s, 18 * s, 'rgba(255,224,150,.28)'); circle(ctx, x, y, 11 * s, '#ffe08a'); circle(ctx, x - 3 * s, y - 3 * s, 4 * s, '#fff6cf');
  }
}

// ---------- characters ----------
const SKIN = '#fbd5b8';

function hairBack(ctx, st, u, c) {
  const dark = darken(c, 0.12);
  switch (st) {
    case 'long': ctx.beginPath(); ctx.roundRect(-14 * u, -58 * u, 28 * u, 36 * u, 12 * u); ctx.fillStyle = dark; ctx.fill(); break;
    case 'bob': circle(ctx, 0, -44 * u, 15.5 * u, dark); break;
    case 'bun': circle(ctx, 0, -46 * u, 13 * u, dark); circle(ctx, 0, -62 * u, 6.5 * u, c); break;
    case 'pigtails': circle(ctx, -16 * u, -40 * u, 6 * u, c); circle(ctx, 16 * u, -40 * u, 6 * u, c); ellipse(ctx, -17 * u, -32 * u, 4 * u, 8 * u, c); ellipse(ctx, 17 * u, -32 * u, 4 * u, 8 * u, c); circle(ctx, 0, -46 * u, 13 * u, dark); break;
    case 'pony': circle(ctx, 0, -46 * u, 13 * u, dark); ellipse(ctx, 18 * u, -40 * u, 5 * u, 11 * u, c, -0.5); break;
    case 'curly': for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; circle(ctx, Math.cos(a) * 13 * u, -46 * u + Math.sin(a) * 12 * u, 6.5 * u, c); } circle(ctx, 0, -46 * u, 12 * u, dark); break;
    default: circle(ctx, 0, -46 * u, 13 * u, dark);
  }
}

export const ACCESSORIES = ['bow', 'flower', 'crown', 'glasses', 'catears', 'none'];
export const HAIR_STYLES = ['bob', 'long', 'bun', 'pigtails', 'pony', 'curly'];

function accessory(ctx, kind, u, a) {
  const gold = '#ffd95a';
  switch (kind) {
    case 'none': return;
    case 'flower': {
      const x = 9 * u, y = -55 * u;
      for (let i = 0; i < 5; i++) { const t = i / 5 * Math.PI * 2; circle(ctx, x + Math.cos(t) * 3.4 * u, y + Math.sin(t) * 3.4 * u, 2.6 * u, '#fff'); }
      circle(ctx, x, y, 2.2 * u, gold); return;
    }
    case 'crown': {
      const y = -60 * u;
      poly(ctx, [[-7 * u, y], [-7 * u, y - 7 * u], [-3.5 * u, y - 3 * u], [0, y - 8 * u], [3.5 * u, y - 3 * u], [7 * u, y - 7 * u], [7 * u, y]], gold, '#e9b52c');
      circle(ctx, 0, y - 2.5 * u, 1.3 * u, '#ff6fa8'); return;
    }
    case 'glasses':
      ctx.strokeStyle = '#4a2c4a'; ctx.lineWidth = 1.3 * u;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 4.6 * u, -45 * u, 3.6 * u, 0, 7); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-1 * u, -45 * u); ctx.lineTo(1 * u, -45 * u); ctx.stroke(); return;
    case 'catears': {
      for (const s of [-1, 1]) {
        poly(ctx, [[s * 11 * u, -52 * u], [s * 6 * u, -66 * u], [s * 1.5 * u, -56 * u]], a.hairColor);
        poly(ctx, [[s * 9.4 * u, -55 * u], [s * 6.3 * u, -63 * u], [s * 3.5 * u, -57 * u]], '#ffb3c8');
      }
      return;
    }
    case 'santa':
      poly(ctx, [[-12 * u, -56 * u], [12 * u, -56 * u], [4 * u, -74 * u], [-2 * u, -72 * u]], '#e63950');
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(-13 * u, -59 * u, 26 * u, 5 * u, 2.5 * u); ctx.fill(); circle(ctx, 4 * u, -75 * u, 3 * u, '#fff'); return;
    case 'witch':
      poly(ctx, [[-14 * u, -56 * u], [14 * u, -56 * u], [3 * u, -58 * u], [2 * u, -80 * u], [-3 * u, -58 * u]], '#6b3fb0');
      ctx.fillStyle = '#4a2a85'; ctx.fillRect(-9 * u, -62 * u, 18 * u, 2.4 * u); circle(ctx, 3 * u, -61 * u, 1.6 * u, gold); return;
    default: { // bow
      const bx = 9 * u, by = -57 * u;
      poly(ctx, [[bx, by], [bx + 7 * u, by - 4 * u], [bx + 7 * u, by + 4 * u]], a.accent); poly(ctx, [[bx, by], [bx - 7 * u, by - 4 * u], [bx - 7 * u, by + 4 * u]], a.accent); circle(ctx, bx, by, 2.2 * u, lighten(a.accent, 0.4));
    }
  }
}

/**
 * One character. a = look (color, accent, hair, hairColor, acc) + status; n = motion (x, y, phase, seed,
 * walking, seated, pose, lift). Poses are just for fun: dance, play, cheer, eat, sip, nap.
 */
export function drawAgent(ctx, v, a, n, now, sel) {
  const [fx, fy] = v.p(n.x, n.y);
  const u = Math.max(0.35, v.s) * 1.05;
  const walking = n.walking, seated = n.seated, pose = n.pose || null;
  const dark = a.status === 'dark', asleep = (a.status === 'bench' && !walking && !pose) || pose === 'nap';
  const beat = Math.sin(now / 130);
  let bob = walking ? Math.abs(Math.sin(n.phase * 9)) * 2.2 * u : seated ? 0 : Math.sin(now / 700 + n.seed) * 0.8 * u;
  if (pose === 'dance') bob = Math.abs(beat) * 4.5 * u;
  if (pose === 'cheer') bob = Math.abs(Math.sin(now / 150)) * 3.5 * u;
  const lift = (n.lift || 0) * u;
  ctx.save();
  ctx.translate(fx, fy + (seated ? 7 * u : 0) + (pose === 'nap' ? 8 * u : 0));
  if (dark) ctx.globalAlpha = 0.6;
  if (n.fade !== undefined) ctx.globalAlpha *= n.fade;
  ellipse(ctx, 0, 1 * u, 14 * u * (1 - Math.min(0.5, lift / (80 * u))), 5.5 * u, 'rgba(90,50,80,.18)');
  if (sel) { ctx.strokeStyle = '#ff5fa2'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 1 * u, 19 * u, 8 * u, 0, 0, 7); ctx.stroke(); }
  ctx.translate(0, -bob - lift);
  if (pose === 'dance') ctx.rotate(beat * 0.07);
  if (a.acc === 'wings') {
    const flap = 1 + Math.sin(now / 90) * 0.12;
    for (const s of [-1, 1]) { ctx.save(); ctx.translate(s * 7 * u, -26 * u); ctx.scale(flap, 1); ellipse(ctx, s * 9 * u, -4 * u, 11 * u, 17 * u, 'rgba(210,235,255,.75)', s * 0.5); ctx.restore(); }
  }
  hairBack(ctx, a.hair, u, a.hairColor);
  // legs + shoes
  const step = walking ? Math.sin(n.phase * 9) * 4 * u : pose === 'dance' ? beat * 3 * u : 0;
  for (const [sx, off] of [[-5, step], [5, -step]]) {
    ctx.beginPath(); ctx.roundRect((sx - 2.2) * u, -13 * u + Math.min(0, off) * 0.3, 4.4 * u, 12 * u, 2 * u); ctx.fillStyle = SKIN; ctx.fill();
    ellipse(ctx, sx * u + off * 0.4, -1 * u, 4.6 * u, 2.6 * u, a.accent);
  }
  // dress
  ctx.beginPath(); ctx.moveTo(-8 * u, -34 * u); ctx.lineTo(8 * u, -34 * u); ctx.lineTo(13 * u, -11 * u); ctx.quadraticCurveTo(0, -7 * u, -13 * u, -11 * u); ctx.closePath();
  ctx.fillStyle = a.color; ctx.fill(); ctx.strokeStyle = darken(a.color, 0.12); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = lighten(a.color, 0.55); ctx.fillRect(-8 * u, -34 * u, 16 * u, 3.2 * u);
  circle(ctx, 0, -25 * u, 1.8 * u, a.accent);
  // arms: [left y, right y] offsets from the shoulder line
  const typing = seated && a.status === 'working' ? Math.sin(now / 90) * 2.2 * u : 0;
  let armY = seated && a.status === 'working' ? -24 * u : -30 * u, l = typing, r = -typing;
  if (pose === 'dance') { armY = -38 * u; l = beat * 5 * u; r = -beat * 5 * u; }
  else if (pose === 'cheer') { armY = -40 * u; l = r = Math.sin(now / 150) * 2 * u; }
  else if (pose === 'play') { armY = -27 * u; l = Math.sin(now / 110) * 4 * u; r = -l; }
  else if (pose === 'eat' || pose === 'sip') { r = -9 * u + Math.sin(now / 250) * 2 * u; armY = -31 * u; }
  for (const side of [-1, 1]) {
    const off = side < 0 ? l : r;
    ctx.beginPath(); ctx.roundRect((side < 0 ? -12.5 : 8.2) * u, armY + off, 4.4 * u, 11 * u, 2.2 * u); ctx.fillStyle = a.color; ctx.fill();
    circle(ctx, (side < 0 ? -10.3 : 10.4) * u, armY + 11.5 * u + off, 2.6 * u, SKIN);
  }
  // head
  circle(ctx, 0, -46 * u, 12.5 * u, SKIN);
  if (a.hair !== 'curly') { ctx.beginPath(); ctx.ellipse(0, -50 * u, 13.2 * u, 9.5 * u, 0, Math.PI, 0); ctx.fillStyle = a.hairColor; ctx.fill(); }
  for (const dx of [-8.5, 0, 8.5]) circle(ctx, dx * u, -50.5 * u, 4.4 * u, a.hairColor);
  // face
  if (asleep) { ctx.strokeStyle = '#4a2c4a'; ctx.lineWidth = 1.6 * u; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 4.6 * u, -45 * u, 2 * u, 0.2, Math.PI - 0.2); ctx.stroke(); } }
  else {
    const blink = Math.sin(now / 1100 + n.seed * 3) > 0.985;
    const happy = pose === 'cheer' || pose === 'dance' || pose === 'eat';
    for (const s of [-1, 1]) {
      if (blink || happy) { ctx.strokeStyle = '#4a2c4a'; ctx.lineWidth = 1.5 * u; ctx.beginPath(); if (happy) ctx.arc(s * 4.6 * u, -44 * u, 2.2 * u, Math.PI * 1.1, Math.PI * 1.9); else { ctx.moveTo(s * 4.6 * u - 2 * u, -45 * u); ctx.lineTo(s * 4.6 * u + 2 * u, -45 * u); } ctx.stroke(); }
      else { ellipse(ctx, s * 4.6 * u, -45 * u, 1.9 * u, 2.6 * u, '#4a2c4a'); circle(ctx, s * 4.6 * u + 0.7 * u, -46 * u, 0.8 * u, '#fff'); }
    }
  }
  ellipse(ctx, -8.4 * u, -41 * u, 3 * u, 1.8 * u, pose ? 'rgba(255,100,150,.7)' : 'rgba(255,120,160,.5)'); ellipse(ctx, 8.4 * u, -41 * u, 3 * u, 1.8 * u, pose ? 'rgba(255,100,150,.7)' : 'rgba(255,120,160,.5)');
  ctx.strokeStyle = '#c0607e'; ctx.lineWidth = 1.2 * u; ctx.beginPath();
  if (pose === 'cheer' || pose === 'dance') ctx.arc(0, -42 * u, 3.4 * u, 0.1 * Math.PI, 0.9 * Math.PI);
  else if (a.status === 'asking' || a.status === 'blocked') ctx.arc(0, -39 * u, 1.5 * u, 0, 7);
  else ctx.arc(0, -41 * u, 2.4 * u, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  accessory(ctx, a.acc === 'wings' ? 'none' : a.acc || 'bow', u, a);
  if (pose === 'eat' || pose === 'sip') {   // the treat in her hand
    ctx.font = `${Math.round(11 * u)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pose === 'eat' ? '🍰' : '🧋', 12 * u, armY + 2 * u + r);
  }
  if (a.status === 'blocked') { ellipse(ctx, 15 * u, -52 * u, 2 * u, 3 * u, '#9ad6f2'); }
  ctx.restore();
  return { x: fx, y: fy - 62 * u * 0.9 - lift - bob, u };
}

export function drawBadge(ctx, x, y, u, icon, glow) {
  if (!icon) return;
  const r = Math.max(8, 9.5 * u);
  if (glow) { ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.fillStyle = glow; ctx.fill(); }
  circle(ctx, x, y, r, 'rgba(255,255,255,.95)');
  ctx.strokeStyle = 'rgba(180,120,160,.5)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.font = `${Math.round(r * 1.15)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  ctx.fillText(icon, x, y + 1);
}

export function drawNameTag(ctx, x, y, name, color) {
  ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(name).width + 14;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 8); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#4a2c4a'; ctx.fillText(name, x, y + 0.5);
}

export function drawBubble(ctx, x, y, text, bg = '#fff', fg = '#4a2c4a', maxW = 190) {
  ctx.font = `600 12px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const words = text.split(' '); const lines = []; let cur = '';
  for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = t; }
  lines.push(cur);
  const shown = lines.slice(0, 3); if (lines.length > 3) shown[2] = shown[2].replace(/.{0,2}$/, '…');
  const w = Math.min(maxW, Math.max(...shown.map((l) => ctx.measureText(l).width))) + 18, h = shown.length * 15 + 12;
  const bx = x - w / 2, by = y - h - 8;
  ctx.fillStyle = 'rgba(120,60,110,.15)'; ctx.beginPath(); ctx.roundRect(bx + 1, by + 3, w, h, 12); ctx.fill();
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(bx, by, w, h, 12); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 6, by + h - 1); ctx.lineTo(x, by + h + 7); ctx.lineTo(x + 6, by + h - 1); ctx.fill();
  ctx.fillStyle = fg; shown.forEach((l, i) => ctx.fillText(l, bx + 9, by + 17 + i * 15));
}

export function drawRoomLabels(ctx, v) {
  if (v.s < 0.36) return;                           // zoomed all the way out: the floor colours say it all
  const size = Math.max(7.5, Math.min(14, 12 * v.s * 1.4)), h = size + 9;
  ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const r of Object.values(ROOMS)) {
    const [x, y] = v.p((r.x0 + r.x1) / 2, r.y1 - 0.9);
    const label = (v.s < 0.7 ? r.label.replace(/^(The|Pink|Café) /, '') : r.label).toUpperCase();
    const w = ctx.measureText(label).width + size * 1.4;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.fill();
    ctx.strokeStyle = 'rgba(230,140,180,.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#9a4f7e'; ctx.fillText(label, x, y + 1);
  }
}

// The office cat: purely decorative, wanders the garden.
export function drawCat(ctx, v, c, now) {
  const [x, y] = v.p(c.x, c.y), s = v.s * 1.1, hop = c.moving ? Math.abs(Math.sin(now / 90)) * 2 * s : 0;
  ctx.save(); ctx.translate(x, y - hop);
  ellipse(ctx, 0, 1 * s, 9 * s, 3.5 * s, 'rgba(90,50,80,.15)');
  ellipse(ctx, 0, -6 * s, 8 * s, 6 * s, '#fff4ea'); circle(ctx, 8 * s * c.dir, -10 * s, 5.4 * s, '#fff4ea');
  poly(ctx, [[5 * s * c.dir, -14 * s], [6.5 * s * c.dir, -19 * s], [9 * s * c.dir, -14 * s]], '#ffb3a1'); poly(ctx, [[9 * s * c.dir, -14 * s], [11.5 * s * c.dir, -18 * s], [12.5 * s * c.dir, -12 * s]], '#ffb3a1');
  circle(ctx, 9.5 * s * c.dir, -10.5 * s, 0.9 * s, '#4a2c4a'); ellipse(ctx, -9 * s * c.dir, -8 * s, 2.2 * s, 6 * s, '#ffb3a1', 0.6 * c.dir);
  ctx.restore();
}
