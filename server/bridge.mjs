// server/bridge.mjs — the server does the Drive work itself (no phone needed):
//   1. inbox files ("dashboard-inbox") that Claude's agents drop in Drive -> applied here, then trashed
//   2. the investment portfolio block in "תיק השקעות.md" -> applied when it changed
//   3. dashboard-snapshot.json (read-only copy for the agents) -> rewritten when the data changed
//   4. once a day, a copy of the whole life.db -> Drive folder "גיבוי דשבורד" (last 14 kept)
// Changes go through the same merge as everything else (store.applyOps), exactly as if typed on the phone.
// Runs every few minutes, and right away when the app asks (POST /v1/pull, the sync button).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SECTION_IDS, SECTION_NAMES, mergeDocs } from '../sections.js';
import { toState, diff } from '../model.js';
import { INBOX_MARK, applyChanges, parseLoose } from '../inbox.js';
import { PORTFOLIO_NAME, extractPortfolio, portfolioChanges } from '../portfolio.js';

// true when the file gives a cost that the data no longer has
export function portfolioCostsMissing(view, p) {
  const fin = (view && view.finance) || {};
  const st = (fin.shortTerm && fin.shortTerm.items) || [];
  const hs = (fin.shortMedium && fin.shortMedium.ibkr && fin.shortMedium.ibkr.holdings) || [];
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  for (const x of p.shortTerm || []) {
    if (!x || !isNum(x.costIls)) continue;
    const d = st.find((y) => y && String(y.sid) === String(x.sid));
    if (d && !isNum(d.costIls)) return true;
  }
  for (const h of p.holdings || []) {
    if (!h || !isNum(h.costUsd)) continue;
    const d = hs.find((y) => y && y.ticker === h.ticker);
    if (d && !isNum(d.costBasis)) return true;
  }
  return false;
}
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const dayIL = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });   // YYYY-MM-DD

// Same view the app's screens get (boot.js currentView/withDefaults), built from the server's copy.
export function serverView(store) {
  const v = toState(mergeDocs(SECTION_IDS.map((s) => store.read(s).doc)));
  v.sports = Object.assign({ days: [], workoutLog: [], runs: [] }, v.sports || {});
  v.leisure = Object.assign({ books: [], movies: [], travel: [], learning: [], cooking: [] }, v.leisure || {});
  if (!v.debts) v.debts = [];
  return v;
}

