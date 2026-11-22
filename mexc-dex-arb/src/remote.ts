// Pairing-code multi-user dashboard (2026-11-23) — bot side.
//
// Every bot instance (one per chain) owns a long random pairing code,
// stored in its own DB `state` table under `pairing:code` — never in .env,
// never in git. The owner enters the code on arb.alphahelper.online and
// sees THAT bot's live status. The bot pushes a small public-safe snapshot
// to the central receiver (POST /api/ingest) every INGEST_INTERVAL_SEC.
//
// The snapshot is allowlist-by-construction: only the fields below are ever
// built, and the receiver sanitizes again before storing. No wallet address,
// no tx hash, no CEX order id, no key, no token ever leaves the bot.
import { randomBytes, createHash } from 'node:crypto';
import type { Db } from './db.js';
import { dhakaDay } from './util.js';

export const PAIRING_CODE_KEY = 'pairing:code';
export const SNAPSHOT_SCHEMA = 1;

/** 24 chars, unguessable (144 bits of entropy), URL-safe. */
export function generatePairingCode(): string {
  return randomBytes(18).toString('base64url');
}

export const PAIRING_CODE_RE = /^[A-Za-z0-9_-]{24}$/;

export function isValidPairingCode(code: unknown): code is string {
  return typeof code === 'string' && PAIRING_CODE_RE.test(code);
}

/** Read the bot's code, generating + storing one on first use. */
export function getOrCreatePairingCode(db: Db): { code: string; isNew: boolean } {
  const existing = db.getState(PAIRING_CODE_KEY);
  if (existing && isValidPairingCode(existing)) return { code: existing, isNew: false };
  const code = generatePairingCode();
  db.setState(PAIRING_CODE_KEY, code);
  return { code, isNew: true };
}

/** sha256 of a code (the receiver stores only the hash, never the code). */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ---------- snapshot ----------

export interface RemoteSnapshotCtx {
  chain: string;
  mode: string;
  strategy: string;
  maxTradeUsd: number;
  aggregators: string[];
  dexArbEnabled: boolean;
  minPoolLiquidityUsd: number;
  depthMaxImpactBps: number;
  /** Bot version string (package.json), e.g. '1.0.0'. */
  version: string;
  /** Seconds since this process started. */
  uptimeSec: number;
  /** ms timestamp of the last scan tick (0 = never). */
  lastScanTs: number;
  /** Balances for the snapshot (public-safe numbers only). */
  mexcUsdt: number | null;
  walletNative: number | null;
  walletUsdc: number | null;
  nativeSymbol: string;
}

export interface RemoteSnapshot {
  schema: number;
  chain: string;
  mode: string;
  version: string;
  uptimeSec: number;
  lastScanTs: number;
  pm2: { state: string };
  maxTradeUsd: number;
  hero: { trades: number; pnl: number; gas: number; fees: number; wins: number; bestToken: string | null; bestTokenPnl: number };
  today: { day: string; trades: number; pnl: number; gas: number; fees: number; wins: number; losses: number };
  week7d: { trades: number; pnl: number };
  perToken: { symbol: string; trades: number; pnl: number; wins: number }[];
  daily: { day: string; trades: number; pnl: number; gas: number; fees: number }[];
  recent: {
    ts: number; day: string; time: string; symbol: string; direction: string;
    size: number; buy: number | null; sell: number | null; expected: number | null;
    booked: number | null; gas: number; fees: number; pnl: number;
    aggregator: string | null; poolTvl: number | null; safeSize: number | null;
    status: string; note: string | null;
  }[];
  transfers: { ts: number; day: string; time: string; base: string; status: string; note: string | null; pnl: number | null; usdc_out: number | null; recycle_status: string | null; recycled_usdt: number | null }[];
  inventory: { token: string; wallet_usd: number; mexc_usd: number }[];
  winners: { symbol: string; trades: number; pnl: number; wins: number }[];
  gaps: {
    buckets: { lt30: number; b30_50: number; b50_100: number; b100_200: number; b200_300: number; b300p: number; total: number };
    bestBps: number | null; bestNet: number | null;
    hourly: { hr: number; bestBps: number; bestNet: number | null; n: number }[];
  };
  config: { aggregators: string[]; dexArbEnabled: boolean; minPoolLiquidityUsd: number; depthMaxImpactBps: number; strategy: string };
  depthRejects: { available: boolean; total: number; rows: number; tokens: { token: string; count: number; topReason: string; maxImpactPct: number; maxLiqUsd: number }[] };
  dexArb: { count: number; bestNet: number | null; tradeDecisions: number };
  balances: { mexcUsdt: number | null; walletNative: number | null; walletUsdc: number | null; nativeSymbol: string };
  openTransfers: number;
  stuckTransfers: number;
  /** Distinct tokens with a recorded gap in the last hour (L4); null when the DB has no opportunities table. */
  tokensLastHour: number | null;
}

