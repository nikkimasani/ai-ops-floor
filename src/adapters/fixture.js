// Deterministic fake results, so the whole pipeline (and the demo dashboard) works with no real systems.
// scenario: steady | slow | slowish | flaky | outage-now | recovered
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const steady = (r) => ({ ok: true, ms: 80 + r() * 120 });

export const SCENARIOS = {
  steady,
  slow: (r) => ({ ok: true, ms: 1700 + r() * 900 }),
  slowish: (r) => ({ ok: true, ms: 700 + r() * 1400 }),
  flaky: (r) => (r() < 0.12 ? { ok: false, ms: 30, error: 'HTTP 502' } : { ok: true, ms: 150 + r() * 250 }),
  'outage-now': (r, now, anchor) => (now > anchor - 25 * 60000 ? { ok: false, ms: 8000, error: 'timeout after 8s' } : steady(r)),
  recovered: (r, now, anchor) => (now > anchor - 5 * 3600000 && now < anchor - 4.3 * 3600000 ? { ok: false, ms: 30, error: 'HTTP 503' } : steady(r)),
};

export async function check(cfg, ctx = {}) {
  const now = ctx.now ?? Date.now(), anchor = ctx.anchor ?? now;
  const fn = SCENARIOS[cfg.scenario];
  if (!fn) return { ok: false, ms: 0, error: `unknown fixture scenario "${cfg.scenario}"` };
  return fn(rng(hash(ctx.serviceId || '') ^ Math.floor(now / 60000)), now, anchor);
}
