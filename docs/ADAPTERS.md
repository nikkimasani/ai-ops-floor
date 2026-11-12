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

### `copilot-seats`
GitHub Copilot seat usage for an organization, from the Copilot billing summary (`GET /orgs/{org}/copilot/billing`).
**Aggregates only**: the per-user seat list is never requested, so no usernames can be published.
```json
{ "adapter": "copilot-seats", "org": "env:COPILOT_ORG", "token": "env:COPILOT_TOKEN", "maxSeats": 500, "maxInactivePct": 30 }
```
- Publishes `metrics: { seats, inactiveSeats, pendingCancellation }`; the Board card shows them.
- Fails when seats assigned exceed `maxSeats` (budget) or more than `maxInactivePct`% were inactive this billing cycle.
- Token: needs permission to read Copilot billing for the org (fine-grained "Administration: read" on the organization, or classic `manage_billing:copilot`). Check GitHub's docs for the current requirement; a 403/404 shows as `not authorized (check the token permissions)`.
- Use `"thresholds": { "downAfter": 9999 }` so a licence issue shows as *failing*, not "dark".
- Not tested against a real organization: it follows the documented endpoint and is tested against a mock.
### `azure-monitor`
Checks an Azure Monitor **platform metric** for a Function app, App Service, API Management, etc., using the Metrics REST API
and an app registration (client credentials). No SDK.
```json
{ "adapter": "azure-monitor",
  "tenantId": "env:AZ_TENANT_ID", "clientId": "env:AZ_CLIENT_ID", "clientSecret": "env:AZ_CLIENT_SECRET",
  "resourceId": "env:FUNC_INTAKE_RESOURCE_ID",
  "metric": "Http5xx", "aggregation": "Total", "max": 5, "windowMin": 15 }
```
- Looks at the **latest datapoint in the last `windowMin` minutes** (default 15). Fails if it is above `max` or below `min` (give either or both), or if there is no recent data.
- `aggregation`: `Average` (default), `Total`, `Count`, `Minimum`, `Maximum`. Metric names are the "Name in Rest API" column from Microsoft's *Supported metrics* pages (e.g. `Http5xx`, `HealthCheckStatus`, `FunctionExecutionCount`).
- **Setup:** create an app registration + client secret; give it the **Monitoring Reader** role on each resource (or its resource group). Put tenant, client id, secret and resource id in Actions secrets and list them in `probe.yml`'s `env:` block.
- Errors are generic: `authentication failed`, `not authorized (check the Monitoring Reader role)`, `HTTP 500`, `no recent data`, `metric over limit: 12 (max 5)`. Resource id, tenant, client id and tokens are never published.
- Caveats: platform metrics lag by a minute or two; `Http5xx`-style *Total* metrics only say "errors happened recently", so pair them with an `http` health check (see `docs/FUNCTION-APP-HEALTH.md`).
- **Application Insights** query-based checks (KQL) are not in this adapter; add them as a separate adapter if needed.
- Not tested against a real Azure subscription: it follows the documented endpoints and is tested against a mock.

### Metrics from any adapter
An adapter may return `metrics` with any of: `open`, `oldestHours`, `breaching`, `seats`, `inactiveSeats`, `pendingCancellation`. The probe keeps only those keys, and only finite numbers. To add a key, extend `METRIC_KEYS` in `src/probe.js` and `METRIC_LABELS` in `public/board.js`.

## Planned
Application Insights (KQL) checks. See `docs/issues/`.
