// dexPrices: DexScreener chain selection (multi-chain transfer, 2026-11-22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dexPrices } from '../src/scanner.js';

function fakeFetch(pairs: unknown[]) {
  let url = '';
  const fn = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify(pairs));
  }) as unknown as typeof fetch;
  return { fn, get url() { return url; } };
}

const pairs = [
  { chainId: 'ethereum', priceUsd: '1.00', liquidity: { usd: 1000 }, volume: { h24: 500 }, baseToken: { address: '0xAAA' } },
  { chainId: 'ethereum', priceUsd: '1.01', liquidity: { usd: 5000 }, volume: { h24: 300 }, baseToken: { address: '0xaaa' } },
  { chainId: 'bsc', priceUsd: '99', liquidity: { usd: 9000 }, volume: { h24: 900 }, baseToken: { address: '0xaaa' } },
  { chainId: 'bsc', priceUsd: '2.00', liquidity: { usd: 700 }, volume: { h24: 100 }, baseToken: { address: '0xBBB' } },
];

test('dexPrices defaults to ethereum: deepest pool wins, other chains ignored', async () => {
  const f = fakeFetch(pairs);
  const m = await dexPrices(['0xaaa', '0xbbb'], f.fn);
  assert.ok(f.url.includes('tokens/v1/ethereum/0xaaa,0xbbb'), f.url);
  assert.equal(m.size, 1); // only 0xaaa has an ethereum pair
  assert.deepEqual(m.get('0xaaa'), { price: 1.01, tvl: 5000, vol24h: 500 }); // deepest pool's price, max volume
});

test('dexPrices with chain bsc: only bsc pairs, bsc endpoint', async () => {
  const f = fakeFetch(pairs);
  const m = await dexPrices(['0xaaa', '0xbbb'], f.fn, 'bsc');
  assert.ok(f.url.includes('tokens/v1/bsc/0xaaa,0xbbb'), f.url);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get('0xaaa'), { price: 99, tvl: 9000, vol24h: 900 });
  assert.deepEqual(m.get('0xbbb'), { price: 2, tvl: 700, vol24h: 100 });
});

test('dexPrices with chain arbitrum: only arbitrum pairs', async () => {
  const f = fakeFetch([...pairs, { chainId: 'arbitrum', priceUsd: '3.50', liquidity: { usd: 2000 }, volume: { h24: 50 }, baseToken: { address: '0xAAA' } }]);
  const m = await dexPrices(['0xaaa'], f.fn, 'arbitrum');
  assert.ok(f.url.includes('tokens/v1/arbitrum/0xaaa'), f.url);
  assert.deepEqual(m.get('0xaaa'), { price: 3.5, tvl: 2000, vol24h: 50 });
});

test('loadUniverse uses the chain contract, not the Ethereum one', async () => {
  // The Arbitrum twin's first live start failed with "No MEXC ERC20 token
  // passed the filters": loadUniverse picked the Ethereum contract for every
  // token, so the Arbitrum DEX lookup found 0 volume for all 469 of them.
  const { loadUniverse } = await import('../src/scanner.js');
  const { chainProfile } = await import('../src/chains.js');
  const ETH = '0x1111111111111111111111111111111111111111';
  const ARB = '0x2222222222222222222222222222222222222222';
  const symbolInfo = (base: string) => ({ symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'] });
  const fake = {
    exchangeInfo: async () => [symbolInfo('XYZ')],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }],
    coinConfigs: async () => [{ coin: 'XYZ', networkList: [
      { coin: 'XYZ', network: 'Ethereum(ERC20)', netWork: 'ETH', contract: ETH, depositEnable: true, withdrawEnable: true, withdrawFee: '1', withdrawMin: '10' },
      { coin: 'XYZ', network: 'Arbitrum One(ARB)', netWork: 'ARB', contract: ARB, depositEnable: true, withdrawEnable: true, withdrawFee: '1', withdrawMin: '10' },
    ] }],
  };
  // Only the Arbitrum contract has DEX volume.
  const dexFn = (async (addrs: string[]) => new Map(addrs.map((a) => [a, { price: 1, tvl: 1e6, vol24h: a === ARB.toLowerCase() ? 50_000 : 0 }]))) as never;
  const u = await loadUniverse(fake as never, { minVolumeUsd: 1, only: [], minDexVolumeUsd: 10_000, chain: chainProfile('arbitrum') }, dexFn);
  assert.equal(u.length, 1);
  assert.equal(u[0].address, ARB.toLowerCase());
  assert.equal(u[0].netWork, 'ARB');
});

