// Run: node --test tests/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce, makeOp, localView, emptyDoc, CorruptRemoteError } from '../sync.js';
import { extractBlock, replaceBlock, stringifyDoc } from '../memfile.js';
import { SECTION_IDS, sectionOfOp, sectionOfField, mergeDocs, splitDoc } from '../sections.js';
import { makeMemDrive, sectionStore, MissingFileError } from '../memdrive.js';
import { docFromState, toState, diff } from '../model.js';
import { FakeDrive, MemStore } from './fakes.js';

// A Drive with folders and markdown files, like the real one.
class FolderDrive extends FakeDrive {
  addFile(folder, name, text, createdTime) {
    const id = 'f' + this.nextId++;
    this.files.set(id, { name, text, version: 1, folder, createdTime: createdTime || new Date(Date.now() + this.nextId).toISOString() });
    return id;
  }
  async findInFolder(folder, name) {
    await this._enter('findInFolder');
    const hits = [...this.files].filter(([, f]) => f.folder === folder && f.name === name && !f.trashed)
      .sort((a, b) => (a[1].createdTime < b[1].createdTime ? 1 : -1));
    return hits.length ? hits[0][0] : null;
  }
  async writeText(id, text) { await this._enter('write'); const f = this._get(id); f.text = text; f.version++; }
  text(folder) { return [...this.files.values()].filter((f) => f.folder === folder && !f.trashed).sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1))[0].text; }
}
const FOLDERS = { tasks: 'F_tasks', debts: 'F_debts', finance: 'F_fin', leisure: 'F_lz' };
const MD = {
  tasks: '# לו"ז ומשימות\n\nהערות של Claude: `קוד` ו-*הדגשה*.\n',
  debts: '# חובות\n\nטקסט.',
  finance: '# פיננסים\n',
  leisure: '# פנאי\n\n```js\nconsole.log("a fence that is not ours")\n```\n',
};

function setup() {
  const drive = new FolderDrive();
  for (const s of SECTION_IDS) drive.addFile(FOLDERS[s], 'MEMORY.md', MD[s]);
  return drive;
}
function phone(drive) {
  const store = new MemStore();
  const hasItems = (d) => !!d && Object.keys(d).some((k) => Array.isArray(d[k]) && d[k].some((x) => !x.deleted));
  return {
    store,
    async sync() {
      const errs = [];
      for (const s of SECTION_IDS) {
        const md = makeMemDrive(drive, s, FOLDERS[s], { hasLocalData: async () => hasItems(await store.getMeta(s + ':snapshot')) });
        try { await syncOnce(md, sectionStore(store, s, sectionOfOp)); } catch (e) { errs.push([s, e]); }
      }
      return errs;
    },
    async view() {
      const snaps = await Promise.all(SECTION_IDS.map((s) => store.getMeta(s + ':snapshot')));
      return toState(localView(mergeDocs(snaps), await store.getOutbox()));
    },
    async change(prev, next) { for (const op of diff(prev, next)) await store.addOp(op); },
  };
}
const STATE = {
  asOf: '25.10.2026', categoryOrder: ['כללי'], calendars: [{ id: 'c1', name: '1. אישי' }],
  tasks: [{ id: 't1', cat: 'כללי', text: 'משימה "עם מרכאות" ו-```', urgent: true }],
  debts: [{ id: 'd1', direction: 'owed', person: 'דוד', item: '738 ₪' }],
  finance: { longTerm: { total: 1 }, plan: { theme: 'x' } },
  sports: { days: [{ id: 'A', name: 'Upper A', exercises: [] }], workoutLog: [], runs: [], note: 'קייט' },
  leisure: { books: [{ id: 'b1', text: 'Grit' }], movies: [], travel: [], learning: [], cooking: [] },
  leisureSectionOrder: ['books'],
};

test('block helpers: add, find, replace; other fences and text untouched', () => {
  assert.equal(extractBlock(MD.leisure), null);
  const a = replaceBlock(MD.leisure, '{"a":1}');
  assert.ok(a.startsWith(MD.leisure));
  assert.equal(extractBlock(a), '{"a":1}');
  const b = replaceBlock(a, '{"a":2}');
  assert.equal(extractBlock(b), '{"a":2}');
  assert.equal(b.replace('{"a":2}', '{"a":1}'), a);
  assert.equal(b.split('dashboard-data').length, 2); // only one block
  assert.equal(replaceBlock(a, '{"$&":"$1"}').includes('{"$&":"$1"}'), true); // no regex-replacement surprises
});

