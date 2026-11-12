# First real data: the Copilot seat tracker

The easiest source to wire up first: one read-only token, a public API (so a normal GitHub-hosted runner works),
and only **counts** are published (seats, inactive seats, pending cancellations). No usernames.

Do this in your **company-org copy** of the repo, not in the public demo. Never paste a token into a chat, an issue or a PR.

## 0. Before you start
- [ ] IT/security OK'd: an internal repo, scheduled Actions, and reading Copilot billing data.
- [ ] Repo is **private/internal**, and Pages visibility matches (Pages can be public: see ADOPTING.md).
- [ ] You know your org's GitHub name (the part after `github.com/`).

## 1. Get a token (read-only)
GitHub org settings, Developer settings: create a **fine-grained personal access token** (or ask an org owner for a GitHub App)
scoped to your organization with **Administration: Read** (Copilot billing read). Classic tokens need `manage_billing:copilot`.
GitHub's current requirement for "Get Copilot seat information and settings for an organization" is authoritative: check it if a 403/404 comes back.
Set a short expiry and a reminder to rotate it.

## 2. Store it as Actions secrets
Repo Settings, Secrets and variables, Actions, **New repository secret**:
- `COPILOT_ORG` = your org name
- `COPILOT_TOKEN` = the token

## 3. Pass them to the probe
In `.github/workflows/probe.yml`, under the `node src/probe.js` step's `env:` block, add:
```yaml
          COPILOT_ORG: ${{ secrets.COPILOT_ORG }}
          COPILOT_TOKEN: ${{ secrets.COPILOT_TOKEN }}
```

## 4. Replace the demo config
Start from `config/services.example-http.json` (it already has a `copilot-seats` entry). Keep **only the services you really monitor**, and set the demo flag off:
```json
{ "id": "copilot-seats", "name": "Copilot Seat Usage", "category": "ops-queue", "owner": "AI Ops", "tier": 3,
  "check": { "adapter": "copilot-seats", "org": "env:COPILOT_ORG", "token": "env:COPILOT_TOKEN", "maxSeats": 500, "maxInactivePct": 30 },
  "thresholds": { "downAfter": 9999 } }
```
Set `maxSeats` to the seats you pay for and `maxInactivePct` to the idle share you'd act on. Run `npm run validate`.

## 5. Clear the demo data
Delete `public/data/*.json` (they are fiction) and make sure `site.demo` is not set. The first real run starts clean.

## 6. Run it and check
Actions, **probe**, Run workflow. Then:
- [ ] Both jobs green. Open the site: the badge says **live**, not "DEMO DATA".
- [ ] The Board card shows real `Seats / Inactive / Cancelling` numbers.
- [ ] If the card says `not authorized (check the token permissions)`: wrong scope, wrong org name, or the token isn't approved for the org.
- [ ] Look at the published `status.json` once: it should contain no names, tokens or URLs.

## 7. Then add the next source
In order of effort: Function app `/api/health` checks (docs/FUNCTION-APP-HEALTH.md), Azure Monitor metrics, then the ServiceNow queue
(needs a read-only account and a runner that can reach your instance). Add alerts (docs/ADAPTERS.md) and, in the private repo only, shared acknowledgements (docs/SHARED-ACKS.md) when you're ready.
