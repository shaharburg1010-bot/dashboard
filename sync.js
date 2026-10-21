// sync.js — the heart of the app: how local changes reach Google Drive without being lost.
// Pure logic only (no browser APIs), so it can be tested in Node with a fake Drive.
//
// Data model
//   doc  = { schemaVersion: 1, tasks: [item, ...] }
//   item = { id, text, done, deleted, ..., _f: { field: "ISO time it was last set" } }
//   op   = { opId, coll: "tasks", id, fields: { text: "...", done: true }, at: "ISO time" }
//
// Rules
//   * Every field remembers when it was last written (_f). A write only wins if it is newer
//     (per field, not per item) — so Claude updating one field and the phone updating another
//     never overwrite each other.
//   * Deleting = setting deleted:true (a "tombstone"). Items are never physically removed,
//     so an offline device can't bring a deleted item back to life.
//   * An op leaves the outbox ONLY after we re-read Drive and saw it there.

export const FILE_NAME = 'dashboard-data.json';
// One array per list in the dashboard + 'fields' for everything else (finance blocks, notes, orders).
export const COLLECTIONS = [
  'tasks', 'debts', 'sports_days', 'sports_workoutLog', 'sports_runs',
  'leisure_books', 'leisure_movies', 'leisure_travel', 'leisure_learning', 'leisure_cooking',
  'fields',
];
export const SCHEMA_VERSION = 2;

export class AuthError extends Error { constructor(m) { super(m || 'auth required'); this.name = 'AuthError'; } }
export class CorruptRemoteError extends Error { constructor(m) { super(m || 'remote file is not valid dashboard data'); this.name = 'CorruptRemoteError'; } }
export class ConflictError extends Error { constructor(m) { super(m || 'too many concurrent changes, try again'); this.name = 'ConflictError'; } }
export class NetError extends Error { constructor(m) { super(m || 'network unavailable'); this.name = 'NetError'; } }
export class NotFoundError extends Error { constructor(m) { super(m || 'file not found on Drive'); this.name = 'NotFoundError'; } }

export function emptyDoc() {
  const d = { schemaVersion: SCHEMA_VERSION };
  for (const c of COLLECTIONS) d[c] = [];
  return d;
}

export function clone(x) { return JSON.parse(JSON.stringify(x)); }

// Throws if the remote content isn't something we should ever merge into / overwrite.
export function validateDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new CorruptRemoteError('not an object');
  if (doc.schemaVersion === 1) { // the first test version (tasks only): upgrade in place
    doc.schemaVersion = SCHEMA_VERSION;
    for (const c of COLLECTIONS) if (!Array.isArray(doc[c])) doc[c] = [];
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) throw new CorruptRemoteError('unknown schemaVersion ' + doc.schemaVersion);
  for (const c of COLLECTIONS) {
    if (doc[c] === undefined) doc[c] = []; // a list added in a later version: start empty
    if (!Array.isArray(doc[c])) throw new CorruptRemoteError('not an array: ' + c);
    for (const it of doc[c]) {
      if (!it || typeof it.id !== 'string') throw new CorruptRemoteError('item without id in ' + c);
    }
  }
  return doc;
}

export function parseRemote(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new CorruptRemoteError('invalid JSON'); }
  return validateDoc(doc);
}

// Apply one op to a doc (mutates). Per-field last-writer-wins. Idempotent: applying twice = once.
export function applyOp(doc, op) {
  const list = doc[op.coll];
  if (!list) throw new Error('unknown collection ' + op.coll);
  let item = list.find((x) => x.id === op.id);
  if (!item) { item = { id: op.id, _f: {} }; list.push(item); }
  if (!item._f) item._f = {};
  for (const [k, v] of Object.entries(op.fields)) {
    if (k === 'id' || k === '_f') continue;
    const prev = item._f[k];
    if (!prev || op.at >= prev) { item[k] = v; item._f[k] = op.at; }
  }
  return doc;
}

export function applyOps(doc, ops) {
  for (const op of ops) applyOp(doc, op);
  return doc;
}

// True if every field of every op is present in doc with that write or a newer one.
export function opsLanded(doc, ops) {
  for (const op of ops) {
    const item = (doc[op.coll] || []).find((x) => x.id === op.id);
    if (!item || !item._f) return false;
    for (const k of Object.keys(op.fields)) {
      if (k === 'id' || k === '_f') continue;
      if (!item._f[k] || item._f[k] < op.at) return false;
    }
  }
  return true;
}

// What the UI shows: last known Drive state + changes that haven't been sent yet.
export function localView(snapshot, outbox) {
  return applyOps(clone(snapshot || emptyDoc()), outbox);
}

