// model.js — translates between the dashboard's STATE object (what the screens use)
// and the Drive file (lists of items with per-field timestamps, see sync.js).
//
//   STATE.tasks            <-> doc.tasks              (one item per task, keyed by id)
//   STATE.sports.days      <-> doc.sports_days        (same for every list below)
//   STATE.finance.longTerm <-> doc.fields[id='finance.longTerm']  (a whole block = one value)
//   order of a list        <-> doc.fields[id='order:tasks']       (array of ids)
//
// The screens keep working exactly as before: they change STATE, then we compare the old and
// new STATE and turn the differences into small ops ("task X: done=true"). Only those go to Drive.
import { makeOp, emptyDoc, applyOps, clone } from './sync.js';

// Lists whose items have an `id` -> synced item by item.
export const LISTS = {
  'tasks': 'tasks',
  'debts': 'debts',
  'sports.days': 'sports_days',
  'sports.workoutLog': 'sports_workoutLog',
  'sports.runs': 'sports_runs',
  'leisure.books': 'leisure_books',
  'leisure.movies': 'leisure_movies',
  'leisure.travel': 'leisure_travel',
  'leisure.learning': 'leisure_learning',
  'leisure.cooking': 'leisure_cooking',
};
// Objects whose children are stored as separate fields (so two people editing different
// finance blocks don't overwrite each other). Everything deeper is one value.
const SPLIT = new Set(['', 'finance', 'sports', 'leisure']);
// Screen-only state that must never be synced.
const LOCAL_ONLY = new Set(['currentRoute']);
const ITEM_META = new Set(['_f', 'deleted']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(o[keys[i]])) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

// STATE -> { fields: {path: value}, lists: {path: [items]} }
export function flatten(state) {
  const fields = {}, lists = {};
  (function walk(obj, prefix) {
    for (const k of Object.keys(obj)) {
      const path = prefix ? prefix + '.' + k : k;
      const v = obj[k];
      if (v === undefined || LOCAL_ONLY.has(path)) continue;
      if (LISTS[path]) {
        if (!Array.isArray(v)) throw new Error('expected a list at ' + path);
        lists[path] = v;
      } else if (SPLIT.has(path) && isObj(v)) {
        walk(v, path);
      } else {
        fields[path] = v;
      }
    }
  })(state || {}, '');
  return { fields, lists };
}

// Drive doc (after ops applied) -> STATE for the screens.
export function toState(doc) {
  const state = {};
  const orders = {};
  for (const f of doc.fields || []) {
    if (f.deleted) continue;
    if (f.id.startsWith('order:')) orders[f.id.slice(6)] = f.value;
    else setPath(state, f.id, clone(f.value));
  }
  for (const [path, coll] of Object.entries(LISTS)) {
    const items = (doc[coll] || []).filter((x) => !x.deleted).map((x) => {
      const o = {};
      for (const [k, v] of Object.entries(x)) if (!ITEM_META.has(k) && v !== null) o[k] = clone(v);
      return o;
    });
    const order = orders[path];
    if (order) {
      const pos = new Map(order.map((id, i) => [id, i]));
      // stable: known ids by saved order, unknown (e.g. just added by Claude) keep file order at the end
      items.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
    }
    const parentExists = path.indexOf('.') < 0 || getPath(state, path.split('.')[0]) !== undefined || items.length || order;
    if (parentExists) setPath(state, path, items);
  }
  return state;
}

// What changed between two STATEs, as sync ops. `at` = one timestamp for the whole batch.
export function diff(prev, next, at) {
  at = at || new Date().toISOString();
  const ops = [];
  const a = flatten(prev || {}), b = flatten(next || {});

  // plain fields
  for (const path of new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])) {
    const before = a.fields[path], after = b.fields[path];
    if (same(before, after)) continue;
    ops.push(after === undefined
      ? makeOp('fields', path, { deleted: true }, at)
      : makeOp('fields', path, { value: clone(after), deleted: false }, at));
  }

  // lists
  for (const path of Object.keys(LISTS)) {
    const coll = LISTS[path];
    const before = a.lists[path] || [], after = b.lists[path] || [];
    if (!a.lists[path] && !b.lists[path]) continue;
    const prevById = new Map(before.map((x) => [x.id, x]));
    const nextIds = [];
    for (const item of after) {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error('item without id in ' + path);
      nextIds.push(item.id);
      const old = prevById.get(item.id);
      const changed = {};
      for (const k of new Set([...Object.keys(old || {}), ...Object.keys(item)])) {
        if (k === 'id' || ITEM_META.has(k)) continue;
        const v = item[k] === undefined ? null : item[k];
        const o = old ? (old[k] === undefined ? null : old[k]) : undefined;
        if (!old || !same(o, v)) changed[k] = clone(v);
      }
      if (!old) changed.deleted = false;
      if (Object.keys(changed).length) ops.push(makeOp(coll, item.id, changed, at));
    }
    const nextSet = new Set(nextIds);
    for (const old of before) if (!nextSet.has(old.id)) ops.push(makeOp(coll, old.id, { deleted: true }, at));
    if (!same(before.map((x) => x.id), nextIds)) ops.push(makeOp('fields', 'order:' + path, { value: nextIds, deleted: false }, at));
  }
  return ops;
}

// Build a whole Drive doc from a STATE (used once, to move the existing dashboard over).
export function docFromState(state, at) {
  return applyOps(emptyDoc(), diff({}, state, at));
}
