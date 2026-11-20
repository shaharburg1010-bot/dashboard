// sorties.js — the "גיחות" page: squadron training days and the sorties flown in each.
// Stored as one field, STATE.sorties (section 'tasks', see sections.js — no new collection):
//   { goals: { flights, night, sim },
//     days: [ { id, date: 'YYYY-MM-DD', copilot, captain, mm1, mm2, note,
//               flights: [ { kind: 'day' | 'night' | 'sim', quals } ] } ] }
// Every text field is free text and optional. 'sim' (מאמן) is counted on its own, not as a sortie.
// Goals are per half-year period (January-June, July-December), named like '2.26'.
// The "last sortie / last night" dates look at all days.
export const SORTIE_KINDS = ['day', 'night', 'sim'];
export const SORTIE_GOALS = { flights: 27, night: 8, sim: 8 };

const DAY_MS = 864e5;
function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function daysBetween(fromIso, toIso) {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / DAY_MS);
}
export const validIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// A half-year period: back=0 is the one containing `today`, back=1 the one before it.
// -> { start, end, name } ('YYYY-MM-DD', name like '2.26' = second half of 2026).
export function sortiePeriod(today, back) {
  const t = today || new Date();
  let idx = t.getFullYear() * 2 + (t.getMonth() < 6 ? 0 : 1) - (back || 0);
  const y = Math.floor(idx / 2), h = idx % 2;
  return h === 0
    ? { start: y + '-01-01', end: y + '-06-30', name: '1.' + String(y).slice(2) }
    : { start: y + '-07-01', end: y + '-12-31', name: '2.' + String(y).slice(2) };
}

// Data is kept for the current and the previous period only. Days without a valid date are kept.
export const keepFrom = (today) => sortiePeriod(today, 1).start;
export function prunePast(days, today) {
  const from = keepFrom(today);
  return (days || []).filter((d) => !validIso(d.date) || d.date >= from);
}

// Totals for one period (back=0 current, 1 previous) and "last" dates over all days. today: a Date.
export function sortieStats(sorties, today, back) {
  const s = sorties || {};
  const goals = Object.assign({}, SORTIE_GOALS, s.goals || {});
  const t = isoDay(today || new Date());
  const period = sortiePeriod(today, back);
  const out = { day: 0, night: 0, sim: 0, flights: 0, goals, period, lastFlight: null, lastNight: null, lastSim: null };
  for (const d of s.days || []) {
    if (!validIso(d.date)) continue;
    const inPeriod = d.date >= period.start && d.date <= period.end;
    for (const f of d.flights || []) {
      const k = SORTIE_KINDS.includes(f && f.kind) ? f.kind : 'day';
      if (inPeriod) out[k]++;
      if (k !== 'sim' && (!out.lastFlight || d.date > out.lastFlight)) out.lastFlight = d.date;
      if (k === 'night' && (!out.lastNight || d.date > out.lastNight)) out.lastNight = d.date;
      if (k === 'sim' && (!out.lastSim || d.date > out.lastSim)) out.lastSim = d.date;
    }
  }
  out.flights = out.day + out.night;
  out.sinceFlight = out.lastFlight ? daysBetween(out.lastFlight, t) : null;
  out.sinceNight = out.lastNight ? daysBetween(out.lastNight, t) : null;
  return out;
}

// "28.6.2026" / "28.06.26" / "2026-06-28" -> "2026-06-28" (null if not a real date).
export function toIsoDate(text) {
  const v = String(text || '').trim();
  let y, m, d;
  let mm = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else if ((mm = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/))) { d = +mm[1]; m = +mm[2]; y = +mm[3]; if (y < 100) y += 2000; }
  else return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return isoDay(dt);
}
