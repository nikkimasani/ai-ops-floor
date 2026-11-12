# AI Ops Floor 🌸

A friendly health board for AI tools and Azure Function apps. Every service is a little character on an
office floor: **healthy ones type away, slow ones look worried, failing ones turn red, and ones that stop
responding go dark.** A **Board** view shows the same data as a grid with uptime, latency sparklines and
recent incidents.

> **This repository contains demo data only.** Every service name, owner and number here is made up.
> See [docs/ADOPTING.md](docs/ADOPTING.md) for how to point it at real systems *inside your own organization*.

```bash
npm start            # http://localhost:3000   (the demo dashboard, no setup)
npm test             # 45+ tests, no dependencies to install
npm run validate     # check config/services.json
npm run demo-data    # regenerate the demo snapshot (replays 48h through the real pipeline)
npm run probe        # run the health checks once and write public/data/*.json
```

Needs Node 20+. There is nothing to `npm install`.

## How it works

```
 config/services.json ──► probe job (GitHub Actions, every 5 min) ──► data/*.json ──► dashboard
   what to watch            runs the checks, applies the rules,         status, history,      floor + board
                            tracks history and incidents                incidents             (static files)
```

1. **`config/services.json`** lists the services (name, category, owner, tier, what to check, dependencies).
2. **The probe** (`src/probe.js`) runs each check through an *adapter* (`http` today; Azure Monitor,
   Application Insights and others are planned), then decides health with the rules in `public/shared/ops.js`.
3. **The dashboard** (`public/`) is static files that re-read `data/status.json` every 30 seconds.

### What the characters mean

| Character | Health | Rule |
|---|---|---|
| 💻 typing | **healthy** | check passed, under the latency limit |
| 💭 thinking | **degraded** | passed, but slower than `degradedMs` (default 1.5 s) |
| 🚧 blocked | **failing** | a check failed (up to 2 in a row), **or** a dependency is failing ("waiting on X") |
| 🥀 dark | **down** | failed `downAfter` times in a row (default 3). Opens an incident |
| 💤 on break | **maintenance** | inside a maintenance window. Failures are ignored |
| ❔ idle | **unknown** | no data yet, **or the data is stale** |

Two rules worth knowing:
- **Only the root cause pages anyone.** If *Document Review* fails because *Model Router* is down, it shows
  "failing: waiting on Model Router" and no incident is opened for it.
- **The dashboard never trusts old numbers.** If the probe stops running, a red banner appears and every
  service drops to "unknown" after 3 missed intervals. A silent monitor is the worst kind.

### Views

- **Floor** — tap a character for its service card. **🙋 needs me** lists down/failing services you haven't
  acknowledged. *Acknowledge* hides one from that list (in your browser only) until its state changes.
- **📋 Board** — tiles (healthy / degraded / failing / down / maintenance, 24h uptime, MTTR), filters, one card per
  service with a 24h latency sparkline, and the incident log.
- **Everything else from the original office still works** (furniture, looks, themes) — but Fun mode (visitors,
  parties) is **off by default**. Toggle it in ☰ Toolbox.

## Using GitHub Copilot on this repo

Start with [AGENTS.md](AGENTS.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md) (project
rules), then [docs/ADAPTERS.md](docs/ADAPTERS.md) [docs/FUNCTION-APP-HEALTH.md](docs/FUNCTION-APP-HEALTH.md) and (private repos only) [docs/SHARED-ACKS.md](docs/SHARED-ACKS.md). The backlog is in [docs/issues/](docs/issues/): small,
self-contained tasks with acceptance criteria. `scripts/create-issues.sh` files them with the GitHub CLI.

## Layout

```
config/               services.json (demo) · services.example-http.json (template for real checks)
src/                  probe.js · config.js · adapters/ (http, fixture) · demo-data.js
public/               the dashboard (static)
  shared/ops.js       THE RULES: health, uptime, incidents, staleness, floor mapping (used by probe AND browser)
  board.js ops.js     Board view · ops wording and service card
  app.js render.js …  the office floor engine (from AgVisualizer)
scripts/              serve.js · validate-config.js · restore-data.sh · publish-data.sh
.github/workflows/    ci.yml · probe.yml (NOT yet run on GitHub: see docs/ADOPTING.md)
docs/                 ARCHITECTURE · ADAPTERS · ADOPTING · issues/
test/                 node:test suites
```

## Limits to know about

- **16 desks** on the floor. Extra services are listed on the Board but get no character (capacity is a layout
  limit, tracked in the backlog).
- **GitHub-hosted runners can only reach the public internet.** Internal-only endpoints need a self-hosted runner.
- **Scheduled workflows run "about" every 5 minutes**, sometimes late. The staleness banner exists for this.
- **GitHub Pages is public unless your plan supports private Pages.** Don't publish internal service names
  publicly without checking. See ADOPTING.md.
