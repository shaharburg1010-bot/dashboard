import test from 'node:test';
import assert from 'node:assert/strict';
import { longFunds, longTotal, fundReturn, bucketOf, bucketNames, mealTimes } from '../content.js';
import { applyChanges } from '../inbox.js';
import { diff } from '../model.js';
import { sectionOfOp } from '../sections.js';

const fin = {
  longFunds: [{ id: 'a', label: 'קופה א', in: 'longTerm' }, { id: 'b', label: 'קופה ב', in: 'shortMedium' }, { id: 'gone', in: 'longTerm' }],
  longTerm: { a: { value: 100, return: { y1: 5 } }, b: { value: 999 } },
  shortMedium: { b: { value: 50, tracks: [{ return: { y1: 7 } }] } },
};

test('long funds and their total come only from finance.longFunds', () => {
  assert.deepEqual(longFunds(fin).map((d) => d.id), ['a', 'b']);
  assert.equal(longTotal(fin), 150);
  assert.equal(longTotal({ longTerm: { a: { value: 1 } } }), 0);
  assert.equal(fundReturn(fin.longTerm.a).y1, 5);
  assert.equal(fundReturn(fin.shortMedium.b).y1, 7);
});

test('a fund is added or removed with an inbox file', () => {
  const s = applyChanges({ finance: fin }, [
    { add: 'finance.longFunds', item: { id: 'c', label: 'ג', in: 'longTerm' } }, { remove: 'finance.longFunds', id: 'a' }]).state;
  s.finance.longTerm.c = { value: 10 };
  assert.equal(longTotal(s.finance), 60);
});

test('spending buckets: budget.map, then buckets.map, else one-off', () => {
  const sp = { buckets: { map: { 'סופר': 'food', 'חברים': null, 'מוזר': 'xyz' }, names: { food: 'אוכל ושתייה' } }, budget: { map: { 'ספורט': 'fun' } } };
  assert.equal(bucketOf('סופר', sp), 'food');
  assert.equal(bucketOf('חברים', sp), null);
  assert.equal(bucketOf('ספורט', sp), 'fun');
  assert.equal(bucketOf('מוזר', sp), 'oneOff');
  assert.equal(bucketOf('חדש', sp), 'oneOff');
  assert.equal(bucketOf('סופר', {}), 'oneOff');
  assert.equal(bucketNames(sp).food, 'אוכל ושתייה');
  assert.equal(bucketNames({}).fun, 'בילויים');
});

test('meal times from the data, then any other used group', () => {
  assert.deepEqual(mealTimes({ mealTimes: ['בוקר', 'ערב'], meals: [{ cat: 'ערב' }, { cat: 'מקת״ג' }, {}] }), ['בוקר', 'ערב', 'מקת״ג']);
  assert.deepEqual(mealTimes({}), []);
});

test('the new fields sync in their own areas', () => {
  const ops = diff({}, { finance: { longFunds: [], spending: { buckets: {} } }, diet: { mealTimes: [] } });
  const by = Object.fromEntries(ops.map((o) => [o.id, sectionOfOp(o)]));
  assert.equal(by['finance.longFunds'], 'finance');
  assert.equal(by['finance.spending'], 'spending');
  assert.equal(by['diet.mealTimes'], 'diet');
});
