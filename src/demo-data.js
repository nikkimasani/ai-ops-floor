#!/usr/bin/env node
// Generate believable demo data: replay 48 hours of fake probe runs through the REAL pipeline, so the
// committed public/data/*.json is exactly what a live run of the probe would produce.
//   npm run demo-data
import { loadConfig } from './config.js';
import { runOnce, saveState } from './probe.js';

export async function generate(config, { anchor = Date.now(), hours = 48, stepMin = 5 } = {}) {
  let state = {};
  config = { ...config, site: { ...config.site, demo: true } };      // marks the snapshot as demo data
  for (let t = anchor - hours * 3600000; t <= anchor; t += stepMin * 60000) state = await runOnce({ config, state, now: t, anchor });
  return state;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const state = await generate(loadConfig('config/services.json'));
  saveState('public/data', state);
  const s = state.status.summary;
  console.log(`demo data written: ${s.total} services (${s.healthy} healthy, ${s.degraded} degraded, ${s.failing} failing, ${s.down} down, ${s.maintenance} maintenance), ${state.incidents.length} incidents`);
}
