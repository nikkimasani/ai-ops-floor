# Azure Function app health check recipe

Document and template how to add a `/api/health` endpoint to a Function app and wire it with the `http` adapter
(`expectStatus`, `expectBodyIncludes`, function key via `env:`). Add an example to `config/services.example-http.json`.

**Acceptance:** example validates with `npm run validate`; docs explain key handling and cold-start latency (`degradedMs`).
