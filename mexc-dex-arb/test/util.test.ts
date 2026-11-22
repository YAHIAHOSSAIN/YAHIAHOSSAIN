// walletLine: the /status wallet line is chain-aware (audit 2026-11-22, M6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainProfile } from '../src/chains.js';
import { usd, walletLine } from '../src/util.js';

test('walletLine shows ETH + USDC/1e6 on Ethereum', () => {
  const line = walletLine(1493.98, 30300000000000000n, 125000000n, chainProfile('ethereum'), 6, usd);
  assert.equal(line, 'MEXC $1493.98 USDT | wallet 0.0303 ETH, $125.00 USDC');
});

test('walletLine shows BNB + USDT/1e18 on BSC (not ETH, not /1e6)', () => {
  // 0.037606 BNB and 250 USDT (250 * 1e18 raw). The old line showed
  // `0.0376 ETH, $250000000000.00 USDC` — the USDT balance ~1e12x too big.
  const line = walletLine(1493.98, 37606000000000000n, 250n * 10n ** 18n, chainProfile('bsc'), 18, usd);
  assert.equal(line, 'MEXC $1493.98 USDT | wallet 0.0376 BNB, $250.00 USDT');
});

test('walletLine shows ETH + USDC/1e6 on Arbitrum', () => {
  const line = walletLine(1493.98, 17798000000000000n, 50000000n, chainProfile('arbitrum'), 6, usd);
  assert.equal(line, 'MEXC $1493.98 USDT | wallet 0.0178 ETH, $50.00 USDC');
});
