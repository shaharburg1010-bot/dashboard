// prices.js — puts the hourly prices (prices.json from the GitHub Action) into the finance data.
// Pure function, so it is tested in Node. boot.js fetches the file and turns the result into ops.
//
// "Since purchase" follows the bank: the first time a holding is updated, its cost in ₪ is backed
// out of the bank's own figures (valueIls and gainPct) and stored as costIls; after that gainPct
// is recomputed from it, so it moves with the price and the dollar rate exactly like the bank's.
const clone = (x) => JSON.parse(JSON.stringify(x));
const r2 = (x) => Math.round(x * 100) / 100;

export function ilDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Jerusalem' }).replace(/\//g, '.');
}
// Israeli funds in the bank list don't carry their security number yet: recognise them by name.
function taseId(x) {
  if (x.sid) return x.sid;
  const l = x.label || '';
  if (/35/.test(l)) return '5130661';
  if (/בנקים/.test(l)) return '5133236';
  if (/טכנולוגיה/.test(l)) return '5131081';
  return null;
}

export function applyPrices(state, p) {
  const s = clone(state);
  const sm = s.finance && s.finance.shortMedium;
  if (!sm || !p || !p.updatedAt) return { state: s, changed: false };
  if (sm.pricesUpdatedAt && sm.pricesUpdatedAt >= p.updatedAt) return { state: s, changed: false };
  const ib = sm.ibkr || {}, bank = sm.bank || {};
  const fx = (p.fx && p.fx.usdIls) || ib.fxUsdIls;
  const day = ilDate(p.updatedAt);
  let any = false;

  // abroad
  for (const h of ib.holdings || []) {
    const q = p.us && p.us[h.ticker];
    const fresh = q && q.price > 0;
    if (!fresh && fx === ib.fxUsdIls) continue;            // nothing new for this one
    if (h.costIls == null && h.valueIls && h.gainPct != null) h.costIls = r2(h.valueIls / (1 + h.gainPct / 100));
    if (fresh) { h.price = q.price; h.changePct = q.changePct; }
    h.valueUsd = r2((h.shares || 0) * h.price);
    h.valueIls = r2(h.valueUsd * fx);
    if (h.costIls) h.gainPct = r2((h.valueIls / h.costIls - 1) * 100);
    any = true;
  }
  if (ib.holdings && ib.holdings.length) {
    ib.totalIls = r2(ib.holdings.reduce((a, h) => a + (h.valueIls || 0), 0));
    ib.totalUsd = r2(ib.holdings.reduce((a, h) => a + (h.valueUsd || 0), 0));
    for (const h of ib.holdings) h.pct = ib.totalIls ? r2(h.valueIls / ib.totalIls * 100) : 0;
  }
  if (p.fx && p.fx.usdIls) { ib.fxUsdIls = r2(p.fx.usdIls * 100) / 100; ib.fxAsOf = day; }
  const spy = p.us && p.us.SPY;
  if (spy && ib.benchmark) { ib.benchmark.price = spy.price; ib.benchmark.changePct = spy.changePct; }

  // Israel (bank funds): value moves with the price; units/price scale is taken from the last value
  for (const x of bank.securitiesBreakdown || []) {
    const id = taseId(x); if (!id) continue;
    const q = p.tase && p.tase[id];
    if (!q || !(q.price > 0)) continue;
    x.sid = id;
    let price = q.price;
    if (x.price > 0 && price / x.price > 20) price = price / 100;      // agorot → shekels
    if (x.costIls == null && x.value && x.gainPct != null) x.costIls = r2(x.value / (1 + x.gainPct / 100));
    const k = x.price > 0 && x.units > 0 && x.value ? x.value / (x.units * x.price) : 1;
    x.price = r2(price); x.changePct = q.changePct;
    if (x.units > 0) x.value = r2(x.units * price * k);
    if (x.costIls) x.gainPct = r2((x.value / x.costIls - 1) * 100);
    any = true;
  }
  if (bank.securitiesBreakdown && bank.securitiesBreakdown.length) {
    bank.securities = r2(bank.securitiesBreakdown.reduce((a, x) => a + (x.value || 0), 0));
    for (const x of bank.securitiesBreakdown) x.pct = bank.securities ? r2(x.value / bank.securities * 100) : 0;
  }
  if (!any) return { state: clone(state), changed: false };
  ib.pricesAsOf = day; bank.pricesAsOf = day;
  sm.pricesUpdatedAt = p.updatedAt;

  // one point per day for the chart
  if (Array.isArray(ib.priceHistory)) {
    const prices = {};
    for (const [t, q] of Object.entries(p.us || {})) if (q && q.price > 0) prices[t] = q.price;
    const today = ib.priceHistory.find((e) => e.date === day);
    if (today) Object.assign(today.prices, prices); else ib.priceHistory.push({ date: day, prices });
    if (ib.priceHistory.length > 180) ib.priceHistory = ib.priceHistory.slice(-180);
  }
  return { state: s, changed: true };
}
