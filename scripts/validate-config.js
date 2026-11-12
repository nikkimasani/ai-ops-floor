#!/usr/bin/env node
// npm run validate [path]  — checks config/services.json and lists every problem at once.
import { loadConfig } from '../src/config.js';
const path = process.argv[2] || 'config/services.json';
try { const c = loadConfig(path); console.log(`${path}: OK (${c.services.length} services)`); }
catch (err) { console.error(err.message); process.exit(1); }
