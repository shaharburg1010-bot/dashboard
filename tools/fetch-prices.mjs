// fetch-prices.mjs — runs every hour on GitHub (see .github/workflows/prices.yml), no AI involved.
// Writes prices.json: last price + daily change for each ticker in prices.config.json, plus USD/ILS.
// The app reads that file, updates the securities in the finance block and syncs it to Drive.
// Every source has a fallback; a ticker that fails keeps no value and is listed under "errors",
// so the app simply keeps its previous price for it.
// Run locally: node tools/fetch-prices.mjs > prices.json
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../prices.config.json', import.meta.url), 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (dashboard price check)', Accept: 'application/json,text/plain,*/*' };
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

async function get(url, opts = {}) {
  const res = await fetch(url, { headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(url.split('?')[0] + ' → HTTP ' + res.status);
  return opts.text ? res.text() : res.json();
}

// --- Yahoo Finance chart API (US tickers, FX, and TASE securities as NNN.TA) ---
async function yahoo(symbol) {
  for (const host of ['query1', 'query2']) {
    try {
      const j = await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
      const m = j.chart.result[0].meta;
      const price = m.regularMarketPrice, prev = m.chartPreviousClose ?? m.previousClose;
      if (!(price > 0)) throw new Error('no price');
      return { price: round(price), changePct: prev ? round((price / prev - 1) * 100, 2) : null, time: new Date(m.regularMarketTime * 1000).toISOString(), currency: m.currency, src: 'yahoo' };
    } catch (e) { var err = e; }
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
// --- TASE (Israeli funds by security number) ---
async function tase(id) {
  const tries = [
    async () => { // Maya (TASE) fund API
      const j = await get(`https://mayaapi.tase.co.il/api/fund/details?fundId=${id}`, { headers: { 'X-Maya-With': 'allow', Referer: 'https://maya.tase.co.il/' } });
      const price = Number(j.UnitValuePrice ?? j.SellPrice ?? j.PurchasePrice);
      if (!(price > 0)) throw new Error('maya: no price');
      const ch = Number(j.DayYield ?? j.UnitValueChange ?? NaN);
      return { price, changePct: isNaN(ch) ? null : ch, time: new Date().toISOString(), src: 'maya' };
    },
    async () => yahoo(id + '.TA'),
  ];
  let last;
  for (const t of tries) { try { return await t(); } catch (e) { last = e; } }
  throw last;
}

const out = { updatedAt: new Date().toISOString(), us: {}, tase: {}, fx: null, errors: [] };
for (const t of cfg.us) {
  try { out.us[t] = await yahoo(t); }
  catch (e1) { try { out.us[t] = await stooq(t); } catch (e2) { out.errors.push(`${t}: ${e1.message} | ${e2.message}`); } }
}
for (const id of cfg.tase) {
  try { out.tase[id] = await tase(id); } catch (e) { out.errors.push(`${id}: ${e.message}`); }
}
try { const f = await yahoo('ILS=X'); out.fx = { usdIls: f.price, time: f.time, src: 'yahoo' }; }
catch (e1) {
  try { const j = await get('https://api.frankfurter.dev/v1/latest?from=USD&to=ILS'); out.fx = { usdIls: j.rates.ILS, time: j.date, src: 'frankfurter' }; }
  catch (e2) { out.errors.push(`FX: ${e1.message} | ${e2.message}`); }
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
if (!Object.keys(out.us).length && !out.fx) process.exit(1); // nothing at all: fail the run, keep the old file
