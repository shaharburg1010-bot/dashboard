// fetch-prices.mjs — fetches last price + daily change for each ticker in prices.config.json, plus USD/ILS.
// No AI involved. Runs on Shahar's server every 20 minutes (server/prices.mjs serves it at GET /v1/prices);
// the GitHub Action (.github/workflows/prices.yml) is only a manual fallback now.
// The app reads the result, updates the securities in the finance block and syncs it.
// Every source has a fallback; a ticker that fails keeps no value and is listed under "errors",
// so the app keeps its previous price for it (and shows it as not updated).
// Parsing lives in price-sources.mjs (tested). Run locally: node tools/fetch-prices.mjs > prices.json
import { readFileSync } from 'node:fs';
import { yahooQuote, mayaQuote, htmlQuote, bizportalEtfQuote } from './price-sources.mjs';

const CFG_URL = new URL('../prices.config.json', import.meta.url);
export const readPriceConfig = () => JSON.parse(readFileSync(CFG_URL, 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json,text/html,text/plain,*/*', 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' };
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

async function get(url, opts = {}) {
  const res = await fetch(url, { headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(url.split('?')[0] + ' → HTTP ' + res.status);
  return opts.text ? res.text() : res.json();
}

// --- Yahoo Finance chart API (US tickers, FX, and TASE ETFs as NNN.TA) ---
async function yahoo(symbol) {
  let err;
  for (const host of ['query1', 'query2']) {
    try {
      const j = await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
      return yahooQuote(j.chart.result[0]);
    } catch (e) { err = e; }
  }
  throw err;
}
// --- Stooq CSV (fallback for US tickers) ---
async function stooq(ticker) {
  const csv = await get(`https://stooq.com/q/l/?s=${ticker.toLowerCase()}.us&f=sd2t2ohlcp&h&e=csv`, { text: true });
  const [head, row] = csv.trim().split('\n');
  const h = head.split(','), v = row.split(',');
  const close = Number(v[h.indexOf('Close')]), prev = Number(v[h.indexOf('Prev')] || NaN);
  if (!(close > 0)) throw new Error('stooq: no price');
  return { price: round(close), changePct: prev > 0 ? round((close / prev - 1) * 100, 2) : null, time: new Date().toISOString(), src: 'stooq' };
}
// --- TASE funds by security number: several sources, first one that answers wins ---
// Mutual funds (קרנות נאמנות) have one price a day (NAV), published in the evening.
async function tase(id) {
  const maya = { 'X-Maya-With': 'allow', Referer: 'https://maya.tase.co.il/', Origin: 'https://maya.tase.co.il' };
  const tries = [
    ['maya-v1', async () => mayaQuote(await get(`https://maya.tase.co.il/api/v1/funds/mutual/${id}`, { headers: maya }))],
    ['maya', async () => mayaQuote(await get(`https://mayaapi.tase.co.il/api/fund/details?fundId=${id}`, { headers: maya }))],
    ['funder', async () => htmlQuote(await get(`https://www.funder.co.il/fund/${id}`, { text: true }), 'funder')],
    ['bizportal', async () => htmlQuote(await get(`https://www.bizportal.co.il/mutualfunds/quote/generalview/${id}`, { text: true }), 'bizportal')],
    // ETFs (קרנות סל) are not mutual funds: the two Maya calls above don't know them
    ['bizportal-etf', async () => bizportalEtfQuote(await get(`https://www.bizportal.co.il/tradedfund/quote/generalview/${id}`, { text: true }))],
    ['yahoo', async () => yahoo(id + '.TA')],
  ];
  const errs = [];
  for (const [name, t] of tries) {
    try { return { time: new Date().toISOString(), ...(await t()) }; }
    catch (e) { errs.push(name + ': ' + e.message.replace(/^https?:\/\/\S+ → /, '')); }
  }
  throw new Error(errs.join(' | '));
}

// The tickers to fetch = prices.config.json plus every paper found in the data (holdings, bank, short range,
// and the plan's items and actions with a "ticker" or "sid"). So a new paper added to the portfolio file in the
// vault gets a price without a code change or a push.
const US_RE = /^[A-Z][A-Z.\-]{0,6}$/, TASE_RE = /^\d{6,9}$/;
export function withDataTickers(cfg, finance) {
  const us = new Set(cfg.us || []), tase = new Set(cfg.tase || []);
  const f = finance || {}, sm = f.shortMedium || {}, pl = f.plan || {};
  const addUs = (t) => { t = String(t || '').trim().toUpperCase(); if (US_RE.test(t)) us.add(t); };
  const addTase = (t) => { t = String(t || '').trim(); if (TASE_RE.test(t)) tase.add(t); };
  for (const h of (sm.ibkr && sm.ibkr.holdings) || []) addUs(h && h.ticker);
  for (const x of (sm.bank && sm.bank.securitiesBreakdown) || []) addTase(x && x.sid);
  for (const x of (f.shortTerm && f.shortTerm.items) || []) addTase(x && x.sid);
  for (const x of (pl.investments && pl.investments.items) || []) addUs(x && x.ticker);
  for (const x of pl.actions || []) { if (x && x.ticker) addUs(x.ticker); if (x && x.sid) addTase(x.sid); }
  return Object.assign({}, cfg, { us: [...us], tase: [...tase] });
}

export async function fetchPrices(cfg = readPriceConfig()) {
  const out = { updatedAt: new Date().toISOString(), us: {}, tase: {}, fx: null, errors: [] };
  for (const t of cfg.us || []) {
    try { out.us[t] = await yahoo(t); }
    catch (e1) { try { out.us[t] = await stooq(t); } catch (e2) { out.errors.push(`${t}: ${e1.message} | ${e2.message}`); } }
  }
  for (const id of cfg.tase || []) {
    try { out.tase[id] = await tase(id); } catch (e) { out.errors.push(`${id}: ${e.message}`); }
  }
  try { const f = await yahoo('ILS=X'); out.fx = { usdIls: f.price, time: f.time, src: 'yahoo' }; }
  catch (e1) {
    try { const j = await get('https://api.frankfurter.dev/v1/latest?from=USD&to=ILS'); out.fx = { usdIls: j.rates.ILS, time: j.date, src: 'frankfurter' }; }
    catch (e2) { out.errors.push(`FX: ${e1.message} | ${e2.message}`); }
  }
  return out;
}

// Run directly: node tools/fetch-prices.mjs > prices.json
if (import.meta.url === 'file://' + process.argv[1]) {
  const out = await fetchPrices();
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  if (!Object.keys(out.us).length && !out.fx) process.exit(1); // nothing at all: fail the run, keep the old file
}
