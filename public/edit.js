// "Edit Office": pick a card, tap the floor to place it, tap a piece to rotate / move / remove it.
// Layout lives in this browser (localStorage). Placement rules are in shared/placement.js.

import { CATALOG, CATALOG_ORDER, dims } from './shared/catalog.js';
import { canPlace, centredOn, rectOf } from './shared/placement.js';
import { DEFAULT_PLACED } from './shared/layout.js';
import { drawPlaced, isFlat } from './furniture.js';
import { poly, ZU } from './render.js';
import { store } from './store.js';

let C, items = [], editing = false, brush = null, brushRot = 0, selected = null, moving = false, ghost = null;
const undo = [];
const $ = (id) => document.getElementById(id);
const uid = () => 'p' + Math.random().toString(36).slice(2, 8);

export const placed = () => items;
export const isEditing = () => editing;

function load() {
  const saved = store.get('layout', null);
  const src = Array.isArray(saved) ? saved : DEFAULT_PLACED;
  const out = [];
  for (const raw of src) {   // drop anything that no longer fits the floor plan
    const it = { uid: String(raw.uid || uid()), id: raw.id, x: Number(raw.x), y: Number(raw.y), rot: ((raw.rot | 0) % 4 + 4) % 4 };
    if (CATALOG[it.id] && Number.isFinite(it.x) && Number.isFinite(it.y) && canPlace(it, out).ok) out.push(it);
  }
  return out;
}

function commit(record = true) {
  store.set('layout', items);
  C.fun?.onLayoutChanged?.();
}
function remember() { undo.push(JSON.stringify(items)); if (undo.length > 25) undo.shift(); }

export function initEdit(c) {
  C = c;
  items = load();
  $('editDone').onclick = () => setEditing(false);
  $('editUndo').onclick = () => { if (!undo.length) return C.h.toast('Nothing to undo'); items = JSON.parse(undo.pop()); selected = null; commit(); refresh(); };
  $('editReset').onclick = () => { if (!confirm('Reset the office to its starting layout?')) return; remember(); items = DEFAULT_PLACED.map((i) => ({ ...i })); selected = null; commit(); refresh(); };
  $('actRotate').onclick = rotate;
  $('actMove').onclick = () => { if (!selected) return; moving = true; C.h.toast('Tap where it should go'); refresh(); };
  $('actRemove').onclick = remove;
  $('editCards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-brush]'); if (!b) return;
    brush = brush === b.dataset.brush ? null : b.dataset.brush; brushRot = 0; selected = null; moving = false; ghost = null; refresh();
  });
  buildCards();
}

function buildCards() {
  $('editCards').innerHTML = CATALOG_ORDER.map((id) => {
    const c = CATALOG[id], tag = c.kind === 'pair' ? '2 players' : c.kind === 'solo' ? 'play' : 'decor';
    return `<button class="icard" data-brush="${id}"><span class="ie">${c.emoji}</span><b>${c.name}</b><small>${tag}</small></button>`;
  }).join('');
}

export function setEditing(on, withBrush) {
  editing = on;
  if (!on) { brush = null; selected = null; moving = false; ghost = null; }
  if (withBrush) { brush = withBrush; brushRot = 0; }
  $('editTray').hidden = !on;
  document.body.classList.toggle('editing', on);
  if (on) C.h.toast('Pick a card, then tap the floor');
  refresh();
}
export const startEditing = (brushId) => setEditing(true, brushId);

function refresh() {
  document.querySelectorAll('#editCards .icard').forEach((b) => b.classList.toggle('on', b.dataset.brush === brush));
  const sel = items.find((i) => i.uid === selected);
  $('editActions').hidden = !sel;
  $('editHint').textContent = moving ? 'Tap where it should go.' : sel ? `${CATALOG[sel.id].name} selected` : brush ? `Tap the floor to place: ${CATALOG[brush].name}` : 'Pick a card to place, or tap a piece to change it.';
  $('actMove').classList.toggle('on', moving);
}

