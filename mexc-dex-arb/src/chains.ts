// Per-chain settings. One bot process trades one chain (one pm2 app per chain, each with its own DB_PATH).
//
// Verified 2026-11-21:
//  - Stable and wrapped-native addresses: live KyberSwap /routes quotes succeeded for each pair below.
//  - 0x AllowanceHolder 0x0000000000001fF3684f28c67538d4D072C22734 is the same on all of these chains
//    (https://docs.0x.org/docs/core-concepts/contracts).
//  - KyberSwap MetaAggregationRouterV2 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5 is the same on all of them
//    (https://docs.kyberswap.com/developer-guide/aggregator-api/contracts), and live /routes returned it on all four.
// NOT verified: MEXC's exact network names per chain. `mexcNetwork` is a pattern; check the real names
// with `npm run networks` before trading a new chain.

export type ChainName = 'ethereum' | 'base' | 'bsc' | 'arbitrum';

export interface ChainProfile {
  name: ChainName;
  chainId: number;
  /** The stable the bot trades on the DEX. Its decimals are read on-chain at startup. */
  stable: { address: string; symbol: 'USDC' | 'USDT' };
  /** Wrapped native token, used for the startup aggregator smoke test. */
  wrappedNative: string;
  /** MEXC symbol pricing the gas token in USDT. */
  nativeMexcSymbol: 'ETHUSDT' | 'BNBUSDT';
  /** KyberSwap / DexScreener chain identifiers. */
  kyberName: string;
  dexScreenerId: string;
  /** Matches MEXC coinConfig networkList entries (network / netWork) for this chain. */
  mexcNetwork: RegExp;
  /** null = one scan per new block (12 s chains); otherwise scan on a timer (ms). */
  tickMs: number | null;
}

export const CHAINS: Record<ChainName, ChainProfile> = {
  ethereum: {
    name: 'ethereum',
    chainId: 1,
    stable: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC' },
    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    nativeMexcSymbol: 'ETHUSDT',
    kyberName: 'ethereum',
    dexScreenerId: 'ethereum',
    mexcNetwork: /^ETH$|ERC20|^Ethereum$/i,
    tickMs: null,
  },
  base: {
    name: 'base',
    chainId: 8453,
    stable: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC' },
    wrappedNative: '0x4200000000000000000000000000000000000006',
    nativeMexcSymbol: 'ETHUSDT',
    kyberName: 'base',
    dexScreenerId: 'base',
    mexcNetwork: /^BASE$|^Base\b/i,
    tickMs: 1000, // 200 ms blocks: a timer, not block events
  },
  bsc: {
    name: 'bsc',
    chainId: 56,
    stable: { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT' }, // 18 decimals on BSC
    wrappedNative: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    nativeMexcSymbol: 'BNBUSDT',
    kyberName: 'bsc',
    dexScreenerId: 'bsc',
    mexcNetwork: /^BSC$|BEP20|BNB Smart Chain/i,
    tickMs: 1000,
  },
  arbitrum: {
    name: 'arbitrum',
    chainId: 42161,
    stable: { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC' }, // native USDC
    wrappedNative: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    nativeMexcSymbol: 'ETHUSDT',
    kyberName: 'arbitrum',
    dexScreenerId: 'arbitrum',
    mexcNetwork: /^ARB$|Arbitrum One|^ARBITRUM$/i,
    tickMs: 1000,
  },
};

export function chainProfile(name: string): ChainProfile {
  const c = CHAINS[name.toLowerCase() as ChainName];
  if (!c) throw new Error(`CHAIN must be one of ${Object.keys(CHAINS).join(', ')}`);
  return c;
}

/** The coin's MEXC network entry for this chain, if any. */
export function networkFor<N extends { network: string; netWork?: string }>(chain: ChainProfile, list: N[]): N | undefined {
  return list.find((n) => chain.mexcNetwork.test(n.netWork ?? '') || chain.mexcNetwork.test(n.network));
}
