# Adopting this for real services

This repo is demo-only. To monitor real tools, do it **inside your organization's GitHub**.

## 1. Check policy first
Ask IT/security: may you create an internal repo, use Actions schedules, and call internal endpoints from runners? Which
Pages visibility is allowed? Don't copy company data into a personal account.

## 2. Move the code
Create an internal/private repo in the company org and push this code (or use "Use this template" / import). Enable Copilot
for the repo if your org allows.

## 3. Replace demo config
Copy `config/services.example-http.json` over `config/services.json`. Set real names/owners/tiers. Put URLs and keys in
**Actions secrets** and reference them as `env:NAME`. Run `npm run validate`.
Delete committed demo data: `public/data/*.json`, and remove `site.demo` from config.

## 4. Security checklist
- [ ] Repo and Pages visibility match what the service names reveal (Pages may be public!)
- [ ] No URLs/keys/hostnames in repo, config, issues or PRs
- [ ] Health endpoints are unauthenticated `/health` routes where possible; else a least-privilege key
- [ ] Probe runner can reach the endpoints (internal ones need a self-hosted runner)
- [ ] Error strings published are generic (tests enforce)

## 5. Turn it on
Settings → Pages → Source: GitHub Actions. Add secrets. Run the **probe** workflow manually, check the artifact, then let
the cron run. The workflows have **not been run on GitHub yet**, so expect small first-run fixes.

## 6. Add sources over time
Use the backlog in `docs/issues/` (Azure Monitor, ServiceNow, Copilot seats) with Copilot.
