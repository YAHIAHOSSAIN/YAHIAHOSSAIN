import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalAmount, MAX_UINT256 } from '../src/dex/chain.js';

test('approvalAmount: exact by default, MaxUint256 when unlimited is on', () => {
  const amount = 123_456n;
  assert.equal(approvalAmount(false, amount), amount);
  assert.equal(approvalAmount(true, amount), MAX_UINT256);
  assert.equal(approvalAmount(true, 0n), MAX_UINT256);
});

test('MAX_UINT256 is 2^256 - 1', () => {
  assert.equal(MAX_UINT256, (1n << 256n) - 1n);
});
