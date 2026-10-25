// drive.js — the only file that talks to Google Drive (REST API v3).
// The app reads and writes only the four MEMORY.md files named in config.js (FOLDERS).
import { AuthError, NetError, NotFoundError, FILE_NAME } from './sync.js';

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export function makeDrive(getToken, onAuthLost) {
  async function req(method, url, { body, headers } = {}) {
    const token = getToken();
    if (!token) throw new AuthError();
    let res;
    try {
      res = await fetch(url, { method, body, cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(headers || {}) } });
    } catch (e) {
      throw new NetError(e.message);
    }
    if (res.status === 401) { if (onAuthLost) onAuthLost(); throw new AuthError(); }
    if (res.status === 404) throw new NotFoundError();
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error('Drive ' + res.status + ' ' + txt.slice(0, 200));
      if (res.status >= 500 || res.status === 429) err.name = 'NetError'; // temporary — just retry later
      throw err;
    }
    return res;
  }

  const api = {
    // Newest file with this name in the folder (Claude rewrites MEMORY.md as a new file).
    async findInFolder(folderId, name) {
      const q = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
      const res = await req('GET', `${DRIVE_API}/files?q=${q}&spaces=drive&orderBy=createdTime desc&pageSize=1&fields=files(id,createdTime)`);
      const { files } = await res.json();
      return files && files.length ? files[0].id : null;
    },
    async writeText(id, text) {
      await req('PATCH', `${DRIVE_UPLOAD}/files/${id}?uploadType=media&fields=version`, {
        body: text, headers: { 'Content-Type': 'text/markdown; charset=UTF-8' },
      });
    },
    async findFile(name = FILE_NAME) {
      const q = encodeURIComponent(`name='${name}' and trashed=false`);
      const res = await req('GET', `${DRIVE_API}/files?q=${q}&spaces=drive&orderBy=createdTime&fields=files(id,createdTime)`);
      const { files } = await res.json();
      return files && files.length ? files[0].id : null; // oldest wins if there are ever two
    },
    async create(name, doc) {
      const boundary = 'b' + Math.random().toString(36).slice(2);
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, mimeType: 'application/json', description: 'Shahar dashboard data — managed by the dashboard app and Claude' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        JSON.stringify(doc, null, 1) +
        `\r\n--${boundary}--`;
      const res = await req('POST', `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
        body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      });
      return (await res.json()).id;
    },
    async getVersion(id) {
      const res = await req('GET', `${DRIVE_API}/files/${id}?fields=version,trashed`);
      const j = await res.json();
      if (j.trashed) throw new NotFoundError('file is in the trash');
      return String(j.version);
    },
    // Content + the version it belongs to (re-checked so the pair is consistent).
    async readWithVersion(id) {
      for (let i = 0; i < 3; i++) {
        const v1 = await api.getVersion(id);
        const text = await (await req('GET', `${DRIVE_API}/files/${id}?alt=media`)).text();
        const v2 = await api.getVersion(id);
        if (v1 === v2) return { text, version: v1 };
      }
      const e = new Error('file keeps changing'); e.name = 'NetError'; throw e;
    },
    async write(id, doc) {
      await req('PATCH', `${DRIVE_UPLOAD}/files/${id}?uploadType=media&fields=version`, {
        body: JSON.stringify(doc, null, 1), headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  return api;
}
