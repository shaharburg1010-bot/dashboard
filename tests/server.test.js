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

test('ops posted by a script (Claude on the server) reach the phone, and a newer phone edit is not overwritten', async () => {
  const s = await start();
  try {
    const a = device(s.base); const id = await a.add('ישן'); await a.sync();
    await a.set(id, { text: 'מהטלפון' }); await a.sync();
    const old = new Date(Date.now() - 864e5).toISOString();
    const post = (ops) => fetch(s.base + '/v1/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops, by: 'claude' }) });
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

test('moving from Drive: a device uploads its whole copy; order of devices and repeats do not matter', async () => {
  const { snapshotOps, seedServer } = await import('../serverdrive.js');
  const { applyOps } = await import('../sync.js');
  const s = await start();
  try {
    // a brand-new device (no data yet) reaches the empty server first
    const fresh = device(s.base); await fresh.add('מהמכשיר החדש'); await fresh.sync();
    // the old device's last Drive copy: two items, one of them deleted, written at different times
    const snap = applyOps(emptyDoc(), [
      { coll: 'tasks', id: 't_old1', fields: { text: 'ותיק', done: false, deleted: false }, at: '2026-10-01T10:00:00.000Z' },
      { coll: 'tasks', id: 't_old1', fields: { done: true }, at: '2026-10-05T10:00:00.000Z' },
      { coll: 'tasks', id: 't_old2', fields: { text: 'נמחק', deleted: true }, at: '2026-10-02T10:00:00.000Z' },
      { coll: 'fields', id: 'categoryOrder', fields: { value: ['א', 'ב'] }, at: '2026-10-03T10:00:00.000Z' },
    ]);
    assert.equal(snapshotOps(snap).length, 4); // t_old1 has two write times
    // meanwhile something newer than the old copy already reached the server
    await fetch(s.base + '/v1/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: [{ coll: 'tasks', id: 't_old1', fields: { text: 'ותיק (עודכן)' }, at: '2026-11-01T10:00:00.000Z' }] }) });
    assert.equal(await seedServer(s.base, snap), 4);
    await seedServer(s.base, snap); // twice = once
    const doc = s.store.read('tasks').doc;
    const old1 = doc.tasks.find((x) => x.id === 't_old1');
    assert.equal(old1.text, 'ותיק (עודכן)'); assert.equal(old1.done, true);
    assert.equal(old1._f.done, '2026-10-05T10:00:00.000Z');
    assert.equal(doc.tasks.find((x) => x.id === 't_old2').deleted, true);
    assert.deepEqual(doc.fields.find((x) => x.id === 'categoryOrder').value, ['א', 'ב']);
    await fresh.sync();
    assert.deepEqual(texts(await fresh.view()), ['ותיק (עודכן)', 'מהמכשיר החדש']);
  } finally { await s.stop(); }
});

test('old journal entries for data that moved to another area do not block that area forever', async () => {
  const { sectionStore } = await import('../memdrive.js');
  const { sectionOfOp } = await import('../sections.js');
  const s = await start();
  try {
    const st = new MemStore();
    const recent = new Date(Date.now() - 864e5).toISOString();
    // finance's journal still remembers a change to finance.spending, which now lives in 'spending'
    await st.setMeta('finance:journal', [makeOp('fields', 'finance.spending', { value: { months: [] }, deleted: false }, recent),
      makeOp('fields', 'finance.longTerm', { value: { a: 1 }, deleted: false }, recent)]);
    await st.addOp(makeOp('fields', 'finance.shortMedium', { value: { b: 2 }, deleted: false }, new Date().toISOString()));
    const r = await syncOnce(makeServerDrive(s.base, 'finance'), sectionStore(st, 'finance', sectionOfOp));
    assert.equal(r.status, 'ok'); assert.equal(r.pushed, 1);
    const ids = s.store.read('finance').doc.fields.map((x) => x.id).sort();
    assert.deepEqual(ids, ['finance.longTerm', 'finance.shortMedium']); // the real finance entry is still restored
    assert.equal((await st.getOutbox()).length, 0);
  } finally { await s.stop(); }
});

// ---- scripts (Claude on the server) changing finance blocks ----
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const field = (s, sec, id) => s.store.read(sec).doc.fields.find((f) => f.id === id);
const SM = { bank: { securities: 50000 }, ibkr: { cashUsd: 10, fxUsdIls: 3.5, holdings: [{ ticker: 'NVDA', shares: 2 }] }, studyFund: { value: 30000 } };
async function withFinance() {
  const s = await start();
  const r = await post(s.base, '/v1/ops', { by: 'seed', ops: [{ coll: 'fields', id: 'finance.shortMedium', fields: { value: SM, deleted: false }, at: new Date(T0).toISOString() }] });
  assert.equal(r.status, 200);
  return s;
}

test('a script cannot empty a finance block by writing a different shape over it', async () => {
  const s = await withFinance();
  try {
    const r = await post(s.base, '/v1/ops', { by: 'claude', ops: [{ coll: 'fields', id: 'finance.shortMedium', fields: { value: { mediumTotal: 97098 } }, at: new Date().toISOString() }] });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /would drop: bank, ibkr, studyFund/);
    assert.deepEqual(field(s, 'finance', 'finance.shortMedium').value, SM);
    // the same write goes through when it keeps every part, or when it says it really means to replace
    const ok = await post(s.base, '/v1/ops', { by: 'claude', ops: [{ coll: 'fields', id: 'finance.shortMedium', fields: { value: { ...SM, note: 'x' } }, at: new Date().toISOString() }] });
    assert.equal(ok.status, 200);
    const rep = await post(s.base, '/v1/ops', { by: 'claude', ops: [{ coll: 'fields', id: 'finance.shortMedium', replace: true, fields: { value: { bank: {} } }, at: new Date().toISOString() }] });
    assert.equal(rep.status, 200);
  } finally { await s.stop(); }
});

test('/v1/set changes one inner value and leaves the rest of the block alone', async () => {
  const s = await withFinance();
  try {
    const r = await post(s.base, '/v1/set', { by: 'claude', sets: [
      { path: 'finance.shortMedium.ibkr.cashUsd', value: 250 },
      { path: 'finance.shortMedium.ibkr.holdings.0.shares', value: 5 },
      { path: 'finance.shortTerm', value: { total: 2181 } },
      { path: 'finance.spending.budget.target', value: 6000 },
    ] });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).versions, { finance: 2, spending: 1 });
    const v = field(s, 'finance', 'finance.shortMedium').value;
    assert.equal(v.ibkr.cashUsd, 250); assert.equal(v.ibkr.holdings[0].shares, 5);
    assert.equal(v.ibkr.fxUsdIls, 3.5); assert.deepEqual(v.bank, SM.bank); assert.deepEqual(v.studyFund, SM.studyFund);
    assert.equal(field(s, 'finance', 'finance.shortTerm').value.total, 2181);
    assert.equal(field(s, 'spending', 'finance.spending').value.budget.target, 6000);
    // the phone then reads it like any other change
    const d = device(s.base, 'finance'); await d.sync();
    assert.equal((await d.view()).fields.find((f) => f.id === 'finance.shortMedium').value.ibkr.cashUsd, 250);
  } finally { await s.stop(); }
});

test('/v1/set refuses bad paths, lists, and replacing a whole block by accident; nothing is half-written', async () => {
  const s = await withFinance();
  try {
    for (const sets of [
      [{ path: 'finance.shortMedium', value: { total: 1 } }],
      [{ path: 'tasks', value: [] }],
      [{ path: 'sports.days.0', value: 1 }],
      [{ path: 'finance', value: {} }],
      [{ path: 'finance.shortMedium.__proto__.x', value: 1 }],
      [{ path: 'finance.shortMedium.ibkr.holdings.7.shares', value: 1 }],
      [{ path: 'finance.shortMedium.ibkr.cashUsd', value: 1 }, { path: 'finance.shortMedium.bank.securities.x', value: 1 }],
    ]) assert.equal((await post(s.base, '/v1/set', { sets })).status, 400, JSON.stringify(sets));
    assert.deepEqual(field(s, 'finance', 'finance.shortMedium').value, SM);
    assert.equal(s.store.read('finance').version, 1);
    assert.equal((await post(s.base, '/v1/set', { sets: [{ path: 'finance.shortMedium', value: { bank: {} }, replace: true }] })).status, 200);
  } finally { await s.stop(); }
});

test('/v1/set wins even when a device wrote the block with a clock that runs ahead', async () => {
  const s = await start();
  try {
    const future = new Date(Date.now() + 36e5).toISOString();
    await post(s.base, '/v1/ops', { by: 'seed', ops: [{ coll: 'fields', id: 'finance.plan', fields: { value: { theme: 'a' }, deleted: false }, at: future }] });
    assert.equal((await post(s.base, '/v1/set', { sets: [{ path: 'finance.plan.theme', value: 'b' }] })).status, 200);
    assert.equal(field(s, 'finance', 'finance.plan').value.theme, 'b');
  } finally { await s.stop(); }
});

test('history lists earlier copies and returns one, so a damaged block can be restored', async () => {
  const s = await withFinance();
  try {
    await post(s.base, '/v1/set', { sets: [{ path: 'finance.shortMedium', value: { broken: true }, replace: true }] });
    const list = await (await fetch(s.base + '/v1/history/finance')).json();
    assert.deepEqual(list.versions.map((v) => v.version), [2, 1]);
    const old = await (await fetch(s.base + '/v1/history/finance/1')).json();
    const good = old.doc.fields.find((f) => f.id === 'finance.shortMedium').value;
    assert.deepEqual(good, SM);
    await post(s.base, '/v1/set', { sets: [{ path: 'finance.shortMedium', value: good, replace: true }] });
    assert.deepEqual(field(s, 'finance', 'finance.shortMedium').value, SM);
    assert.equal((await fetch(s.base + '/v1/history/finance/99')).status, 400);
  } finally { await s.stop(); }
});
