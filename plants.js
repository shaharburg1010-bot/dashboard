// plants.js — the "צמחים" page: which plants to water on which weekday, and when each was last watered.
// The plant list (names, photos, recommended days) is fixed here; only the watering dates are data:
//   STATE.leisure.plantWater = { <plantId>: ['YYYY-MM-DD'] }   only the last watering (section 'leisure')
// Winter schedule (Nov 2026), low direct sun on the balcony. Weekdays: 0 = Sunday … 6 = Saturday.
//   g: colour group  s = every 2-3 weeks (gold), w = every 4-6 days (blue), m = every 7-14 days (green)
//   min: fewest days between waterings; the plant is not suggested again before that.
export const PLANT_GROUPS = {
  s: { label: 'כל 2–3 שבועות', color: '#c08a2e' },
  w: { label: 'כל 4–6 ימים', color: '#2b7bb9' },
  m: { label: 'כל 7–14 ימים', color: '#3a9a5b' },
};
export const PLANTS = [
  { id: 'strelitzia', where: 'home', g: 'm', name: 'ציפור גן עדן (סטרליציה)', freq: 'כל 7–10 ימים', min: 7, days: [2], note: 'כשהאדמה יבשה בעומק ~5 ס״מ' },
  { id: 'dieffenbachia', where: 'home', g: 'm', name: 'דיפנבכיה', freq: 'כל 7–10 ימים', min: 7, days: [2], note: 'רגישה לעודף מים בחורף' },
  { id: 'hoya', where: 'balcony', g: 's', name: 'הויה', freq: 'כל 2–3 שבועות', min: 14, days: [5], note: 'רק כשהאדמה יבשה לגמרי' },
  { id: 'tall_succ', where: 'balcony', g: 's', name: 'קרסולה אובטה "המלס סאנסט"', freq: 'כל 3 שבועות', min: 21, days: [5], note: 'רק כשהאדמה יבשה לגמרי. העלים שעל האדמה: להרטיב קלות כל שבוע' },
  { id: 'petunia', where: 'balcony', g: 'w', name: 'פטוניות', freq: 'כל 4–5 ימים', min: 3, days: [0, 3], note: 'אדנית רדודה, להוריד פרחים נבולים' },
  { id: 'calendula', where: 'balcony', g: 'w', name: 'ציפורני חתול (קלנדולה)', freq: 'כל 4–5 ימים', min: 3, days: [0, 3], note: 'באותה אדנית עם הפטוניות' },
  { id: 'mint', where: 'balcony', g: 'w', name: 'נענע', freq: 'כל 4–5 ימים', min: 3, days: [0, 3], note: 'אוהבת אדמה לחה' },
  { id: 'chives', where: 'balcony', g: 'w', name: 'עירית', freq: 'כל 4–6 ימים', min: 3, days: [0, 3], note: 'נבטים צעירים, לא לתת להתייבש לגמרי' },
  { id: 'marguerite', where: 'balcony', g: 'w', name: 'מרגנית', freq: 'כל 4–6 ימים', min: 3, days: [0, 3], note: 'להוריד פרחים נבולים' },
  { id: 'rosemary', where: 'balcony', g: 'm', name: 'רוזמרין', freq: 'כל 7–10 ימים', min: 6, days: [5], note: 'לתת לאדמה להתייבש בין השקיות' },
  { id: 'verbena', where: 'balcony', g: 'm', name: 'לואיזה', freq: 'כל 7–10 ימים', min: 6, days: [5], note: 'משירה עלים בחורף, זה תקין' },
  { id: 'sage', where: 'balcony', g: 'm', name: 'מרווה', freq: 'כל 7–10 ימים', min: 6, days: [5], note: 'העלים האפורים הקטיפתיים' },
  { id: 'spider', where: 'balcony', g: 'm', name: 'כלורופיטום', freq: 'כל 7–10 ימים', min: 6, days: [5], note: 'העציץ התלוי עם הפסים' },
  { id: 'pothos_hang', where: 'balcony', g: 'm', name: 'פוטוס (תלוי)', freq: 'כל 10–14 יום', min: 9, days: [5], note: 'עלים צהובים = כנראה יותר מדי מים' },
  { id: 'pothos_shelf', where: 'balcony', g: 'm', name: 'פוטוס (במדף)', freq: 'כל 10–14 יום', min: 9, days: [5], note: 'גם הפוטוס בעציץ העליון במדף' },
  { id: 'syngonium', where: 'balcony', g: 'm', name: 'סינגוניום', freq: 'כל 7–10 ימים', min: 6, days: [5], note: 'עלי החץ הבהירים, עם הפוטוס' },
  { id: 'succ_pot', where: 'balcony', g: 'm', name: 'זנב חמור + שרשרת אודם', freq: 'כל 7–10 ימים, מעט', min: 6, days: [5], note: 'בקליטה: רק להרטיב קלות. אחרי שנקלט (4–6 שבועות): כל 2–3 שבועות' },
  { id: 'echeveria', where: 'balcony', g: 'm', name: 'אצ׳וריה (סוקולנט קטן)', freq: 'כל 7–10 ימים, מעט', min: 6, days: [5], note: 'בקליטה: רק להרטיב קלות. אחרי שנקלט (4–6 שבועות): כל 2–3 שבועות' },
  { id: 'gray_pot', where: 'balcony', g: 'm', name: 'אוזן פיל', freq: 'כל 7–10 ימים', min: 6, days: [2], note: 'צומח מחדש: אדמה לחה קלות, לא רטובה. לבדוק כל 5–7 ימים' },
];
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
export function dueToday(log, todayIso, plants = PLANTS) {
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
