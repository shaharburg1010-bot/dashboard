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
