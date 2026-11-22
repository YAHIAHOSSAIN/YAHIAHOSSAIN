// MEXC-DEX arb bot — phone status page (read-only).
// Serves one dark, Bengali, mobile-friendly page + /api/status JSON from the
// bots' own SQLite DBs. It never writes to a DB, never reads .env secrets,
// and never places or touches trades. Run it on the VPS next to the bots:
//
//   pm2 start status-ecosystem.config.cjs
//   # then add a Cloudflare Tunnel 'payserver' ingress route to localhost:3102
//
// Env (all optional, no secrets):
//   STATUS_PORT  default 3102
//   STATUS_HOST  default 127.0.0.1 (tunnel reaches it locally; never expose directly)
//   STATUS_DB    default data/ethereum.sqlite (ethereum paper DB override)
//   STATUS_LIVE_DB default data/ethereum-live.sqlite (ethereum live DB override)
//   STATUS_ARB_LIVE_DB default data/arbitrum-live.sqlite
//   STATUS_BSC_LIVE_DB default data/bsc-live.sqlite
//   CHAIN        default ethereum (the default chain for /api/status without ?chain=)
//   MODE         default paper (display only)
//   MAX_TRADE_USD default 300 (display only, paper)
//   LIVE_MAX_TRADE_USD default 50 (display only, live)
//   WATCHLIST_MAX default 50 (display only)
//
// Per-chain pages (2026-11-22): / is the chain index, /ethereum, /arbitrum
// and /bsc are the per-chain dashboards (same premium layout). Arbitrum and
// BSC have no paper twin, so their paper section shows "paper bot নেই" and
// only the live section has data. A missing live DB never crashes the page:
// that chain's sections show "no data yet" instead.
//
// Details dashboard (premium look, approved 2026-11-22): hero stat cards,
// per-trade detail (first-quote net vs booked net), gap distribution +
// hourly best-gap charts, per-token ranking with win-rate bars, daily cards,
// live transfer list. Live gap charts stay empty until transfer mode records
// gaps (see the gap-record fix) — the page shows a warning instead.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const PORT = Number(process.env.STATUS_PORT || 3102);
const HOST = process.env.STATUS_HOST || '127.0.0.1';
const DEFAULT_CHAIN = (process.env.CHAIN || 'ethereum').toLowerCase();
const MODE = (process.env.MODE || 'paper').toLowerCase();
const MAX_TRADE_USD = Number(process.env.MAX_TRADE_USD || 300);
const LIVE_MAX_TRADE_USD = Number(process.env.LIVE_MAX_TRADE_USD || 50);
const WATCHLIST_MAX = Number(process.env.WATCHLIST_MAX || 50);

// One entry per chain. paperDb null = no paper twin on this chain (paper
// section shows "paper bot নেই"); a liveDb that does not exist yet shows
// "no data yet" instead of breaking the page.
export const CHAINS = {
  ethereum: {
    name: 'ethereum', label: 'Ethereum', sub: 'MEXC ↔ Ethereum DEX · Paper + Live — দুটো হিসাবই আছে',
    paperDb: process.env.STATUS_DB || process.env.DB_PATH || 'data/ethereum.sqlite',
    liveDb: process.env.STATUS_LIVE_DB || process.env.LIVE_DB_PATH || 'data/ethereum-live.sqlite',
    paperApp: 'mexc-dex-arb-ethereum', liveApp: 'mexc-dex-arb-ethereum-live',
  },
  arbitrum: {
    name: 'arbitrum', label: 'Arbitrum', sub: 'MEXC ↔ Arbitrum DEX · Transfer mode — CEX থেকে কিনে DEX-এ বেচে',
    paperDb: null,
    liveDb: process.env.STATUS_ARB_LIVE_DB || 'data/arbitrum-live.sqlite',
    paperApp: null, liveApp: 'mexc-dex-arb-arbitrum-live',
  },
  bsc: {
    name: 'bsc', label: 'BNB Chain', sub: 'MEXC ↔ BSC DEX · Transfer mode — CEX থেকে কিনে DEX-এ বেচে',
    paperDb: null,
    liveDb: process.env.STATUS_BSC_LIVE_DB || 'data/bsc-live.sqlite',
    paperApp: null, liveApp: 'mexc-dex-arb-bsc-live',
  },
};
function chainCfg(name) {
  return CHAINS[(name || '').toLowerCase()] || CHAINS[DEFAULT_CHAIN] || CHAINS.ethereum;
}

// ---------------- Pairing-code receiver (Phase A) ----------------
// Bots (Yahia's own + friends') push a public-safe snapshot here; the
// website shows it back only to whoever knows the code. Storage is a
// SEPARATE table in its own file (data/remote-bots.sqlite) — Yahia's local
// bot DBs are never written, and remote data never mixes with them.
// The raw code is NEVER stored: only its sha256, so a stolen DB file alone
// does not give anyone a working code.
const REMOTE_DB = process.env.REMOTE_DB || 'data/remote-bots.sqlite';
const REMOTE_RETENTION_DAYS = Number(process.env.REMOTE_RETENTION_DAYS || 30);
const OFFLINE_AFTER_MS = 120_000; // no snapshot for 2 minutes = offline
const MAX_INGEST_BYTES = 64 * 1024;
const REMOTE_CHAINS = ['ethereum', 'arbitrum', 'bsc'];

export function hashPairingCode(code) {
  return createHash('sha256').update(code).digest('hex');
}
export const PAIRING_CODE_RE = /^[A-Za-z0-9_-]{24}$/;
export function isValidRemoteCode(code) {
  return typeof code === 'string' && PAIRING_CODE_RE.test(code);
}

function ensureRemoteTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_bots (
      code_hash TEXT PRIMARY KEY, chain TEXT NOT NULL, snapshot TEXT NOT NULL,
      received_ts INTEGER NOT NULL, first_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS remote_bots_received ON remote_bots(received_ts);
  `);
}

let remoteDb = null;
export function openRemoteDb(dbPath = REMOTE_DB) {
  if (remoteDb) return remoteDb;
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  remoteDb = new Database(dbPath);
  ensureRemoteTables(remoteDb);
  return remoteDb;
}

// --- snapshot sanitizer (defense in depth) ---
// The bot only ever BUILDS allowlisted fields, but the receiver must not
// trust the network: anything not on this list is DROPPED, so a wallet
// address, key, token, tx hash or order id can never be stored or served,
// even if a (compromised or modified) bot sends one.
const cleanNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const cleanCount = (v) => Math.max(0, Math.round(cleanNum(v)));
const cleanStr = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : null);
const cleanBool = (v) => v === true;
const cleanArr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const cleanMoney = (v) => (v === null || v === undefined ? null : cleanNum(v));

function cleanHero(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    trades: cleanCount(o.trades), pnl: cleanNum(o.pnl), gas: cleanNum(o.gas), fees: cleanNum(o.fees),
    wins: cleanCount(o.wins), bestToken: cleanStr(o.bestToken, 20), bestTokenPnl: cleanNum(o.bestTokenPnl),
  };
}
function cleanToday(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    day: cleanStr(o.day, 10), trades: cleanCount(o.trades), pnl: cleanNum(o.pnl),
    gas: cleanNum(o.gas), fees: cleanNum(o.fees), wins: cleanCount(o.wins), losses: cleanCount(o.losses),
  };
}
function cleanTokenRows(v, max) {
  return cleanArr(v, max).map((r) => {
    const o = r && typeof r === 'object' ? r : {};
    return { symbol: cleanStr(o.symbol, 20), trades: cleanCount(o.trades), pnl: cleanNum(o.pnl), wins: cleanCount(o.wins) };
  });
}
function cleanDaily(v) {
  return cleanArr(v, 30).map((r) => {
    const o = r && typeof r === 'object' ? r : {};
    return { day: cleanStr(o.day, 10), trades: cleanCount(o.trades), pnl: cleanNum(o.pnl), gas: cleanNum(o.gas), fees: cleanNum(o.fees) };
  });
}
function cleanRecent(v, mode) {
  return cleanArr(v, 12).map((r) => {
    const o = r && typeof r === 'object' ? r : {};
    return {
      ts: cleanNum(o.ts), day: cleanStr(o.day, 10), time: cleanStr(o.time, 5),
      symbol: cleanStr(o.symbol, 20), direction: cleanStr(o.direction, 12),
      size: cleanNum(o.size), buy: cleanMoney(o.buy), sell: cleanMoney(o.sell),
      // Live transfer mode never re-quotes: Booked is the sell-price PnL, so
      // a null booked falls back to pnl (paper keeps null = "—", unchanged).
      expected: cleanMoney(o.expected), booked: cleanMoney(o.booked ?? (mode === 'live' ? o.pnl : null)),
      gas: cleanNum(o.gas), fees: cleanNum(o.fees), pnl: cleanNum(o.pnl),
      aggregator: cleanStr(o.aggregator, 20), poolTvl: cleanMoney(o.poolTvl), safeSize: cleanMoney(o.safeSize),
      status: cleanStr(o.status, 20), note: cleanStr(o.note, 200),
    };
  });
}
function cleanTransfers(v) {
  return cleanArr(v, 5).map((r) => {
    const o = r && typeof r === 'object' ? r : {};
    return {
      ts: cleanNum(o.ts), day: cleanStr(o.day, 10), time: cleanStr(o.time, 5),
      base: cleanStr(o.base, 20), status: cleanStr(o.status, 20), note: cleanStr(o.note, 200),
      pnl: cleanMoney(o.pnl), usdc_out: cleanMoney(o.usdc_out),
      recycle_status: cleanStr(o.recycle_status, 20), recycled_usdt: cleanMoney(o.recycled_usdt),
    };
  });
}
function cleanGaps(v) {
  const o = v && typeof v === 'object' ? v : {};
  const b = o.buckets && typeof o.buckets === 'object' ? o.buckets : {};
  return {
    buckets: {
      lt30: cleanCount(b.lt30), b30_50: cleanCount(b.b30_50), b50_100: cleanCount(b.b50_100),
      b100_200: cleanCount(b.b100_200), b200_300: cleanCount(b.b200_300), b300p: cleanCount(b.b300p),
      total: cleanCount(b.total),
    },
    bestBps: cleanMoney(o.bestBps), bestNet: cleanMoney(o.bestNet),
    hourly: cleanArr(o.hourly, 24).map((h) => {
      const x = h && typeof h === 'object' ? h : {};
      return { hr: Math.min(23, Math.max(0, cleanCount(x.hr))), bestBps: cleanNum(x.bestBps), bestNet: cleanMoney(x.bestNet), n: cleanCount(x.n) };
    }),
  };
}
function cleanDepth(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    available: cleanBool(o.available), total: cleanCount(o.total), rows: cleanCount(o.rows),
    tokens: cleanArr(o.tokens, 10).map((t) => {
      const x = t && typeof t === 'object' ? t : {};
      return {
        token: cleanStr(x.token, 20), count: cleanCount(x.count), topReason: cleanStr(x.topReason, 200),
        maxImpactPct: cleanNum(x.maxImpactPct), maxLiqUsd: cleanNum(x.maxLiqUsd),
      };
    }),
  };
}
function cleanConfig(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    aggregators: cleanArr(o.aggregators, 10).map((a) => (typeof a === 'string' ? a.slice(0, 20) : '0x')).filter(Boolean),
    dexArbEnabled: cleanBool(o.dexArbEnabled),
    minPoolLiquidityUsd: cleanNum(o.minPoolLiquidityUsd),
    depthMaxImpactBps: cleanNum(o.depthMaxImpactBps),
    strategy: cleanStr(o.strategy, 20),
  };
}

/** Allowlist-sanitize an incoming snapshot. Returns the clean snapshot, or
 * null when the payload is not a snapshot at all (wrong shape / bad chain). */
export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.chain !== 'string' || !REMOTE_CHAINS.includes(raw.chain.toLowerCase())) return null;
  return {
    schema: cleanNum(raw.schema, 1),
    chain: raw.chain.toLowerCase(),
    mode: raw.mode === 'paper' ? 'paper' : 'live',
    version: cleanStr(raw.version, 32),
    uptimeSec: cleanCount(raw.uptimeSec),
    lastScanTs: cleanNum(raw.lastScanTs),
    pm2: { state: raw.pm2 && raw.pm2.state === 'online' ? 'online' : 'stopped' },
    maxTradeUsd: cleanNum(raw.maxTradeUsd),
    hero: cleanHero(raw.hero),
    today: cleanToday(raw.today),
    week7d: { trades: cleanCount(raw.week7d?.trades), pnl: cleanNum(raw.week7d?.pnl) },
    perToken: cleanTokenRows(raw.perToken, 50),
    daily: cleanDaily(raw.daily),
    recent: cleanRecent(raw.recent, raw.mode === 'paper' ? 'paper' : 'live'),
    transfers: cleanTransfers(raw.transfers),
    inventory: cleanArr(raw.inventory, 50).map((r) => {
      const o = r && typeof r === 'object' ? r : {};
      return { token: cleanStr(o.token, 20), wallet_usd: cleanNum(o.wallet_usd), mexc_usd: cleanNum(o.mexc_usd) };
    }),
    winners: cleanTokenRows(raw.winners, 10),
    gaps: cleanGaps(raw.gaps),
    config: cleanConfig(raw.config),
    depthRejects: cleanDepth(raw.depthRejects),
    dexArb: {
      count: cleanCount(raw.dexArb?.count), bestNet: cleanMoney(raw.dexArb?.bestNet),
      tradeDecisions: cleanCount(raw.dexArb?.tradeDecisions),
    },
    balances: {
      mexcUsdt: cleanMoney(raw.balances?.mexcUsdt), walletNative: cleanMoney(raw.balances?.walletNative),
      walletUsdc: cleanMoney(raw.balances?.walletUsdc), nativeSymbol: cleanStr(raw.balances?.nativeSymbol, 10),
    },
    openTransfers: cleanCount(raw.openTransfers),
    stuckTransfers: cleanCount(raw.stuckTransfers),
    // Live token count, when the bot sends it (L4); null = not sent yet.
    tokensLastHour: typeof raw.tokensLastHour === 'number' ? Math.max(0, Math.round(raw.tokensLastHour)) : null,
  };
}

/** Store a snapshot for a code. Prunes snapshots older than the retention
 * (30 days default). Returns { ok } — false on a bad code / bad snapshot. */
export function ingestSnapshot(db, code, chain, rawSnapshot, now = Date.now()) {
  if (!isValidRemoteCode(code)) return { ok: false, error: 'bad code' };
  if (!REMOTE_CHAINS.includes((chain || '').toLowerCase())) return { ok: false, error: 'bad chain' };
  const snap = sanitizeSnapshot(rawSnapshot);
  if (!snap) return { ok: false, error: 'bad snapshot' };
  if (snap.chain !== chain.toLowerCase()) return { ok: false, error: 'chain mismatch' };
  ensureRemoteTables(db);
  db.prepare('DELETE FROM remote_bots WHERE received_ts < ?').run(now - REMOTE_RETENTION_DAYS * 86_400_000);
  db.prepare(
    `INSERT INTO remote_bots (code_hash, chain, snapshot, received_ts, first_seen)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code_hash) DO UPDATE SET chain = excluded.chain, snapshot = excluded.snapshot, received_ts = excluded.received_ts`,
  ).run(hashPairingCode(code), chain.toLowerCase(), JSON.stringify(snap), now, now);
  return { ok: true };
}

/** Forget a code immediately (bot regenerated its code). Returns rows deleted. */
export function revokeRemoteCode(db, code) {
  if (!isValidRemoteCode(code)) return { ok: false, deleted: 0 };
  ensureRemoteTables(db);
  const r = db.prepare('DELETE FROM remote_bots WHERE code_hash = ?').run(hashPairingCode(code));
  return { ok: true, deleted: r.changes };
}

/** Latest stored snapshot for a code, or null (wrong code and never-seen code
 * look identical — no enumeration). */
export function readRemote(db, code, now = Date.now()) {
  if (!isValidRemoteCode(code)) return null;
  ensureRemoteTables(db);
  const row = db.prepare('SELECT chain, snapshot, received_ts FROM remote_bots WHERE code_hash = ?').get(hashPairingCode(code));
  if (!row) return null;
  return { chain: row.chain, snapshot: row.snapshot, receivedTs: row.received_ts, online: now - row.received_ts <= OFFLINE_AFTER_MS };
}

/** Shape a stored snapshot into the dashboard page's JSON: the paper section
 * is empty (dbOk false) and the LIVE section carries the remote bot, so the
 * existing per-chain page renders it unchanged. Null when the code is unknown. */
export function remoteJson(db, code, now = Date.now()) {
  const row = readRemote(db, code, now);
  if (!row) return null;
  let snap;
  try {
    snap = JSON.parse(row.snapshot);
  } catch {
    return null;
  }
  return {
    dbOk: false,
    chain: row.chain,
    error: row.online ? '🔗 Remote bot — live তথ্য নিচে' : '🔗 Remote bot — ২ মিনিট ধরে snapshot আসেনি (offline)',
    updatedDhaka: dhakaTime(row.receivedTs),
    online: row.online,
    live: { ...snap, dbOk: true, pm2: { state: row.online ? 'online' : 'stopped' }, updatedTs: row.receivedTs },
  };
}

// --- tiny in-memory rate limiter (single process, pm2 fork 1) ---
export class RateLimiter {
  constructor() {
    this.hits = new Map();
  }
  allow(key, limit, windowMs, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
export const ingestLimiter = new RateLimiter();
export const remoteLimiter = new RateLimiter();
export const remoteMissLimiter = new RateLimiter();

/** Real client IP behind the Cloudflare Tunnel (cf-connecting-ip), else the
 * first X-Forwarded-For hop, else the socket address. */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** Read a request body with a size cap (ingest snapshots are a few KB). */
export function readBody(req, maxBytes = MAX_INGEST_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new Error('body too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

// Bangladesh day, e.g. "2026-11-21". UTC+6, no DST.
function dhakaDay(ts = Date.now()) {
  return new Date(ts + 6 * 3600 * 1000).toISOString().slice(0, 10);
}
const BN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dhakaDayShort(ts) {
  const d = new Date(ts + 6 * 3600 * 1000);
  return `${d.getUTCDate()} ${BN_MONTHS[d.getUTCMonth()]}`;
}
function dhakaTime(ts) {
  return new Date(ts + 6 * 3600 * 1000).toISOString().slice(11, 16); // HH:MM
}
function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} সেকেন্ড আগে`;
  if (s < 3600) return `${Math.floor(s / 60)} মিনিট আগে`;
  return `${(s / 3600).toFixed(1)} ঘণ্টা আগে`;
}
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const signed = (n) => `${Number(n || 0) >= 0 ? '+' : ''}$${Number(n || 0).toFixed(2)}`;

function pm2Status(appName) {
  return new Promise((resolve) => {
    execFile('pm2', ['jlist'], { timeout: 5000 }, (err, out) => {
      if (err) return resolve({ state: 'unknown', uptime: null });
      try {
        const apps = JSON.parse(out);
        const app = apps.find((a) => a.name === appName);
        if (!app) return resolve({ state: 'not-found', uptime: null });
        resolve({
          state: app.pm2_env?.status || 'unknown',
          uptime: app.pm2_env?.pm_uptime ? Date.now() - app.pm2_env.pm_uptime : null,
        });
      } catch {
        resolve({ state: 'unknown', uptime: null });
      }
    });
  });
}

