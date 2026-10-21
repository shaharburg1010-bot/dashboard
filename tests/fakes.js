// Test doubles: an in-memory Google Drive with fault injection, and an in-memory store.
import { NotFoundError, AuthError, NetError } from '../sync.js';
export { NetError };

export class FakeDrive {
  constructor() {
    this.files = new Map(); // id -> { name, text, version, trashed }
    this.nextId = 1;
    this.faults = [];       // [{ method, kind, when: 'before'|'after' }]
    this.hooks = {};        // method -> async fn run before the method executes (race injection)
    this.calls = [];
    this.offline = false;
    this.tokenValid = true;
  }
  fail(method, kind = 'net', when = 'before') { this.faults.push({ method, kind, when }); }
  _fault(method, when) {
    const i = this.faults.findIndex((f) => f.method === method && f.when === when);
    if (i < 0) return;
    const f = this.faults.splice(i, 1)[0];
    if (f.kind === 'net') throw new NetError(method + ' failed');
    if (f.kind === 'auth') throw new AuthError();
  }
  async _enter(method) {
    this.calls.push(method);
    if (this.offline) throw new NetError('offline');
    if (!this.tokenValid) throw new AuthError();
    if (this.hooks[method]) { const h = this.hooks[method]; delete this.hooks[method]; await h(); }
    this._fault(method, 'before');
  }
  _get(id) { const f = this.files.get(id); if (!f || f.trashed) throw new NotFoundError(); return f; }

  async findFile(name) {
    await this._enter('findFile');
    for (const [id, f] of this.files) if (f.name === name && !f.trashed) return id;
    return null;
  }
  async create(name, doc) {
    await this._enter('create');
    const id = 'f' + this.nextId++;
    this.files.set(id, { name, text: JSON.stringify(doc), version: 1 });
    this._fault('create', 'after'); // 'after' = it happened on Drive but the reply was lost
    return id;
  }
  async readWithVersion(id) {
    await this._enter('readWithVersion');
    const f = this._get(id);
    return { text: f.text, version: f.version };
  }
  async getVersion(id) { await this._enter('getVersion'); return this._get(id).version; }
  async write(id, doc) {
    await this._enter('write');
    const f = this._get(id);
    f.text = JSON.stringify(doc); f.version++;
    this._fault('write', 'after');
  }
  // Direct access for "Claude"/another device editing the file outside the app.
  rawDoc(id) { return JSON.parse(this._get(id).text); }
  rawWrite(id, doc) { const f = this._get(id); f.text = typeof doc === 'string' ? doc : JSON.stringify(doc); f.version++; }
  onlyFileId() { return [...this.files.keys()].find((k) => !this.files.get(k).trashed); }
}

export class MemStore {
  constructor() { this.meta = new Map(); this.outbox = []; }
  async getMeta(k) { const v = this.meta.get(k); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  async setMeta(k, v) { this.meta.set(k, v === null ? undefined : JSON.parse(JSON.stringify(v))); }
  async getOutbox() { return JSON.parse(JSON.stringify(this.outbox)); }
  async addOp(op) { this.outbox.push(JSON.parse(JSON.stringify(op))); }
  async removeOps(ids) { const s = new Set(ids); this.outbox = this.outbox.filter((o) => !s.has(o.opId)); }
}
