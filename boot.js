// boot.js — starts the app: loads the phone's local copy, starts the dashboard screens (legacy.js),
// turns every change into ops for the sync engine, and brings in updates from Drive.
// Data lives in four MEMORY.md files (one per area, see sections.js); each is synced on its own.
import { syncOnce, localView, clone, validateDoc } from './sync.js';
import { hasBlock, extractBlock, replaceBlock, rewriteSections, stringifyDoc } from './memfile.js';
import { SECTION_IDS, SECTION_NAMES, sectionOfOp, mergeDocs, pickSection } from './sections.js';
import { makeMemDrive, sectionStore } from './memdrive.js';
import { FOLDERS, INBOX_FOLDERS, SNAPSHOT_FOLDER, SNAPSHOT_NAME, PRICES_URL, SERVER_URL } from './config.js';
import { makeServerDrive, seedServer } from './serverdrive.js';
import { applyPrices } from './prices.js';
import { INBOX_MARK, applyChanges, parseLoose } from './inbox.js';
import { PORTFOLIO_NAME, extractPortfolio, portfolioChanges } from './portfolio.js';
import { toState, diff } from './model.js';
import { sortieStats, toIsoDate, prunePast, keepFrom, moveSortiesToArmy, dayPeriodName } from './sorties.js';
import { store } from './store.js';
import { makeDrive } from './drive.js';
import * as auth from './auth.js';
import { installClaudeShim } from './calendar.js';

