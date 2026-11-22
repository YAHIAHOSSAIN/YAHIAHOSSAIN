// Phase-1 KPIs from the `opportunities`, `trades` and `inventory_snapshots` tables.
// Answers "is this worth running?" with the bot's own data (daily Telegram summary and `npm run report`).
import type { Db } from './db.js';
import { usd } from './util.js';

const DHAKA_H = 6; // Asia/Dhaka = UTC+6

export interface Kpis {
  opportunitiesPerToken: { token: string; n: number; best_gross_bps: number | null }[];
  decisions: { decision: string; n: number }[];
  minutesAbove: { bps: number; minutes: number }[];
  histogram: { token: string; bucket: string; n: number }[];
  byHourDhaka: { hour: number; minutes_above_20: number }[];
  wouldHave: { hurdle_bps: number; trades: number; pnl: number }[];
  realizedMinusExpected: number | null;
  gasShareOfGross: number | null;
  oneSidedRate: number | null;
  inventorySkew: { token: string; wallet_share: number }[];
}

const BUCKETS = ['<0', '0-10', '10-20', '20-35', '35-50', '50+'];
const bucketSql = `CASE WHEN gross_bps < 0 THEN '<0' WHEN gross_bps < 10 THEN '0-10' WHEN gross_bps < 20 THEN '10-20'
  WHEN gross_bps < 35 THEN '20-35' WHEN gross_bps < 50 THEN '35-50' ELSE '50+' END`;

export function computeKpis(db: Db, sinceTs: number, mode: string): Kpis {
  const q = <T>(sql: string, ...a: unknown[]) => db.all<T>(sql, ...a);
  // DEX_ARB rows are detection-only (no DEX-DEX execution exists): they count
  // as "tokens seen" but never as tradeable gaps, so every opportunity query
  // below excludes them (direction IS NOT 'DEX_ARB' is NULL-safe, so legacy
  // rows without a direction still count). Their own stats live in
  // readDexArbStats (status server / remote snapshot).
  const opportunitiesPerToken = q<{ token: string; n: number; best_gross_bps: number | null }>(
    `SELECT token, COUNT(*) n, MAX(gross_bps) best_gross_bps FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' AND gross_bps IS NOT NULL GROUP BY token ORDER BY n DESC`,
    sinceTs,
  );
  const decisions = q<{ decision: string; n: number }>(`SELECT decision, COUNT(*) n FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' GROUP BY decision ORDER BY n DESC`, sinceTs);
  const minutesAbove = [20, 35, 50].map((bps) => ({
    bps,
    minutes: q<{ m: number }>(`SELECT COUNT(DISTINCT ts / 60000) m FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' AND gross_bps >= ?`, sinceTs, bps)[0]?.m ?? 0,
  }));
  const histogram = q<{ token: string; bucket: string; n: number }>(
    `SELECT token, ${bucketSql} bucket, COUNT(*) n FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' AND gross_bps IS NOT NULL GROUP BY token, bucket`,
    sinceTs,
  );
  const byHourDhaka = q<{ hour: number; minutes_above_20: number }>(
    `SELECT ((ts / 3600000) + ${DHAKA_H}) % 24 hour, COUNT(DISTINCT ts / 60000) minutes_above_20
     FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' AND gross_bps >= 20 GROUP BY hour ORDER BY hour`,
    sinceTs,
  );
  // Would-have PnL: at most one trade per token+direction per minute (the best net in that minute),
  // traded if its net (already after fee, gas, slippage and safety) beats the hurdle.
  // The hurdle uses the BEST row's own size: MAX(net) and MAX(size) from different rows would
  // make the hurdle stricter than the chosen trade's own (round-3 review, M4).
  const wouldHave = [20, 30, 40, 60].map((h) => {
    const r = q<{ trades: number; pnl: number | null }>(
      `SELECT COUNT(*) trades, SUM(best) pnl FROM (
         SELECT net_usd best, size_usd size FROM (
           SELECT net_usd, size_usd, ROW_NUMBER() OVER (
             PARTITION BY token, direction, ts / 60000 ORDER BY net_usd DESC, size_usd DESC
           ) rn FROM opportunities
           WHERE ts >= ? AND direction IS NOT 'DEX_ARB' AND net_usd IS NOT NULL AND size_usd > 0
         ) WHERE rn = 1
       ) WHERE best >= size * ? / 10000.0`,
      sinceTs,
      h,
    )[0];
    return { hurdle_bps: h, trades: r?.trades ?? 0, pnl: r?.pnl ?? 0 };
  });
  const t = q<{ n: number; diff: number | null; gas: number | null; gross: number | null; one_sided: number | null }>(
    `SELECT COUNT(*) n,
            AVG(CASE WHEN status IN ('ok','paper') THEN pnl_usd - expected_net END) diff,
            SUM(CASE WHEN status IN ('ok','paper') THEN gas_usd ELSE 0 END) gas,
            SUM(CASE WHEN status IN ('ok','paper') THEN pnl_usd + gas_usd + cex_fee_usd END) gross,
            SUM(CASE WHEN status = 'one_sided' THEN 1 ELSE 0 END) one_sided
     FROM trades WHERE ts >= ? AND mode = ? AND status != 'approval'`,
    sinceTs,
    mode,
  )[0];
  const inventorySkew = q<{ token: string; wallet_share: number }>(
    `SELECT token, wallet_usd / NULLIF(wallet_usd + mexc_usd, 0) wallet_share FROM inventory_snapshots s
     WHERE ts = (SELECT MAX(ts) FROM inventory_snapshots WHERE token = s.token)`,
  );
  return {
    opportunitiesPerToken,
    decisions,
    minutesAbove,
    histogram,
    byHourDhaka,
    wouldHave,
    realizedMinusExpected: t?.n ? t.diff : null,
    gasShareOfGross: t?.gross ? (t.gas ?? 0) / t.gross : null,
    oneSidedRate: t?.n ? (t.one_sided ?? 0) / t.n : null,
    inventorySkew,
  };
}

