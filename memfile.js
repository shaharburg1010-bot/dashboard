// memfile.js — the dashboard's data lives inside each area's MEMORY.md, as one JSON block
// at the end of the file:
//
//   ## נתוני הדשבורד
//   ```json dashboard-data
//   { ...the same sync format as sync.js... }
//   ```
//
// Everything else in the file (Claude's notes, decisions, context) is never touched.
export const HEADING = '## נתוני הדשבורד';
export const NOTE = '> הבלוק הזה נכתב ע"י אפליקציית הדשבורד. Claude: לקרוא ולכתוב לפי ההוראות ב-README של הדשבורד (לא לשנות _f ידנית בלי לעדכן זמן).';
const FENCE_RE = /```json dashboard-data[ \t]*\r?\n([\s\S]*?)\r?\n```/;

// -> { json: string|null } (null = the file has no block yet)
export function extractBlock(md) {
  const m = String(md || '').match(FENCE_RE);
  return m ? m[1] : null;
}

export function hasBlock(md) { return FENCE_RE.test(String(md || '')); }

// Returns the markdown with the block set to `jsonText`. Adds the section at the end if missing.
export function replaceBlock(md, jsonText) {
  md = String(md || '');
  const fenced = '```json dashboard-data\n' + jsonText + '\n```';
  if (FENCE_RE.test(md)) return md.replace(FENCE_RE, () => fenced);
  const sep = md.endsWith('\n') ? '\n' : '\n\n';
  return md + sep + HEADING + '\n\n' + NOTE + '\n\n' + fenced + '\n';
}

// Compact but readable: one item per line, so a diff in Drive history stays small.
export function stringifyDoc(doc) {
  const out = ['{'];
  const keys = Object.keys(doc);
  keys.forEach((k, i) => {
    const v = doc[k];
    const comma = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v)) {
      if (!v.length) { out.push(` ${JSON.stringify(k)}: []${comma}`); return; }
      out.push(` ${JSON.stringify(k)}: [`);
      v.forEach((it, j) => out.push('  ' + JSON.stringify(it) + (j < v.length - 1 ? ',' : '')));
      out.push(` ]${comma}`);
    } else out.push(` ${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
  });
  out.push('}');
  return out.join('\n');
}

// One-time move of the old hand-written lists into the block: replaces whole markdown sections.
// A section = its heading line up to (not including) the next heading of the same or higher level.
// edits: [{ heading: '## שחר חייב', with: '## הרשימה\n\nטקסט...' }]   (with: '' removes the section)
// Returns { md, missing: [headings not found] }. Nothing outside the named sections changes.
export function rewriteSections(md, edits) {
  let lines = String(md || '').split('\n');
  const missing = [];
  const level = (l) => { const m = l.replace(/\r$/, '').match(/^(#{1,6})\s/); return m ? m[1].length : 0; };
  for (const e of edits) {
    const target = e.heading.trim();
    const start = lines.findIndex((l) => l.replace(/\r$/, '').trim() === target);
    if (start < 0) { missing.push(e.heading); continue; }
    const lv = level(lines[start]);
    let end = start + 1;
    while (end < lines.length && !(level(lines[end]) && level(lines[end]) <= lv)) end++;
    const repl = e.with ? (e.with.replace(/\n+$/, '') + '\n').split('\n') : [];
    lines = [...lines.slice(0, start), ...repl, ...lines.slice(end)];
  }
  return { md: lines.join('\n'), missing };
}
