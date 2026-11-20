// Pricing for MEXC <-> Uniswap V2 arbitrage.
// DEX amounts are BigInt base units; CEX amounts are plain numbers (the API returns decimals).
import { parseUnits } from 'ethers';
import { getAmountOut } from './math.js';

/** Uniswap V2: input needed to receive exactly `amountOut` (rounds up, like the router). */
export function getAmountIn(amountOut, reserveIn, reserveOut) {
  if (amountOut <= 0n || amountOut >= reserveOut) return null;
  return (reserveIn * amountOut * 1000n) / ((reserveOut - amountOut) * 997n) + 1n;
}

/**
 * Walk order-book levels to fill `qty` of the base asset.
 * Returns { quote, worstPrice } or null if the book is too thin.
 */
export function fillFromBook(levels, qty) {
  let left = qty;
  let quote = 0;
  let worstPrice = 0;
  for (const [price, size] of levels) {
    const take = Math.min(left, size);
    quote += take * price;
    worstPrice = price;
    left -= take;
    if (left <= 1e-12) return { quote, worstPrice };
  }
  return null;
}

const toUnits = (x, decimals) => parseUnits(x.toFixed(8), decimals);

/**
 * Evaluate both directions for a trade of `size` ETH.
 * @param p.size         ETH amount (number)
 * @param p.book         MEXC depth { bids, asks }
 * @param p.reserveWeth  Uniswap WETH reserve (bigint, 18 decimals)
 * @param p.reserveUsd   Uniswap USDC reserve (bigint, `usdDecimals`)
 * @param p.usdDecimals  6 for USDC
 * @param p.takerFee     MEXC taker fee, e.g. 0.0005
 * @param p.gasUsd       cost of the DEX transaction in USD
 * @returns array of { direction, size, net, dexUsd, cexUsd, cexPrice, dexAmount }
 *   direction 'DEX_BUY'  = buy ETH on Uniswap (pay USDC), sell ETH on MEXC
 *   direction 'CEX_BUY'  = buy ETH on MEXC, sell WETH on Uniswap (get USDC)
 */
export function evaluate({ size, book, reserveWeth, reserveUsd, usdDecimals, takerFee, gasUsd }) {
  const out = [];
  const sizeWei = toUnits(size, 18);
  const usdScale = 10 ** usdDecimals;

  // 1) Buy on DEX, sell on CEX.
  const usdIn = getAmountIn(sizeWei, reserveUsd, reserveWeth);
  const sell = fillFromBook(book.bids, size);
  if (usdIn !== null && sell) {
    const dexUsd = Number(usdIn) / usdScale;
    const cexUsd = sell.quote * (1 - takerFee);
    out.push({ direction: 'DEX_BUY', size, net: cexUsd - dexUsd - gasUsd, dexUsd, cexUsd, cexPrice: sell.worstPrice, dexAmount: usdIn });
  }

  // 2) Buy on CEX, sell on DEX. MEXC takes the buy fee in ETH, so buy a bit more to end with `size`.
  const buyQty = size / (1 - takerFee);
  const buy = fillFromBook(book.asks, buyQty);
  const usdOut = getAmountOut(sizeWei, reserveWeth, reserveUsd);
  if (buy && usdOut > 0n) {
    const dexUsd = Number(usdOut) / usdScale;
    out.push({ direction: 'CEX_BUY', size, net: dexUsd - buy.quote - gasUsd, dexUsd, cexUsd: buy.quote, cexPrice: buy.worstPrice, dexAmount: usdOut, cexQty: buyQty });
  }
  return out;
}

/** Try sizes step, 2*step, ... maxSize and return the most profitable opportunity (or null). */
/** `directions` limits which sides are considered (e.g. ['DEX_BUY']). */
export function bestOpportunity({ maxSize, step, directions = ['DEX_BUY', 'CEX_BUY'], ...params }) {
  let best = null;
  const n = Math.floor(maxSize / step + 1e-9);
  for (let i = 1; i <= n; i++) {
    const size = Number((i * step).toFixed(8));
    for (const o of evaluate({ size, ...params })) {
      if (directions.includes(o.direction) && (!best || o.net > best.net)) best = o;
    }
  }
  return best && best.net > 0 ? best : null;
}
