# Handoff: AI Ops Floor

For a person (or GitHub Copilot) taking this repo from "working demo" to "monitoring our real AI tools".
Read this first, then `AGENTS.md` (the rules Copilot must follow).

## What this is
A health board for AI tools and Azure Function apps. Each service is a character on an office floor (healthy types, slow looks worried, failing turns red, down goes dark), plus a Board with uptime, latency, incidents, a dependency graph and extra floors beyond 16 services. A scheduled GitHub Action probes each service, applies the rules, and publishes JSON that a static page reads.

## State today (all on `main`)
**Built and tested (94 automated tests, runs with `npm test`, no dependencies to install):**
- Health rules, debounce, dependency root-cause, maintenance windows, staleness (a silent monitor never looks healthy)
- Probe + adapters: `http`, `fixture` (demo), `azure-monitor`, `servicenow`, `copilot-seats`
- Board, dependency graph, multiple floors, webhook alerts (Teams/Slack style)
- Shared acknowledgements via `/ack` on incident issues (private repos only, off by default)
- **My Queue** (local only): your assigned ServiceNow and Azure DevOps items in one calm view, with a triage agent per new assignment that runs your Copilot `/triage` skill (see docs/MY-QUEUE.md)
- CI workflow, probe workflow (ran once on GitHub with demo data: green)

**Never run against a real system (verified only against mocks):** Azure Monitor, ServiceNow (both the queue adapter and My Queue), Azure DevOps, Copilot seats, the Copilot CLI hand-off, alert webhooks, incident issues and `/ack` permissions. Expect small first-run fixes.

**It contains fiction only.** All 16 services, owners and numbers in `config/services.json` and `public/data/` are made up.

## Rules that must not be broken (details in AGENTS.md)
1. Never put a real secret, URL, hostname or internal name in the repo, config, tests, docs, issues or PRs. Config references secrets as `"env:NAME"`; values live in GitHub Actions secrets.
2. Published data (`public/data/*.json`) must never contain endpoints, hosts, headers, tokens, response bodies, ticket text or usernames. Adapter errors stay generic.
3. Zero runtime dependencies (Node 20+ only). Health rules live only in `public/shared/ops.js`.
4. `npm test` and `npm run validate` pass before every commit. Small PRs, with tests.

## What Copilot can and cannot do
Copilot **can**: edit code and config, add adapters and tests, write docs, open PRs, fix CI.
Copilot **cannot** (a person must): create tokens, add Actions secrets, approve org/IT policy, change repo visibility or Pages settings, grant team access, or confirm a real endpoint's behaviour.

## Prompts to paste into Copilot
Use Copilot Chat in your editor (agent mode) or assign a GitHub issue to the **Copilot coding agent**. Run these one at a time, review each PR.

### Prompt 0: orient (always start here)
```
Read HANDOFF.md, AGENTS.md and .github/copilot-instructions.md in this repo. Then run `npm test` and `npm run validate`
and tell me, in plain language: what this project does, what is already built, and what is untested against real systems.
Do not change any files yet.
```

### Prompt 1: go live with demo data on our org's GitHub (no secrets needed)
```
Follow docs/ADOPTING.md and docs/FIRST-REAL-DATA.md steps 0, 3 and 6 for this repo. Do not add any real secrets or URLs.
Confirm the CI and probe workflows pass, list anything that needs a person to do in GitHub settings (Pages source,
Actions permissions, repo visibility), and fix any workflow problems you find in a small PR with tests.
```

### Prompt 2: first real source, Copilot seat usage
```
Follow docs/FIRST-REAL-DATA.md to wire the copilot-seats adapter to real data. The org name and token will be Actions secrets
named COPILOT_ORG and COPILOT_TOKEN (I will add them; never ask for or write their values).
1. In config/services.json keep only the real services (start with just the copilot-seats service) and remove demo flags.
2. Pass the two secrets to the probe step in .github/workflows/probe.yml.
3. Delete the fictional demo files in public/data/.
4. Make sure npm test and npm run validate pass.
Then tell me exactly what to check on the first live run, and what each error message on the Board card means.
```