const drive = makeDrive(auth.getToken, () => auth.signOut());
// Where this device syncs: Google Drive (the MEMORY.md files) or Shahar's own server (SQLite).
// Chosen per device with the button in the sync panel; Drive until switched.
const BACKEND_KEY = 'syncBackend';
const useServer = () => { try { return localStorage.getItem(BACKEND_KEY) === 'server'; } catch (e) { return false; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const withoutRoute = (s) => { const c = clone(s); delete c.currentRoute; return c; };

// ---------------- local state ----------------
let lastState = null;         // exactly what the screens show right now
let remoteCb = null;          // legacy.js: replace STATE + re-render
let pendingRemote = null;     // an update from Drive waiting until you finish editing
let saveChain = Promise.resolve();
let saveSeq = 0;

async function currentView() {
  const snaps = await Promise.all(SECTION_IDS.map((s) => store.getMeta(s + ':snapshot')));
  // Each file only contributes its own lists (e.g. diet data left in an older leisure copy is ignored).
  const own = snaps.map((d, i) => (d ? pickSection(d, SECTION_IDS[i]) : d));
  return withDefaults(toState(localView(mergeDocs(own), await store.getOutbox())));
}
// The screens expect these objects to exist even if a list is still empty.
function withDefaults(v) {
  v.sports = Object.assign({ days: [], workoutLog: [], runs: [] }, v.sports || {});
  v.leisure = Object.assign({ books: [], movies: [], travel: [], learning: [], cooking: [] }, v.leisure || {});
  if (!v.debts) v.debts = [];
  return v;
}
function hasData(view) { return view && view.finance !== undefined; }
function hasItems(doc) {
  return !!doc && Object.keys(doc).some((k) => Array.isArray(doc[k]) && doc[k].some((x) => !x.deleted));
}

window.__DASH__ = {
  initialState: () => clone(lastState),
  sortieStats, toIsoDate, prunePast, keepFrom, dayPeriodName,   // גיחות page (sorties.js)
  // Called by the screens after every change (instead of republishing the page).
  save(state) {
    const ops = diff(lastState, state);
    if (!ops.length) return;
    lastState = withoutRoute(state);
    saveSeq++;
    saveChain = saveChain.then(() => store.addOps(ops)).then(() => { updateStatus(); scheduleSync(800); })
      .catch((e) => log('שמירה במכשיר נכשלה: ' + e.message));
  },
  onRemoteState(cb) { remoteCb = cb; },
  // Diet page: after saving keys in this browser, copy them to Drive now (or on the next sync).
  async saveSecrets() {
    if (!navigator.onLine || !auth.getToken()) return false;
    await syncSecrets(true);
    return true;
  },
};

// Don't yank the screen while you're typing, dragging, or have a calendar panel open.
function busy() {
  const a = document.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && document.getElementById('app').contains(a)) return true;
  return !!document.querySelector('#app .dragging, #app .cal-panel');
}
function applyRemoteWhenIdle() {
  if (!pendingRemote || !remoteCb) return;
  if (busy()) { setTimeout(applyRemoteWhenIdle, 1500); return; }
  const next = pendingRemote; pendingRemote = null;
  lastState = withoutRoute(next);
  remoteCb(clone(next));
}

async function refreshFromStore() {
  const seq = saveSeq;
  await saveChain;                      // make sure every local change is in the outbox first
  const view = await currentView();
  if (seq !== saveSeq) return;          // you changed something meanwhile; next sync will catch up
  if (!lastState) return;
  if (same(view, lastState)) return;
  pendingRemote = view;
  applyRemoteWhenIdle();
}

// ---------------- sync ----------------
let syncState = 'idle', syncMsg = '';
let running = null, timer = null, again = false;
function scheduleSync(ms) { clearTimeout(timer); timer = setTimeout(runSync, ms); }

async function runSync() {
  if (running) { again = true; return running; }
  if (!navigator.onLine) { syncState = 'offline'; updateStatus(); return; }
  const server = useServer();
  if (!server && !auth.getToken()) { syncState = 'needs-auth'; updateStatus(); return; }
  syncState = 'syncing'; updateStatus();
  running = (async () => {
    try {
      await saveChain;
      // Inbox files from the agents live in Drive. On the server too, read them whenever this device is
      // signed in to Google: their changes become ordinary local changes and go to the server below.
      let inboxFiles = [];
      if (!server) inboxFiles = await pullInbox();
      else if (auth.getToken()) {
        try { inboxFiles = await pullInbox(); }
        catch (e) { log('לא הצלחתי לקרוא עדכונים מ-Drive: ' + e.message); }   // never blocks the server sync
      }
      // The investment portfolio comes from one file in Drive (see portfolio.js). Never blocks the sync.
      if (auth.getToken()) {
        try { await pullPortfolio(); }
        catch (e) { if (!server && (e.name === 'AuthError' || e.name === 'NetError')) throw e; log('תיק ההשקעות מ-Drive: ' + e.message); }
      }
      await pullPrices(forcePrices); forcePrices = false;
      if (!server) { try { await syncSecrets(); } catch (e) { if (e.name === 'AuthError' || e.name === 'NetError') throw e; log('מפתחות AI: ' + e.message); } }
      else if (auth.getToken()) { try { await syncSecrets(); } catch (e) { log('מפתחות AI: ' + e.message); } }
      let pushed = 0, restored = 0; const failed = [];
      for (const sec of SECTION_IDS) {
        const md = server ? makeServerDrive(SERVER_URL, sec)
          : makeMemDrive(drive, sec, FOLDERS[sec], { hasLocalData: async () => hasItems(await store.getMeta(sec + ':snapshot')) });
        try {
          // First time this device meets the server: send everything it has (safe to repeat, see serverdrive.js).
          if (server && !(await store.getMeta(sec + ':serverSeeded'))) {
            const snap = await store.getMeta(sec + ':snapshot');
            const n = snap ? await seedServer(SERVER_URL, pickSection(snap, sec)) : 0;
            await store.setMeta(sec + ':serverSeeded', new Date().toISOString());
            if (n) log(`הועלו לשרת (${SECTION_NAMES[sec]}): ${n} שינויים`);
          }
          const r = await syncOnce(md, sectionStore(store, sec, sectionOfOp));
          pushed += r.pushed; restored += r.restored;
        } catch (e) {
          if (e.name === 'AuthError' || e.name === 'NetError') throw e; // whole round stops
          // A server not yet updated (git pull + restart) doesn't know a new section: skip it quietly, nothing is lost.
          if (server && /unknown section/.test(e.message)) { log(`השרת עוד לא מכיר את "${SECTION_NAMES[sec]}" - צריך לעדכן אותו (git pull + restart)`); continue; }
          failed.push(SECTION_NAMES[sec] + ': ' + e.message);
        }
      }
      if (failed.length < SECTION_IDS.length) await store.setMeta('lastSync', new Date().toISOString());
      // Inbox files whose changes are now in MEMORY.md go to the trash.
      for (const f of inboxFiles) if (!failed.some((m) => m.startsWith(SECTION_NAMES[f.sec] + ':'))) {
        try { await drive.trash(f.id); } catch (e) { log('לא הצלחתי להעביר לפח קובץ עדכון: ' + e.message); }
      }
      // One-time: the גיחות page moves from לו"ז ומשימות to צבא, only once the server (or Drive) already holds a צבא section.
      if (!failed.some((m) => m.startsWith(SECTION_NAMES.army + ':')) && (await store.getMeta('army:snapshot'))) {
        try {
          await saveChain;
          const view = await currentView();
          const next = moveSortiesToArmy(view);
          const ops = next ? diff(view, next) : [];
          if (ops.length) { await store.addOps(ops); log('דף הגיחות עבר לקטגוריה צבא'); again = true; }
        } catch (e) { log('העברת הגיחות לצבא: ' + e.message); }
      }
      if (pushed || restored) log(`סונכרן · נשלחו ${pushed}` + (restored ? ` · שוחזרו ${restored}` : ''));
      if (failed.length) { syncState = 'error'; syncMsg = failed.length + ' קבצים לא סונכרנו'; failed.forEach((m) => log(m)); }
      else { syncState = 'ok'; syncMsg = ''; }
      if (!lastState) { await startApp(); if (!started) await showMissingData(); }
      else await refreshFromStore();
      if (server && !failed.length && auth.getToken()) {
        try { await writeSnapshot(); } catch (e) { log('עותק לסוכנים ב-Drive: ' + e.message); }
      }
    } catch (e) {
      if (e.name === 'AuthError') { syncState = 'needs-auth'; log('צריך להתחבר מחדש'); }
      else if (e.name === 'NetError') { syncState = 'offline'; log((server ? 'אין חיבור לשרת: ' : 'אין רשת: ') + e.message); }
      else if (e.name === 'CorruptRemoteError') { syncState = 'error'; syncMsg = 'הקובץ ב-Drive לא תקין — לא נגעתי בו'; log('קובץ פגום: ' + e.message); }
      else if (e.name === 'ConflictError') { syncState = 'error'; syncMsg = 'שינויים במקביל, מנסה שוב'; scheduleSync(5000); }
      else { syncState = 'error'; syncMsg = e.message; log('שגיאה: ' + e.message); }
    } finally {
      running = null; updateStatus();
      if (again) { again = false; scheduleSync(300); }
    }
  })();
  return running;
}

window.addEventListener('online', () => { log('הרשת חזרה'); runSync(); });
window.addEventListener('offline', () => { syncState = 'offline'; updateStatus(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runSync(); });
setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 60000);

// ---------------- status pill + panel ----------------
const $ = (id) => document.getElementById(id);
const LOG_KEY = 'synclog';
function log(msg) {
  let lines = [];
  try { lines = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) {}
  lines.unshift(new Date().toLocaleString('he-IL') + '  ' + msg); lines = lines.slice(0, 40);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)); } catch (e) {}
  if ($('syncLog')) $('syncLog').textContent = lines.join('\n');
}

