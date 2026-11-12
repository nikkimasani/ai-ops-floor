# Architecture

```
config/services.json
        │
        ▼
src/probe.js ── runOnce() ──► adapters (http | fixture | …)  → {ok, ms, error?}
        │            │
        │            └─► public/shared/ops.js  deriveHealth / uptime / incidents  (THE RULES)
        ▼
public/data/status.json  history.json  incidents.json     (published: whitelisted fields only)
        │
        ▼
public/source.js  polls status.json every 30s
        │   stale? → all services "unknown"
        ▼
Office (state.js) ── status events ──► render.js (floor)   +   board.js (Board view)
```

## Key decisions
- **Static + git-scraping.** A scheduled Action probes and publishes JSON; the dashboard is static files. No server or database to run.
- **`data` branch.** Probe output lives on an orphan `data` branch (one force-pushed commit), so `main` never grows.
- **One rules module.** `public/shared/ops.js` is imported by both Node and the browser, so the dashboard and probe can't disagree.
- **Debounce.** A service is `failing` until `downAfter` consecutive failures, then `down` (and an incident opens).
- **Root cause only.** If a dependency is failing/down, dependents show "waiting on X" and open no incident.
- **Staleness.** No update for 3 × `intervalMin` → banner + every service `unknown`. Demo data (`demo:true`) is exempt and time-shifted in the browser.
- **Privacy by whitelist.** `toPublic` copies only `PUBLIC_FIELDS`. Adapters return generic error strings.
- **Capacity.** The floor has 16 seats (bullpen 8, boardroom 4, review 4). Extra services get `onFloor:false` (Board only).

## Data files
- `status.json`: `{generatedAt, intervalMin, demo, services:[{id,name,category,owner,tier,health,floor,since,latencyMs,reason,onFloor,room,…}], summary}`
- `history.json`: `{ [id]: [[t, code, ms], …] }`, code 1=ok 0=fail 2=maintenance, 7 days.
- `incidents.json`: `[{id, service, start, end?, …}]`.