test('routing: every key goes to the right file', () => {
  assert.equal(sectionOfField('finance.longTerm'), 'finance');
  assert.equal(sectionOfField('order:sports.days'), 'leisure');
  assert.equal(sectionOfField('leisureSectionOrder'), 'leisure');
  assert.equal(sectionOfField('order:debts'), 'debts');
  assert.equal(sectionOfField('categoryOrder'), 'tasks');
  assert.equal(sectionOfOp(makeOp('leisure_cooking', 'x', { text: 'a' })), 'leisure');
  const parts = splitDoc(docFromState(STATE));
  const back = toState(mergeDocs(Object.values(parts)));
  assert.deepEqual(back, STATE);
});

test('migration blocks -> app loads the exact same STATE; markdown around them untouched', async () => {
  const drive = setup();
  const parts = splitDoc(docFromState(STATE));
  for (const s of SECTION_IDS) {
    const id = await drive.findInFolder(FOLDERS[s], 'MEMORY.md');
    drive.rawWrite(id, replaceBlock(MD[s], stringifyDoc(parts[s])));
  }
  const p = phone(drive);
  assert.deepEqual(await p.sync(), []);
  assert.deepEqual(await p.view(), STATE);
  for (const s of SECTION_IDS) assert.ok(drive.text(FOLDERS[s]).startsWith(MD[s]));
  // the tasks file holds only tasks-area data
  const t = JSON.parse(extractBlock(drive.text(FOLDERS.tasks)));
  assert.equal(t.debts, undefined); assert.equal(t.sports_days, undefined);
  assert.ok(t.fields.every((f) => !f.id.startsWith('finance')));
});

test('offline edits in several areas reach their own files', async () => {
  const drive = setup();
  const parts = splitDoc(docFromState(STATE));
  for (const s of SECTION_IDS) drive.rawWrite(await drive.findInFolder(FOLDERS[s], 'MEMORY.md'), replaceBlock(MD[s], stringifyDoc(parts[s])));
  const p = phone(drive); await p.sync();
  const before = await p.view();
  const after = JSON.parse(JSON.stringify(before));
  after.tasks[0].text = 'חדש'; after.debts = []; after.leisure.books.push({ id: 'b2', text: 'Outliers' }); after.finance.plan.theme = 'y';
  drive.offline = true;
  await p.change(before, after);
  assert.equal((await p.sync()).length, 4); // all failed offline, nothing lost
  assert.deepEqual(await p.view(), after);
  drive.offline = false;
  assert.deepEqual(await p.sync(), []);
  assert.equal((await p.store.getOutbox()).length, 0);
  const p2 = phone(drive); await p2.sync();
  assert.deepEqual(await p2.view(), after);
  assert.ok(drive.text(FOLDERS.debts).startsWith(MD.debts));
});

test('Claude rewrites MEMORY.md as a NEW file (with the block): app follows it, keeps both sides', async () => {
  const drive = setup();
  const parts = splitDoc(docFromState(STATE));
  for (const s of SECTION_IDS) drive.rawWrite(await drive.findInFolder(FOLDERS[s], 'MEMORY.md'), replaceBlock(MD[s], stringifyDoc(parts[s])));
  const p = phone(drive); await p.sync();
  const v0 = await p.view();
  // phone edits a task (not yet synced)
  const v1 = JSON.parse(JSON.stringify(v0)); v1.tasks[0].urgent = false; await p.change(v0, v1);
  // Claude: reads the file, adds a note + a task to the block, writes a NEW file and trashes the old one
  const oldId = await drive.findInFolder(FOLDERS.tasks, 'MEMORY.md');
  const md = drive.text(FOLDERS.tasks);
  const doc = JSON.parse(extractBlock(md));
  const at = new Date().toISOString();
  doc.tasks.push({ id: 't_claude', cat: 'כללי', text: 'מ-Claude', urgent: false, deleted: false, _f: { cat: at, text: at, urgent: at, deleted: at } });
  drive.addFile(FOLDERS.tasks, 'MEMORY.md', replaceBlock(md + '\nשורה חדשה של Claude\n', stringifyDoc(doc)));
  drive.files.get(oldId).trashed = true;
  assert.deepEqual(await p.sync(), []);
  const v = await p.view();
  assert.equal(v.tasks.find((t) => t.id === 't1').urgent, false);
  assert.ok(v.tasks.find((t) => t.id === 't_claude'));
  assert.ok(drive.text(FOLDERS.tasks).includes('שורה חדשה של Claude'));
});

