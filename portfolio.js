// portfolio.js — the investment portfolio (what is held + the buy plan) comes from ONE file in Drive:
// "תיק השקעות.md" in the finance folder, written by Shahar's finance agent. At its end sits a block:
//
//   ```json portfolio
//   { "asOf": "20.11.2026",
//     "holdings":  [{ "ticker": "NVDA", "name": "NVIDIA", "shares": 24, "costUsd": 180.45 }],
//     "bank":      [{ "sid": "5133236", "label": "...", "units": 101.31, "costIls": 40461.7 }],
//     "shortTerm": [{ "sid": "5139324", "label": "...", "units": 2000 }],
//     "cashUsd": 2311.68, "cashNote": "...",
//     "plan": { "theme": "...", "monthlyMedium": 5000, "monthlyShort": 1000, "note": "...",
//               "items": [{ "ticker": "VRT", "tier": "גבוה", "sizePct": 6, "limit": 175, "shares": 14,
//                           "maxPrice": 192, "support": "170-185", "review": 140, "exit": 105,
//                           "status": "...", "nextReport": "10.2.2027" }] } }
//   ```
//
// The file is the source of truth for quantities, costs, cash and the plan. Prices and values stay the
// app's job (prices.js): this module keeps the last known price of each paper and only recomputes values
// from it. The result is applied as ordinary local changes (like an inbox file), so the server and every
// device get the same numbers. The file itself is never written by the app.
export const PORTFOLIO_NAME = 'תיק השקעות.md';
// Also matches a block whose fence was escaped (\`\`\`) by a copy through read_file_content.
const FENCE_RE = /(?:```|\\`\\`\\`)json portfolio[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*(?:```|\\`\\`\\`)/;
const r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

// -> { text, data } or null when the file has no block. Throws on a block that is not valid JSON.
export function extractPortfolio(md) {
  const m = String(md || '').match(FENCE_RE);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { throw new Error('הבלוק json portfolio לא תקין: ' + e.message); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.holdings)) throw new Error('בבלוק json portfolio חסרה רשימת holdings');
  return { text: m[1].trim(), data };
}

// state = the app's current view. Returns inbox-style `set` changes that make the finance data match the file.
export function portfolioChanges(state, p) {
  const fin = (state && state.finance) || {};
  const sm = fin.shortMedium || {};
  const ib = sm.ibkr || {};
  const fx = num(ib.fxUsdIls) || 0;
  const changes = [];

  // Abroad: one row per paper in the file; papers no longer in the file are dropped.
  const oldH = ib.holdings || [];
  const holdings = p.holdings.filter((h) => h && h.ticker && num(h.shares) != null).map((h) => {
    const prev = oldH.find((x) => x && x.ticker === h.ticker) || {};
    const out = Object.assign({}, prev, { ticker: h.ticker, name: h.name || prev.name || h.ticker, shares: h.shares });
    if (num(h.costUsd) != null) out.costBasis = h.costUsd;
    if (num(h.costIls) != null) out.costIls = h.costIls;
    else if (num(h.costUsd) != null && (prev.shares !== h.shares || prev.costBasis !== h.costUsd || prev.costIls == null) && fx)
      out.costIls = r2(h.shares * h.costUsd * fx);       // cost at today's rate when the bank's shekel cost is unknown
    if (num(prev.price) != null) {
      out.valueUsd = r2(h.shares * prev.price);
      if (fx) out.valueIls = r2(out.valueUsd * fx);
      if (out.costIls && out.valueIls != null) out.gainPct = r2((out.valueIls / out.costIls - 1) * 100);
    }
    return out;
  });
  const totalUsd = r2(holdings.reduce((a, h) => a + (h.valueUsd || 0), 0));
  const totalIls = r2(holdings.reduce((a, h) => a + (h.valueIls || 0), 0));
  holdings.forEach((h) => { h.pct = totalIls ? r2((h.valueIls || 0) / totalIls * 100) : 0; });
  changes.push({ set: 'finance.shortMedium.ibkr.holdings', value: holdings });
  changes.push({ set: 'finance.shortMedium.ibkr.totalUsd', value: totalUsd });
  changes.push({ set: 'finance.shortMedium.ibkr.totalIls', value: totalIls });
  if (num(p.cashUsd) != null) changes.push({ set: 'finance.shortMedium.ibkr.cashUsd', value: p.cashUsd });
  if (p.cashNote != null) changes.push({ set: 'finance.shortMedium.ibkr.cashNote', value: String(p.cashNote) });

  // Israel (bank funds), matched by security number. Value moves with units at the last known price.
  if (Array.isArray(p.bank)) {
    const bank = sm.bank || {};
    const oldB = bank.securitiesBreakdown || [];
    const rows = p.bank.filter((x) => x && x.sid && num(x.units) != null).map((x) => {
      const prev = oldB.find((y) => y && String(y.sid) === String(x.sid)) || {};
      const out = Object.assign({}, prev, { sid: String(x.sid), label: x.label || prev.label || String(x.sid), units: x.units });
      if (num(x.costIls) != null) out.costIls = x.costIls;
      if (num(prev.value) != null && num(prev.units)) out.value = r2(prev.value * x.units / prev.units);
      if (out.costIls && out.value != null) out.gainPct = r2((out.value / out.costIls - 1) * 100);
      return out;
    });
    const securities = r2(rows.reduce((a, x) => a + (x.value || 0), 0));
    rows.forEach((x) => { x.pct = securities ? r2((x.value || 0) / securities * 100) : 0; });
    changes.push({ set: 'finance.shortMedium.bank.securitiesBreakdown', value: rows });
    changes.push({ set: 'finance.shortMedium.bank.securities', value: securities });
  }

  // Short range (money-market fund, short bonds), matched by security number.
  if (Array.isArray(p.shortTerm)) {
    const st = fin.shortTerm || {};
    const oldS = st.items || [];
    const items = p.shortTerm.filter((x) => x && x.sid && num(x.units) != null).map((x) => {
      const prev = oldS.find((y) => y && String(y.sid) === String(x.sid)) || {};
      const out = Object.assign({}, prev, { sid: String(x.sid), label: x.label || prev.label || String(x.sid), units: x.units });
      if (num(prev.value) != null && num(prev.units)) out.value = r2(prev.value * x.units / prev.units);
      return out;
    });
    changes.push({ set: 'finance.shortTerm', value: Object.assign({}, st, { items, total: r2(items.reduce((a, x) => a + (x.value || 0), 0)), asOf: p.asOf || st.asOf }) });
  }

  // The plan: replaced whole by the file's plan.
  if (p.plan && typeof p.plan === 'object') {
    const pl = p.plan;
    const plan = {
      asOf: p.asOf || '',
      theme: pl.theme || '',
      investments: { items: (pl.items || []).filter((x) => x && x.ticker), note: pl.note || '' },
    };
    if (num(pl.monthlyMedium) != null) plan.medium = { monthly: pl.monthlyMedium, rule: pl.mediumRule || '' };
    if (num(pl.monthlyShort) != null) plan.shortChannel = { monthly: pl.monthlyShort, target: pl.shortRule || '' };
    changes.push({ set: 'finance.plan', value: plan });
  }
  return changes;
}
