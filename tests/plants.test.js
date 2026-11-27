import test from 'node:test';
import assert from 'node:assert/strict';
import { plantList, plantPhoto, normPlant, plantStatus, dueToday, recordWatering, removeWatering, lastWatered, weekdayOf } from '../plants.js';
import { applyChanges } from '../inbox.js';
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
  assert.deepEqual(dueToday([fern, { id: 'y', days: [1], min: 3 }], {}, FRI).map((p) => p.id), ['x']);
});

test('only the last watering is kept; removing it leaves none', () => {
  let log = recordWatering({}, 'x', '2026-11-20');
  log = recordWatering(log, 'x', '2026-11-24');
  assert.deepEqual(log.x, ['2026-11-24']);
  log = removeWatering(log, 'x', '2026-11-24');
  assert.equal(lastWatered(log, 'x'), null);
});

test('plants come from the data only, with safe defaults', () => {
  assert.deepEqual(plantList({}), []);
  const p = normPlant({ id: 'a', name: 'A', g: 'm', min: 10, days: [5, 9, 'x'] });
  assert.equal(p.row, 'm10'); assert.deepEqual(p.days, [5]); assert.equal(p.where, 'balcony');
  assert.equal(normPlant({ id: 'b', name: 'B', g: 'w' }).row, 'w');
  assert.equal(normPlant({ name: 'no id' }), null);
});

test('a dashboard-inbox file adds, updates and removes plants and sets a photo', () => {
  let s = { leisure: { books: [] } };
  s = applyChanges(s, [{ set: 'leisure.plants', value: [] }]).state;
  s = applyChanges(s, [
    { add: 'leisure.plants', item: { id: 'basil', name: 'בזיליקום', g: 'w', days: [0, 3] } },
    { add: 'leisure.plants', item: { id: 'mint', name: 'נענע', g: 'w', days: [0] } },
    { update: 'leisure.plants', id: 'mint', fields: { days: [1, 4] } },
    { remove: 'leisure.plants', id: 'basil' },
    { set: 'leisure.plantPhotos.mint', value: 'data:image/jpeg;base64,AAA' },
  ]).state;
  const list = plantList(s);
  assert.deepEqual(list.map((p) => p.id), ['mint']);
  assert.deepEqual(list[0].days, [1, 4]);
  assert.equal(plantPhoto(s, list[0]), 'data:image/jpeg;base64,AAA');
});

test('plant data and watering dates are stored in the leisure area', () => {
  const ops = diff({ leisure: { books: [] } }, { leisure: { books: [], plants: [{ id: 'a', name: 'A' }], plantWater: { a: [FRI] }, plantPhotos: { a: 'x' } } });
  assert.ok(ops.length >= 3);
  for (const op of ops) assert.equal(sectionOfOp(op), 'leisure');
});
