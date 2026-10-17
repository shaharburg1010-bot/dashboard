// store.js — the phone's local database (IndexedDB). Survives closing the app, reboots and airplane mode.
//   meta   : key -> value   (snapshot = last copy seen on Drive, fileId, journal, lastSync)
//   outbox : changes not yet confirmed on Drive
// Every write resolves only after the transaction is committed to disk.

const DB_NAME = 'dashboard';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'opId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    // 'strict' = report success only after the data is flushed to disk (survives a crash right after).
    const t = mode === 'readwrite' ? db.transaction(stores, mode, { durability: 'strict' }) : db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);       // committed
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
    result = fn(t);
  });
}

function reqValue(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export const store = {
  async getMeta(key) {
    const db = await openDb();
    const v = await reqValue(db.transaction('meta').objectStore('meta').get(key));
    return v === undefined ? null : v;
  },
  async setMeta(key, value) {
    await tx(['meta'], 'readwrite', (t) => {
      const s = t.objectStore('meta');
      if (value === null || value === undefined) s.delete(key); else s.put(value, key);
    });
  },
  async getOutbox() {
    const db = await openDb();
    return reqValue(db.transaction('outbox').objectStore('outbox').getAll());
  },
  async addOp(op) {
    await tx(['outbox'], 'readwrite', (t) => { t.objectStore('outbox').put(op); });
  },
  async removeOps(opIds) {
    await tx(['outbox'], 'readwrite', (t) => { const s = t.objectStore('outbox'); for (const id of opIds) s.delete(id); });
  },
  async clearAll() {
    await tx(['meta', 'outbox'], 'readwrite', (t) => { t.objectStore('meta').clear(); t.objectStore('outbox').clear(); });
  },
};