// ---------------- Phase 1 depth filter: pool-liquidity floor in loadUniverse ----------------
const uniSymbol = (base: string) => ({ symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'] });
const uniCoin = (base: string, contract: string) => ({
  coin: base,
  networkList: [{ coin: base, network: 'Ethereum(ERC20)', netWork: 'ETH', contract, depositEnable: true, withdrawEnable: true, withdrawFee: '1', withdrawMin: '10' }],
});
const XYZ_A = '0x1111111111111111111111111111111111111111';
const ABC_A = '0x3333333333333333333333333333333333333333';
const uniFake = {
  exchangeInfo: async () => [uniSymbol('XYZ'), uniSymbol('ABC')],
  tickers24h: async () => [
    { symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' },
    { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' },
  ],
  coinConfigs: async () => [uniCoin('XYZ', XYZ_A), uniCoin('ABC', ABC_A)],
};

test('loadUniverse drops a token below the pool-liquidity floor, using the same DexScreener call', async () => {
  const { loadUniverse } = await import('../src/scanner.js');
  let calls = 0;
  const dexFn = (async (addrs: string[]) => {
    calls++;
    return new Map(addrs.map((a) => [a, { price: 1, tvl: a === XYZ_A.toLowerCase() ? 42_000 : 500_000, vol24h: 1e6 }]));
  }) as never;
  const u = await loadUniverse(uniFake as never, { minVolumeUsd: 1, only: [], minPoolLiquidityUsd: 150_000 }, dexFn);
  assert.equal(calls, 1); // no second API call for the liquidity filter
  assert.deepEqual(u.map((t) => t.base), ['ABC']); // XYZ's $42k pool is below the $150k floor
});

test('loadUniverse keeps the list when the DexScreener call throws (fail-open)', async () => {
  const { loadUniverse } = await import('../src/scanner.js');
  const dexFn = (async () => { throw new Error('dexscreener down'); }) as never;
  const u = await loadUniverse(uniFake as never, { minVolumeUsd: 1, only: [], minPoolLiquidityUsd: 150_000 }, dexFn);
  assert.deepEqual(u.map((t) => t.base).sort(), ['ABC', 'XYZ']);
});

test('loadUniverse keeps a token whose pool tvl is 0/unknown (fail-open)', async () => {
  const { loadUniverse } = await import('../src/scanner.js');
  // XYZ has tvl 0 (no pool data); ABC has no DexScreener entry at all.
  const dexFn = (async (addrs: string[]) => new Map(
    addrs.filter((a) => a === XYZ_A.toLowerCase()).map((a) => [a, { price: 1, tvl: 0, vol24h: 1e6 }]),
  )) as never;
  const u = await loadUniverse(uniFake as never, { minVolumeUsd: 1, only: [], minPoolLiquidityUsd: 150_000 }, dexFn);
  assert.deepEqual(u.map((t) => t.base).sort(), ['ABC', 'XYZ']);
});

test('loadUniverse with no liquidity floor does not call DexScreener at all', async () => {
  const { loadUniverse } = await import('../src/scanner.js');
  let calls = 0;
  const dexFn = (async (addrs: string[]) => {
    calls++;
    return new Map(addrs.map((a) => [a, { price: 1, tvl: 1e6, vol24h: 1e6 }]));
  }) as never;
  const u = await loadUniverse(uniFake as never, { minVolumeUsd: 1, only: [] }, dexFn);
  assert.equal(calls, 0);
  assert.deepEqual(u.map((t) => t.base).sort(), ['ABC', 'XYZ']);
});

// ---------------- Phase 9: profit-winner pinning in loadUniverse ----------------
const pinSym = (base: string) => ({ symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'] });
const pinCoin = (base: string, contract: string) => ({
  coin: base,
  networkList: [{ coin: base, network: 'Ethereum(ERC20)', netWork: 'ETH', contract, depositEnable: true, withdrawEnable: true, withdrawFee: '1', withdrawMin: '10' }],
});
function pinFake(tokens: { base: string; contract: string; vol: number }[]) {
  return {
    exchangeInfo: async () => tokens.map((t) => pinSym(t.base)),
    tickers24h: async () => tokens.map((t) => ({ symbol: `${t.base}USDT`, quoteVolume: String(t.vol), lastPrice: '1' })),
    coinConfigs: async () => tokens.map((t) => pinCoin(t.base, t.contract)),
  };
}
const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';
const A3 = '0x3333333333333333333333333333333333333333';
const pinDex = (tvlByAddr: Record<string, number>) => (async (addrs: string[]) => new Map(
  addrs.map((a) => [a, { price: 1, tvl: tvlByAddr[a.toLowerCase()] ?? 1e6, vol24h: 1e6 }]),
)) as never;

test('Phase 9: loadUniverse pins a winner past the max cut (top-max list unchanged)', async () => {
  const { loadUniverse } = await import('../src/scanner.js');
  const tokens = [
    { base: 'AAA', contract: A1, vol: 9e6 },
    { base: 'BBB', contract: A2, vol: 8e6 },
    { base: 'CCC', contract: A3, vol: 7e6 },
  ];
  // Without a pin, max=1 keeps only the biggest token.
  const plain = await loadUniverse(pinFake(tokens) as never, { minVolumeUsd: 1, only: [], max: 1 }, pinDex({}));
  assert.deepEqual(plain.map((t) => t.base), ['AAA']);
  // With CCC pinned, it is appended after the top-1 cut.
  const pinned = await loadUniverse(pinFake(tokens) as never, { minVolumeUsd: 1, only: [], max: 1, pin: new Set(['CCC']) }, pinDex({}));
  assert.deepEqual(pinned.map((t) => t.base), ['AAA', 'CCC']);
  // A pinned token already inside the top-max keeps its volume rank (no duplicate, no extra slot).
  const inside = await loadUniverse(pinFake(tokens) as never, { minVolumeUsd: 1, only: [], max: 2, pin: new Set(['AAA']) }, pinDex({}));
  assert.deepEqual(inside.map((t) => t.base), ['AAA', 'BBB']);
});

test('Phase 9: a pinned winner that fails a safety filter is still dropped', async () => {
  const { loadUniverse } = await import('../src/scanner.js');
  const tokens = [
    { base: 'AAA', contract: A1, vol: 9e6 },
    { base: 'BBB', contract: A2, vol: 8e6 },
    { base: 'CCC', contract: A3, vol: 7e6 },
  ];
  // CCC's pool is $42k, below the $150k floor: pinning must not rescue it.
  const u = await loadUniverse(pinFake(tokens) as never, { minVolumeUsd: 1, only: [], max: 1, minPoolLiquidityUsd: 150_000, pin: new Set(['CCC']) }, pinDex({ [A3.toLowerCase()]: 42_000 }));
  assert.deepEqual(u.map((t) => t.base), ['AAA']);
  // CCC below the MEXC volume floor: dropped before pinning even applies.
  const u2 = await loadUniverse(pinFake(tokens) as never, { minVolumeUsd: 8.5e6, only: [], max: 1, pin: new Set(['CCC']) }, pinDex({}));
  assert.deepEqual(u2.map((t) => t.base), ['AAA']);
});

test('Phase 9: pinned winners past the cut are capped at 10', async () => {
  const { loadUniverse, MAX_PINNED_WINNERS } = await import('../src/scanner.js');
  assert.equal(MAX_PINNED_WINNERS, 10);
  const tokens = Array.from({ length: 12 }, (_, i) => ({
    base: `T${String(i).padStart(2, '0')}`,
    contract: `0x${(i + 1).toString(16).padStart(40, '0')}`,
    vol: (12 - i) * 1e6, // T00 biggest, T11 smallest
  }));
  const pin = new Set(tokens.slice(1).map((t) => t.base)); // pin all 11 below the top-1 cut
  const u = await loadUniverse(pinFake(tokens) as never, { minVolumeUsd: 1, only: [], max: 1, pin }, pinDex({}));
  assert.equal(u.length, 11); // top-1 + 10 pinned
  assert.equal(u[0].base, 'T00');
  assert.deepEqual(u.slice(1).map((t) => t.base), tokens.slice(1, 11).map((t) => t.base)); // best volume first
});
