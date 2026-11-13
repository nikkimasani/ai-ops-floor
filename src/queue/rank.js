// Turns a pile of assigned items into ONE ordered list with a plain-words reason, so the answer to
// "what do I do next?" is always the first card. Pure functions: no I/O.
const H = 3600000;
const PRIORITY_POINTS = { 1: 100, 2: 70, 3: 40, 4: 20 };

export function scoreItem(item, now = Date.now()) {
  const why = [];
  let score = PRIORITY_POINTS[item.priority] ?? 40;
  if (item.priority <= 2) why.push(`priority ${item.priority}`);
  const ageH = item.openedAt ? Math.max(0, (now - item.openedAt) / H) : 0;
  if (ageH >= 24) { score += Math.min(30, (ageH / 24) * 5); why.push(`open ${Math.round(ageH / 24)}d`); }
  const idleH = item.updatedAt ? Math.max(0, (now - item.updatedAt) / H) : 0;
  if (idleH >= 24 && item.state !== 'On hold') { score += Math.min(15, idleH / 24 * 3); why.push(`no update for ${Math.round(idleH / 24)}d`); }
  if (/^new$/i.test(item.state)) { score += 15; why.push('not started'); }
  if (/hold/i.test(item.state)) { score -= 40; why.push('on hold'); }
  return { score: Math.round(score), why: why.length ? why.join(' · ') : 'in progress' };
}

const isHold = (i) => /hold/i.test(i.state);

/** Items you can act on come first (highest score first, ties to the older item); anything parked on hold goes last. */
export function rankQueue(items, now = Date.now()) {
  return items.map((i) => ({ ...i, ...scoreItem(i, now) })).sort((a, b) => isHold(a) - isHold(b) || b.score - a.score || (a.openedAt ?? 0) - (b.openedAt ?? 0));
}

/** The one thing to do next: the top item that is not parked on hold. */
export const nextUp = (ranked) => ranked.find((i) => !isHold(i)) || ranked[0] || null;

/** Which items are new since the last look, and which have gone (resolved or reassigned). */
export function diffQueue(previousIds, items) {
  const now = new Set(items.map((i) => i.id));
  return { arrived: items.filter((i) => !previousIds.has(i.id)), gone: [...previousIds].filter((id) => !now.has(id)) };
}
