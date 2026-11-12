# Adapters

An adapter turns "is this service OK?" into `{ ok, ms, error? }`.

```js
// src/adapters/example.js
export async function check(cfg, ctx) {   // ctx: { env, timeoutMs, now }
  const t0 = Date.now();
  try { /* call the thing */ return { ok: true, ms: Date.now() - t0 }; }
  catch { return { ok: false, ms: Date.now() - t0, error: 'check failed' }; }
}
```
Register in `src/adapters/index.js`. Config: `"check": { "adapter": "example", ... }`.

## Rules
- Never throw for expected failures. Return `ok:false`.
- `error` is **published**: short and generic. No URLs, hosts, headers, tokens or body text.
- Secrets: `"env:NAME"` in config, resolved from `ctx.env` (GitHub Actions secrets).
- Tests: local server or recorded fixture, plus a no-leak assertion.

## Built in
### `http`
`{ adapter:"http", url, method?, headers?, expectStatus?, expectBodyIncludes?, timeoutMs? }`
`url`/header values may be `env:NAME`. Errors: `HTTP 503`, `timeout after 8s`, `connection failed (ECONNREFUSED)`,
`configuration error: missing secret`, `unexpected response body`.

### `fixture`
Deterministic fake results for demos/tests: scenarios `steady, slow, slowish, flaky, outage-now, recovered`.

## Planned
Azure Monitor / Application Insights, Azure Function health, ServiceNow ticket counts, Copilot seat usage. See `docs/issues/`.
