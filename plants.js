// plants.js — the "צמחים" page logic. ALL plant content is data, not code (Shahar, 27.11.2026):
//   STATE.leisure.plants      = [ { id, name, where: 'home'|'balcony', g: 's'|'w'|'m', freq, min, days: [0-6], note, img? } ]
//   STATE.leisure.plantPhotos = { <plantId>: 'data:image/jpeg;base64,...' }   optional photo (wins over img)
//   STATE.leisure.plantWater  = { <plantId>: ['YYYY-MM-DD'] }                 only the last watering
// (all in section 'leisure'). Add / remove / change a plant with a dashboard-inbox file in the leisure folder:
//   { "add": "leisure.plants", "item": { "id": "basil", "name": "בזיליקום", "where": "balcony", "g": "w",
//                                        "freq": "כל 4–5 ימים", "min": 3, "days": [0, 3], "note": "" } }
//   { "update": "leisure.plants", "id": "mint", "fields": { "days": [1, 4] } }
//   { "remove": "leisure.plants", "id": "mint" }
//   { "set": "leisure.plantPhotos.basil", "value": "data:image/jpeg;base64,..." }   (~240px JPEG)
// Fields: g = colour group (s gold 2-3 weeks, w blue 4-6 days, m green 7-14 days); min = fewest days between
// waterings (not suggested again before that); days: recommended weekdays, 0 = Sunday … 6 = Saturday;
// row (optional) = balcony row: 'w' | 'm7' | 'm10' | 's' (default from g and min); img = path or URL.
// Nothing about a specific plant lives in this file.
export const PLANT_GROUPS = {
  s: { label: 'כל 2–3 שבועות', color: '#c08a2e' },
  w: { label: 'כל 4–6 ימים', color: '#2b7bb9' },
  m: { label: 'כל 7–14 ימים', color: '#3a9a5b' },
};
// Balcony rows, shortest interval first.
export const PLANT_ROWS = [
  { id: 'w', label: 'כל 4–6 ימים', color: '#2b7bb9' },
  { id: 'm7', label: 'כל 7–10 ימים', color: '#3a9a5b' },
  { id: 'm10', label: 'כל 10–14 יום', color: '#3a9a5b' },
  { id: 's', label: 'כל 2–3 שבועות', color: '#c08a2e' },
];
const DEFAULT_MIN = { w: 3, m: 6, s: 14 };

// One stored plant -> a safe, complete object (bad or missing fields get defaults; no id -> dropped).
export function normPlant(p) {
  if (!p || !p.id || !p.name) return null;
  const g = PLANT_GROUPS[p.g] ? p.g : 'm';
  const min = Number.isFinite(+p.min) && +p.min >= 0 ? +p.min : DEFAULT_MIN[g];
  const days = (Array.isArray(p.days) ? p.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const row = PLANT_ROWS.some((r) => r.id === p.row) ? p.row : (g === 'm' ? (min >= 9 ? 'm10' : 'm7') : g);
  return { id: String(p.id), name: String(p.name), where: p.where === 'home' ? 'home' : 'balcony', g, min, days,
    freq: p.freq ? String(p.freq) : PLANT_GROUPS[g].label, note: p.note ? String(p.note) : '', img: p.img ? String(p.img) : '', row };
}
export function plantList(state) {
  const list = (state && state.leisure && state.leisure.plants) || [];
  return (Array.isArray(list) ? list : []).filter((p) => p && !p.deleted).map(normPlant).filter(Boolean);
}
export function plantPhoto(state, p) {
  const ph = state && state.leisure && state.leisure.plantPhotos;
  return (ph && ph[p.id]) || p.img || '';
}
export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const KEEP_DATES = 1; // only the last watering is kept (Shahar, 27.11.2026)

const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function utc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
export function daysBetweenIso(a, b) { return Math.round((utc(b) - utc(a)) / 864e5); }
export function weekdayOf(iso) { return new Date(utc(iso)).getUTCDay(); }

export function plantDates(log, id) {
  return ((log && log[id]) || []).filter(isIso).slice().sort().reverse();
}
export function lastWatered(log, id) { return plantDates(log, id)[0] || null; }

// -> { last, since (days or null), today: recommended weekday is today, due: should be watered today }
export function plantStatus(plant, log, todayIso) {
  const last = lastWatered(log, plant.id);
  const since = last ? daysBetweenIso(last, todayIso) : null;
  const today = plant.days.includes(weekdayOf(todayIso));
  const rested = since === null || since >= plant.min;
  return { last, since, today, wateredToday: since === 0, due: today && rested };
}
export function dueToday(plants, log, todayIso) {
  return plants.filter((p) => plantStatus(p, log, todayIso).due);
}

// New log with `iso` added for plant `id` (once per day, newest KEEP_DATES kept). Does not change `log`.
export function recordWatering(log, id, iso) {
  const out = Object.assign({}, log || {});
  const dates = plantDates(out, id).filter((d) => d !== iso);
  dates.unshift(iso);
  out[id] = dates.sort().reverse().slice(0, KEEP_DATES);
  return out;
}
export function removeWatering(log, id, iso) {
  const out = Object.assign({}, log || {});
  out[id] = plantDates(out, id).filter((d) => d !== iso);
  return out;
}
