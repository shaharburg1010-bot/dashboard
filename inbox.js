// inbox.js — how Claude and the agents change dashboard data without rewriting MEMORY.md.
// They drop a small JSON file whose name contains "dashboard-inbox" into the area's Drive folder:
//   { "by": "סוכן ההשקעות", "changes": [
//       { "set": "finance.shortMedium.analystGemel.value", "value": 179500 },
//       { "set": "finance.shortMedium.ibkr.holdings[QQQ].price", "value": 704.4 },
//       { "add": "tasks", "item": { "cat": "כללי", "text": "לחדש דרכון", "urgent": false } },
//       { "update": "tasks", "id": "t_123", "fields": { "urgent": true } },
//       { "remove": "debts", "id": "d4" } ] }
// On the next sync the app applies the changes (as if typed on the phone), writes them into the
// block in MEMORY.md, and moves the inbox file to the trash.
// Paths: dots between keys; [x] picks the list item whose id (or ticker) is x, or index x if numeric.
export const INBOX_MARK = 'dashboard-inbox';
const clone = (x) => JSON.parse(JSON.stringify(x));

function parsePath(path) {
  const segs = [];
  for (const part of String(path).split('.')) {
    const m = part.match(/^([^\[\]]*)((?:\[[^\]]+\])*)$/);
    if (!m) throw new Error('נתיב לא תקין: ' + path);
    if (m[1]) segs.push({ key: m[1] });
    for (const sel of m[2].match(/\[[^\]]+\]/g) || []) segs.push({ sel: sel.slice(1, -1) });
  }
  return segs;
}
function step(obj, seg, path) {
  if (seg.key !== undefined) return obj[seg.key];
  if (!Array.isArray(obj)) throw new Error('לא רשימה: ' + path);
  if (/^\d+$/.test(seg.sel)) return obj[Number(seg.sel)];
  return obj.find((x) => x && (x.id === seg.sel || x.ticker === seg.sel));
}
function resolveParent(state, path) {
  const segs = parsePath(path);
  let o = state;
  for (let i = 0; i < segs.length - 1; i++) {
    let next = step(o, segs[i], path);
    if (next === undefined && segs[i].key !== undefined && !(segs[i + 1].sel !== undefined)) { next = {}; o[segs[i].key] = next; }
    if (next === undefined || next === null) throw new Error('לא נמצא: ' + path);
    o = next;
  }
  return { parent: o, last: segs[segs.length - 1] };
}
function getList(state, path) {
  const { parent, last } = resolveParent(state, path);
  const list = step(parent, last, path);
  if (!Array.isArray(list)) throw new Error('לא רשימה: ' + path);
  return list;
}

let n = 0;
// Returns { state, errors }. Bad commands are skipped (and reported); the rest still apply.
export function applyChanges(state, changes) {
  const s = clone(state); const errors = [];
  for (const c of changes || []) {
    try {
      if ('set' in c) {
        const { parent, last } = resolveParent(s, c.set);
        if (last.key !== undefined) parent[last.key] = clone(c.value);
        else {
          if (!Array.isArray(parent)) throw new Error('לא רשימה: ' + c.set);
          const i = /^\d+$/.test(last.sel) ? Number(last.sel) : parent.findIndex((x) => x && (x.id === last.sel || x.ticker === last.sel));
          if (i < 0) throw new Error('לא נמצא: ' + c.set);
          parent[i] = clone(c.value);
        }
      } else if ('add' in c) {
        const list = getList(s, c.add);
        const item = clone(c.item || {});
        if (!item.id) item.id = 'c_' + Date.now().toString(36) + '_' + (n++) + Math.random().toString(36).slice(2, 6);
        if (list.some((x) => x.id === item.id)) throw new Error('id כבר קיים: ' + item.id);
        if (c.first) list.unshift(item); else list.push(item);
      } else if ('update' in c) {
        const it = getList(s, c.update).find((x) => x.id === c.id);
        if (!it) throw new Error('לא נמצא ' + c.id + ' ב-' + c.update);
        Object.assign(it, clone(c.fields || {}));
      } else if ('remove' in c) {
        const list = getList(s, c.remove);
        const i = list.findIndex((x) => x.id === c.id);
        if (i < 0) throw new Error('לא נמצא ' + c.id + ' ב-' + c.remove);
        list.splice(i, 1);
      } else throw new Error('פקודה לא מוכרת');
    } catch (e) { errors.push(e.message); }
  }
  return { state: s, errors };
}

// Markdown escaping that a copy through read_file_content can add (\_ \[ \` …): undo it.
export function unescapeMd(text) { return String(text).replace(/\\([\\`*_{}\[\]()#+\-.!>"|~])/g, '$1'); }
export function parseLoose(text) {
  try { return JSON.parse(text); } catch (e) { return JSON.parse(unescapeMd(text)); }
}
