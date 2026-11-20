// Pure profit math. No I/O, so it is fully unit tested.
//
// net = sell value - buy value - MEXC taker fee - gas - slippage (both sides) - safety margin
// DEX fees are already inside the aggregator's buyAmount.
import type { Level } from './mexc/rest.js';
import { floorToStep } from './util.js';

export type Direction = 'DEX_BUY' | 'CEX_BUY';
// DEX_BUY: buy token on DEX with USDC, sell token on MEXC for USDT.
// CEX_BUY: buy token on MEXC with USDT, sell token on DEX for USDC.

export interface CostParams {
  takerFee: number; // 0.0005 = 0.05%
  cexSlippageBps: number;
  safetyMarginUsd: number;
}

export interface Opportunity {
  direction: Direction;
  sizeUsd: number; // USD put into the buy leg
  cexQty: number; // token quantity for the MEXC order
  cexLimitPrice: number; // worst acceptable MEXC price (book walk + slippage)
  dexTokens: number; // tokens bought (DEX_BUY) or sold (CEX_BUY) on the DEX
  buyPrice: number; // effective USD per token paid
  sellPrice: number; // effective USD per token received
  cexFeeUsd: number;
  gasUsd: number;
  slippageUsd: number;
  net: number;
}

/** Sell `qty` base into bids. */
export function fillBase(levels: Level[], qty: number): { quote: number; worst: number } | null {
  let left = qty;
  let quote = 0;
  let worst = 0;
  for (const [price, size] of levels) {
    if (left <= 1e-12) break;
    const take = Math.min(left, size);
    quote += take * price;
    worst = price;
    left -= take;
  }
  return left <= 1e-9 * Math.max(1, qty) ? { quote, worst } : null;
}

/** Spend `quoteAmount` on asks; returns base quantity bought. */
export function fillQuote(levels: Level[], quoteAmount: number): { qty: number; worst: number } | null {
  let left = quoteAmount;
  let qty = 0;
  let worst = 0;
  for (const [price, size] of levels) {
    if (left <= 1e-9) break;
    const cost = Math.min(left, size * price);
    qty += cost / price;
    worst = price;
    left -= cost;
  }
  return left <= 1e-6 ? { qty, worst } : null;
}

export function threshold(sizeUsd: number, minProfitUsd: number, minProfitPct: number): number {
  return Math.max(minProfitUsd, (sizeUsd * minProfitPct) / 100);
}

/**
 * DEX_BUY: we spent `sizeUsd` USDC on the DEX for `tokensOut` (floor `tokensMin`) and sell them on MEXC bids.
 */
export function evaluateDexBuy(p: {
  sizeUsd: number;
  tokensOut: number;
  tokensMin: number;
  bids: Level[];
  qtyStep: number;
  gasUsd: number;
  costs: CostParams;
}): Opportunity | null {
  const qty = floorToStep(p.tokensOut, p.qtyStep);
  if (qty <= 0) return null;
  const fill = fillBase(p.bids, qty);
  if (!fill) return null;
  const sellPrice = fill.quote / qty;
  const cexFeeUsd = fill.quote * p.costs.takerFee;
  const cexSlip = (fill.quote * p.costs.cexSlippageBps) / 10_000;
  const dexSlip = Math.max(0, p.tokensOut - p.tokensMin) * sellPrice;
  const slippageUsd = cexSlip + dexSlip;
  // Leftover dust (tokensOut - qty) stays in inventory; it is not counted as profit.
  const dustUsd = (p.tokensOut - qty) * sellPrice;
  const net = fill.quote - cexFeeUsd - (p.sizeUsd - dustUsd) - p.gasUsd - slippageUsd - p.costs.safetyMarginUsd;
  return {
    direction: 'DEX_BUY',
    sizeUsd: p.sizeUsd,
    cexQty: qty,
    cexLimitPrice: fill.worst * (1 - p.costs.cexSlippageBps / 10_000),
    dexTokens: p.tokensOut,
    buyPrice: p.sizeUsd / p.tokensOut,
    sellPrice,
    cexFeeUsd,
    gasUsd: p.gasUsd,
    slippageUsd,
    net,
  };
}

/**
 * CEX_BUY step 1: how many tokens `sizeUsd` USDT buys on MEXC asks.
 * MEXC charges the buy fee in the token, so we only sell qty * (1 - fee) on the DEX.
 */
export function planCexBuy(p: { sizeUsd: number; asks: Level[]; qtyStep: number; takerFee: number }) {
  const f = fillQuote(p.asks, p.sizeUsd);
  if (!f) return null;
  const qty = floorToStep(f.qty, p.qtyStep);
  if (qty <= 0) return null;
  const fill = fillBase(p.asks, qty);
  if (!fill) return null;
  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - p.takerFee) };
}

