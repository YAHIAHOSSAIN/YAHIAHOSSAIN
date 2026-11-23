// Phase 4: DEX-DEX detection only (src/dex/dexarb.ts). No execution anywhere:
// the module prices two legs and returns the spread, or nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dexArbOpportunity, evaluateDexArb, scanDexArb } from '../src/dex/dexarb.js';
import type { Aggregator, Quote } from '../src/dex/aggregator.js';
import type { GasInfo } from '../src/dex/chain.js';
import type { Token } from '../src/watchlist.js';

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const LINK_ADDR = '0x514910771af9ca656af840dff83e8264ecf986ca';
const GWEI = 1_000_000_000n;
const gas: GasInfo = { baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 20n * GWEI };
const ETH_USD = 2000;
// 150k gas units at 10 gwei, ETH $2000: $3.00 per leg.

const tok = (base: string, address: string, tvl: number): Token => ({
  base, symbol: `${base}USDT`, address, decimals: 18, qtyStep: 0.01, priceDecimals: 3,
  rules: {} as Token['rules'], dexTvlUsd: tvl, mexcVolumeUsd: 1e7, depositOk: true, withdrawOk: true,
});
const LINK = tok('LINK', LINK_ADDR, 1e6);
const quote = (buyAmount: bigint): Quote => ({ buyAmount, minBuyAmount: buyAmount, gas: 150_000n, spender: '0xspender' });

test('profitable spread detected: net math includes 2x gas', () => {
  // Buy $100 of LINK at $10 (10 LINK), sell 10 LINK at $11 ($110). Gas $3/leg.
  const o = dexArbOpportunity({
    token: 'LINK', sizeUsd: 100, buyInUsd: 100, tokensBought: 10, sellOutUsd: 110,
    gasUsdPerLeg: 3, hurdleUsd: 0.25,
  });
  assert.ok(o);
  assert.equal(o.netUsd, 4); // 110 - 100 - 2*3
  assert.equal(o.gasUsd, 6);
  assert.equal(o.tokensBought, 10);
});

test('no spread -> null; gas kills it -> null', () => {
  const flat = dexArbOpportunity({
    token: 'LINK', sizeUsd: 100, buyInUsd: 100, tokensBought: 10, sellOutUsd: 100,
    gasUsdPerLeg: 3, hurdleUsd: 0.25,
  });
  assert.equal(flat, null); // 100 - 100 - 6 < 0.25
  const eaten = dexArbOpportunity({
    token: 'LINK', sizeUsd: 100, buyInUsd: 100, tokensBought: 10, sellOutUsd: 104,
    gasUsdPerLeg: 3, hurdleUsd: 0.25,
  });
  assert.equal(eaten, null); // 104 - 100 - 6 = -2: the $4 spread does not survive gas
  // ...and a spread exactly at the hurdle is not enough (net must EXCEED it).
  const atHurdle = dexArbOpportunity({
    token: 'LINK', sizeUsd: 100, buyInUsd: 100, tokensBought: 10, sellOutUsd: 106.25,
    gasUsdPerLeg: 3, hurdleUsd: 0.25,
  });
  assert.equal(atHurdle, null); // net exactly 0.25
  // evaluateDexArb itself still reports the number (the gate lives in dexArbOpportunity).
  assert.equal(evaluateDexArb({
    token: 'LINK', sizeUsd: 100, buyInUsd: 100, tokensBought: 10, sellOutUsd: 104,
    gasUsdPerLeg: 3, hurdleUsd: 0.25,
  }).netUsd, -2);
});

