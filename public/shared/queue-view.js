// Pure helpers for the My Queue view, kept out of the DOM code so they can be tested.
const RECENT_MS = 10 * 60000, DONE_STAY_MS = 60000;

/** Should the panel be hidden after this action? `open` undefined = toggle; true = open it; false = close it. */
export const nextHidden = (hidden, open) => (open === undefined ? !hidden : !open);

/**
 * Floor characters for the items that currently have a triage agent. `health` is mapped onto the floor's existing looks
 * (degraded = thinking, healthy = working, failing = blocked, maintenance = on a break).
 * Agents are SEATLESS: they never take a desk, so they can never push a monitored service off the floor.
 */
export function triageRecords(items, now = Date.now()) {
  const out = [];
  for (const i of items || []) {
    const t = i.triage || { state: 'none' };
    let health, detail, since;
    if (t.state === 'running') { health = 'healthy'; detail = `triaging ${i.ref}…`; since = t.startedAt; }
    else if (t.state === 'queued') { health = 'degraded'; detail = `${i.ref}: waiting for a free triage slot`; since = t.startedAt; }
    else if (t.state === 'failed') { health = 'failing'; detail = `triage of ${i.ref} failed: ${t.error || 'see the panel'}`; since = t.endedAt || t.startedAt; }
    else if (t.state === 'done' && t.endedAt && now - t.endedAt < DONE_STAY_MS) { health = 'maintenance'; detail = `triage ready for ${i.ref}`; since = t.endedAt; }
    else if (t.state === 'none' && i.arrivedAt && now - i.arrivedAt < RECENT_MS) { health = 'degraded'; detail = `${i.ref} assigned: ready to triage`; since = i.arrivedAt; }
    else continue;
    out.push({ id: `tri:${i.id}`, name: `Triage ${i.ref}`, category: 'triage', room: 'review', owner: 'Triage agent', tier: i.priority <= 2 ? 1 : 2, onFloor: true, seatless: true, health, detail, since: since || now, lastCheck: now, latencyMs: null, uptime24h: null, uptime7d: null });
  }
  return out;
}
