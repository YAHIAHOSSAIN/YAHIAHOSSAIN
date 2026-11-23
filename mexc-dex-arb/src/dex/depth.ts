// Pool-depth filter (Phase 1): rough gaps on thin DEX pools always fail the
// exact aggregator quote (net -$3 to -$13 on WKC/IDOL/DRV), so skip them
// before spending a quote. Pure functions, no I/O — see test/depth.test.ts.
//
// Fail-open rule: a pool with UNKNOWN liquidity (tvl 0 / no DexScreener data)
// is NOT a known-thin pool. passesDepth() itself fails it (liq < $100k), so
// callers must check `liq > 0` first and let the exact quote decide when
// there is no data; depthRejectReason() already encodes that (null = allow).

/** Minimum known pool liquidity for passesDepth(): $100k. */
export const MIN_DEPTH_LIQ_USD = 100_000;

/** Float slack for boundary comparisons: 350 into a $100k pool computes as
 * 0.7000000000000001%, which must still count as "exactly 0.7%". */
const EPS = 1e-9;

/**
 * Estimated price impact (%) of trading `sizeUsd` into a pool holding
 * `poolLiqUsd` of liquidity. Only half the pool sits on our side of the
 * trade, so the effective depth is poolLiqUsd / 2.
 */
export function estimatedImpact(sizeUsd: number, poolLiqUsd: number): number {
  return (sizeUsd / Math.max(poolLiqUsd / 2, 1)) * 100;
}

/**
 * True when the pool is deep enough for `sizeUsd` at `maxImpactPct`:
 * impact <= max AND pool liquidity >= $100k. A pool with no known liquidity
 * (0) FAILS here — callers must treat 0/unknown as fail-open themselves
 * (see depthRejectReason).
 */
export function passesDepth(sizeUsd: number, liq: number, maxImpactPct = 0.7): boolean {
  return liq >= MIN_DEPTH_LIQ_USD && estimatedImpact(sizeUsd, liq) <= maxImpactPct + EPS;
}

/**
 * Largest size whose estimated impact stays <= `maxImpactPct`:
 * size = maxImpactPct/100 * poolLiqUsd/2. (Used by Phase 2 sizing.)
 */
export function maxSafeSize(poolLiqUsd: number, maxImpactPct = 0.7): number {
  return (maxImpactPct / 100) * (poolLiqUsd / 2);
}

/**
 * Largest size passing BOTH depth checks (impact cap AND size-as-%-of-pool):
 * min(maxSafeSize, maxSizePct% of the pool). At the defaults (0.7% impact,
 * 1% size) the impact cap binds (0.35% of the pool); the size cap only binds
 * when the impact bps are raised above 200. (Phase 2 sizing.)
 */
export function depthSafeSize(poolLiqUsd: number, opts: { maxImpactPct?: number; maxSizePct?: number } = {}): number {
  const maxImpactPct = opts.maxImpactPct ?? 0.7;
  const maxSizePct = opts.maxSizePct ?? 1;
  return Math.min(maxSafeSize(poolLiqUsd, maxImpactPct), (maxSizePct / 100) * poolLiqUsd);
}

/**
 * Why a trade of `sizeUsd` into a pool of `liq` must be skipped, or null when
 * it may proceed. Returns null for unknown liquidity (liq <= 0): the caller
 * logs `depth-unknown` and lets the exact quote decide (fail-open).
 * Checks, in order: pool floor, estimated impact, size as % of the pool.
 */
export function depthRejectReason(
  sizeUsd: number,
  liq: number,
  opts: { maxImpactPct?: number; minLiqUsd?: number; maxSizePct?: number } = {},
): string | null {
  const maxImpactPct = opts.maxImpactPct ?? 0.7;
  const minLiqUsd = opts.minLiqUsd ?? MIN_DEPTH_LIQ_USD;
  const maxSizePct = opts.maxSizePct ?? 1;
  if (!(liq > 0)) return null; // unknown liquidity: fail-open
  if (liq < minLiqUsd) return `pool $${Math.round(liq / 1000)}k < $${Math.round(minLiqUsd / 1000)}k`;
  const impact = estimatedImpact(sizeUsd, liq);
  if (impact > maxImpactPct + EPS) return `impact ${impact.toFixed(2)}% > ${maxImpactPct.toFixed(2)}%`;
  if ((sizeUsd / liq) * 100 > maxSizePct + EPS) {
    return `size $${sizeUsd} is ${((sizeUsd / liq) * 100).toFixed(2)}% of pool $${Math.round(liq / 1000)}k > ${maxSizePct}%`;
  }
  return null;
}

/** One depth rejection, as collected during a tick (Phase 6 persistence). */
export interface DepthRejectDetail {
  token: string;
  liq_usd: number;
  impact_pct: number;
  reason: string;
}

/**
 * Top rejects for one tick's summary row: highest estimated impact first,
 * capped at `n` (default 10) so a 100-candidate tick never writes a huge
 * JSON blob. Pure function — see test/depth.test.ts.
 */
export function topDepthRejects(details: DepthRejectDetail[], n = 10): DepthRejectDetail[] {
  return [...details].sort((a, b) => b.impact_pct - a.impact_pct).slice(0, n);
}