async function updateStatus() {
  const pending = (await store.getOutbox()).length;
  const online = navigator.onLine;
  let text, cls;
  const server = useServer();
  if (syncState === 'syncing' || (syncState === 'idle' && online && (server || auth.getToken()))) { text = 'מסנכרן…'; cls = 'busy'; }
  else if (syncState === 'needs-auth') { text = pending ? `${pending} ממתינים · להתחבר` : 'להתחבר לסנכרון'; cls = 'warn'; }
  else if (syncState === 'error') { text = 'שגיאה: ' + syncMsg; cls = 'err'; }
  else if (!online || syncState === 'offline') { text = pending ? `אופליין · ${pending} ממתינים` : 'אופליין · הכול שמור'; cls = 'warn'; }
  else if (pending) { text = `${pending} ממתינים`; cls = 'warn'; }
  else if (syncState === 'ok') { text = 'מסונכרן ✓'; cls = 'ok'; }
  else { text = 'לא סונכרן'; cls = 'warn'; }
  for (const el of document.querySelectorAll('[data-sync-status]')) { el.textContent = text; el.className = 'sync-pill ' + cls; }
  const last = await store.getMeta('lastSync');
  const signedIn = !!auth.getToken();
  const exp = auth.tokenExpiry();
  if ($('syncLast')) $('syncLast').textContent = (last ? 'סנכרון אחרון: ' + new Date(last).toLocaleString('he-IL') : 'עדיין לא סונכרן') + (signedIn && exp ? ' · מחובר עד ' + exp.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '');
  for (const el of document.querySelectorAll('[data-when-signed-in]')) el.hidden = !(signedIn || server);
  if ($('syncTitle')) $('syncTitle').textContent = server ? 'סנכרון עם השרת של שחר' : 'סנכרון עם Google Drive';
  for (const el of document.querySelectorAll('[data-act=backend]')) el.textContent = server ? 'חזור לסנכרון מול Google Drive' : 'עבור לסנכרון מול השרת';
  for (const el of document.querySelectorAll('[data-when-signed-out]')) el.hidden = signedIn;
}

