// server/store.mjs — the dashboard's data inside SQLite (same file OpenClaw uses: life.db).
//   dash_sections : one row per dashboard area (tasks, debts, finance, leisure, spending, diet) + its version
//   dash_items    : one row per item, in the exact sync format the app uses (data = JSON incl. _f times)
//   dash_history  : the last few full copies of each area, in case something goes wrong
// The app's sync engine (../sync.js) stays the single place that defines how changes merge.
import { DatabaseSync } from 'node:sqlite';
import { applyOps, validateDoc, emptyDoc, SCHEMA_VERSION, clone } from '../sync.js';
import { SECTION_IDS, pickSection, collectionsOf, sectionOfOp, sectionOfField } from '../sections.js';
import { LISTS } from '../model.js';

export const HISTORY_KEEP = 30;
export class BadRequest extends Error { constructor(m) { super(m); this.name = 'BadRequest'; this.status = 400; } }
export class Conflict extends Error { constructor(m, version) { super(m); this.name = 'Conflict'; this.status = 409; this.version = version; } }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SPLIT_TOPS = new Set(['finance', 'sports', 'leisure', 'diet']);   // same split as model.js
const BAD_SEG = new Set(['__proto__', 'constructor', 'prototype']);

// A block ("finance.shortMedium") is stored as one value, so writing it replaces all of it.
// Keys that the new value would silently remove (the mistake that emptied the finance page).
export function droppedKeys(prev, next) {
  if (!isObj(prev)) return [];
  if (!isObj(next)) return Object.keys(prev);
  return Object.keys(prev).filter((k) => !(k in next));
}

// "finance.shortMedium.ibkr.cashUsd" -> { id: "finance.shortMedium", rest: ["ibkr", "cashUsd"] }
export function splitPath(path) {
  if (typeof path !== 'string' || !path || path.includes(':')) throw new BadRequest('bad path');
  const segs = path.split('.');
  if (segs.some((x) => !x || BAD_SEG.has(x))) throw new BadRequest('bad path ' + path);
  for (const l of Object.keys(LISTS)) {
    if (path === l || path.startsWith(l + '.')) throw new BadRequest(l + ' is a list: change its items with /v1/ops');
  }
  const n = SPLIT_TOPS.has(segs[0]) ? 2 : 1;
  if (segs.length < n) throw new BadRequest('path too short: ' + path);
  return { id: segs.slice(0, n).join('.'), rest: segs.slice(n) };
}