/** CEX_BUY plan for an exact quantity (used when re-checking a trade with a fresh book). */
export function planCexBuyQty(asks: Level[], qty: number, takerFee: number) {
  const fill = fillBase(asks, qty);
  if (!fill) return null;
  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - takerFee) };
}

/** CEX_BUY step 2: given the DEX quote for selling those tokens, compute net. */
export function evaluateCexBuy(p: {
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  usdcOut: number;
  usdcMin: number;
  gasUsd: number;
  costs: CostParams;
}): Opportunity {
  const { plan } = p;
  const buyPrice = plan.costUsd / plan.qty;
  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
  const cexSlip = (plan.costUsd * p.costs.cexSlippageBps) / 10_000;
  const dexSlip = Math.max(0, p.usdcOut - p.usdcMin);
  const slippageUsd = cexSlip + dexSlip;
  // cost already includes the token fee implicitly: we paid for qty but only sell qty*(1-fee).
  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - p.costs.safetyMarginUsd;
  return {
    direction: 'CEX_BUY',
    sizeUsd: plan.costUsd,
    cexQty: plan.qty,
    cexLimitPrice: plan.worst * (1 + p.costs.cexSlippageBps / 10_000),
    dexTokens: plan.tokensToSell,
    buyPrice,
    sellPrice: p.usdcOut / plan.tokensToSell,
    cexFeeUsd,
    gasUsd: p.gasUsd,
    slippageUsd,
    net,
  };
}

/** Gas cost in USD for `gasUnits` at `weiPerGas`. */
export function gasUsd(gasUnits: bigint, weiPerGas: bigint, ethUsd: number): number {
  return (Number(gasUnits * weiPerGas) / 1e18) * ethUsd;
}

/**
 * What to do after both legs ran. Returns the MEXC market order needed to get flat again (or null).
 * cexFilled is the MEXC executed quantity.
 */
export function unwindPlan(
  direction: Direction,
  dexOk: boolean,
  cexQty: number,
  cexFilled: number,
  takerFee: number,
  qtyStep: number,
): { side: 'BUY' | 'SELL'; qty: number; reason: string } | null {
  const mk = (side: 'BUY' | 'SELL', q: number, reason: string) => {
    const qty = floorToStep(q, qtyStep);
    return qty > 0 ? { side, qty, reason } : null;
  };
  if (direction === 'DEX_BUY') {
    // Wanted: +tokens in wallet (DEX), -tokens on MEXC (sell).
    if (!dexOk) return mk('BUY', cexFilled, 'DEX leg failed: buy back what was sold on MEXC');
    return mk('SELL', cexQty - cexFilled, 'MEXC sell only partly filled: sell the rest at market');
  }
  // CEX_BUY wanted: +tokens on MEXC (buy), -tokens in wallet (DEX sell).
  if (!dexOk) return mk('SELL', cexFilled * (1 - takerFee), 'DEX leg failed: sell what was bought on MEXC');
  return mk('BUY', cexQty - cexFilled, 'MEXC buy only partly filled: buy the rest at market');
}

/**
 * TRANSFER: buy on MEXC -> withdraw to wallet -> sell on DEX. Not atomic: the price can move
 * while the withdrawal is on its way, so `driftBps` of the sale value is reserved as extra risk cost.
 */
export function evaluateTransfer(p: {
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  withdrawFeeTokens: number; // MEXC withdraw fee, paid in the token
  usdcOut: number; // DEX quote for selling the tokens that arrive
  usdcMin: number;
  gasUsd: number; // approval + swap
  driftBps: number;
  costs: CostParams;
}) {
  const { plan } = p;
  const arriving = plan.tokensToSell - p.withdrawFeeTokens;
  const buyPrice = plan.costUsd / plan.qty;
  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
  const withdrawFeeUsd = p.withdrawFeeTokens * buyPrice;
  const slippageUsd = (plan.costUsd * p.costs.cexSlippageBps) / 10_000 + Math.max(0, p.usdcOut - p.usdcMin);
  const driftUsd = (p.usdcOut * p.driftBps) / 10_000;
  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - driftUsd - p.costs.safetyMarginUsd;
  return {
    arriving,
    buyPrice,
    sellPrice: arriving > 0 ? p.usdcOut / arriving : 0,
    cexFeeUsd,
    withdrawFeeUsd,
    slippageUsd,
    driftUsd,
    gasUsd: p.gasUsd,
    costUsd: plan.costUsd,
    net,
  };
}