const BN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dhakaDayShort(ts: number): string {
  const d = new Date(ts + 6 * 3600 * 1000);
  return `${d.getUTCDate()} ${BN_MONTHS[d.getUTCMonth()]}`;
}
function dhakaTime(ts: number): string {
  return new Date(ts + 6 * 3600 * 1000).toISOString().slice(11, 16);
}

const FINISHED = `status NOT IN ('executing','approval','paper')`;
const num = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/**
 * Build the public-safe snapshot from the bot's own DB. Only finished live
 * trades are read, and only allowlisted columns — dex_tx, cex_order_id and
 * transfers.address are never selected, so they cannot leak even by accident.
 */
export function buildSnapshot(db: Db, ctx: RemoteSnapshotCtx): RemoteSnapshot {
  const now = Date.now();
  const today = dhakaDay(now);
  const day7Ago = now - 7 * 24 * 3600 * 1000;

  // Same finished-trade filter as the dashboard's readTradeStats: in-flight
  // ('executing'/'approval') rows never count, their PnL is 0 anyway.
  const heroRow = db.all<{ c: number; pnl: number; gas: number; fees: number; wins: number }>(
    `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
            COALESCE(SUM(cex_fee_usd),0) fees,
            SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins
     FROM trades WHERE mode = 'live' AND ${FINISHED}`,
  )[0] ?? { c: 0, pnl: 0, gas: 0, fees: 0, wins: 0 };
  const todayRow = db.all<{ c: number; pnl: number; gas: number; fees: number; wins: number; losses: number }>(
    `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
            COALESCE(SUM(cex_fee_usd),0) fees,
            SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins,
            SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) losses
     FROM trades WHERE day = ? AND mode = 'live' AND ${FINISHED}`,
    today,
  )[0] ?? { c: 0, pnl: 0, gas: 0, fees: 0, wins: 0, losses: 0 };
  const weekRow = db.all<{ c: number; pnl: number }>(
    `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl
     FROM trades WHERE ts >= ? AND mode = 'live' AND ${FINISHED}`,
    day7Ago,
  )[0] ?? { c: 0, pnl: 0 };
  const tokenStats = db.liveTokenStats();
  const best = [...tokenStats].sort((a, b) => b.pnl - a.pnl)[0];
  const winners = tokenStats.filter((r) => r.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 10)
    .map((r) => ({ symbol: r.symbol, trades: r.trades, pnl: r.pnl, wins: r.wins }));

  const perToken = db.all<{ symbol: string; trades: number; pnl: number; wins: number }>(
    `SELECT symbol, COUNT(*) trades, COALESCE(SUM(pnl_usd),0) pnl,
            SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins
     FROM trades WHERE day = ? AND mode = 'live' AND ${FINISHED}
     GROUP BY symbol ORDER BY pnl DESC`,
    today,
  ).map((r) => ({ symbol: r.symbol, trades: r.trades, pnl: num(r.pnl), wins: r.wins || 0 }));
  const daily = db.all<{ day: string; trades: number; pnl: number; gas: number; fees: number }>(
    `SELECT day, COUNT(*) trades, COALESCE(SUM(pnl_usd),0) pnl,
            COALESCE(SUM(gas_usd),0) gas, COALESCE(SUM(cex_fee_usd),0) fees
     FROM trades WHERE ts >= ? AND mode = 'live' AND ${FINISHED}
     GROUP BY day ORDER BY day`,
    day7Ago,
  ).map((r) => ({ day: r.day, trades: r.trades, pnl: num(r.pnl), gas: num(r.gas), fees: num(r.fees) }));
  const recent = db.all<{
    ts: number; symbol: string; direction: string; size_usd: number; qty: number;
    buy_price: number | null; sell_price: number | null; expected_net: number | null;
    requoted_net: number | null; gas_usd: number; cex_fee_usd: number; pnl_usd: number;
    status: string; note: string | null; aggregator: string | null;
    pool_tvl_usd: number | null; safe_size_usd: number | null;
  }>(
    `SELECT ts, symbol, direction, size_usd, qty, buy_price, sell_price,
            expected_net, requoted_net, gas_usd, cex_fee_usd, pnl_usd, status, note,
            aggregator, pool_tvl_usd, safe_size_usd
     FROM trades WHERE mode = 'live' AND ${FINISHED} ORDER BY ts DESC LIMIT 12`,
  ).map((r) => ({
    ts: r.ts, day: dhakaDayShort(r.ts), time: dhakaTime(r.ts), symbol: r.symbol, direction: r.direction,
    size: Math.round(num(r.size_usd)), buy: r.buy_price, sell: r.sell_price,
    // L1: live transfer mode never re-quotes — Booked is the sell-price PnL,
    // so a null requoted_net falls back to pnl (paper keeps null = "—").
    expected: r.expected_net, booked: r.requoted_net ?? (ctx.mode === 'live' ? r.pnl_usd : null),
    gas: num(r.gas_usd), fees: num(r.cex_fee_usd), pnl: Number(num(r.pnl_usd).toFixed(2)),
    aggregator: r.aggregator ?? null, poolTvl: r.pool_tvl_usd ?? null, safeSize: r.safe_size_usd ?? null,
    status: r.status, note: r.note,
  }));
  // L5: recycle outcome per transfer. Only the public-safe columns are ever
  // selected — recycle_tx / recycle_address / sell_tx stay in the DB (the
  // Db constructor runs TRANSFER_MIGRATIONS, so these columns always exist
  // on a bot-opened DB; no PRAGMA guard needed here, unlike the readonly
  // status server). usdc_out was already sent.
  const transfers = db.all<{ ts: number; base: string; status: string; note: string | null; pnl: number | null; usdc_out: number | null; recycle_status: string | null; recycled_usdt: number | null }>(
    `SELECT ts, base, status, note, pnl, usdc_out, recycle_status, recycled_usdt FROM transfers ORDER BY ts DESC LIMIT 5`,
  ).map((r) => ({ ts: r.ts, day: dhakaDayShort(r.ts), time: dhakaTime(r.ts), base: r.base, status: r.status, note: r.note, pnl: r.pnl, usdc_out: r.usdc_out, recycle_status: r.recycle_status ?? null, recycled_usdt: r.recycled_usdt ?? null }));
  let inventory: { token: string; wallet_usd: number; mexc_usd: number }[] = [];
  try {
    inventory = db.all<{ token: string; wallet_usd: number; mexc_usd: number }>(
      `SELECT token, wallet_usd, mexc_usd FROM inventory_snapshots s
       WHERE ts = (SELECT MAX(ts) FROM inventory_snapshots WHERE token = s.token)
       ORDER BY token`,
    ).map((r) => ({ token: r.token, wallet_usd: num(r.wallet_usd), mexc_usd: num(r.mexc_usd) }));
  } catch { inventory = []; }
  // Gap stats (last 24h). Transfer mode writes almost no opportunity rows,
  // so this is usually total 0 / null best — the dashboard shows its warning.
  let gaps: RemoteSnapshot['gaps'] = {
    buckets: { lt30: 0, b30_50: 0, b50_100: 0, b100_200: 0, b200_300: 0, b300p: 0, total: 0 },
    bestBps: null, bestNet: null, hourly: [],
  };
  try {
    const b = db.all<{ lt30: number; b30_50: number; b50_100: number; b100_200: number; b200_300: number; b300p: number; total: number; maxBps: number | null; maxNet: number | null }>(
      `SELECT
         SUM(CASE WHEN gross_bps < 30 THEN 1 ELSE 0 END) lt30,
         SUM(CASE WHEN gross_bps >= 30 AND gross_bps < 50 THEN 1 ELSE 0 END) b30_50,
         SUM(CASE WHEN gross_bps >= 50 AND gross_bps < 100 THEN 1 ELSE 0 END) b50_100,
         SUM(CASE WHEN gross_bps >= 100 AND gross_bps < 200 THEN 1 ELSE 0 END) b100_200,
         SUM(CASE WHEN gross_bps >= 200 AND gross_bps < 300 THEN 1 ELSE 0 END) b200_300,
         SUM(CASE WHEN gross_bps >= 300 THEN 1 ELSE 0 END) b300p,
         COUNT(*) total,
         MAX(CASE WHEN decision != 'rule' THEN gross_bps END) maxBps,
         MAX(CASE WHEN decision != 'rule' THEN net_usd END) maxNet
       FROM opportunities WHERE ts >= ?`,
      now - 24 * 3600 * 1000,
    )[0];
    const hourly = db.all<{ hr: number; bestBps: number; bestNet: number | null; n: number }>(
      `SELECT CAST(strftime('%H', ts/1000, 'unixepoch', '+6 hours') AS INTEGER) hr,
              MAX(gross_bps) bestBps, MAX(net_usd) bestNet, COUNT(*) n
       FROM opportunities WHERE ts >= ? AND decision != 'rule' GROUP BY hr ORDER BY hr`,
      now - 24 * 3600 * 1000,
    );
    if (b) {
      gaps = {
        buckets: {
          lt30: b.lt30 || 0, b30_50: b.b30_50 || 0, b50_100: b.b50_100 || 0,
          b100_200: b.b100_200 || 0, b200_300: b.b200_300 || 0, b300p: b.b300p || 0,
          total: b.total || 0,
        },
        bestBps: b.maxBps ?? null, bestNet: b.maxNet ?? null,
        hourly: hourly.map((h) => ({ hr: h.hr, bestBps: h.bestBps, bestNet: h.bestNet, n: h.n })),
      };
    }
  } catch { /* old DB without opportunities: gaps stay empty */ }
  // Depth-filter rejections (last 24h), same aggregation as the dashboard.
  let depthRejects: RemoteSnapshot['depthRejects'] = { available: false, total: 0, rows: 0, tokens: [] };
  try {
    const rows = db.all<{ total: number; detail: string }>(
      'SELECT total, detail FROM depth_rejects WHERE ts >= ?', now - 24 * 3600 * 1000,
    );
    let total = 0;
    const byToken = new Map<string, { token: string; count: number; reasons: Map<string, number>; maxImpactPct: number; maxLiqUsd: number }>();
    for (const r of rows) {
      total += r.total || 0;
      let detail: { token?: string; reason?: string; impact_pct?: number; liq_usd?: number }[] = [];
      try { detail = JSON.parse(r.detail || '[]'); } catch { detail = []; }
      for (const d of detail) {
        if (!d || !d.token) continue;
        const e = byToken.get(d.token) || { token: d.token, count: 0, reasons: new Map(), maxImpactPct: 0, maxLiqUsd: 0 };
        e.count++;
        const reason = d.reason || '—';
        e.reasons.set(reason, (e.reasons.get(reason) || 0) + 1);
        if (typeof d.impact_pct === 'number') e.maxImpactPct = Math.max(e.maxImpactPct, d.impact_pct);
        if (typeof d.liq_usd === 'number') e.maxLiqUsd = Math.max(e.maxLiqUsd, d.liq_usd);
        byToken.set(d.token, e);
      }
    }
    depthRejects = {
      available: true, total, rows: rows.length,
      tokens: [...byToken.values()]
        .map((e) => ({
          token: e.token, count: e.count,
          topReason: [...e.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
          maxImpactPct: e.maxImpactPct, maxLiqUsd: e.maxLiqUsd,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  } catch { /* old DB without depth_rejects: unavailable */ }
  let dexArb: RemoteSnapshot['dexArb'] = { count: 0, bestNet: null, tradeDecisions: 0 };
  try {
    const r = db.all<{ c: number; bestNet: number | null; tradeDecisions: number }>(
      `SELECT COUNT(*) c, MAX(net_usd) bestNet,
              SUM(CASE WHEN decision = 'trade' THEN 1 ELSE 0 END) tradeDecisions
       FROM opportunities WHERE ts >= ? AND direction = 'DEX_ARB'`,
      now - 24 * 3600 * 1000,
    )[0];
    if (r) dexArb = { count: r.c || 0, bestNet: r.bestNet ?? null, tradeDecisions: r.tradeDecisions || 0 };
  } catch { /* old DB: zeros */ }
  // L4: distinct tokens with a recorded gap in the last hour — same query as
  // the status server's readLive. Null when the DB has no opportunities table.
  let tokensLastHour: number | null = null;
  try {
    const r = db.all<{ c: number }>(
      `SELECT COUNT(DISTINCT token) c FROM opportunities WHERE ts >= ?`,
      now - 3600 * 1000,
    )[0];
    if (r) tokensLastHour = r.c || 0;
  } catch { /* old DB without opportunities: null */ }

  const cfgState = (k: string): string | undefined => {
    try { return db.getState(k); } catch { return undefined; }
  };
  const aggs = cfgState('cfg:aggregators');

  return {
    schema: SNAPSHOT_SCHEMA,
    chain: ctx.chain,
    mode: ctx.mode,
    version: ctx.version,
    uptimeSec: Math.round(ctx.uptimeSec),
    lastScanTs: ctx.lastScanTs,
    pm2: { state: 'online' },
    maxTradeUsd: ctx.maxTradeUsd,
    hero: {
      trades: heroRow.c, pnl: heroRow.pnl, gas: heroRow.gas, fees: heroRow.fees,
      wins: heroRow.wins || 0,
      bestToken: best ? best.symbol : null, bestTokenPnl: best ? best.pnl : 0,
    },
    today: { day: today, trades: todayRow.c, pnl: todayRow.pnl, gas: todayRow.gas, fees: todayRow.fees, wins: todayRow.wins || 0, losses: todayRow.losses || 0 },
    week7d: { trades: weekRow.c, pnl: weekRow.pnl },
    perToken,
    daily,
    recent,
    transfers,
    inventory,
    winners,
    gaps,
    config: {
      aggregators: aggs ? aggs.split(',').map((s) => s.trim()).filter(Boolean) : ctx.aggregators,
      dexArbEnabled: (cfgState('cfg:dex_arb_enabled') ?? (ctx.dexArbEnabled ? 'yes' : 'no')) === 'yes',
      minPoolLiquidityUsd: Number(cfgState('cfg:min_pool_liquidity_usd') ?? ctx.minPoolLiquidityUsd),
      depthMaxImpactBps: Number(cfgState('cfg:depth_max_impact_bps') ?? ctx.depthMaxImpactBps),
      strategy: cfgState('cfg:strategy') ?? ctx.strategy,
    },
    depthRejects,
    dexArb,
    balances: { mexcUsdt: ctx.mexcUsdt, walletNative: ctx.walletNative, walletUsdc: ctx.walletUsdc, nativeSymbol: ctx.nativeSymbol },
    openTransfers: db.openTransfers().length,
    stuckTransfers: db.stuckTransfers().length,
    tokensLastHour,
  };
}

// ---------- transport (never throws) ----------

type FetchFn = typeof fetch;

/** POST the snapshot to the receiver. False on any failure (logged by caller). */
export async function pushSnapshot(
  ingestUrl: string,
  code: string,
  snapshot: RemoteSnapshot,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  if (!ingestUrl || !isValidPairingCode(code)) return false;
  try {
    const res = await fetchFn(ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, chain: snapshot.chain, snapshot }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

/** Tell the receiver to forget a code immediately (on regenerate). Best effort. */
export async function revokeCode(ingestUrl: string, code: string, fetchFn: FetchFn = fetch): Promise<boolean> {
  if (!ingestUrl || !isValidPairingCode(code)) return false;
  try {
    const res = await fetchFn(ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, action: 'revoke' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

/**
 * Rotate the code: revoke the old one at the receiver (so it dies at once,
 * not after the 2-minute offline window), then store + return the new one.
 */
export async function rotatePairingCode(db: Db, ingestUrl: string, fetchFn: FetchFn = fetch): Promise<{ oldCode: string | null; newCode: string }> {
  const oldCode = db.getState(PAIRING_CODE_KEY) ?? null;
  if (oldCode && isValidPairingCode(oldCode)) await revokeCode(ingestUrl, oldCode, fetchFn);
  const newCode = generatePairingCode();
  db.setState(PAIRING_CODE_KEY, newCode);
  return { oldCode, newCode };
}

// ---------- push loop ----------

/**
 * Push a fresh snapshot every intervalSec (first one immediately). Never
 * throws and never breaks the bot loop: a dead receiver just logs at most
 * once per 10 minutes. Returns { stop, pushNow } (pushNow is also used by
 * the /pairing-new command, so a rotated code is live at once).
 */
export function startPairingPush(opts: {
  db: Db;
  getCode: () => string;
  ingestUrl: string;
  intervalSec: number;
  buildCtx: () => Promise<RemoteSnapshotCtx>;
  onError?: (msg: string) => void;
}): { stop: () => void; pushNow: () => Promise<boolean> } {
  let lastErrLog = 0;
  const pushNow = async (): Promise<boolean> => {
    try {
      const ctx = await opts.buildCtx();
      const ok = await pushSnapshot(opts.ingestUrl, opts.getCode(), buildSnapshot(opts.db, ctx));
      if (!ok && Date.now() - lastErrLog > 600_000) {
        lastErrLog = Date.now();
        opts.onError?.('pairing push failed (receiver unreachable?)');
      }
      return ok;
    } catch {
      return false;
    }
  };
  if (!opts.ingestUrl) return { stop: () => {}, pushNow: async () => false };
  void pushNow();
  const timer = setInterval(() => void pushNow(), Math.max(10, opts.intervalSec) * 1000);
  return { stop: () => clearInterval(timer), pushNow };
}
