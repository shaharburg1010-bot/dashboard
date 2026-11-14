// Run: node --test tests/
// The real sync engine, talking over HTTP to the real service with a real (temporary) SQLite file.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { syncOnce, makeOp, localView, visibleItems, emptyDoc } from '../sync.js';
import { makeServerDrive } from '../serverdrive.js';
import { MemStore } from './fakes.js';
import { openStore } from '../server/store.mjs';
import { makeApp } from '../server/app.mjs';

const ORIGIN = 'https://dash.example';
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  const file = path.join(dir, 'life.db');
  const store = openStore(file);
  const server = http.createServer(makeApp(store, { origins: [ORIGIN] }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, store, file, stop: async () => { await new Promise((r) => server.close(r)); store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
let clock = 0; const T0 = Date.now() - 36e5;
function device(base, sec = 'tasks') {
  const store = new MemStore();
  const drive = makeServerDrive(base, sec);
  const t = () => new Date(T0 + (clock += 1000)).toISOString(); // one clock for all devices, like real time
  return {
    store, drive,
    sync: (opts) => syncOnce(drive, store, opts),
    async add(text, coll = 'tasks') { const id = 't_' + Math.random().toString(36).slice(2, 9); await store.addOp(makeOp(coll, id, { text, done: false, deleted: false }, t())); return id; },
    async set(id, fields, coll = 'tasks') { await store.addOp(makeOp(coll, id, fields, t())); },
    async view() { return localView(await store.getMeta('snapshot'), await store.getOutbox()); },
  };
}
const texts = (doc, coll = 'tasks') => visibleItems(doc, coll).map((x) => x.text).sort();

test('first device seeds an empty server; second device receives it', async () => {
  const s = await start();
  try {
    const a = device(s.base), b = device(s.base);
    await a.add('חלב'); await a.add('דרכון');
    await a.sync();
    await b.sync();
    assert.deepEqual(texts(await b.view()), ['דרכון', 'חלב']);
    assert.equal(s.store.read('tasks').version, 1);
  } finally { await s.stop(); }
});

test('two devices changing different fields of one item both win', async () => {
  const s = await start();
  try {
    const a = device(s.base), b = device(s.base);
    const id = await a.add('לקנות מתנה'); await a.sync(); await b.sync();
    await a.set(id, { urgent: true });
    await b.set(id, { done: true });
    await a.sync(); await b.sync(); await a.sync();
    for (const d of [a, b]) {
      const it = (await d.view()).tasks.find((x) => x.id === id);
      assert.equal(it.urgent, true); assert.equal(it.done, true);
    }
  } finally { await s.stop(); }
});

test('a write based on an old version is refused, and sync merges instead of overwriting', async () => {
  const s = await start();
  try {
    const a = device(s.base), b = device(s.base);
    await a.add('א'); await a.sync(); await b.sync();
    await a.add('ב'); await b.add('ג');
    // b reads, then a syncs in the gap before b writes
    const realRead = b.drive.readWithVersion; let once = true;
    b.drive.getVersion = async () => { if (once) { once = false; await a.sync(); } return (await realRead()).version; };
    await b.sync(); await a.sync();
    assert.deepEqual(texts(await a.view()), ['א', 'ב', 'ג']);
    assert.deepEqual(texts(await b.view()), ['א', 'ב', 'ג']);
  } finally { await s.stop(); }
});

test('stale PUT gets 409 and changes nothing', async () => {
  const s = await start();
  try {
    const a = device(s.base); await a.add('x'); await a.sync();
    const r = await fetch(s.base + '/v1/sections/tasks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: emptyDoc(), baseVersion: 0 }) });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).version, 1);
    assert.equal(s.store.read('tasks').doc.tasks.length, 1);
  } finally { await s.stop(); }
});

test('a write that would drop an existing item is refused', async () => {
  const s = await start();
  try {
    const a = device(s.base); await a.add('x'); await a.sync();
    const r = await fetch(s.base + '/v1/sections/tasks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: emptyDoc(), baseVersion: 1 }) });
    assert.equal(r.status, 400);
    assert.equal(s.store.read('tasks').doc.tasks.length, 1);
  } finally { await s.stop(); }
});

test('ops posted by a script (OpenClaw) reach the phone, and a newer phone edit is not overwritten', async () => {
  const s = await start();
  try {
    const a = device(s.base); const id = await a.add('ישן'); await a.sync();
    await a.set(id, { text: 'מהטלפון' }); await a.sync();
    const old = new Date(Date.now() - 864e5).toISOString();
    const post = (ops) => fetch(s.base + '/v1/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops, by: 'openclaw' }) });
    let r = await post([{ coll: 'tasks', id, fields: { text: 'ישן מדי', note: 'מהסוכן' }, at: old },
      { coll: 'tasks', id: 't_new', fields: { text: 'חדש מהסוכן', done: false, deleted: false }, at: new Date().toISOString() },
      { coll: 'debts', id: 'd_1', fields: { text: 'חוב', deleted: false }, at: new Date().toISOString() }]);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys((await r.json()).versions).sort(), ['debts', 'tasks']);
    await a.sync();
    const v = await a.view();
    const it = v.tasks.find((x) => x.id === id);
    assert.equal(it.text, 'מהטלפון'); assert.equal(it.note, 'מהסוכן');
    assert.deepEqual(texts(v), ['חדש מהסוכן', 'מהטלפון']);
    assert.equal(s.store.read('debts').doc.debts.length, 1);
    r = await post([{ coll: 'nope', id: 'x', fields: {}, at: new Date().toISOString() }]);
    assert.equal(r.status, 400);
  } finally { await s.stop(); }
});

test('sections are separate and data survives reopening the database file', async () => {
  const s = await start();
  try {
    const t = device(s.base, 'tasks'), d = device(s.base, 'diet');
    await t.add('משימה'); await t.sync();
    await d.add('ביצה', 'diet_log'); await d.sync();
    assert.equal(s.store.read('tasks').doc.diet_log, undefined);
    const again = openStore(s.file);
    assert.equal(again.read('diet').doc.diet_log.length, 1);
    assert.equal(again.read('tasks').doc.tasks.length, 1);
    again.close();
    const bad = await fetch(s.base + '/v1/sections/whatever');
    assert.equal(bad.status, 400);
  } finally { await s.stop(); }
});

test('server offline -> NetError, nothing lost, next sync delivers', async () => {
  const s = await start();
  const a = device(s.base); await a.add('x');
  const dead = device('http://127.0.0.1:9'); await dead.add('y');
  await assert.rejects(() => dead.sync(), (e) => e.name === 'NetError');
  assert.equal((await dead.store.getOutbox()).length, 1);
  await a.sync();
  assert.equal(s.store.read('tasks').doc.tasks.length, 1);
  await s.stop();
});

test('only the allowed web origin may call the service', async () => {
  const s = await start();
  try {
    const ok = await fetch(s.base + '/v1/health', { headers: { Origin: ORIGIN } });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
    const no = await fetch(s.base + '/v1/sections/tasks', { headers: { Origin: 'https://evil.example' } });
    assert.equal(no.status, 403);
    const pre = await fetch(s.base + '/v1/sections/tasks', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT' } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  } finally { await s.stop(); }
});
