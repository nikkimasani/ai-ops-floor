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

let lastAcks = {};
async function loadAcks() {                                           // optional: only exists when site.sharedAcks is on
  try { const r = await fetch(`${DATA}/acks.json?ts=${Date.now()}`, { cache: 'no-store' }); if (r.ok) lastAcks = await r.json(); else if (r.status === 404) lastAcks = {}; } catch { /* keep last */ }
  return lastAcks;
}

async function load() {
  const res = await fetch(`${DATA}/status.json?ts=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`status.json: HTTP ${res.status}`);
  const d = await res.json();
  if (d.site?.sharedAcks) await loadAcks(); else lastAcks = {};
  if (d.demo) { demoShift ??= Date.now() - d.generatedAt; rebaseDemo(d, demoShift); }
  return d;
}

export async function connect(h) {
  let office = new Office({ empty: true }), unsub = null;
  let current = new Map(), subscribed = false, floor = h.floor || 1, lastData = null;

  // Hand the page a fresh office for the current floor as a navigation snapshot (instant, no walking, no synthetic feed entries).
  const resetOffice = () => { unsub?.(); office = new Office({ empty: true }); current = new Map(); unsub = null; };
  const listen = () => { unsub?.(); unsub = office.subscribe((ev) => h.onEvent(ev)); };   // idempotent: never two subscriptions, whatever order things happen in
  const publish = () => { h.onSnapshot({ ...office.snapshot(), mode: 'ops' }, { navigation: true }); listen(); };

  const apply = (d) => {
    lastData = d;
    const clamped = Math.min(Math.max(1, floor), d.site?.floors || 1);   // a floor that no longer exists falls back to the nearest one
    const swapped = clamped !== floor;
    if (swapped) { floor = clamped; resetOffice(); }           // fresh office: the old floor's occupants would block the new floor's desks
    const stale = !d.demo && isStale(d.generatedAt, Date.now(), d.intervalMin);
    const labelByRoom = {};
    for (const c of Object.values(d.site?.categories || {})) { if (labelByRoom[c.room]) continue; labelByRoom[c.room] = c.label; if (ROOMS[c.room]) ROOMS[c.room].label = c.label; }   // first category names a shared room
    // Stale data must never read as "all healthy": every service drops to "unknown" until probes resume.
    const services = stale ? d.services.map((s) => ({ ...s, health: 'unknown', detail: 'data is stale: probes may have stopped' })) : d.services;
    const local = (h.extraRecords?.() || []).map((r) => ({ ...r, floor }));   // My Queue's triage agents (local mode only): shown on whichever floor you are viewing
    const records = [...services, ...local];
    const { events, next } = diffForFloor(current, records, labelByRoom, floor);
    current = next;
    for (const ev of events) { try { office.emit(ev); } catch (err) { console.warn('skipped event', ev.type, err.message); } }
    if (swapped && subscribed) publish();                                // before the first snapshot, connect() publishes it itself
    h.onMeta?.({ data: d, stale, fetchedAt: Date.now(), error: null, acks: lastAcks });
  };

  let first;
  try { first = await load(); } catch (err) {
    h.onSnapshot({ agents: [], tasks: [], walkins: [], mode: 'ops' });
    h.onMeta?.({ data: null, stale: true, fetchedAt: Date.now(), error: err.message });
    first = null;
  }
  if (first) { apply(first); h.onSnapshot({ ...office.snapshot(), mode: 'ops' }); }
  listen(); subscribed = true;

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
    reapply: () => { if (lastData) apply(lastData); },          // re-evaluate the floor without refetching (My Queue calls this when its agents change)
    floor: () => floor,
    // Swap floors without refetching: a fresh office for the new floor, handed to the page as a snapshot (instant, no walking and no feed noise).
    setFloor: (n) => {
      floor = n;
      if (!lastData) return floor;
      resetOffice();
      apply(lastData);
      publish();
      return floor;
    },
  };
}
