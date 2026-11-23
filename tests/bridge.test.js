// The server's own Drive work (server/bridge.mjs) against an in-memory Drive and a real temporary SQLite file.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { makeBridge, serverView } from '../server/bridge.mjs';
import { makeOp } from '../sync.js';

function fakeDrive() {
  const files = new Map(); let n = 1;
  const add = (parent, name, text) => { const id = 'f' + n++; files.set(id, { parent, name, text, trashed: false }); return id; };
  return {
    files, add,
    calls: 0,
    async ensureToken() { this.calls++; },
    async listInFolder(folder, mark) { return [...files].filter(([, f]) => f.parent === folder && !f.trashed && f.name.includes(mark)).map(([id, f]) => ({ id, name: f.name })); },
    async findInFolder(folder, name) { const e = [...files].reverse().find(([, f]) => f.parent === folder && !f.trashed && f.name === name); return e ? e[0] : null; },
    async readText(id) { return files.get(id).text; },
    async trash(id) { files.get(id).trashed = true; },
    async write(id, doc) { files.get(id).text = JSON.stringify(doc); },
    async createIn(folder, name, text) { return add(folder, name, text); },
    async ensureFolder(parent, name) { return (await this.findInFolder(parent, name)) || add(parent, name, ''); },
    async uploadBinary(folder, name, buf) { return add(folder, name, buf.length + ' bytes'); },
  };
}
const FOLDERS = { tasks: 'T', debts: 'D', finance: 'F', leisure: 'L', spending: 'S', diet: 'DI', army: 'A' };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
  const store = openStore(path.join(dir, 'life.db'));
  const at = new Date(Date.now() - 60000).toISOString();
  store.applyOps([
    makeOp('fields', 'finance.shortTerm', { value: { total: 100, items: [] }, deleted: false }, at),
    makeOp('tasks', 't1', { text: 'קיים', cat: 'כללי', done: false, deleted: false }, at),
  ], 'seed');
  const drive = fakeDrive();
  const bridge = makeBridge({ store, drive, folders: FOLDERS, inboxFolders: FOLDERS, snapshotFolder: 'SNAP', snapshotName: 'dashboard-snapshot.json', log: () => {} });
  return { store, drive, bridge, stop: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('inbox files are applied on the server, trashed, and never applied twice', async () => {
  const s = setup();
  try {
    const f1 = s.drive.add('T', 'dashboard-inbox-1.json', JSON.stringify({ by: 'test', changes: [
      { add: 'tasks', item: { id: 't2', cat: 'כללי', text: 'חדש' } },
      { update: 'tasks', id: 't1', fields: { urgent: true } }] }));
    const f2 = s.drive.add('F', 'dashboard-inbox-2.json', JSON.stringify({ changes: [{ set: 'finance.shortTerm.total', value: 250 }] }));
    const bad = s.drive.add('T', 'dashboard-inbox-bad.json', '{ not json');
    await s.bridge.run();
    const v = serverView(s.store);
    assert.deepEqual(v.tasks.map((t) => t.text).sort(), ['חדש', 'קיים']);
    assert.equal(v.tasks.find((t) => t.id === 't1').urgent, true);
    assert.equal(v.finance.shortTerm.total, 250);
    assert.deepEqual(v.finance.shortTerm.items, []);           // the rest of the block stays
    assert.equal(s.drive.files.get(f1).trashed, true);
    assert.equal(s.drive.files.get(f2).trashed, true);
    assert.equal(s.drive.files.get(bad).trashed, false);       // a broken file stays for a human to see
    // trash that failed last time: the file comes back, but is not applied again
    s.drive.files.get(f1).trashed = false;
    await s.bridge.run();
    assert.equal(serverView(s.store).tasks.length, 2);
    assert.equal(s.drive.files.get(f1).trashed, true);
  } finally { s.stop(); }
});

test('snapshot is written for the agents, and rewritten only when data changed', async () => {
  const s = setup();
  try {
    await s.bridge.run();
    const id = await s.drive.findInFolder('SNAP', 'dashboard-snapshot.json');
    assert.ok(id);
    assert.equal(JSON.parse(s.drive.files.get(id).text).data.finance.shortTerm.total, 100);
    s.drive.files.get(id).text = 'untouched';
    await s.bridge.run();
    assert.equal(s.drive.files.get(id).text, 'untouched');
    s.drive.add('F', 'dashboard-inbox-3.json', JSON.stringify({ changes: [{ set: 'finance.shortTerm.total', value: 7 }] }));
    await s.bridge.run();
    assert.equal(JSON.parse(s.drive.files.get(id).text).data.finance.shortTerm.total, 7);
  } finally { s.stop(); }
});

test('portfolio block is applied once per change', async () => {
  const s = setup();
  try {
    const md = (n) => 'טקסט\n```json portfolio\n' + JSON.stringify({ asOf: 'x', holdings: [{ ticker: 'NVDA', name: 'NVIDIA', shares: n, costUsd: 100 }], cashUsd: 5 }) + '\n```\n';
    const id = s.drive.add('F', 'תיק השקעות.md', md(3));
    await s.bridge.run();
    assert.equal(serverView(s.store).finance.shortMedium.ibkr.holdings[0].shares, 3);
    s.drive.files.get(id).text = md(4);
    await s.bridge.run();
    assert.equal(serverView(s.store).finance.shortMedium.ibkr.holdings[0].shares, 4);
  } finally { s.stop(); }
});

test('daily backup of life.db once a day, old copies trashed', async () => {
  const s = setup();
  try {
    await s.bridge.run(); await s.bridge.run();
    const folder = await s.drive.findInFolder('SNAP', 'גיבוי דשבורד');
    const copies = [...s.drive.files.values()].filter((f) => f.parent === folder && !f.trashed);
    assert.equal(copies.length, 1);
    assert.match(copies[0].name, /^life-\d{4}-\d{2}-\d{2}\.db$/);
  } finally { s.stop(); }
});

test('a failed Google permission is reported, nothing else runs', async () => {
  const s = setup();
  try {
    s.drive.ensureToken = async () => { throw new Error('Google סירב'); };
    await s.bridge.run();
    assert.match(s.bridge.status().lastError, /Google/);
    assert.equal(s.bridge.status().lastOk, null);
  } finally { s.stop(); }
});
