// Startup recovery after a crash/restart in the middle of a trade.
import type { Db } from './db.js';
import type { Risk } from './risk.js';
import type { MexcRest } from './mexc/rest.js';
import type { Notifier } from './engine.js';
import { errMsg } from './log.js';

/**
 * Startup recovery:
 *  - a trade row still 'executing' means the bot died mid-trade: look up the MEXC order (by our client id)
 *    and the DEX receipt. Both legs complete -> 'ok' (PnL could not be measured). Anything else -> 'one_sided'
 *    and a CRITICAL pause until a human sends /start confirm.
 *  - an unresolved DEX tx from before the restart (persisted) also keeps the bot in a critical pause.
 */
export async function recoverExecuting(
  db: Db,
  risk: Risk,
  tg: Notifier,
  mexc: Pick<MexcRest, 'getOrderByClientId'>,
  receipt: (hash: string) => Promise<{ status: number | null } | null>,
  checkUnresolved?: () => Promise<{ state: 'clear' | 'pending' }>,
) {
  const lines: string[] = [];
  let incomplete = 0;

  for (const r of db.executingTrades()) {
    const cid = /client order id (\S+?)(;|$)/.exec(r.note ?? '')?.[1];
    let cex = 'MEXC order: unknown';
    let cexDone = false;
    if (cid) {
      try {
        const o = await mexc.getOrderByClientId(`${r.symbol}USDT`, cid);
        cex = o ? `MEXC order ${o.orderId}: ${o.status}, filled ${o.executedQty}` : 'MEXC order: never placed';
        cexDone = Boolean(o && Number(o.executedQty) >= r.qty * 0.999 && o.status === 'FILLED');
      } catch (e) {
        cex = `MEXC lookup failed: ${errMsg(e)}`;
      }
    }
    let dex = 'DEX tx: none signed';
    let dexDone = false;
    if (r.dex_tx) {
      const rc = await receipt(r.dex_tx).catch(() => null);
      dex = rc ? `DEX tx ${r.dex_tx}: ${rc.status === 1 ? 'SUCCESS' : 'REVERTED'}` : `DEX tx ${r.dex_tx}: NOT MINED (may still be pending)`;
      dexDone = rc?.status === 1;
    }
    const complete = cexDone && dexDone;
    if (!complete) incomplete++;
    db.updateTrade(r.id, {
      status: complete ? 'ok' : 'one_sided',
      note: `${r.note ?? ''}; recovered at startup: ${cex}; ${dex}${complete ? '; both legs done, PnL not measured' : ''}`,
    });
    lines.push(`${complete ? '✅' : '⚠️'} #${r.id} ${r.symbol} ${r.direction} qty ${r.qty}\n  ${cex}\n  ${dex}`);
  }

  const pendingTx = checkUnresolved ? (await checkUnresolved().catch(() => ({ state: 'pending' as const }))).state === 'pending' : false;
  if (pendingTx) {
    incomplete++;
    lines.push('⚠️ A DEX tx sent before the restart is still unresolved (pending, not mined).');
  }
  if (!lines.length) return;

  if (incomplete) risk.pause('bot restarted during a trade', true);
  await tg.send(
    `${incomplete ? '🚨' : 'ℹ️'} Bot restarted while trade(s) were running:\n${lines.join('\n')}\n` +
      (incomplete
        ? `Trading PAUSED. Check balances (/status), fix any open position by hand, then /start confirm.`
        : `All legs completed; no action needed (PnL of these trades was not measured).`),
  );
}
