import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS, plantStatus, dueToday, recordWatering, removeWatering, lastWatered, weekdayOf } from '../plants.js';
import { diff } from '../model.js';
import { sectionOfOp } from '../sections.js';

const FRI = '2026-11-27'; // a Friday
const fern = { id: 'x', days: [5], min: 6 };

test('weekday of an ISO date', () => { assert.equal(weekdayOf(FRI), 5); assert.equal(weekdayOf('2026-11-29'), 0); });

test('due on its weekday only when never watered or rested long enough', () => {
  assert.equal(plantStatus(fern, {}, FRI).due, true);
  assert.equal(plantStatus(fern, { x: ['2026-11-24'] }, FRI).due, false);
  assert.equal(plantStatus(fern, { x: ['2026-11-20'] }, FRI).due, true);
  assert.equal(plantStatus(fern, {}, '2026-11-26').due, false);
  assert.equal(plantStatus(fern, { x: [FRI] }, FRI).wateredToday, true);
});

test('record keeps one entry per day, newest first, capped', () => {
  let log = {};
  for (let d = 1; d <= 12; d++) log = recordWatering(log, 'x', '2026-11-' + String(d).padStart(2, '0'));
  log = recordWatering(log, 'x', '2026-11-12');
  assert.equal(log.x.length, 10); assert.equal(lastWatered(log, 'x'), '2026-11-12');
  log = removeWatering(log, 'x', '2026-11-12');
  assert.equal(lastWatered(log, 'x'), '2026-11-11');
});

test('every plant has a photo id, days and a group; ids unique', () => {
  assert.equal(new Set(PLANTS.map((p) => p.id)).size, PLANTS.length);
  for (const p of PLANTS) { assert.ok(p.days.length >= 1 && p.days.length <= 2); assert.ok('swm'.includes(p.g)); }
  assert.ok(dueToday({}, FRI).length > 0);
});

test('watering dates are stored in the leisure area', () => {
  const ops = diff({ leisure: { books: [] } }, { leisure: { books: [], plantWater: { mint: [FRI] } } });
  assert.ok(ops.length > 0);
  for (const op of ops) assert.equal(sectionOfOp(op), 'leisure');
});
