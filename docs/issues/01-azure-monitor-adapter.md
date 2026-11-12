# Azure Monitor / Application Insights adapter

**Why:** Many AI Hub apps and Azure Function apps expose health via Azure Monitor, not a public URL.

**Contract:** `check: { adapter: "azure-monitor", resourceId: "env:RES_ID", metric: "...", threshold: ... }` -> `{ok, ms, error?}`.
Auth via env secrets only (service principal / federated credential). Use `fetch`, no SDK dependencies.

**Acceptance criteria**
- [ ] `src/adapters/azure-monitor.js`, registered in `index.js`
- [ ] Tests against a local mock server; no-leak test (no resource IDs or tokens in results)
- [ ] `docs/ADAPTERS.md` section with required Azure permissions (Monitoring Reader)
