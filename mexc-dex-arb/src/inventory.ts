// Balances on both sides and rebalancing alerts. The bot never moves funds itself.
import type { Chain } from './dex/chain.js';
import type { MexcRest } from './mexc/rest.js';
import type { Token } from './watchlist.js';
import { toFloat } from './util.js';

export interface Balances {
  walletEth: number;
  walletUsdc: number;
  walletToken: Record<string, number>; // by token base symbol
  mexc: Record<string, number>; // free balance by asset
}

export async function snapshot(chain: Chain, mexc: MexcRest, usdc: string, tokens: Token[], total = false): Promise<Balances> {
  const [eth, usdcBal, mexcBal, ...toks] = await Promise.all([
    chain.ethBalance(),
    chain.tokenBalance(usdc),
    mexc.balances(total),
    ...tokens.map((t) => chain.tokenBalance(t.address)),
  ]);
  return {
    walletEth: toFloat(eth, 18),
    walletUsdc: toFloat(usdcBal, 6),
    walletToken: Object.fromEntries(tokens.map((t, i) => [t.base, toFloat(toks[i], t.decimals)])),
    mexc: mexcBal,
  };
}

/** Paper mode: unlimited fake balances, so only MAX_TRADE_USD limits the size. */
export function paperBalances(tokens: Token[]): Balances {
  const big = 1e12;
  return {
    walletEth: 1,
    walletUsdc: big,
    walletToken: Object.fromEntries(tokens.map((t) => [t.base, big])),
    mexc: { USDT: big, ...Object.fromEntries(tokens.map((t) => [t.base, big])) },
  };
}

/** USD value of the assets a trade in `token` can touch (used for exact PnL). */
export function portfolioUsd(b: Balances, token: Token, tokenUsd: number, ethUsd: number): number {
  return (
    b.walletUsdc +
    (b.mexc.USDT ?? 0) +
    ((b.walletToken[token.base] ?? 0) + (b.mexc[token.base] ?? 0)) * tokenUsd +
    b.walletEth * ethUsd
  );
}

/** Human-readable warnings for low or one-sided inventory. */
export function inventoryWarnings(
  b: Balances,
  tokens: Token[],
  prices: Record<string, number>,
  minTradeUsd: number,
  minEth: number,
): { key: string; text: string }[] {
  const w: { key: string; text: string }[] = [];
  if (b.walletEth < minEth) w.push({ key: 'eth', text: `Wallet ETH for gas is low: ${b.walletEth.toFixed(4)} ETH` });
  if (b.walletUsdc < minTradeUsd) w.push({ key: 'usdc', text: `Wallet USDC low: $${b.walletUsdc.toFixed(2)} (DEX buys blocked)` });
  if ((b.mexc.USDT ?? 0) < minTradeUsd) w.push({ key: 'usdt', text: `MEXC USDT low: $${(b.mexc.USDT ?? 0).toFixed(2)} (MEXC buys blocked)` });
  for (const t of tokens) {
    const p = prices[t.base];
    if (!p) continue;
    const wal = (b.walletToken[t.base] ?? 0) * p;
    const cex = (b.mexc[t.base] ?? 0) * p;
    if (wal < minTradeUsd) w.push({ key: `w-${t.base}`, text: `Wallet ${t.base} low: $${wal.toFixed(2)} (DEX sells blocked)` });
    if (cex < minTradeUsd) w.push({ key: `m-${t.base}`, text: `MEXC ${t.base} low: $${cex.toFixed(2)} (MEXC sells blocked)` });
    const total = wal + cex;
    if (total > 0 && Math.min(wal, cex) / total < 0.2 && total >= 2 * minTradeUsd) {
      w.push({
        key: `r-${t.base}`,
        text: `${t.base} needs rebalancing: wallet $${wal.toFixed(0)} / MEXC $${cex.toFixed(0)}`,
      });
    }
  }
  return w;
}