function wireButtons() {
  const after = async () => { log('התחברת ל-Google'); await updateStatus(); runSync(); };
  for (const b of document.querySelectorAll('[data-act=popup]')) b.addEventListener('click', () => auth.signInPopup().then(after).catch((e) => { log('התחברות נכשלה: ' + e.message); updateStatus(); }));
  for (const b of document.querySelectorAll('[data-act=redirect]')) b.addEventListener('click', () => auth.signInRedirect());
  for (const b of document.querySelectorAll('[data-act=sync]')) b.addEventListener('click', () => { forcePrices = true; runSync(); });
  for (const b of document.querySelectorAll('[data-act=signout]')) b.addEventListener('click', () => { auth.signOut(); syncState = 'needs-auth'; log('התנתקת (הנתונים נשארו במכשיר)'); updateStatus(); });
  for (const b of document.querySelectorAll('[data-act=backend]')) b.addEventListener('click', switchBackend);
  $('syncPill').addEventListener('click', () => { $('syncPanel').hidden = !$('syncPanel').hidden; });
  $('syncClose').addEventListener('click', () => { $('syncPanel').hidden = true; });
}

// Switch this device between Drive and the server. Before going to the server we try one more Drive
// sync so the copy that gets uploaded is as fresh as possible, but a Drive problem does not block the
// move: the upload is a merge by time, and changes still waiting on this device go to the server too.
// Nothing is deleted on either side.
async function switchBackend() {
  if (useServer()) {
    localStorage.setItem(BACKEND_KEY, 'drive');
    log('חזרת לסנכרון מול Google Drive');
  } else {
    await runSync();
    if (syncState !== 'ok') log('הסנכרון האחרון מול Drive לא הושלם. עוברים בכל זאת: מה ששמור במכשיר הזה יעלה לשרת');
    localStorage.setItem(BACKEND_KEY, 'server');
    log('עברת לסנכרון מול השרת');
  }
  syncState = 'idle'; await updateStatus(); runSync();
}

