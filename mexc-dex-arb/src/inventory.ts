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

export async function snapshot(chain: Chain, mexc: MexcRest, usdc: string, tokens: Token[], total = false, stableDecimals = 6): Promise<Balances> {
  const [eth, usdcBal, mexcBal, ...toks] = await Promise.all([
    chain.ethBalance(),
    chain.tokenBalance(usdc),
    mexc.balances(total),
    ...tokens.map((t) => chain.tokenBalance(t.address)),
  ]);
  return {
    walletEth: toFloat(eth, 18),
    walletUsdc: toFloat(usdcBal, stableDecimals), // 6 for USDC, 18 for BSC USDT
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
export function portfolioUsd(b: Balances, token: Token, tokenUsd: number, ethUsd: number, stableInUsdt = 1): number {
  return (
    b.walletUsdc * stableInUsdt + // wallet stable (USDC) valued in USDT
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

export type PlanItem =
  | { kind: 'warning'; key: string; text: string }
  | { kind: 'side'; token: string; side: 'wallet' | 'mexc'; low: boolean; asset: string; amount: number; direction: string };

/**
 * Inventory sizing (phase 1, item 5):
 *  - target per token per side = INVENTORY_PER_SIDE_X x the trade size;
 *  - a side below LOW_X x the trade size is "low" (the engine turns a long-lasting low side into ONE ticket);
 *  - when a low side's deficit to target is bigger than what the other side holds, a shortfall
 *    warning is added: moving funds alone cannot cover it, fresh funds must be deposited;
 *  - token holdings above MAX_TOKEN_SHARE_PCT of the portfolio -> warning.
 * The bot never moves funds: tickets tell a human what to deposit or withdraw.
 */
export function inventoryPlan(
  b: Balances,
  tokens: Token[],
  prices: Record<string, number>,
  o: { tradeUsd: number; perSideX: number; maxTokenSharePct: number; stableInUsdt?: number; walletAddress?: string; stableSymbol?: string; lowX?: number },
): PlanItem[] {
  const out: PlanItem[] = [];
  const target = o.tradeUsd * o.perSideX;
  const lowX = o.lowX ?? 1;
  const lowAt = o.tradeUsd * lowX;
  // A low side whose deficit to target the other side cannot cover: warn that
  // moving funds alone will not fix it (a rebalance ticket would promise too much).
  const shortfall = (token: string, side: 'wallet' | 'mexc', have: number, other: number) => {
    const need = target - have;
    if (have < lowAt && need > other) {
      out.push({
        kind: 'warning',
        key: `shortfall-${token}-${side}`,
        text: `${token} ${side} needs $${need.toFixed(2)} more, but the other side only has $${other.toFixed(2)} — deposit fresh funds, moving alone will not cover it`,
      });
    }
  };
  const toWallet = `withdraw MEXC→wallet${o.walletAddress ? ` ${o.walletAddress}` : ''} (in the MEXC app)`;
  const toMexc = 'deposit wallet→MEXC';
  // The DEX-side stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC). The wallet side needs
  // that stable, not MEXC's USDT: withdrawing USDT to the wallet does not give it USDC, and
  // topping up MEXC from a USDC wallet needs a swap to USDT on MEXC (round-3 review, L2).
  const stable = o.stableSymbol;
  const toWalletStable = stable ? `withdraw ${stable} MEXC→wallet${o.walletAddress ? ` ${o.walletAddress}` : ''} (in the MEXC app)` : toWallet;
  const toMexcStable = stable && stable !== 'USDT' ? `deposit ${stable} wallet→MEXC (swap to USDT on MEXC)` : toMexc;
  let tokenUsd = 0;
  for (const t of tokens) {
    const px = prices[t.base];
    if (!px) continue;
    const w = (b.walletToken[t.base] ?? 0) * px;
    const m = (b.mexc[t.base] ?? 0) * px;
    tokenUsd += w + m;
    out.push({ kind: 'side', token: t.base, side: 'wallet', low: w < lowAt, asset: t.base, amount: Math.max(0, Math.min(target - w, m)) / px, direction: toWallet });
    out.push({ kind: 'side', token: t.base, side: 'mexc', low: m < lowAt, asset: t.base, amount: Math.max(0, Math.min(target - m, w)) / px, direction: toMexc });
    shortfall(t.base, 'wallet', w, m);
    shortfall(t.base, 'mexc', m, w);
  }
  const walletStable = b.walletUsdc * (o.stableInUsdt ?? 1);
  const mexcStable = b.mexc.USDT ?? 0;
  // Wallet-side amount is in stable units (USDT amount / the USDC-USDT rate); MEXC side is USDT.
  out.push({ kind: 'side', token: 'STABLE', side: 'wallet', low: walletStable < lowAt, asset: stable ?? 'USDC/USDT', amount: Math.max(0, Math.min(target - walletStable, mexcStable)) / (o.stableInUsdt ?? 1), direction: toWalletStable });
  out.push({ kind: 'side', token: 'STABLE', side: 'mexc', low: mexcStable < lowAt, asset: 'USDT', amount: Math.max(0, Math.min(target - mexcStable, walletStable)), direction: toMexcStable });
  shortfall('STABLE', 'wallet', walletStable, mexcStable);
  shortfall('STABLE', 'mexc', mexcStable, walletStable);

  const total = tokenUsd + walletStable + mexcStable;
  if (total > 0 && (tokenUsd / total) * 100 > o.maxTokenSharePct) {
    out.push({ kind: 'warning', key: 'token-share', text: `tokens are ${((tokenUsd / total) * 100).toFixed(0)}% of the portfolio (max ${o.maxTokenSharePct}%): token price moves now dominate PnL` });
  }
  return out;
}
