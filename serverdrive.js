// serverdrive.js — makes the sync service on Shahar's server (server/app.mjs) look like the
// file store sync.js expects. One "file" per dashboard area; its id is simply the area name.
// The server refuses a write that isn't based on the latest version, so two devices can never
// silently overwrite each other; sync.js then re-reads and merges, exactly as it did with Drive.
import { NetError } from './sync.js';
import { pickSection } from './sections.js';

export function makeServerDrive(baseUrl, sec, fetchFn = (...a) => fetch(...a)) {
  const url = baseUrl.replace(/\/+$/, '') + '/v1/sections/' + encodeURIComponent(sec);
  let lastVersion = null;

  async function call(method, body) {
    let res;
    try {
      res = await fetchFn(url, {
        method, cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new NetError('השרת לא זמין (Tailscale דלוק?)'); }
    if (res.status === 409) return { conflict: true, ...(await res.json().catch(() => ({}))) };
    if (!res.ok) {
      const msg = await res.json().then((j) => j.error, () => '');
      throw new Error('שגיאת שרת ' + res.status + (msg ? ': ' + msg : ''));
    }
    return res.json();
  }

  async function get() {
    const r = await call('GET');
    lastVersion = r.version;
    return r;
  }

  return {
    async findFile() { return (await get()).exists ? sec : null; },
    // First device to reach an empty server seeds it with everything it has.
    async create(name, doc) { await call('PUT', { doc: pickSection(doc, sec), baseVersion: 0 }); return sec; },
    async getVersion() { return (await get()).version; },
    async readWithVersion() { const r = await get(); return { text: JSON.stringify(r.doc), version: r.version }; },
    // A refused write (someone wrote first) is not an error: sync.js reads back, sees its
    // changes are missing, and merges again on top of the newer copy.
    async write(id, doc) { await call('PUT', { doc: pickSection(doc, sec), baseVersion: lastVersion }); },
  };
}
