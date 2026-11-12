# AGENTS.md — AI Ops Floor

A health board for AI tools and Azure Function apps. Services are characters on an office floor.
Read this first; deeper detail is in `docs/ARCHITECTURE.md` and `docs/ADAPTERS.md`.

## Commands
- `npm test` — all tests (Node's built-in runner, zero dependencies). **Run before every commit.**
- `npm run validate` — validates `config/services.json` and prints every problem at once.
- `npm run demo-data` — regenerates `public/data/*.json` (demo only).
- `npm start` — serves `public/` at http://localhost:3000.
- `npm run probe` — runs the real checks once.

## Rules that must not be broken
1. **Zero runtime dependencies.** Node 20+ built-ins only. Do not add `package.json` dependencies without asking.
2. **`public/shared/ops.js` is the single source of truth** for health rules. The probe (Node) and dashboard
   (browser) both import it. Change rules there, with tests in `test/ops.test.js`. Never duplicate them.
3. **Published data must never contain endpoints, hostnames, headers, tokens or response bodies.**
   Only fields in `PUBLIC_FIELDS` (ops.js) reach `public/data/status.json`. Adapter error strings must be
   generic ("HTTP 503", "timeout after 8s", "connection failed (ECONNREFUSED)"). `test/probe.test.js` and
   `test/adapters.test.js` check this. Keep them passing.
4. **Secrets are only ever referenced as `"env:NAME"` in config** and come from GitHub Actions secrets.
   Never write a real secret, URL or internal name into the repo, tests, fixtures or docs.
5. **Stale data must never look healthy.** Keep the staleness behaviour (`isStale`, banner) intact.
6. **Demo data is fiction.** Fixture services are fictional. Keep real-looking company details out of examples.

## Where things live
- Add a data source → `src/adapters/<name>.js`, register in `src/adapters/index.js`, tests in
  `test/adapters.test.js`, document in `docs/ADAPTERS.md`. Start from the `fixture` adapter's shape.
- Change what a status means → `public/shared/ops.js` (+ `FLOOR_STATUS`), then `public/ops.js` wording.
- Dashboard UI → `public/board.js` (Board), `public/ops.js` (service card, feed wording), `public/app.js` (floor).
- Floor engine files (`render.js`, `furniture.js`, `edit.js`, `fun.js`, `looks.js`, `life.js`, `placement.js`)
  came from another project. Avoid changing them unless a task needs it.

## Definition of done
- `npm test` and `npm run validate` pass.
- New behaviour has tests; a bug fix has a test that failed before the fix.
- Docs updated if config, adapters or status meanings changed.
- No secrets, internal URLs or real names anywhere in the diff.
- Small, focused PR with a description of what changed and how it was verified.

## Style
Plain modern JavaScript (ES modules), no build step, no TypeScript, no frameworks. Match the surrounding
code's comment density: explain *why*, not *what*. Prefer small pure functions that are easy to test.
