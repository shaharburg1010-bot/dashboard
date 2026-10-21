// boot.js — starts the app: loads the phone's local copy, starts the dashboard screens (legacy.js),
// turns every change into ops for the sync engine, and brings in updates from Drive.
import { syncOnce, localView, clone } from './sync.js';
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
  return toState(localView(await store.getMeta('snapshot'), await store.getOutbox()));
}
function hasData(view) { return view && view.finance !== undefined; }

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
      const r = await syncOnce(drive, store);
      syncState = 'ok'; syncMsg = '';
      if (r.pushed || r.restored) log(`סונכרן · נשלחו ${r.pushed}` + (r.restored ? ` · שוחזרו ${r.restored}` : ''));
      if (!lastState) { await startApp(); if (!started) await showImportIfEmpty(); }
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

// ---------------- one-time import from the old dashboard ----------------
// Only offered when Drive has no dashboard data yet, so it can never overwrite real data.
async function showImportIfEmpty() {
  const last = await store.getMeta('lastSync');
  const view = await currentView();
  $('importBox').hidden = !(last && auth.getToken() && !hasData(view));
}
async function importFile(file) {
  const msg = $('importMsg');
  try {
    const state = JSON.parse(await file.text());
    if (!state || !Array.isArray(state.tasks) || !state.finance) throw new Error('זה לא קובץ ייבוא של הדשבורד');
    await runSync();                                        // make sure Drive is really still empty
    if (hasData(await currentView())) { msg.textContent = 'ב-Drive כבר יש נתונים — הייבוא בוטל כדי לא לדרוס אותם.'; return; }
    await store.addOps(diff({}, state));
    msg.textContent = 'מייבא ושולח ל-Drive…';
    log('ייבוא: ' + state.tasks.length + ' משימות');
    await runSync();
    await startApp();
  } catch (e) { msg.textContent = 'הייבוא נכשל: ' + e.message; }
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
  $('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); });
  $('setupWarn').hidden = auth.isConfigured();
  await startApp();
  await updateStatus();
  runSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => log('SW: ' + e.message));
})();

window.__dashTest = { runSync, store, refreshFromStore }; // used by automated tests only
