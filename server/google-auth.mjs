// server/google-auth.mjs — gives the sync service a permanent Google Drive permission. Run once, on the server.
//   1) node server/google-auth.mjs url <client_secret_....json>      (or: url <CLIENT_ID> <CLIENT_SECRET>)
//      prints a link. Open it on any computer, sign in as shaharburg1010@gmail.com and allow.
//      The browser then lands on an address starting with http://127.0.0.1 that does not load. That is expected.
//   2) node server/google-auth.mjs code '<the whole address from the browser>'
//      saves the permission to ~/.config/dashboard-sync/google.json (mode 600), then:
//      systemctl --user restart dashboard-sync
// The OAuth client must be of type "Desktop app", and the Google Cloud app must be "In production"
// (in "Testing" Google cancels the permission after 7 days).
import fs from 'node:fs';
import path from 'node:path';
import { TOKEN_URL } from './gdrive.mjs';

const FILE = process.env.DASH_GOOGLE || path.join(process.env.HOME || '.', '.config/dashboard-sync/google.json');
const PENDING = FILE + '.pending';
const REDIRECT = 'http://127.0.0.1:53682';
// Full Drive: the inbox files are created by Claude's agents (another app), which drive.file cannot see.
const SCOPE = 'https://www.googleapis.com/auth/drive';

const [cmd, a, b] = process.argv.slice(2);
function save(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

if (cmd === 'url' && a) {
  // Either the JSON file downloaded from Google Cloud ("Download JSON"), or the id and secret themselves.
  let id = a, secret = b;
  if (!b) {
    const j = JSON.parse(fs.readFileSync(a, 'utf8'));
    const c = j.installed || j.web || j;
    id = c.client_id; secret = c.client_secret;
    if (!id || !secret) { console.error('בקובץ אין client_id או client_secret'); process.exit(1); }
  }
  save(PENDING, { client_id: id, client_secret: secret });
  const p = new URLSearchParams({ client_id: id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent' });
  console.log('https://accounts.google.com/o/oauth2/v2/auth?' + p);
} else if (cmd === 'code' && a) {
  const pend = JSON.parse(fs.readFileSync(PENDING, 'utf8'));
  let code = a;
  try { code = new URL(a).searchParams.get('code') || a; } catch (e) {}
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: pend.client_id, client_secret: pend.client_secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const j = await res.json();
  if (!res.ok || !j.refresh_token) { console.error('נכשל:', res.status, JSON.stringify(j)); process.exit(1); }
  save(FILE, { client_id: pend.client_id, client_secret: pend.client_secret, refresh_token: j.refresh_token, scope: j.scope, createdAt: new Date().toISOString() });
  fs.unlinkSync(PENDING);
  console.log('נשמר ב-' + FILE + '. עכשיו: systemctl --user restart dashboard-sync');
} else {
  console.log('שימוש:\n  node server/google-auth.mjs url <קובץ JSON מגוגל>\n  node server/google-auth.mjs code \'<הכתובת מהדפדפן>\'');
}
