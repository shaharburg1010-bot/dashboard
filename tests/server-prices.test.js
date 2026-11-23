// The server fetches prices itself (server/prices.mjs) and serves them at GET /v1/prices.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp } from '../server/app.mjs';
import { makePrices } from '../server/prices.mjs';

const sample = { updatedAt: '2026-11-23T15:00:00.000Z', us: { SPY: { price: 690, changePct: 0.5 } }, tase: { '5139324': { price: 109.17, changePct: 0.01 } }, fx: { usdIls: 3.3 }, errors: [] };

async function serve(app) {
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise((r) => srv.close(r)) };
}

test('GET /v1/prices: 404 before the first fetch, then the latest prices', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  const prices = makePrices({ file: path.join(dir, 'prices.json'), fetcher: async () => sample });
  const s = await serve(makeApp({}, { prices }));
  try {
    assert.equal((await fetch(s.url + '/v1/prices')).status, 404);
    await prices.run();
    const r = await fetch(s.url + '/v1/prices');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), sample);
    // kept across a restart
    const again = makePrices({ file: path.join(dir, 'prices.json'), fetcher: async () => { throw new Error('offline'); } });
    assert.deepEqual(again.latest(), sample);
  } finally { await s.close(); }
});

test('a fetch that brings nothing keeps the previous prices', async () => {
  let n = 0;
  const prices = makePrices({ fetcher: async () => (n++ ? { updatedAt: 'x', us: {}, tase: {}, fx: null, errors: ['all failed'] } : sample) });
  await prices.run(); await prices.run();
  assert.deepEqual(prices.latest(), sample);
  assert.match(prices.status().lastError, /no prices/);
});
