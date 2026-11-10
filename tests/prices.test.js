import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrices, sameScale } from '../prices.js';

const state = () => ({ finance: { shortMedium: {
  ibkr: { fxUsdIls: 3.112, holdings: [
    { ticker: 'QQQ', shares: 9, price: 704.4, changePct: -0.01, gainPct: -7.03, valueUsd: 6339.6, valueIls: 19728.84 },
    { ticker: 'AINT', shares: 210, price: 29.407, changePct: 2.73, gainPct: -16.97, valueUsd: 6175.47, valueIls: 19218.06 } ],
    benchmark: { ticker: 'SPY', price: 1, changePct: 0 },
    priceHistory: [{ date: '25.10.2026', prices: { QQQ: 704.4 } }] },
  bank: { securities: 70285.68, securitiesBreakdown: [
    { label: 'קרן מחקה מדד ת״א 35 — הראל', value: 24224.08, price: 241.42, units: 100.34, gainPct: 1.28, changePct: -1.09 },
    { label: 'ETF מחקה מדד בנקים וביטוח ישראל', value: 46061.6, price: 454.66, units: 101.31, gainPct: 13.84, changePct: -1.34 } ] },
} } });

const P = { updatedAt: '2026-10-26T10:23:00Z', fx: { usdIls: 3.2 }, us: { QQQ: { price: 710, changePct: 0.8 }, SPY: { price: 760, changePct: 0.1 } },
  tase: { '5130661': { price: 24500, changePct: 1.5 } }, errors: ['AINT: x'] };

test('prices: values, totals, bank-style gain, agorot, history; missing ticker keeps old', () => {
  const { state: s, changed } = applyPrices(state(), P);
  assert.equal(changed, true);
  const ib = s.finance.shortMedium.ibkr, q = ib.holdings[0], a = ib.holdings[1];
  assert.equal(q.price, 710); assert.equal(q.valueUsd, 6390); assert.equal(q.valueIls, 20448);
  // cost backed out of the bank figure (19728.84 / 0.9297) → gain moves with price AND fx
  assert.ok(Math.abs(q.gainPct - ((20448 / (19728.84 / (1 - 0.0703)) - 1) * 100)) < 0.02);
  assert.equal(a.price, 29.407);                          // no new price → unchanged price
  assert.equal(a.valueIls, 19761.5);                     // …but revalued at the new dollar rate
  assert.equal(ib.totalIls, 40209.5);
  assert.equal(ib.fxUsdIls, 3.2); assert.equal(ib.benchmark.price, 760);
  const ta = s.finance.shortMedium.bank.securitiesBreakdown[0];
  assert.equal(ta.price, 245); assert.equal(ta.sid, '5130661');      // 24500 agorot → 245 ₪
  assert.ok(Math.abs(ta.value - 24224.08 * 245 / 241.42) < 0.05);
  assert.equal(s.finance.shortMedium.bank.securitiesBreakdown[1].value, 46061.6);
  assert.equal(ib.priceHistory.length, 2); assert.equal(ib.priceHistory[1].date, '26.10.2026');
  assert.equal(ib.pricesAsOf, '26.10.2026');
  // same file again → nothing to do
  assert.equal(applyPrices(s, P).changed, false);
});

test('prices: Israeli fund in shekels or agorot keeps the bank scale; a wild number is ignored; dates move only when fresh', () => {
  const P2 = { updatedAt: '2026-11-10T16:00:00Z', us: {}, fx: null, errors: ['5133236: all sources failed'],
    tase: { '5130661': { price: 2.4521, changePct: 0.4 } } };       // shekels this time
  const s0 = state(); s0.finance.shortMedium.ibkr.pricesAsOf = '01.11.2026'; s0.finance.shortMedium.bank.pricesAsOf = '13.10.2026';
  const { state: s, changed } = applyPrices(s0, P2);
  assert.equal(changed, true);
  const [ta, banks] = s.finance.shortMedium.bank.securitiesBreakdown;
  assert.equal(ta.price, 245.21); assert.equal(ta.priceAsOf, '10.11.2026');
  assert.equal(banks.value, 46061.6);                                   // no price → untouched
  assert.equal(s.finance.shortMedium.bank.pricesAsOf, '10.11.2026');
  assert.equal(s.finance.shortMedium.ibkr.pricesAsOf, '01.11.2026');    // nothing new abroad → date stays
  assert.deepEqual(s.finance.shortMedium.pricesMissing, ['QQQ', 'AINT', 'ETF מחקה מדד בנקים וביטוח ישראל']);

  const bad = { updatedAt: '2026-11-10T17:00:00Z', us: { QQQ: { price: 700, changePct: 0 } }, tase: { '5130661': { price: 310 } } };
  const r = applyPrices(state(), bad).state.finance.shortMedium;
  assert.equal(r.bank.securitiesBreakdown[0].price, 241.42);           // +28% for an index fund = parsing mistake
  assert.ok(r.pricesMissing.includes('קרן מחקה מדד ת״א 35 — הראל'));
  assert.equal(r.bank.pricesAsOf, undefined);
});

test('sameScale picks agorot or shekels by the previous price', () => {
  assert.equal(sameScale(24500, 241.42), 245);
  assert.equal(sameScale(2.45, 241.42), 245);
  assert.equal(sameScale(245, 241.42), 245);
  assert.equal(sameScale(245, undefined), 245);
});
