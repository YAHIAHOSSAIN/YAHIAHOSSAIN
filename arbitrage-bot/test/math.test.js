import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAmountOut, arbProfit, findOptimalAmount, orient } from '../src/math.js';

const E = 10n ** 18n;

test('getAmountOut matches the Uniswap V2 formula', () => {
  // 1 WETH into a 100 WETH / 300000 USDC pool
  assert.equal(getAmountOut(1n * E, 100n * E, 300000n * E), 2961474103191183896551n);
  assert.equal(getAmountOut(0n, 1n, 1n), 0n);
});

test('no profit when both pools have the same price', () => {
  const pool = { reserveIn: 100n * E, reserveOut: 300000n * E };
  assert.ok(findOptimalAmount(pool, pool).profit <= 0n);
});

test('finds the profit peak when prices differ', () => {
  const borrow = { reserveIn: 100n * E, reserveOut: 300000n * E }; // 3000 tokens / WETH
  const sell = { reserveIn: 100n * E, reserveOut: 290000n * E }; // 2900 tokens / WETH
  const { amountIn, profit } = findOptimalAmount(borrow, sell);
  assert.ok(profit > 0n);
  // Neighbours of the optimum must not be better.
  assert.ok(arbProfit(amountIn - E / 100n, borrow, sell) <= profit);
  assert.ok(arbProfit(amountIn + E / 100n, borrow, sell) <= profit);
  // The reverse direction loses money.
  assert.ok(findOptimalAmount(sell, borrow).profit <= 0n);
});

test('orient picks reserves by tokenIn side', () => {
  assert.deepEqual(orient(1n, 2n, true), { reserveIn: 1n, reserveOut: 2n });
  assert.deepEqual(orient(1n, 2n, false), { reserveIn: 2n, reserveOut: 1n });
});