export function visibleItems(doc, coll) {
  return (doc[coll] || []).filter((x) => !x.deleted);
}

let counter = 0;
export function makeOp(coll, id, fields, at) {
  counter = (counter + 1) % 1e6;
  return {
    opId: 'op_' + Date.now().toString(36) + '_' + counter.toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    coll, id, fields, at: at || new Date().toISOString(),
  };
}

export function newId(prefix) {
  return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/*
 * One sync round.
 *   drive: { findFile(name) -> id|null, create(name, doc) -> id,
 *            readWithVersion(id) -> { text, version }, getVersion(id) -> version, write(id, doc) }
 *   store: { getMeta(k), setMeta(k,v), getOutbox() -> ops[], removeOps(opIds[]) }
 * Returns { status: 'ok', pushed: n }. Throws AuthError / CorruptRemoteError / ConflictError / network errors.
 * Whatever is thrown, the outbox is untouched unless the ops were verified on Drive.
 */
export async function syncOnce(drive, store, opts = {}) {
  try {
    return await syncRound(drive, store, opts);
  } catch (e) {
    if (e instanceof NotFoundError && !opts._retried) {
      // The file was deleted/trashed on Drive. Forget its id and rebuild it from what this
      // device knows (last snapshot + pending ops) — nothing local is thrown away.
      await store.setMeta('fileId', null);
      return syncRound(drive, store, { ...opts, _retried: true, rebuild: true });
    }
    throw e;
  }
}

// How long we keep re-checking already-synced ops (protects against someone else
// overwriting the file with an older copy after our sync finished).
export const JOURNAL_DAYS = 14;
export const JOURNAL_MAX = 2000;

function pruneJournal(journal, nowIso) {
  const cutoff = new Date(new Date(nowIso).getTime() - JOURNAL_DAYS * 864e5).toISOString();
  const seen = new Set();
  const out = [];
  for (let i = journal.length - 1; i >= 0; i--) { // keep newest copy of each op
    const op = journal[i];
    if (seen.has(op.opId) || op.at < cutoff) continue;
    seen.add(op.opId); out.unshift(op);
  }
  return out.slice(-JOURNAL_MAX);
}

async function syncRound(drive, store, opts) {
  const maxAttempts = opts.maxAttempts || 5;
  const outbox = await store.getOutbox(); // snapshot of the batch; ops added during sync wait for next round
  const journal = (await store.getMeta('journal')) || [];

  const finish = async (remoteDoc, restored) => {
    // Order matters: journal first, then remove from outbox. A crash in between leaves the op
    // in both places, which is harmless (ops are idempotent). The reverse order could lose it.
    await store.setMeta('journal', pruneJournal([...journal, ...outbox], new Date().toISOString()));
    if (outbox.length) await store.removeOps(outbox.map((o) => o.opId));
    await store.setMeta('snapshot', remoteDoc);
    await store.setMeta('lastSync', new Date().toISOString());
    return { status: 'ok', pushed: outbox.length, restored };
  };

  let fileId = await store.getMeta('fileId');
  if (!fileId) {
    fileId = await drive.findFile(FILE_NAME);
    if (!fileId) {
      // First run (or rebuild): create the file containing everything this device has.
      const base = opts.rebuild ? clone((await store.getMeta('snapshot')) || emptyDoc()) : emptyDoc();
      fileId = await drive.create(FILE_NAME, applyOps(base, outbox));
    }
    await store.setMeta('fileId', fileId);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { text, version } = await drive.readWithVersion(fileId);
    const remote = parseRemote(text); // refuses to touch a corrupted file

    // Ops we already synced earlier but that are no longer on Drive (someone overwrote them).
    const lost = journal.filter((op) => !opsLanded(remote, [op]));
    const ops = [...lost, ...outbox];

    // Nothing to send, or already there (e.g. last upload succeeded but its reply was lost).
    if (ops.length === 0 || opsLanded(remote, ops)) return finish(remote, 0);

    const merged = applyOps(clone(remote), ops);

    // Optimistic lock: if someone wrote since we read, start over with their version.
    const v2 = await drive.getVersion(fileId);
    if (String(v2) !== String(version)) continue;

    await drive.write(fileId, merged);

    // Verify: read back and make sure our ops really are there.
    const check = await drive.readWithVersion(fileId);
    const after = parseRemote(check.text);
    if (opsLanded(after, ops)) return finish(after, lost.length);
    // Someone overwrote us in the tiny window between check and write -> loop and re-apply.
  }
  throw new ConflictError();
}
