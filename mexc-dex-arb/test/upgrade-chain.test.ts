// Phase-1 upgrade, item 3: configurable chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAINS, chainProfile, explorerTxUrl, networkFor } from '../src/chains.js';
import { loadConfig } from '../src/config.js';
import { dexTvl } from '../src/watchlist.js';
import { ZEROX_ALLOWANCE_HOLDER } from '../src/dex/aggregator.js';

function cfgFor(env: Record<string, string>) {
  const saved = { ...process.env };
  for (const k of ['CHAIN', 'STRATEGY', 'ALLOW_WITHDRAWALS', 'MODE', 'STABLE_ADDRESS', 'USDC_ADDRESS', 'TICK_MS']) delete process.env[k];
  Object.assign(process.env, { RPC_URL: 'http://x' }, env);
  try {
    return loadConfig();
  } finally {
    process.env = saved;
  }
}

test('CHAIN defaults to ethereum: behaviour unchanged (USDC, block-driven)', () => {
  const c = cfgFor({});
  assert.equal(c.chain.chainId, 1);
  assert.equal(c.usdc, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  assert.equal(c.tickMs, 0);
  assert.equal(c.stableIsUsdt, false);
});

test('CHAIN=base: chain id 8453, Base USDC, 1 s timer ticks', () => {
  const c = cfgFor({ CHAIN: 'base' });
  assert.equal(c.chain.chainId, 8453);
  assert.equal(c.usdc, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  assert.equal(c.tickMs, 1000);
  assert.equal(c.chain.nativeMexcSymbol, 'ETHUSDT');
});

test('CHAIN=bsc: the DEX stable is USDT (no USDC conversion) and gas is priced in BNB', () => {
  const c = cfgFor({ CHAIN: 'bsc' });
  assert.equal(c.chain.chainId, 56);
  assert.equal(c.stableIsUsdt, true);
  assert.equal(c.chain.nativeMexcSymbol, 'BNBUSDT');
});

test('unknown chain and transfer-on-L2 are refused', () => {
  assert.throws(() => chainProfile('solana'), /CHAIN must be one of/);
  assert.throws(() => cfgFor({ CHAIN: 'base', STRATEGY: 'transfer', ALLOW_WITHDRAWALS: 'yes' }), /only supported on CHAIN=ethereum/);
});

test('networkFor picks the right MEXC network entry per chain', () => {
  const list = [
    { network: 'Ethereum(ERC20)', netWork: 'ETH', contract: '0xeth' },
    { network: 'BNB Smart Chain(BEP20)', netWork: 'BSC', contract: '0xbsc' },
    { network: 'Arbitrum One(ARB)', netWork: 'ARB', contract: '0xarb' },
    { network: 'Base', netWork: 'BASE', contract: '0xbase' },
  ];
  assert.equal(networkFor(CHAINS.ethereum, list)?.contract, '0xeth');
  assert.equal(networkFor(CHAINS.bsc, list)?.contract, '0xbsc');
  assert.equal(networkFor(CHAINS.arbitrum, list)?.contract, '0xarb');
  assert.equal(networkFor(CHAINS.base, list)?.contract, '0xbase');
  assert.equal(networkFor(CHAINS.base, list.slice(0, 2)), undefined); // not on Base at MEXC
});

test('DexScreener TVL counts only pools on the selected chain', async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ pairs: [{ chainId: 'ethereum', liquidity: { usd: 5e6 } }, { chainId: 'base', liquidity: { usd: 3e5 } }] }))) as unknown as typeof fetch;
  assert.equal(await dexTvl('0xa', fetchFn, 'base'), 3e5);
  assert.equal(await dexTvl('0xa', fetchFn, 'ethereum'), 5e6);
});

test('every chain shares the same pinned 0x AllowanceHolder', () => {
  // docs.0x.org/docs/core-concepts/contracts: same address on Ethereum, Base, Arbitrum, BSC, ...
  assert.equal(ZEROX_ALLOWANCE_HOLDER, '0x0000000000001ff3684f28c67538d4d072c22734');
  for (const c of Object.values(CHAINS)) assert.match(c.stable.address, /^0x[0-9a-f]{40}$/);
});

test('explorerTxUrl uses the chain\'s own explorer (round-3 L4)', () => {
  assert.equal(explorerTxUrl(CHAINS.ethereum, '0xabc'), 'https://etherscan.io/tx/0xabc');
  assert.equal(explorerTxUrl(CHAINS.base, '0xabc'), 'https://basescan.org/tx/0xabc');
  assert.equal(explorerTxUrl(CHAINS.bsc, '0xabc'), 'https://bscscan.com/tx/0xabc');
  assert.equal(explorerTxUrl(CHAINS.arbitrum, '0xabc'), 'https://arbiscan.io/tx/0xabc');
});

test('STABLE_ADDRESS override also flips stableIsUsdt (round-3 L7c)', () => {
  // Point Ethereum at BSC's USDT: the stable rate must follow the address, not the chain default.
  const c = cfgFor({ STABLE_ADDRESS: '0x55d398326f99059ff775485246999027b3197955' });
  assert.equal(c.usdc, '0x55d398326f99059ff775485246999027b3197955');
  assert.equal(c.stableIsUsdt, true);
  // And the other way: BSC at Ethereum USDC.
  const d = cfgFor({ CHAIN: 'bsc', STABLE_ADDRESS: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' });
  assert.equal(d.stableIsUsdt, false);
  // An unknown address falls back to the chain default.
  const e = cfgFor({ STABLE_ADDRESS: '0x0000000000000000000000000000000000000001' });
  assert.equal(e.stableIsUsdt, false);
});
