// Tiny localStorage wrapper. Everything is a per-browser convenience: it must never throw, and the
// app must work with storage blocked (private windows, embedded previews).
const NS = 'agvis.';
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(NS + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem(NS + key); } catch { /* ignore */ } },
};
