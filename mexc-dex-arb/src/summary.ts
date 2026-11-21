import type { Db } from './db.js';
import { usd } from './util.js';
import { computeKpis, formatKpis } from './kpi.js';

/** Text report for the last `hours` (used by the 23:00 summary and `npm run report`). */
export function formatReport(db: Db, mode: string, hours: number, title: string): string {
  const { total, bySymbol } = db.statsSince(Date.now() - hours * 3600_000, mode);
  const lines = [
    `${title} (${mode}, last ${hours}h)`,
    `Trades: ${total.trades} | Failed/one-sided: ${total.failed}`,
    `Net PnL: ${usd(total.pnl)} | Gas spent: ${usd(total.gas)} | MEXC fees: ${usd(total.fees)}`,
  ];
  if (bySymbol.length) {
    lines.push('Per token:');
    for (const s of bySymbol) {
      lines.push(`  ${s.pnl >= 0 ? '🟢' : '🔴'} ${s.symbol}: ${usd(s.pnl)} (${s.trades} trades, ${s.failed} failed, gas ${usd(s.gas)})`);
    }
  }
  try {
    lines.push(formatKpis(computeKpis(db, Date.now() - hours * 3600_000, mode)));
  } catch {
    // KPI tables missing in a very old database: the trade summary above still stands
  }
  return lines.join('\n');
}
