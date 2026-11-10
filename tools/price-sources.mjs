// price-sources.mjs — pure parsers for the price sources used by fetch-prices.mjs.
// No network here, so every parser is tested in Node (tests/price-sources.test.js).
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const num = (v) => { const n = typeof v === 'string' ? Number(v.replace(/[,₪%\s]/g, '')) : Number(v); return isFinite(n) ? n : NaN; };

// Yahoo chart API (v8). The daily change is measured against the last close of the PREVIOUS trading
// day. meta.chartPreviousClose is NOT that: it is the close before the first bar of the requested
// range (range=5d → five days back), which made daily changes like NVDA −11.6% instead of −4.3%.
export function yahooQuote(result) {
  const m = result && result.meta;
  if (!m) throw new Error('yahoo: no meta');
  const price = num(m.regularMarketPrice);
  if (!(price > 0)) throw new Error('yahoo: no price');
  const off = (m.gmtoffset || 0) * 1000;
  const dayOf = (sec) => new Date(sec * 1000 + off).toISOString().slice(0, 10);
  const today = dayOf(m.regularMarketTime);
  const ts = result.timestamp || [], closes = (((result.indicators || {}).quote || [])[0] || {}).close || [];
  let prev = null;
  for (let i = 0; i < ts.length; i++) if (closes[i] > 0 && dayOf(ts[i]) < today) prev = closes[i];
  if (!(prev > 0)) prev = num(m.previousClose);
  if (!(prev > 0) && ts.length <= 1) prev = num(m.chartPreviousClose);   // range=1d: this IS yesterday
  return {
    price: round(price),
    changePct: prev > 0 ? round((price / prev - 1) * 100, 2) : null,
    time: new Date(m.regularMarketTime * 1000).toISOString(),
    currency: m.currency, src: 'yahoo',
  };
}

// Look for the first positive number under any of `keys`, anywhere in a JSON value.
export function deepFind(obj, keys) {
  const want = new Set(keys.map((k) => k.toLowerCase()));
  const stack = [obj];
  while (stack.length) {
    const o = stack.shift();
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o)) {
      if (want.has(k.toLowerCase()) && v != null && typeof v !== 'object' && !isNaN(num(v))) return num(v);
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
  }
  return NaN;
}

const PRICE_KEYS = ['UnitValuePrice', 'unitValuePrice', 'SellPrice', 'sellPrice', 'RedemptionPrice', 'redemptionPrice',
  'PurchasePrice', 'purchasePrice', 'LastRate', 'lastRate', 'BaseRate', 'Price', 'price', 'lastPrice', 'closePrice'];
const CHANGE_KEYS = ['DayYield', 'dayYield', 'DailyYield', 'dailyYield', 'UnitValueChange', 'Change', 'change', 'changePct',
  'dailyChange', 'DailyChange', 'BaseRateChangePercentage', 'changePercent'];

// TASE Maya API (fund details). The field names changed between versions, so search by name.
export function mayaQuote(j) {
  const price = deepFind(j, PRICE_KEYS);
  if (!(price > 0)) throw new Error('maya: no price');
  const ch = deepFind(j, CHANGE_KEYS);
  return { price, changePct: isNaN(ch) ? null : round(ch, 2), src: 'maya' };
}

// Fund pages (funder.co.il, bizportal) embed the numbers as JSON in the HTML. Find a price that sits
// under a known key ("sellPrice": 241.42), and the daily change the same way.
export function htmlQuote(html, src) {
  const grab = (keys) => {
    for (const k of keys) {
      const m = new RegExp('["\']?' + k + '["\']?\\s*[:=]\\s*["\']?(-?[\\d,]+(?:\\.\\d+)?)', 'i').exec(html);
      if (m && !isNaN(num(m[1]))) return num(m[1]);
    }
    return NaN;
  };
  const price = grab(PRICE_KEYS);
  if (!(price > 0)) throw new Error(src + ': no price');
  const ch = grab(CHANGE_KEYS);
  return { price, changePct: isNaN(ch) ? null : round(ch, 2), src };
}
