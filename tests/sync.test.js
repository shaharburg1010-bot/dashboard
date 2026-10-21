// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncOnce, makeOp, localView, visibleItems, opsLanded, applyOp, emptyDoc, FILE_NAME,
  AuthError, CorruptRemoteError, ConflictError,
} from '../sync.js';
import { FakeDrive, MemStore, NetError } from './fakes.js';

// Each device = its own local store (like a phone's IndexedDB) talking to the same Drive.
function device(drive, sink) {
  const store = new MemStore();
  const rec = (op) => { if (sink) sink.push(op); return op; };
  let clock = 0;
  const t = () => new Date(Date.UTC(2026, 9, 15, 8, 0, 0) + (clock += 1000) + Math.floor(Math.random() * 1000)).toISOString();
  return {
    store,
    sync: () => syncOnce(drive, store),
    async add(text) { const id = 't_' + Math.random().toString(36).slice(2, 9); await store.addOp(rec(makeOp('tasks', id, { text, done: false, deleted: false }, t()))); return id; },
    async set(id, fields) { await store.addOp(rec(makeOp('tasks', id, fields, t()))); },
    async view() { return localView(await store.getMeta('snapshot'), await store.getOutbox()); },
  };
}
const remote = (drive) => drive.rawDoc(drive.onlyFileId());
const task = (doc, id) => doc.tasks.find((x) => x.id === id);

test('first sync creates exactly one file containing the offline-made tasks', async () => {
  const drive = new FakeDrive(); const a = device(drive);
  const id1 = await a.add('קניות'); const id2 = await a.add('ספה');
  const r = await a.sync();
  assert.equal(r.pushed, 2);
  assert.equal(drive.files.size, 1);
  assert.equal(drive.files.get('f1').name, FILE_NAME);
  assert.equal(task(remote(drive), id1).text, 'קניות');
  assert.equal(task(remote(drive), id2).text, 'ספה');
  assert.equal((await a.store.getOutbox()).length, 0);
});

test('offline: sync fails, nothing is lost, and everything goes up when back online', async () => {
  const drive = new FakeDrive(); const a = device(drive);
  await a.sync();
  drive.offline = true;
  const id = await a.add('בלי קליטה');
  await a.set(id, { done: true });
  await assert.rejects(a.sync(), NetError);
  assert.equal((await a.store.getOutbox()).length, 2);
  assert.equal(task(await a.view(), id).done, true, 'UI still shows the change while offline');
  drive.offline = false;
  await a.sync();
  assert.equal(task(remote(drive), id).done, true);
  assert.equal((await a.store.getOutbox()).length, 0);
});

test('upload fails mid-sync: outbox kept, retry succeeds', async () => {
  const drive = new FakeDrive(); const a = device(drive); await a.sync();
  const id = await a.add('x');
  drive.fail('write', 'net', 'before');
  await assert.rejects(a.sync(), NetError);
  assert.equal((await a.store.getOutbox()).length, 1);
  assert.equal(task(remote(drive), id), undefined);
  await a.sync();
  assert.equal(task(remote(drive), id).text, 'x');
});

test('upload succeeded but the reply was lost: no duplicates, outbox cleared next time', async () => {
  const drive = new FakeDrive(); const a = device(drive); await a.sync();
  const id = await a.add('x');
  drive.fail('write', 'net', 'after');
  await assert.rejects(a.sync(), NetError);
  assert.equal((await a.store.getOutbox()).length, 1);
  const writesBefore = drive.calls.filter((c) => c === 'write').length;
  await a.sync();
  assert.equal(drive.calls.filter((c) => c === 'write').length, writesBefore, 'no second upload needed');
  assert.equal(remote(drive).tasks.filter((t) => t.id === id).length, 1);
  assert.equal((await a.store.getOutbox()).length, 0);
});

test('file creation reply lost: next sync finds the file instead of creating a second one', async () => {
  const drive = new FakeDrive(); const a = device(drive);
  await a.add('x');
  drive.fail('create', 'net', 'after');
  await assert.rejects(a.sync(), NetError);
  await a.sync();
  assert.equal(drive.files.size, 1);
  assert.equal((await a.store.getOutbox()).length, 0);
});

