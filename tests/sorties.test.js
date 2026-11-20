import test from 'node:test';
import assert from 'node:assert/strict';
import { sortieStats, sortiePeriod, prunePast, toIsoDate, moveSortiesToArmy, dayPeriodName, SORTIE_GOALS } from '../sorties.js';
import { diff } from '../model.js';
import { sectionOfOp } from '../sections.js';

const S = { days: [
  { id: 'a', date: '2026-06-28', flights: [{ kind: 'day' }, { kind: 'day' }, { kind: 'night' }] },
  { id: 'b', date: '2026-06-30', flights: [{ kind: 'sim' }, { kind: 'sim' }] },
  { id: 'c', date: '2026-07-10', flights: [{ kind: 'day', quals: 'x' }] },
  { id: 'd', date: 'bad', flights: [{ kind: 'night' }] },
  { id: 'e', date: '2026-07-12', flights: [] },
] };

test('counts day/night sorties, keeps simulator apart, ignores days without a valid date', () => {
  const S2 = { days: S.days.map((d) => Object.assign({}, d, { date: d.date.replace('2026-07-', '2026-06-') })) };
  const r = sortieStats(S2, new Date(2026, 5, 30));
  assert.equal(r.flights, 4); assert.equal(r.night, 1); assert.equal(r.day, 3); assert.equal(r.sim, 2);
  assert.equal(r.lastFlight, '2026-06-28'); assert.equal(r.sinceFlight, 2);
  assert.equal(r.lastNight, '2026-06-28'); assert.equal(r.sinceNight, 2);
  assert.equal(r.lastSim, '2026-06-30');
  assert.deepEqual(r.goals, SORTIE_GOALS);
});

test('only the current half-year counts; last dates look at everything', () => {
  // 20.11: period is July-December -> the June days drop out of the counts
  const r = sortieStats(S, new Date(2026, 10, 20));
  assert.deepEqual(r.period, { start: '2026-07-01', end: '2026-12-31', name: '2.26' });
  assert.equal(r.flights, 1); assert.equal(r.night, 0); assert.equal(r.sim, 0);
  assert.equal(r.lastNight, '2026-06-28'); assert.equal(r.lastFlight, '2026-07-10');
  assert.deepEqual(sortiePeriod(new Date(2027, 0, 3)), { start: '2027-01-01', end: '2027-06-30', name: '1.27' });
  assert.deepEqual(sortiePeriod(new Date(2026, 5, 30)), { start: '2026-01-01', end: '2026-06-30', name: '1.26' });
  // previous period, across a year boundary
  assert.equal(sortiePeriod(new Date(2027, 0, 3), 1).name, '2.26');
  const prev = sortieStats(S, new Date(2026, 10, 20), 1);
  assert.equal(prev.period.name, '1.26'); assert.equal(prev.flights, 3); assert.equal(prev.night, 1); assert.equal(prev.sim, 2);
});

test('keeps only the current and previous period', () => {
  const days = [{ id: '1', date: '2025-12-31' }, { id: '2', date: '2026-01-01' }, { id: '3', date: '2026-11-18' }, { id: '4', date: '' }];
  assert.deepEqual(prunePast(days, new Date(2026, 10, 20)).map((d) => d.id), ['2', '3', '4']);
  assert.deepEqual(prunePast(days, new Date(2027, 0, 5)).map((d) => d.id), ['3', '4']);
});

test('empty page and custom goals', () => {
  const r = sortieStats({ goals: { night: 10 } });
  assert.equal(r.flights, 0); assert.equal(r.lastFlight, null); assert.equal(r.sinceFlight, null);
  assert.equal(r.goals.night, 10); assert.equal(r.goals.flights, 27);
});

test('date text from the screen', () => {
  assert.equal(toIsoDate('28.6.2026'), '2026-06-28');
  assert.equal(toIsoDate('7.10.26'), '2026-10-07');
  assert.equal(toIsoDate('2026-11-18'), '2026-11-18');
  assert.equal(toIsoDate('31.2.2026'), null);
  assert.equal(toIsoDate('אתמול'), null);
});

test('moving the page to צבא: one op puts it in army, one deletes the old copy in tasks', () => {
  const view = { tasks: [], sorties: { goals: { night: 8 }, days: [{ id: 'a', date: '2026-11-18', flights: [] }] } };
  const next = moveSortiesToArmy(view);
  assert.deepEqual(next.army.sorties, view.sorties); assert.equal(next.sorties, undefined);
  const ops = diff(view, next);
  const bySec = ops.map((o) => [o.id, sectionOfOp(o), !!o.fields.deleted]);
  assert.deepEqual(bySec.sort(), [['army.sorties', 'army', false], ['sorties', 'tasks', true]]);
  assert.equal(moveSortiesToArmy(next), null);                    // nothing left to move
  // an existing army copy is never overwritten by the old one
  const both = moveSortiesToArmy({ sorties: { days: [] }, army: { sorties: { days: [{ id: 'x' }] } } });
  assert.equal(both.army.sorties.days[0].id, 'x');
});

test('a day can count in another period than its date', () => {
  const days = [{ id: 'j', date: '2026-06-28', period: '2.26', flights: [{ kind: 'night' }] }, { id: 'k', date: '2026-06-29', flights: [{ kind: 'day' }] }];
  assert.equal(dayPeriodName(days[0]), '2.26'); assert.equal(dayPeriodName(days[1]), '1.26');
  const r = sortieStats({ days }, new Date(2026, 10, 20));
  assert.equal(r.flights, 1); assert.equal(r.night, 1);
  // in 1.27 the previous period is 2.26, so the June day moved to 2.26 is still kept; the plain June day is not
  assert.deepEqual(prunePast(days, new Date(2027, 1, 1)).map((d) => d.id), ['j']);
});
