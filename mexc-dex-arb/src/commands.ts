// Telegram command logic shared by both strategies (kept out of main.ts so it can be unit tested).
import type { Db } from './db.js';
import type { Risk } from './risk.js';
import { usd } from './util.js';

export interface ChainLike {
  readonly unresolved: { nonce: number; hashes: string[]; unknown?: boolean } | null;
  checkUnresolved(): Promise<{ state: 'clear' | 'pending' }>;
  resetNonce(): void;
}

/**
 * /start handler shared by both strategies: critical pauses need "/start confirm", and even then
 * the bot re-checks that nothing is still unresolved (pending DEX tx, executing trade) before resuming.
 */
export function startHandler(risk: Risk, statusText: () => Promise<string>, stillUnresolved: () => Promise<string | null>, explorer = 'etherscan.io') {
  return async (args: string[]) => {
    const confirm = args[0]?.toLowerCase() === 'confirm';
    if (risk.paused && risk.critical && !confirm) {
      return `⚠️ Critical pause: ${risk.pauseReason}\nCheck these positions and balances first:\n\n${await statusText()}\n\nThen send: /start confirm`;
    }
    if (risk.paused && risk.critical) {
      const open = await stillUnresolved();
      if (open) return `⛔ Not resuming: ${open}\nResolve it first (check ${explorer} / MEXC), then /start confirm again.`;
    }
    risk.resume(confirm);
    const block = risk.blockReason();
    return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
  };
}

/**
 * /resolve <trade id> <pnl>: book the real PnL of a trade that ended one-sided / unknown (after you fixed it by hand),
 * so the daily loss budget sees it.
 */
export function resolveTrade(db: Db, id: string | undefined, pnl: string | undefined): string {
  const n = Number(pnl);
  if (!id || pnl === undefined || !Number.isFinite(n)) return 'Usage: /resolve <trade id> <pnl in USD, e.g. -3.20>';
  const open = db.unresolvedTrades().find((t) => t.id === Number(id));
  if (!open) return `Trade #${id} is not waiting for a PnL.`;
  db.updateTrade(open.id, { pnl_usd: n, note: `${open.note ?? ''}; pnl set by hand: ${n}; pnl resolved` });
  return `Trade #${id}: PnL ${usd(n)} booked.`;
}

export function unresolvedLines(db: Db, chain: ChainLike): string[] {
  const out: string[] = [];
  const u = chain.unresolved;
  if (u) out.push(`⏳ DEX tx at nonce ${u.nonce} ${u.unknown ? 'UNKNOWN' : 'in flight'}: ${u.hashes.join(', ')} (/cancelnonce)`);
  const tickets = db.openTickets();
  if (tickets.length) out.push(`🎫 Rebalance tickets: ${tickets.map((k) => `#${k.id} ${k.direction}: ${k.amount.toFixed(4)} ${k.asset} (${k.token} ${k.side} low)`).join('; ')}`);
  const t = db.unresolvedTrades();
  if (t.length) out.push(`🧾 PnL unknown: ${t.map((r) => `#${r.id} ${r.symbol}`).join(', ')} -> /resolve <id> <pnl>`);
  return out;
}

/** What still blocks a critical resume, or null. */
export function makeUnresolvedCheck(db: Db, chain: ChainLike) {
  return async (): Promise<string | null> => {
    const u = await chain.checkUnresolved();
    if (u.state === 'pending') {
      return `DEX tx ${chain.unresolved?.hashes.join(' / ')} (nonce ${chain.unresolved?.nonce}): outcome still unknown; use /cancelnonce or wait`;
    }
    const ex = db.executingTrades();
    if (ex.length) return `${ex.length} trade(s) still marked executing (#${ex.map((t) => t.id).join(', #')})`;
    chain.resetNonce(); // clear: re-read the next nonce from the chain
    return null;
  };
}

