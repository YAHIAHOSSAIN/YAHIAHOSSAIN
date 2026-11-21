import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCexBuy,
  evaluateDexBuy,
  fillBase,
  fillQuote,
  gasUsd,
  planCexBuy,
  planCexBuyQty,
  threshold,
  unwindPlan,
} from '../src/pricing.js';
import { floorToStep, toFloat, toUnits, dhakaDay } from '../src/util.js';

const costs = { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 };
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('fillBase / fillQuote walk the book', () => {
  const asks: [number, number][] = [[10, 5], [11, 5]];
  assert.deepEqual(fillBase(asks, 7), { quote: 72, worst: 11 });
  assert.equal(fillBase(asks, 11), null);
  const q = fillQuote(asks, 72)!;
  close(q.qty, 7);
  assert.equal(q.worst, 11);
  assert.equal(fillQuote(asks, 1000), null);
});

test('threshold = max(USD floor, bps of size)', () => {
  assert.equal(threshold(200, 15, 50), 15);
  assert.equal(threshold(10_000, 15, 50), 50);
  assert.equal(threshold(100, 0.25, 20), 0.25);
  assert.equal(threshold(500, 0.25, 20), 1);
});

test('evaluateDexBuy: sells only what the DEX guarantees, every cost subtracted', () => {
  // $200 on DEX buys 20 tokens expected, 19.9 guaranteed; MEXC bid 11 -> sell 19.9 for $218.90.
  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.9, bids: [[11, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
  const proceeds = 19.9 * 11;
  close(o.net, proceeds - proceeds * 0.0005 - 200 - 3 - proceeds * 0.002 - 2);
  assert.equal(o.cexQty, 19.9);
  close(o.cexLimitPrice, 11 * 0.998);
  close(o.buyPrice, 10);
  close(o.sellPrice, 11);
});

test('evaluateDexBuy: dust below the MEXC step is kept as inventory, not counted as profit', () => {
  const o = evaluateDexBuy({ sizeUsd: 100, tokensOut: 10.005, tokensMin: 10.005, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 0, costs: { ...costs, takerFee: 0, cexSlippageBps: 0, safetyMarginUsd: 0 } })!;
  assert.equal(o.cexQty, 10);
  close(o.net, 0.05, 1e-9); // 100 proceeds - (100 - 0.05 dust value)
});

test('planCexBuy + evaluateCexBuy: fee is paid in tokens, so fewer tokens are sold on DEX', () => {
  const plan = planCexBuy({ sizeUsd: 200, asks: [[10, 100]], qtyStep: 0.01, takerFee: 0.0005 })!;
  assert.equal(plan.qty, 20);
  close(plan.costUsd, 200);
  close(plan.tokensToSell, 20 * 0.9995);
  const o = evaluateCexBuy({ plan, usdcOut: 230, usdcMin: 229, gasUsd: 3, costs });
  close(o.net, 230 - 200 - 3 - (200 * 0.002 + 1) - 2);
  assert.deepEqual(planCexBuyQty([[10, 100]], 20, 0.0005), plan);
});

test('no opportunity when prices are equal', () => {
  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.94, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
  assert.ok(o.net < 0);
});

test('gasUsd', () => {
  close(gasUsd(200_000n, 20_000_000_000n, 2000), 8); // 200k gas * 20 gwei = 0.004 ETH
});

test('unwindPlan covers every one-sided case', () => {
  assert.equal(unwindPlan('DEX_BUY', true, 10, 10, 0.0005, 0.01), null); // both filled
  assert.deepEqual(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.side, 'SELL');
  assert.equal(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.qty, 6);
  assert.deepEqual(unwindPlan('DEX_BUY', false, 10, 10, 0.0005, 0.01)?.side, 'BUY');
  assert.equal(unwindPlan('DEX_BUY', false, 10, 0, 0.0005, 0.01), null); // nothing happened
  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.qty, 3);
  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.side, 'BUY');
  const u = unwindPlan('CEX_BUY', false, 10, 10, 0.0005, 0.01)!;
  assert.equal(u.side, 'SELL');
  assert.equal(u.qty, 9.99); // sell only what we received after the fee
});

test('util conversions', () => {
  assert.equal(floorToStep(1.23456, 0.01), 1.23);
  assert.equal(floorToStep(0.3, 0.1), 0.3);
  assert.equal(toUnits(123.456789, 6), 123456789n);
  assert.equal(toUnits(1.5e-7, 18), 150000000000n);
  assert.equal(toUnits(0.1, 18), 100000000000000000n); // exactly, not 100000000000000005
  assert.equal(toUnits(1, 18), 10n ** 18n);
  assert.equal(toFloat(1_500_000n, 6), 1.5);
  assert.equal(toFloat(5n, 18), 5e-18);
  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 18, 30)), '2026-01-02'); // 00:30 in Dhaka
  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 17, 59)), '2026-01-01');
});