const bar = (n: number, max: number) => '█'.repeat(max > 0 ? Math.max(n > 0 ? 1 : 0, Math.round((n / max) * 12)) : 0);

export function formatKpis(k: Kpis): string {
  const lines: string[] = ['— Opportunities —'];
  if (!k.opportunitiesPerToken.length) lines.push('  none logged yet');
  for (const o of k.opportunitiesPerToken) lines.push(`  ${o.token}: ${o.n} quotes, best gross ${o.best_gross_bps?.toFixed(1) ?? '-'} bps`);
  lines.push(`  decisions: ${k.decisions.map((d) => `${d.decision} ${d.n}`).join(', ') || '-'}`);
  lines.push(`  minutes with gross gap ≥20/35/50 bps: ${k.minutesAbove.map((m) => m.minutes).join(' / ')}`);
  const tokens = [...new Set(k.histogram.map((h) => h.token))];
  if (tokens.length) lines.push('— Gross gap histogram (bps) —');
  for (const tok of tokens) {
    const rows = BUCKETS.map((b) => k.histogram.find((h) => h.token === tok && h.bucket === b)?.n ?? 0);
    const max = Math.max(...rows);
    lines.push(`  ${tok}: ${BUCKETS.map((b, i) => `${b}:${rows[i]}${bar(rows[i], max)}`).join(' ')}`);
  }
  if (k.byHourDhaka.length) {
    lines.push(`— Minutes ≥20 bps by hour (Dhaka) — ${k.byHourDhaka.map((h) => `${String(h.hour).padStart(2, '0')}h:${h.minutes_above_20}`).join(' ')}`);
  }
  lines.push(`— Would-have PnL — ${k.wouldHave.map((w) => `${w.hurdle_bps}bps: ${w.trades} trades ${usd(w.pnl)}`).join(' | ')}`);
  lines.push(
    `— Execution — realized−expected ${k.realizedMinusExpected === null ? '-' : usd(k.realizedMinusExpected)} per trade, ` +
      `gas share ${k.gasShareOfGross === null ? '-' : `${(k.gasShareOfGross * 100).toFixed(0)}%`}, ` +
      `one-sided ${k.oneSidedRate === null ? '-' : `${(k.oneSidedRate * 100).toFixed(0)}%`}`,
  );
  if (k.inventorySkew.length) {
    lines.push(`— Inventory (wallet share) — ${k.inventorySkew.map((s) => `${s.token} ${(s.wallet_share * 100).toFixed(0)}%`).join(', ')}`);
  }
  return lines.join('\n');
}

/** CSV of opportunities per token and Dhaka hour, for spreadsheets. */
export function opportunitiesCsv(db: Db, sinceTs: number): string {
  const rows = db.all<{ token: string; hour: number; n: number; max_gross_bps: number | null; minutes_above_20: number }>(
    `SELECT token, ((ts / 3600000) + ${DHAKA_H}) % 24 hour, COUNT(*) n, MAX(gross_bps) max_gross_bps,
            COUNT(DISTINCT CASE WHEN gross_bps >= 20 THEN ts / 60000 END) minutes_above_20
     FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' GROUP BY token, hour ORDER BY token, hour`,
    sinceTs,
  );
  return ['token,hour_dhaka,quotes,max_gross_bps,minutes_above_20', ...rows.map((r) => `${r.token},${r.hour},${r.n},${r.max_gross_bps ?? ''},${r.minutes_above_20}`)].join('\n');
}
