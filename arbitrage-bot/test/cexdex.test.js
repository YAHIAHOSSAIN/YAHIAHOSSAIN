import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getAmountOut } from '../src/math.js';
import { getAmountIn, fillFromBook, evaluate, bestOpportunity } from '../src/cexdexMath.js';
import { Mexc } from '../src/mexc.js';

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
// Uniswap pool at 2000 USDC/ETH
const pool = { reserveWeth: 1000n * E18, reserveUsd: 2_000_000n * E6, usdDecimals: 6 };

test('getAmountIn is the inverse of getAmountOut (rounded up)', () => {
  const out = 5n * E18;
  const inp = getAmountIn(out, pool.reserveUsd, pool.reserveWeth);
  assert.ok(getAmountOut(inp, pool.reserveUsd, pool.reserveWeth) >= out);
  assert.ok(getAmountOut(inp - 2n, pool.reserveUsd, pool.reserveWeth) < out);
  assert.equal(getAmountIn(pool.reserveWeth, pool.reserveUsd, pool.reserveWeth), null);
});

test('fillFromBook walks levels and reports the worst price', () => {
  const asks = [[100, 1], [101, 2], [105, 10]];
  assert.deepEqual(fillFromBook(asks, 2), { quote: 201, worstPrice: 101 });
  assert.equal(fillFromBook(asks, 100), null);
});

test('no opportunity when MEXC and DEX prices are equal', () => {
  const book = { bids: [[1999.9, 50]], asks: [[2000.1, 50]] };
  const opp = bestOpportunity({ ...pool, book, takerFee: 0.0005, gasUsd: 3, maxSize: 5, step: 0.1 });
  assert.equal(opp, null);
});

test('MEXC higher than DEX -> buy on DEX, sell on MEXC', () => {
  const book = { bids: [[2050, 50]], asks: [[2051, 50]] };
  const opp = bestOpportunity({ ...pool, book, takerFee: 0.0005, gasUsd: 3, maxSize: 20, step: 0.1 });
  assert.equal(opp.direction, 'DEX_BUY');
  assert.ok(opp.net > 0);
  // Pool price impact limits the size: buying all 20 ETH is not optimal.
  assert.ok(opp.size > 0 && opp.size < 20);
});

test('MEXC lower than DEX -> buy on MEXC, sell on DEX', () => {
  const book = { bids: [[1949, 50]], asks: [[1950, 50]] };
  const opp = bestOpportunity({ ...pool, book, takerFee: 0.0005, gasUsd: 3, maxSize: 5, step: 0.1 });
  assert.equal(opp.direction, 'CEX_BUY');
  assert.ok(opp.cexQty > opp.size); // extra ETH to cover the MEXC fee
});

test('directions filter is respected', () => {
  const book = { bids: [[2050, 50]], asks: [[2051, 50]] };
  const opp = bestOpportunity({ ...pool, book, takerFee: 0.0005, gasUsd: 3, maxSize: 5, step: 0.1, directions: ['CEX_BUY'] });
  assert.equal(opp, null);
});

test('evaluate: gas is subtracted from net', () => {
  const book = { bids: [[2050, 50]], asks: [[2051, 50]] };
  const a = evaluate({ ...pool, book, takerFee: 0, gasUsd: 0, size: 1 })[0];
  const b = evaluate({ ...pool, book, takerFee: 0, gasUsd: 10, size: 1 })[0];
  assert.ok(Math.abs(a.net - b.net - 10) < 1e-9);
});

test('Mexc signs requests with HMAC-SHA256 and sends the API key header', async () => {
  let captured;
  const fetchFn = async (url, opts) => {
    captured = { url: new URL(url), opts };
    return { ok: true, json: async () => ({ orderId: '1' }) };
  };
  const mexc = new Mexc({ apiKey: 'key', apiSecret: 'secret', fetchFn });
  await mexc.placeLimit('ETHUSDT', 'BUY', '0.1000', '2000.00');

  const { url, opts } = captured;
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers['X-MEXC-APIKEY'], 'key');
  assert.equal(url.pathname, '/api/v3/order');
  const sig = url.searchParams.get('signature');
  url.searchParams.delete('signature');
  const expected = crypto.createHmac('sha256', 'secret').update(url.searchParams.toString()).digest('hex');
  assert.equal(sig, expected);
  assert.equal(url.searchParams.get('type'), 'LIMIT');
});

test('Mexc refuses signed calls without keys', async () => {
  await assert.rejects(new Mexc().balances(), /MEXC_API_KEY/);
});
