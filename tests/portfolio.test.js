import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPortfolio, portfolioChanges } from '../portfolio.js';
import { applyChanges } from '../inbox.js';

const MD = (json) => '# תיק\n\nטקסט\n\n## נתוני האפליקציה\n\n```json portfolio\n' + json + '\n```\n';
const BLOCK = {
  asOf: '20.11.2026',
  holdings: [{ ticker: 'NVDA', name: 'NVIDIA', shares: 24, costUsd: 180.45 }, { ticker: 'QQQ', shares: 9, costUsd: 577.86 }],
  bank: [{ sid: '5133236', label: 'בנקים', units: 101.31, costIls: 40461.7 }],
  shortTerm: [{ sid: '5139324', label: 'כספית', units: 2000 }, { sid: '1146166', label: 'קסם', units: 81 }],
  cashUsd: 2311.68, cashNote: 'IBIT',
  plan: { theme: 't', monthlyMedium: 5000, monthlyShort: 1000, note: 'n',
    items: [{ ticker: 'VRT', tier: 'גבוה', sizePct: 6, limit: 175, shares: 14, maxPrice: 192, support: '170-185', review: 140, exit: 105, status: 's' }] },
};
const state = () => ({ finance: {
  shortMedium: {
    ibkr: { fxUsdIls: 3.3, holdings: [
      { ticker: 'NVDA', name: 'NVIDIA', shares: 18, price: 150, costBasis: 186.31, costIls: 13301.6, valueUsd: 2700, valueIls: 8910 },
      { ticker: 'QQQ', name: 'Invesco QQQ Trust', shares: 9, price: 600, costBasis: 577.86, costIls: 21220.65 },
      { ticker: 'IBIT', name: 'iShares Bitcoin Trust', shares: 0, price: 35, valueIls: 7432.92 } ], cashUsd: 0 },
    bank: { securitiesBreakdown: [
      { sid: '5130661', label: 'ת״א 35', units: 100.34, value: 23686 },
      { sid: '5133236', label: 'בנקים', units: 101.31, value: 41036.63, price: 405.06, costIls: 40461.7 } ] },
    analystGemel: { value: 179500 },
  },
  shortTerm: { total: 5158.87, items: [{ label: 'מור כספית ניהול', sid: '5139324', units: 2000, value: 2182.4 }] },
  plan: { asOf: '18.11.2026', investments: { items: [{ ticker: 'AMAT' }] }, pendingOrders: [{ item: 'x' }] },
  realEstate: { mortgage: 1 },
} });

test('portfolio: reads the block, also when the fence was escaped by a copy', () => {
  const j = JSON.stringify(BLOCK);
  assert.equal(extractPortfolio(MD(j)).data.cashUsd, 2311.68);
  assert.equal(extractPortfolio(MD(j).replace(/```/g, '\\`\\`\\`')).data.holdings.length, 2);
  assert.equal(extractPortfolio('# no block'), null);
  assert.throws(() => extractPortfolio(MD('{ broken')), /לא תקין/);
});

test('portfolio: file wins for quantities, plan and cash; prices kept; sold papers dropped; other data untouched', () => {
  const s0 = state();
  const { state: s, errors } = applyChanges(s0, portfolioChanges(s0, BLOCK));
  assert.deepEqual(errors, []);
  const ib = s.finance.shortMedium.ibkr;
  assert.deepEqual(ib.holdings.map((h) => h.ticker), ['NVDA', 'QQQ']);           // IBIT gone
  const n = ib.holdings[0];
  assert.equal(n.shares, 24); assert.equal(n.price, 150); assert.equal(n.valueUsd, 3600); assert.equal(n.valueIls, 11880);
  assert.equal(n.costBasis, 180.45); assert.equal(n.costIls, 14291.64);             // 24 × 180.45 × 3.3
  assert.equal(ib.holdings[1].costIls, 21220.65);                                   // unchanged holding keeps the bank's cost
  assert.equal(ib.totalIls, r2(11880 + 9 * 600 * 3.3)); assert.equal(ib.cashUsd, 2311.68);
  const b = s.finance.shortMedium.bank;
  assert.deepEqual(b.securitiesBreakdown.map((x) => x.sid), ['5133236']);           // ת״א 35 sold
  assert.equal(b.securitiesBreakdown[0].value, 41036.63); assert.equal(b.securities, 41036.63);
  assert.equal(s.finance.shortTerm.items.length, 2); assert.equal(s.finance.shortTerm.items[0].value, 2182.4);
  assert.equal(s.finance.plan.investments.items[0].limit, 175); assert.equal(s.finance.plan.medium.monthly, 5000);
  assert.equal(s.finance.plan.pendingOrders, undefined);                            // old plan replaced
  assert.equal(s.finance.shortMedium.analystGemel.value, 179500);                   // the rest untouched
  assert.equal(s.finance.realEstate.mortgage, 1);
});

test('portfolio: applying the same file twice changes nothing the second time', () => {
  const once = applyChanges(state(), portfolioChanges(state(), BLOCK)).state;
  const twice = applyChanges(once, portfolioChanges(once, BLOCK)).state;
  assert.deepEqual(twice, once);
});

function r2(x) { return Math.round(x * 100) / 100; }
