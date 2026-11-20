// MEXC symbol trading rules, taken from GET /api/v3/exchangeInfo, checked BEFORE either leg is sent.
// Field meanings (verified against live exchangeInfo, e.g. ETHUSDT: baseAssetPrecision 5, baseSizePrecision "0.0001"):
//   baseAssetPrecision   -> quantity decimals (step = 10^-n)
//   baseSizePrecision    -> MINIMUM order quantity ("0" = none)
//   quotePrecision       -> price decimals
//   quoteAmountPrecision -> minimum order value in USDT
//   maxQuoteAmount       -> maximum order value in USDT
//   orderTypes           -> allowed types (no MEXC spot symbol lists IMMEDIATE_OR_CANCEL; some have no MARKET)
//   tradeSideType        -> 1 all, 2 buy only, 3 sell only, 4 close only
import type { Side, SymbolInfo } from './rest.js';

export interface SymbolRules {
  qtyStep: number;
  priceDecimals: number;
  minQty: number;
  minNotional: number;
  maxNotional: number;
  orderTypes: string[];
  tradeSideType: number;
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
  };
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
  if (notional < r.minNotional) return `order value ${notional.toFixed(4)} < minimum ${r.minNotional} USDT`;
  if (notional > r.maxNotional) return `order value ${notional.toFixed(2)} > maximum ${r.maxNotional} USDT`;
  return null;
}
