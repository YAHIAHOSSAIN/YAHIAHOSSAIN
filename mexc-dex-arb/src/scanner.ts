// Continuously scans EVERY MEXC USDT pair whose coin is an Ethereum (ERC20) token,
// and finds tokens that are cheaper on MEXC than on Ethereum DEXs.
//
// Cheap first pass (2 + N/30 HTTP calls per scan):
//   MEXC bookTicker (all symbols, one call)  vs  DexScreener price (30 tokens per call)
// Only the biggest gaps then get an exact, size-specific aggregator quote (see transfer.ts).
import type { MexcRest } from './mexc/rest.js';
import { ethNetwork } from './watchlist.js';

export interface ScanToken {
  base: string;
  symbol: string;
  address: string; // lowercase, from MEXC's own deposit info -> same token as on-chain
  netWork: string; // MEXC network id for withdrawals
  withdrawFee: number; // tokens
  withdrawMin: number;
  qtyStep: number;
  priceDecimals: number;
  volumeUsd: number;
}

export interface Gap {
  token: ScanToken;
  ask: number; // MEXC best ask
  dexPrice: number; // DexScreener price of the deepest Ethereum pool
  tvlUsd: number;
  gapPct: number; // (dexPrice / ask - 1) * 100, positive = MEXC cheaper
}

const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH']);

/** All tradable MEXC/USDT ERC20 tokens with deposits AND withdrawals open and enough volume. */
export async function loadUniverse(
  mexc: Pick<MexcRest, 'exchangeInfo' | 'tickers24h' | 'coinConfigs'>,
  opts: { minVolumeUsd: number; only: string[] },
): Promise<ScanToken[]> {
  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
  const out: ScanToken[] = [];
  for (const s of symbols) {
    const base = s.baseAsset.toUpperCase();
    if (s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed || String(s.status) !== '1' || SKIP.has(base)) continue;
    if (opts.only.length && !opts.only.includes(base)) continue;
    const vol = volume.get(s.symbol) ?? 0;
    if (vol < opts.minVolumeUsd) continue;
    const coin = coinBy.get(base);
    const net = coin && ethNetwork(coin);
    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue;
    if (!net.depositEnable || !net.withdrawEnable) continue; // suspended -> skip
    out.push({
      base,
      symbol: s.symbol,
      address: net.contract.toLowerCase(),
      netWork: net.netWork ?? net.network,
      withdrawFee: Number(net.withdrawFee ?? 0),
      withdrawMin: Number(net.withdrawMin ?? 0),
      qtyStep: Number(s.baseSizePrecision) || 10 ** -(s.baseAssetPrecision ?? 2),
      priceDecimals: s.quotePrecision,
      volumeUsd: vol,
    });
  }
  return out;
}

type FetchFn = typeof fetch;

/** DexScreener prices for many tokens (30 per request). Uses each token's deepest Ethereum pool. */
export async function dexPrices(addresses: string[], fetchFn: FetchFn = fetch): Promise<Map<string, { price: number; tvl: number }>> {
  const out = new Map<string, { price: number; tvl: number }>();
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const res = await fetchFn(`https://api.dexscreener.com/tokens/v1/ethereum/${chunk.join(',')}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const pairs = (await res.json()) as { chainId: string; priceUsd?: string; liquidity?: { usd?: number }; baseToken: { address: string } }[];
    for (const p of pairs) {
      if (p.chainId !== 'ethereum' || !p.priceUsd) continue;
      const addr = p.baseToken.address.toLowerCase(); // priceUsd is the price of baseToken
      const tvl = p.liquidity?.usd ?? 0;
      if (!out.has(addr) || tvl > out.get(addr)!.tvl) out.set(addr, { price: Number(p.priceUsd), tvl });
    }
  }
  return out;
}

/** Tokens cheaper on MEXC than on DEX by at least minGapPct, biggest gap first. */
export function findGaps(
  tokens: ScanToken[],
  tickers: Map<string, { bid: number; ask: number }>,
  dex: Map<string, { price: number; tvl: number }>,
  opts: { minTvlUsd: number; minGapPct: number; maxGapPct?: number },
): Gap[] {
  const gaps: Gap[] = [];
  for (const token of tokens) {
    const t = tickers.get(token.symbol);
    const d = dex.get(token.address);
    if (!t || !d || t.ask <= 0 || d.price <= 0 || d.tvl < opts.minTvlUsd) continue;
    const gapPct = (d.price / t.ask - 1) * 100;
    // Huge gaps usually mean a different/broken token or a dead pool, not an opportunity.
    if (gapPct >= opts.minGapPct && gapPct < (opts.maxGapPct ?? 30)) gaps.push({ token, ask: t.ask, dexPrice: d.price, tvlUsd: d.tvl, gapPct });
  }
  return gaps.sort((a, b) => b.gapPct - a.gapPct);
}
