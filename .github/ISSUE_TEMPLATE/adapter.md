---
name: New adapter
about: Add a data source (Azure Monitor, Application Insights, ServiceNow, …)
labels: adapter
---
## Source
What system, and what exactly should it tell us (up/down? latency? error rate?)

## Contract
- Config shape (`check: { adapter: "...", ... }`):
- Result mapping to `{ ok, ms, error? }`:
- Secrets needed (env var names only):

## Acceptance criteria
- [ ] Adapter in `src/adapters/`, registered in `index.js`
- [ ] Tests with a local server or recorded fixture, including a "nothing sensitive leaks" test
- [ ] `docs/ADAPTERS.md` updated
- [ ] `npm test` and `npm run validate` pass