export function makeBridge({ store, drive, folders, inboxFolders, snapshotFolder, snapshotName,
  backupFolderName = 'גיבוי דשבורד', backupKeep = 14, log = (m) => console.log(m), now = () => Date.now() }) {
  store.db.exec('CREATE TABLE IF NOT EXISTS dash_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const qGet = store.db.prepare('SELECT value FROM dash_meta WHERE key = ?');
  const qSet = store.db.prepare('INSERT INTO dash_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const getMeta = (k) => { const r = qGet.get(k); return r ? JSON.parse(r.value) : null; };
  const setMeta = (k, v) => qSet.run(k, JSON.stringify(v));

  const st = { lastRun: null, lastOk: null, lastError: null, recent: getMeta('recent') || [] };
  function note(msg) {
    st.recent.unshift(new Date(now()).toISOString() + ' ' + msg);
    st.recent = st.recent.slice(0, 30);
    setMeta('recent', st.recent);
    log('bridge: ' + msg);
  }

  // Inbox-style changes -> ops on the server copy. Returns how many ops were written.
  function apply(changes, by) {
    const view = serverView(store);
    const { state, errors } = applyChanges(view, changes);
    // An agent's change replaces a block on purpose (like the phone does), so no "would drop" refusal.
    const ops = diff(view, state).map((op) => ({ ...op, replace: true }));
    if (ops.length) store.applyOps(ops, by);
    return { n: ops.length, errors };
  }
  const hasData = () => serverView(store).finance !== undefined;

  async function pullInbox() {
    const done = getMeta('inboxDone') || [];
    for (const sec of SECTION_IDS) {
      const folder = inboxFolders[sec];
      if (!folder) continue;
      for (const f of await drive.listInFolder(folder, INBOX_MARK)) {
        if (!done.includes(f.id)) {
          let cmd;
          try { cmd = parseLoose(await drive.readText(f.id)); }
          catch (e) { note(`קובץ עדכון לא תקין, נשאר בדרייב (${f.name}): ${e.message}`); continue; }
          const r = apply(cmd.changes, 'inbox:' + String(cmd.by || 'claude').slice(0, 40));
          done.push(f.id); setMeta('inboxDone', done.slice(-300));
          note(`עדכון מ-${cmd.by || 'Claude'} (${SECTION_NAMES[sec]}): ${r.n} שינויים` + (r.errors.length ? ' · דולגו: ' + r.errors.join('; ') : ''));
        }
        try { await drive.trash(f.id); } catch (e) { note('לא הצלחתי להעביר לפח ' + f.name + ': ' + e.message); }
      }
    }
  }

  async function pullPortfolio() {
    const id = await drive.findInFolder(folders.finance, PORTFOLIO_NAME);
    if (!id) return;
    const found = extractPortfolio(await drive.readText(id));
    if (!found) return;
    const view = serverView(store);
    // Applied once per change of the block, and again if a cost from the file went missing from the data:
    // the phone writes a whole block (e.g. finance.shortTerm) when it updates prices, so if it did that
    // from a copy older than the portfolio change, it drops the costs. (Happened 23.11.2026.)
    if (getMeta('portfolioApplied') === hash(found.text) && !portfolioCostsMissing(view, found.data)) return;
    const r = apply(portfolioChanges(view, found.data), 'portfolio');
    setMeta('portfolioApplied', hash(found.text));
    note(`תיק ההשקעות מהקובץ (${found.data.asOf || ''}): ${r.n} שינויים` + (r.errors.length ? ' · דולגו: ' + r.errors.join('; ') : ''));
  }

  async function writeSnapshot() {
    const data = serverView(store);
    delete data.currentRoute;
    const text = JSON.stringify(data);
    const h = hash(text);
    if (getMeta('snapshotHash') === h) return;
    const doc = { note: 'עותק לקריאה בלבד של נתוני הדשבורד (נכתב על ידי השרת). לשינוי: קובץ dashboard-inbox (ראו inbox.js).', at: new Date(now()).toISOString(), data };
    const id = await drive.findInFolder(snapshotFolder, snapshotName);
    if (id) await drive.write(id, doc);
    else await drive.createIn(snapshotFolder, snapshotName, JSON.stringify(doc, null, 1));
    setMeta('snapshotHash', h);
  }

  async function backup() {
    const day = dayIL(now());
    if (getMeta('backupDay') === day) return;
    const tmp = path.join(os.tmpdir(), `life-backup-${process.pid}-${now()}.db`);
    try {
      store.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);   // a consistent copy, even while writing
      const folder = await drive.ensureFolder(snapshotFolder, backupFolderName);
      await drive.uploadBinary(folder, `life-${day}.db`, fs.readFileSync(tmp));
      const all = await drive.listInFolder(folder, 'life-');          // oldest first
      for (const f of all.slice(0, Math.max(0, all.length - backupKeep))) await drive.trash(f.id);
      setMeta('backupDay', day);
      note('גיבוי יומי של life.db נשמר בדרייב');
    } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }

  let running = null;
  async function runOnce() {
    st.lastRun = new Date(now()).toISOString();
    const errs = [];
    try { await drive.ensureToken(); }
    catch (e) { st.lastError = e.message; note(e.message); return; }
    if (hasData()) {
      for (const [name, fn] of [['inbox', pullInbox], ['תיק השקעות', pullPortfolio], ['snapshot', writeSnapshot]]) {
        try { await fn(); } catch (e) { errs.push(name + ': ' + e.message); }
      }
    }
    try { await backup(); } catch (e) { errs.push('גיבוי: ' + e.message); }
    if (errs.length) { st.lastError = errs.join(' · '); errs.forEach(note); }
    else { st.lastError = null; st.lastOk = st.lastRun; }
  }

  return {
    // minGapMs: when asked from the app, don't hit Drive again if it was just checked.
    run({ minGapMs = 0 } = {}) {
      if (running) return running;
      if (minGapMs && st.lastRun && now() - Date.parse(st.lastRun) < minGapMs) return Promise.resolve();
      running = runOnce().finally(() => { running = null; });
      return running;
    },
    status() { return { configured: true, lastRun: st.lastRun, lastOk: st.lastOk, lastError: st.lastError, recent: st.recent.slice(0, 10) }; },
  };
}