// ---------------- changes from Claude / the agents (inbox files, see inbox.js) ----------------
async function pullInbox() {
  const out = [];
  if (!hasData(await currentView())) return out;   // only once the data itself is here
  const done = (await store.getMeta('inboxDone')) || [];
  for (const sec of SECTION_IDS) {
    const files = await drive.listInFolder(INBOX_FOLDERS[sec], INBOX_MARK);
    for (const f of files) {
      out.push({ id: f.id, sec });
      if (done.includes(f.id)) continue;                // already applied, only the trash step failed
      try {
        const cmd = parseLoose(await drive.readText(f.id));
        await saveChain;
        const view = await currentView();
        const { state, errors } = applyChanges(view, cmd.changes);
        const ops = diff(view, state);
        await store.addOps(ops);
        done.push(f.id);
        await store.setMeta('inboxDone', done.slice(-200));
        log(`עדכון מ-${cmd.by || 'Claude'} (${SECTION_NAMES[sec]}): ${ops.length} שינויים` + (errors.length ? ' · דולגו: ' + errors.join('; ') : ''));
      } catch (e) {
        out.pop();                                       // keep the file; show the problem
        log('קובץ עדכון לא תקין (' + f.name + '): ' + e.message);
      }
    }
  }
  return out;
}

// ---------------- the investment portfolio (one file in Drive, see portfolio.js) ----------------
// "תיק השקעות.md" in the finance folder is the source of truth for holdings, cash and the buy plan.
// Applied only when its block changed since the last time, as ordinary local changes.
async function pullPortfolio() {
  if (!hasData(await currentView())) return;
  const id = await drive.findInFolder(FOLDERS.finance, PORTFOLIO_NAME);
  if (!id) return;
  const found = extractPortfolio(await drive.readText(id));
  if (!found) return;
  if ((await store.getMeta('portfolioApplied')) === found.text) return;
  await saveChain;
  const view = await currentView();
  const { state, errors } = applyChanges(view, portfolioChanges(view, found.data));
  const ops = diff(view, state);
  if (ops.length) await store.addOps(ops);
  await store.setMeta('portfolioApplied', found.text);
  log(`תיק ההשקעות מהקובץ (${found.data.asOf || ''}): ${ops.length} שינויים` + (errors.length ? ' · דולגו: ' + errors.join('; ') : ''));
}

// ---------------- read-only copy for the agents (server mode) ----------------
// Claude's agents run in the cloud and cannot reach the server, so after a good sync this device
// leaves them a copy of the current data in Drive (at most every 10 minutes, only when it changed).
// They read ids and values from it and send changes through inbox files (see inbox.js).
let snapshotAt = 0, snapshotText = '';
async function writeSnapshot() {
  if (Date.now() - snapshotAt < 10 * 60 * 1000) return;
  const view = await currentView();
  if (!hasData(view)) return;
  const data = withoutRoute(view);
  const text = JSON.stringify(data);
  if (text === snapshotText) { snapshotAt = Date.now(); return; }
  const body = JSON.stringify({ note: 'עותק לקריאה בלבד של נתוני הדשבורד. לשינוי: קובץ dashboard-inbox (ראו inbox.js).', at: new Date().toISOString(), data }, null, 1);
  const id = await drive.findInFolder(SNAPSHOT_FOLDER, SNAPSHOT_NAME);
  if (id) await drive.write(id, JSON.parse(body));
  else await drive.createIn(SNAPSHOT_FOLDER, SNAPSHOT_NAME, body);
  snapshotAt = Date.now(); snapshotText = text;
}