test('Claude edits the note while the phone (offline) marks done: both survive', async () => {
  const drive = new FakeDrive(); const a = device(drive); const claude = device(drive);
  const id = await a.add('החזר שכד'); await a.sync();
  drive.offline = true;
  await a.set(id, { done: true });
  drive.offline = false;
  await claude.set(id, { note: 'לחכות ארנונה' }); await claude.sync();
  await a.sync();
  const t = task(remote(drive), id);
  assert.equal(t.done, true); assert.equal(t.note, 'לחכות ארנונה');
});

test('race: someone writes between our read and our version check -> we retry with their data', async () => {
  const drive = new FakeDrive(); const a = device(drive); const b = device(drive);
  const id = await a.add('base'); await a.sync();
  await a.set(id, { done: true });
  await b.set(id, { note: 'from b' });
  drive.hooks.getVersion = () => b.sync();
  await a.sync();
  const t = task(remote(drive), id);
  assert.equal(t.done, true); assert.equal(t.note, 'from b');
});

test('race: someone writes in the gap right before our upload -> their op is recovered from their journal', async () => {
  const drive = new FakeDrive(); const a = device(drive); const b = device(drive);
  const id = await a.add('base'); await a.sync(); await b.sync();
  await a.set(id, { done: true });
  await b.set(id, { note: 'from b' });
  drive.hooks.write = () => b.sync(); // b lands, then a overwrites with a doc that lacks b's note
  await a.sync();
  assert.equal(task(remote(drive), id).note, undefined, 'b\'s write was clobbered (Drive has no conditional write)');
  const r = await b.sync(); // b notices its op is gone and re-applies it
  assert.equal(r.restored, 1);
  const t = task(remote(drive), id);
  assert.equal(t.done, true); assert.equal(t.note, 'from b');
});

test('someone overwrites Drive with an old copy after we synced: our changes come back', async () => {
  const drive = new FakeDrive(); const a = device(drive);
  const id = await a.add('x'); await a.sync();
  const old = remote(drive);
  await a.set(id, { done: true }); await a.sync();
  drive.rawWrite(drive.onlyFileId(), old); // stale overwrite
  assert.equal(task(remote(drive), id).done, false);
  const r = await a.sync();
  assert.equal(r.restored, 1);
  assert.equal(task(remote(drive), id).done, true);
});

test('corrupted file on Drive: we refuse to overwrite it and keep the outbox', async () => {
  const drive = new FakeDrive(); const a = device(drive); await a.add('x'); await a.sync();
  drive.rawWrite(drive.onlyFileId(), '{"oops": tru');
  await a.add('y');
  await assert.rejects(a.sync(), CorruptRemoteError);
  assert.equal(drive.files.get(drive.onlyFileId()).text, '{"oops": tru', 'file untouched');
  assert.equal((await a.store.getOutbox()).length, 1);
  drive.rawWrite(drive.onlyFileId(), JSON.stringify({ schemaVersion: 3, tasks: [] }));
  await assert.rejects(a.sync(), CorruptRemoteError, 'unknown schema also refused');
});

test('expired login: AuthError, outbox kept', async () => {
  const drive = new FakeDrive(); const a = device(drive); await a.sync();
  drive.tokenValid = false;
  await a.add('x');
  await assert.rejects(a.sync(), AuthError);
  assert.equal((await a.store.getOutbox()).length, 1);
  drive.tokenValid = true;
  await a.sync();
  assert.equal(remote(drive).tasks.length, 1);
});

test('file deleted from Drive: rebuilt from this device\'s copy, nothing lost', async () => {
  const drive = new FakeDrive(); const a = device(drive);
  const id1 = await a.add('one'); await a.sync();
  const id2 = await a.add('two');
  drive.files.get(drive.onlyFileId()).trashed = true;
  await a.sync();
  const doc = remote(drive);
  assert.equal(task(doc, id1).text, 'one'); assert.equal(task(doc, id2).text, 'two');
});

test('ops added while a sync is running wait for the next round (not dropped)', async () => {
  const drive = new FakeDrive(); const a = device(drive); await a.sync();
  await a.add('first');
  let lateId;
  drive.hooks.write = async () => { lateId = await a.add('late'); };
  await a.sync();
  assert.equal((await a.store.getOutbox()).length, 1, 'late op still queued');
  await a.sync();
  assert.equal(task(remote(drive), lateId).text, 'late');
});

