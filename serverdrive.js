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

// ---- moving a device from Drive to the server ----
// Everything this device knows (its last synced copy) is sent as ordinary changes, each with the
// time it was originally made. The server merges them with the app's own rules, so sending twice,
// or from two devices in any order, is harmless and never overwrites something newer.
const EPOCH = '1970-01-01T00:00:00.000Z';
export function snapshotOps(doc) {
  const ops = [];
  for (const coll of Object.keys(doc || {})) {
    if (!Array.isArray(doc[coll])) continue;
    for (const it of doc[coll]) {
      const byTime = new Map();
      for (const k of Object.keys(it)) {
        if (k === 'id' || k === '_f') continue;
        const at = (it._f && it._f[k]) || EPOCH;
        if (!byTime.has(at)) byTime.set(at, {});
        byTime.get(at)[k] = it[k];
      }
      if (!byTime.size) byTime.set(EPOCH, {});
      for (const [at, fields] of byTime) ops.push({ coll, id: it.id, fields, at });
    }
  }
  return ops;
}

// Returns how many changes were sent.
export async function seedServer(baseUrl, doc, fetchFn = (...a) => fetch(...a)) {
  const ops = snapshotOps(doc);
  const url = baseUrl.replace(/\/+$/, '') + '/v1/ops';
  for (let i = 0; i < ops.length; i += 400) {
    let res;
    try {
      res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ by: 'seed', ops: ops.slice(i, i + 400) }) });
    } catch (e) { throw new NetError('השרת לא זמין (Tailscale דלוק?)'); }
    if (!res.ok) throw new Error('שגיאת שרת ' + res.status + ' בהעלאה הראשונה');
  }
  return ops.length;
}
