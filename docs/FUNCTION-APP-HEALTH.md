# Health checks for Azure Function apps

Give each Function app a small `/api/health` endpoint, then point the `http` adapter at it.

## 1. Add the endpoint
A good health endpoint checks the things the app really needs (config present, a cheap dependency call), returns fast,
and **never returns secrets, connection strings or stack traces**.

**Node.js (v4 model)**
```js
const { app } = require('@azure/functions');
app.http('health', {
  route: 'health', methods: ['GET'], authLevel: 'function',
  handler: async () => {
    const ok = Boolean(process.env.MODEL_ENDPOINT);          // replace with a real, cheap check
    return { status: ok ? 200 : 503, jsonBody: { status: ok ? 'ok' : 'degraded' } };
  },
});
```
**Python (v2 model)**
```python
import azure.functions as func, os, json
app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

@app.route(route="health", methods=["GET"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    ok = bool(os.environ.get("MODEL_ENDPOINT"))               # replace with a real, cheap check
    return func.HttpResponse(json.dumps({"status": "ok" if ok else "degraded"}, separators=(",", ":")), status_code=200 if ok else 503, mimetype="application/json")
```

## 2. Wire it up
```json
{
  "id": "func-intake", "name": "func-intake", "category": "azure-function", "owner": "Your Team", "tier": 1,
  "check": {
    "adapter": "http",
    "url": "env:FUNC_INTAKE_URL",
    "headers": { "x-functions-key": "env:FUNC_INTAKE_KEY" },
    "expectStatus": 200,
    "expectBodyIncludes": "\"status\":\"ok\"",
    "timeoutMs": 10000
  },
  "thresholds": { "degradedMs": 4000, "downAfter": 3 }
}
```
`expectBodyIncludes` is an exact substring match, so the body must contain exactly `"status":"ok"` (no space after the colon: that is why the Python example uses compact `separators`).
Use `env:` for the URL too if the app name itself is internal. Add the secrets in repo Settings → Secrets and variables → Actions, and
pass them to the probe step in `.github/workflows/probe.yml` (`env:` block).

## 3. Keys
- **Use the `x-functions-key` header, not `?code=`.** Query strings end up in logs. (`env:` references only work as a whole value, so they can't be embedded in a URL anyway.)
- Prefer a **function-level key for the health function only**, not the host/master key.
- Better still: an anonymous `/health` that returns only `ok`, if your security team allows it. Then no key is needed.
- Rotate the key by changing the Actions secret.

## 4. Cold starts
Consumption-plan apps can take several seconds on the first request after idle. Set `degradedMs` above your typical cold start
(4000 is a reasonable start) so cold starts show as healthy rather than "slow", and keep `downAfter: 3` so one slow probe doesn't page anyone.
If it is still noisy, put the app on a plan with always-ready instances, or probe less often (`site.intervalMin`).

## 5. Check it
`npm run validate` then run the probe workflow manually and look at the card on the Board.
