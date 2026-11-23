// server/gdrive.mjs — Google Drive for the sync service, with a permanent permission (refresh token).
// The token file is created once by server/google-auth.mjs and lives OUTSIDE the repo
// (default ~/.config/dashboard-sync/google.json, mode 600). Never commit it.
// Reuses the app's own Drive calls (../drive.js) and adds what only the server needs.
import fs from 'node:fs';
import { makeDrive, DRIVE_API, DRIVE_UPLOAD } from '../drive.js';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function readCreds(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error('בקובץ ההרשאה חסר client_id, client_secret או refresh_token');
  return c;
}

export function makeGoogleDrive(credFile, fetchFn = (...a) => fetch(...a)) {
  let token = null, exp = 0;
  async function ensureToken() {
    if (token && Date.now() < exp - 120000) return;
    const c = readCreds(credFile);
    let res;
    try {
      res = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }) });
    } catch (e) { throw new Error('אין גישה ל-Google: ' + e.message); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      token = null;
      // invalid_grant = the permission was revoked or expired (e.g. the Google Cloud app is still in "Testing": 7 days).
      throw new Error('Google סירב לחדש את ההרשאה (' + res.status + ' ' + (j.error || '') + '). צריך להריץ שוב את server/google-auth.mjs');
    }
    token = j.access_token; exp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  }
  const drive = makeDrive(() => token);

  async function call(method, url, body, headers) {
    const res = await fetchFn(url, { method, body, headers: { Authorization: 'Bearer ' + token, ...(headers || {}) } });
    if (!res.ok) throw new Error('Drive ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
    return res.json();
  }

  return {
    ...drive,
    ensureToken,
    // A sub-folder by name, created when missing.
    async ensureFolder(parentId, name) {
      const id = await drive.findInFolder(parentId, name);
      if (id) return id;
      const j = await call('POST', `${DRIVE_API}/files?fields=id`, JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
        { 'Content-Type': 'application/json' });
      return j.id;
    },
    // Any file (the daily copy of life.db is binary).
    async uploadBinary(folderId, name, buf, mimeType = 'application/octet-stream') {
      const boundary = 'b' + Math.random().toString(36).slice(2);
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` + JSON.stringify({ name, parents: [folderId] })
          + `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
        buf,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const j = await call('POST', `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, body, { 'Content-Type': `multipart/related; boundary=${boundary}` });
      return j.id;
    },
  };
}
