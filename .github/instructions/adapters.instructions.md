---
applyTo: "src/adapters/**"
---
An adapter is an ES module exporting `async function check(cfg, ctx)` that returns
`{ ok: boolean, ms: number, error?: string }`. Rules:
- Never throw for an expected failure (timeout, bad status): return `{ ok: false, ms, error }`.
- `error` is published to the dashboard: keep it short and generic. No URL, hostname, header, token or body text.
- Secrets come from `ctx.env` via `resolveEnv` ("env:NAME" in config), never from config values.
- Respect `cfg.timeoutMs ?? ctx.timeoutMs`.
- Add a test in `test/adapters.test.js` using a local server or recorded fixture, and a leak test (nothing sensitive in the result).
- Register the adapter in `src/adapters/index.js` and document it in `docs/ADAPTERS.md`.
