// Where the dashboard's data comes from: data/status.json, written by the probe job and polled here.
// Each poll is diffed against what the floor shows, and only the changes become office events, so
// characters walk, turn red or go dark exactly when a service actually changes.
import { Office } from './shared/state.js';
import { diffForFloor, isStale, rebaseDemo } from './shared/ops.js';
import { ROOMS } from './shared/layout.js';

const params = new URLSearchParams(location.search);
const POLL_MS = (Number(params.get('poll')) || 30) * 1000;
let demoShift = null;                                  // one constant per page load, so demo timestamps stay stable between polls
const DATA = params.get('data') || 'data';           // ?data=https://… lets a hosted page read a snapshot elsewhere

async function load() {
  const res = await fetch(`${DATA}/status.json?ts=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`status.json: HTTP ${res.status}`);
  const d = await res.json();
  if (d.demo) { demoShift ??= Date.now() - d.generatedAt; rebaseDemo(d, demoShift); }
  return d;
}

export async function connect(h) {
  const office = new Office({ empty: true });
  let current = new Map(), subscribed = false;

  const apply = (d) => {
    const stale = !d.demo && isStale(d.generatedAt, Date.now(), d.intervalMin);
    const labelByRoom = {};
    for (const c of Object.values(d.site?.categories || {})) { if (labelByRoom[c.room]) continue; labelByRoom[c.room] = c.label; if (ROOMS[c.room]) ROOMS[c.room].label = c.label; }   // first category names a shared room
    // Stale data must never read as "all healthy": every service drops to "unknown" until probes resume.
    const records = stale ? d.services.map((s) => ({ ...s, health: 'unknown', detail: 'data is stale: probes may have stopped' })) : d.services;
    const { events, next } = diffForFloor(current, records, labelByRoom);
    current = next;
    for (const ev of events) { try { office.emit(ev); } catch (err) { console.warn('skipped event', ev.type, err.message); } }
    h.onMeta?.({ data: d, stale, fetchedAt: Date.now(), error: null });
  };

  let first;
  try { first = await load(); } catch (err) {
    h.onSnapshot({ agents: [], tasks: [], walkins: [], mode: 'ops' });
    h.onMeta?.({ data: null, stale: true, fetchedAt: Date.now(), error: err.message });
    first = null;
  }
  if (first) { apply(first); h.onSnapshot({ ...office.snapshot(), mode: 'ops' }); }
  office.subscribe((ev) => h.onEvent(ev)); subscribed = true;

  const tick = async () => {
    try { apply(await load()); }
    catch (err) { h.onMeta?.({ data: null, stale: true, fetchedAt: Date.now(), error: err.message, keepLast: true }); }
  };
  setInterval(tick, POLL_MS);
  if (!first) tick();                                   // first load failed: retry quickly instead of waiting a full interval

  return {
    mode: 'ops',
    act: async (agent, action) => (action === 'ack' ? {} : { error: 'view-only: this board only reads data' }),
    walkin: async () => ({ error: 'view-only' }),
    dispatch: async () => ({ error: 'view-only' }),
    refresh: tick,
  };
}
