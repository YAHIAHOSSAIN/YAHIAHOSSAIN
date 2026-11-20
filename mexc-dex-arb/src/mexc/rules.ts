// MEXC symbol trading rules, taken from GET /api/v3/exchangeInfo, checked BEFORE either leg is sent.
// Field meanings (verified against live exchangeInfo, e.g. ETHUSDT: baseAssetPrecision 5, baseSizePrecision "0.0001"):
//   baseAssetPrecision   -> quantity decimals (step = 10^-n)
//   baseSizePrecision    -> MINIMUM order quantity ("0" = none)
//   quotePrecision       -> price decimals
//   quoteAmountPrecision -> minimum order value in USDT
//   maxQuoteAmount       -> maximum order value in USDT
//   orderTypes           -> allowed types. The docs define IMMEDIATE_OR_CANCEL / FILL_OR_KILL as order types
//                           (there is no timeInForce parameter), but no live symbol lists them, and some
//                           have no MARKET. So closes use LIMIT + a confirmed cancel.
//   tradeSideType        -> 1 all, 2 buy only, 3 sell only, 4 close only
//   filters PERCENT_PRICE_BY_SIDE -> price band (live exchangeInfo only, not in the docs; 0.02 .. 0.5)
import type { Side, SymbolInfo } from './rest.js';

export interface SymbolRules {
  qtyStep: number;
  priceDecimals: number;
  minQty: number;
  minNotional: number;
  maxNotional: number;
  orderTypes: string[];
  tradeSideType: number;
  minNotionalMarket?: number;
  maxNotionalMarket?: number;
  /**
   * PERCENT_PRICE_BY_SIDE band (live exchangeInfo, not in the docs): a limit price more than this fraction
   * away from the market is rejected. Most symbols 0.2, some only 0.02.
   */
  priceBand?: number;
}

/** How far through the book an aggressive close may go: 2%, but stay well inside the symbol's price band. */
export function aggressiveOffset(r: SymbolRules): number {
  return r.priceBand ? Math.min(0.02, r.priceBand * 0.5) : 0.02;
}

export function rulesFrom(s: SymbolInfo): SymbolRules {
  const qtyDecimals = s.baseAssetPrecision ?? Math.max(0, Math.round(-Math.log10(Number(s.baseSizePrecision) || 1)));
  return {
    qtyStep: 1 / 10 ** qtyDecimals, // exact (10 ** -5 is 0.000009999…)
    priceDecimals: s.quotePrecision,
    minQty: Number(s.baseSizePrecision) || 0,
    minNotional: Number(s.quoteAmountPrecision) || 0,
    maxNotional: Number(s.maxQuoteAmount) || Number.POSITIVE_INFINITY,
    orderTypes: s.orderTypes ?? ['LIMIT'],
    tradeSideType: Number(s.tradeSideType ?? 1),
    minNotionalMarket: s.quoteAmountPrecisionMarket !== undefined ? Number(s.quoteAmountPrecisionMarket) : undefined,
    maxNotionalMarket: s.maxQuoteAmountMarket !== undefined ? Number(s.maxQuoteAmountMarket) : undefined,
    priceBand: band(s),
  };
}

function band(s: SymbolInfo): number | undefined {
  const f = s.filters?.find((x) => x.filterType === 'PERCENT_PRICE_BY_SIDE');
  if (!f) return undefined;
  const v = [Number(f.bidMultiplierUp), Number(f.askMultiplierDown)].filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? Math.min(...v) : undefined;
}

/** null = the order is allowed; otherwise why MEXC would reject it. */
export function orderProblem(r: SymbolRules, side: Side, qty: number, price: number, type = 'LIMIT'): string | null {
  if (!r.orderTypes.includes(type)) return `order type ${type} not allowed (${r.orderTypes.join(',')})`;
  if (r.tradeSideType === 4) return 'symbol is close-only';
  if (r.tradeSideType === 2 && side === 'SELL') return 'symbol is buy-only';
  if (r.tradeSideType === 3 && side === 'BUY') return 'symbol is sell-only';
  if (!(qty > 0)) return 'quantity is zero';
  if (qty < r.minQty) return `quantity ${qty} < minimum ${r.minQty}`;
  const notional = qty * price;
  // MARKET orders have their own limits in exchangeInfo.
  const min = type === 'MARKET' ? (r.minNotionalMarket ?? r.minNotional) : r.minNotional;
  const max = type === 'MARKET' ? (r.maxNotionalMarket ?? r.maxNotional) : r.maxNotional;
  if (notional < min) return `order value ${notional.toFixed(4)} < minimum ${min} USDT`;
  if (notional > max) return `order value ${notional.toFixed(2)} > maximum ${max} USDT`;
  return null;
}
