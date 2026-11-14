// server/app.mjs — the small HTTP service the dashboard syncs with (instead of Google Drive).
// It listens on 127.0.0.1 only; Tailscale puts HTTPS in front of it, so only Shahar's own
// devices can reach it. No data ever goes through this repository.
//   GET  /v1/health
//   GET  /v1/sections/<sec>            -> { exists, version, updated, doc }
//   PUT  /v1/sections/<sec>            <- { doc, baseVersion }   -> { version }   (409 if someone wrote first)
//   POST /v1/ops                       <- { ops: [...], by }      -> { versions }  (server-side merge)
import http from 'node:http';
import { openStore, BadRequest } from './store.mjs';

const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new BadRequest('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new BadRequest('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function makeApp(store, { origins = [] } = {}) {
  const allowed = new Set(origins);
  return async function handler(req, res) {
    const origin = req.headers.origin;
    const cors = {};
    if (origin && allowed.has(origin)) {
      cors['Access-Control-Allow-Origin'] = origin;
      cors['Vary'] = 'Origin';
    }
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
      res.end(JSON.stringify(body));
    };
    try {
      if (origin && !allowed.has(origin)) return send(403, { error: 'origin not allowed' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' });
        return res.end();
      }
      const url = new URL(req.url, 'http://x');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'v1') return send(404, { error: 'not found' });
      if (parts[1] === 'health' && req.method === 'GET') return send(200, { ok: true });
      if (parts[1] === 'sections' && parts.length === 3) {
        const sec = decodeURIComponent(parts[2]);
        if (req.method === 'GET') return send(200, store.read(sec));
        if (req.method === 'PUT') {
          const body = await readBody(req);
          return send(200, store.write(sec, body.doc, body.baseVersion, body.by || 'app'));
        }
      }
      if (parts[1] === 'ops' && parts.length === 2 && req.method === 'POST') {
        const body = await readBody(req);
        return send(200, store.applyOps(body.ops, body.by || 'script'));
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      if (e.status === 409) return send(409, { error: e.message, version: e.version });
      if (e.status === 400) return send(400, { error: e.message });
      console.error(e);
      return send(500, { error: 'server error' });
    }
  };
}

// Run directly:  node server/app.mjs
if (import.meta.url === 'file://' + process.argv[1]) {
  const home = process.env.HOME || '.';
  const dbPath = process.env.DASH_DB || home + '/.openclaw/workspace/data/life.db';
  const port = Number(process.env.DASH_PORT || 8787);
  const origins = (process.env.DASH_ORIGINS || 'https://shaharburg1010-bot.github.io').split(',').map((s) => s.trim()).filter(Boolean);
  const store = openStore(dbPath);
  http.createServer(makeApp(store, { origins })).listen(port, '127.0.0.1', () => {
    console.log(`dashboard-sync listening on 127.0.0.1:${port}, db ${dbPath}, origins ${origins.join(' ')}`);
  });
}
