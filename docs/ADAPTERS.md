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

### `servicenow`
Queue health from the ServiceNow Table API with a **read-only** account. It requests only `sys_created_on`, so ticket
numbers, descriptions, callers and assignees never enter the process, let alone the published files.
```json
{ "adapter": "servicenow", "instance": "env:SN_INSTANCE", "user": "env:SN_USER", "password": "env:SN_PASSWORD",
  "table": "incident", "query": "active=true^assignment_group=<sys_id>",
  "maxOpen": 30, "maxOldestHours": 72, "slaHours": 48 }
```
- Fails (service shows *failing*) when open tickets > `maxOpen` or the oldest > `maxOldestHours`. Reason is numbers only: `queue over limit: 37 open (max 30)`.
- Publishes `metrics: { open, oldestHours, breaching }` (breaching = older than `slaHours`). Shown on the Board card.
- `instance`, `user`, `password` should all be `env:` references (Actions secrets). `query` is never published.
- Set `"thresholds": { "downAfter": 9999 }` so a backlog shows as *failing* instead of "dark".
- If more than 1000 tickets match, the `X-Total-Count` header supplies the real count.
- Needs a service account with read on the table; the runner must be able to reach the instance.

### Metrics from any adapter
An adapter may return `metrics: { open, oldestHours, breaching }`. The probe keeps only those keys, and only finite numbers.

## Planned
Azure Monitor / Application Insights, Azure Function health, Copilot seat usage. See `docs/issues/`.
