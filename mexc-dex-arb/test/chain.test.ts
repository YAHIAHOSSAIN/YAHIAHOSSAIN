import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalAmount, MAX_UINT256, pickTip } from '../src/dex/chain.js';

test('approvalAmount: exact by default, MaxUint256 when unlimited is on', () => {
  const amount = 123_456n;
  assert.equal(approvalAmount(false, amount), amount);
  assert.equal(approvalAmount(true, amount), MAX_UINT256);
  assert.equal(approvalAmount(true, 0n), MAX_UINT256);
});

test('MAX_UINT256 is 2^256 - 1', () => {
  assert.equal(MAX_UINT256, (1n << 256n) - 1n);
});

test('pickTip: builder tip (BUILDER_TIP_GWEI) is added on top of the capped median', () => {
  const GWEI = 1_000_000_000n;
  // Rewards are in wei: median of [100, 200, 300] gwei, cap 1000 gwei.
  assert.equal(pickTip([100n * GWEI, 200n * GWEI, 300n * GWEI], 1000n * GWEI), 200n * GWEI);
  assert.equal(pickTip([100n * GWEI, 200n * GWEI, 300n * GWEI], 1000n * GWEI, 2), 202n * GWEI);
  // No rewards: the cap, plus the builder tip.
  assert.equal(pickTip([], 500n * GWEI, 1), 501n * GWEI);
  // Cap binds first, then the builder tip is added on top (it is allowed to exceed PRIORITY_FEE_GWEI).
  assert.equal(pickTip([5000n * GWEI], 1000n * GWEI, 2), 1002n * GWEI);
  // Default 0 leaves the old median-tip path exactly as it was.
  assert.equal(pickTip([100n * GWEI, 200n * GWEI, 300n * GWEI], 1000n * GWEI, 0), 200n * GWEI);
});