// Sets one inner value, leaving everything around it untouched. Returns the new whole block.
function setDeep(root, rest, value, path) {
  if (!rest.length) return value;
  const out = root === undefined ? {} : clone(root);
  if (!isObj(out)) throw new BadRequest('cannot set inside ' + path + ': the block is not an object');
  let o = out;
  for (let i = 0; i < rest.length - 1; i++) {
    const k = rest[i];
    if (Array.isArray(o)) {
      if (!/^\d+$/.test(k) || Number(k) >= o.length) throw new BadRequest('no such list position in ' + path + ': ' + k);
    } else if (o[k] === undefined || o[k] === null) o[k] = {};
    if (o[k] === null || typeof o[k] !== 'object') throw new BadRequest('cannot set inside ' + path + ': ' + k + ' is not an object');
    o = o[k];
  }
  const last = rest[rest.length - 1];
  if (Array.isArray(o) && (!/^\d+$/.test(last) || Number(last) > o.length)) throw new BadRequest('no such list position in ' + path + ': ' + last);
  o[last] = value;
  return out;
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS dash_sections(sec TEXT PRIMARY KEY, version INTEGER NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dash_items(sec TEXT NOT NULL, coll TEXT NOT NULL, id TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL, PRIMARY KEY(sec, coll, id));
    CREATE TABLE IF NOT EXISTS dash_history(sec TEXT NOT NULL, version INTEGER NOT NULL, at TEXT NOT NULL, by TEXT, doc TEXT NOT NULL,
      PRIMARY KEY(sec, version));
  `);
  const q = {
    getSec: db.prepare('SELECT version, updated FROM dash_sections WHERE sec = ?'),
    upsertSec: db.prepare('INSERT INTO dash_sections(sec, version, updated) VALUES(?, ?, ?) ON CONFLICT(sec) DO UPDATE SET version = excluded.version, updated = excluded.updated'),
    items: db.prepare('SELECT coll, data FROM dash_items WHERE sec = ? ORDER BY rowid'),
    ids: db.prepare('SELECT coll, id FROM dash_items WHERE sec = ?'),
    delItems: db.prepare('DELETE FROM dash_items WHERE sec = ?'),
    putItem: db.prepare('INSERT INTO dash_items(sec, coll, id, deleted, data) VALUES(?, ?, ?, ?, ?)'),
    addHist: db.prepare('INSERT OR REPLACE INTO dash_history(sec, version, at, by, doc) VALUES(?, ?, ?, ?, ?)'),
    trimHist: db.prepare('DELETE FROM dash_history WHERE sec = ? AND version <= ?'),
  };

  function checkSec(sec) { if (!SECTION_IDS.includes(sec)) throw new BadRequest('unknown section ' + sec); }

  // -> { exists, version, updated, doc }   (doc holds only this section's lists)
  function read(sec) {
    checkSec(sec);
    const row = q.getSec.get(sec);
    const doc = pickSection(emptyDoc(), sec);
    if (!row) return { exists: false, version: 0, updated: null, doc };
    for (const r of q.items.all(sec)) (doc[r.coll] || (doc[r.coll] = [])).push(JSON.parse(r.data));
    return { exists: true, version: row.version, updated: row.updated, doc };
  }

  function save(sec, doc, version, by) {
    const now = new Date().toISOString();
    q.delItems.run(sec);
    for (const coll of [...collectionsOf(sec), 'fields']) {
      for (const it of doc[coll] || []) q.putItem.run(sec, coll, it.id, it.deleted ? 1 : 0, JSON.stringify(it));
    }
    q.upsertSec.run(sec, version, now);
    q.addHist.run(sec, version, now, by || null, JSON.stringify(doc));
    q.trimHist.run(sec, version - HISTORY_KEEP);
  }

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // Whole-section write from the app. Refused unless the caller saw the latest version,
  // and refused if it would drop an item (the app never removes items, it marks them deleted).
  function write(sec, incoming, baseVersion, by) {
    checkSec(sec);
    let doc;
    try { doc = pickSection(validateDoc(clone(incoming)), sec); } catch (e) { throw new BadRequest('bad doc: ' + e.message); }
    return tx(() => {
      const cur = q.getSec.get(sec);
      const curVersion = cur ? cur.version : 0;
      if (Number(baseVersion) !== curVersion) throw new Conflict('version changed', curVersion);
      const have = new Set();
      for (const coll of [...collectionsOf(sec), 'fields']) for (const it of doc[coll] || []) have.add(coll + '\u0000' + it.id);
      for (const r of q.ids.all(sec)) {
        if (!have.has(r.coll + '\u0000' + r.id)) throw new BadRequest('write would drop ' + r.coll + '/' + r.id);
      }
      save(sec, doc, curVersion + 1, by);
      return { version: curVersion + 1 };
    });
  }

  // Changes from OpenClaw (or any script): merged on the server with the app's own rules.
  function applyOpsToSections(ops, by) {
    if (!Array.isArray(ops) || !ops.length) throw new BadRequest('ops must be a non-empty list');
    const bySec = new Map();
    for (const op of ops) {
      if (!op || typeof op.coll !== 'string' || typeof op.id !== 'string' || !op.id || !op.fields || typeof op.fields !== 'object'
        || typeof op.at !== 'string' || Number.isNaN(Date.parse(op.at))) throw new BadRequest('bad op');
      let sec;
      try { sec = sectionOfOp(op); } catch (e) { throw new BadRequest(e.message); }
      if (!bySec.has(sec)) bySec.set(sec, []);
      bySec.get(sec).push(op);
    }
    return tx(() => {
      const out = {};
      for (const [sec, list] of bySec) {
        const cur = read(sec);
        // A script replacing a whole block must not lose parts of it by accident.
        if (by !== 'seed') {
          const work = clone(cur.doc);
          for (const op of list) {
            if (op.coll === 'fields' && 'value' in op.fields && op.replace !== true) {
              const it = work.fields.find((x) => x.id === op.id);
              const wins = it && (!it._f || !it._f.value || op.at >= it._f.value);
              const gone = it && !it.deleted && wins ? droppedKeys(it.value, op.fields.value) : [];
              if (gone.length) throw new BadRequest('writing ' + op.id + ' would drop: ' + gone.join(', ')
                + '. Change one inner value with POST /v1/set, or send "replace": true on the op to really replace the block');
            }
            applyOps(work, [op]);
          }
        }
        const doc = applyOps(cur.doc, list);
        doc.schemaVersion = SCHEMA_VERSION;
        save(sec, doc, cur.version + 1, by);
        out[sec] = cur.version + 1;
      }
      return { versions: out };
    });
  }

  // Safe updates for OpenClaw (or any script): each one changes a single value by its path,
  // e.g. { path: "finance.shortMedium.ibkr.cashUsd", value: 120 }. The rest of the block stays.
  function setPaths(sets, by) {
    if (!Array.isArray(sets) || !sets.length) throw new BadRequest('sets must be a non-empty list');
    const parsed = sets.map((x) => {
      if (!x || !('value' in x) || x.value === undefined) throw new BadRequest('each set needs path and value');
      const { id, rest } = splitPath(x.path);
      return { id, rest, value: x.value, path: x.path, replace: x.replace === true, sec: sectionOfField(id) };
    });
    return tx(() => {
      const out = {};
      for (const sec of new Set(parsed.map((x) => x.sec))) {
        const cur = read(sec);
        const doc = cur.doc;
        for (const x of parsed.filter((y) => y.sec === sec)) {
          const it = doc.fields.find((f) => f.id === x.id);
          const prev = it && !it.deleted ? it.value : undefined;
          const next = setDeep(prev, x.rest, clone(x.value), x.path);
          if (!x.rest.length && !x.replace) {
            const gone = droppedKeys(prev, next);
            if (gone.length) throw new BadRequest('writing ' + x.id + ' would drop: ' + gone.join(', ')
              + '. Set the inner paths one by one, or send "replace": true to really replace the block');
          }
          // The server's clock decides, and this write always lands (even if a device's clock ran ahead).
          let at = new Date().toISOString();
          const last = it && it._f && it._f.value;
          if (last && last >= at) at = new Date(Date.parse(last) + 1).toISOString();
          applyOps(doc, [{ coll: 'fields', id: x.id, fields: { value: next, deleted: false }, at }]);
        }
        doc.schemaVersion = SCHEMA_VERSION;
        save(sec, doc, cur.version + 1, by);
        out[sec] = cur.version + 1;
      }
      return { versions: out };
    });
  }

  // Earlier copies of an area (the last HISTORY_KEEP writes), to look at or to restore from.
  const qh = {
    list: db.prepare('SELECT version, at, by FROM dash_history WHERE sec = ? ORDER BY version DESC'),
    one: db.prepare('SELECT version, at, by, doc FROM dash_history WHERE sec = ? AND version = ?'),
  };
  function history(sec) { checkSec(sec); return { versions: qh.list.all(sec) }; }
  function historyDoc(sec, version) {
    checkSec(sec);
    const r = qh.one.get(sec, Number(version));
    if (!r) throw new BadRequest('no such version');
    return { version: r.version, at: r.at, by: r.by, doc: JSON.parse(r.doc) };
  }

  return { read, write, applyOps: applyOpsToSections, setPaths, history, historyDoc, close: () => db.close(), db };
}
