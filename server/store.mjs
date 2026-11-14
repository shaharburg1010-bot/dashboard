// server/store.mjs — the dashboard's data inside SQLite (same file OpenClaw uses: life.db).
//   dash_sections : one row per dashboard area (tasks, debts, finance, leisure, spending, diet) + its version
//   dash_items    : one row per item, in the exact sync format the app uses (data = JSON incl. _f times)
//   dash_history  : the last few full copies of each area, in case something goes wrong
// The app's sync engine (../sync.js) stays the single place that defines how changes merge.
import { DatabaseSync } from 'node:sqlite';
import { applyOps, validateDoc, emptyDoc, SCHEMA_VERSION, clone } from '../sync.js';
import { SECTION_IDS, pickSection, collectionsOf, sectionOfOp } from '../sections.js';

export const HISTORY_KEEP = 30;
export class BadRequest extends Error { constructor(m) { super(m); this.name = 'BadRequest'; this.status = 400; } }
export class Conflict extends Error { constructor(m, version) { super(m); this.name = 'Conflict'; this.status = 409; this.version = version; } }

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
        const doc = applyOps(cur.doc, list);
        doc.schemaVersion = SCHEMA_VERSION;
        save(sec, doc, cur.version + 1, by);
        out[sec] = cur.version + 1;
      }
      return { versions: out };
    });
  }

  return { read, write, applyOps: applyOpsToSections, close: () => db.close(), db };
}
