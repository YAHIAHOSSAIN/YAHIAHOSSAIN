// Uniswap V2 arbitrage math. All values are BigInt (token base units, e.g. wei).
// It matches FlashArbitrage.sol exactly, so the bot's estimate equals what the contract gets.

const FEE_NUM = 997n;
const FEE_DEN = 1000n;

/** Output of one Uniswap V2 swap, including the 0.3% fee. */
export function getAmountOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * FEE_NUM;
  return (amountInWithFee * reserveOut) / (reserveIn * FEE_DEN + amountInWithFee);
}

/**
 * Profit of one arbitrage loop, in tokenIn.
 * Pay `amountIn` tokenIn to the borrow pair, get tokenOut, sell that on the sell pair.
 * @param {bigint} amountIn
 * @param {{reserveIn: bigint, reserveOut: bigint}} borrow  reserves of the pair we buy on
 * @param {{reserveIn: bigint, reserveOut: bigint}} sell    reserves of the pair we sell on
 *        (`reserveIn`/`reserveOut` always means tokenIn/tokenOut reserves of that pair)
 */
export function arbProfit(amountIn, borrow, sell) {
  const borrowed = getAmountOut(amountIn, borrow.reserveIn, borrow.reserveOut);
  const received = getAmountOut(borrowed, sell.reserveOut, sell.reserveIn);
  return received - amountIn;
}

/**
 * Trade size that maximizes profit. Profit is concave in amountIn,
 * so a ternary search over integers finds the peak.
 * Returns { amountIn, profit }; profit <= 0 means there is no opportunity.
 */
export function findOptimalAmount(borrow, sell) {
  let lo = 1n;
  // Never trade more than the pool can absorb.
  let hi = borrow.reserveIn < sell.reserveIn ? borrow.reserveIn : sell.reserveIn;
  if (hi <= lo) return { amountIn: 0n, profit: 0n };

  while (hi - lo > 2n) {
    const third = (hi - lo) / 3n;
    const m1 = lo + third;
    const m2 = hi - third;
    if (arbProfit(m1, borrow, sell) < arbProfit(m2, borrow, sell)) lo = m1;
    else hi = m2;
  }

  let best = { amountIn: lo, profit: arbProfit(lo, borrow, sell) };
  for (let x = lo + 1n; x <= hi; x++) {
    const p = arbProfit(x, borrow, sell);
    if (p > best.profit) best = { amountIn: x, profit: p };
  }
  return best;
}

/** Pair reserves (r0, r1) as {reserveIn, reserveOut} for the given tokenIn side. */
export function orient(reserve0, reserve1, tokenInIsToken0) {
  return tokenInIsToken0
    ? { reserveIn: reserve0, reserveOut: reserve1 }
    : { reserveIn: reserve1, reserveOut: reserve0 };
}
