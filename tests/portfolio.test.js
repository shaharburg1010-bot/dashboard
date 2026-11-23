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

test('a list command on a missing path creates nothing', () => {
  const st = { tasks: [] };
  const r = applyChanges(st, [{ update: 'army.sorties.days', id: 'x', fields: { a: 1 } }, { add: 'nope.list', item: { t: 1 } }]);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.state, { tasks: [] });
});

test('portfolio: short-range cost from the file gives a gain since purchase', async () => {
  const { portfolioChanges } = await import('../portfolio.js');
  const state = { finance: { shortMedium: { ibkr: { fxUsdIls: 3.3, holdings: [] } },
    shortTerm: { items: [{ sid: '5139324', label: 'מור', units: 2000, value: 2183.4 }] } } };
  const ch = portfolioChanges(state, { holdings: [], shortTerm: [{ sid: '5139324', units: 2000, costIls: 2182 }] });
  const st = ch.find((c) => c.set === 'finance.shortTerm').value;
  assert.equal(st.items[0].costIls, 2182);
  assert.equal(st.items[0].gainPct, 0.06);
});

test('portfolio: plan actions (any paper) pass through from the file; rows without a name are dropped', () => {
  const b = JSON.parse(JSON.stringify(BLOCK));
  b.plan.actions = [{ group: 'מדדים', item: 'QQQ', side: 'קנייה', units: 2, limit: '640' }, { side: 'מכירה' }];
  const ch = portfolioChanges(state(), b).find((c) => c.set === 'finance.plan');
  assert.equal(ch.value.actions.length, 1);
  assert.equal(ch.value.actions[0].item, 'QQQ');
  const ch2 = portfolioChanges(state(), BLOCK).find((c) => c.set === 'finance.plan');
  assert.deepEqual(ch2.value.actions, []);
});

test('portfolio: manual edits from the app win over the file and add papers; a dollar edit drops the stale shekel cost', async () => {
  const { mergeManual, blockFromState } = await import('../portfolio.js');
  const m = { holdings: { QQQ: { shares: 11, costUsd: 600 }, SPMO: { shares: 10, costUsd: 121.5, name: 'SPMO' } },
              bank: { '5133236': { units: 4024 }, '1143718': { units: 4000, costIls: 16175, label: 'ת״א 35' } } };
  const p = mergeManual(BLOCK, m);
  const q = p.holdings.find((h) => h.ticker === 'QQQ');
  assert.equal(q.shares, 11); assert.equal(q.costUsd, 600); assert.equal(q.costIls, undefined);
  assert.ok(p.holdings.some((h) => h.ticker === 'SPMO' && h.shares === 10));
  assert.equal(p.bank.find((x) => x.sid === '5133236').units, 4024);
  assert.equal(p.bank.find((x) => x.sid === '1143718').costIls, 16175);
  assert.equal(BLOCK.holdings.find((h) => h.ticker === 'QQQ').shares, 9);   // the file data itself is untouched
  // the edits ride every later application of the file
  const s = state(); s.finance.manualEdits = m;
  const ch = portfolioChanges(s, BLOCK);
  const rows = ch.find((c) => c.set === 'finance.shortMedium.bank.securitiesBreakdown').value;
  const ta = rows.find((x) => x.sid === '1143718');
  assert.equal(ta.value, 16175);                 // new paper: its cost until the first price
  assert.equal(ch.find((c) => c.set === 'finance.shortMedium.ibkr.holdings').value.find((h) => h.ticker === 'QQQ').shares, 11);
  // the app's current view as a block, for applying an edit at once
  const b = blockFromState(state());
  assert.deepEqual(b.holdings.map((h) => h.ticker), ['NVDA', 'QQQ']);
  assert.equal(b.bank.length, 2);
});

test('portfolio: plan rules and texts pass through from the file', () => {
  const b = JSON.parse(JSON.stringify(BLOCK));
  b.plan.rules = ['כלל א', { title: 'ב', text: 'כלל ב' }, null, { title: 'ריק' }];
  b.plan.secondHalfRule = 'חצי שני מהקובץ'; b.plan.longTermRule = 'ארוך מהקובץ';
  const pl = portfolioChanges(state(), b).find((c) => c.set === 'finance.plan').value;
  assert.equal(pl.rules.length, 2); assert.equal(pl.secondHalfRule, 'חצי שני מהקובץ'); assert.equal(pl.longTermRule, 'ארוך מהקובץ');
});
