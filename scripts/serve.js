#!/usr/bin/env node
// Tiny zero-dependency static server for local use: npm start  ->  http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = resolve(join(ROOT, normalize(path === '/' ? '/index.html' : path)));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`AI Ops Floor → http://localhost:${PORT}`));
