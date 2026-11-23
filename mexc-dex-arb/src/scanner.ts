// Continuously scans EVERY MEXC USDT pair whose coin is a token on the configured
// chain, and finds tokens that are cheaper on MEXC than on that chain's DEXs.
//
// Cheap first pass (2 + N/30 HTTP calls per scan):
//   MEXC bookTicker (all symbols, one call)  vs  DexScreener price (30 tokens per call)
// Only the biggest gaps then get an exact, size-specific aggregator quote (see transfer.ts).
import type { MexcRest } from './mexc/rest.js';
import { ethNetwork, isOnline } from './watchlist.js';
import { type ChainProfile, networkFor } from './chains.js';
import { type SymbolRules, rulesFrom } from './mexc/rules.js';
import { log, errMsg } from './log.js';

export interface ScanToken {
  base: string;
  symbol: string;
  address: string; // lowercase, from MEXC's own deposit info -> same token as on-chain
  netWork: string; // MEXC network id for withdrawals
  withdrawFee: number; // tokens
  withdrawMin: number;
  qtyStep: number;
  priceDecimals: number;
  rules: SymbolRules;
  volumeUsd: number;
}

export interface Gap {
  token: ScanToken;
  ask: number; // MEXC best ask
  dexPrice: number; // DexScreener price of the deepest pool on the chain
  tvlUsd: number;
  gapPct: number; // (dexPrice / ask - 1) * 100, positive = MEXC cheaper
}

const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH']);

/** Phase 9: max profit-winners pinned past the universe volume cut. Hardcoded:
 * the cap is a safety bound on universe size, not a tuning knob. */
export const MAX_PINNED_WINNERS = 10;

/** One token dropped at universe-build time by the pool-liquidity floor:
 * its symbol, its known pool TVL, and why it was dropped. Returned by
 * loadUniverse so the caller can record it through the same depth-rejects
 * path the engine uses (Grok v2 review / board audit M1: without this the
 * dashboard Depth section stays empty, because the drops only existed in
 * a log line). Unknown TVL (0) is never a drop — it is kept, fail-open. */
export interface UniverseDrop {
  base: string;
  tvl: number;
  reason: string;
}

/** All tradable MEXC/USDT ERC20 tokens with deposits AND withdrawals open and enough volume.
 * Sorted by MEXC 24h volume desc, so a `max` cap keeps the biggest tokens. With
 * `minDexVolumeUsd` set, tokens also need that much 24h DEX volume (DexScreener h24);
 * with `minPoolLiquidityUsd` set, tokens also need that much best-pool liquidity
 * (same DexScreener call, no extra request; tvl 0/unknown is kept, fail-open);
 * if the DexScreener lookup fails, the MEXC-filtered list is kept (fail-open, warned).
 * With `pin` set (Phase 9), tokens in the set that pass ALL the filters above
 * but fall below the `max` cut are appended after the top-`max` list (up to
 * MAX_PINNED_WINNERS) — a winner stays in the universe even if it slips out
 * of the top-100 by volume, as long as it still passes the base safety
 * filters. A pinned token that fails a filter is dropped like any token.
 * Returns the surviving tokens plus `dropped`: every token the
 * pool-liquidity floor removed (known TVL below the floor), so the caller
 * can record them as depth rejects — otherwise they vanish into a log
 * line and the dashboard Depth section never sees them. */