// ---------------- AI keys of the diet page (Drive file, cached in localStorage 'dietAI') ----------------
// Kept in your own Drive (private), never in the public repo, so every device you sign in on gets them.
// Newest copy wins (updatedAt), so keys saved offline reach Drive on the next sync.
const SECRETS_NAME = 'dashboard-ai-keys.json';
let secretsChecked = 0;
async function syncSecrets(force) {
  if (!force && Date.now() - secretsChecked < 10 * 60 * 1000) return;
  const readLocal = () => { try { return JSON.parse(localStorage.getItem('dietAI')) || null; } catch (e) { return null; } };
  const local = readLocal();
  const id = await drive.findInFolder(FOLDERS.diet, SECRETS_NAME);
  let remote = null;
  if (id) { try { remote = JSON.parse(await drive.readText(id)); } catch (e) { remote = null; } }
  const lt = local ? (local.updatedAt || 1) : 0, rt = remote ? (remote.updatedAt || 1) : 0; // keys saved before this version count as oldest
  if (remote && rt > lt) {
    try { localStorage.setItem('dietAI', JSON.stringify(remote)); } catch (e) {}
    log('מפתחות ה-AI נטענו מהדרייב');
  } else if (local && (local.gemini || local.claude) && lt > rt) {
    const text = JSON.stringify(local, null, 1);
    if (id) await drive.writeText(id, text); else await drive.createIn(FOLDERS.diet, SECRETS_NAME, text);
    log('מפתחות ה-AI נשמרו בדרייב');
  }
  secretsChecked = Date.now();
}

