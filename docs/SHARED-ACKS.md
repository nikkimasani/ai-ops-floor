# Shared acknowledgements: setup

Lets the team see **who is on an incident**. Off by default. Design and reasoning: [DESIGN-shared-acks.md](DESIGN-shared-acks.md).

> **Private repo only.** Each incident becomes a GitHub issue named after the service, and acknowledgements publish GitHub logins
> in `acks.json`. Never enable this in the public demo repo, and make sure Pages visibility matches the repo (see ADOPTING.md).

## How it works
1. When a service goes **down**, the probe opens an issue `Incident: <service>` (label `incident`). The webhook alert links to it.
2. A teammate comments `/ack` on that issue. Add any notes as normal comments: **text after `/ack` is not published**, because `acks.json` is a published file. Notes stay on the issue.
3. `.github/workflows/ack.yml` checks the commenter has **write, maintain, admin or triage** access, records `{ by, at }` in `acks.json` on the `data` branch, and re-runs the probe so the dashboard redeploys.
4. The dashboard shows "✓ Acknowledged by @login · 12m ago" on the card and inspector, and the service leaves everyone's 🙋 needs-me list.
5. When the service recovers, the probe comments "Recovered after …", closes the issue and drops the ack.

## Turn it on
1. Config (in the **private** repo's `config/services.json`):
   ```json
   "site": { "sharedAcks": true, "repo": "your-org/ai-ops-floor", ... }
   ```
2. **Limit who can acknowledge:** repo Settings → Collaborators and teams → give **only the Enterprise AI team** *Triage* (or *Write*) and everyone else *Read*. The workflow trusts GitHub's own role check, nothing else.
3. Settings → Actions → General → Workflow permissions: allow Actions to create issues (the probe uses `issues: write`). The `incident` label is created automatically with the first issue.
4. Run the **probe** workflow once to check it still passes. The first real outage opens the first issue.

## What can go wrong
- **Delay:** an ack shows up after the workflow finishes and the site redeploys (about 1-2 minutes). Until then the local *Acknowledge ✓* button hides it for you only.
- **Only down incidents get issues.** A service that is merely *failing* (debouncing, or waiting on a dependency) has no issue, so it can only be acknowledged locally.
- **Both workflows rewrite the `data` branch**, so they share one `concurrency` group and queue instead of overlapping.
- **If the issue can't be created** (permissions), the probe logs `incident issues: open failed (HTTP 403)` and keeps going; it retries on the next run.
- **Not tested against real GitHub issue/permission APIs**: the code follows the documented REST endpoints and is tested against mocks. Try it with a test incident first.
- `/ack` is parsed only from a line that *starts* with it (quoted replies and code blocks are ignored).
- An ack only counts for the incident open *now*: the dashboard compares the ack's incident id with the service's current one, so an old or cached ack never hides a new outage.
- If closing an issue fails (or GitHub can't be listed), the closure stays pending and is retried on every run until it succeeds.