export async function loadUniverse(
  mexc: Pick<MexcRest, 'exchangeInfo' | 'tickers24h' | 'coinConfigs'>,
  opts: { minVolumeUsd: number; only: string[]; minDexVolumeUsd?: number; minPoolLiquidityUsd?: number; max?: number; chain?: ChainProfile; pin?: Set<string> },
  dexPricesFn: typeof dexPrices = dexPrices,
): Promise<{ tokens: ScanToken[]; dropped: UniverseDrop[] }> {
  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
  let out: ScanToken[] = [];
  for (const s of symbols) {
    const base = s.baseAsset.toUpperCase();
    if (s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed || !isOnline(s.status) || SKIP.has(base)) continue;
    if ((s.tradeSideType ?? 1) !== 1) continue; // transfer needs to buy and (for exits) sell
    if (opts.only.length && !opts.only.includes(base)) continue;
    const vol = volume.get(s.symbol) ?? 0;
    if (vol < opts.minVolumeUsd) continue;
    const coin = coinBy.get(base);
    // The token's contract on THIS chain (same pattern as buildWatchlist):
    // without opts.chain it falls back to the Ethereum entry.
    const net = coin && (opts.chain ? networkFor(opts.chain, coin.networkList) : ethNetwork(coin));
    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue;
    if (!net.depositEnable || !net.withdrawEnable) continue; // suspended -> skip
    out.push({
      base,
      symbol: s.symbol,
      address: net.contract.toLowerCase(),
      netWork: net.netWork ?? net.network,
      withdrawFee: Number(net.withdrawFee ?? 0),
      withdrawMin: Number(net.withdrawMin ?? 0),
      qtyStep: rulesFrom(s).qtyStep,
      priceDecimals: s.quotePrecision,
      rules: rulesFrom(s),
      volumeUsd: vol,
    });
  }
  // Best MEXC volume first, so a cap keeps the biggest tokens.
  out.sort((a, b) => b.volumeUsd - a.volumeUsd);
  const minDexVol = opts.minDexVolumeUsd ?? 0;
  const minPoolLiq = opts.minPoolLiquidityUsd ?? 0;
  const dropped: UniverseDrop[] = [];
  if ((minDexVol > 0 || minPoolLiq > 0) && out.length) {
    try {
      // One DexScreener call serves both filters: it already returns the
      // best pool's tvl per address (no second API call).
      const vols = await dexPricesFn(out.map((t) => t.address));
      if (minDexVol > 0) {
        const before = out.length;
        out = out.filter((t) => (vols.get(t.address)?.vol24h ?? 0) >= minDexVol);
        log.info(`loadUniverse: DEX 24h volume >= $${minDexVol} keeps ${out.length}/${before} tokens`);
      }
      if (minPoolLiq > 0) {
        const before = out.length;
        // tvl 0 / no entry = no DexScreener data, not a known-thin pool:
        // keep it (fail-open); the depth filter in tick() and the exact
        // quote decide later. Only a KNOWN tvl below the floor drops — and
        // every such drop is returned (see `dropped`), so the caller can
        // record it as a depth reject instead of losing it in this log.
        out = out.filter((t) => {
          const tvl = vols.get(t.address)?.tvl ?? 0;
          if (tvl !== 0 && tvl < minPoolLiq) {
            dropped.push({ base: t.base, tvl, reason: `pool $${Math.round(tvl / 1000)}k < $${Math.round(minPoolLiq / 1000)}k` });
            return false;
          }
          return true;
        });
        log.info(`loadUniverse: pool liquidity >= $${minPoolLiq} keeps ${out.length}/${before} tokens`);
      }
    } catch (e) {
      // DexScreener down: keep the MEXC-filtered list rather than scanning nothing.
      log.warn(`loadUniverse: DEX check failed (${errMsg(e)}), keeping ${out.length} tokens without the DEX filter`);
    }
  }
  const max = opts.max ?? 0;
  if (opts.pin?.size && max > 0) {
    // Phase 9: the top-`max` list is unchanged (a winner inside it keeps its
    // volume rank); winners from below the cut are appended, best volume
    // first, capped so the universe cannot bloat. Every appended token
    // already passed the filters above.
    const extra = out.slice(max).filter((t) => opts.pin!.has(t.base)).slice(0, MAX_PINNED_WINNERS);
    if (extra.length) log.info(`loadUniverse: pinning ${extra.length} winner(s) past the top-${max} cut: ${extra.map((t) => t.base).join(', ')}`);
    return { tokens: [...out.slice(0, max), ...extra], dropped };
  }
  return { tokens: max ? out.slice(0, max) : out, dropped };
}

type FetchFn = typeof fetch;

/** DexScreener prices for many tokens (30 per request). Uses each token's deepest pool on the given chain. vol24h is the token's max 24h DEX volume across its pairs. */
export async function dexPrices(addresses: string[], fetchFn: FetchFn = fetch, dexScreenerChain = 'ethereum'): Promise<Map<string, { price: number; tvl: number; vol24h: number }>> {
  const out = new Map<string, { price: number; tvl: number; vol24h: number }>();
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const res = await fetchFn(`https://api.dexscreener.com/tokens/v1/${dexScreenerChain}/${chunk.join(',')}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const pairs = (await res.json()) as { chainId: string; priceUsd?: string; liquidity?: { usd?: number }; volume?: { h24?: number }; baseToken: { address: string } }[];
    for (const p of pairs) {
      if (p.chainId !== dexScreenerChain || !p.priceUsd) continue;
      const addr = p.baseToken.address.toLowerCase(); // priceUsd is the price of baseToken
      const tvl = p.liquidity?.usd ?? 0;
      const cur = out.get(addr);
      const vol24h = Math.max(cur?.vol24h ?? 0, p.volume?.h24 ?? 0);
      if (!cur || tvl > cur.tvl) out.set(addr, { price: Number(p.priceUsd), tvl, vol24h });
      else out.set(addr, { ...cur, vol24h });
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
