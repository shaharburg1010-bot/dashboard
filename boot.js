// boot.js — starts the app: loads the phone's local copy, starts the dashboard screens (legacy.js),
// turns every change into ops for the sync engine, and brings in updates from Drive.
// Data lives in four MEMORY.md files (one per area, see sections.js); each is synced on its own.
import { syncOnce, localView, clone, validateDoc } from './sync.js';
import { hasBlock, extractBlock, replaceBlock, rewriteSections, stringifyDoc } from './memfile.js';
import { SECTION_IDS, SECTION_NAMES, sectionOfOp, mergeDocs } from './sections.js';
import { makeMemDrive, sectionStore } from './memdrive.js';
import { FOLDERS, PRICES_URL } from './config.js';
import { applyPrices } from './prices.js';
import { INBOX_MARK, applyChanges, parseLoose } from './inbox.js';
import { toState, diff } from './model.js';
import { store } from './store.js';
import { makeDrive } from './drive.js';
import * as auth from './auth.js';
import { installClaudeShim } from './calendar.js';

const drive = makeDrive(auth.getToken, () => auth.signOut());
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
  return withDefaults(toState(localView(mergeDocs(snaps), await store.getOutbox())));
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
  if (!auth.getToken()) { syncState = 'needs-auth'; updateStatus(); return; }
  syncState = 'syncing'; updateStatus();
  running = (async () => {
    try {
      await saveChain;
      const inboxFiles = await pullInbox();
      await pullPrices();
      let pushed = 0, restored = 0; const failed = [];
      for (const sec of SECTION_IDS) {
        const md = makeMemDrive(drive, sec, FOLDERS[sec], { hasLocalData: async () => hasItems(await store.getMeta(sec + ':snapshot')) });
        try {
          const r = await syncOnce(md, sectionStore(store, sec, sectionOfOp));
          pushed += r.pushed; restored += r.restored;
        } catch (e) {
          if (e.name === 'AuthError' || e.name === 'NetError') throw e; // whole round stops
          failed.push(SECTION_NAMES[sec] + ': ' + e.message);
        }
      }
      if (failed.length < SECTION_IDS.length) await store.setMeta('lastSync', new Date().toISOString());
      // Inbox files whose changes are now in MEMORY.md go to the trash.
      for (const f of inboxFiles) if (!failed.some((m) => m.startsWith(SECTION_NAMES[f.sec] + ':'))) {
        try { await drive.trash(f.id); } catch (e) { log('לא הצלחתי להעביר לפח קובץ עדכון: ' + e.message); }
      }
      if (pushed || restored) log(`סונכרן · נשלחו ${pushed}` + (restored ? ` · שוחזרו ${restored}` : ''));
      if (failed.length) { syncState = 'error'; syncMsg = failed.length + ' קבצים לא סונכרנו'; failed.forEach((m) => log(m)); }
      else { syncState = 'ok'; syncMsg = ''; }
      if (!lastState) { await startApp(); if (!started) await showMissingData(); }
      else await refreshFromStore();
    } catch (e) {
      if (e.name === 'AuthError') { syncState = 'needs-auth'; log('צריך להתחבר מחדש'); }
      else if (e.name === 'NetError') { syncState = 'offline'; log('אין רשת: ' + e.message); }
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
  if (syncState === 'syncing' || (syncState === 'idle' && online && auth.getToken())) { text = 'מסנכרן…'; cls = 'busy'; }
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
  for (const el of document.querySelectorAll('[data-when-signed-in]')) el.hidden = !signedIn;
  for (const el of document.querySelectorAll('[data-when-signed-out]')) el.hidden = signedIn;
}

function wireButtons() {
  const after = async () => { log('התחברת ל-Google'); await updateStatus(); runSync(); };
  for (const b of document.querySelectorAll('[data-act=popup]')) b.addEventListener('click', () => auth.signInPopup().then(after).catch((e) => { log('התחברות נכשלה: ' + e.message); updateStatus(); }));
  for (const b of document.querySelectorAll('[data-act=redirect]')) b.addEventListener('click', () => auth.signInRedirect());
  for (const b of document.querySelectorAll('[data-act=sync]')) b.addEventListener('click', () => runSync());
  for (const b of document.querySelectorAll('[data-act=signout]')) b.addEventListener('click', () => { auth.signOut(); syncState = 'needs-auth'; log('התנתקת (הנתונים נשארו במכשיר)'); updateStatus(); });
  $('syncPill').addEventListener('click', () => { $('syncPanel').hidden = !$('syncPanel').hidden; });
  $('syncClose').addEventListener('click', () => { $('syncPanel').hidden = true; });
}

// ---------------- changes from Claude / the agents (inbox files, see inbox.js) ----------------
async function pullInbox() {
  const out = [];
  if (!hasData(await currentView())) return out;   // only once the data itself is here
  const done = (await store.getMeta('inboxDone')) || [];
  for (const sec of SECTION_IDS) {
    const files = await drive.listInFolder(FOLDERS[sec], INBOX_MARK);
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

// ---------------- hourly prices (GitHub Action → prices.json → Drive) ----------------
const PRICE_EVERY = 55 * 60 * 1000;
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
  $('migFile').addEventListener('change', (e) => { if (e.target.files[0]) previewMigration(e.target.files[0]); e.target.value = ''; });
  $('migGo').addEventListener('click', runMigration);
  $('setupWarn').hidden = auth.isConfigured();
  await startApp();
  await updateStatus();
  runSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => log('SW: ' + e.message));
})();

window.__dashTest = { runSync, store, refreshFromStore }; // used by automated tests only