test('delete is a tombstone: an offline device editing it later does not resurrect it', async () => {
  const drive = new FakeDrive(); const a = device(drive); const b = device(drive);
  const id = await a.add('x'); await a.sync(); await b.sync();
  await b.set(id, { text: 'edited offline' });   // b is offline-ish, older edit
  await a.set(id, { deleted: true }); await a.sync();
  await b.sync();
  assert.equal(visibleItems(remote(drive), 'tasks').length, 0);
});

test('endless interference gives a clear ConflictError and keeps the outbox', async () => {
  const drive = new FakeDrive(); const a = device(drive); await a.sync();
  await a.add('x');
  const id = drive.onlyFileId();
  const orig = drive.getVersion.bind(drive);
  drive.getVersion = async (fid) => { drive.rawWrite(id, remote(drive)); return orig(fid); };
  await assert.rejects(a.sync(), ConflictError);
  assert.equal((await a.store.getOutbox()).length, 1);
});

test('applyOp is idempotent and per-field last-writer-wins', () => {
  const doc = emptyDoc();
  const o1 = makeOp('tasks', 'a', { text: 'v1', done: false }, '2026-10-15T08:00:00.000Z');
  const o2 = makeOp('tasks', 'a', { text: 'v2' }, '2026-10-15T09:00:00.000Z');
  applyOp(doc, o2); applyOp(doc, o1); applyOp(doc, o1); applyOp(doc, o2);
  assert.equal(doc.tasks.length, 1);
  assert.equal(doc.tasks[0].text, 'v2');
  assert.equal(doc.tasks[0].done, false);
  assert.ok(opsLanded(doc, [o1, o2]));
});

// ---------- Fuzz: random devices, random faults, random races. Nothing may be lost. ----------
test('fuzz: 300 random scenarios, every edit ends up on Drive and all devices agree', async () => {
  for (let seed = 0; seed < 300; seed++) {
    const drive = new FakeDrive();
    const allOps = [];
    const devs = [device(drive, allOps), device(drive, allOps), device(drive, allOps)]; // phone, iPad, Claude
    const ids = [];
    const rnd = (n) => Math.floor(Math.random() * n);
    for (let step = 0; step < 40; step++) {
      const d = devs[rnd(devs.length)];
      const roll = rnd(10);
      if (roll < 3 || ids.length === 0) { ids.push(await d.add('t' + step)); }
      else if (roll < 6) {
        const f = [{ done: Math.random() < 0.5 }, { note: 'n' + step }, { text: 'e' + step }, { deleted: Math.random() < 0.3 }][rnd(4)];
        await d.set(ids[rnd(ids.length)], f);
      } else {
        // sync, with random trouble
        const trouble = rnd(8);
        if (trouble === 0) drive.offline = true;
        if (trouble === 1) drive.fail('write', 'net', 'before');
        if (trouble === 2) drive.fail('write', 'net', 'after');
        if (trouble === 3) drive.fail('readWithVersion', 'net', 'before');
        if (trouble === 4) { const other = devs[rnd(devs.length)]; if (other !== d) drive.hooks.write = () => other.sync().catch(() => {}); }
        if (trouble === 5) { const other = devs[rnd(devs.length)]; if (other !== d) drive.hooks.getVersion = () => other.sync().catch(() => {}); }
        await d.sync().catch(() => {});
        drive.offline = false; drive.faults = []; drive.hooks = {};
      }
    }
    // Heal: everyone syncs a few rounds with a healthy network.
    for (let round = 0; round < 3; round++) for (const d of devs) await d.sync();
    const final = remote(drive);
    const uniq = [...new Map(allOps.map((o) => [o.opId, o])).values()];
    assert.ok(opsLanded(final, uniq), `seed ${seed}: some edit was lost`);
    for (const d of devs) {
      assert.equal((await d.store.getOutbox()).length, 0, `seed ${seed}: outbox not empty`);
      assert.deepEqual(await d.view(), final, `seed ${seed}: device view differs from Drive`);
    }
    assert.equal(drive.files.size, 1, `seed ${seed}: duplicate files`);
  }
});

test('clobbered right after our upload: the same sync notices and re-applies (no waiting for next time)', async () => {
  const drive = new FakeDrive(); const a = device(drive);
  const id = await a.add('x'); await a.sync();
  const before = remote(drive);
  await a.set(id, { done: true });
  const origWrite = drive.write.bind(drive);
  let once = true;
  drive.write = async (fid, doc) => { await origWrite(fid, doc); if (once) { once = false; drive.rawWrite(fid, before); } };
  await a.sync();
  assert.equal(task(remote(drive), id).done, true);
});
