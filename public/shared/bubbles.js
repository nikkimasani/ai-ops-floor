// Which characters get a text bubble. Pure, so it is tested.
//
// "calm" (the default): at most ONE problem bubble, for the most urgent problem (down, then failing,
// then the rest; oldest first), plus the character you tapped. No response-time bubbles, no idle chatter.
// "all": the busy view (every problem when zoomed in, response times on healthy services, chatter).
const ATTN = ['dark', 'blocked', 'asking', 'ready'];
const URGENCY = { dark: 0, blocked: 1, asking: 2, ready: 3 };

export const isAttention = (a) => ATTN.includes(a?.status);

/**
 * @param agents   array of { id, status, since }
 * @param opts     { mode: 'calm' | 'all', selected, zoomedIn (view scale > 0.85), closeUp (> 0.75), fun }
 * @returns { problems: Set<id>, latency: boolean, chatter: boolean }
 */
export function chooseBubbles(agents, { mode = 'calm', selected = null, zoomedIn = false, fun = false } = {}) {
  const waiting = agents.filter(isAttention).sort((p, q) => (URGENCY[p.status] - URGENCY[q.status]) || ((p.since || 0) - (q.since || 0)));
  if (mode === 'all') {
    return { problems: new Set((zoomedIn ? waiting : waiting.slice(0, 3)).map((a) => a.id)), latency: true, chatter: true };
  }
  const problems = new Set(waiting.slice(0, 1).map((a) => a.id));
  if (selected) problems.add(selected);
  return { problems, latency: false, chatter: fun };
}
