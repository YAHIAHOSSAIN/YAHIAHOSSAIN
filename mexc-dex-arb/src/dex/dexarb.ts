// DEX-DEX arbitrage DETECTION ONLY (Phase 4).
//
// BestOf already routes a SINGLE swap optimally, but a DEX-DEX arb is TWO
// separate swaps: buy the token cheap on one pool, sell it dear on another.
// Detection is legitimate: the best BUY quote (stable -> token) vs the best
// SELL quote (token -> stable, for the tokens the buy would deliver) for the
// same token amount. If sell proceeds > buy cost + 2x gas + fees, it is a
// real cross-pool spread.
//
// EXECUTION IS EXPLICITLY OUT OF SCOPE: this module never trades, sends,
// approves or opens a position. Prices can move between the two legs, which
// is why this phase only detects and logs. The live transfer engine
// (src/transfer.ts) is not touched by it.
import { gasUsd } from '../pricing.js';
import { depthSafeSize } from './depth.js';
import { errMsg, log } from '../log.js';
import { toFloat, toUnits } from '../util.js';
import type { Aggregator } from './aggregator.js';
import type { GasInfo } from './chain.js';
import type { Token } from '../watchlist.js';

export interface DexArbOpportunity {
  token: string;
  /** Stable spent on the buy leg, in USD (size x the stable/USDT rate). */
  sizeUsd: number;
  buyInUsd: number;
  tokensBought: number;
  sellOutUsd: number;
  /** Gas for BOTH legs together, in USD (2x the per-leg gas). */
  gasUsd: number;
  feesUsd: number;
  /** sellOut - buyIn - gas - fees. */
  netUsd: number;
  hurdleUsd: number;
  buySource?: string;
  sellSource?: string;
}

export interface DexArbInput {
  token: string;
  sizeUsd: number;
  buyInUsd: number;
  tokensBought: number;
  sellOutUsd: number;
  /** Gas cost of ONE leg, in USD (the two legs each pay it). */
  gasUsdPerLeg: number;
  feesUsd?: number;
  hurdleUsd: number;
  buySource?: string;
  sellSource?: string;
}

/** Pure net math for one buy+sell pair; always returns the result, even when it loses. */
export function evaluateDexArb(o: DexArbInput): DexArbOpportunity {
  const gas = 2 * o.gasUsdPerLeg;
  const fees = o.feesUsd ?? 0;
  return {
    token: o.token,
    sizeUsd: o.sizeUsd,
    buyInUsd: o.buyInUsd,
    tokensBought: o.tokensBought,
    sellOutUsd: o.sellOutUsd,
    gasUsd: gas,
    feesUsd: fees,
    netUsd: o.sellOutUsd - o.buyInUsd - gas - fees,
    hurdleUsd: o.hurdleUsd,
    buySource: o.buySource,
    sellSource: o.sellSource,
  };
}

/**
 * The same evaluation, hurdle-gated: null when the spread does not beat the
 * hurdle (no spread, or gas/fees eat it). Aggregator fees are already inside
 * the quoted output amounts, so feesUsd is 0 unless the caller adds one.
 */
export function dexArbOpportunity(o: DexArbInput): DexArbOpportunity | null {
  const r = evaluateDexArb(o);
  return r.netUsd > o.hurdleUsd ? r : null;
}

export interface DexArbScanOpts {
  stableAddress: string;
  stableDecimals?: number; // 6 for USDC, 18 for BSC USDT
  taker: string;
  slippageBps: number;
  minTradeUsd: number;
  /** Cap on the scanned size (the inventory MAX_TRADE_USD); default: no cap. */
  maxTradeUsd?: number;
  /** Profit hurdle, in USD — the caller reuses minProfitUsd (no second knob). */
  hurdleUsd: number | ((sizeUsd: number) => number);
  /** USDT per 1 DEX stable (USDC/USDT rate); default 1. */
  stableInUsdt?: number;
  /** OP-stack L1 data fee reserve per leg, in USD; default 0. */
  l1FeeUsd?: number;
  maxImpactPct?: number; // default 0.7
  maxSizePct?: number; // default 1
}

/**
 * Price both DEX legs for each token, sequentially (no extra parallelism in
 * this phase), at a size derived from the pool depth. A token is skipped when
 * its TVL is unknown (no depth to size from) or the depth-safe size is below
 * MIN_TRADE_USD. A BestOf failure on one token is logged and the scan
 * continues with the next token. Returns every evaluated opportunity
 * (including below-hurdle ones, so the caller can log them), sorted by net
 * descending. Detection only: no trade, no send, no approval.
 */
export async function scanDexArb(
  tokens: Token[],
  agg: Aggregator,
  gas: GasInfo,
  ethUsd: number,
  opts: DexArbScanOpts,
): Promise<DexArbOpportunity[]> {
  const out: DexArbOpportunity[] = [];
  const stableDec = opts.stableDecimals ?? 6;
  const rate = opts.stableInUsdt ?? 1;
  const l1 = opts.l1FeeUsd ?? 0;
  const hurdleFor = typeof opts.hurdleUsd === 'function' ? opts.hurdleUsd : () => opts.hurdleUsd as number;
  for (const t of tokens) {
    try {
      if (!(t.dexTvlUsd > 0)) continue; // unknown TVL: cannot size from depth
      const safe = depthSafeSize(t.dexTvlUsd, { maxImpactPct: opts.maxImpactPct ?? 0.7, maxSizePct: opts.maxSizePct ?? 1 });
      let size = Math.floor(safe + 1e-9); // whole dollars (same 1e-9 slack as the engine's depth sizing)
      if (size < opts.minTradeUsd) continue;
      if (opts.maxTradeUsd) size = Math.min(size, opts.maxTradeUsd);
      const buy = await agg.price({
        sellToken: opts.stableAddress,
        buyToken: t.address,
        sellAmount: toUnits(size, stableDec),
        taker: opts.taker,
        slippageBps: opts.slippageBps,
      });
      if (buy.buyAmount <= 0n) continue;
      // Sell exactly the tokens the buy leg would deliver.
      const sell = await agg.price({
        sellToken: t.address,
        buyToken: opts.stableAddress,
        sellAmount: buy.buyAmount,
        taker: opts.taker,
        slippageBps: opts.slippageBps,
      });
      const gasPerLeg =
        (gasUsd(buy.gas, gas.effective, ethUsd) + l1 + gasUsd(sell.gas, gas.effective, ethUsd) + l1) / 2;
      out.push(
        evaluateDexArb({
          token: t.base,
          sizeUsd: size,
          buyInUsd: size * rate,
          tokensBought: toFloat(buy.buyAmount, t.decimals),
          sellOutUsd: toFloat(sell.buyAmount, stableDec) * rate,
          gasUsdPerLeg: gasPerLeg,
          feesUsd: 0,
          hurdleUsd: hurdleFor(size),
          buySource: buy.source ?? agg.name,
          sellSource: sell.source ?? agg.name,
        }),
      );
    } catch (e) {
      log.warn(`dex-arb ${t.base}: ${errMsg(e)}`);
    }
  }
  return out.sort((a, b) => b.netUsd - a.netUsd);
}