function rotate() {
  const it = items.find((i) => i.uid === selected);
  if (!it && brush) { brushRot = (brushRot + 1) % 4; return C.h.toast('Rotated'); }
  if (!it) return;
  const [w, d] = dims(it), cx = it.x + w / 2, cy = it.y + d / 2;
  const next = centredOn({ ...it, rot: (it.rot + 1) % 4 }, cx, cy), res = canPlace(next, items, it.uid);
  if (!res.ok) return C.h.toast(`Can’t rotate: ${res.reason.toLowerCase()}`);
  remember(); Object.assign(it, next); commit();
}
function remove() {
  const i = items.findIndex((x) => x.uid === selected); if (i < 0) return;
  remember(); items.splice(i, 1); selected = null; moving = false; commit(); refresh(); C.h.toast('Removed (Undo brings it back)');
}

// Which placed piece is under the finger? Test a few heights so tapping the top of tall things works.
function hitTest(sx, sy) {
  const v = C.view;
  let best = null;
  for (const z of [0, 0.5, 1.1]) {
    const [x, y] = v.inv(sx, sy + z * ZU * v.s);
    for (const it of items) {
      const r = rectOf(it);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d && (!best || r.x + r.y > best.k)) best = { it, k: r.x + r.y };
    }
    if (best) break;
  }
  return best?.it || null;
}

/** Called for every tap on the floor. Returns true if edit mode used it. */
export function onTap(sx, sy) {
  if (!editing) return false;
  const [x, y] = C.view.inv(sx, sy);
  if (moving && selected) {
    const it = items.find((i) => i.uid === selected), next = centredOn(it, x, y), res = canPlace(next, items, it.uid);
    if (!res.ok) { C.h.toast(res.reason); return true; }
    remember(); Object.assign(it, next); moving = false; commit(); refresh(); return true;
  }
  if (brush) {
    const next = centredOn({ uid: uid(), id: brush, rot: brushRot }, x, y), res = canPlace(next, items);
    if (!res.ok) { C.h.toast(res.reason); return true; }
    remember(); items.push(next); commit(); C.fx?.sparkle?.(next);
    return true;
  }
  const hit = hitTest(sx, sy);
  selected = hit ? hit.uid : null; refresh();
  return true;
}

export function onHover(sx, sy) {
  if (!editing || !brush) { ghost = null; return; }
  const [x, y] = C.view.inv(sx, sy), g = centredOn({ uid: '_', id: brush, rot: brushRot }, x, y);
  ghost = { item: g, ok: canPlace(g, items).ok };
}

/** Depth-sorted scene entries for the placed furniture. fxFor(uid) -> { t, users }. */
export function sceneItems(v, fxFor) {
  return items.map((it) => {
    const r = rectOf(it);
    return { key: (isFlat(it.id) ? -1000 : 0) + r.x + r.w / 2 + r.y + r.d / 2, draw: (ctx) => drawPlaced(ctx, v, it, fxFor(it.uid)) };
  });
}

const diamond = (ctx, v, r, fill, stroke, lw = 2) => {
  poly(ctx, [v.p(r.x, r.y), v.p(r.x + r.w, r.y), v.p(r.x + r.w, r.y + r.d), v.p(r.x, r.y + r.d)], fill, null);
  ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
};

export function overlay(ctx, v, t) {
  if (!editing) return;
  if (ghost) diamond(ctx, v, rectOf(ghost.item), ghost.ok ? 'rgba(111,208,174,.4)' : 'rgba(240,100,122,.4)', ghost.ok ? '#3fbf94' : '#f0647a');
  const sel = items.find((i) => i.uid === selected);
  if (sel) diamond(ctx, v, rectOf(sel), moving ? 'rgba(255,224,138,.35)' : 'rgba(255,111,168,.18)', '#ff5fa2', 2.5 + Math.sin(t / 200));
}
