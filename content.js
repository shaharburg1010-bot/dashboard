// content.js — lists that used to be fixed in legacy.js and are now read from the data (Shahar, 27.11.2026:
// content is data, not code). Change them with a dashboard-inbox file, no code change:
//   finance.longFunds = [ { id, label, in: 'longTerm'|'shortMedium' } ]      the long-range funds (finance folder)
//       the fund's own object is finance[in][id] (value, return, tracks, policy …). Order = order on screen.
//       { "add": "finance.longFunds", "item": { "id": "newFund", "label": "קופה חדשה", "in": "longTerm" } }
//       { "remove": "finance.longFunds", "id": "menorahGemel" }
//   finance.spending.buckets = { names: { food, fun, recurring, oneOff }, map: { <category>: bucket|null } }  (spending folder)
//       which budget bucket each spending category counts in; null = not in the budget; not listed = oneOff.
//       finance.spending.budget.map still wins per category (older override).
//       { "set": "finance.spending.buckets.map.AI וטוקנים", "value": "recurring" }
//   diet.mealTimes = ['בוקר', 'צהריים', 'ערב']    meal groups on the diet page (diet inbox folder)
//       a meal whose cat is not listed still shows, after these.
export const BUCKET_KEYS = ['food', 'recurring', 'oneOff', 'fun'];
// Defaults for a missing name only (the four budget keys are fixed by finance.spending.budget).
const BUCKET_DEFAULT_NAMES = { food: 'אוכל', fun: 'בילויים', recurring: 'שוטפות', oneOff: 'חד-פעמי' };

// -> [{ id, label, in, o }] only funds that exist in the data.
export function longFunds(fin) {
  const f = fin || {};
  const list = Array.isArray(f.longFunds) ? f.longFunds : [];
  return list.filter((d) => d && d.id).map((d) => {
    const where = d.in === 'shortMedium' ? 'shortMedium' : 'longTerm';
    const o = (f[where] || {})[d.id];
    return o && typeof o === 'object' ? { id: String(d.id), label: String(d.label || d.id), in: where, o } : null;
  }).filter(Boolean);
}
export function longTotal(fin) {
  return longFunds(fin).reduce((a, d) => a + (Number(d.o.value) || 0), 0);
}
// The fund's yearly returns: its own `return`, else its first track's.
export function fundReturn(o) {
  if (!o) return null;
  if (o.return) return o.return;
  return (o.tracks && o.tracks[0] && o.tracks[0].return) || null;
}

export function bucketOf(cat, spending) {
  const sp = spending || {};
  const over = sp.budget && sp.budget.map;
  if (over && over[cat] !== undefined) return over[cat];
  const map = (sp.buckets && sp.buckets.map) || {};
  if (map[cat] !== undefined) return map[cat] === null || BUCKET_KEYS.includes(map[cat]) ? map[cat] : 'oneOff';
  return 'oneOff';
}
export function bucketNames(spending) {
  const n = (spending && spending.buckets && spending.buckets.names) || {};
  const out = {};
  for (const k of BUCKET_KEYS) out[k] = n[k] ? String(n[k]) : BUCKET_DEFAULT_NAMES[k];
  return out;
}

// Meal groups in order: diet.mealTimes, then any other cat used by a meal.
export function mealTimes(diet) {
  const d = diet || {};
  const out = (Array.isArray(d.mealTimes) ? d.mealTimes : []).map(String).filter(Boolean);
  for (const m of d.meals || []) if (m && m.cat && !out.includes(m.cat)) out.push(m.cat);
  return out;
}
