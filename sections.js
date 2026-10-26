// sections.js — which MEMORY.md each piece of dashboard data belongs to.
//   tasks   -> מקצועי/לו״ז ומשימות      (tasks, category order, calendar list, asOf)
//   debts   -> מקצועי/חובות והלוואות
//   finance -> מקצועי/פיננסים           (finance.*)
//   leisure -> פנאי/ספורט בישול טיולים וספרים (sports.*, leisure.*)
//   spending -> מקצועי/פיננסים/הוצאות      (finance.spending: monthly spending analysis)
import { emptyDoc, COLLECTIONS, clone } from './sync.js';

export const SECTION_IDS = ['tasks', 'debts', 'finance', 'leisure', 'spending'];
export const SECTION_NAMES = { tasks: 'משימות', debts: 'חובות', finance: 'פיננסים', leisure: 'ספורט ופנאי', spending: 'הוצאות' };

const COLL_SECTION = {
  tasks: 'tasks', debts: 'debts',
  sports_days: 'leisure', sports_workoutLog: 'leisure', sports_runs: 'leisure',
  leisure_books: 'leisure', leisure_movies: 'leisure', leisure_travel: 'leisure',
  leisure_learning: 'leisure', leisure_cooking: 'leisure',
};

// A 'fields' item id ("finance.longTerm", "order:tasks", "asOf"...) -> section.
export function sectionOfField(id) {
  const path = id.startsWith('order:') ? id.slice(6) : id;
  if (path === 'finance.spending' || path.startsWith('finance.spending.')) return 'spending';
  const top = path.split('.')[0];
  if (top === 'finance') return 'finance';
  if (top === 'sports' || top === 'leisure' || top === 'leisureSectionOrder') return 'leisure';
  if (top === 'debts') return 'debts';
  return 'tasks'; // tasks, asOf, categoryOrder, calendars and anything new
}

export function sectionOfOp(op) {
  if (op.coll === 'fields') return sectionOfField(op.id);
  const s = COLL_SECTION[op.coll];
  if (!s) throw new Error('unknown collection ' + op.coll);
  return s;
}

export function collectionsOf(sec) {
  return COLLECTIONS.filter((c) => c !== 'fields' && COLL_SECTION[c] === sec);
}

// Only this section's data (used when writing a block, so each file holds just its own lists).
export function pickSection(doc, sec) {
  const out = { schemaVersion: doc.schemaVersion };
  for (const c of collectionsOf(sec)) out[c] = doc[c] || [];
  out.fields = (doc.fields || []).filter((f) => sectionOfField(f.id) === sec);
  return out;
}

// The four files' docs -> one doc for the screens.
export function mergeDocs(docs) {
  const out = emptyDoc();
  for (const d of docs) {
    if (!d) continue;
    for (const c of COLLECTIONS) for (const it of d[c] || []) out[c].push(clone(it));
  }
  return out;
}

// Splits a whole doc (e.g. built from the old dashboard) into the four section docs.
export function splitDoc(doc) {
  const res = {};
  for (const s of SECTION_IDS) res[s] = pickSection(doc, s);
  return res;
}
