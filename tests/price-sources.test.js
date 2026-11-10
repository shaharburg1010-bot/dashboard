import test from 'node:test';
import assert from 'node:assert/strict';
import { yahooQuote, mayaQuote, htmlQuote, deepFind } from '../tools/price-sources.mjs';

// Yahoo range=5d: chartPreviousClose is 5 days back; the daily change must use yesterday's close.
const day = (d, h = 20) => Date.UTC(2026, 10, d, h) / 1000;
const yres = (closes, meta = {}) => ({
  meta: { regularMarketPrice: 178.67, regularMarketTime: day(9, 21), gmtoffset: -18000, chartPreviousClose: 202.05, currency: 'USD', ...meta },
  timestamp: [day(3, 14), day(4, 14), day(5, 14), day(6, 14), day(9, 14)],
  indicators: { quote: [{ close: closes }] },
});

test('yahoo: daily change against the previous trading day, not the start of the range', () => {
  const q = yahooQuote(yres([200, 195, 190, 186.64, 178.67]));
  assert.equal(q.price, 178.67);
  assert.equal(q.changePct, -4.27);                       // 178.67 / 186.64 − 1, not / 202.05
});
test('yahoo: today has no bar yet → last bar is yesterday', () => {
  const r = yres([200, 195, 190, 186.64]); r.timestamp = r.timestamp.slice(0, 4);
  r.meta.regularMarketTime = day(9, 16);
  assert.equal(yahooQuote(r).changePct, -4.27);
});
test('yahoo: no bars → previousClose, and chartPreviousClose only for a one-day range', () => {
  assert.equal(yahooQuote({ meta: { regularMarketPrice: 110, regularMarketTime: day(9), previousClose: 100 } }).changePct, 10);
  assert.equal(yahooQuote({ meta: { regularMarketPrice: 110, regularMarketTime: day(9), chartPreviousClose: 100 }, timestamp: [day(9)], indicators: { quote: [{ close: [110] }] } }).changePct, 10);
  assert.throws(() => yahooQuote({ meta: { regularMarketPrice: 0 } }));
});
test('maya: price and change found by name at any depth', () => {
  assert.deepEqual(mayaQuote({ UnitValuePrice: 245.1, DayYield: -0.31 }), { price: 245.1, changePct: -0.31, src: 'maya' });
  assert.deepEqual(mayaQuote({ data: { fund: { sellPrice: '245.10', dailyYield: '0.12' } } }), { price: 245.1, changePct: 0.12, src: 'maya' });
  assert.throws(() => mayaQuote({ name: 'x' }));
  assert.ok(isNaN(deepFind({ a: { b: 'x' } }, ['b'])));
});
test('html pages: numbers embedded as JSON', () => {
  const html = '<script>window.__d = {"fundId":5130661,"sellPrice":"2,451.20","dailyYield":-0.4}</script>';
  assert.deepEqual(htmlQuote(html, 'funder'), { price: 2451.2, changePct: -0.4, src: 'funder' });
  assert.throws(() => htmlQuote('<html>no numbers</html>', 'bizportal'));
});
