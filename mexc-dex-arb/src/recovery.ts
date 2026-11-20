// Startup recovery after a crash/restart in the middle of a trade.
import type { Db } from './db.js';
import type { Risk } from './risk.js';
import type { MexcRest } from './mexc/rest.js';
import type { Notifier } from './engine.js';
import { errMsg } from './log.js';

/**
 * Startup recovery: a trade row still 'executing' means the bot died mid-trade. Look up what happened,
 * report it, and stay PAUSED (critical) until a human sends /start confirm.
 */
export async function recoverExecuting(
  db: Db,
  risk: Risk,
  tg: Notifier,
  mexc: Pick<MexcRest, 'getOrderByClientId'>,
  receipt: (hash: string) => Promise<{ status: number | null } | null>,
) {
  const rows = db.executingTrades();
  if (!rows.length) return;
  const lines: string[] = [];
  for (const r of rows) {
    const cid = /client order id (\S+?)(;|$)/.exec(r.note ?? '')?.[1];
    let cex = 'MEXC order: unknown';
    if (cid) {
      try {
        const o = await mexc.getOrderByClientId(`${r.symbol}USDT`, cid);
        cex = o ? `MEXC order ${o.orderId}: ${o.status}, filled ${o.executedQty}` : 'MEXC order: never placed';
      } catch (e) {
        cex = `MEXC lookup failed: ${errMsg(e)}`;
      }
    }
    let dex = 'DEX tx: none signed';
    if (r.dex_tx) {
      const rc = await receipt(r.dex_tx).catch(() => null);
      dex = rc ? `DEX tx ${r.dex_tx}: ${rc.status === 1 ? 'SUCCESS' : 'REVERTED'}` : `DEX tx ${r.dex_tx}: NOT MINED (may still be pending)`;
    }
    db.updateTrade(r.id, { status: 'one_sided', note: `${r.note ?? ''}; recovered at startup: ${cex}; ${dex}` });
    lines.push(`#${r.id} ${r.symbol} ${r.direction} qty ${r.qty}\n  ${cex}\n  ${dex}`);
  }
  risk.pause('bot restarted during a trade', true);
  await tg.send(
    `🚨 Bot restarted while ${rows.length} trade(s) were running:\n${lines.join('\n')}\n` +
      `Trading PAUSED. Check balances (/status), fix any open position by hand, then /start confirm.`,
  );
}