// Shared trade stats for one DB + mode. statusSql filters to finished trades:
// paper books status='paper'; live finishes as 'ok'/'one_sided'/failures —
// exclude in-flight ('executing'/'approval') rows, whose pnl is 0 anyway.
export function readTradeStats(db, mode, statusSql) {
  const today = dhakaDay();
  const day7Ago = Date.now() - 7 * 24 * 3600 * 1000;
  const todayRow = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
              COALESCE(SUM(cex_fee_usd),0) fees,
              SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins,
              SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) losses
       FROM trades WHERE day = ? AND mode = ? AND ${statusSql}`,
    )
    .get(today, mode);
  const weekRow = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl
       FROM trades WHERE ts >= ? AND mode = ? AND ${statusSql}`,
    )
    .get(day7Ago, mode);
  // All-time totals for the hero cards.
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl,
              COALESCE(SUM(gas_usd),0) gas, COALESCE(SUM(cex_fee_usd),0) fees,
              SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins
       FROM trades WHERE mode = ? AND ${statusSql}`,
    )
    .get(mode);
  const bestTokenRow = db
    .prepare(
      `SELECT symbol, COALESCE(SUM(pnl_usd),0) pnl
       FROM trades WHERE mode = ? AND ${statusSql}
       GROUP BY symbol ORDER BY pnl DESC LIMIT 1`,
    )
    .get(mode);
  const perToken = db
    .prepare(
      `SELECT symbol, COUNT(*) trades, COALESCE(SUM(pnl_usd),0) pnl,
              SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins
       FROM trades WHERE day = ? AND mode = ? AND ${statusSql}
       GROUP BY symbol ORDER BY pnl DESC`,
    )
    .all(today, mode);
  const daily = db
    .prepare(
      `SELECT day, COUNT(*) trades, COALESCE(SUM(pnl_usd),0) pnl,
              COALESCE(SUM(gas_usd),0) gas, COALESCE(SUM(cex_fee_usd),0) fees
       FROM trades WHERE ts >= ? AND mode = ? AND ${statusSql}
       GROUP BY day ORDER BY day`,
    )
    .all(day7Ago, mode);
  // Phase 6 columns (aggregator / pool_tvl_usd / safe_size_usd) exist only
  // on DBs written since the Phase 6 deploy. The status server opens
  // read-only and never migrates, so an old DB must still load: select the
  // new columns only when they exist, else NULL.
  const tradeCols = new Set(db.prepare(`PRAGMA table_info(trades)`).all().map((c) => c.name));
  const extraCols = ['aggregator', 'pool_tvl_usd', 'safe_size_usd'].map((c) => (tradeCols.has(c) ? c : `NULL AS ${c}`)).join(', ');
  const recent = db
    .prepare(
      `SELECT ts, symbol, direction, size_usd, qty, buy_price, sell_price,
              expected_net, requoted_net, gas_usd, cex_fee_usd, pnl_usd, status, note,
              ${extraCols}
       FROM trades WHERE mode = ? AND ${statusSql} ORDER BY ts DESC LIMIT 12`,
    )
    .all(mode);
  return {
    today: { day: today, trades: todayRow.c, pnl: todayRow.pnl, gas: todayRow.gas, fees: todayRow.fees, wins: todayRow.wins || 0, losses: todayRow.losses || 0 },
    week7d: { trades: weekRow.c, pnl: weekRow.pnl },
    hero: {
      trades: totalRow.c,
      pnl: totalRow.pnl,
      gas: totalRow.gas,
      fees: totalRow.fees,
      wins: totalRow.wins || 0,
      bestToken: bestTokenRow ? bestTokenRow.symbol : null,
      bestTokenPnl: bestTokenRow ? bestTokenRow.pnl : 0,
    },
    perToken,
    daily,
    recent,
  };
}

// Phase 9: profit-winners for the live dashboard — tokens with positive
// booked net PnL in this twin's OWN live trades (mode='live', finished
// trades only: 'ok' sales + 'one_sided' failures, both measured), best first,
// capped at 10. All-time, not today-only: a winner stays a winner until its
// live total goes to/below $0. Paper PnL is never counted (simulated, not
// measured). Same columns as perToken, so the dashboard reuses tokenRows.
export function readWinners(db) {
  try {
    const rows = db
      .prepare(
        `SELECT symbol, COUNT(*) trades, COALESCE(SUM(pnl_usd),0) pnl,
                SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins
         FROM trades WHERE mode = 'live' AND status IN ('ok','one_sided')
         GROUP BY symbol HAVING pnl > 0 ORDER BY pnl DESC LIMIT 10`,
      )
      .all();
    return rows.map((r) => ({ symbol: r.symbol, trades: r.trades, pnl: r.pnl, wins: r.wins || 0 }));
  } catch {
    return [];
  }
}

// Gap stats for the charts, from the opportunities log (last 24h).
// Transfer mode does not write opportunity rows (only the inventory engine
// does), so a transfer-mode DB returns total 0 / null best — the page then
// shows the "no gap data" warning instead of a chart.
export function readGapStats(db) {
  // The gap chart shows tradeable CEX-DEX gaps only. DEX_ARB rows are
  // detection-only (no execution exists), so they are excluded here — their
  // own stats come from readDexArbStats. (tokensHour/tokensLastHour still
  // count them: a scanned token is a "token seen".)
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const b = db
    .prepare(
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
       FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB'`,
    )
    .get(dayAgo);
  const hourly = db
    .prepare(
      `SELECT CAST(strftime('%H', ts/1000, 'unixepoch', '+6 hours') AS INTEGER) hr,
              MAX(gross_bps) bestBps, MAX(net_usd) bestNet, COUNT(*) n
       FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' AND decision != 'rule' GROUP BY hr ORDER BY hr`,
    )
    .all(dayAgo);
  return {
    buckets: {
      lt30: b.lt30 || 0, b30_50: b.b30_50 || 0, b50_100: b.b50_100 || 0,
      b100_200: b.b100_200 || 0, b200_300: b.b200_300 || 0, b300p: b.b300p || 0,
      total: b.total || 0,
    },
    bestBps: b.maxBps ?? null,
    bestNet: b.maxNet ?? null,
    hourly,
  };
}

// Public bot config (Phase 6, option b): the bot writes these keys into the
// `state` table at startup; the dashboard reads them here — it never reads
// .env. Public values only, never secrets. An old DB (no keys yet) falls
// back to the code defaults: aggregators ['0x'], DEX-ARB OFF.
export function readPublicConfig(db) {
  const def = { aggregators: ['0x'], dexArbEnabled: false, minPoolLiquidityUsd: 150000, depthMaxImpactBps: 70, strategy: null };
  try {
    const hasState = db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table' AND name = 'state'`).get();
    if (!hasState || !hasState.c) return def;
    const get = (k) => {
      const r = db.prepare('SELECT value FROM state WHERE key = ?').get(k);
      return r ? r.value : null;
    };
    const aggs = get('cfg:aggregators');
    const arb = get('cfg:dex_arb_enabled');
    const floor = get('cfg:min_pool_liquidity_usd');
    const impact = get('cfg:depth_max_impact_bps');
    const strategy = get('cfg:strategy');
    return {
      aggregators: aggs ? aggs.split(',').map((s) => s.trim()).filter(Boolean) : def.aggregators,
      dexArbEnabled: arb === 'yes',
      minPoolLiquidityUsd: floor !== null && Number.isFinite(Number(floor)) ? Number(floor) : def.minPoolLiquidityUsd,
      depthMaxImpactBps: impact !== null && Number.isFinite(Number(impact)) ? Number(impact) : def.depthMaxImpactBps,
      strategy: strategy || null,
    };
  } catch {
    return def;
  }
}