// ---------------- prices every 20 minutes (GitHub Action → prices.json → Drive) ----------------
let forcePrices = false;   // the sync button also re-reads prices.json right away
const PRICE_EVERY = 15 * 60 * 1000;   // the GitHub Action publishes every 20 minutes
async function pullPrices(force) {
  try {
    const last = await store.getMeta('pricesChecked');
    if (!force && last && Date.now() - last < PRICE_EVERY) return;
    const view = await currentView();
    if (!hasData(view)) return;
    const res = await fetch(PRICES_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) { log('מחירים: הקובץ לא זמין (' + res.status + ')'); return; }
    const p = await res.json();
    await store.setMeta('pricesChecked', Date.now());
    await saveChain;
    const { state, changed } = applyPrices(await currentView(), p);
    if (!changed) return;
    const ops = diff(await currentView(), state);
    await store.addOps(ops);
    log('מחירים עודכנו (' + new Date(p.updatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + ')' + (p.errors && p.errors.length ? ' · חסרים: ' + p.errors.map((e) => e.split(':')[0]).join(', ') : ''));
  } catch (e) { log('מחירים: ' + e.message); }
}

// ---------------- before the data is in the MEMORY.md files ----------------
async function showMissingData() {
  const last = await store.getMeta('lastSync');
  $('missingBox').hidden = !(last && auth.getToken() && !hasData(await currentView()));
}

// One-time move of the lists into the MEMORY.md files, from a migration file prepared by Claude.
// Edits each file IN PLACE: the old hand-written list sections are replaced by a pointer line,
// and the block is added at the end. Shows a preview first; writes only after you confirm.
let migPlan = null;
async function previewMigration(file) {
  const out = $('migPreview'); out.textContent = 'בודק את הקבצים ב-Drive…'; $('migGo').hidden = true; migPlan = null;
  try {
    const m = JSON.parse(await file.text());
    if (!m || m.kind !== 'dashboard-migration') throw new Error('זה לא קובץ העברה של הדשבורד');
    const plan = []; let ok = true;
    for (const sec of SECTION_IDS) {
      const s = m.sections && m.sections[sec]; if (!s) continue;
      const id = await drive.findInFolder(FOLDERS[sec], 'MEMORY.md');
      if (!id) { plan.push({ sec, err: 'לא נמצא MEMORY.md' }); ok = false; continue; }
      const { text, version } = await drive.readWithVersion(id);
      if (hasBlock(text)) { plan.push({ sec, skip: true }); continue; }
      const r = rewriteSections(text, s.edits || []);
      const md = replaceBlock(r.md, stringifyDoc(s.block));
      const doc = validateDoc(JSON.parse(extractBlock(md)));
      const items = Object.keys(doc).reduce((a, k) => a + (Array.isArray(doc[k]) ? doc[k].length : 0), 0);
      if (r.missing.length) ok = false;
      plan.push({ sec, id, version, md, items, replaced: (s.edits || []).length - r.missing.length, missing: r.missing });
    }
    out.innerHTML = plan.map((p) => {
      const name = SECTION_NAMES[p.sec];
      if (p.err) return `<div>✗ <b>${name}</b>: ${p.err}</div>`;
      if (p.skip) return `<div>✓ <b>${name}</b>: כבר הועבר, לא נוגע</div>`;
      return `<div>${p.missing.length ? '✗' : '•'} <b>${name}</b>: ${p.replaced} סעיפי רשימה יוחלפו בהפניה · ${p.items} פריטים לבלוק`
        + (p.missing.length ? `<br><small>לא נמצאו: ${p.missing.join(' · ')}</small>` : '') + '</div>';
    }).join('') + (ok ? '<p class="sync-muted">שאר הטקסט בקבצים לא משתנה.</p>' : '<p class="sync-muted">יש בעיה — לא אכתוב כלום. שלח צילום מסך ל-Claude.</p>');
    if (ok && plan.some((p) => !p.skip)) { migPlan = plan; $('migGo').hidden = false; }
  } catch (e) { out.textContent = 'נכשל: ' + e.message; }
}
async function runMigration() {
  const out = $('migPreview'); $('migGo').hidden = true;
  if (!migPlan) return;
  const done = [];
  try {
    for (const p of migPlan) {
      if (p.skip || p.err) continue;
      if (String(await drive.getVersion(p.id)) !== String(p.version)) throw new Error('הקובץ של ' + SECTION_NAMES[p.sec] + ' השתנה בינתיים — בחר שוב את הקובץ');
      await drive.writeText(p.id, p.md);
      done.push(SECTION_NAMES[p.sec]);
    }
    log('העברה: ' + done.join(', '));
    out.textContent = 'הועבר: ' + done.join(', ') + '. טוען…';
    migPlan = null;
    await runSync();
  } catch (e) { out.textContent = 'נעצר' + (done.length ? ' (הועברו: ' + done.join(', ') + ')' : '') + ': ' + e.message; }
}

// ---------------- start ----------------
let started = false;
let renewing = false;
async function startApp() {
  if (started) return;
  const view = await currentView();
  if (!hasData(view)) return;                // nothing yet: stay on the welcome screen
  started = true;
  lastState = withoutRoute(view);
  $('welcome').hidden = true;
  $('syncPill').hidden = false;
  const s = document.createElement('script');
  s.src = 'legacy.js';
  document.body.appendChild(s);             // the original dashboard screens
}

(async function main() {
  installClaudeShim(auth.getToken);
  const r = auth.handleRedirectReturn();
  if (r && r.ok) log('חזרת מ-Google עם התחברות');
  if (r && r.error) log('התחברות נכשלה: ' + r.error);
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  try { $('syncLog').textContent = (JSON.parse(localStorage.getItem(LOG_KEY)) || []).join('\n'); } catch (e) {}
  wireButtons();
  // Google sign-in lasts an hour. Once you've agreed before, the first tap after it expires
  // renews it in the background (a tap is needed so the browser allows the sign-in window).
  document.addEventListener('pointerdown', () => {
    if (auth.getToken() || !auth.hasConsented() || renewing) return;
    renewing = true;
    auth.signInPopup().then(() => { log('ההתחברות חודשה'); updateStatus(); runSync(); })
      .catch(() => {}).finally(() => { renewing = false; });
  }, true);
  $('migFile').addEventListener('change', (e) => { if (e.target.files[0]) previewMigration(e.target.files[0]); e.target.value = ''; });
  $('migGo').addEventListener('click', runMigration);
  $('setupWarn').hidden = auth.isConfigured();
  await startApp();
  await updateStatus();
  runSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => log('SW: ' + e.message));
})();

window.__dashTest = { runSync, store, refreshFromStore }; // used by automated tests only
