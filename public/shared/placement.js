// Where furniture may go. Pure functions over the floor plan, shared by the editor and the tests.

import { GRID, ROOMS, SEATS, FURNITURE, CORRIDOR_Y } from './layout.js';
import { CATALOG, dims } from './catalog.js';

export const SNAP = 0.5;
export const snap = (v) => Math.round(v / SNAP) * SNAP;

export const rectOf = (item) => { const [w, d] = dims(item); return { x: item.x, y: item.y, w, d }; };
const hit = (a, b, pad = 0) => a.x < b.x + b.w - pad && a.x + a.w > b.x + pad && a.y < b.y + b.d - pad && a.y + a.d > b.y + pad;
const inside = (a, r) => a.x >= r.x0 - 1e-6 && a.y >= r.y0 - 1e-6 && a.x + a.w <= r.x1 + 1e-6 && a.y + a.d <= r.y1 + 1e-6;

// Scenery, desks, chairs and the walkways agents use to get to the corridor are off limits.
export const BLOCKED = (() => {
  const out = [];
  for (const f of FURNITURE) {
    if (f.k === 'box') out.push({ x: f.x, y: f.y, w: f.w, d: f.d });
    else if (f.k === 'pond') out.push({ x: f.x, y: f.y, w: f.w, d: f.d });
    else if (f.k === 'tree') out.push({ x: f.x - 0.9, y: f.y - 0.9, w: 1.8, d: 1.8 });
    else if (['bush', 'lamp', 'flowers'].includes(f.k)) out.push({ x: f.x - 0.5, y: f.y - 0.5, w: 1, d: 1 });
  }
  for (const s of SEATS) {
    out.push({ x: s.x - 0.9, y: s.y - 0.9, w: 1.8, d: 1.8 });
    if (s.desk) out.push({ x: s.desk.x - 0.1, y: s.desk.y - 0.1, w: 2.2, d: 1.2 });
    if (s.aisle !== undefined) out.push({ x: s.aisle - 0.5, y: Math.min(s.y, CORRIDOR_Y) - 0.5, w: 1, d: CORRIDOR_Y - s.y + 0.5 });
  }
  out.push({ x: 0, y: CORRIDOR_Y - 1.2, w: 2.4, d: 2.4 });   // front door mat
  return out;
})();

/** { ok, reason } — may `item` sit where it is, given the other placed items? */
export function canPlace(item, items, ignoreUid) {
  if (!CATALOG[item.id]) return { ok: false, reason: 'Unknown item' };
  const r = rectOf(item);
  if (r.x < 0 || r.y < 0 || r.x + r.w > GRID.w || r.y + r.d > GRID.d) return { ok: false, reason: 'Off the floor' };
  if (!Object.values(ROOMS).some((room) => inside(r, room))) return { ok: false, reason: 'Keep it inside one room' };
  if (BLOCKED.some((b) => hit(r, b, 0.1))) return { ok: false, reason: 'Something is already there' };
  for (const o of items) if (o.uid !== ignoreUid && hit(r, rectOf(o), 0.05)) return { ok: false, reason: 'Overlaps another item' };
  return { ok: true };
}

/** Item with its top-left chosen so its centre lands on (x, y), snapped to the half-tile grid. */
export function centredOn(item, x, y) {
  const [w, d] = dims(item);
  return { ...item, x: snap(x - w / 2), y: snap(y - d / 2) };
}

export const roomAt = (x, y) => Object.keys(ROOMS).find((k) => { const r = ROOMS[k]; return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1; }) || null;
