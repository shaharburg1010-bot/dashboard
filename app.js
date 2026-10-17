// app.js — the screen: shows tasks from the local database, records every change in the outbox,
// and runs sync whenever it makes sense. It never waits for the network to show or save anything.
import { syncOnce, makeOp, newId, localView, visibleItems } from './sync.js';
import { store } from './store.js';
import { makeDrive } from './drive.js';
import * as auth from './auth.js';

const $ = (id) => document.getElementById(id);
const drive = makeDrive(auth.getToken, () => auth.signOut());

// ---------- debug log (helps us see what happened on the iPhone) ----------
const LOG_KEY = 'synclog';
function log(msg) {
  const line = new Date().toLocaleTimeString('he-IL') + '  ' + msg;
  let lines = [];
  try { lines = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) {}
  lines.unshift(line); lines = lines.slice(0, 40);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)); } catch (e) {}
  $('log').textContent = lines.join('\n');
}

// ---------- state + rendering ----------
let syncState = 'idle'; // idle | syncing | ok | offline | needs-auth | error
let syncMsg = '';

async function render() {
  const snapshot = await store.getMeta('snapshot');
  const outbox = await store.getOutbox();
  const doc = localView(snapshot, outbox);
  const tasks = visibleItems(doc, 'tasks').sort((a, b) => (a.done - b.done) || String(a._f.text || '').localeCompare(String(b._f.text || '')));

  const ul = $('tasks');
  ul.textContent = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    li.dataset.id = t.id;
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!t.done;
    cb.addEventListener('change', () => change(t.id, { done: cb.checked }));
    const span = document.createElement('span'); span.className = 'txt'; span.contentEditable = 'true';
    span.textContent = t.text || '';            // textContent, never innerHTML: data from Drive is untrusted
    span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } });
    span.addEventListener('blur', () => { const v = span.textContent.trim(); if (v && v !== t.text) change(t.id, { text: v }); else span.textContent = t.text || ''; });
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'מחק');
    del.addEventListener('click', () => change(t.id, { deleted: true }));
    if (t.done) li.classList.add('done');
    li.append(cb, span, del);
    ul.appendChild(li);
  }
  $('empty').hidden = tasks.length > 0;

  // status pill
  const pending = outbox.length;
  const online = navigator.onLine;
  let text, cls;
  if (syncState === 'syncing' || (syncState === 'idle' && online && auth.getToken())) { text = 'מסנכרן…'; cls = 'busy'; }
  else if (syncState === 'needs-auth') { text = pending ? `${pending} ממתינים · צריך להתחבר` : 'צריך להתחבר לסנכרון'; cls = 'warn'; }
  else if (syncState === 'error') { text = 'שגיאה: ' + syncMsg; cls = 'err'; }
  else if (!online || syncState === 'offline') { text = pending ? `אין רשת · ${pending} ממתינים` : 'אין רשת · הכול שמור במכשיר'; cls = 'warn'; }
  else if (pending) { text = `${pending} ממתינים לסנכרון`; cls = 'warn'; }
  else if (syncState === 'ok') { text = 'מסונכרן עם Drive ✓'; cls = 'ok'; }
  else { text = 'עדיין לא סונכרן'; cls = 'warn'; } // never claim 'synced' unless a sync really succeeded
  $('status').textContent = text; $('status').className = 'pill ' + cls;

  const last = await store.getMeta('lastSync');
  $('lastSync').textContent = last ? 'סנכרון אחרון: ' + new Date(last).toLocaleString('he-IL') : 'עדיין לא סונכרן';
  const signedIn = !!auth.getToken();
  $('authBox').hidden = signedIn;
  $('signedIn').hidden = !signedIn;
  $('setup').hidden = auth.isConfigured();
  const exp = auth.tokenExpiry();
  $('tokenInfo').textContent = signedIn && exp ? ' · מחובר עד ' + exp.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
  $('fileId').textContent = (await store.getMeta('fileId')) || '—';
}

// Every user action: save to the local DB first (instant, offline-safe), then try to sync.
async function change(id, fields) {
  await store.addOp(makeOp('tasks', id, fields));
  await render();
  scheduleSync(1200);
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('newTask').value.trim();
  if (!v) return;
  $('newTask').value = '';
  await change(newId('t'), { text: v, done: false, deleted: false });
});

// ---------- sync scheduling ----------
let running = null, timer = null, again = false;
function scheduleSync(ms) { clearTimeout(timer); timer = setTimeout(runSync, ms); }

async function runSync() {
  if (running) { again = true; return running; }
  if (!navigator.onLine) { syncState = 'offline'; await render(); return; }
  if (!auth.getToken()) { syncState = 'needs-auth'; await render(); return; }
  syncState = 'syncing'; await render();
  running = (async () => {
    try {
      const r = await syncOnce(drive, store);
      syncState = 'ok'; syncMsg = '';
      log(`סנכרון הצליח · נשלחו ${r.pushed}` + (r.restored ? ` · שוחזרו ${r.restored}` : ''));
    } catch (e) {
      if (e.name === 'AuthError') { syncState = 'needs-auth'; log('צריך להתחבר מחדש'); }
      else if (e.name === 'NetError') { syncState = 'offline'; log('אין רשת: ' + e.message); }
      else if (e.name === 'CorruptRemoteError') { syncState = 'error'; syncMsg = 'הקובץ ב-Drive לא תקין — לא נגעתי בו'; log('קובץ פגום: ' + e.message); }
      else if (e.name === 'ConflictError') { syncState = 'error'; syncMsg = 'יותר מדי שינויים במקביל, ננסה שוב'; log('התנגשות'); scheduleSync(5000); }
      else { syncState = 'error'; syncMsg = e.message; log('שגיאה: ' + e.message); }
    } finally {
      running = null;
      await render();
      if (again) { again = false; scheduleSync(300); }
    }
  })();
  return running;
}

window.addEventListener('online', () => { log('הרשת חזרה'); runSync(); });
window.addEventListener('offline', () => { syncState = 'offline'; render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runSync(); });
setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 60000);

// ---------- buttons ----------
async function afterSignIn() { log('התחברת ל-Google'); await render(); runSync(); }
$('btnPopup').addEventListener('click', () => auth.signInPopup().then(afterSignIn).catch((e) => { log('חלון התחברות נכשל: ' + e.message); render(); }));
$('btnRedirect').addEventListener('click', () => auth.signInRedirect());
$('btnSync').addEventListener('click', () => runSync());
$('btnSignOut').addEventListener('click', () => { auth.signOut(); syncState = 'needs-auth'; log('התנתקת (הנתונים נשארו במכשיר)'); render(); });

// ---------- start ----------
(async function start() {
  const r = auth.handleRedirectReturn();
  if (r && r.ok) log('חזרת מ-Google עם התחברות');
  if (r && r.error) log('התחברות נכשלה: ' + r.error);
  try { if (navigator.storage && navigator.storage.persist) { const p = await navigator.storage.persist(); log('אחסון קבוע: ' + (p ? 'כן' : 'לא')); } } catch (e) {}
  try { $('log').textContent = (JSON.parse(localStorage.getItem(LOG_KEY)) || []).join('\n'); } catch (e) {}
  await render();
  runSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => log('SW: ' + e.message));
})();

window.__dash = { runSync, store }; // for automated tests
