// Startup recovery after a crash/restart in the middle of a trade.
import type { Db } from './db.js';
import type { Risk } from './risk.js';
import type { Order } from './mexc/rest.js';
import type { Notifier } from './engine.js';
import { cancelAndConfirm } from './engine.js';
import { errMsg } from './log.js';

const OPEN = new Set(['NEW', 'PARTIALLY_FILLED']);
const BOT_PREFIX = 'arb';

export interface RecoveryMexc {
  getOrderByClientId(symbol: string, cid: string): Promise<Order | null>;
  getOrder?(symbol: string, orderId: string): Promise<Order>;
  cancelOrder?(symbol: string, orderId: string): Promise<Order>;
  openOrders?(symbol: string): Promise<(Order & { clientOrderId?: string })[]>;
}

/**
 * Startup recovery (live mode, before anything trades):
 *  - every trade row still 'executing' (the bot died mid-trade): look up EVERY MEXC client id recorded on it
 *    (entry + closes). Orders still open are cancelled and settled. Both legs complete -> 'ok'
 *    (PnL not measured); anything else -> 'one_sided' with "pnl unknown" (book it later with /resolve).
 *  - open orders with the bot's client-id prefix on the watched symbols are cancelled and reported.
 *  - an unresolved DEX tx from before the restart (persisted) keeps the bot paused.
 * Anything not cleanly complete -> CRITICAL pause until a human sends /start confirm.
 */
export async function recoverExecuting(
  db: Db,
  risk: Risk,
  tg: Notifier,
  mexc: RecoveryMexc,
  receipt: (hash: string) => Promise<{ status: number | null } | null>,
  checkUnresolved?: () => Promise<{ state: 'clear' | 'pending' }>,
  opts: { symbols?: string[]; sleep?: (ms: number) => Promise<void> } = {},
) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lines: string[] = [];
  let incomplete = 0;

  const settle = async (symbol: string, o: Order): Promise<string> => {
    if (!OPEN.has(o.status) || !mexc.getOrder || !mexc.cancelOrder) return `${o.status}, filled ${o.executedQty}`;
    try {
      const f = await cancelAndConfirm({ getOrder: mexc.getOrder, cancelOrder: mexc.cancelOrder }, symbol, o.orderId, sleep);
      return `was open -> cancelled: ${f.status}, filled ${f.executedQty}`;
    } catch (e) {
      incomplete++;
      return `STILL OPEN (${errMsg(e)}): cancel it on MEXC by hand`;
    }
  };

  for (const r of db.executingTrades()) {
    const symbol = `${r.symbol}USDT`;
    const noteCid = /client order id (\S+?)(;|$)/.exec(r.note ?? '')?.[1];
    const cids = [...new Set([...(noteCid ? [noteCid] : []), ...db.cidsOf(r.id)])];
    const cexLines: string[] = [];
    let entryDone = false;
    for (const [i, cid] of cids.entries()) {
      try {
        const o = await mexc.getOrderByClientId(symbol, cid);
        if (!o) {
          cexLines.push(`MEXC ${cid}: never placed`);
          continue;
        }
        const state = await settle(symbol, o);
        cexLines.push(`MEXC ${cid} (order ${o.orderId}): ${state}`);
        if (i === 0) entryDone = o.status === 'FILLED' && Number(o.executedQty) >= r.qty * 0.999;
      } catch (e) {
        cexLines.push(`MEXC ${cid}: lookup failed (${errMsg(e)})`);
      }
    }
    let dex = 'DEX tx: none signed';
    let dexDone = false;
    if (r.dex_tx) {
      const rc = await receipt(r.dex_tx).catch(() => null);
      dex = rc ? `DEX tx ${r.dex_tx}: ${rc.status === 1 ? 'SUCCESS' : 'REVERTED'}` : `DEX tx ${r.dex_tx}: NOT MINED (may still be pending)`;
      dexDone = rc?.status === 1;
    }
    // Clean only if the entry filled, the swap succeeded and NO close/unwind order was involved.
    const complete = entryDone && dexDone && cids.length === 1;
    if (!complete) incomplete++;
    db.updateTrade(r.id, {
      status: complete ? 'ok' : 'one_sided',
      note: `${r.note ?? ''}; recovered at startup: ${cexLines.join(' | ')}; ${dex}; ${complete ? 'both legs done, PnL not measured' : 'pnl unknown'}`,
    });
    lines.push(`${complete ? '✅' : '⚠️'} #${r.id} ${r.symbol} ${r.direction} qty ${r.qty}\n  ${cexLines.join('\n  ') || 'MEXC: no client id recorded'}\n  ${dex}`);
  }

  // Orders the bot placed that are still resting on MEXC (e.g. a close placed right before a crash).
  if (mexc.openOrders && opts.symbols?.length) {
    for (const symbol of opts.symbols) {
      try {
        for (const o of await mexc.openOrders(symbol)) {
          if (!o.clientOrderId?.startsWith(BOT_PREFIX)) continue;
          lines.push(`⚠️ open bot order ${symbol} ${o.side} ${o.origQty} (cid ${o.clientOrderId}): ${await settle(symbol, o)}`);
          incomplete++;
        }
      } catch (e) {
        lines.push(`⚠️ could not list open orders for ${symbol}: ${errMsg(e)}`);
        incomplete++;
      }
    }
  }

  const pendingTx = checkUnresolved ? (await checkUnresolved().catch(() => ({ state: 'pending' as const }))).state === 'pending' : false;
  if (pendingTx) {
    incomplete++;
    lines.push('⚠️ A DEX tx sent before the restart is still unresolved (pending, not mined). Do NOT hedge by hand until it resolves.');
  }
  if (!lines.length) return;

  if (incomplete) risk.pause('bot restarted during a trade', true);
  await tg.send(
    `${incomplete ? '🚨' : 'ℹ️'} Bot restarted while trade(s) were running:\n${lines.join('\n')}\n` +
      (incomplete
        ? `Trading PAUSED. Check balances (/status), fix any open position by hand, book its PnL with /resolve <id> <pnl>, then /start confirm.`
        : `All legs completed; no action needed (PnL of these trades was not measured).`),
  );
}