test('a stale rewrite by Claude (from before the phone synced) is repaired from the journal', async () => {
  const drive = setup();
  const parts = splitDoc(docFromState(STATE));
  for (const s of SECTION_IDS) drive.rawWrite(await drive.findInFolder(FOLDERS[s], 'MEMORY.md'), replaceBlock(MD[s], stringifyDoc(parts[s])));
  const p = phone(drive); await p.sync();
  const staleMd = drive.text(FOLDERS.debts);              // Claude read here…
  const v0 = await p.view(); const v1 = JSON.parse(JSON.stringify(v0));
  v1.debts.push({ id: 'd2', direction: 'owes', person: 'כפיר', item: 'ספר' });
  await p.change(v0, v1); await p.sync();                  // …phone adds a debt and syncs…
  drive.addFile(FOLDERS.debts, 'MEMORY.md', staleMd + '\nהערה\n'); // …then Claude writes its stale copy as a new file
  await p.sync();
  assert.ok(JSON.parse(extractBlock(drive.text(FOLDERS.debts))).debts.find((d) => d.id === 'd2'));
  assert.ok(drive.text(FOLDERS.debts).includes('הערה'));
});

test('file rewritten WITHOUT the block: app refuses to write, keeps local data', async () => {
  const drive = setup();
  const parts = splitDoc(docFromState(STATE));
  for (const s of SECTION_IDS) drive.rawWrite(await drive.findInFolder(FOLDERS[s], 'MEMORY.md'), replaceBlock(MD[s], stringifyDoc(parts[s])));
  const p = phone(drive); await p.sync();
  const v0 = await p.view(); const v1 = JSON.parse(JSON.stringify(v0)); v1.leisure.books = [];
  await p.change(v0, v1);
  drive.addFile(FOLDERS.leisure, 'MEMORY.md', '# פנאי בלי בלוק\n');
  const errs = await p.sync();
  assert.equal(errs.length, 1); assert.equal(errs[0][0], 'leisure'); assert.ok(errs[0][1] instanceof CorruptRemoteError);
  assert.equal(drive.text(FOLDERS.leisure), '# פנאי בלי בלוק\n');
  const waiting = await p.store.getOutbox();                  // the change waits, not lost
  assert.ok(waiting.length > 0 && waiting.every((op) => sectionOfOp(op) === 'leisure'));
  assert.deepEqual(await p.view(), v1);
});

test('missing MEMORY.md: clear error, other areas still sync', async () => {
  const drive = setup();
  drive.files.get(await drive.findInFolder(FOLDERS.finance, 'MEMORY.md')).trashed = true;
  const p = phone(drive);
  const errs = await p.sync();
  assert.equal(errs.length, 1); assert.ok(errs[0][1] instanceof MissingFileError);
});

test('rewriteSections: replaces/removes only the named sections', async () => {
  const { rewriteSections } = await import('../memfile.js');
  const md = '# פנאי\n\nפתיח\n\n#### תוכנית\nמבנה\n\n##### Upper A\n| a |\n\n#### ריצות\n| r |\n\n## בישול\n\n### מתכונים\n- א\n- ב\n\n## טיולים\nסגנון\n';
  const r = rewriteSections(md, [
    { heading: '#### תוכנית', with: '#### תוכנית\nבבלוק.\n' },
    { heading: '#### ריצות', with: '' },
    { heading: '### מתכונים', with: '### מתכונים\nבבלוק.\n' },
    { heading: '### לא קיים', with: '' },
  ]);
  assert.deepEqual(r.missing, ['### לא קיים']);
  assert.equal(r.md, '# פנאי\n\nפתיח\n\n#### תוכנית\nבבלוק.\n\n## בישול\n\n### מתכונים\nבבלוק.\n\n## טיולים\nסגנון\n');
});
