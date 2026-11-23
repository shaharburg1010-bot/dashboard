// server/prices.mjs — fetches prices on the server every 20 minutes (tools/fetch-prices.mjs), no AI involved.
// Replaces the GitHub Action, whose schedule GitHub ran only every few hours. The app reads the result
// from GET /v1/prices (through Tailscale, like the rest of the sync) and applies it as before (prices.js).
// The last good result is kept in a file, so a restart does not lose it.
import fs from 'node:fs';
import { fetchPrices, readPriceConfig } from '../tools/fetch-prices.mjs';

export function makePrices({ file, fetcher = () => fetchPrices(readPriceConfig()) } = {}) {
  let last = null;
  try { if (file && fs.existsSync(file)) last = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { last = null; }
  const st = { lastRun: null, lastError: null, running: false };
  async function run() {
    if (st.running) return;
    st.running = true; st.lastRun = new Date().toISOString();
    try {
      const out = await fetcher();
      // nothing at all came back (network down): keep the previous file
      if (!Object.keys(out.us || {}).length && !Object.keys(out.tase || {}).length && !out.fx) throw new Error('no prices: ' + (out.errors || []).slice(0, 3).join(' ; '));
      last = out; st.lastError = null;
      if (file) { fs.writeFileSync(file + '.tmp', JSON.stringify(out, null, 1)); fs.renameSync(file + '.tmp', file); }
    } catch (e) { st.lastError = e.message; console.error('prices', e.message); }
    finally { st.running = false; }
  }
  return { run, latest: () => last, status: () => ({ lastRun: st.lastRun, lastError: st.lastError, updatedAt: last && last.updatedAt, errors: last ? last.errors : [] }) };
}