// Depth-filter rejections, last 24h, from the `depth_rejects` summary rows
// (one row per tick). Aggregates the per-tick top-10 detail JSON per token:
// count, most common reason, worst impact, deepest pool seen. An old DB
// (no table yet) returns available: false — the page shows "no rejections
// recorded yet" instead of a chart.
export function readDepthRejects(db) {
  const empty = { available: false, total: 0, rows: 0, tokens: [] };
  try {
    const has = db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table' AND name = 'depth_rejects'`).get();
    if (!has || !has.c) return empty;
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const rows = db.prepare('SELECT total, detail FROM depth_rejects WHERE ts >= ?').all(dayAgo);
    let total = 0;
    const byToken = new Map();
    for (const r of rows) {
      total += r.total || 0;
      let detail = [];
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
    const tokens = [...byToken.values()]
      .map((e) => ({
        token: e.token,
        count: e.count,
        topReason: [...e.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
        maxImpactPct: e.maxImpactPct,
        maxLiqUsd: e.maxLiqUsd,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return { available: true, total, rows: rows.length, tokens };
  } catch {
    return empty;
  }
}

// DEX-DEX detection stats, last 24h, from opportunities rows with
// direction='DEX_ARB'. A 'trade' decision here means "net beat the hurdle",
// NOT that a trade was made (detection only, no execution) — the page
// labels it so.
export function readDexArbStats(db) {
  try {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const r = db
      .prepare(
        `SELECT COUNT(*) c, MAX(net_usd) bestNet,
                SUM(CASE WHEN decision = 'trade' THEN 1 ELSE 0 END) tradeDecisions
         FROM opportunities WHERE ts >= ? AND direction = 'DEX_ARB'`,
      )
      .get(dayAgo);
    return { count: r.c || 0, bestNet: r.bestNet ?? null, tradeDecisions: r.tradeDecisions || 0 };
  } catch {
    return { count: 0, bestNet: null, tradeDecisions: 0 };
  }
}

export function readStatus(c) {
  if (!c.paperDb) return { dbOk: false, chain: c.name, paperAvailable: false, error: 'এই chain-এ paper bot নেই — শুধু live চলে' };
  if (!fs.existsSync(c.paperDb)) return { dbOk: false, chain: c.name, paperAvailable: true, error: 'DB পাওয়া যায়নি' };
  let db;
  try {
    db = new Database(c.paperDb, { readonly: true });
    const hourAgo = Date.now() - 3600 * 1000;
    const stats = readTradeStats(db, MODE, `status = 'paper'`);
    const gaps = readGapStats(db);
    const config = readPublicConfig(db);
    const depthRejects = readDepthRejects(db);
    const dexArb = readDexArbStats(db);
    const scan = db.prepare(`SELECT MAX(ts) t FROM opportunities`).get();
    const tokensHour = db
      .prepare(`SELECT COUNT(DISTINCT token) c FROM opportunities WHERE ts >= ?`)
      .get(hourAgo);
    const bestHour = db
      .prepare(
        `SELECT token, gross_bps, net_usd FROM opportunities WHERE ts >= ? AND direction IS NOT 'DEX_ARB' AND decision IN ('below_hurdle','trade') AND gross_bps IS NOT NULL ORDER BY gross_bps DESC LIMIT 1`,
      )
      .get(hourAgo);
    const openTransfers = db
      .prepare(`SELECT COUNT(*) c FROM transfers WHERE status IN ('buying','withdrawing','selling')`)
      .get();
    const stuck = db.prepare(`SELECT COUNT(*) c FROM transfers WHERE status = 'stuck'`).get();
    db.close();
    return {
      dbOk: true,
      paperAvailable: true,
      chain: c.name,
      mode: MODE,
      maxTradeUsd: MAX_TRADE_USD,
      watchlistMax: WATCHLIST_MAX,
      ...stats,
      gaps,
      config,
      depthRejects,
      dexArb,
      lastScanTs: scan?.t || null,
      tokensLastHour: tokensHour.c,
      bestGapLastHour: bestHour ? { token: bestHour.token, bps: bestHour.gross_bps, net: bestHour.net_usd } : null,
      openTransfers: openTransfers.c,
      stuckTransfers: stuck.c,
      updatedTs: Date.now(),
    };
  } catch (e) {
    try { db?.close(); } catch { /* ignore */ }
    return { dbOk: false, chain: c.name, paperAvailable: true, error: `DB পড়া যায়নি: ${String(e.message || e).slice(0, 120)}` };
  }
}

export function readLive(c) {
  if (!fs.existsSync(c.liveDb)) return { dbOk: false, chain: c.name, error: 'Live DB পাওয়া যায়নি' };
  let db;
  try {
    db = new Database(c.liveDb, { readonly: true });
    const stats = readTradeStats(db, 'live', `status NOT IN ('executing','approval','paper')`);
    const gaps = readGapStats(db);
    const config = readPublicConfig(db);
    const depthRejects = readDepthRejects(db);
    const dexArb = readDexArbStats(db);
    const winners = readWinners(db);
    const inventory = db
      .prepare(
        `SELECT token, wallet_usd, mexc_usd FROM inventory_snapshots s
         WHERE ts = (SELECT MAX(ts) FROM inventory_snapshots WHERE token = s.token)
         ORDER BY token`,
      )
      .all();
    // Phase 8 recycle columns are migration-added (db.ts TRANSFER_MIGRATIONS):
    // an old DB file may not have them — select NULL instead of breaking.
    // recycle_tx / recycle_address / sell_tx are NEVER selected (tx hashes
    // and deposit addresses stay off the board — public safety).
    const transferCols = new Set(db.prepare(`PRAGMA table_info(transfers)`).all().map((c) => c.name));
    const recycleCols = ['recycle_status', 'recycled_usdt'].map((c) => (transferCols.has(c) ? c : `NULL AS ${c}`)).join(', ');
    const transfers = db
      .prepare(`SELECT ts, base, status, note, usdc_out, ${recycleCols} FROM transfers ORDER BY ts DESC LIMIT 5`)
      .all();
    const openTransfers = db
      .prepare(`SELECT COUNT(*) c FROM transfers WHERE status IN ('buying','withdrawing','selling')`)
      .get();
    const stuck = db.prepare(`SELECT COUNT(*) c FROM transfers WHERE status = 'stuck'`).get();
    // Live token count (L4): distinct tokens seen (any opportunity row, incl.
    // DEX_ARB detection) in the last hour — the live equivalent of the paper
    // "গত ১ ঘণ্টায় টোকেন দেখেছে" line.
    const hourAgo = Date.now() - 3600 * 1000;
    const tokensHour = db
      .prepare(`SELECT COUNT(DISTINCT token) c FROM opportunities WHERE ts >= ?`)
      .get(hourAgo);
    db.close();
    return {
      dbOk: true,
      maxTradeUsd: LIVE_MAX_TRADE_USD,
      ...stats,
      gaps,
      config,
      depthRejects,
      dexArb,
      winners,
      inventory,
      transfers,
      tokensLastHour: tokensHour.c,
      openTransfers: openTransfers.c,
      stuckTransfers: stuck.c,
      updatedTs: Date.now(),
    };
  } catch (e) {
    try { db?.close(); } catch { /* ignore */ }
    return { dbOk: false, chain: c.name, error: `Live DB পড়া যায়নি: ${String(e.message || e).slice(0, 120)}` };
  }
}

export const PAGE = `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MEV Bot — Paper + Live</title>
<style>
*{box-sizing:border-box}
body{background:radial-gradient(1200px 600px at 50% -10%,#1c1607 0%,#000 55%);color:#eee;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:16px 14px 28px}
h1{font-size:22px;margin:4px 0 2px;background:linear-gradient(90deg,#f7dc7d,#d4af37 60%,#9a7b1e);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#9a9a9a;font-size:13px;margin-bottom:14px}
h2{font-size:15px;letter-spacing:.4px;margin:20px 0 8px;color:#f0cd6a;display:flex;align-items:center;gap:8px}
h2::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,#d4af37,transparent)}
h2.live{color:#ff8a8a}h2.live::after{background:linear-gradient(90deg,#ff6b6b,transparent)}
.hero{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px}
.stat{background:linear-gradient(180deg,#1a1a1a,#101010);border:1px solid #2c2c2c;border-radius:16px;padding:14px;box-shadow:0 6px 18px rgba(0,0,0,.5)}
.stat .lab{font-size:12px;color:#9a9a9a;margin-bottom:4px}
.stat .val{font-size:26px;font-weight:800}
.card{background:linear-gradient(180deg,#171717,#101010);border:1px solid #2c2c2c;border-radius:16px;padding:14px;margin-bottom:10px;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.card.live{border:1px solid #5a2020;background:linear-gradient(180deg,#1d1111,#120a0a)}
.big{font-size:22px;font-weight:800;display:block}
.green{color:#3ddc84}.red{color:#ff6b6b}.gold{color:#d4af37}
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #232323;font-size:14px}
.row:last-child{border-bottom:0}.muted{color:#9a9a9a;font-size:12px}.mut{color:#9a9a9a;font-size:11px}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;background:#1d2b1d;color:#3ddc84}
.badge.off{background:#2b1d1d;color:#ff6b6b}.badge.paper{background:#221d00;color:#d4af37}
.badge.live{background:#2b1d1d;color:#ff6b6b}
.pill{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700}
.pill.gold{background:rgba(212,175,55,.18);color:#f0cd6a}
.pill.blue{background:rgba(96,165,250,.16);color:#93c5fd}
.pill.red{background:rgba(255,107,107,.14);color:#ff8a8a}
.pnl{display:inline-block;padding:3px 9px;border-radius:20px;font-size:12px;font-weight:700;white-space:nowrap}
.pnl.green{background:rgba(61,220,132,.14);color:#3ddc84}
.pnl.red{background:rgba(255,107,107,.14);color:#ff6b6b}
.wrap{overflow-x:auto;margin:0 -4px;padding:0 4px}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px 6px;border-bottom:1px solid #232323;text-align:left;white-space:nowrap}
th{color:#8a8a8a;font-size:11px;text-transform:uppercase;letter-spacing:.4px}tr.alt td{background:rgba(255,255,255,.025)}
.brow{display:flex;align-items:center;gap:8px;margin:9px 0;font-size:13px}
.blab{width:76px;color:#ccc;flex:none}.btrack{flex:1;background:#222;border-radius:6px;overflow:hidden}
.bar{height:16px;border-radius:6px;background:linear-gradient(90deg,#9a7b1e,#f7dc7d);box-shadow:0 0 10px rgba(212,175,55,.35)}
.bnum{color:#9a9a9a;font-size:12px;min-width:56px;text-align:right}
.hwrap{display:flex;align-items:flex-end;gap:4px;height:132px;margin-top:10px;padding-top:18px}
.hcol{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.hval{font-size:10px;color:#f0cd6a}.hbar{background:linear-gradient(180deg,#f7dc7d,#9a7b1e);width:100%;border-radius:4px 4px 0 0;min-height:4px}
.hhr{font-size:10px;color:#9a9a9a;margin-top:3px}
.trow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #232323}
.trow:last-child{border-bottom:0}
.rank{width:26px;height:26px;border-radius:50%;background:rgba(212,175,55,.16);color:#f0cd6a;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex:none}
.tsym{display:flex;flex-direction:column;min-width:74px}
.tbar{flex:1;background:#222;border-radius:6px;height:8px;overflow:hidden}
.tfill{display:block;height:100%;border-radius:6px}.tfill.green{background:linear-gradient(90deg,#1d9e56,#3ddc84)}.tfill.red{background:linear-gradient(90deg,#b03a3a,#ff6b6b)}
.dgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dcard{background:rgba(255,255,255,.03);border:1px solid #2c2c2c;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:3px}
.note{background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.3);border-radius:10px;padding:10px;font-size:13px;margin-top:10px;line-height:1.5}
.warn{background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.3);border-radius:10px;padding:10px;font-size:13px;margin-top:10px;line-height:1.5}
button{background:#d4af37;color:#000;border:0;border-radius:8px;padding:8px 14px;font-weight:700}
.foot{color:#777;font-size:12px;text-align:center;margin-top:18px}
.nav{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 14px}
.nav a{color:#d4af37;text-decoration:none;font-size:13px;font-weight:700;padding:7px 13px;border:1px solid #4a3d16;border-radius:20px;background:rgba(212,175,55,.07)}
.nav a.active{background:#d4af37;color:#000;border-color:#d4af37}
</style></head><body>
<h1>🤖 MEV Bot — Paper</h1>
<div class="sub">MEXC ↔ Ethereum DEX · আসল টাকা নয়, শুধু paper হিসাব</div>
<div class="card" id="status">লোড হচ্ছে…</div>
<div class="card" id="config"></div>
<div class="hero" id="hero"></div>
<div class="card" id="todaystrip"></div>
<h2>📝 Trade Detail — Paper</h2>
<div class="card" id="recent"></div>
<h2>📈 Gap Chart — Paper · গত ২৪ ঘণ্টা</h2>
<div class="card" id="gap"></div>
<h2>🛡️ Depth Filter — Paper · গত ২৪ ঘণ্টা</h2>
<div class="card" id="depth"></div>
<h2>🪙 টোকেন অনুযায়ী — Paper</h2>
<div class="card" id="tokens"></div>
<h2>📅 দিন অনুযায়ী — Paper</h2>
<div class="dgrid" id="daily"></div>
<h2 class="live">🔴 Live — আসল টাকা</h2>
<div class="sub" style="color:#999;font-size:13px;margin-bottom:12px">এই অংশের লাভ/লস সত্যিকারের — আসল wallet আর MEXC দিয়ে ট্রেড হয়</div>
<div class="card live" id="live-status">লোড হচ্ছে…</div>
<div class="card live" id="live-config"></div>
<div class="hero" id="live-hero"></div>
<div class="card live" id="live-today"></div>
<h2 class="live">🏆 Priority Winners — Live</h2>
<div class="card live" id="live-winners"></div>
<div class="card live" id="live-inventory"></div>
<h2 class="live">📝 Trade Detail — Live</h2>
<div class="card live" id="live-recent"></div>
<div class="card live" id="live-transfers"></div>
<h2 class="live">📈 Gap Chart — Live · গত ২৪ ঘণ্টা</h2>
<div class="card live" id="live-gap"></div>
<h2 class="live">🛡️ Depth Filter — Live · গত ২৪ ঘণ্টা</h2>
<div class="card live" id="live-depth"></div>
<div class="foot" id="foot"></div>
<p><button onclick="load()">↻ এখনই দেখো</button></p>
<script>
function badgeFor(state){
  if(state === 'online') return '<span class="badge">● চলছে</span>';
  if(state === 'unknown') return '<span class="badge off">● অবস্থা জানা যায়নি</span>';
  return '<span class="badge off">● বন্ধ ('+state+')</span>';
}
function fmtPrice(x){
  if(x === null || x === undefined || x === 0) return '—';
  var s = Number(x).toPrecision(4);
  return s.indexOf('.') >= 0 ? s.replace(/0+$/,'').replace(/\.$/,'') : s;
}
function dirPill(d){
  if(d === 'CEX_BUY') return '<span class="pill gold">CEX BUY</span>';
  if(d === 'DEX_BUY') return '<span class="pill blue">DEX BUY</span>';
  return '<span class="pill red">TRANSFER</span>';
}
function pnlPill(n){
  return '<span class="pnl '+(n>=0?'green':'red')+'">'+(n>=0?'+':'')+'$'+Number(n||0).toFixed(2)+'</span>';
}
function detailTable(list){
  if(!list.length) return '<div class="muted">কোনো ট্রেড নেই</div>';
  var h = '<div class="wrap"><table><tr><th>সময়</th><th>টোকেন</th><th>দিক</th><th>সাইজ (depth)</th><th>Agg</th><th>Pool / Safe</th><th>কেনা → বেচা</th><th>প্রথম net</th><th>Booked</th><th>গ্যাস+ফি</th><th>লাভ/লস</th></tr>';
  list.forEach(function(r,i){
    var pool = (r.poolTvl === null || r.poolTvl === undefined) ? '—' : '$'+Math.round(r.poolTvl/1000)+'k / $'+Math.round(r.safeSize||0);
    h += '<tr'+(i%2?' class="alt"':'')+'><td>'+r.day+'<br><span class="mut">'+r.time+'</span></td><td><b>'+r.symbol+'</b></td><td>'+dirPill(r.direction)+'</td><td>$'+r.size+'</td><td>'+(r.aggregator||'—')+'</td><td>'+pool+'</td><td>'+fmtPrice(r.buy)+' → '+fmtPrice(r.sell)+'</td><td>$'+Number(r.expected||0).toFixed(2)+'</td><td>'+(r.booked===null?'—':'$'+Number(r.booked).toFixed(2))+'</td><td>$'+Number((r.gas||0)+(r.fees||0)).toFixed(2)+'</td><td>'+pnlPill(r.pnl)+'</td></tr>';
  });
  return h + '</table></div>';
}
function recycleLine(x){
  if(!x.recycle_status) return '';
  var s = '♻️ Recycle: ' + x.recycle_status;
  if(x.usdc_out !== null && x.usdc_out !== undefined) s += ' · ' + Number(x.usdc_out).toFixed(2) + ' USDC';
  if(x.recycled_usdt !== null && x.recycled_usdt !== undefined) s += ' → ' + Number(x.recycled_usdt).toFixed(2) + ' USDT';
  return '<div class="muted" style="padding:2px 0 6px">' + s + '</div>';
}
function configHtml(cfg, dexArb){
  if(!cfg) return '<div class="muted">কনফিগ তথ্য নেই</div>';
  var aggs = (cfg.aggregators||['0x']).map(function(a){ return '<span class="pill gold">'+a+'</span>'; }).join(' ');
  var arb = dexArb || { count: 0, bestNet: null, tradeDecisions: 0 };
  var h = '<b>⚙️ কনফিগ</b><div class="row"><span>Aggregator</span><span>'+aggs+'</span></div>'
    + '<div class="row"><span>Depth floor / max impact</span><b>$'+Number(cfg.minPoolLiquidityUsd||0).toLocaleString('en-US')+' / '+(cfg.depthMaxImpactBps/100).toFixed(2)+'%</b></div>'
    + '<div class="row"><span>Strategy</span><b>'+(cfg.strategy||'—')+'</b></div>'
    + '<div class="row"><span>DEX-DEX mode</span><b>'+(cfg.dexArbEnabled ? '<span class="badge">● চালু</span>' : '<span class="badge off">● বন্ধ</span>')+'</b></div>';
  if(cfg.dexArbEnabled){
    h += '<div class="row"><span>DEX-ARB (২৪ ঘণ্টা)</span><b>'+arb.count+' টা দেখেছে · সেরা net '+(arb.bestNet===null?'—':'$'+Number(arb.bestNet).toFixed(2))+' · hurdle পেরিয়েছে '+arb.tradeDecisions+' টা</b></div>'
      + '<div class="note">DEX-ARB শুধু detection — "hurdle পেরিয়েছে" মানে net hurdle-এর ওপরে ছিল, ট্রেড হয়নি। কোনো execution হয় না।</div>';
  } else if(arb.count){
    h += '<div class="row"><span>DEX-ARB (২৪ ঘণ্টা)</span><b>'+arb.count+' টা পুরনো রেকর্ড আছে (এখন বন্ধ)</b></div>';
  }
  return h;
}
// info: { floor, maxImpactBps, tokensLastHour } — the live thresholds + the
// tokens seen in the last hour. The empty state must stay truthful about
// where the filter actually bites (universe build + findGaps): depth_rejects
// only records above-threshold candidates that fail inside depthSizes, so
// "no rejections" never means the filter did nothing.
function depthHtml(dr, info){
  if(!dr || !dr.available || !dr.total){
    var i = info || {};
    var h = '<div class="muted">🛡️ গত ২৪ ঘণ্টায় কোনো depth rejection রেকর্ড হয়নি — এর মানে এই নয় যে filter কাজ করেনি। Depth filter দুই জায়গায় কাটে: (১) universe বানানোর সময় — pool liquidity floor-এর নিচে থাকলে টোকেন universe-এই ঢোকে না; (২) gap খোঁজার সময় (findGaps) — TVL কম থাকলে candidate বাদ যায়। এই তালিকায় শুধু সেই candidate-গুলো আসে যারা gap-এর hurdle পেরিয়ে exact quote পর্যন্ত গিয়ে depth-এ ফেল করেছে — এখনো তেমন কেউ ফেল করেনি।</div>';
    if(i.floor > 0){
      h += '<div class="row"><span>Depth floor / max impact</span><b>$'+Number(i.floor).toLocaleString('en-US')+((i.maxImpactBps !== null && i.maxImpactBps !== undefined) ? ' / '+(i.maxImpactBps/100).toFixed(2)+'%' : '')+'</b></div>';
    }
    if(typeof i.tokensLastHour === 'number'){
      h += '<div class="row"><span>গত ১ ঘণ্টায় টোকেন দেখেছে</span><b>'+i.tokensLastHour+' টা</b></div>';
    }
    return h;
  }
  var h = '<div class="row"><span>মোট rejection (২৪ ঘণ্টা)</span><b>'+dr.total.toLocaleString('en-US')+' টা · '+dr.rows+' tick-এ</b></div>';
  if(dr.tokens && dr.tokens.length){
    h += '<div class="mut" style="margin:8px 0 4px">সবচেয়ে বেশি বাদ পড়া টোকেন</div>';
    dr.tokens.forEach(function(t){
      h += '<div class="row"><span><b>'+t.token+'</b> · '+t.count+' বার</span><span class="mut">'+t.topReason+(t.maxImpactPct ? ' · impact '+t.maxImpactPct.toFixed(2)+'%' : '')+(t.maxLiqUsd ? ' · pool $'+Math.round(t.maxLiqUsd/1000)+'k' : '')+'</span></div>';
    });
  }
  return h;
}
function gapHtml(g){
  if(!g || !g.buckets.total || g.bestBps === null){
    return '<div class="warn">⚠️ Gap-এর কোনো ডেটা নেই। Transfer mode ২%-এর নিচের gap DB-তে save করে না — তাই chart আঁকার মতো কিছু নেই।</div>';
  }
  var b = g.buckets, total = b.total;
  var rows = [['< 0.30%', b.lt30], ['0.30–0.50%', b.b30_50], ['0.50–1%', b.b50_100], ['1–2%', b.b100_200], ['2–3%', b.b200_300], ['3%+', b.b300p]];
  var h = '<div class="mut" style="margin-bottom:6px">Gap distribution — কতবার কত বড় gap এসেছে ('+total.toLocaleString('en-US')+' বার যাচাই)</div>';
  rows.forEach(function(r){
    // total === 1 gives log10(1) === 0 -> Infinity%; guard it, and clamp to
    // 100% (a lone bucket would otherwise exceed it: log10(total+1)/log10(total)).
    var denom = Math.log10(total);
    var w = r[1] ? Math.max(3, Math.min(100, denom > 0 ? Math.log10(r[1]+1) / denom * 100 : 100)) : 3;
    h += '<div class="brow"><span class="blab">'+r[0]+'</span><div class="btrack"><div class="bar" style="width:'+w.toFixed(0)+'%"></div></div><span class="bnum">'+r[1].toLocaleString('en-US')+'</span></div>';
  });
  h += '<div class="row"><span>সবচেয়ে বড় gap</span><b class="gold">'+(g.bestBps/100).toFixed(2)+'% · সেরা net '+(g.bestNet===null||g.bestNet===undefined?'—':'$'+Number(g.bestNet).toFixed(2))+'</b></div>';
  if(g.hourly && g.hourly.length){
    var max = 1;
    g.hourly.forEach(function(x){ if(x.bestBps > max) max = x.bestBps; });
    h += '<div class="mut" style="margin-top:14px">ঘণ্টায় সেরা gap (bps, ঢাকা সময়)</div><div class="hwrap">';
    g.hourly.forEach(function(x){
      h += '<div class="hcol"><div class="hval">'+Math.round(x.bestBps)+'</div><div class="hbar" style="height:'+Math.max(4, x.bestBps/max*84).toFixed(0)+'px"></div><div class="hhr">'+x.hr+'</div></div>';
    });
    h += '</div>';
  }
  return h;
}
function tokenRows(list){
  if(!list.length) return '<div class="muted">আজ এখনো কোনো ট্রেড হয়নি</div>';
  var h = '';
  list.forEach(function(p,i){
    var wr = p.trades ? Math.round(p.wins/p.trades*100) : 0;
    h += '<div class="trow"><span class="rank">'+(i+1)+'</span><span class="tsym"><b>'+p.symbol+'</b><span class="mut">'+p.trades+' ট্রেড · '+wr+'% জয়</span></span><span class="tbar"><span class="tfill '+(p.pnl>=0?'green':'red')+'" style="width:'+wr+'%"></span></span>'+pnlPill(p.pnl)+'</div>';
  });
  return h;
}
function winnersHtml(list){
  if(!list || !list.length) return '<div class="muted">🏆 এখনো কোনো live winner নেই — কোনো টোকেনে মোট live লাভ $0-এর ওপরে যায়নি। Winner হলেই এখানে priority হিসেবে দেখাবে।</div>';
  return '<div class="mut">🏆 Priority — এই টোকেনগুলোর gap আগে যাচাই হয়, আর universe-এ pin করা থাকে (মোট live PnL, সব সময়ের)</div>' + tokenRows(list);
}
function heroHtml(h, bestGapBps){
  var wr = h.trades ? Math.round(h.wins/h.trades*100) : 0;
  return '<div class="stat"><div class="lab">মোট লাভ/লস</div><div class="val '+(h.pnl>=0?'green':'red')+'">'+(h.pnl>=0?'+':'')+'$'+Number(h.pnl).toFixed(2)+'</div><div class="mut">গ্যাস $'+Number(h.gas).toFixed(2)+' + ফি $'+Number(h.fees).toFixed(2)+'</div></div>'
    + '<div class="stat"><div class="lab">ট্রেড · জয়ের হার</div><div class="val">'+h.trades+' <span style="font-size:15px;color:#9a9a9a">ট্রেড</span></div><div class="mut">'+h.wins+' জয় · '+(h.trades-h.wins)+' হার · '+wr+'% জয়</div></div>'
    + '<div class="stat"><div class="lab">সেরা gap · ২৪ ঘণ্টা</div><div class="val gold">'+(bestGapBps===null?'—':(bestGapBps/100).toFixed(2)+'%')+'</div><div class="mut">২%-এর নিচের gap save হয় না</div></div>'
    + '<div class="stat"><div class="lab">সেরা টোকেন</div><div class="val '+(h.bestTokenPnl>=0?'green':'red')+'">'+(h.bestToken||'—')+'</div><div class="mut">'+(h.bestToken?('মোট '+((h.bestTokenPnl>=0?'+':'')+'$'+Number(h.bestTokenPnl).toFixed(2))):'')+'</div></div>';
}
async function load(){
  try{
    const r = await fetch('/api/status'); const d = await r.json();
    if(!d.dbOk){
      document.getElementById('status').innerHTML = '<b>⚠️ '+d.error+'</b>';
      if(!HAS_PAPER){
        var pnote = '<div class="muted">এই chain-এ paper bot নেই — শুধু live চলে।</div>';
        ['hero','todaystrip','recent','gap','tokens','daily','config','depth'].forEach(function(id){ document.getElementById(id).innerHTML = pnote; });
      }
      if(d.updatedDhaka){ document.getElementById('foot').textContent = 'আপডেট: ' + d.updatedDhaka + ' ঢাকা · ৩০ সেকেন্ডে নিজে আপডেট হয়'; }
    }
    else {
    document.getElementById('status').innerHTML =
      badgeFor(d.pm2.state) + ' <span class="badge paper">PAPER · '+d.chain.toUpperCase()+'</span>' +
      '<div class="row"><span>শেষ scan</span><b>'+d.lastScanAgo+'</b></div>' +
      '<div class="row"><span>গত ১ ঘণ্টায় টোকেন দেখেছে</span><b>'+d.tokensLastHour+' টা</b></div>' +
      '<div class="row"><span>সেরা gap (১ ঘণ্টা)</span><b>'+(d.bestGapLastHour ? d.bestGapLastHour.token+' '+(d.bestGapLastHour.bps/100).toFixed(2)+'%'+(d.bestGapLastHour.net != null ? ' · $'+Number(d.bestGapLastHour.net).toFixed(2) : '') : '—')+'</b></div>' +
      '<div class="row"><span>খোলা transfer / আটকে</span><b>'+d.openTransfers+' / '+d.stuckTransfers+'</b></div>' +
      '<div class="row"><span>Max size</span><b>$'+d.maxTradeUsd+'</b></div>';
    document.getElementById('hero').innerHTML = heroHtml(d.hero, d.gaps ? d.gaps.bestBps : null);
    document.getElementById('config').innerHTML = configHtml(d.config, d.dexArb);
    document.getElementById('depth').innerHTML = depthHtml(d.depthRejects, { floor: d.config && d.config.minPoolLiquidityUsd, maxImpactBps: d.config && d.config.depthMaxImpactBps, tokensLastHour: d.tokensLastHour });
    const t = d.today;
    document.getElementById('todaystrip').innerHTML =
      '<div class="row"><span>আজ ('+t.day+')</span><b>'+t.trades+' ট্রেড ('+t.wins+' লাভ, '+t.losses+' লস) · <span class="'+(t.pnl>=0?'green':'red')+'">'+(t.pnl>=0?'+':'')+'$'+t.pnl.toFixed(2)+'</span></b></div>' +
      '<div class="row"><span>আজ গ্যাস + ফি</span><b>$'+t.gas.toFixed(2)+' + $'+t.fees.toFixed(2)+'</b></div>' +
      '<div class="row"><span>গত ৭ দিন</span><b>'+d.week7d.trades+' ট্রেড, '+(d.week7d.pnl>=0?'+':'')+'$'+d.week7d.pnl.toFixed(2)+'</b></div>';
    document.getElementById('recent').innerHTML = detailTable(d.recent)
      + '<div class="note">প্রথম net = প্রথম quote-এর হিসাব, Booked = re-quote করে বুক করা আসল হিসাব। সাইজ = depth থেকে বের করা সাইজ (pool TVL / safe size থাকলে দেখায়)।</div>';
    document.getElementById('gap').innerHTML = gapHtml(d.gaps);
    document.getElementById('tokens').innerHTML = tokenRows(d.perToken);
    document.getElementById('daily').innerHTML = d.daily.length ? d.daily.map(function(x){
      return '<div class="dcard"><span class="mut">'+x.day+'</span><span class="big '+(x.pnl>=0?'green':'red')+'">'+(x.pnl>=0?'+':'')+'$'+Number(x.pnl).toFixed(2)+'</span><span class="mut">'+x.trades+' ট্রেড · গ্যাস $'+Number(x.gas).toFixed(2)+' + ফি $'+Number(x.fees).toFixed(2)+'</span></div>';
    }).join('') : '<div class="muted">কোনো দিনের হিসাব নেই</div>';
    document.getElementById('foot').textContent = 'আপডেট: ' + d.updatedDhaka + ' ঢাকা · ৩০ সেকেন্ডে নিজে আপডেট হয়';
    }
    const L = d.live;
    if(!L || !L.dbOk){
      document.getElementById('live-status').innerHTML = '<b>⚠️ '+(L ? L.error : 'Live তথ্য পাওয়া যায়নি')+'</b>';
      ['live-hero','live-today','live-winners','live-inventory','live-recent','live-transfers','live-gap','live-config','live-depth'].forEach(id=>{ document.getElementById(id).innerHTML=''; });
    } else {
      document.getElementById('live-config').innerHTML = configHtml(L.config, L.dexArb);
      document.getElementById('live-depth').innerHTML = depthHtml(L.depthRejects, { floor: L.config && L.config.minPoolLiquidityUsd, maxImpactBps: L.config && L.config.depthMaxImpactBps, tokensLastHour: L.tokensLastHour });
      document.getElementById('live-status').innerHTML =
        badgeFor(L.pm2.state) + ' <span class="badge live">LIVE · '+d.chain.toUpperCase()+'</span>' +
        (typeof L.tokensLastHour === 'number' ? '<div class="row"><span>গত ১ ঘণ্টায় টোকেন দেখেছে</span><b>'+L.tokensLastHour+' টা</b></div>' : '') +
        '<div class="row"><span>খোলা transfer / আটকে</span><b>'+L.openTransfers+' / '+L.stuckTransfers+'</b></div>' +
        '<div class="row"><span>Max size</span><b>$'+L.maxTradeUsd+'</b></div>';
      document.getElementById('live-hero').innerHTML = heroHtml(L.hero, L.gaps ? L.gaps.bestBps : null);
      const t = L.today;
      document.getElementById('live-today').innerHTML =
        '<div class="mut">আজ ('+t.day+') — live, আসল টাকা</div>' +
        '<div class="big '+(t.pnl>=0?'green':'red')+'">'+(t.pnl>=0?'+':'')+'$'+t.pnl.toFixed(2)+'</div>' +
        '<div class="row"><span>ট্রেড</span><b>'+t.trades+' টা ('+t.wins+' লাভ, '+t.losses+' লস)</b></div>' +
        '<div class="row"><span>গ্যাস + ফি</span><b>$'+t.gas.toFixed(2)+' + $'+t.fees.toFixed(2)+'</b></div>' +
        '<div class="row"><span>গত ৭ দিন</span><b>'+L.week7d.trades+' ট্রেড, '+(L.week7d.pnl>=0?'+':'')+'$'+L.week7d.pnl.toFixed(2)+'</b></div>';
      document.getElementById('live-inventory').innerHTML = '<b>ইনভেন্টরি (সর্বশেষ হিসাব)</b>' +
        (L.inventory.length ? L.inventory.map(v=>'<div class="row"><span>'+v.token+'</span><b>Wallet $'+Number(v.wallet_usd||0).toFixed(2)+' · MEXC $'+Number(v.mexc_usd||0).toFixed(2)+'</b></div>').join('') : '<div class="muted">ইনভেন্টরি তথ্য নেই</div>');
      document.getElementById('live-winners').innerHTML = winnersHtml(L.winners);
      document.getElementById('live-recent').innerHTML = detailTable(L.recent)
        + (L.recent.length ? '<div class="note">Live transfer mode-এ re-quote হয় না — Booked কলামে বেচা দামে বুক করা লাভ/লস (pnl) দেখায়। প্রথম net = প্রথম quote-এর হিসাব।</div>' : '');
      document.getElementById('live-transfers').innerHTML = '<b>Transfer-এর অবস্থা</b>' +
        (L.transfers.length ? L.transfers.map(function(x){ return '<div class="row"><span>'+x.day+' '+x.time+' — '+x.base+'</span><b>'+x.status+'</b></div><div class="muted" style="padding:2px 0 6px">'+x.note+'</div>' + recycleLine(x); }).join('') : '<div class="muted">কোনো transfer হয়নি</div>');
      document.getElementById('live-gap').innerHTML = gapHtml(L.gaps);
    }
  }catch(e){ document.getElementById('status').innerHTML = '<b>⚠️ লোড হয়নি — আবার চেষ্টা করো</b>'; }
}
load(); setInterval(load, 30000);
</script></body></html>`;

function navHtml(active) {
  const links = Object.values(CHAINS).map((c) => `<a href="/${c.name}" class="${c.name === active ? 'active' : ''}">${c.label}</a>`).join('');
  return `<div class="nav"><a href="/" class="${active === 'index' ? 'active' : ''}">🏠 সব chain</a>${links}</div>`;
}

// Per-chain dashboard: the same premium PAGE, with the chain name in the
// title/heading, a nav bar, and the JS fetching this chain's JSON.
export function dashboardPage(c) {
  return PAGE
    .replace('<title>MEV Bot — Paper + Live</title>', `<title>MEV Bot — ${c.label}</title>`)
    .replace('<h1>🤖 MEV Bot — Paper</h1>', `<h1>🤖 MEV Bot — ${c.label}</h1>`)
    .replace('MEXC ↔ Ethereum DEX · আসল টাকা নয়, শুধু paper হিসাব', c.sub)
    .replace('<body>', `<body>\n${navHtml(c.name)}`)
    .replace("fetch('/api/status')", `fetch('/api/status?chain=${c.name}')`)
    .replace('async function load(){', `const HAS_PAPER = ${c.paperDb ? 'true' : 'false'};\nasync function load(){`);
}

// Remote-bot page (/remote?code=...): the same premium per-chain page, but
// the paper sections are hidden (a remote bot has one live section only)
// and the data comes from /api/remote with the code from the URL. The code
// stays in the browser; the server never lists bots, so without a code this
// page shows nothing.
function remotePage() {
  return PAGE
    .replace('<title>MEV Bot — Paper + Live</title>', '<title>MEV Bot — Remote</title>')
    .replace('<h1>🤖 MEV Bot — Paper</h1>', '<h1>🔗 Remote Bot</h1>')
    .replace('MEXC ↔ Ethereum DEX · আসল টাকা নয়, শুধু paper হিসাব', 'Code দিয়ে connect করা bot — শুধু এই bot-এর live তথ্য দেখাচ্ছে')
    .replace('<body>', `<body>\n${navHtml('index')}<style>#config,#hero,#todaystrip{display:none}h2.paper-h{display:none}#recent,#gap,#depth,#tokens,#daily{display:none}</style>`)
    .replace('<h2>📝 Trade Detail — Paper</h2>', '<h2 class="paper-h">📝 Trade Detail — Paper</h2>')
    .replace('<h2>📈 Gap Chart — Paper · গত ২৪ ঘণ্টা</h2>', '<h2 class="paper-h">📈 Gap Chart — Paper · গত ২৪ ঘণ্টা</h2>')
    .replace('<h2>🛡️ Depth Filter — Paper · গত ২৪ ঘণ্টা</h2>', '<h2 class="paper-h">🛡️ Depth Filter — Paper · গত ২৪ ঘণ্টা</h2>')
    .replace('<h2>🪙 টোকেন অনুযায়ী — Paper</h2>', '<h2 class="paper-h">🪙 টোকেন অনুযায়ী — Paper</h2>')
    .replace('<h2>📅 দিন অনুযায়ী — Paper</h2>', '<h2 class="paper-h">📅 দিন অনুযায়ী — Paper</h2>')
    .replace("document.getElementById('status').innerHTML = '<b>⚠️ '+d.error+'</b>';", "document.getElementById('status').innerHTML = '<b>'+d.error+'</b>';")
    .replace("const r = await fetch('/api/status'); const d = await r.json();", `if(!REMOTE_CODE){ document.getElementById('status').innerHTML = '<b>কোনো code দেওয়া হয়নি — home page থেকে code দিয়ে connect করো</b>'; return; }
    const r = await fetch('/api/remote?code=' + encodeURIComponent(REMOTE_CODE));
    if(!r.ok){ document.getElementById('status').innerHTML = '<b>⚠️ এই code-এ কোনো bot পাওয়া যায়নি — ভুল code, বা code বদলে গেছে</b>'; return; }
    const d = await r.json();`)
    .replace('async function load(){', `const HAS_PAPER = false;
const REMOTE_CODE = new URLSearchParams(location.search).get('code') || '';
async function load(){`);
}

// Chain index / landing page: one card per chain with a one-line summary.
const INDEX_PAGE = `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MEV Bot — সব Chain</title>
<style>
*{box-sizing:border-box}
body{background:radial-gradient(1200px 600px at 50% -10%,#1c1607 0%,#000 55%);color:#eee;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:16px 14px 28px}
h1{font-size:22px;margin:4px 0 2px;background:linear-gradient(90deg,#f7dc7d,#d4af37 60%,#9a7b1e);-webkit-background-clip:text;background-clip:text;color:transparent}
h2{font-size:17px;margin:0 0 8px;color:#f0cd6a}
.sub{color:#9a9a9a;font-size:13px;margin-bottom:14px}
.card{background:linear-gradient(180deg,#171717,#101010);border:1px solid #2c2c2c;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #232323;font-size:14px}
.row:last-child{border-bottom:0}.muted{color:#9a9a9a;font-size:12px}
.green{color:#3ddc84}.red{color:#ff6b6b}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;background:#1d2b1d;color:#3ddc84;margin-bottom:8px}
.badge.off{background:#2b1d1d;color:#ff6b6b}
.nav{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 14px}
.nav a{color:#d4af37;text-decoration:none;font-size:13px;font-weight:700;padding:7px 13px;border:1px solid #4a3d16;border-radius:20px;background:rgba(212,175,55,.07)}
.nav a.active{background:#d4af37;color:#000;border-color:#d4af37}
button{background:#d4af37;color:#000;border:0;border-radius:8px;padding:8px 14px;font-weight:700}
.foot{color:#777;font-size:12px;text-align:center;margin-top:18px}
</style></head><body>
${navHtml('index')}
<h1>🤖 MEV Bot</h1>
<div class="sub">MEXC ↔ DEX · কোন chain দেখতে চাও? নিচে চাপ দাও।</div>
<div class="card" id="remote-box">
<h2 style="margin-top:0">🔗 Code দিয়ে bot connect করো</h2>
<div class="muted">তোমার bot-এর pairing code বসাও — ওই bot-এর live status, trade আর লাভ/লস এখানেই দেখাবে। Code-টা password-এর মতো: কাউকে দিও না।</div>
<div style="display:flex;gap:8px;margin-top:10px"><input id="code-input" placeholder="২৪ অক্ষরের code" maxlength="24" style="flex:1;background:#111;border:1px solid #4a3d16;border-radius:8px;color:#eee;padding:9px 12px;font-size:14px"><button onclick="connectCode()">Connect</button></div>
<div id="code-msg" class="muted" style="margin-top:8px"></div>
</div>
<div id="remote-cards"></div>
<div id="cards">লোড হচ্ছে…</div>
<div class="foot" id="foot"></div>
<p><button onclick="load()">↻ এখনই দেখো</button></p>
<script>
function pnlHtml(n){ return '<b class="'+(n>=0?'green':'red')+'">'+(n>=0?'+':'')+'$'+Number(n||0).toFixed(2)+'</b>'; }
function cardHtml(c){
  var live = c.live;
  var liveLine = live && live.dbOk
    ? '<div class="row"><span>🔴 Live ট্রেড</span><span>'+live.trades+' টা · '+pnlHtml(live.pnl)+'</span></div>'
    : '<div class="muted">Live-এর এখনো কোনো ডেটা নেই — bot চালু হয়নি বা কোনো ট্রেড হয়নি</div>';
  var paperLine = c.paper === null
    ? '<div class="muted">এই chain-এ paper bot নেই</div>'
    : (c.paper.dbOk
      ? '<div class="row"><span>📝 Paper ট্রেড</span><span>'+c.paper.trades+' টা · '+pnlHtml(c.paper.pnl)+'</span></div>'
      : '<div class="muted">Paper তথ্য পাওয়া যায়নি</div>');
  var state = live && live.pm2 === 'online' ? '<span class="badge">● live চলছে</span>' : (live && live.pm2 === 'not-found' ? '<span class="badge off">● live bot নেই</span>' : '<span class="badge off">● live বন্ধ</span>');
  return '<div class="card"><h2>'+c.label+'</h2>' + state + liveLine + paperLine +
    '<p style="margin:12px 0 0"><a href="/'+c.chain+'" style="display:inline-block;background:#d4af37;color:#000;border-radius:8px;padding:9px 16px;font-weight:700;text-decoration:none">দেখো →</a></p></div>';
}
var savedCodes = [];
try { savedCodes = JSON.parse(localStorage.getItem('arb_codes') || '[]'); if(!Array.isArray(savedCodes)) savedCodes = []; } catch(e){ savedCodes = []; }
function saveCodes(){ try { localStorage.setItem('arb_codes', JSON.stringify(savedCodes.slice(0,5))); } catch(e){} }
function remoteCardHtml(d, code, idx){
  var L = d.live || {};
  var hero = L.hero || {};
  var today = L.today || {};
  var state = d.online ? '<span class="badge">● চলছে</span>' : '<span class="badge off">● offline</span>';
  var line = '<div class="row"><span>🔴 Live ট্রেড (সব সময়)</span><span>'+(hero.trades||0)+' টা · '+pnlHtml(hero.pnl||0)+'</span></div>'
    + '<div class="row"><span>আজ</span><span>'+(today.trades||0)+' ট্রেড · '+pnlHtml(today.pnl||0)+'</span></div>';
  return '<div class="card"><h2>'+(d.chain||'bot').toUpperCase()+' · Remote bot</h2>' + state + line +
    '<p style="margin:12px 0 0"><a href="/remote?code='+encodeURIComponent(code)+'" style="display:inline-block;background:#d4af37;color:#000;border-radius:8px;padding:9px 16px;font-weight:700;text-decoration:none">দেখো →</a> ' +
    '<button onclick="removeCode('+idx+')" style="background:#222;color:#ccc;border:1px solid #444">সরাও</button></p></div>';
}
async function loadRemoteCards(){
  var wrap = document.getElementById('remote-cards');
  if(!wrap) return;
  if(!savedCodes.length){ wrap.innerHTML = ''; return; }
  var html = '';
  for(var i = 0; i < savedCodes.length; i++){
    var code = savedCodes[i];
    try {
      var r = await fetch('/api/remote?code=' + encodeURIComponent(code));
      if(!r.ok){
        html += '<div class="card"><h2>Remote bot</h2><div class="muted">এই code-এ কোনো bot পাওয়া যায়নি — ভুল code, বা code বদলে গেছে।</div><p><button onclick="removeCode('+i+')" style="background:#222;color:#ccc;border:1px solid #444">সরাও</button></p></div>';
        continue;
      }
      html += remoteCardHtml(await r.json(), code, i);
    } catch(e){
      html += '<div class="card"><h2>Remote bot</h2><div class="muted">লোড হয়নি — আবার চেষ্টা করো</div></div>';
    }
  }
  wrap.innerHTML = html;
}
function connectCode(){
  var v = document.getElementById('code-input').value.trim();
  var msg = document.getElementById('code-msg');
  if(!/^[A-Za-z0-9_-]{24}$/.test(v)){ msg.textContent = 'Code-টা ২৪ অক্ষরের হতে হবে (অক্ষর, সংখ্যা, - _)।'; return; }
  if(savedCodes.indexOf(v) === -1){ savedCodes.push(v); saveCodes(); }
  document.getElementById('code-input').value = '';
  msg.textContent = '';
  loadRemoteCards();
}
function removeCode(i){ savedCodes.splice(i, 1); saveCodes(); loadRemoteCards(); }
async function load(){
  try{
    const r = await fetch('/api/chains'); const d = await r.json();
    document.getElementById('cards').innerHTML = d.chains.map(cardHtml).join('');
    document.getElementById('foot').textContent = 'আপডেট: ' + d.updatedDhaka + ' ঢাকা · ৩০ সেকেন্ডে নিজে আপডেট হয়';
  }catch(e){ document.getElementById('cards').innerHTML = '<b>⚠️ লোড হয়নি — আবার চেষ্টা করো</b>'; }
}
loadRemoteCards();
load(); setInterval(load, 30000);
setInterval(loadRemoteCards, 30000);
</script></body></html>`;

export async function chainJson(chainName) {
  const c = chainCfg(chainName);
  const [pm2, livePm2] = await Promise.all([
    c.paperApp ? pm2Status(c.paperApp) : Promise.resolve({ state: 'not-found', uptime: null }),
    c.liveApp ? pm2Status(c.liveApp) : Promise.resolve({ state: 'not-found', uptime: null }),
  ]);
  const s = readStatus(c);
  const live = readLive(c);
  // Live transfer mode never re-quotes (requoted_net stays NULL): Booked is
  // the sell-price PnL, so fall back to pnl_usd. Paper keeps its re-quoted
  // value (or null = "—") unchanged.
  const mapRecent = (list, mode) => list.map((r) => ({
    ...r,
    day: dhakaDayShort(r.ts),
    time: dhakaTime(r.ts),
    pnl: Number(r.pnl_usd.toFixed(2)),
    size: Math.round(r.size_usd),
    buy: r.buy_price,
    sell: r.sell_price,
    expected: r.expected_net,
    booked: r.requoted_net ?? (mode === 'live' ? r.pnl_usd : null),
    gas: r.gas_usd,
    fees: r.cex_fee_usd,
    // Phase 6: winning aggregator + depth context. Whitelist only — dex_tx,
    // cex_order_id, transfers.address and any wallet address are NEVER sent.
    aggregator: r.aggregator ?? null,
    poolTvl: r.pool_tvl_usd ?? null,
    safeSize: r.safe_size_usd ?? null,
  }));
  const mapTransfers = (list) => list.map((r) => ({
    ...r, day: dhakaDayShort(r.ts), time: dhakaTime(r.ts),
  }));
  return {
    ...s,
    pm2,
    lastScanAgo: s.dbOk ? ago(s.lastScanTs) : null,
    updatedDhaka: s.dbOk ? dhakaTime(s.updatedTs) : live.dbOk ? dhakaTime(live.updatedTs) : null,
    recent: s.dbOk ? mapRecent(s.recent, 'paper') : [],
    live: live.dbOk
      ? { ...live, pm2: livePm2, recent: mapRecent(live.recent, 'live'), transfers: mapTransfers(live.transfers) }
      : { ...live, pm2: livePm2 },
  };
}

// One-line summary per chain for the index page: live trades + net P/L,
// paper trades + net P/L (ethereum only, null elsewhere).
export async function chainsSummary() {
  const out = [];
  for (const c of Object.values(CHAINS)) {
    const live = readLive(c);
    const paper = readStatus(c);
    const [livePm2, paperPm2] = await Promise.all([
      c.liveApp ? pm2Status(c.liveApp) : Promise.resolve({ state: 'not-found', uptime: null }),
      c.paperApp ? pm2Status(c.paperApp) : Promise.resolve({ state: 'not-found', uptime: null }),
    ]);
    out.push({
      chain: c.name,
      label: c.label,
      live: live.dbOk
        ? { dbOk: true, trades: live.hero.trades, pnl: live.hero.pnl, pm2: livePm2.state }
        : { dbOk: false, pm2: livePm2.state },
      paper: c.paperDb
        ? paper.dbOk
          ? { dbOk: true, trades: paper.hero.trades, pnl: paper.hero.pnl, pm2: paperPm2.state }
          : { dbOk: false, pm2: paperPm2.state }
        : null,
    });
  }
  return { chains: out, updatedDhaka: dhakaTime(Date.now()) };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    const path = u.pathname;
    if (path === '/api/status') {
      const out = await chainJson(u.searchParams.get('chain'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    if (path === '/api/chains') {
      const out = await chainsSummary();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    // Pairing-code receiver: bots push snapshots here, the website reads
    // them back only with the code. No bot list, no enumeration, no
    // commands to any bot — status flows one way only.
    if (path === '/api/ingest' && req.method === 'POST') {
      const json = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        json(400, { ok: false, error: 'bad json' });
        return;
      }
      const code = body && body.code;
      if (!isValidRemoteCode(code)) {
        json(400, { ok: false, error: 'bad code' });
        return;
      }
      const ip = clientIp(req);
      if (!ingestLimiter.allow(`ip:${ip}`, 60, 60_000)) {
        json(429, { ok: false, error: 'rate limited' });
        return;
      }
      if (body.action === 'revoke') {
        // Bot regenerated its code: the old one dies at once, not after the
        // 2-minute offline window.
        const r = revokeRemoteCode(openRemoteDb(), code);
        json(200, { ok: true, revoked: r.deleted > 0 });
        return;
      }
      const chain = typeof body.chain === 'string' ? body.chain.toLowerCase() : '';
      if (!REMOTE_CHAINS.includes(chain)) {
        json(400, { ok: false, error: 'bad chain' });
        return;
      }
      // Snapshots come every 20-30s; faster than 1 per 5s per code is abuse.
      if (!ingestLimiter.allow(`code:${hashPairingCode(code)}`, 1, 5000)) {
        json(429, { ok: false, error: 'too fast' });
        return;
      }
      const r = ingestSnapshot(openRemoteDb(), code, chain, body.snapshot);
      if (!r.ok) {
        json(400, { ok: false, error: r.error });
        return;
      }
      json(200, { ok: true });
      return;
    }
    if (path === '/api/remote') {
      const json = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const code = u.searchParams.get('code') || '';
      if (!isValidRemoteCode(code)) {
        json(400, { error: 'bad code' });
        return;
      }
      const ip = clientIp(req);
      if (!remoteLimiter.allow(`ip:${ip}`, 120, 60_000)) {
        json(429, { error: 'rate limited' });
        return;
      }
      const out = remoteJson(openRemoteDb(), code);
      if (!out) {
        // Wrong codes are rate-limited per IP, so codes cannot be guessed
        // by brute force; a miss and a never-seen code look identical.
        if (!remoteMissLimiter.allow(`miss:${ip}`, 20, 60_000)) {
          json(429, { error: 'rate limited' });
          return;
        }
        json(404, { error: 'not found' });
        return;
      }
      json(200, out);
      return;
    }
    if (path === '/remote') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(remotePage());
      return;
    }
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(INDEX_PAGE);
      return;
    }
    const chainPage = path === '/ethereum' ? CHAINS.ethereum : path === '/arbitrum' ? CHAINS.arbitrum : path === '/bsc' ? CHAINS.bsc : null;
    if (chainPage) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(dashboardPage(chainPage));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    res.writeHead(500);
    res.end(`error: ${String(e.message || e).slice(0, 200)}`);
  }
});

// Only listen when run directly (pm2 / node status-server.mjs). Importing
// this module (tests) must NOT start a server.
// NOTE (2026-11-23): pm2 fork mode wraps the script in ProcessContainerFork.js,
// so process.argv[1] is the pm2 container, NOT this file — argv[1] alone is
// always false under pm2 and the server silently never listens (pm2 still
// shows it "online", the process idles on the pm2 IPC channel). pm2 passes
// the real script path in pm_exec_path, so test BOTH candidates (argv[1] is
// always truthy under pm2, so `argv[1] || pm_exec_path` would never reach the
// second one). realpathSync guards against symlinked path spellings.
const selfPath = fs.realpathSync(fileURLToPath(import.meta.url));
const candidates = [process.argv[1], process.env.pm_exec_path].filter(Boolean);
const isMain = candidates.some((c) => {
  try { return fs.realpathSync(c) === selfPath; } catch { return false; }
});
if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`arb status page on http://${HOST}:${PORT} (chains: ethereum/arbitrum/bsc, mode: ${MODE})`);
  });
}
