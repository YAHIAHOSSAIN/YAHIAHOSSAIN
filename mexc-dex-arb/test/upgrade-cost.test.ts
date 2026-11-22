// Phase-1 upgrade, item 1: cost model (per-symbol fee, USDC != USDT, bps hurdles, dynamic tip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDexBuy, threshold } from '../src/pricing.js';
import { takerFeeFor, rulesFrom } from '../src/mexc/rules.js';
import { pickTip } from '../src/dex/chain.js';
import { loadConfig, validateConfig } from '../src/config.js';

const GWEI = 1_000_000_000n;

/** New defaults: fee per symbol, 5 bps CEX slippage, safety 10 bps, need = max($0.25, 20 bps). */
function defaults() {
  const saved = { ...process.env };
  for (const k of ['MIN_PROFIT_USD', 'MIN_PROFIT_BPS', 'SAFETY_MARGIN_USD', 'SAFETY_MARGIN_BPS', 'CEX_SLIPPAGE_BPS', 'MAX_TRADE_USD', 'MIN_TRADE_USD', 'TRANSFER_DRIFT_BPS', 'CHAIN', 'STRATEGY', 'MODE', 'MIN_POOL_LIQUIDITY_USD', 'DEPTH_MAX_IMPACT_BPS', 'DEPTH_MAX_SIZE_PCT', 'QUOTE_RPS_VELORA', 'QUOTE_RPS_OPENOCEAN', 'REBALANCE_LOW_X', 'DEX_ARB_ENABLED', 'MIN_PROFIT_BPS_ETH', 'BUILDER_TIP_GWEI']) delete process.env[k];
  process.env.RPC_URL = 'http://x';
  const c = validateConfig(loadConfig());
  process.env = saved;
  return c;
}

/** $100 DEX_BUY at DEX price 10, MEXC bid = 10 * (1 + gapBps), gas $0.01, fee 8 bps. */
function dexBuyNet(gapBps: number, stableInUsdt = 1, override?: Partial<ReturnType<typeof defaults>>) {
  const c = { ...defaults(), ...override };
  const o = evaluateDexBuy({
    sizeUsd: 100,
    tokensOut: 10,
    tokensMin: 10,
    bids: [[10 * (1 + gapBps / 10_000), 1e6]],
    qtyStep: 0.01,
    gasUsd: 0.01,
    costs: { takerFee: 0.0008, cexSlippageBps: c.cexSlippageBps, safetyMarginUsd: c.safetyMarginUsd, safetyMarginBps: c.safetyMarginBps, stableInUsdt },
  })!;
  return { net: o.net, need: threshold(100, c.minProfitUsd, c.minProfitBps) };
}

test('defaults: need = max($0.25, 20 bps), safety 10 bps, CEX slippage 5 bps', () => {
  const c = defaults();
  assert.equal(c.minProfitUsd, 0.25);
  assert.equal(c.minProfitBps, 20);
  assert.equal(c.safetyMarginUsd, 0);
  assert.equal(c.safetyMarginBps, 10);
  assert.equal(c.cexSlippageBps, 5);
  assert.equal(c.chain.name, 'ethereum');
});

test('$100 trade, 8 bps fee: a 0.50% gap passes, a 0.20% gap fails', () => {
  const pass = dexBuyNet(50);
  assert.ok(pass.net > pass.need, `${pass.net} vs ${pass.need}`);
  const fail = dexBuyNet(20);
  assert.ok(fail.net < fail.need);
  // Note: with these defaults the break-even at $100 is ~0.49% (25 bps floor + 8 fee + 5 slip + 10 safety + gas),
  // so a 0.40% gap does NOT pass at $100. It passes from ~$200 up only if the gap is ~0.45%+.
  const p40 = dexBuyNet(40);
  assert.ok(p40.net < p40.need);
});

test('USDC != USDT: a fake +22 bps DEX_BUY edge disappears at the real 1.0022 rate', () => {
  const zero = { cexSlippageBps: 0, safetyMarginUsd: 0, safetyMarginBps: 0 };
  const noFee = (gap: number, rate: number) => {
    const o = evaluateDexBuy({
      sizeUsd: 100, tokensOut: 10, tokensMin: 10, bids: [[10 * (1 + gap / 10_000), 1e6]], qtyStep: 0.01, gasUsd: 0,
      costs: { takerFee: 0, ...zero, stableInUsdt: rate },
    })!;
    return o.net;
  };
  assert.ok(noFee(22, 1) > 0.2); // treating USDC as 1 USDT: looks like +$0.22
  assert.ok(Math.abs(noFee(22, 1.0022)) < 1e-9); // real rate: nothing there
  assert.ok(dexBuyNet(22, 1.0022).net < 0); // with fees: a loss
});

test('per-symbol taker fee: 0.002 wins over the 0.0005 override; the override is a floor', () => {
  assert.equal(takerFeeFor({ takerFee: 0.002 }, 0.0005), 0.002);
  assert.equal(takerFeeFor({ takerFee: 0.0002 }, 0.0005), 0.0005);
  assert.equal(takerFeeFor(undefined, 0.0005), 0.0005);
  const r = rulesFrom({ symbol: 'X', baseAsset: 'X', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0', quotePrecision: 4, orderTypes: ['LIMIT'], takerCommission: '0.002', makerCommission: '0' });
  assert.equal(r.takerFee, 0.002);
  assert.equal(r.makerFee, 0);
});

test('dynamic tip: median of recent tips, capped, with a tiny floor', () => {
  const cap = 1n * GWEI;
  assert.equal(pickTip([10_000_000n, 20_000_000n, 30_000_000n], cap), 20_000_000n); // 0.02 gwei, not 1 gwei
  assert.equal(pickTip([5n * GWEI, 6n * GWEI, 7n * GWEI], cap), cap); // spike: capped
  assert.equal(pickTip([0n, 0n, 1n], cap), 1_000_000n); // never 0
  assert.equal(pickTip([], cap), cap); // no data: the cap
});
