---
applyTo: "public/**"
---
Static files only: no bundler, no npm packages, no frameworks. Code in `public/shared/` runs in both Node and the
browser, so it must not touch `document`, `window` or `localStorage`. Health rules live only in
`public/shared/ops.js`. Escape every service-provided string before putting it in HTML (see `esc` in `ops.js`/`board.js`).
