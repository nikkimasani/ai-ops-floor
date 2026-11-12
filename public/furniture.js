// Drawing for the placeable catalog items. Everything is built from the same few shapes as the
// scenery: boxes, circles, polygons. `fx` = { t: ms, users: how many agents are using it right now }.

import { box, circle, ellipse, poly, lighten, darken, TW, TH } from './render.js';
import { dims } from './shared/catalog.js';

const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';

// A flat quad on the floor-plane facing up at height z.
const floorQuad = (ctx, v, x, y, w, d, z, fill, stroke) => poly(ctx, [v.p(x, y, z), v.p(x + w, y, z), v.p(x + w, y + d, z), v.p(x, y + d, z)], fill, stroke);
// A rectangle on the camera-facing "front" (y + d) wall of a box: u0..u1 across (0..1), z0..z1 up.
const frontRect = (ctx, v, it, w, d, u0, u1, z0, z1, fill) => poly(ctx, [v.p(it.x + w * u0, it.y + d, z1), v.p(it.x + w * u1, it.y + d, z1), v.p(it.x + w * u1, it.y + d, z0), v.p(it.x + w * u0, it.y + d, z0)], fill);

const DRAW = {
  pingpong(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 0.55, '#7ad6c8');
    const long = w >= d;
    const a = long ? [it.x + w / 2, it.y] : [it.x, it.y + d / 2], b = long ? [it.x + w / 2, it.y + d] : [it.x + w, it.y + d / 2];
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2 * v.s; ctx.beginPath(); ctx.moveTo(...v.p(a[0], a[1], 0.58)); ctx.lineTo(...v.p(b[0], b[1], 0.58)); ctx.stroke();
    if (long) box(ctx, v, it.x + w / 2 - 0.02, it.y, 0.04, d, 0.22, '#fff', 0.55); else box(ctx, v, it.x, it.y + d / 2 - 0.02, w, 0.04, 0.22, '#fff', 0.55);
    if (fx.users >= 2) {    // the rally
      const k = (Math.sin(fx.t / 260) + 1) / 2, ax = long ? it.x + 0.2 + (w - 0.4) * k : it.x + d / 2, ay = long ? it.y + d / 2 : it.y + 0.2 + (d - 0.4) * k;
      const z = 0.65 + Math.abs(Math.sin(fx.t / 130)) * 0.45;
      const [bx, by] = v.p(ax, ay, z); circle(ctx, bx, by, 3 * v.s + 1, '#fff'); circle(ctx, bx, by, 1.6 * v.s, '#ffd95a');
    }
  },
  pool(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 0.55, '#c98a6b');
    floorQuad(ctx, v, it.x + 0.15, it.y + 0.15, w - 0.3, d - 0.3, 0.56, '#ff9ec4');
    [['#fff', 0.3, 0.3], ['#7ad6c8', 0.45, 0.62], ['#ffd95a', 0.58, 0.45], ['#b9a2ee', 0.7, 0.7], ['#4a2c4a', 0.8, 0.35]].forEach(([c, fu, fv]) => {
      const [x, y] = v.p(it.x + w * fu, it.y + d * fv, 0.6); circle(ctx, x, y, 2.4 * v.s + 0.5, c);
    });
    if (fx.users) { const [x, y] = v.p(it.x + w * 0.2, it.y + d / 2, 0.7); ctx.strokeStyle = '#f2cfae'; ctx.lineWidth = 2 * v.s; ctx.beginPath(); ctx.moveTo(x - 14 * v.s, y - 6 * v.s); ctx.lineTo(x + 3 * v.s, y + Math.sin(fx.t / 120) * 2 * v.s); ctx.stroke(); }
  },
  foosball(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 0.55, '#ffb3d1');
    floorQuad(ctx, v, it.x + 0.12, it.y + 0.12, w - 0.24, d - 0.24, 0.56, '#9fe3b5');
    for (let i = 1; i <= 3; i++) {
      const sh = fx.users ? Math.sin(fx.t / 140 + i) * 0.12 : 0, x = it.x + (w * i) / 4;
      ctx.strokeStyle = '#8a8fb5'; ctx.lineWidth = 1.6 * v.s; ctx.beginPath(); ctx.moveTo(...v.p(x, it.y - 0.2, 0.75)); ctx.lineTo(...v.p(x, it.y + d + 0.2, 0.75)); ctx.stroke();
      const [px, py] = v.p(x, it.y + d / 2 + sh, 0.78); circle(ctx, px, py, 3 * v.s + 0.5, i % 2 ? '#e63950' : '#4cb5e6');
    }
  },
  arcade(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 1.5, '#9b7bea');
    box(ctx, v, it.x - 0.05, it.y + d * 0.5, w + 0.1, d * 0.5 + 0.06, 0.12, '#7a5cc7', 0.78);   // control deck
    const on = fx.users ? 0.6 + 0.4 * Math.sin(fx.t / 120) : 0.85;
    frontRect(ctx, v, it, w, d, 0.15, 0.85, 0.95, 1.38, `rgba(120,255,235,${on})`);
    frontRect(ctx, v, it, w, d, 0.1, 0.9, 1.4, 1.5, '#ff6fa8');
    const [jx, jy] = v.p(it.x + w * 0.35, it.y + d * 0.75, 0.95); circle(ctx, jx, jy, 2.2 * v.s + 0.5, '#e63950');
  },
  pinball(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 0.85, '#ff86b6');
    box(ctx, v, it.x - 0.04, it.y, w + 0.08, d * 0.25, 1.35, '#b9a2ee');
    floorQuad(ctx, v, it.x + 0.1, it.y + d * 0.28, w - 0.2, d * 0.68, 0.87, '#2c2250');
    for (let i = 0; i < 5; i++) {
      const lit = fx.users && Math.sin(fx.t / 140 + i * 1.7) > 0, [x, y] = v.p(it.x + w * (0.25 + (i % 3) * 0.25), it.y + d * (0.4 + (i % 2) * 0.22), 0.9);
      circle(ctx, x, y, 2.6 * v.s + 0.5, lit ? '#ffe58a' : '#7a6aa8');
    }
  },
  jukebox(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 1.25, '#ff9ec4');
    const [cx, cy] = v.p(it.x + w / 2, it.y + d, 1.25), r = (w * TW) / 3.1 * v.s;
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.15, r, Math.PI, 0); ctx.fillStyle = '#ff7fb0'; ctx.fill();
    const glow = fx.users ? 0.5 + 0.5 * Math.sin(fx.t / 100) : 0.25;
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.15, r * 0.7, Math.PI, 0); ctx.fillStyle = `rgba(255,236,150,${0.45 + glow * 0.5})`; ctx.fill();
    frontRect(ctx, v, it, w, d, 0.2, 0.8, 0.35, 0.7, '#ffe58a');
    frontRect(ctx, v, it, w, d, 0.3, 0.7, 0.2, 0.28, '#b9a2ee');
  },
  dancepad(ctx, v, it, w, d, fx) {
    const n = 4, cw = w / n, cd = d / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const phase = fx.users ? (Math.sin(fx.t / 180 + (i + j) * 0.9) + 1) / 2 : 0.2 + ((i + j) % 2) * 0.1;
      const hue = ['#ff9ec4', '#b9a2ee', '#7ad6c8', '#ffd95a'][(i + j) % 4];
      floorQuad(ctx, v, it.x + i * cw, it.y + j * cd, cw, cd, 0.02, lighten(hue, 0.35 - phase * 0.3 + 0.1), 'rgba(255,255,255,.55)');
    }
  },
  console(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 0.4, '#f2cfae');                         // low media bench
    box(ctx, v, it.x + w * 0.2, it.y + d * 0.2, w * 0.6, 0.1, 0.8, '#2c2250', 0.4);   // TV
    frontRect(ctx, v, { x: it.x, y: it.y - d * 0.0 }, w, d * 0.3, 0.24, 0.76, 0.46, 1.1, fx.users ? `hsl(${(fx.t / 8) % 360},85%,78%)` : '#8fd4f0');
    box(ctx, v, it.x + w * 0.65, it.y + d * 0.55, 0.3, 0.2, 0.08, '#ffffff', 0.4);
  },
  beanbag(ctx, v, it, w, d, fx) {
    const [x, y] = v.p(it.x + w / 2, it.y + d / 2, 0.15), r = w * TW * 0.34 * v.s;
    ellipse(ctx, x, y + r * 0.45, r * 1.05, r * 0.5, 'rgba(90,50,80,.15)');
    ellipse(ctx, x, y, r, r * 0.8, '#ffb3d1'); ellipse(ctx, x - r * 0.25, y - r * 0.25, r * 0.55, r * 0.4, '#ffd1e3');
  },
  sofa(ctx, v, it, w, d) {
    box(ctx, v, it.x, it.y, w, d, 0.45, '#ff9ec4');
    box(ctx, v, it.x, it.y - 0.02, w, Math.min(0.3, d * 0.3), 0.95, '#ff86b6');
    box(ctx, v, it.x - 0.12, it.y, 0.14, d, 0.7, '#ff86b6'); box(ctx, v, it.x + w - 0.02, it.y, 0.14, d, 0.7, '#ff86b6');
    const n = Math.max(2, Math.round(w / 1.1));
    for (let i = 0; i < n; i++) box(ctx, v, it.x + 0.1 + (i * (w - 0.2)) / n, it.y + 0.3, (w - 0.2) / n - 0.04, d - 0.35, 0.12, '#ffc2da', 0.45);
  },
  bubbletea(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 0.7, '#ffd9a8');
    box(ctx, v, it.x + 0.05, it.y + 0.05, w - 0.1, d * 0.4, 0.06, '#ff9ec4', 0.7);
    for (let i = 0; i < 3; i++) {
      const [x, y] = v.p(it.x + w * (0.25 + i * 0.25), it.y + d * 0.4, 0.78);
      ctx.fillStyle = ['#f5d7e8', '#d9f2e6', '#e6dcff'][i]; ctx.beginPath(); ctx.roundRect(x - 3 * v.s - 0.5, y - 9 * v.s, 6 * v.s + 1, 9 * v.s, 2); ctx.fill();
      circle(ctx, x, y - 1.4 * v.s, 1.6 * v.s, '#6b4a3e');
    }
    for (const side of [0.08, 0.92]) box(ctx, v, it.x + w * side - 0.04, it.y + 0.04, 0.08, 0.08, 1.15, '#d9c3a8', 0.7);
    const stripes = 6;
    for (let i = 0; i < stripes; i++) poly(ctx, [v.p(it.x + (w * i) / stripes, it.y, 1.35), v.p(it.x + (w * (i + 1)) / stripes, it.y, 1.35), v.p(it.x + (w * (i + 1)) / stripes, it.y + d, 1.15), v.p(it.x + (w * i) / stripes, it.y + d, 1.15)], i % 2 ? '#fff' : '#ff9ec4');
  },
  photobooth(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x, it.y, w, d, 1.5, '#b9a2ee');
    frontRect(ctx, v, it, w, d, 0.12, 0.88, 0.1, 1.15, fx.users && Math.sin(fx.t / 90) > 0.6 ? '#fff6c4' : '#ff9ec4');
    frontRect(ctx, v, it, w, d, 0.1, 0.9, 1.2, 1.42, '#ffe58a');
  },
  rug(ctx, v, it, w, d) {
    floorQuad(ctx, v, it.x, it.y, w, d, 0.015, '#ffc6dc', '#fff');
    floorQuad(ctx, v, it.x + 0.25, it.y + 0.25, w - 0.5, d - 0.5, 0.02, '#ffe0ee');
    floorQuad(ctx, v, it.x + 0.55, it.y + 0.55, w - 1.1, d - 1.1, 0.025, '#ffb3d1');
  },
  plant(ctx, v, it, w, d) {
    box(ctx, v, it.x + w * 0.2, it.y + d * 0.2, w * 0.6, d * 0.6, 0.35, '#ffd1e3');
    const [x, y] = v.p(it.x + w / 2, it.y + d / 2, 0.35);
    for (const [dx, dy, r, c] of [[0, -9, 11, '#8fd9a0'], [-9, -4, 8, '#7fcf93'], [9, -4, 8, '#9be0ab']]) circle(ctx, x + dx * v.s, y + dy * v.s, r * v.s, c);
  },
  lamp(ctx, v, it, w, d, fx) {
    box(ctx, v, it.x + w / 2 - 0.05, it.y + d / 2 - 0.05, 0.1, 0.1, 1.3, '#d9c3a8');
    const [x, y] = v.p(it.x + w / 2, it.y + d / 2, 1.35);
    ellipse(ctx, x, y, 24 * v.s, 20 * v.s, 'rgba(255,224,150,.28)'); circle(ctx, x, y, 10 * v.s, '#ffe08a'); circle(ctx, x - 3 * v.s, y - 3 * v.s, 3.5 * v.s, '#fff6cf');
  },
  flowers(ctx, v, it, w, d) {
    for (const x of [it.x + 0.1, it.x + w - 0.1]) box(ctx, v, x - 0.06, it.y, 0.12, d, 1.5, '#f2cfae');
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const t = i / n, [x, y] = v.p(it.x + 0.1 + (w - 0.2) * t, it.y + d / 2, 1.5 + Math.sin(t * Math.PI) * 0.45);
      circle(ctx, x, y, 5 * v.s + 0.5, ['#ff9ec4', '#fff', '#ffd95a', '#c9b6f2'][i % 4]); circle(ctx, x, y, 2 * v.s, '#ffe08a');
    }
  },
  balloons(ctx, v, it, w, d, fx) {
    const [bx, by] = v.p(it.x + w / 2, it.y + d / 2, 0.05);
    [['#ff9ec4', -9, 0], ['#b9a2ee', 4, 1.2], ['#7ad6c8', 11, 2.1]].forEach(([c, dx, ph]) => {
      const sway = Math.sin(fx.t / 900 + ph) * 3 * v.s, hx = bx + dx * v.s + sway, hy = by - 52 * v.s - Math.sin(fx.t / 700 + ph) * 2 * v.s;
      ctx.strokeStyle = '#c9b6c9'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy + 9 * v.s); ctx.stroke();
      ellipse(ctx, hx, hy, 8 * v.s, 10 * v.s, c); ellipse(ctx, hx - 2.5 * v.s, hy - 3.5 * v.s, 2.3 * v.s, 3.4 * v.s, 'rgba(255,255,255,.6)');
    });
  },
  cattower(ctx, v, it, w, d) {
    box(ctx, v, it.x + 0.1, it.y + 0.1, w - 0.2, d - 0.2, 0.4, '#f2cfae');
    box(ctx, v, it.x + 0.28, it.y + 0.28, w - 0.56, d - 0.56, 0.45, '#ffd9a8', 0.4);
    box(ctx, v, it.x + 0.4, it.y + 0.4, w - 0.8, d - 0.8, 0.4, '#f2cfae', 0.85);
    const [x, y] = v.p(it.x + w / 2, it.y + d / 2, 1.28);
    ellipse(ctx, x, y - 3 * v.s, 8 * v.s, 6 * v.s, '#fff4ea'); circle(ctx, x + 5 * v.s, y - 9 * v.s, 4.5 * v.s, '#fff4ea');
    poly(ctx, [[x + 2.5 * v.s, y - 12 * v.s], [x + 3.4 * v.s, y - 17 * v.s], [x + 6 * v.s, y - 12.5 * v.s]], '#ffb3a1');
  },
};

export function drawPlaced(ctx, v, it, fx = { t: 0, users: 0 }) {
  const fn = DRAW[it.id];
  if (!fn) return;
  const [w, d] = dims(it);
  fn(ctx, v, it, w, d, fx);
}

// Flat items (rugs, dance floors) sit under everything else on the floor.
export const isFlat = (id) => id === 'rug' || id === 'dancepad';

// A little emoji icon for the card tray / preview.
export { FONT };