test('scanDexArb: profitable token found at the depth-derived size, sorted by net desc', async () => {
  // LINK pool $1M: safe size min(0.7% of $500k, 1% of $1M) = $3500, capped at MAX $200.
  // Buy 200 USDC -> 20 LINK at $10; sell 20 LINK -> $220 at $11; gas $3/leg -> net $14.
  const agg: Aggregator = {
    name: 'mock',
    price: async (r) => (r.sellToken === USDC ? quote(20n * 10n ** 18n) : quote(220n * 10n ** 6n)),
    quote: async () => { throw new Error('scan uses price() only'); },
  };
  const opps = await scanDexArb([LINK], agg, gas, ETH_USD, {
    stableAddress: USDC, taker: '0xme', slippageBps: 30, minTradeUsd: 25, maxTradeUsd: 200, hurdleUsd: 0.25,
  });
  assert.equal(opps.length, 1);
  assert.equal(opps[0].token, 'LINK');
  assert.equal(opps[0].sizeUsd, 200);
  assert.equal(opps[0].buyInUsd, 200);
  assert.equal(opps[0].tokensBought, 20);
  assert.equal(opps[0].sellOutUsd, 220);
  assert.equal(opps[0].netUsd, 14);
});

test('scanDexArb: TVL unknown skipped; depth-safe size below MIN_TRADE_USD skipped', async () => {
  let calls = 0;
  const agg: Aggregator = {
    name: 'mock',
    price: async (r) => ((calls++), r.sellToken === USDC ? quote(20n * 10n ** 18n) : quote(220n * 10n ** 6n)),
    quote: async () => { throw new Error('unused'); },
  };
  const unknown = tok('UNKNOWN', '0x0000000000000000000000000000000000000001', 0);
  const thin = tok('THIN', '0x0000000000000000000000000000000000000002', 1000); // safe $3.50 < $25
  const opps = await scanDexArb([unknown, thin, LINK], agg, gas, ETH_USD, {
    stableAddress: USDC, taker: '0xme', slippageBps: 30, minTradeUsd: 25, maxTradeUsd: 200, hurdleUsd: 0.25,
  });
  assert.deepEqual(opps.map((o) => o.token), ['LINK']);
  assert.equal(calls, 2); // only LINK was priced (buy + sell)
});

test('scanDexArb: one token failing does not abort the scan', async () => {
  const agg: Aggregator = {
    name: 'mock',
    price: async (r) => {
      if (r.buyToken === '0x00000000000000000000000000000000000000bad' || r.sellToken === '0x00000000000000000000000000000000000000bad') {
        throw new Error('no route');
      }
      return r.sellToken === USDC ? quote(20n * 10n ** 18n) : quote(220n * 10n ** 6n);
    },
    quote: async () => { throw new Error('unused'); },
  };
  const bad = tok('BAD', '0x00000000000000000000000000000000000000bad', 1e6);
  const opps = await scanDexArb([bad, LINK], agg, gas, ETH_USD, {
    stableAddress: USDC, taker: '0xme', slippageBps: 30, minTradeUsd: 25, maxTradeUsd: 200, hurdleUsd: 0.25,
  });
  assert.deepEqual(opps.map((o) => o.token), ['LINK']);
});

test('scanDexArb: below-hurdle spreads are returned too (caller decides the row), sorted by net desc', async () => {
  const agg: Aggregator = {
    name: 'mock',
    price: async (r) => {
      // LINK: buy $200 -> 20 LINK, sell -> $204 (net -2). AAA: buy $200 -> 20 AAA, sell -> $230 (net +24).
      if (r.buyToken === LINK_ADDR || r.sellToken === LINK_ADDR) {
        return r.sellToken === USDC ? quote(20n * 10n ** 18n) : quote(204n * 10n ** 6n);
      }
      return r.sellToken === USDC ? quote(20n * 10n ** 18n) : quote(230n * 10n ** 6n);
    },
    quote: async () => { throw new Error('unused'); },
  };
  const aaa = tok('AAA', '0x00000000000000000000000000000000000000aa', 1e6);
  const opps = await scanDexArb([LINK, aaa], agg, gas, ETH_USD, {
    stableAddress: USDC, taker: '0xme', slippageBps: 30, minTradeUsd: 25, maxTradeUsd: 200, hurdleUsd: 0.25,
  });
  assert.deepEqual(opps.map((o) => o.token), ['AAA', 'LINK']); // best net first
  assert.equal(opps[0].netUsd, 24);
  assert.equal(opps[1].netUsd, -2); // below the hurdle, still reported
});
