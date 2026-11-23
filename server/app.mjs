// server/app.mjs — the small HTTP service the dashboard syncs with (instead of Google Drive).
// It listens on 127.0.0.1 only; Tailscale puts HTTPS in front of it, so only Shahar's own
// devices can reach it. No data ever goes through this repository.
//   GET  /v1/health
//   GET  /v1/sections/<sec>            -> { exists, version, updated, doc }
//   PUT  /v1/sections/<sec>            <- { doc, baseVersion }   -> { version }   (409 if someone wrote first)
//   POST /v1/ops                       <- { ops: [...], by }      -> { versions }  (server-side merge)
//   POST /v1/set                       <- { sets: [{ path, value }], by } -> { versions }  (one inner value, rest untouched)
//   GET  /v1/history/<sec>             -> { versions: [{ version, at, by }] }
//   GET  /v1/history/<sec>/<version>   -> { version, at, by, doc }
//   GET  /v1/status                    -> { bridge: { configured, lastRun, lastOk, lastError, recent } }
//   POST /v1/pull                      -> same, after checking Drive now (inbox, portfolio, snapshot; see bridge.mjs)
import http from 'node:http';
import fs from 'node:fs';
import { openStore, BadRequest } from './store.mjs';
import { makeBridge } from './bridge.mjs';
import { makeGoogleDrive } from './gdrive.mjs';
import { FOLDERS, INBOX_FOLDERS, SNAPSHOT_FOLDER, SNAPSHOT_NAME } from '../config.js';

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

export function makeApp(store, { origins = [], bridge = null } = {}) {
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
      const bridgeStatus = () => ({ bridge: bridge ? bridge.status() : { configured: false } });
      if (parts[1] === 'status' && parts.length === 2 && req.method === 'GET') return send(200, bridgeStatus());
      if (parts[1] === 'pull' && parts.length === 2 && req.method === 'POST') {
        if (bridge) await bridge.run({ minGapMs: 15000 });
        return send(200, bridgeStatus());
      }
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
      if (parts[1] === 'set' && parts.length === 2 && req.method === 'POST') {
        const body = await readBody(req);
        return send(200, store.setPaths(body.sets, body.by || 'script'));
      }
      if (parts[1] === 'history' && req.method === 'GET' && (parts.length === 3 || parts.length === 4)) {
        const sec = decodeURIComponent(parts[2]);
        return send(200, parts.length === 3 ? store.history(sec) : store.historyDoc(sec, parts[3]));
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
  const dbPath = process.env.DASH_DB || home + '/dashboard-data/life.db';
  const port = Number(process.env.DASH_PORT || 8787);
  const origins = (process.env.DASH_ORIGINS || 'https://shaharburg1010-bot.github.io').split(',').map((s) => s.trim()).filter(Boolean);
  const store = openStore(dbPath);
  // Drive work on the server (bridge.mjs), only once the permanent permission exists (google-auth.mjs).
  const cred = process.env.DASH_GOOGLE || home + '/.config/dashboard-sync/google.json';
  const minutes = Math.max(1, Number(process.env.DASH_BRIDGE_MINUTES || 2));
  let bridge = null;
  if (fs.existsSync(cred)) {
    bridge = makeBridge({ store, drive: makeGoogleDrive(cred), folders: FOLDERS, inboxFolders: INBOX_FOLDERS,
      snapshotFolder: SNAPSHOT_FOLDER, snapshotName: SNAPSHOT_NAME });
    const tick = () => bridge.run().catch((e) => console.error('bridge', e));
    setTimeout(tick, 5000);
    setInterval(tick, minutes * 60 * 1000);
  } else console.log('no Google permission at ' + cred + ': Drive inbox is left to the app (run server/google-auth.mjs)');
  http.createServer(makeApp(store, { origins, bridge })).listen(port, '127.0.0.1', () => {
    console.log(`dashboard-sync listening on 127.0.0.1:${port}, db ${dbPath}, origins ${origins.join(' ')}, drive bridge ${bridge ? 'every ' + minutes + ' min' : 'off'}`);
  });
}