### Prompt 3: Function app and AI Hub health checks
```
For each Azure Function app and AI Hub app I list below, add a service entry using the http adapter with an
unauthenticated /api/health URL if one exists, else a function key sent as the x-functions-key header. Follow
docs/FUNCTION-APP-HEALTH.md. All URLs and keys must be "env:NAME" references; give me the list of secret names to create.
Set owners, tiers, and dependsOn where one service calls another. Validate with npm run validate.
[PASTE: service name, owner team, tier 1-3, depends on, health endpoint env var name]
```

### Prompt 4: ServiceNow ticket queue (needs read-only account and a runner that can reach the instance)
```
Add a ServiceNow queue service using the servicenow adapter (docs/ADAPTERS.md). Use env references SN_INSTANCE, SN_USER,
SN_PASSWORD. The query is: [PASTE assignment group / filter]. Set maxOpen and maxOldestHours to [N] and [N].
Keep only counts and ages in published data. If the GitHub-hosted runner cannot reach the instance, update probe.yml
to use a self-hosted runner label I will give you, and list what the network team needs to allow.
```

### Prompt 5: alerts
```
Add webhook alerts per docs/ADAPTERS.md "Alerts". The webhook URL is the Actions secret ALERT_WEBHOOK. Only tier 1 and 2.
Pass the secret in probe.yml. Do not log or print the URL anywhere.
```

### Prompt 6 (private repo only): shared acknowledgements
```
Enable shared acknowledgements per docs/SHARED-ACKS.md. Set site.sharedAcks and site.repo in config/services.json.
Tell me the exact repository settings a person must change (team access limited to the Enterprise AI team, Actions
permissions). Do not enable this in any public repository.
```

### Prompt 7: My Queue (your assigned ServiceNow and Azure DevOps items, plus your triage skill)
```
Read docs/MY-QUEUE.md. Help me set up My Queue on THIS machine only: copy config/queue.example.json to .local/queue.json,
and tell me exactly which environment variables to set (SN_INSTANCE, SN_USER, SN_PASSWORD, ADO_ORG, ADO_PAT; never ask for or
print their values). Run `npm run queue:demo` first and confirm it works. Then look at `gh copilot --help` on this machine and
propose the exact triage.command array that runs my /triage skill for ONE prompt non-interactively and exits, using the fewest
permissions possible. Show me the command and test it on a harmless prompt before wiring it in. Do not enable triage.auto.
```

### Prompt for any failure
```
The [probe / ci / ack] workflow failed. Here is the log: [PASTE, with secrets removed]. Reproduce it locally if you can,
fix the root cause (not the test), add a test that would have caught it, and open a small PR.
```

## First-run checklist (a person does this)
- [ ] IT/security OK'd an internal repo, scheduled Actions, and the data sources
- [ ] Repo is private/internal; Pages visibility matches (Pages can be public)
- [ ] Secrets added in Settings, Secrets and variables, Actions (names in the prompts above)
- [ ] Run Actions, probe, Run workflow; both jobs green; the page badge says **live**, not "DEMO DATA"
- [ ] Open `public/data/status.json` once: no names, tokens or URLs you didn't intend to publish
- [ ] Only then: alerts, shared acknowledgements

## Where things are
`README.md` overview · `AGENTS.md` and `.github/copilot-instructions.md` Copilot rules · `docs/ARCHITECTURE.md` · `docs/ADAPTERS.md` (every adapter and alerts) ·
`docs/ADOPTING.md` and `docs/FIRST-REAL-DATA.md` going live · `docs/SHARED-ACKS.md` · `docs/FUNCTION-APP-HEALTH.md` · `config/` · `src/` (probe, adapters) · `public/` (dashboard) · `.github/workflows/`.
