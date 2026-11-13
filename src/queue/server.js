// The LOCAL My Queue server. Binds 127.0.0.1 only; serves the dashboard plus /api/queue for your assigned items.
// Ticket text lives in this process's memory and in the browser tab: it is never written to public/data.
//
//   GET  /api/queue            ranked items + the next-up pick + triage states + source health
//   POST /api/triage/<id>      start your triage command for a known item (needs header X-Ops-Local: 1, same origin)
//   GET  /api/triage/<id>      state, and the saved result once done
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchQueue } from './sources.js';
import { rankQueue, nextUp, diffQueue } from './rank.js';
import { TriageManager } from './triage.js';

const PUBLIC = resolve(fileURLToPath(new URL('../../public/', import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

export function createLocalApp({ config, env = process.env, fetch: doFetch = fetch, spawn, dir = resolve('.local/triage'), now = Date.now, publicDir = PUBLIC, log = console.log } = {}) {
  const startedAt = now();
  let items = [], sources = [], firstSeen = new Map(), generatedAt = null, firstPoll = true;
  const triage = new TriageManager({ config: config.triage || {}, dir, env, spawn, now });

  async function refresh() {
    const r = await fetchQueue(config.sources, { env, fetch: doFetch, now: now(), startedAt });
    const { arrived, gone } = diffQueue(new Set(firstSeen.keys()), r.items);
    for (const id of gone) firstSeen.delete(id);
    for (const a of arrived) firstSeen.set(a.id, { at: now(), late: !firstPoll });      // late = assigned while we were running: this is what makes an agent walk in
    sources = r.sources; items = r.items; generatedAt = now();
    if (!firstPoll && config.triage?.auto && triage.enabled) for (const a of arrived) triage.start(a);
    firstPoll = false;
    log(`queue: ${items.length} item(s) from ${sources.filter((s) => s.ok).length}/${sources.length} source(s)`);   // counts only, never ticket text
    return { arrived: arrived.length };
  }

  const view = () => {
    const ranked = rankQueue(items, now()), next = nextUp(ranked);
    return {
      generatedAt, sources, next: next?.id ?? null, triage: { enabled: triage.enabled, auto: Boolean(config.triage?.auto) },
      items: ranked.map((i) => ({ ...i, arrivedAt: firstSeen.get(i.id)?.late ? firstSeen.get(i.id).at : null, triage: triage.state(i.id) })),
    };
  };

  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || ''), port = server.address()?.port;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(421); return res.end('wrong host'); }   // blocks DNS-rebinding
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, `http://${host}`), path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/api/queue') return json(200, view());
      const m = path.match(/^\/api\/triage\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]), item = items.find((i) => i.id === id);
        if (req.method === 'GET') { const s = triage.state(id); return json(200, { ...s, result: s.state === 'done' ? triage.result(id) : null }); }
        if (req.method === 'POST') {
          const origin = req.headers.origin;
          if (req.headers['x-ops-local'] !== '1' || (origin && origin !== `http://${host}`)) return json(403, { error: 'forbidden' });   // CSRF guard
          if (!item) return json(404, { error: 'unknown item' });
          if (!triage.enabled) return json(409, { error: 'triage is not configured (see docs/MY-QUEUE.md)' });
          return json(202, triage.start(item));
        }
      }
      if (req.method !== 'GET' || path.startsWith('/api/')) return json(404, { error: 'not found' });
      const file = resolve(join(publicDir, normalize(path === '/' ? '/index.html' : decodeURIComponent(path))));
      if (file !== publicDir && !file.startsWith(publicDir + sep)) { res.writeHead(403); return res.end(); }
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data);
    } catch { if (!res.headersSent) { res.writeHead(404); res.end('not found'); } }
  });

  let timer;
  return {
    server, refresh, view, triage,
    async listen(port = config.port ?? 3100) {
      await new Promise((r) => server.listen(port, '127.0.0.1', r));
      await refresh();
      timer = setInterval(() => refresh().catch(() => {}), (config.pollSec || 120) * 1000); timer.unref?.();
      return server.address().port;
    },
    close() { clearInterval(timer); return new Promise((r) => server.close(r)); },
  };
}
