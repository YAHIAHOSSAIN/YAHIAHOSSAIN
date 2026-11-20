# mexc-dex-arb: full source for review

MEXC <-> Ethereum DEX arbitrage bot (TypeScript, Node 20). Strategies: transfer (buy MEXC -> withdraw -> sell DEX) and inventory. Please review for bugs, money-loss risks and security issues.

## `package.json`

```json
{
  "name": "mexc-dex-arb",
  "version": "1.0.0",
  "private": true,
  "description": "MEXC spot <-> Ethereum DEX (0x / 1inch) inventory arbitrage bot",
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "report": "node dist/report.js",
    "test": "tsx --test test/*.test.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "dotenv": "^16.6.1",
    "ethers": "6.17.0",
    "ws": "^8.18.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20.19.0",
    "@types/ws": "^8.18.1",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0"
  }
}
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

## `.env.example`

```bash
# Copy to .env, fill in, then: chmod 600 .env
# The bot refuses to start in live mode if .env is readable by other users.

# live (real money, default) | paper (no orders, no transactions)
MODE=live

# transfer  = scan ALL MEXC ERC20 tokens; buy on MEXC -> withdraw to wallet -> sell on DEX (default)
# inventory = hold tokens on both sides, trade both legs at the same moment (no withdrawals)
STRATEGY=transfer

# ---------- Ethereum ----------
# Your own RPC (Alchemy / Infura / QuickNode). Used for reading and simulation.
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
# Private RPC for sending (never the public mempool): MEV Blocker or Flashbots Protect
SEND_RPC_URL=https://rpc.mevblocker.io
# SEND_RPC_URL=https://rpc.flashbots.net/fast
# NEW hot wallet used only by this bot. Keep only the trading inventory in it.
PRIVATE_KEY=

# ---------- DEX aggregator ----------
# 0x (https://dashboard.0x.org) or 1inch (https://portal.1inch.dev)
DEX_AGGREGATOR=0x
ZEROX_API_KEY=
ONEINCH_API_KEY=

# ---------- MEXC ----------
# STRATEGY=inventory: Spot trading ONLY, NO withdrawal.
# STRATEGY=transfer : Spot trading + Withdraw. Bind the key to your VPS IP AND turn on the MEXC
#                     withdrawal address whitelist with ONLY your hot wallet address in it.
MEXC_API_KEY=
MEXC_API_SECRET=
MEXC_TAKER_FEE=0.0005

# ---------- Telegram ----------
# Create a bot with @BotFather, send it any message, then get your chat id from
# https://api.telegram.org/bot<TOKEN>/getUpdates  (message.chat.id)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ---------- Watchlist ----------
# Optional: only these tokens (MEXC base symbols). Empty = auto-discover by volume.
WATCHLIST=
WATCHLIST_MAX=8
MIN_DEX_TVL_USD=200000
MIN_MEXC_VOLUME_USD=500000

# ---------- Profit rules ----------
# Trade only if net > max(MIN_PROFIT_USD, MIN_PROFIT_PCT% of size)
MIN_PROFIT_USD=15
MIN_PROFIT_PCT=0.5
DEX_SLIPPAGE_BPS=30
CEX_SLIPPAGE_BPS=20
SAFETY_MARGIN_USD=2
PRIORITY_FEE_GWEI=1

# ---------- Risk limits ----------
MAX_TRADE_USD=200
MIN_TRADE_USD=25
MAX_TRADES_PER_DAY=20
DAILY_LOSS_LIMIT_USD=30
MAX_GAS_GWEI=40
MAX_CONSECUTIVE_FAILS=3
MIN_ETH_FOR_GAS=0.01
TX_TIMEOUT_SEC=60

# ---------- Transfer strategy ----------
SCAN_INTERVAL_SEC=20
# Cheap pre-filter (MEXC ask vs DexScreener price) before exact quotes
SCAN_MIN_GAP_PCT=3
SCAN_EXACT_QUOTES=5
# Price-move reserve while the withdrawal travels (150 = 1.5%)
TRANSFER_DRIFT_BPS=150
TRANSFER_TIMEOUT_MIN=90
MAX_OPEN_TRANSFERS=1

DB_PATH=data/bot.sqlite
```

## `ecosystem.config.cjs`

```js
// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb',
      script: 'dist/main.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      restart_delay: 10000,
      time: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
    },
  ],
};
```

## `src/config.ts`

```ts
import 'dotenv/config';

export type Mode = 'live' | 'paper';
export type AggregatorName = '0x' | '1inch';

function str(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def === undefined) throw new Error(`Missing required env var ${name} (see .env.example)`);
    return def;
  }
  return v.trim();
}
function num(name: string, def: number): number {
  const v = Number(str(name, String(def)));
  if (!Number.isFinite(v)) throw new Error(`Env var ${name} must be a number`);
  return v;
}

export function loadConfig() {
  const mode = str('MODE', 'live').toLowerCase() as Mode;
  if (mode !== 'live' && mode !== 'paper') throw new Error('MODE must be live or paper');
  const aggregator = str('DEX_AGGREGATOR', '0x') as AggregatorName;
  if (aggregator !== '0x' && aggregator !== '1inch') throw new Error('DEX_AGGREGATOR must be 0x or 1inch');

  const strategy = str('STRATEGY', 'transfer').toLowerCase();
  if (strategy !== 'transfer' && strategy !== 'inventory') throw new Error('STRATEGY must be transfer or inventory');

  return {
    mode,
    // transfer  = scan all MEXC ERC20 tokens, buy on MEXC, withdraw to wallet, sell on DEX
    // inventory = hold tokens on both sides and trade both legs at the same moment
    strategy: strategy as 'transfer' | 'inventory',
    // --- Ethereum ---
    rpcUrl: str('RPC_URL'),
    // Private RPC for sending: never the public mempool.
    sendRpcUrl: str('SEND_RPC_URL', 'https://rpc.mevblocker.io'),
    privateKey: mode === 'live' ? str('PRIVATE_KEY') : str('PRIVATE_KEY', ''),
    usdc: str('USDC_ADDRESS', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48').toLowerCase(),
    // --- DEX aggregator ---
    aggregator,
    zeroExApiKey: str('ZEROX_API_KEY', ''),
    oneInchApiKey: str('ONEINCH_API_KEY', ''),
    // --- MEXC ---
    mexcApiKey: mode === 'live' ? str('MEXC_API_KEY') : str('MEXC_API_KEY', ''),
    mexcApiSecret: mode === 'live' ? str('MEXC_API_SECRET') : str('MEXC_API_SECRET', ''),
    mexcTakerFee: num('MEXC_TAKER_FEE', 0.0005),
    // --- Telegram ---
    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    // --- Watchlist ---
    watchlist: str('WATCHLIST', '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    watchlistMax: num('WATCHLIST_MAX', 8),
    minDexTvlUsd: num('MIN_DEX_TVL_USD', 200_000),
    minMexcVolumeUsd: num('MIN_MEXC_VOLUME_USD', 500_000),
    // --- Costs & thresholds ---
    minProfitUsd: num('MIN_PROFIT_USD', 15),
    minProfitPct: num('MIN_PROFIT_PCT', 0.5), // percent of trade size
    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 20),
    safetyMarginUsd: num('SAFETY_MARGIN_USD', 2),
    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
    // --- Risk limits ---
    maxTradeUsd: num('MAX_TRADE_USD', 200),
    minTradeUsd: num('MIN_TRADE_USD', 25),
    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
    maxGasGwei: num('MAX_GAS_GWEI', 40),
    maxConsecutiveFails: num('MAX_CONSECUTIVE_FAILS', 3),
    minEthForGas: num('MIN_ETH_FOR_GAS', 0.01),
    txTimeoutSec: num('TX_TIMEOUT_SEC', 60),
    // --- Transfer strategy (scanner) ---
    scanIntervalSec: num('SCAN_INTERVAL_SEC', 20),
    scanMinGapPct: num('SCAN_MIN_GAP_PCT', 3), // cheap pre-filter before exact quotes
    scanExactQuotes: num('SCAN_EXACT_QUOTES', 5), // max exact DEX quotes per scan
    transferDriftBps: num('TRANSFER_DRIFT_BPS', 150), // price-move reserve while withdrawing
    transferTimeoutMin: num('TRANSFER_TIMEOUT_MIN', 90),
    maxOpenTransfers: num('MAX_OPEN_TRANSFERS', 1),
    // --- Misc ---
    dbPath: str('DB_PATH', 'data/bot.sqlite'),
    envPath: str('ENV_PATH', '.env'),
  };
}

export type Config = ReturnType<typeof loadConfig>;

/** Every secret value, so the logger can scrub them from any output. */
export function secretsOf(cfg: Config): string[] {
  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken]
    .filter((s) => s && s.length >= 8)
    .flatMap((s) => [s, s.replace(/^0x/, '')]);
}
```

## `src/db.ts`

```ts
// SQLite storage: trades and persistent bot state (pause flag, failure streak, ...).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// 'approval' = gas spent on an approval for a trade that was then skipped (a real cost, not a trade).
export type TradeStatus = 'ok' | 'one_sided' | 'dex_failed' | 'cex_failed' | 'paper' | 'approval';

export interface TradeRow {
  ts: number;
  day: string; // Bangladesh day
  mode: string;
  symbol: string;
  direction: string;
  size_usd: number;
  qty: number;
  buy_price: number;
  sell_price: number;
  expected_net: number;
  cex_fee_usd: number;
  gas_usd: number;
  pnl_usd: number;
  status: TradeStatus;
  dex_tx: string | null;
  cex_order_id: string | null;
  note: string | null;
}

// One buy -> withdraw -> sell cycle. Persisted so a restart resumes it where it stopped.
export type TransferStatus = 'buying' | 'withdrawing' | 'selling' | 'done' | 'failed' | 'stuck';
export interface TransferRow {
  id?: number;
  ts: number;
  updated: number;
  base: string;
  symbol: string;
  address: string;
  decimals: number;
  net_work: string;
  qty_step: number;
  price_decimals: number;
  status: TransferStatus;
  buy_qty: number;
  cost_usd: number;
  buy_order_id: string | null;
  withdraw_amount: string | null;
  withdraw_id: string | null;
  wallet_before: string | null; // token balance (base units) before the withdrawal
  received: string | null; // base units that arrived
  usdc_out: number | null;
  gas_usd: number;
  expected_net: number;
  pnl: number | null;
  sell_attempts: number;
  alerted_timeout: number;
  note: string | null;
}

export class Db {
  private db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
        symbol TEXT NOT NULL, direction TEXT NOT NULL,
        size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
        expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL,
        status TEXT NOT NULL, dex_tx TEXT, cex_order_id TEXT, note TEXT
      );
      CREATE INDEX IF NOT EXISTS trades_day ON trades(day, mode);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL, updated INTEGER NOT NULL,
        base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL,
        net_work TEXT NOT NULL, qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL,
        status TEXT NOT NULL, buy_qty REAL, cost_usd REAL, buy_order_id TEXT,
        withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT,
        usdc_out REAL, gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL,
        sell_attempts INTEGER NOT NULL DEFAULT 0, alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT
      );
    `);
  }

  insertTrade(t: TradeRow): void {
    this.db
      .prepare(
        `INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net,
          cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note)
         VALUES (@ts, @day, @mode, @symbol, @direction, @size_usd, @qty, @buy_price, @sell_price, @expected_net,
          @cex_fee_usd, @gas_usd, @pnl_usd, @status, @dex_tx, @cex_order_id, @note)`,
      )
      .run(t);
  }

  dayStats(day: string, mode: string): { trades: number; pnl: number; gas: number; failed: number } {
    const r = this.db
      .prepare(
        `SELECT SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades,
                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
         FROM trades WHERE day = ? AND mode = ?`,
      )
      .get(day, mode) as { trades: number | null; pnl: number; gas: number; failed: number | null };
    return { trades: r.trades ?? 0, pnl: r.pnl, gas: r.gas, failed: r.failed ?? 0 };
  }

  /** Stats since a timestamp, overall and per symbol. */
  statsSince(sinceTs: number, mode?: string) {
    const where = mode ? 'ts >= ? AND mode = ?' : 'ts >= ?';
    const args = mode ? [sinceTs, mode] : [sinceTs];
    const total = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END),0) trades,
                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
                COALESCE(SUM(cex_fee_usd),0) fees,
                COALESCE(SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END),0) failed
         FROM trades WHERE ${where}`,
      )
      .get(...args) as { trades: number; pnl: number; gas: number; fees: number; failed: number };
    const bySymbol = this.db
      .prepare(
        `SELECT symbol, SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades, SUM(pnl_usd) pnl, SUM(gas_usd) gas,
                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
         FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`,
      )
      .all(...args) as { symbol: string; trades: number; pnl: number; gas: number; failed: number }[];
    return { total, bySymbol };
  }

  insertTransfer(t: TransferRow): number {
    const cols = Object.keys(t).filter((k) => k !== 'id');
    const r = this.db
      .prepare(`INSERT INTO transfers (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
      .run(t);
    return Number(r.lastInsertRowid);
  }

  updateTransfer(id: number, fields: Partial<TransferRow>): void {
    const f = { ...fields, updated: Date.now() };
    const cols = Object.keys(f).filter((k) => k !== 'id');
    this.db.prepare(`UPDATE transfers SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...f, id });
  }

  openTransfers(): TransferRow[] {
    return this.db.prepare(`SELECT * FROM transfers WHERE status IN ('buying','withdrawing','selling','stuck') ORDER BY id`).all() as TransferRow[];
  }

  getState(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setState(key: string, value: string): void {
    this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
```

## `src/engine.ts`

```ts
// The trading loop: find the best opportunity each block, confirm it, trade both legs, clean up, account.
import type { Config } from './config.js';
import type { Aggregator, Quote, QuoteRequest } from './dex/aggregator.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Book, Order, Side } from './mexc/rest.js';
import type { Db, TradeStatus } from './db.js';
import type { Risk, RiskEvent } from './risk.js';
import type { Token } from './watchlist.js';
import { type Balances, inventoryWarnings, portfolioUsd } from './inventory.js';
import {
  type Opportunity,
  evaluateCexBuy,
  evaluateDexBuy,
  gasUsd,
  planCexBuy,
  planCexBuyQty,
  threshold,
  unwindPlan,
} from './pricing.js';
import { log, errMsg } from './log.js';
import { decimalsOfStep, dhakaDay, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

export const USDC_DECIMALS = 6;
export const ZEROX_ALLOWANCE_HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';
const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';

// Narrow interfaces so tests can plug in fakes.
export interface CexApi {
  limitOrder(symbol: string, side: Side, quantity: string, price: string): Promise<{ orderId: string }>;
  marketSell(symbol: string, quantity: string): Promise<{ orderId: string }>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<Order>;
}
export interface ChainApi {
  readonly address: string;
  gas(): Promise<GasInfo>;
  approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint>;
  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
  send(tx: { to: string; data: string; value?: bigint }, gasLimit: bigint, gas: GasInfo, timeoutSec: number): Promise<TxResult>;
}
export interface Notifier {
  send(text: string): Promise<void>;
}

export interface EngineDeps {
  cfg: Config;
  mexc: CexApi;
  chain: ChainApi;
  agg: Aggregator;
  db: Db;
  risk: Risk;
  tg: Notifier;
  book: (symbol: string) => Promise<Book>;
  balances: () => Promise<Balances>;
  tokens: Token[];
  sleep?: (ms: number) => Promise<void>;
}

export interface Candidate {
  token: Token;
  opp: Opportunity;
  req: QuoteRequest;
  spender: string;
  approvalGas: bigint;
  tokenUsd: number;
}

const mid = (b: Book) => (b.bids[0][0] + b.asks[0][0]) / 2;

export class Engine {
  private lastNote = new Map<string, string>();
  private lastAlert = new Map<string, number>();
  private sleep: (ms: number) => Promise<void>;
  lastGasGwei = 0;

  constructor(private d: EngineDeps) {
    this.sleep = d.sleep ?? realSleep;
  }

  private get cfg() {
    return this.d.cfg;
  }
  private get live() {
    return this.cfg.mode === 'live';
  }
  private get taker() {
    return this.live ? this.d.chain.address : PAPER_TAKER;
  }
  private costs() {
    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
  }
  private need(sizeUsd: number) {
    return threshold(sizeUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
  }

  /** Log a status line only when it changes (avoids spamming every block). */
  private note(key: string, msg: string) {
    if (this.lastNote.get(key) !== msg) {
      this.lastNote.set(key, msg);
      log.info(msg);
    }
  }

  async alertThrottled(key: string, text: string, everyMs = 6 * 3600_000) {
    const last = this.lastAlert.get(key) ?? 0;
    if (Date.now() - last < everyMs) return;
    this.lastAlert.set(key, Date.now());
    await this.d.tg.send(text);
  }

  /** One scan; executes at most one trade. */
  async tick(): Promise<void> {
    const block = this.d.risk.blockReason();
    if (block) return this.note('block', `trading blocked: ${block}`);
    this.note('block', 'trading enabled');

    const gas = await this.d.chain.gas();
    this.lastGasGwei = Number(gas.effective) / 1e9;
    if (this.lastGasGwei > this.cfg.maxGasGwei) {
      return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > MAX_GAS_GWEI ${this.cfg.maxGasGwei}, waiting`);
    }
    this.note('gas', 'gas ok');

    const ethUsd = mid(await this.d.book('ETHUSDT'));
    const bal = await this.d.balances();
    const books = new Map<string, Book>();
    const prices: Record<string, number> = {};
    for (const t of this.d.tokens) {
      try {
        const b = await this.d.book(t.symbol);
        if (b.bids.length && b.asks.length) {
          books.set(t.symbol, b);
          prices[t.base] = mid(b);
        }
      } catch (e) {
        log.warn(`${t.symbol} book: ${errMsg(e)}`);
      }
    }

    if (this.live) {
      for (const w of inventoryWarnings(bal, this.d.tokens, prices, this.cfg.minTradeUsd, this.cfg.minEthForGas)) {
        await this.alertThrottled(`inv-${w.key}`, `📦 Inventory: ${w.text}`);
      }
    }

    let best: Candidate | null = null;
    for (const t of this.d.tokens) {
      const b = books.get(t.symbol);
      if (!b) continue;
      if (!t.depositOk || !t.withdrawOk) {
        this.note(`susp-${t.base}`, `${t.base}: MEXC deposit/withdraw suspended, skipping`);
        continue;
      }
      this.note(`susp-${t.base}`, `${t.base}: active`);
      try {
        for (const c of await this.candidates(t, b, bal, gas, ethUsd)) {
          log.info(`${t.base} ${c.opp.direction} size ${usd(c.opp.sizeUsd)} net ${usd(c.opp.net)} (need ${usd(this.need(c.opp.sizeUsd))})`);
          if (c.opp.net > this.need(c.opp.sizeUsd) && (!best || c.opp.net > best.opp.net)) best = c;
        }
      } catch (e) {
        log.warn(`${t.base} quote: ${errMsg(e)}`);
      }
    }
    if (best) await this.execute(best, gas, ethUsd);
  }

  /** Indicative opportunities in both directions for one token. */
  async candidates(t: Token, b: Book, bal: Balances, gas: GasInfo, ethUsd: number): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const bestBid = b.bids[0][0];
    const tokenUsd = mid(b);
    const cexTok = bal.mexc[t.base] ?? 0;
    const walTok = bal.walletToken[t.base] ?? 0;
    const slippageBps = this.cfg.dexSlippageBps;

    // DEX_BUY: USDC -> token on DEX, token -> USDT on MEXC.
    const sizeA = Math.floor(Math.min(this.cfg.maxTradeUsd, bal.walletUsdc * 0.99, cexTok * bestBid * 0.99) * 100) / 100;
    if (sizeA >= this.cfg.minTradeUsd) {
      const req = { sellToken: this.cfg.usdc, buyToken: t.address, sellAmount: toUnits(sizeA, USDC_DECIMALS), taker: this.taker, slippageBps };
      const q = await this.d.agg.price(req);
      const spender = this.spenderOf(q);
      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
      const opp = evaluateDexBuy({
        sizeUsd: sizeA,
        tokensOut: toFloat(q.buyAmount, t.decimals),
        tokensMin: toFloat(q.minBuyAmount, t.decimals),
        bids: b.bids,
        qtyStep: t.qtyStep,
        gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
        costs: this.costs(),
      });
      if (opp && opp.cexQty <= cexTok) out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
    }

    // CEX_BUY: USDT -> token on MEXC, token -> USDC on DEX.
    const sizeB = Math.min(this.cfg.maxTradeUsd, (bal.mexc.USDT ?? 0) * 0.99, walTok * bestBid * 0.99);
    if (sizeB >= this.cfg.minTradeUsd) {
      const plan = planCexBuy({ sizeUsd: sizeB, asks: b.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
      if (plan && plan.tokensToSell <= walTok) {
        const req = { sellToken: t.address, buyToken: this.cfg.usdc, sellAmount: toUnits(plan.tokensToSell, t.decimals), taker: this.taker, slippageBps };
        const q = await this.d.agg.price(req);
        const spender = this.spenderOf(q);
        const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
        const opp = evaluateCexBuy({
          plan,
          usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
          usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
          gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
          costs: this.costs(),
        });
        out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
      }
    }
    return out;
  }

  private spenderOf(q: Quote): string {
    if (q.spender) return q.spender;
    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
    throw new Error('aggregator did not return a spender');
  }

  /** Re-check with a firm quote + simulation, then trade both legs at once. */
  async execute(c: Candidate, gas: GasInfo, ethUsd: number): Promise<void> {
    const { token: t } = c;
    if (!this.live) return this.recordPaper(c);

    let approvalCostWei = 0n;
    const skip = async (why: string) => {
      log.info(`${t.base} skip: ${why}`);
      if (approvalCostWei > 0n) {
        // The approval gas was really spent; book it so PnL and the loss limit stay honest.
        const g = (Number(approvalCostWei) / 1e18) * ethUsd;
        this.record(c, 'approval', { pnl: -g, gas: g, note: `approval, then skipped: ${why}` });
      }
    };

    // 1) Exact approval (never unlimited).
    if (c.approvalGas > 0n) {
      const r = await this.d.chain.approveExact(c.req.sellToken, c.spender, c.req.sellAmount, gas);
      approvalCostWei = r.gasCostWei;
      if (!r.ok) {
        await skip(`approval failed (${r.reason})`);
        await this.d.tg.send(`⚠️ Approval failed for ${t.base}: ${r.reason} ${r.hash ?? ''}`);
        return;
      }
    }

    // 2) Firm quote + simulation (eth_call). Abort on any doubt.
    let firm: Quote;
    let gasEst: bigint;
    try {
      firm = await this.d.agg.quote(c.req);
      if (!firm.tx) return skip('firm quote has no transaction');
      gasEst = await this.d.chain.simulate(firm.tx);
    } catch (e) {
      return skip(`simulation/quote failed: ${errMsg(e)}`);
    }
    const tx = firm.tx;

    // 3) Re-evaluate with fresh book, firm amounts and simulated gas.
    const b = await this.d.book(t.symbol);
    const g = gasUsd(gasEst, gas.effective, ethUsd);
    let opp: Opportunity | null;
    if (c.opp.direction === 'DEX_BUY') {
      opp = evaluateDexBuy({
        sizeUsd: c.opp.sizeUsd,
        tokensOut: toFloat(firm.buyAmount, t.decimals),
        tokensMin: toFloat(firm.minBuyAmount, t.decimals),
        bids: b.bids,
        qtyStep: t.qtyStep,
        gasUsd: g,
        costs: this.costs(),
      });
    } else {
      // Same quantity as quoted on the DEX, priced against the fresh MEXC book.
      const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.cfg.mexcTakerFee);
      opp = plan
        ? evaluateCexBuy({
            plan,
            usdcOut: toFloat(firm.buyAmount, USDC_DECIMALS),
            usdcMin: toFloat(firm.minBuyAmount, USDC_DECIMALS),
            gasUsd: g,
            costs: this.costs(),
          })
        : null;
    }
    const need = this.need(c.opp.sizeUsd);
    if (!opp || opp.net <= need) return skip(`profit fell to ${usd(opp?.net ?? 0)} after firm quote (need ${usd(need)})`);

    // 4) Both legs at the same time.
    const before = await this.d.balances();
    log.info(`${t.base} EXECUTE ${opp.direction} size ${usd(opp.sizeUsd)} expected ${usd(opp.net)}`);
    const [cexR, dexR] = await Promise.allSettled([
      this.cexLeg(t, opp),
      this.d.chain.send(tx, (gasEst * 13n) / 10n, gas, this.cfg.txTimeoutSec),
    ]);

    const dex: TxResult = dexR.status === 'fulfilled' ? dexR.value : { ok: false, gasCostWei: 0n, reason: errMsg(dexR.reason) };
    let cexFilled = 0;
    let orderId: string | null = null;
    let cexUnknown = false;
    if (cexR.status === 'fulfilled') {
      cexFilled = cexR.value.filled;
      orderId = cexR.value.orderId;
    } else if (String((cexR.reason as Error)?.message ?? '').startsWith('UNKNOWN_ORDER_STATE')) {
      cexUnknown = true;
      this.d.risk.pause('MEXC order state unknown');
      await this.d.tg.send(`🚨 ${t.base}: MEXC order state unknown after placing. Trading PAUSED. Check MEXC manually.\n${errMsg(cexR.reason)}`);
    } else {
      log.warn(`${t.base} MEXC leg failed: ${errMsg(cexR.reason)}`);
    }

    // 5) One-sided? Close the open position at market right away.
    let status: TradeStatus = 'ok';
    const notes: string[] = [];
    if (!dex.ok) notes.push(`DEX: ${dex.reason}`);
    const unwind = cexUnknown ? null : unwindPlan(opp.direction, dex.ok, opp.cexQty, cexFilled, this.cfg.mexcTakerFee, t.qtyStep);
    if (cexUnknown) {
      status = 'one_sided';
    } else if (unwind) {
      status = 'one_sided';
      const qty = unwind.qty.toFixed(decimalsOfStep(t.qtyStep));
      try {
        const r = await this.closeAtMarket(t, unwind.side, qty);
        notes.push(`unwind ${unwind.side} ${qty} @market (${r.orderId}, filled ${r.filled})`);
        await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base} ${opp.direction}\n${unwind.reason}\nClosed: MEXC MARKET ${unwind.side} ${qty} ${t.base}`);
      } catch (e) {
        this.d.risk.pause(`unwind failed for ${t.base}`);
        notes.push(`UNWIND FAILED: ${errMsg(e)}`);
        await this.d.tg.send(
          `🚨 ONE-SIDED FILL ${t.base} and the market close FAILED: ${errMsg(e)}\n` +
            `Open position: MEXC ${unwind.side} ${qty} ${t.base} still needed.\nTrading PAUSED. Close it manually, then /start.`,
        );
      }
    } else if (!dex.ok) {
      status = 'dex_failed'; // nothing filled on either side
    }

    // 6) Exact PnL = change in total value of everything the trade touched, at pre-trade prices.
    await this.sleep(2500); // let MEXC balances settle
    const after = await this.d.balances();
    const pnl = portfolioUsd(after, t, c.tokenUsd, ethUsd) - portfolioUsd(before, t, c.tokenUsd, ethUsd);
    const gasPaid = (Number(dex.gasCostWei + approvalCostWei) / 1e18) * ethUsd;
    this.record({ ...c, opp }, status, { pnl, gas: gasPaid, dexTx: dex.hash, orderId, note: notes.join('; ') || null });

    const dexIsBuy = opp.direction === 'DEX_BUY';
    await this.d.tg.send(
      [
        `${status === 'ok' ? '✅' : '⚠️'} LIVE ${t.base} ${opp.direction} [${status}]`,
        `Buy  ${dexIsBuy ? 'DEX ' : 'MEXC'} @ ${opp.buyPrice.toPrecision(6)}`,
        `Sell ${dexIsBuy ? 'MEXC' : 'DEX '} @ ${opp.sellPrice.toPrecision(6)}`,
        `Qty ${opp.cexQty} ${t.base} | size ${usd(opp.sizeUsd)}`,
        `MEXC fee ${usd(opp.cexFeeUsd)} | Gas ${usd(gasPaid)}`,
        `Expected ${usd(opp.net)} | Net PnL ${usd(pnl)}`,
        dex.hash ? `https://etherscan.io/tx/${dex.hash}` : '',
        notes.length ? `Notes: ${notes.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    await this.handleRisk(this.d.risk.afterTrade(status));
  }

  /**
   * Close a position on MEXC now. SELL uses a MARKET order. BUY uses a LIMIT 2% above the best ask
   * (MEXC documents MARKET buys by quote amount only, and we need an exact token quantity).
   */
  async closeAtMarket(t: Token, side: Side, qty: string): Promise<{ orderId: string; filled: number }> {
    if (side === 'SELL') {
      const { orderId } = await this.d.mexc.marketSell(t.symbol, qty);
      return { orderId, filled: Number(qty) };
    }
    const b = await this.d.book(t.symbol);
    const f = 10 ** t.priceDecimals;
    const px = (Math.ceil(b.asks[0][0] * 1.02 * f) / f).toFixed(t.priceDecimals);
    const { orderId } = await this.d.mexc.limitOrder(t.symbol, 'BUY', qty, px);
    await this.sleep(1500);
    let o = await this.d.mexc.getOrder(t.symbol, orderId);
    if (o.status !== 'FILLED') {
      await this.d.mexc.cancelOrder(t.symbol, orderId).catch(() => {});
      o = await this.d.mexc.getOrder(t.symbol, orderId);
      if (Number(o.executedQty) < Number(qty) * 0.999) throw new Error(`close BUY only filled ${o.executedQty}/${qty}`);
    }
    return { orderId, filled: Number(o.executedQty) };
  }

  /** MEXC marketable limit order; cancels any unfilled rest. Returns filled quantity. */
  async cexLeg(t: Token, opp: Opportunity): Promise<{ orderId: string; filled: number }> {
    const side: Side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
    const qty = opp.cexQty.toFixed(decimalsOfStep(t.qtyStep));
    const f = 10 ** t.priceDecimals;
    const px = side === 'SELL' ? Math.floor(opp.cexLimitPrice * f) / f : Math.ceil(opp.cexLimitPrice * f) / f;
    const { orderId } = await this.d.mexc.limitOrder(t.symbol, side, qty, px.toFixed(t.priceDecimals));
    log.info(`MEXC ${side} ${qty} ${t.symbol} @ ${px} id=${orderId}`);
    await this.sleep(1500);

    const read = async (): Promise<Order> => {
      for (let i = 0; i < 3; i++) {
        try {
          return await this.d.mexc.getOrder(t.symbol, orderId);
        } catch (e) {
          log.warn(`getOrder retry: ${errMsg(e)}`);
          await this.sleep(1000);
        }
      }
      throw new Error(`UNKNOWN_ORDER_STATE ${orderId}`);
    };
    let o = await read();
    if (o.status !== 'FILLED') {
      await this.d.mexc.cancelOrder(t.symbol, orderId).catch((e) => log.warn(`cancel: ${errMsg(e)}`));
      await this.sleep(500);
      o = await read();
    }
    return { orderId, filled: Number(o.executedQty) };
  }

  private async recordPaper(c: Candidate) {
    const { token: t, opp } = c;
    this.record(c, 'paper', { pnl: opp.net, gas: opp.gasUsd });
    await this.d.tg.send(
      `📝 PAPER ${t.base} ${opp.direction}\nBuy @ ${opp.buyPrice.toPrecision(6)} | Sell @ ${opp.sellPrice.toPrecision(6)}\n` +
        `Qty ${opp.cexQty} | size ${usd(opp.sizeUsd)} | fee ${usd(opp.cexFeeUsd)} | gas ${usd(opp.gasUsd)}\nNet ${usd(opp.net)}`,
    );
    await this.handleRisk(this.d.risk.afterTrade('paper'));
  }

  private record(
    c: Candidate,
    status: TradeStatus,
    r: { pnl: number; gas: number; dexTx?: string; orderId?: string | null; note?: string | null },
  ) {
    const now = Date.now();
    this.d.db.insertTrade({
      ts: now,
      day: dhakaDay(now),
      mode: this.cfg.mode,
      symbol: c.token.base,
      direction: c.opp.direction,
      size_usd: c.opp.sizeUsd,
      qty: c.opp.cexQty,
      buy_price: c.opp.buyPrice,
      sell_price: c.opp.sellPrice,
      expected_net: c.opp.net,
      cex_fee_usd: status === 'approval' ? 0 : c.opp.cexFeeUsd,
      gas_usd: r.gas,
      pnl_usd: r.pnl,
      status,
      dex_tx: r.dexTx ?? null,
      cex_order_id: r.orderId ?? null,
      note: r.note ?? null,
    });
  }

  private async handleRisk(events: RiskEvent[]) {
    for (const e of events) {
      if (e.kind === 'loss_limit') await this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). Trading STOPPED. Send /start to resume.`);
      if (e.kind === 'fail_streak') await this.d.tg.send(`🛑 ${e.count} failed trades in a row. Trading PAUSED. Check logs, then /start.`);
      if (e.kind === 'trade_limit') await this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}). Resumes tomorrow (Dhaka time).`);
    }
  }
}
```

## `src/inventory.ts`

```ts
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

export async function snapshot(chain: Chain, mexc: MexcRest, usdc: string, tokens: Token[]): Promise<Balances> {
  const [eth, usdcBal, mexcBal, ...toks] = await Promise.all([
    chain.ethBalance(),
    chain.tokenBalance(usdc),
    mexc.balances(),
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
```

## `src/log.ts`

```ts
// Console logger that scrubs secrets (private key, API keys, bot token) from every line.

let secrets: string[] = [];

export function registerSecrets(values: string[]): void {
  secrets = [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function fmt(args: unknown[]): string {
  return redact(
    args
      .map((a) => (a instanceof Error ? `${a.message}` : typeof a === 'string' ? a : JSON.stringify(a, bigintSafe)))
      .join(' '),
  );
}

export function bigintSafe(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { shortMessage?: string; message?: string };
    return redact(o.shortMessage || o.message || String(e));
  }
  return redact(String(e));
}

const ts = () => new Date().toISOString();
export const log = {
  info: (...a: unknown[]) => console.log(`${ts()} INFO  ${fmt(a)}`),
  warn: (...a: unknown[]) => console.warn(`${ts()} WARN  ${fmt(a)}`),
  error: (...a: unknown[]) => console.error(`${ts()} ERROR ${fmt(a)}`),
};
```

## `src/main.ts`

```ts
// Entry point. Wires everything together, runs one scan per Ethereum block.
import fs from 'node:fs';
import { loadConfig, secretsOf } from './config.js';
import { log, errMsg, registerSecrets } from './log.js';
import { Db } from './db.js';
import { Risk } from './risk.js';
import { Telegram } from './telegram.js';
import { MexcRest } from './mexc/rest.js';
import { MexcBookStream } from './mexc/ws.js';
import { Chain } from './dex/chain.js';
import { OneInch, ZeroEx, type Aggregator } from './dex/aggregator.js';
import { buildWatchlist, refreshStatus } from './watchlist.js';
import { paperBalances, snapshot } from './inventory.js';
import { Engine } from './engine.js';
import { TransferEngine } from './transfer.js';
import { formatReport } from './summary.js';
import { dhakaDay, dhakaHourMinute, usd } from './util.js';

const cfg = loadConfig();
registerSecrets(secretsOf(cfg));

/** Refuse to trade live if .env is readable by other users. */
function checkEnvPermissions(path: string) {
  if (!fs.existsSync(path)) return log.warn(`${path} not found; make sure secrets come from a protected place`);
  const mode = fs.statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} has permissions ${mode.toString(8)}; run: chmod 600 ${path}`);
}

async function main() {
  if (cfg.mode === 'live') checkEnvPermissions(cfg.envPath);

  const db = new Db(cfg.dbPath);
  const risk = new Risk(db, cfg.mode, cfg);
  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId);
  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei);
  const agg: Aggregator = cfg.aggregator === '0x' ? new ZeroEx(cfg.zeroExApiKey) : new OneInch(cfg.oneInchApiKey);

  // --- Pre-flight checks ---
  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
  if (chainId !== 1n) throw new Error(`RPC_URL is chain ${chainId}, expected Ethereum mainnet (1)`);
  if (cfg.mode === 'live') {
    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
    const acc = await mexc.account();
    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
    log.info(`wallet ${chain.address}`);
  }

  if (cfg.strategy === 'transfer') return runTransfer(db, risk, tg, mexc, chain, agg);

  const tokens = await buildWatchlist(mexc, (a) => chain.decimals(a), {
    only: cfg.watchlist,
    max: cfg.watchlistMax,
    minTvlUsd: cfg.minDexTvlUsd,
    minVolumeUsd: cfg.minMexcVolumeUsd,
  });
  if (tokens.length === 0) throw new Error('Watchlist is empty: no token passed the filters');
  log.info(`watchlist: ${tokens.map((t) => `${t.base}(${t.address.slice(0, 8)}…, tvl $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`);

  const stream = new MexcBookStream(['ETHUSDT', ...tokens.map((t) => t.symbol)]);
  stream.start();
  const book = async (symbol: string) => stream.get(symbol) ?? mexc.depth(symbol, 20);
  const balances = cfg.mode === 'live' ? () => snapshot(chain, mexc, cfg.usdc, tokens) : async () => paperBalances(tokens);

  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, balances, tokens });

  // --- Telegram commands ---
  const statusText = async () => {
    const t = risk.today();
    const lines = [
      `MODE=${cfg.mode} | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, max gas ${cfg.maxGasGwei} gwei (now ${engine.lastGasGwei.toFixed(1)})`,
      `Fail streak: ${risk.consecutiveFails}/${cfg.maxConsecutiveFails}`,
    ];
    if (cfg.mode === 'live') {
      try {
        const b = await balances();
        lines.push(`Wallet: ${b.walletEth.toFixed(4)} ETH, ${usd(b.walletUsdc)} USDC | MEXC: ${usd(b.mexc.USDT ?? 0)} USDT`);
        for (const tk of tokens) {
          lines.push(`  ${tk.base}: wallet ${(b.walletToken[tk.base] ?? 0).toFixed(4)} | MEXC ${(b.mexc[tk.base] ?? 0).toFixed(4)}${tk.depositOk && tk.withdrawOk ? '' : ' (suspended)'}`);
        }
      } catch (e) {
        lines.push(`Inventory error: ${errMsg(e)}`);
      }
    }
    return lines.join('\n');
  };
  void tg.startPolling({
    '/stop': () => {
      risk.pause('Telegram /stop');
      return '🛑 Trading STOPPED. Send /start to resume.';
    },
    '/start': () => {
      risk.resume();
      const block = risk.blockReason();
      return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
    },
    '/status': statusText,
  });

  // --- Main loop: one scan per block ---
  let busy = false;
  let errors = 0;
  chain.provider.on('block', async () => {
    if (busy) return;
    busy = true;
    try {
      await engine.tick();
      errors = 0;
    } catch (e) {
      errors++;
      log.error(`tick: ${errMsg(e)}`);
      if (errors >= 5) await engine.alertThrottled('tick-errors', `❗ Bot errors (${errors} in a row): ${errMsg(e)}`, 3600_000);
    } finally {
      busy = false;
    }
  });

  // MEXC deposit/withdraw status every 10 minutes.
  setInterval(async () => {
    try {
      const changed = await refreshStatus(mexc, tokens);
      if (changed.length) await tg.send(`ℹ️ MEXC network status changed:\n${changed.join('\n')}`);
    } catch (e) {
      log.warn(`status refresh: ${errMsg(e)}`);
    }
  }, 10 * 60_000);

  // Daily summary at 23:00 Bangladesh time.
  setInterval(async () => {
    const { hour } = dhakaHourMinute();
    const today = dhakaDay();
    if (hour === 23 && db.getState('last_summary_day') !== today) {
      db.setState('last_summary_day', today);
      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
    }
  }, 30_000);

  const shutdown = async (why: string, code: number) => {
    await tg.send(`🔌 Bot stopped: ${why}`);
    stream.stop();
    tg.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('unhandledRejection', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));

  await tg.send(
    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} via ${agg.name}\nTokens: ${tokens.map((t) => t.base).join(', ')}\n` +
      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
  );
}

/** TRANSFER strategy: scan every MEXC ERC20 token, buy on MEXC, withdraw, sell on DEX. */
async function runTransfer(db: Db, risk: Risk, tg: Telegram, mexc: MexcRest, chain: Chain, agg: Aggregator) {
  const engine = new TransferEngine({ cfg, mexc, chain, agg, db, risk, tg });
  await engine.refreshUniverse(true);
  if (engine.universe.length === 0) throw new Error('No MEXC ERC20 token passed the filters');

  void tg.startPolling({
    '/stop': () => {
      risk.pause('Telegram /stop');
      return '🛑 New trades STOPPED. An open transfer still finishes (selling the tokens already bought is the safe exit). /start to resume.';
    },
    '/start': () => {
      risk.resume();
      const block = risk.blockReason();
      return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
    },
    '/status': async () => {
      const t = risk.today();
      const open = db.openTransfers();
      const lines = [
        `MODE=${cfg.mode} STRATEGY=transfer | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
        `Scanning ${engine.universe.length} MEXC ERC20 tokens every ${cfg.scanIntervalSec}s`,
        `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
        `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, gas ${engine.lastGasGwei.toFixed(1)}/${cfg.maxGasGwei} gwei`,
        `Top gaps: ${engine.lastTopGaps.map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ') || 'none'}`,
        open.length ? `Open: ${open.map((o) => `#${o.id} ${o.base} ${o.status}`).join(', ')}` : 'Open transfers: none',
      ];
      if (cfg.mode === 'live') {
        try {
          const b = await mexc.balances();
          const eth = await chain.ethBalance();
          const usdc = await chain.tokenBalance(cfg.usdc);
          lines.push(`MEXC ${usd(b.USDT ?? 0)} USDT | wallet ${(Number(eth) / 1e18).toFixed(4)} ETH, ${usd(Number(usdc) / 1e6)} USDC`);
        } catch (e) {
          lines.push(`Balance error: ${errMsg(e)}`);
        }
      }
      return lines.join('\n');
    },
  });

  let busy = false;
  let errors = 0;
  let lastLow = 0;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      await engine.tick();
      errors = 0;
      // MEXC USDT is spent by buys and comes back only when you move USDC from the wallet to MEXC.
      if (cfg.mode === 'live' && Date.now() - lastLow > 6 * 3600_000) {
        const usdt = (await mexc.balances()).USDT ?? 0;
        const eth = Number(await chain.ethBalance()) / 1e18;
        if (usdt < cfg.minTradeUsd || eth < cfg.minEthForGas) {
          lastLow = Date.now();
          await tg.send(`📦 Rebalance needed: MEXC USDT ${usd(usdt)}, wallet ETH ${eth.toFixed(4)}. Move USDC profits from the wallet back to MEXC.`);
        }
      }
    } catch (e) {
      errors++;
      log.error(`scan: ${errMsg(e)}`);
      if (errors === 5) await tg.send(`❗ Bot errors (5 in a row): ${errMsg(e)}`);
    } finally {
      busy = false;
    }
  };
  setInterval(loop, cfg.scanIntervalSec * 1000);
  void loop();

  setInterval(async () => {
    const today = dhakaDay();
    if (dhakaHourMinute().hour === 23 && db.getState('last_summary_day') !== today) {
      db.setState('last_summary_day', today);
      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
    }
  }, 30_000);

  const shutdown = async (why: string, code: number) => {
    await tg.send(`🔌 Bot stopped: ${why}`);
    tg.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('unhandledRejection', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));

  const open = db.openTransfers();
  await tg.send(
    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} STRATEGY=transfer via ${agg.name}\n` +
      `Scanning ${engine.universe.length} MEXC ERC20 tokens (buy MEXC -> withdraw -> sell DEX)\n` +
      (open.length ? `Resuming ${open.length} open transfer(s)\n` : '') +
      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
  );
}

main().catch(async (e) => {
  log.error(`startup failed: ${errMsg(e)}`);
  await new Telegram(cfg.telegramToken, cfg.telegramChatId).send(`❗ Bot failed to start: ${errMsg(e)}`);
  process.exit(1);
});
```

## `src/pricing.ts`

```ts
// Pure profit math. No I/O, so it is fully unit tested.
//
// net = sell value - buy value - MEXC taker fee - gas - slippage (both sides) - safety margin
// DEX fees are already inside the aggregator's buyAmount.
import type { Level } from './mexc/rest.js';
import { floorToStep } from './util.js';

export type Direction = 'DEX_BUY' | 'CEX_BUY';
// DEX_BUY: buy token on DEX with USDC, sell token on MEXC for USDT.
// CEX_BUY: buy token on MEXC with USDT, sell token on DEX for USDC.

export interface CostParams {
  takerFee: number; // 0.0005 = 0.05%
  cexSlippageBps: number;
  safetyMarginUsd: number;
}

export interface Opportunity {
  direction: Direction;
  sizeUsd: number; // USD put into the buy leg
  cexQty: number; // token quantity for the MEXC order
  cexLimitPrice: number; // worst acceptable MEXC price (book walk + slippage)
  dexTokens: number; // tokens bought (DEX_BUY) or sold (CEX_BUY) on the DEX
  buyPrice: number; // effective USD per token paid
  sellPrice: number; // effective USD per token received
  cexFeeUsd: number;
  gasUsd: number;
  slippageUsd: number;
  net: number;
}

/** Sell `qty` base into bids. */
export function fillBase(levels: Level[], qty: number): { quote: number; worst: number } | null {
  let left = qty;
  let quote = 0;
  let worst = 0;
  for (const [price, size] of levels) {
    if (left <= 1e-12) break;
    const take = Math.min(left, size);
    quote += take * price;
    worst = price;
    left -= take;
  }
  return left <= 1e-9 * Math.max(1, qty) ? { quote, worst } : null;
}

/** Spend `quoteAmount` on asks; returns base quantity bought. */
export function fillQuote(levels: Level[], quoteAmount: number): { qty: number; worst: number } | null {
  let left = quoteAmount;
  let qty = 0;
  let worst = 0;
  for (const [price, size] of levels) {
    if (left <= 1e-9) break;
    const cost = Math.min(left, size * price);
    qty += cost / price;
    worst = price;
    left -= cost;
  }
  return left <= 1e-6 ? { qty, worst } : null;
}

export function threshold(sizeUsd: number, minProfitUsd: number, minProfitPct: number): number {
  return Math.max(minProfitUsd, (sizeUsd * minProfitPct) / 100);
}

/**
 * DEX_BUY: we spent `sizeUsd` USDC on the DEX for `tokensOut` (floor `tokensMin`) and sell them on MEXC bids.
 */
export function evaluateDexBuy(p: {
  sizeUsd: number;
  tokensOut: number;
  tokensMin: number;
  bids: Level[];
  qtyStep: number;
  gasUsd: number;
  costs: CostParams;
}): Opportunity | null {
  const qty = floorToStep(p.tokensOut, p.qtyStep);
  if (qty <= 0) return null;
  const fill = fillBase(p.bids, qty);
  if (!fill) return null;
  const sellPrice = fill.quote / qty;
  const cexFeeUsd = fill.quote * p.costs.takerFee;
  const cexSlip = (fill.quote * p.costs.cexSlippageBps) / 10_000;
  const dexSlip = Math.max(0, p.tokensOut - p.tokensMin) * sellPrice;
  const slippageUsd = cexSlip + dexSlip;
  // Leftover dust (tokensOut - qty) stays in inventory; it is not counted as profit.
  const dustUsd = (p.tokensOut - qty) * sellPrice;
  const net = fill.quote - cexFeeUsd - (p.sizeUsd - dustUsd) - p.gasUsd - slippageUsd - p.costs.safetyMarginUsd;
  return {
    direction: 'DEX_BUY',
    sizeUsd: p.sizeUsd,
    cexQty: qty,
    cexLimitPrice: fill.worst * (1 - p.costs.cexSlippageBps / 10_000),
    dexTokens: p.tokensOut,
    buyPrice: p.sizeUsd / p.tokensOut,
    sellPrice,
    cexFeeUsd,
    gasUsd: p.gasUsd,
    slippageUsd,
    net,
  };
}

/**
 * CEX_BUY step 1: how many tokens `sizeUsd` USDT buys on MEXC asks.
 * MEXC charges the buy fee in the token, so we only sell qty * (1 - fee) on the DEX.
 */
export function planCexBuy(p: { sizeUsd: number; asks: Level[]; qtyStep: number; takerFee: number }) {
  const f = fillQuote(p.asks, p.sizeUsd);
  if (!f) return null;
  const qty = floorToStep(f.qty, p.qtyStep);
  if (qty <= 0) return null;
  const fill = fillBase(p.asks, qty);
  if (!fill) return null;
  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - p.takerFee) };
}

/** CEX_BUY plan for an exact quantity (used when re-checking a trade with a fresh book). */
export function planCexBuyQty(asks: Level[], qty: number, takerFee: number) {
  const fill = fillBase(asks, qty);
  if (!fill) return null;
  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - takerFee) };
}

/** CEX_BUY step 2: given the DEX quote for selling those tokens, compute net. */
export function evaluateCexBuy(p: {
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  usdcOut: number;
  usdcMin: number;
  gasUsd: number;
  costs: CostParams;
}): Opportunity {
  const { plan } = p;
  const buyPrice = plan.costUsd / plan.qty;
  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
  const cexSlip = (plan.costUsd * p.costs.cexSlippageBps) / 10_000;
  const dexSlip = Math.max(0, p.usdcOut - p.usdcMin);
  const slippageUsd = cexSlip + dexSlip;
  // cost already includes the token fee implicitly: we paid for qty but only sell qty*(1-fee).
  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - p.costs.safetyMarginUsd;
  return {
    direction: 'CEX_BUY',
    sizeUsd: plan.costUsd,
    cexQty: plan.qty,
    cexLimitPrice: plan.worst * (1 + p.costs.cexSlippageBps / 10_000),
    dexTokens: plan.tokensToSell,
    buyPrice,
    sellPrice: p.usdcOut / plan.tokensToSell,
    cexFeeUsd,
    gasUsd: p.gasUsd,
    slippageUsd,
    net,
  };
}

/** Gas cost in USD for `gasUnits` at `weiPerGas`. */
export function gasUsd(gasUnits: bigint, weiPerGas: bigint, ethUsd: number): number {
  return (Number(gasUnits * weiPerGas) / 1e18) * ethUsd;
}

/**
 * What to do after both legs ran. Returns the MEXC market order needed to get flat again (or null).
 * cexFilled is the MEXC executed quantity.
 */
export function unwindPlan(
  direction: Direction,
  dexOk: boolean,
  cexQty: number,
  cexFilled: number,
  takerFee: number,
  qtyStep: number,
): { side: 'BUY' | 'SELL'; qty: number; reason: string } | null {
  const mk = (side: 'BUY' | 'SELL', q: number, reason: string) => {
    const qty = floorToStep(q, qtyStep);
    return qty > 0 ? { side, qty, reason } : null;
  };
  if (direction === 'DEX_BUY') {
    // Wanted: +tokens in wallet (DEX), -tokens on MEXC (sell).
    if (!dexOk) return mk('BUY', cexFilled, 'DEX leg failed: buy back what was sold on MEXC');
    return mk('SELL', cexQty - cexFilled, 'MEXC sell only partly filled: sell the rest at market');
  }
  // CEX_BUY wanted: +tokens on MEXC (buy), -tokens in wallet (DEX sell).
  if (!dexOk) return mk('SELL', cexFilled * (1 - takerFee), 'DEX leg failed: sell what was bought on MEXC');
  return mk('BUY', cexQty - cexFilled, 'MEXC buy only partly filled: buy the rest at market');
}

/**
 * TRANSFER: buy on MEXC -> withdraw to wallet -> sell on DEX. Not atomic: the price can move
 * while the withdrawal is on its way, so `driftBps` of the sale value is reserved as extra risk cost.
 */
export function evaluateTransfer(p: {
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  withdrawFeeTokens: number; // MEXC withdraw fee, paid in the token
  usdcOut: number; // DEX quote for selling the tokens that arrive
  usdcMin: number;
  gasUsd: number; // approval + swap
  driftBps: number;
  costs: CostParams;
}) {
  const { plan } = p;
  const arriving = plan.tokensToSell - p.withdrawFeeTokens;
  const buyPrice = plan.costUsd / plan.qty;
  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
  const withdrawFeeUsd = p.withdrawFeeTokens * buyPrice;
  const slippageUsd = (plan.costUsd * p.costs.cexSlippageBps) / 10_000 + Math.max(0, p.usdcOut - p.usdcMin);
  const driftUsd = (p.usdcOut * p.driftBps) / 10_000;
  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - driftUsd - p.costs.safetyMarginUsd;
  return {
    arriving,
    buyPrice,
    sellPrice: arriving > 0 ? p.usdcOut / arriving : 0,
    cexFeeUsd,
    withdrawFeeUsd,
    slippageUsd,
    driftUsd,
    gasUsd: p.gasUsd,
    costUsd: plan.costUsd,
    net,
  };
}
```

## `src/report.ts`

```ts
// npm run report -- [hours] [mode]   e.g. `npm run report -- 24 live`
import 'dotenv/config';
import { Db } from './db.js';
import { formatReport } from './summary.js';

const hours = Number(process.argv[2] ?? 24);
const mode = process.argv[3] ?? process.env.MODE ?? 'live';
const db = new Db(process.env.DB_PATH || 'data/bot.sqlite');
console.log(formatReport(db, mode, hours, 'Report'));
db.close();
```

## `src/risk.ts`

```ts
// Risk limits: daily trade count, daily loss limit, failure streak, manual kill switch.
// All state lives in SQLite, so a restart (pm2) never resets the limits.
import type { Db, TradeStatus } from './db.js';
import { dhakaDay } from './util.js';

export interface RiskLimits {
  maxTradesPerDay: number;
  dailyLossLimitUsd: number;
  maxConsecutiveFails: number;
}

export type RiskEvent =
  | { kind: 'loss_limit'; pnl: number }
  | { kind: 'fail_streak'; count: number }
  | { kind: 'trade_limit'; trades: number };

export class Risk {
  constructor(private db: Db, private mode: string, private limits: RiskLimits, private now = () => Date.now()) {}

  get paused(): boolean {
    return this.db.getState('paused') === '1';
  }
  get pauseReason(): string {
    return this.db.getState('pause_reason') ?? '';
  }
  get consecutiveFails(): number {
    return Number(this.db.getState('consecutive_fails') ?? '0');
  }

  pause(reason: string): void {
    this.db.setState('paused', '1');
    this.db.setState('pause_reason', reason);
  }

  resume(): void {
    this.db.setState('paused', '0');
    this.db.setState('pause_reason', '');
    this.db.setState('consecutive_fails', '0');
  }

  today() {
    return this.db.dayStats(dhakaDay(this.now()), this.mode);
  }

  /** null = allowed, otherwise the reason trading is blocked right now. */
  blockReason(): string | null {
    if (this.paused) return `paused: ${this.pauseReason}`;
    const t = this.today();
    if (t.trades >= this.limits.maxTradesPerDay) return `daily trade limit reached (${t.trades})`;
    if (t.pnl <= -this.limits.dailyLossLimitUsd) return `daily loss limit reached (${t.pnl.toFixed(2)})`;
    return null;
  }

  /** Update streaks after a trade; returns events that need an alert. */
  afterTrade(status: TradeStatus): RiskEvent[] {
    const events: RiskEvent[] = [];
    if (status === 'ok' || status === 'paper') {
      this.db.setState('consecutive_fails', '0');
    } else {
      const n = this.consecutiveFails + 1;
      this.db.setState('consecutive_fails', String(n));
      if (n >= this.limits.maxConsecutiveFails) {
        this.pause(`${n} failed trades in a row`);
        events.push({ kind: 'fail_streak', count: n });
      }
    }
    const t = this.today();
    if (t.pnl <= -this.limits.dailyLossLimitUsd) {
      this.pause(`daily loss limit hit (${t.pnl.toFixed(2)} USD)`);
      events.push({ kind: 'loss_limit', pnl: t.pnl });
    }
    if (t.trades >= this.limits.maxTradesPerDay) events.push({ kind: 'trade_limit', trades: t.trades });
    return events;
  }
}
```

## `src/scanner.ts`

```ts
// Continuously scans EVERY MEXC USDT pair whose coin is an Ethereum (ERC20) token,
// and finds tokens that are cheaper on MEXC than on Ethereum DEXs.
//
// Cheap first pass (2 + N/30 HTTP calls per scan):
//   MEXC bookTicker (all symbols, one call)  vs  DexScreener price (30 tokens per call)
// Only the biggest gaps then get an exact, size-specific aggregator quote (see transfer.ts).
import type { MexcRest } from './mexc/rest.js';
import { ethNetwork } from './watchlist.js';

export interface ScanToken {
  base: string;
  symbol: string;
  address: string; // lowercase, from MEXC's own deposit info -> same token as on-chain
  netWork: string; // MEXC network id for withdrawals
  withdrawFee: number; // tokens
  withdrawMin: number;
  qtyStep: number;
  priceDecimals: number;
  volumeUsd: number;
}

export interface Gap {
  token: ScanToken;
  ask: number; // MEXC best ask
  dexPrice: number; // DexScreener price of the deepest Ethereum pool
  tvlUsd: number;
  gapPct: number; // (dexPrice / ask - 1) * 100, positive = MEXC cheaper
}

const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH']);

/** All tradable MEXC/USDT ERC20 tokens with deposits AND withdrawals open and enough volume. */
export async function loadUniverse(
  mexc: Pick<MexcRest, 'exchangeInfo' | 'tickers24h' | 'coinConfigs'>,
  opts: { minVolumeUsd: number; only: string[] },
): Promise<ScanToken[]> {
  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
  const out: ScanToken[] = [];
  for (const s of symbols) {
    const base = s.baseAsset.toUpperCase();
    if (s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed || String(s.status) !== '1' || SKIP.has(base)) continue;
    if (opts.only.length && !opts.only.includes(base)) continue;
    const vol = volume.get(s.symbol) ?? 0;
    if (vol < opts.minVolumeUsd) continue;
    const coin = coinBy.get(base);
    const net = coin && ethNetwork(coin);
    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue;
    if (!net.depositEnable || !net.withdrawEnable) continue; // suspended -> skip
    out.push({
      base,
      symbol: s.symbol,
      address: net.contract.toLowerCase(),
      netWork: net.netWork ?? net.network,
      withdrawFee: Number(net.withdrawFee ?? 0),
      withdrawMin: Number(net.withdrawMin ?? 0),
      qtyStep: Number(s.baseSizePrecision) || 10 ** -(s.baseAssetPrecision ?? 2),
      priceDecimals: s.quotePrecision,
      volumeUsd: vol,
    });
  }
  return out;
}

type FetchFn = typeof fetch;

/** DexScreener prices for many tokens (30 per request). Uses each token's deepest Ethereum pool. */
export async function dexPrices(addresses: string[], fetchFn: FetchFn = fetch): Promise<Map<string, { price: number; tvl: number }>> {
  const out = new Map<string, { price: number; tvl: number }>();
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const res = await fetchFn(`https://api.dexscreener.com/tokens/v1/ethereum/${chunk.join(',')}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const pairs = (await res.json()) as { chainId: string; priceUsd?: string; liquidity?: { usd?: number }; baseToken: { address: string } }[];
    for (const p of pairs) {
      if (p.chainId !== 'ethereum' || !p.priceUsd) continue;
      const addr = p.baseToken.address.toLowerCase(); // priceUsd is the price of baseToken
      const tvl = p.liquidity?.usd ?? 0;
      if (!out.has(addr) || tvl > out.get(addr)!.tvl) out.set(addr, { price: Number(p.priceUsd), tvl });
    }
  }
  return out;
}

/** Tokens cheaper on MEXC than on DEX by at least minGapPct, biggest gap first. */
export function findGaps(
  tokens: ScanToken[],
  tickers: Map<string, { bid: number; ask: number }>,
  dex: Map<string, { price: number; tvl: number }>,
  opts: { minTvlUsd: number; minGapPct: number },
): Gap[] {
  const gaps: Gap[] = [];
  for (const token of tokens) {
    const t = tickers.get(token.symbol);
    const d = dex.get(token.address);
    if (!t || !d || t.ask <= 0 || d.price <= 0 || d.tvl < opts.minTvlUsd) continue;
    const gapPct = (d.price / t.ask - 1) * 100;
    // > 50% usually means a different/broken token or a dead pool, not an opportunity.
    if (gapPct >= opts.minGapPct && gapPct < 50) gaps.push({ token, ask: t.ask, dexPrice: d.price, tvlUsd: d.tvl, gapPct });
  }
  return gaps.sort((a, b) => b.gapPct - a.gapPct);
}
```

## `src/summary.ts`

```ts
import type { Db } from './db.js';
import { usd } from './util.js';

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
  return lines.join('\n');
}
```

## `src/telegram.ts`

```ts
// Telegram alerts + commands (/stop, /start, /status). Only the configured chat id is obeyed.
import { log, errMsg, redact } from './log.js';
import { sleep } from './util.js';

type Handler = () => Promise<string> | string;
type FetchFn = typeof fetch;

export class Telegram {
  private offset = 0;
  private running = false;

  constructor(private token: string, private chatId: string, private fetchFn: FetchFn = fetch) {}

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    return j.result;
  }

  /** Never throws: alerts must not crash the bot. */
  async send(text: string): Promise<void> {
    const msg = redact(text);
    log.info(`[telegram] ${msg.replace(/\n/g, ' | ')}`);
    if (!this.enabled) return;
    try {
      await this.api('sendMessage', { chat_id: this.chatId, text: msg.slice(0, 4000), disable_web_page_preview: true });
    } catch (e) {
      log.warn(`telegram send failed: ${errMsg(e)}`);
    }
  }

  /** Dispatch one update; exported for tests. */
  async handle(update: { message?: { chat?: { id: number | string }; text?: string } }, handlers: Record<string, Handler>) {
    const m = update.message;
    if (!m?.text || String(m.chat?.id) !== String(this.chatId)) return; // ignore strangers
    const cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase();
    const h = handlers[cmd];
    const reply = h ? await h() : `Commands: ${Object.keys(handlers).join(' ')}`;
    await this.send(reply);
  }

  async startPolling(handlers: Record<string, Handler>): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    while (this.running) {
      try {
        const updates = await this.api<{ update_id: number; message?: { chat?: { id: number }; text?: string } }[]>(
          'getUpdates',
          { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
          35_000,
        );
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handle(u, handlers).catch((e) => log.warn(`telegram handler: ${errMsg(e)}`));
        }
      } catch (e) {
        log.warn(`telegram poll: ${errMsg(e)}`);
        await sleep(5000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
```

## `src/transfer.ts`

```ts
// TRANSFER strategy: scan all MEXC ERC20 tokens -> buy the one that is cheaper on MEXC ->
// withdraw it to the hot wallet -> sell it on an Ethereum DEX.
//
// Each cycle is a persisted state machine (buying -> withdrawing -> selling -> done),
// so a crash or pm2 restart continues where it stopped. Only MAX_OPEN_TRANSFERS run at once.
import type { Config } from './config.js';
import type { Aggregator, Quote } from './dex/aggregator.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Book, CoinConfig, Order, SymbolInfo } from './mexc/rest.js';
import type { Db, TransferRow } from './db.js';
import type { Risk } from './risk.js';
import type { Notifier } from './engine.js';
import { USDC_DECIMALS, ZEROX_ALLOWANCE_HOLDER } from './engine.js';
import { type Gap, type ScanToken, dexPrices, findGaps, loadUniverse } from './scanner.js';
import { evaluateTransfer, gasUsd, planCexBuy, threshold } from './pricing.js';
import { log, errMsg } from './log.js';
import { decimalsOfStep, dhakaDay, floorToStep, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

const APPROVE_GAS = 60_000n;
const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';

export interface TransferMexc {
  exchangeInfo(): Promise<SymbolInfo[]>;
  tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]>;
  coinConfigs(): Promise<CoinConfig[]>;
  bookTickers(): Promise<Map<string, { bid: number; ask: number }>>;
  depth(symbol: string, limit?: number): Promise<Book>;
  balances(): Promise<Record<string, number>>;
  limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string): Promise<{ orderId: string }>;
  marketSell(symbol: string, quantity: string): Promise<{ orderId: string }>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<Order>;
  withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string>;
  withdrawStatus(coin: string, id: string): Promise<{ status: number; txId?: string } | null>;
}
export interface TransferChain {
  readonly address: string;
  gas(): Promise<GasInfo>;
  decimals(token: string): Promise<number>;
  tokenBalance(token: string): Promise<bigint>;
  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
  send(tx: { to: string; data: string; value?: bigint }, gasLimit: bigint, gas: GasInfo, timeoutSec: number): Promise<TxResult>;
}

export interface TransferDeps {
  cfg: Config;
  mexc: TransferMexc;
  chain: TransferChain;
  agg: Aggregator;
  db: Db;
  risk: Risk;
  tg: Notifier;
  dexPricesFn?: typeof dexPrices;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Candidate {
  gap: Gap;
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  ev: ReturnType<typeof evaluateTransfer>;
  decimals: number;
}

const TERMINAL_WITHDRAW = new Set([8, 9]); // FAILED, CANCEL

export class TransferEngine {
  universe: ScanToken[] = [];
  private universeTs = 0;
  private lastNote = new Map<string, string>();
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  lastGasGwei = 0;
  lastTopGaps: Gap[] = [];

  constructor(private d: TransferDeps) {
    this.sleep = d.sleep ?? realSleep;
    this.now = d.now ?? Date.now;
  }

  private get cfg() {
    return this.d.cfg;
  }
  private get live() {
    return this.cfg.mode === 'live';
  }
  private costs() {
    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
  }
  private note(key: string, msg: string) {
    if (this.lastNote.get(key) !== msg) {
      this.lastNote.set(key, msg);
      log.info(msg);
    }
  }

  async refreshUniverse(force = false): Promise<void> {
    if (!force && this.now() - this.universeTs < 10 * 60_000) return;
    this.universe = await loadUniverse(this.d.mexc, { minVolumeUsd: this.cfg.minMexcVolumeUsd, only: this.cfg.watchlist });
    this.universeTs = this.now();
    log.info(`scanner universe: ${this.universe.length} MEXC ERC20 tokens (deposit+withdraw open, volume >= $${this.cfg.minMexcVolumeUsd})`);
  }

  /** One scan cycle. Always advances open transfers first. */
  async tick(): Promise<void> {
    const gas = await this.d.chain.gas();
    this.lastGasGwei = Number(gas.effective) / 1e9;
    const tickers = await this.d.mexc.bookTickers();
    const eth = tickers.get('ETHUSDT');
    if (!eth) throw new Error('no ETHUSDT ticker');
    const ethUsd = (eth.bid + eth.ask) / 2;

    for (const row of this.d.db.openTransfers()) {
      try {
        await this.advance(row, gas, ethUsd);
      } catch (e) {
        log.error(`transfer #${row.id} ${row.base}: ${errMsg(e)}`);
      }
    }

    await this.refreshUniverse();
    const dex = await (this.d.dexPricesFn ?? dexPrices)(this.universe.map((t) => t.address));
    const gaps = findGaps(this.universe, tickers, dex, { minTvlUsd: this.cfg.minDexTvlUsd, minGapPct: this.cfg.scanMinGapPct });
    this.lastTopGaps = gaps.slice(0, 5);
    this.note(
      'gaps',
      gaps.length
        ? `scan: ${gaps.length} gaps >= ${this.cfg.scanMinGapPct}%: ${gaps.slice(0, 5).map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ')}`
        : `scan: ${this.universe.length} tokens, no gap >= ${this.cfg.scanMinGapPct}%`,
    );

    const block = this.d.risk.blockReason();
    if (block) return this.note('block', `new trades blocked: ${block}`);
    this.note('block', 'new trades enabled');
    if (this.d.db.openTransfers().length >= this.cfg.maxOpenTransfers) return this.note('open', 'waiting for open transfer to finish');
    this.note('open', 'no open transfer');
    if (this.lastGasGwei > this.cfg.maxGasGwei) return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > ${this.cfg.maxGasGwei}, no new trades`);
    this.note('gas', 'gas ok');
    if (!gaps.length) return;

    const usdt = this.live ? ((await this.d.mexc.balances()).USDT ?? 0) : 1e12;
    let best: Candidate | null = null;
    for (const g of gaps.slice(0, this.cfg.scanExactQuotes)) {
      try {
        const c = await this.evaluate(g, gas, ethUsd, usdt);
        if (!c) continue;
        const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
        log.info(`${g.token.base}: gap ${g.gapPct.toFixed(2)}%, size ${usd(c.ev.costUsd)}, exact net ${usd(c.ev.net)} (need ${usd(need)})`);
        if (c.ev.net > need && (!best || c.ev.net > best.ev.net)) best = c;
      } catch (e) {
        log.warn(`${g.token.base} evaluate: ${errMsg(e)}`);
      }
    }
    if (!best) return;
    if (!this.live) return this.recordPaper(best);
    await this.start(best, gas, ethUsd);
  }

  /** Exact, size-specific numbers: MEXC depth walk + withdraw fee + aggregator quote + gas + drift reserve. */
  async evaluate(g: Gap, gas: GasInfo, ethUsd: number, usdt: number): Promise<Candidate | null> {
    const size = Math.min(this.cfg.maxTradeUsd, usdt * 0.99);
    if (size < this.cfg.minTradeUsd) {
      this.note('usdt', `MEXC USDT too low for a trade (${usd(usdt)})`);
      return null;
    }
    const t = g.token;
    const book = await this.d.mexc.depth(t.symbol, 20);
    const plan = planCexBuy({ sizeUsd: size, asks: book.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
    if (!plan || plan.tokensToSell < t.withdrawMin) return null;
    const arriving = plan.tokensToSell - t.withdrawFee;
    if (arriving <= 0) return null;
    const decimals = await this.d.chain.decimals(t.address);
    const q = await this.d.agg.price({
      sellToken: t.address,
      buyToken: this.cfg.usdc,
      sellAmount: toUnits(arriving, decimals),
      taker: this.live ? this.d.chain.address : PAPER_TAKER,
      slippageBps: this.cfg.dexSlippageBps,
    });
    const ev = evaluateTransfer({
      plan,
      withdrawFeeTokens: t.withdrawFee,
      usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
      usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
      gasUsd: gasUsd(q.gas + APPROVE_GAS, gas.effective, ethUsd),
      driftBps: this.cfg.transferDriftBps,
      costs: this.costs(),
    });
    return { gap: g, plan, ev, decimals };
  }

  private async recordPaper(c: Candidate) {
    const t = c.gap.token;
    const now = this.now();
    this.d.db.insertTrade({
      ts: now, day: dhakaDay(now), mode: 'paper', symbol: t.base, direction: 'TRANSFER',
      size_usd: c.ev.costUsd, qty: c.plan.qty, buy_price: c.ev.buyPrice, sell_price: c.ev.sellPrice,
      expected_net: c.ev.net, cex_fee_usd: c.ev.cexFeeUsd + c.ev.withdrawFeeUsd, gas_usd: c.ev.gasUsd,
      pnl_usd: c.ev.net, status: 'paper', dex_tx: null, cex_order_id: null, note: `gap ${c.gap.gapPct.toFixed(2)}%`,
    });
    await this.d.tg.send(
      `📝 PAPER TRANSFER ${t.base}: buy MEXC @ ${c.ev.buyPrice.toPrecision(6)} -> sell DEX @ ${c.ev.sellPrice.toPrecision(6)}\n` +
        `Size ${usd(c.ev.costUsd)} | fees ${usd(c.ev.cexFeeUsd + c.ev.withdrawFeeUsd)} | gas ${usd(c.ev.gasUsd)} | drift reserve ${usd(c.ev.driftUsd)}\nNet ${usd(c.ev.net)}`,
    );
    this.d.risk.afterTrade('paper');
  }

  /** Create the persisted transfer and run its first steps right away. */
  private async start(c: Candidate, gas: GasInfo, ethUsd: number) {
    const t = c.gap.token;
    const now = this.now();
    const id = this.d.db.insertTransfer({
      ts: now, updated: now, base: t.base, symbol: t.symbol, address: t.address, decimals: c.decimals,
      net_work: t.netWork, qty_step: t.qtyStep, price_decimals: t.priceDecimals, status: 'buying',
      buy_qty: c.plan.qty, cost_usd: c.ev.costUsd, buy_order_id: null, withdraw_amount: null, withdraw_id: null,
      wallet_before: null, received: null, usdc_out: null, gas_usd: 0, expected_net: c.ev.net, pnl: null,
      sell_attempts: 0, alerted_timeout: 0, note: null,
    });
    log.info(`transfer #${id} ${t.base}: START gap ${c.gap.gapPct.toFixed(2)}% expected ${usd(c.ev.net)}`);
    const row = this.d.db.openTransfers().find((r) => r.id === id)!;
    try {
      await this.buy(row, c.plan.worst * (1 + this.cfg.cexSlippageBps / 10_000));
    } catch (e) {
      if (!row.buy_order_id) return this.fail(row, `MEXC buy rejected: ${errMsg(e)}`, 0, false);
      throw e; // order exists; the next tick re-reads it
    }
    const next = this.d.db.openTransfers().find((r) => r.id === id);
    if (next) await this.advance(next, gas, ethUsd);
  }

  /** Move one transfer forward as far as it can go right now. */
  async advance(row: TransferRow, gas: GasInfo, ethUsd: number): Promise<void> {
    if (row.status === 'buying') {
      // Crashed between creating the row and recording the order: never guess.
      if (!row.buy_order_id) return this.fail(row, 'restart during MEXC buy, order id unknown: check MEXC manually', 0);
      return this.finishBuy(row);
    }
    if (row.status === 'withdrawing') return this.withdrawStep(row, ethUsd);
    if (row.status === 'selling' || row.status === 'stuck') return this.sellStep(row, gas, ethUsd);
  }

  private async buy(row: TransferRow, limitPrice: number) {
    const f = 10 ** row.price_decimals;
    const px = (Math.ceil(limitPrice * f) / f).toFixed(row.price_decimals);
    const qty = row.buy_qty.toFixed(decimalsOfStep(row.qty_step));
    const { orderId } = await this.d.mexc.limitOrder(row.symbol, 'BUY', qty, px);
    this.d.db.updateTransfer(row.id!, { buy_order_id: orderId });
    row.buy_order_id = orderId;
    log.info(`transfer #${row.id} MEXC BUY ${qty} ${row.base} @ ${px} id=${orderId}`);
    await this.sleep(1500);
    await this.finishBuy(row);
  }

  private async finishBuy(row: TransferRow) {
    let o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
    if (o.status !== 'FILLED') {
      await this.d.mexc.cancelOrder(row.symbol, row.buy_order_id!).catch((e) => log.warn(`cancel: ${errMsg(e)}`));
      await this.sleep(500);
      o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
    }
    const filled = Number(o.executedQty);
    const cost = Number(o.cummulativeQuoteQty);
    if (filled <= 0) return this.fail(row, 'MEXC buy did not fill (price moved)', 0, false);
    this.d.db.updateTransfer(row.id!, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
    Object.assign(row, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
  }

  private async withdrawStep(row: TransferRow, ethUsd: number) {
    const expectedUnits = (amount: string) => toUnits(Math.max(0, Number(amount) - this.withdrawFee(row)), row.decimals);

    if (!row.withdraw_id) {
      const free = (await this.d.mexc.balances())[row.base] ?? 0;
      const amount = floorToStep(Math.min(free, row.buy_qty * (1 - this.cfg.mexcTakerFee)), row.qty_step);
      const amountStr = amount.toFixed(decimalsOfStep(row.qty_step));
      const min = this.universe.find((t) => t.base === row.base)?.withdrawMin ?? 0;
      if (amount <= 0 || amount < min) {
        const proceeds = amount > 0 ? await this.sellOnMexc(row, amountStr) : 0;
        return this.fail(row, `amount ${amountStr} below MEXC withdraw minimum ${min}; sold back on MEXC`, proceeds - row.cost_usd);
      }
      const before = await this.d.chain.tokenBalance(row.address);
      try {
        const id = await this.d.mexc.withdraw({
          coin: row.base,
          netWork: row.net_work,
          address: this.d.chain.address, // ONLY ever our own hot wallet
          amount: amountStr,
          contractAddress: row.address,
          withdrawOrderId: `arb${row.id}`,
        });
        this.d.db.updateTransfer(row.id!, { withdraw_id: id, withdraw_amount: amountStr, wallet_before: before.toString() });
        await this.d.tg.send(
          `📤 TRANSFER #${row.id} ${row.base}: bought ${row.buy_qty} on MEXC for ${usd(row.cost_usd)}, withdrawing ${amountStr} to wallet`,
        );
      } catch (e) {
        // Could not withdraw: close the position on MEXC instead.
        const proceeds = await this.sellOnMexc(row, amountStr);
        return this.fail(row, `withdraw failed: ${errMsg(e)}; sold back on MEXC`, proceeds - row.cost_usd);
      }
      return;
    }

    const st = await this.d.mexc.withdrawStatus(row.base, row.withdraw_id).catch(() => null);
    const bal = await this.d.chain.tokenBalance(row.address);
    const diff = bal - BigInt(row.wallet_before ?? '0');
    const expected = expectedUnits(row.withdraw_amount!);

    if (st && TERMINAL_WITHDRAW.has(st.status) && diff <= 0n) {
      await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base}: MEXC withdrawal ${st.status === 8 ? 'FAILED' : 'CANCELLED'}, selling back on MEXC`);
      const proceeds = await this.sellOnMexc(row, row.withdraw_amount!);
      return this.fail(row, `withdraw status ${st.status}`, proceeds - row.cost_usd);
    }
    if (diff > 0n && (st?.status === 7 || diff * 100n >= expected * 98n)) {
      this.d.db.updateTransfer(row.id!, { status: 'selling', received: diff.toString() });
      Object.assign(row, { status: 'selling', received: diff.toString() });
      log.info(`transfer #${row.id} ${row.base}: ${toFloat(diff, row.decimals)} arrived in wallet`);
      return this.sellStep(row, await this.d.chain.gas(), ethUsd);
    }
    const ageMin = (this.now() - row.ts) / 60_000;
    if (ageMin > this.cfg.transferTimeoutMin && !row.alerted_timeout) {
      this.d.db.updateTransfer(row.id!, { alerted_timeout: 1 });
      await this.d.tg.send(
        `⏳ TRANSFER #${row.id} ${row.base}: withdrawal still not in wallet after ${Math.round(ageMin)} min (MEXC status ${st?.status ?? '?'}). Still waiting; no new trades until it lands.`,
      );
    }
  }

  private withdrawFee(row: TransferRow): number {
    return this.universe.find((t) => t.base === row.base)?.withdrawFee ?? 0;
  }

  private async sellStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
    if (Number(gas.effective) / 1e9 > this.cfg.maxGasGwei) return this.note(`sell-${row.id}`, `transfer #${row.id}: gas too high, sale waits`);
    const amount = BigInt(row.received!);
    const req = { sellToken: row.address, buyToken: this.cfg.usdc, sellAmount: amount, taker: this.d.chain.address, slippageBps: this.cfg.dexSlippageBps };
    let gasWei = 0n;
    let txHash: string | undefined;
    try {
      const first = await this.d.agg.quote(req);
      const spender = this.spenderOf(first);
      const ap = await this.d.chain.approveExact(row.address, spender, amount, gas);
      gasWei += ap.gasCostWei;
      if (!ap.ok) throw new Error(`approval failed: ${ap.reason}`);
      const firm = await this.d.agg.quote(req); // fresh after the approval
      if (!firm.tx) throw new Error('quote without transaction');
      const est = await this.d.chain.simulate(firm.tx);
      const usdcBefore = await this.d.chain.tokenBalance(this.cfg.usdc);
      const r = await this.d.chain.send(firm.tx, (est * 13n) / 10n, gas, this.cfg.txTimeoutSec);
      gasWei += r.gasCostWei;
      txHash = r.hash;
      if (!r.ok) throw new Error(`swap ${r.reason}`);
      const usdcOut = toFloat((await this.d.chain.tokenBalance(this.cfg.usdc)) - usdcBefore, USDC_DECIMALS);
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
      const pnl = usdcOut - row.cost_usd - gasTotal;
      this.d.db.updateTransfer(row.id!, { status: 'done', usdc_out: usdcOut, gas_usd: gasTotal, pnl });
      const qty = toFloat(amount, row.decimals);
      this.recordTrade(row, 'ok', pnl, gasTotal, txHash, `sold ${qty} for ${usd(usdcOut)}`, usdcOut / qty);
      await this.d.tg.send(
        [
          `${pnl >= 0 ? '✅' : '🔻'} TRANSFER #${row.id} ${row.base} done`,
          `Buy MEXC: ${row.buy_qty} for ${usd(row.cost_usd)} (@ ${(row.cost_usd / row.buy_qty).toPrecision(6)})`,
          `Sell DEX: ${qty} for ${usd(usdcOut)} (@ ${(usdcOut / qty).toPrecision(6)})`,
          `Gas ${usd(gasTotal)} | Expected ${usd(row.expected_net)} | Net PnL ${usd(pnl)}`,
          `https://etherscan.io/tx/${txHash}`,
        ].join('\n'),
      );
      this.afterRisk('ok');
    } catch (e) {
      const attempts = row.sell_attempts + 1;
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
      this.d.db.updateTransfer(row.id!, { sell_attempts: attempts, gas_usd: gasTotal, status: attempts >= 3 ? 'stuck' : 'selling' });
      log.warn(`transfer #${row.id} ${row.base} sell attempt ${attempts} failed: ${errMsg(e)}`);
      if (attempts === 3) {
        await this.d.tg.send(
          `🚨 TRANSFER #${row.id} ${row.base}: could not sell on DEX 3 times (${errMsg(e)}).\nTokens are in the hot wallet. The bot keeps retrying each scan; you can also sell manually.`,
        );
        this.afterRisk('one_sided');
      }
    }
  }

  private spenderOf(q: Quote): string {
    if (q.spender) return q.spender;
    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
    throw new Error('aggregator did not return a spender');
  }

  /** Market-sell on MEXC; returns USDT received (0 if it fails, with an alert). */
  private async sellOnMexc(row: TransferRow, qty: string): Promise<number> {
    try {
      const { orderId } = await this.d.mexc.marketSell(row.symbol, qty);
      await this.sleep(1000);
      const o = await this.d.mexc.getOrder(row.symbol, orderId);
      return Number(o.cummulativeQuoteQty) * (1 - this.cfg.mexcTakerFee);
    } catch (e) {
      this.d.risk.pause(`could not close ${row.base} on MEXC`);
      await this.d.tg.send(`🚨 ${row.base}: MEXC market sell of ${qty} FAILED (${errMsg(e)}). Trading PAUSED. Close it manually, then /start.`);
      return 0;
    }
  }

  private async fail(row: TransferRow, why: string, pnl: number, countAsFailure = true) {
    this.d.db.updateTransfer(row.id!, { status: 'failed', pnl, note: why });
    log.warn(`transfer #${row.id} ${row.base} failed: ${why}`);
    if (!countAsFailure) return; // e.g. buy simply did not fill: no money moved
    this.recordTrade(row, 'one_sided', pnl, row.gas_usd, undefined, why);
    await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base} failed: ${why}\nPnL ${usd(pnl)}`);
    this.afterRisk('one_sided');
  }

  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0) {
    const now = this.now();
    this.d.db.insertTrade({
      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: row.cost_usd / (row.buy_qty || 1),
      sell_price: sellPrice, expected_net: row.expected_net,
      cex_fee_usd: row.cost_usd * this.cfg.mexcTakerFee, gas_usd: gas, pnl_usd: pnl, status,
      dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
    });
  }

  private afterRisk(status: 'ok' | 'one_sided') {
    for (const e of this.d.risk.afterTrade(status)) {
      if (e.kind === 'loss_limit') void this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). New trades STOPPED. Send /start to resume.`);
      if (e.kind === 'fail_streak') void this.d.tg.send(`🛑 ${e.count} failed trades in a row. New trades PAUSED. /start to resume.`);
      if (e.kind === 'trade_limit') void this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}).`);
    }
  }
}
```

## `src/util.ts`

```ts
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const DHAKA_OFFSET_MS = 6 * 3600 * 1000; // Bangladesh: UTC+6, no DST

/** Calendar day in Bangladesh time, e.g. "2026-11-20". Daily limits reset at Dhaka midnight. */
export function dhakaDay(t = Date.now()): string {
  return new Date(t + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function dhakaHourMinute(t = Date.now()): { hour: number; minute: number } {
  const d = new Date(t + DHAKA_OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** Round down to a multiple of `step` (e.g. MEXC quantity precision) and format without float noise. */
export function floorToStep(x: number, step: number): number {
  if (step <= 0) return x;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const v = Math.floor(x / step + 1e-9) * step;
  return Number(v.toFixed(decimals));
}

export function decimalsOfStep(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

export const usd = (x: number) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`;

/** Token amount (bigint base units) -> float. Fine for pricing; never used for on-chain amounts. */
export function toFloat(amount: bigint, decimals: number): number {
  const s = amount.toString().padStart(decimals + 1, '0');
  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals) || '0'}`);
}

/** Float -> base units, truncated. */
export function toUnits(x: number, decimals: number): bigint {
  const [i, f = ''] = x.toFixed(Math.min(decimals, 18)).split('.');
  return BigInt(i + f.padEnd(decimals, '0').slice(0, decimals));
}
```

## `src/watchlist.ts`

```ts
// Builds the token list: on MEXC (USDT pair) AND on Ethereum, with the SAME contract address
// (taken from MEXC's own deposit network info), enough DEX TVL and MEXC volume.
import type { CoinConfig, MexcRest } from './mexc/rest.js';
import { log, errMsg } from './log.js';

export interface Token {
  base: string; // e.g. LINK
  symbol: string; // MEXC symbol, e.g. LINKUSDT
  address: string; // Ethereum contract (lowercase)
  decimals: number;
  qtyStep: number; // MEXC quantity step
  priceDecimals: number; // MEXC price precision
  dexTvlUsd: number;
  mexcVolumeUsd: number;
  depositOk: boolean;
  withdrawOk: boolean;
}

const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH', 'WBTC']);

/** MEXC's Ethereum network entry for a coin (network names vary: "ERC20", "Ethereum(ERC20)", netWork "ETH"). */
export function ethNetwork(cfg: CoinConfig) {
  return cfg.networkList.find(
    (n) => n.netWork === 'ETH' || /ERC20/i.test(n.network) || /^ethereum$/i.test(n.network),
  );
}

type FetchFn = typeof fetch;

/** Highest liquidity (USD) of any Ethereum pool for the token, from DexScreener. */
export async function dexTvl(address: string, fetchFn: FetchFn = fetch): Promise<number> {
  const res = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  const j = (await res.json()) as { pairs?: { chainId: string; liquidity?: { usd?: number } }[] | null };
  return Math.max(0, ...(j.pairs ?? []).filter((p) => p.chainId === 'ethereum').map((p) => p.liquidity?.usd ?? 0));
}

export async function buildWatchlist(
  mexc: MexcRest,
  decimalsOf: (address: string) => Promise<number>,
  opts: { only: string[]; max: number; minTvlUsd: number; minVolumeUsd: number },
): Promise<Token[]> {
  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));

  const candidates = symbols
    .filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed && String(s.status) === '1')
    .filter((s) => !SKIP.has(s.baseAsset.toUpperCase()))
    .filter((s) => opts.only.length === 0 || opts.only.includes(s.baseAsset.toUpperCase()))
    .filter((s) => (volume.get(s.symbol) ?? 0) >= opts.minVolumeUsd)
    .sort((a, b) => (volume.get(b.symbol) ?? 0) - (volume.get(a.symbol) ?? 0));

  const out: Token[] = [];
  for (const s of candidates) {
    if (out.length >= opts.max) break;
    const coin = coinBy.get(s.baseAsset.toUpperCase());
    const net = coin && ethNetwork(coin);
    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue; // not an Ethereum token on MEXC
    const address = net.contract.toLowerCase();
    try {
      const tvl = await dexTvl(address);
      if (tvl < opts.minTvlUsd) {
        log.info(`watchlist: skip ${s.baseAsset}, DEX TVL $${Math.round(tvl)}`);
        continue;
      }
      out.push({
        base: s.baseAsset.toUpperCase(),
        symbol: s.symbol,
        address,
        decimals: await decimalsOf(address),
        qtyStep: Number(s.baseSizePrecision) || 10 ** -(s.baseAssetPrecision ?? 2),
        priceDecimals: s.quotePrecision,
        dexTvlUsd: tvl,
        mexcVolumeUsd: volume.get(s.symbol) ?? 0,
        depositOk: net.depositEnable,
        withdrawOk: net.withdrawEnable,
      });
    } catch (e) {
      log.warn(`watchlist: ${s.baseAsset} check failed: ${errMsg(e)}`);
    }
  }
  return out;
}

/** Refresh deposit/withdraw flags (tokens with either suspended are skipped). */
export async function refreshStatus(mexc: MexcRest, tokens: Token[]): Promise<string[]> {
  const coins = new Map((await mexc.coinConfigs()).map((c) => [c.coin.toUpperCase(), c]));
  const changed: string[] = [];
  for (const t of tokens) {
    const net = coins.get(t.base) && ethNetwork(coins.get(t.base)!);
    const dep = Boolean(net?.depositEnable && net.contract?.toLowerCase() === t.address);
    const wd = Boolean(net?.withdrawEnable);
    if (dep !== t.depositOk || wd !== t.withdrawOk) changed.push(`${t.base}: deposit ${dep ? 'on' : 'OFF'}, withdraw ${wd ? 'on' : 'OFF'}`);
    t.depositOk = dep;
    t.withdrawOk = wd;
  }
  return changed;
}
```

## `src/mexc/proto.ts`

```ts
// Minimal protobuf decoder for MEXC WebSocket pushes (wss://wbs-api.mexc.com/ws).
// MEXC sends PushDataV3ApiWrapper messages:
//   1: channel (string), 3: symbol (string), 6: sendTime (int64),
//   303: publicLimitDepths { 1: asks[], 2: bids[], 3: eventType, 4: version }
//   each level: { 1: price (string), 2: quantity (string) }
// Only the fields we use are decoded; everything else is skipped by wire type.

type Field = { num: number; wire: number; value: number | Uint8Array };

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('truncated varint');
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift; // avoid 32-bit overflow of <<
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
  }
}

export function decodeFields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let key: number;
    [key, pos] = readVarint(buf, pos);
    const num = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      let v: number;
      [v, pos] = readVarint(buf, pos);
      out.push({ num, wire, value: v });
    } else if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error('truncated field');
      out.push({ num, wire, value: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

const text = new TextDecoder();
const str = (v: Field['value'] | string) => (v instanceof Uint8Array ? text.decode(v) : String(v));

function levels(fields: Field[], num: number): [number, number][] {
  return fields
    .filter((f) => f.num === num && f.value instanceof Uint8Array)
    .map((f) => {
      const lv = decodeFields(f.value as Uint8Array);
      const price = Number(str(lv.find((x) => x.num === 1)?.value ?? '0'));
      const qty = Number(str(lv.find((x) => x.num === 2)?.value ?? '0'));
      return [price, qty] as [number, number];
    });
}

export interface DepthPush {
  channel: string;
  symbol: string;
  asks: [number, number][];
  bids: [number, number][];
}

/** Decode a limit-depth push; returns null for other message types. */
export function decodeDepthPush(buf: Uint8Array): DepthPush | null {
  const top = decodeFields(buf);
  const depth = top.find((f) => f.num === 303 && f.value instanceof Uint8Array);
  if (!depth) return null;
  const inner = decodeFields(depth.value as Uint8Array);
  return {
    channel: str(top.find((f) => f.num === 1)?.value ?? ''),
    symbol: str(top.find((f) => f.num === 3)?.value ?? ''),
    asks: levels(inner, 1).sort((a, b) => a[0] - b[0]),
    bids: levels(inner, 2).sort((a, b) => b[0] - a[0]),
  };
}
```

## `src/mexc/rest.ts`

```ts
// MEXC Spot API v3 REST client. https://mexcdevelop.github.io/apidocs/spot_v3_en/
import crypto from 'node:crypto';
import { redact } from '../log.js';

export type Side = 'BUY' | 'SELL';
export type Level = [price: number, qty: number];
export interface Book {
  bids: Level[];
  asks: Level[];
  ts: number;
}
export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
  baseSizePrecision: string; // quantity step, e.g. "0.01" ("0" = use baseAssetPrecision)
  baseAssetPrecision?: number;
  quotePrecision: number;
  orderTypes: string[];
}
export interface CoinNetwork {
  coin: string;
  network: string;
  netWork?: string;
  contract?: string;
  depositEnable: boolean;
  withdrawEnable: boolean;
  withdrawFee?: string; // in the coin itself
  withdrawMin?: string;
  withdrawMax?: string;
}
export interface CoinConfig {
  coin: string;
  networkList: CoinNetwork[];
}
export interface Order {
  orderId: string;
  status: string; // NEW, FILLED, PARTIALLY_FILLED, CANCELED, PARTIALLY_CANCELED
  executedQty: string;
  cummulativeQuoteQty: string;
  origQty: string;
  price: string;
  side: Side;
}

type FetchFn = typeof fetch;

export class MexcRest {
  constructor(
    private apiKey = '',
    private apiSecret = '',
    private baseUrl = 'https://api.mexc.com',
    private fetchFn: FetchFn = fetch,
  ) {}

  sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  async request<T>(method: string, path: string, params: Record<string, string | number> = {}, signed = false): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signed) {
      if (!this.apiKey || !this.apiSecret) throw new Error('MEXC API key/secret not configured');
      qs.set('timestamp', String(Date.now()));
      qs.set('recvWindow', '5000');
      qs.set('signature', this.sign(qs.toString()));
      headers['X-MEXC-APIKEY'] = this.apiKey;
    }
    const q = qs.toString();
    const res = await this.fetchFn(`${this.baseUrl}${path}${q ? `?${q}` : ''}`, {
      method,
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) throw new Error(redact(`MEXC ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`));
    return body as T;
  }

  async depth(symbol: string, limit = 20): Promise<Book> {
    const d = await this.request<{ bids: [string, string][]; asks: [string, string][] }>('GET', '/api/v3/depth', { symbol, limit });
    const conv = (l: [string, string][]): Level[] => l.map(([p, q]) => [Number(p), Number(q)]);
    return { bids: conv(d.bids), asks: conv(d.asks), ts: Date.now() };
  }

  async exchangeInfo(): Promise<SymbolInfo[]> {
    const r = await this.request<{ symbols: SymbolInfo[] }>('GET', '/api/v3/exchangeInfo');
    return r.symbols;
  }

  async tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]> {
    return this.request('GET', '/api/v3/ticker/24hr');
  }

  async price(symbol: string): Promise<number> {
    const r = await this.request<{ price: string }>('GET', '/api/v3/ticker/price', { symbol });
    return Number(r.price);
  }

  /** Deposit/withdraw status and contract address per network (signed). */
  async coinConfigs(): Promise<CoinConfig[]> {
    return this.request('GET', '/api/v3/capital/config/getall', {}, true);
  }

  async account(): Promise<{ canTrade: boolean; balances: { asset: string; free: string; locked: string }[] }> {
    return this.request('GET', '/api/v3/account', {}, true);
  }

  async balances(): Promise<Record<string, number>> {
    const a = await this.account();
    return Object.fromEntries(a.balances.map((b) => [b.asset, Number(b.free)]));
  }

  /** Best bid/ask for every symbol in one call. */
  async bookTickers(): Promise<Map<string, { bid: number; ask: number }>> {
    const r = await this.request<{ symbol: string; bidPrice: string; askPrice: string }[]>('GET', '/api/v3/ticker/bookTicker');
    return new Map(r.map((t) => [t.symbol, { bid: Number(t.bidPrice), ask: Number(t.askPrice) }]));
  }

  /** Withdraw (new endpoint). Requires an API key with withdraw permission. Returns the withdraw id. */
  async withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string> {
    const params: Record<string, string> = { coin: p.coin, netWork: p.netWork, address: p.address, amount: p.amount };
    if (p.contractAddress) params.contractAddress = p.contractAddress;
    if (p.withdrawOrderId) params.withdrawOrderId = p.withdrawOrderId;
    const r = await this.request<{ id: string }>('POST', '/api/v3/capital/withdraw', params, true);
    return r.id;
  }

  /** Status: 1 APPLY .. 6 WAIT_CONFIRM, 7 SUCCESS, 8 FAILED, 9 CANCEL, 10 MANUAL. */
  async withdrawStatus(coin: string, id: string): Promise<{ status: number; txId?: string } | null> {
    const r = await this.request<{ id: string; status: number | string; txId?: string }[]>('GET', '/api/v3/capital/withdraw/history', { coin, limit: 50 }, true);
    const w = r.find((x) => x.id === id);
    return w ? { status: Number(w.status), txId: w.txId } : null;
  }

  limitOrder(symbol: string, side: Side, quantity: string, price: string): Promise<{ orderId: string }> {
    return this.request('POST', '/api/v3/order', { symbol, side, type: 'LIMIT', quantity, price }, true);
  }

  /** MARKET SELL by base quantity (documented). For buys use an aggressive LIMIT instead. */
  marketSell(symbol: string, quantity: string): Promise<{ orderId: string }> {
    return this.request('POST', '/api/v3/order', { symbol, side: 'SELL', type: 'MARKET', quantity }, true);
  }

  getOrder(symbol: string, orderId: string): Promise<Order> {
    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
  }

  cancelOrder(symbol: string, orderId: string): Promise<Order> {
    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
  }
}
```

## `src/mexc/ws.ts`

```ts
// MEXC public WebSocket: keeps a live top-20 order book per symbol.
import WebSocket from 'ws';
import { decodeDepthPush } from './proto.js';
import type { Book } from './rest.js';
import { log, errMsg } from '../log.js';

const URL = 'wss://wbs-api.mexc.com/ws';
const MAX_SUBS_PER_CONN = 30; // MEXC limit per connection

export class MexcBookStream {
  private books = new Map<string, Book>();
  private sockets: WebSocket[] = [];
  private stopped = false;

  constructor(private symbols: string[]) {}

  start(): void {
    for (let i = 0; i < this.symbols.length; i += MAX_SUBS_PER_CONN) {
      this.connect(this.symbols.slice(i, i + MAX_SUBS_PER_CONN), 0);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.sockets) s.terminate();
  }

  /** Latest book, or undefined if missing / older than maxAgeMs. */
  get(symbol: string, maxAgeMs = 5000): Book | undefined {
    const b = this.books.get(symbol);
    return b && Date.now() - b.ts <= maxAgeMs ? b : undefined;
  }

  private connect(symbols: string[], attempt: number): void {
    if (this.stopped) return;
    const ws = new WebSocket(URL);
    this.sockets.push(ws);
    let ping: NodeJS.Timeout | undefined;

    ws.on('open', () => {
      attempt = 0;
      const params = symbols.map((s) => `spot@public.limit.depth.v3.api.pb@${s}@20`);
      ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params }));
      ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ method: 'PING' })), 20_000);
      log.info(`MEXC WS subscribed: ${symbols.join(',')}`);
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const msg = data.toString();
        if (msg.includes('Blocked') || msg.includes('Not Subscribed')) log.warn(`MEXC WS: ${msg}`);
        return;
      }
      try {
        const push = decodeDepthPush(data);
        if (push && push.symbol) this.books.set(push.symbol, { bids: push.bids, asks: push.asks, ts: Date.now() });
      } catch (e) {
        log.warn(`MEXC WS decode error: ${errMsg(e)}`);
      }
    });

    const reconnect = () => {
      if (ping) clearInterval(ping);
      this.sockets = this.sockets.filter((s) => s !== ws);
      if (this.stopped) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      log.warn(`MEXC WS closed, reconnecting in ${delay}ms`);
      setTimeout(() => this.connect(symbols, attempt + 1), delay);
    };
    ws.on('close', reconnect);
    ws.on('error', (e) => {
      log.warn(`MEXC WS error: ${errMsg(e)}`);
      ws.terminate();
    });
  }
}
```

## `src/dex/aggregator.ts`

```ts
// DEX quotes from 0x (Swap API v2, AllowanceHolder) or 1inch (Swap API v6).
// Both route across Uniswap v2/v3 and other Ethereum DEXs; DEX fees are already in buyAmount.
import { redact } from '../log.js';

export interface QuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  taker: string;
  slippageBps: number;
}
export interface Quote {
  buyAmount: bigint; // expected output
  minBuyAmount: bigint; // output floor enforced on-chain
  gas: bigint; // estimated gas units
  spender: string; // address that needs an ERC20 allowance on sellToken
  tx?: { to: string; data: string; value: bigint }; // only for firm quotes
}

export interface Aggregator {
  name: string;
  /** Indicative price, cheap; no transaction. */
  price(req: QuoteRequest): Promise<Quote>;
  /** Firm quote with calldata ready to sign. */
  quote(req: QuoteRequest): Promise<Quote>;
}

type FetchFn = typeof fetch;

async function getJson<T>(fetchFn: FetchFn, url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`));
  return JSON.parse(text) as T;
}

interface ZeroExResponse {
  liquidityAvailable: boolean;
  buyAmount: string;
  minBuyAmount: string;
  gas?: string | null;
  issues?: { allowance?: { spender: string } | null; balance?: unknown };
  transaction?: { to: string; data: string; gas: string; value: string };
}

export class ZeroEx implements Aggregator {
  name = '0x';
  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, private chainId = 1) {
    if (!apiKey) throw new Error('ZEROX_API_KEY is required for DEX_AGGREGATOR=0x');
  }

  private url(kind: 'price' | 'quote', r: QuoteRequest): string {
    const q = new URLSearchParams({
      chainId: String(this.chainId),
      sellToken: r.sellToken,
      buyToken: r.buyToken,
      sellAmount: r.sellAmount.toString(),
      taker: r.taker,
      slippageBps: String(r.slippageBps),
    });
    return `https://api.0x.org/swap/allowance-holder/${kind}?${q}`;
  }

  private async call(kind: 'price' | 'quote', r: QuoteRequest): Promise<Quote> {
    const d = await getJson<ZeroExResponse>(this.fetchFn, this.url(kind, r), { '0x-api-key': this.apiKey, '0x-version': 'v2' });
    if (!d.liquidityAvailable) throw new Error('0x: no liquidity');
    const gas = BigInt(d.transaction?.gas ?? d.gas ?? '300000');
    const spender = d.issues?.allowance?.spender ?? d.transaction?.to ?? '';
    return {
      buyAmount: BigInt(d.buyAmount),
      minBuyAmount: BigInt(d.minBuyAmount),
      gas,
      spender,
      tx: d.transaction ? { to: d.transaction.to, data: d.transaction.data, value: BigInt(d.transaction.value || '0') } : undefined,
    };
  }

  price(r: QuoteRequest) {
    return this.call('price', r);
  }
  quote(r: QuoteRequest) {
    return this.call('quote', r);
  }
}

export class OneInch implements Aggregator {
  name = '1inch';
  private spender?: string;
  private base: string;
  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, chainId = 1) {
    if (!apiKey) throw new Error('ONEINCH_API_KEY is required for DEX_AGGREGATOR=1inch');
    this.base = `https://api.1inch.dev/swap/v6.0/${chainId}`;
  }
  private get headers() {
    return { Authorization: `Bearer ${this.apiKey}`, accept: 'application/json' };
  }
  private async getSpender(): Promise<string> {
    if (!this.spender) {
      this.spender = (await getJson<{ address: string }>(this.fetchFn, `${this.base}/approve/spender`, this.headers)).address;
    }
    return this.spender;
  }
  private minOut(amount: bigint, bps: number) {
    return (amount * BigInt(10_000 - bps)) / 10_000n;
  }

  async price(r: QuoteRequest): Promise<Quote> {
    const q = new URLSearchParams({ src: r.sellToken, dst: r.buyToken, amount: r.sellAmount.toString(), includeGas: 'true' });
    const d = await getJson<{ dstAmount: string; gas?: number }>(this.fetchFn, `${this.base}/quote?${q}`, this.headers);
    const buy = BigInt(d.dstAmount);
    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.gas ?? 300_000), spender: await this.getSpender() };
  }

  async quote(r: QuoteRequest): Promise<Quote> {
    const q = new URLSearchParams({
      src: r.sellToken,
      dst: r.buyToken,
      amount: r.sellAmount.toString(),
      from: r.taker,
      origin: r.taker,
      slippage: String(r.slippageBps / 100), // percent
      disableEstimate: 'true', // we simulate ourselves with eth_call
      includeGas: 'true',
    });
    const d = await getJson<{ dstAmount: string; tx: { to: string; data: string; value: string; gas: number } }>(
      this.fetchFn,
      `${this.base}/swap?${q}`,
      this.headers,
    );
    const buy = BigInt(d.dstAmount);
    return {
      buyAmount: buy,
      minBuyAmount: this.minOut(buy, r.slippageBps),
      gas: BigInt(d.tx.gas || 300_000),
      spender: await this.getSpender(),
      tx: { to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value || '0') },
    };
  }
}
```

## `src/dex/chain.ts`

```ts
// Ethereum side: balances, gas, exact approvals, simulation and private sending.
import { ethers } from 'ethers';
import { log, errMsg } from '../log.js';
import { sleep } from '../util.js';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const APPROVE_GAS = 60_000n;

export interface GasInfo {
  baseFee: bigint;
  tip: bigint;
  /** What we expect to actually pay per gas (baseFee + tip). */
  effective: bigint;
  /** maxFeePerGas to set on the tx (headroom for base fee rises). */
  maxFee: bigint;
}

export interface TxResult {
  ok: boolean;
  hash?: string;
  gasCostWei: bigint;
  reason?: string;
}

export class Chain {
  readonly provider: ethers.JsonRpcProvider;
  readonly sendProvider: ethers.JsonRpcProvider;
  readonly wallet?: ethers.Wallet;
  private decimalsCache = new Map<string, number>();

  constructor(rpcUrl: string, sendRpcUrl: string, privateKey: string, private priorityFeeGwei: number) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl, 1, { staticNetwork: true });
    this.sendProvider = new ethers.JsonRpcProvider(sendRpcUrl, 1, { staticNetwork: true });
    if (privateKey) this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  get address(): string {
    if (!this.wallet) throw new Error('PRIVATE_KEY not set');
    return this.wallet.address;
  }

  erc20(token: string) {
    return new ethers.Contract(token, ERC20_ABI, this.wallet ?? this.provider);
  }

  async decimals(token: string): Promise<number> {
    const key = token.toLowerCase();
    if (!this.decimalsCache.has(key)) this.decimalsCache.set(key, Number(await this.erc20(token).decimals()));
    return this.decimalsCache.get(key)!;
  }

  async tokenBalance(token: string, owner = this.address): Promise<bigint> {
    return this.erc20(token).balanceOf(owner);
  }

  async ethBalance(owner = this.address): Promise<bigint> {
    return this.provider.getBalance(owner);
  }

  async gas(): Promise<GasInfo> {
    const block = await this.provider.getBlock('latest');
    const baseFee = block?.baseFeePerGas ?? 0n;
    const tip = ethers.parseUnits(String(this.priorityFeeGwei), 'gwei');
    return { baseFee, tip, effective: baseFee + tip, maxFee: baseFee * 2n + tip };
  }

  /** Gas units needed for an approval before the swap (0 if allowance already covers it). */
  async approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint> {
    if (!this.wallet) return 0n;
    const allowance: bigint = await this.erc20(token).allowance(this.address, spender);
    if (allowance >= amount) return 0n;
    return allowance > 0n ? APPROVE_GAS * 2n : APPROVE_GAS; // USDT-style tokens need approve(0) first
  }

  /** Approve exactly `amount` (never unlimited). Sent through the private RPC. */
  async approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult> {
    const c = this.erc20(token);
    let cost = 0n;
    const current: bigint = await c.allowance(this.address, spender);
    if (current >= amount) return { ok: true, gasCostWei: 0n };
    if (current > 0n) {
      const r = await this.send({ to: token, data: c.interface.encodeFunctionData('approve', [spender, 0n]) }, APPROVE_GAS, gas, 60);
      cost += r.gasCostWei;
      if (!r.ok) return { ...r, gasCostWei: cost };
    }
    const r = await this.send({ to: token, data: c.interface.encodeFunctionData('approve', [spender, amount]) }, APPROVE_GAS, gas, 60);
    return { ...r, gasCostWei: cost + r.gasCostWei };
  }

  /** eth_call + estimateGas. Returns the gas estimate, or throws with the revert reason. */
  async simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint> {
    const req = { from: this.address, to: tx.to, data: tx.data, value: tx.value };
    await this.provider.call(req);
    return this.provider.estimateGas(req);
  }

  /**
   * Sign and send through the private RPC, wait for inclusion.
   * If it is not mined within timeoutSec, replace it with a 0-value self-transfer (cancel).
   */
  async send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
  ): Promise<TxResult> {
    const wallet = this.wallet!;
    const nonce = await this.provider.getTransactionCount(wallet.address, 'pending');
    const base = { chainId: 1n, type: 2, nonce, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip };
    const signed = await wallet.signTransaction({ ...base, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit });
    const hash = ethers.keccak256(signed);
    await this.sendProvider.send('eth_sendRawTransaction', [signed]);
    log.info(`tx sent ${hash}`);

    let receipt = await this.waitReceipt(hash, timeoutSec);
    if (!receipt) {
      log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
      const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
      const cancel = await wallet.signTransaction({
        ...base,
        maxFeePerGas: bump(gas.maxFee),
        maxPriorityFeePerGas: bump(gas.tip),
        to: wallet.address,
        value: 0n,
        gasLimit: 21_000n,
      });
      const cancelHash = ethers.keccak256(cancel);
      await this.sendProvider.send('eth_sendRawTransaction', [cancel]).catch((e) => log.warn(`cancel send failed: ${errMsg(e)}`));
      const deadline = Date.now() + timeoutSec * 1000;
      while (Date.now() < deadline && !receipt) {
        receipt = await this.provider.getTransactionReceipt(hash);
        const cancelReceipt = await this.provider.getTransactionReceipt(cancelHash);
        if (cancelReceipt) {
          return { ok: false, hash, gasCostWei: cancelReceipt.gasUsed * cancelReceipt.gasPrice, reason: 'not mined, cancelled' };
        }
        if (!receipt) await sleep(3000);
      }
      if (!receipt) return { ok: false, hash, gasCostWei: 0n, reason: 'not mined and cancel not confirmed: CHECK WALLET' };
    }
    const cost = receipt.gasUsed * receipt.gasPrice;
    return receipt.status === 1 ? { ok: true, hash, gasCostWei: cost } : { ok: false, hash, gasCostWei: cost, reason: 'reverted' };
  }

  private async waitReceipt(hash: string, timeoutSec: number) {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const r = await this.provider.getTransactionReceipt(hash).catch(() => null);
      if (r) return r;
      await sleep(2000);
    }
    return null;
  }
}
```

## `test/engine.test.ts`

```ts
// End-to-end tests of the trading engine with fake MEXC, chain and aggregator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { Engine } from '../src/engine.js';
import type { Balances } from '../src/inventory.js';
import type { Token } from '../src/watchlist.js';
import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
import type { TxResult } from '../src/dex/chain.js';
import type { Book, Order } from '../src/mexc/rest.js';

const GWEI = 1_000_000_000n;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const LINK: Token = {
  base: 'LINK', symbol: 'LINKUSDT', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18,
  qtyStep: 0.01, priceDecimals: 3, dexTvlUsd: 1e6, mexcVolumeUsd: 1e7, depositOk: true, withdrawOk: true,
};

function setup(opts: {
  mode?: 'live' | 'paper';
  bid?: number;
  gasGwei?: bigint;
  dexOk?: boolean;
  simulateThrows?: boolean;
  approvalNeeded?: boolean;
  mexcFillRatio?: number;
}) {
  process.env.MODE = opts.mode ?? 'live';
  process.env.RPC_URL = 'http://localhost';
  process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
  process.env.MEXC_API_KEY = 'k'.repeat(10);
  process.env.MEXC_API_SECRET = 's'.repeat(10);
  const cfg = loadConfig();
  const db = new Db(':memory:');
  const risk = new Risk(db, cfg.mode, cfg);
  const alerts: string[] = [];
  const calls: string[] = [];

  const fee = cfg.mexcTakerFee;
  const bid = opts.bid ?? 11.2;
  // Real-ish balances that the fakes update, so PnL is computed from balance changes.
  const bal: Balances = { walletEth: 1, walletUsdc: 1000, walletToken: { LINK: 100 }, mexc: { USDT: 1000, LINK: 100 } };
  const ethUsd = 2000;

  const books: Record<string, Book> = {
    ETHUSDT: { bids: [[ethUsd, 100]], asks: [[ethUsd, 100]], ts: Date.now() },
    LINKUSDT: { bids: [[bid, 1000]], asks: [[bid + 0.01, 1000]], ts: Date.now() },
  };

  // DEX price = 10 USDC per LINK, 0.1% minOut buffer.
  const dexQuote = (r: QuoteRequest, firm: boolean): Quote => {
    const buyingToken = r.sellToken === USDC;
    const out = buyingToken ? (r.sellAmount * 10n ** 12n) / 10n : (r.sellAmount * 10n) / 10n ** 12n;
    return {
      buyAmount: out,
      minBuyAmount: (out * 999n) / 1000n,
      gas: 150_000n,
      spender: '0xspender',
      tx: firm ? { to: '0xrouter', data: '0xdead', value: 0n } : undefined,
    };
  };
  let lastFirm: QuoteRequest | null = null;

  const orders = new Map<string, Order>();
  let nextId = 1;
  const fill = (side: 'BUY' | 'SELL', qty: number, price: number) => {
    if (side === 'SELL') {
      bal.mexc.LINK -= qty;
      bal.mexc.USDT += qty * price * (1 - fee);
    } else {
      bal.mexc.LINK += qty * (1 - fee);
      bal.mexc.USDT -= qty * price;
    }
  };

  const engine = new Engine({
    cfg,
    db,
    risk,
    tokens: [LINK],
    sleep: async () => {},
    tg: { send: async (t) => void alerts.push(t) },
    book: async (s) => books[s],
    balances: async () => structuredClone(bal),
    agg: {
      name: '0x',
      price: async (r) => dexQuote(r, false),
      quote: async (r) => ((lastFirm = r), dexQuote(r, true)),
    },
    chain: {
      address: '0xme',
      gas: async () => {
        const base = (opts.gasGwei ?? 9n) * GWEI;
        return { baseFee: base, tip: GWEI, effective: base + GWEI, maxFee: base * 2n + GWEI };
      },
      approvalGasNeeded: async () => (opts.approvalNeeded ? 60_000n : 0n),
      approveExact: async (_t, _s, amount) => {
        calls.push(`approve ${amount}`);
        bal.walletEth -= 0.0006;
        return { ok: true, gasCostWei: 600_000n * GWEI };
      },
      simulate: async () => {
        calls.push('simulate');
        if (opts.simulateThrows) throw new Error('execution reverted');
        return 150_000n;
      },
      send: async (): Promise<TxResult> => {
        calls.push('send');
        const gasWei = 150_000n * 10n * GWEI;
        bal.walletEth -= 0.0015;
        if (opts.dexOk === false) return { ok: false, hash: '0xtx', gasCostWei: gasWei, reason: 'reverted' };
        const r = lastFirm!;
        if (r.sellToken === USDC) {
          bal.walletUsdc -= Number(r.sellAmount) / 1e6;
          bal.walletToken.LINK += (Number(r.sellAmount) / 1e6) / 10;
        } else {
          const tokens = Number(r.sellAmount) / 1e18;
          bal.walletToken.LINK -= tokens;
          bal.walletUsdc += tokens * 10;
        }
        return { ok: true, hash: '0xtx', gasCostWei: gasWei };
      },
    },
    mexc: {
      limitOrder: async (_s, side, q, p) => {
        calls.push(`limit ${side} ${q} @ ${p}`);
        const id = String(nextId++);
        const filled = Number(q) * (opts.mexcFillRatio ?? 1);
        fill(side, filled, Number(p));
        orders.set(id, { orderId: id, status: filled === Number(q) ? 'FILLED' : 'PARTIALLY_FILLED', executedQty: String(filled), cummulativeQuoteQty: '0', origQty: q, price: p, side });
        return { orderId: id };
      },
      marketSell: async (_s, q) => {
        calls.push(`market SELL ${q}`);
        fill('SELL', Number(q), bid);
        return { orderId: 'm' };
      },
      getOrder: async (_s, id) => orders.get(id)!,
      cancelOrder: async (_s, id) => {
        calls.push(`cancel ${id}`);
        const o = orders.get(id)!;
        o.status = 'PARTIALLY_CANCELED';
        return o;
      },
    },
  });
  return { engine, db, risk, alerts, calls, bal, cfg };
}

const trades = (db: Db) => db.statsSince(0);

test('profitable gap: both legs trade, PnL comes from real balance changes', async () => {
  const { engine, db, alerts, calls } = setup({});
  await engine.tick();
  // MEXC sell 20 LINK (bought 20 on DEX for $200), limit = 11.2 * (1 - 0.2%) rounded down.
  assert.deepEqual(calls, ['simulate', 'limit SELL 20.00 @ 11.177', 'send']);
  const s = trades(db);
  assert.equal(s.total.trades, 1);
  assert.equal(s.total.failed, 0);
  // +20 LINK in wallet, -20 on MEXC; -$200 USDC; +20*11.177*(1-0.0005) USDT; -0.0015 ETH gas
  const expected = -200 + 20 * 11.177 * 0.9995 - 0.0015 * 2000;
  assert.ok(Math.abs(s.total.pnl - expected) < 1e-6, `${s.total.pnl} vs ${expected}`);
  assert.ok(Math.abs(s.total.gas - 3) < 1e-9);
  assert.ok(alerts.some((a) => a.includes('✅ LIVE LINK DEX_BUY [ok]') && a.includes('Net PnL')));
});

test('no trade when the gap is below max($15, 0.5%)', async () => {
  const { engine, db, calls } = setup({ bid: 10.9 });
  await engine.tick();
  assert.deepEqual(calls, []);
  assert.equal(trades(db).total.trades, 0);
});

test('DEX leg fails after MEXC sold: buys back at market, alerts one-sided', async () => {
  const { engine, db, alerts, calls, bal } = setup({ dexOk: false });
  await engine.tick();
  assert.ok(calls.includes('limit BUY 20.00 @ 11.435')); // close: aggressive limit 2% over ask 11.21
  const row = trades(db);
  assert.equal(row.total.failed, 1);
  assert.ok(alerts.some((a) => a.startsWith('⚠️ ONE-SIDED FILL LINK')));
  assert.ok(Math.abs(bal.walletToken.LINK - 100) < 1e-9); // wallet untouched
  assert.ok(Math.abs(bal.mexc.LINK - 100 + 20 * 0.0005) < 1e-9); // flat again except the fee
});

test('MEXC partial fill: rest is cancelled and closed at market', async () => {
  const { engine, calls } = setup({ mexcFillRatio: 0.5 });
  await engine.tick();
  assert.ok(calls.includes('cancel 1'));
  assert.ok(calls.includes('market SELL 10.00'));
});

test('simulation failure: nothing is sent, approval gas is still booked', async () => {
  const { engine, db, calls } = setup({ simulateThrows: true, approvalNeeded: true });
  await engine.tick();
  assert.ok(calls[0].startsWith('approve 200000000')); // exact amount: 200 USDC, never MaxUint256
  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
  const s = trades(db);
  assert.equal(s.total.trades, 0); // approval rows are not trades
  assert.ok(s.total.pnl < 0 && s.total.gas > 0);
});

test('gas above MAX_GAS_GWEI: no quotes at all', async () => {
  const { engine, calls } = setup({ gasGwei: 50n });
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('kill switch: paused bot does nothing', async () => {
  const { engine, risk, calls } = setup({});
  risk.pause('Telegram /stop');
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('3 failed trades in a row pause trading', async () => {
  const { engine, risk, alerts } = setup({ dexOk: false });
  await engine.tick();
  await engine.tick();
  await engine.tick();
  assert.equal(risk.paused, true);
  assert.ok(alerts.some((a) => a.includes('3 failed trades in a row')));
  const before = alerts.length;
  await engine.tick();
  assert.equal(alerts.length, before); // stays stopped
});

test('paper mode: records the trade, sends nothing real', async () => {
  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
  await engine.tick();
  assert.deepEqual(calls, []);
  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER LINK')));
});
```

## `test/infra.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decodeDepthPush } from '../src/mexc/proto.js';
import { MexcRest } from '../src/mexc/rest.js';
import { ZeroEx } from '../src/dex/aggregator.js';
import { Telegram } from '../src/telegram.js';
import { redact, registerSecrets } from '../src/log.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { ethNetwork } from '../src/watchlist.js';

// --- tiny protobuf encoder for building test messages ---
const varint = (n: number) => {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const field = (num: number, bytes: Uint8Array | number[]) => [...varint(num * 8 + 2), ...varint(bytes.length), ...bytes];
const s = (x: string) => [...Buffer.from(x)];
const level = (p: string, q: string) => [...field(1, s(p)), ...field(2, s(q))];

test('decodes a MEXC limit-depth protobuf push', () => {
  const depth = [
    ...field(1, level('101.5', '2')),
    ...field(1, level('101.0', '1')),
    ...field(2, level('100.0', '3')),
    ...field(2, level('100.5', '4')),
    ...field(3, s('spot@public.limit.depth.v3.api.pb')),
  ];
  const msg = Uint8Array.from([
    ...field(1, s('spot@public.limit.depth.v3.api.pb@LINKUSDT@20')),
    ...field(3, s('LINKUSDT')),
    ...varint(6 * 8), ...varint(1_795_193_165_568), // sendTime int64
    ...field(303, depth),
  ]);
  const d = decodeDepthPush(msg)!;
  assert.equal(d.symbol, 'LINKUSDT');
  assert.deepEqual(d.asks, [[101, 1], [101.5, 2]]); // sorted best first
  assert.deepEqual(d.bids, [[100.5, 4], [100, 3]]);
  assert.equal(decodeDepthPush(Uint8Array.from(field(1, s('x')))), null);
});

test('MEXC signed request: HMAC over the exact query + API key header', async () => {
  let url = '';
  let headers: Record<string, string> = {};
  const fetchFn = (async (u: string, o: { headers: Record<string, string> }) => {
    url = u;
    headers = o.headers;
    return new Response(JSON.stringify({ orderId: '42' }), { status: 200 });
  }) as unknown as typeof fetch;
  const m = new MexcRest('KEY', 'SECRET', 'https://api.mexc.com', fetchFn);
  await m.limitOrder('LINKUSDT', 'SELL', '1.50', '10.123');
  const u = new URL(url);
  const sig = u.searchParams.get('signature');
  u.searchParams.delete('signature');
  assert.equal(sig, crypto.createHmac('sha256', 'SECRET').update(u.searchParams.toString()).digest('hex'));
  assert.equal(headers['X-MEXC-APIKEY'], 'KEY');
  assert.equal(u.searchParams.get('type'), 'LIMIT');
});

test('MEXC errors never contain the secret', async () => {
  registerSecrets(['SUPERSECRETVALUE']);
  const fetchFn = (async () => new Response('bad SUPERSECRETVALUE', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(new MexcRest('k', 'SUPERSECRETVALUE', 'https://x', fetchFn).balances(), (e: Error) => !e.message.includes('SUPERSECRETVALUE'));
  assert.equal(redact('key=SUPERSECRETVALUE'), 'key=***');
});

test('0x quote parsing: amounts, gas, spender, tx', async () => {
  let called = '';
  const fetchFn = (async (u: string, o: { headers: Record<string, string> }) => {
    called = u;
    assert.equal(o.headers['0x-version'], 'v2');
    return new Response(
      JSON.stringify({
        liquidityAvailable: true,
        buyAmount: '1000',
        minBuyAmount: '990',
        issues: { allowance: { spender: '0xSpender' } },
        transaction: { to: '0xAH', data: '0xabc', gas: '150000', value: '0' },
      }),
    );
  }) as unknown as typeof fetch;
  const z = new ZeroEx('k', fetchFn);
  const q = await z.quote({ sellToken: '0xa', buyToken: '0xb', sellAmount: 5n, taker: '0xt', slippageBps: 30 });
  assert.match(called, /allowance-holder\/quote\?chainId=1/);
  assert.equal(q.buyAmount, 1000n);
  assert.equal(q.minBuyAmount, 990n);
  assert.equal(q.gas, 150000n);
  assert.equal(q.spender, '0xSpender');
  assert.equal(q.tx?.data, '0xabc');
});

test('Telegram only obeys the configured chat', async () => {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, o: { body: string }) => {
    sent.push(JSON.parse(o.body).text);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as unknown as typeof fetch;
  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn);
  let stopped = false;
  const handlers = { '/stop': () => ((stopped = true), 'stopped') };
  await tg.handle({ message: { chat: { id: 999 }, text: '/stop' } }, handlers);
  assert.equal(stopped, false);
  await tg.handle({ message: { chat: { id: 777 }, text: '/stop@MyBot' } }, handlers);
  assert.equal(stopped, true);
  assert.deepEqual(sent, ['stopped']);
});

test('Risk: loss limit, fail streak, trade limit, kill switch', () => {
  const db = new Db(':memory:');
  const now = Date.UTC(2026, 10, 20, 6);
  const risk = new Risk(db, 'live', { maxTradesPerDay: 3, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
  const row = (pnl: number, status: 'ok' | 'one_sided') =>
    db.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: pnl, status, dex_tx: null, cex_order_id: null, note: null });

  assert.equal(risk.blockReason(), null);
  row(-10, 'one_sided');
  assert.deepEqual(risk.afterTrade('one_sided'), []);
  row(-10, 'one_sided');
  risk.afterTrade('one_sided');
  row(-5, 'one_sided');
  const ev = risk.afterTrade('one_sided');
  assert.ok(ev.some((e) => e.kind === 'fail_streak'));
  assert.match(risk.blockReason()!, /paused/);

  risk.resume();
  assert.match(risk.blockReason()!, /trade limit/); // 3 trades today

  const db2 = new Db(':memory:');
  const r2 = new Risk(db2, 'live', { maxTradesPerDay: 20, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
  db2.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: -31, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
  assert.ok(r2.afterTrade('ok').some((e) => e.kind === 'loss_limit'));
  assert.match(r2.blockReason()!, /loss limit/);
  r2.resume();
  assert.match(r2.blockReason()!, /daily loss limit/); // /start cannot override today's loss limit

  r2.pause('Telegram /stop');
  assert.match(r2.blockReason()!, /Telegram \/stop/);
});

test('ethNetwork finds the Ethereum entry in MEXC coin config', () => {
  const n = ethNetwork({
    coin: 'LINK',
    networkList: [
      { coin: 'LINK', network: 'BNB Smart Chain(BEP20)', netWork: 'BSC', contract: '0xbsc', depositEnable: true, withdrawEnable: true },
      { coin: 'LINK', network: 'Ethereum(ERC20)', netWork: 'ETH', contract: '0xeth', depositEnable: true, withdrawEnable: false },
    ],
  });
  assert.equal(n?.contract, '0xeth');
});
```

## `test/pricing.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCexBuy,
  evaluateDexBuy,
  fillBase,
  fillQuote,
  gasUsd,
  planCexBuy,
  planCexBuyQty,
  threshold,
  unwindPlan,
} from '../src/pricing.js';
import { floorToStep, toFloat, toUnits, dhakaDay } from '../src/util.js';

const costs = { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 };
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('fillBase / fillQuote walk the book', () => {
  const asks: [number, number][] = [[10, 5], [11, 5]];
  assert.deepEqual(fillBase(asks, 7), { quote: 72, worst: 11 });
  assert.equal(fillBase(asks, 11), null);
  const q = fillQuote(asks, 72)!;
  close(q.qty, 7);
  assert.equal(q.worst, 11);
  assert.equal(fillQuote(asks, 1000), null);
});

test('threshold = max($15, 0.5% of size)', () => {
  assert.equal(threshold(200, 15, 0.5), 15);
  assert.equal(threshold(10_000, 15, 0.5), 50);
});

test('evaluateDexBuy: every cost is subtracted', () => {
  // Bought 20 tokens for $200 on DEX (min 19.9); MEXC bid 11 -> sell 20 for $220.
  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.9, bids: [[11, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
  const fee = 220 * 0.0005;
  const slip = 220 * 0.002 + 0.1 * 11;
  close(o.net, 220 - fee - 200 - 3 - slip - 2);
  assert.equal(o.cexQty, 20);
  close(o.cexLimitPrice, 11 * 0.998);
  close(o.buyPrice, 10);
  close(o.sellPrice, 11);
});

test('evaluateDexBuy: dust below the MEXC step is kept as inventory, not counted as profit', () => {
  const o = evaluateDexBuy({ sizeUsd: 100, tokensOut: 10.005, tokensMin: 10.005, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 0, costs: { ...costs, takerFee: 0, cexSlippageBps: 0, safetyMarginUsd: 0 } })!;
  assert.equal(o.cexQty, 10);
  close(o.net, 0.05, 1e-9); // 100 proceeds - (100 - 0.05 dust value)
});

test('planCexBuy + evaluateCexBuy: fee is paid in tokens, so fewer tokens are sold on DEX', () => {
  const plan = planCexBuy({ sizeUsd: 200, asks: [[10, 100]], qtyStep: 0.01, takerFee: 0.0005 })!;
  assert.equal(plan.qty, 20);
  close(plan.costUsd, 200);
  close(plan.tokensToSell, 20 * 0.9995);
  const o = evaluateCexBuy({ plan, usdcOut: 230, usdcMin: 229, gasUsd: 3, costs });
  close(o.net, 230 - 200 - 3 - (200 * 0.002 + 1) - 2);
  assert.deepEqual(planCexBuyQty([[10, 100]], 20, 0.0005), plan);
});

test('no opportunity when prices are equal', () => {
  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.94, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
  assert.ok(o.net < 0);
});

test('gasUsd', () => {
  close(gasUsd(200_000n, 20_000_000_000n, 2000), 8); // 200k gas * 20 gwei = 0.004 ETH
});

test('unwindPlan covers every one-sided case', () => {
  assert.equal(unwindPlan('DEX_BUY', true, 10, 10, 0.0005, 0.01), null); // both filled
  assert.deepEqual(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.side, 'SELL');
  assert.equal(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.qty, 6);
  assert.deepEqual(unwindPlan('DEX_BUY', false, 10, 10, 0.0005, 0.01)?.side, 'BUY');
  assert.equal(unwindPlan('DEX_BUY', false, 10, 0, 0.0005, 0.01), null); // nothing happened
  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.qty, 3);
  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.side, 'BUY');
  const u = unwindPlan('CEX_BUY', false, 10, 10, 0.0005, 0.01)!;
  assert.equal(u.side, 'SELL');
  assert.equal(u.qty, 9.99); // sell only what we received after the fee
});

test('util conversions', () => {
  assert.equal(floorToStep(1.23456, 0.01), 1.23);
  assert.equal(floorToStep(0.3, 0.1), 0.3);
  assert.equal(toUnits(123.456789, 6), 123456789n);
  assert.equal(toUnits(1, 18), 10n ** 18n);
  assert.equal(toFloat(1_500_000n, 6), 1.5);
  assert.equal(toFloat(5n, 18), 5e-18);
  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 18, 30)), '2026-01-02'); // 00:30 in Dhaka
  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 17, 59)), '2026-01-01');
});
```

## `test/transfer.test.ts`

```ts
// Transfer strategy: scan -> buy MEXC -> withdraw -> wait -> sell DEX, with fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { TransferEngine, type TransferMexc, type TransferChain } from '../src/transfer.js';
import { findGaps, loadUniverse, type ScanToken } from '../src/scanner.js';
import { evaluateTransfer, planCexBuy } from '../src/pricing.js';
import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
import type { Order } from '../src/mexc/rest.js';

const GWEI = 1_000_000_000n;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const XYZ = '0x1111111111111111111111111111111111111111';

const symbolInfo = (base: string) => ({
  symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true,
  baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'],
});
const coin = (base: string, contract: string, dep = true, wd = true) => ({
  coin: base,
  networkList: [{ coin: base, network: 'Ethereum(ERC20)', netWork: 'ETH', contract, depositEnable: dep, withdrawEnable: wd, withdrawFee: '1', withdrawMin: '10' }],
});

function setup(o: { dexPrice?: number; withdrawThrows?: boolean; withdrawStatus?: number; db?: Db; mode?: 'live' | 'paper' } = {}) {
  process.env.MODE = o.mode ?? 'live';
  process.env.STRATEGY = 'transfer';
  process.env.RPC_URL = 'http://localhost';
  process.env.PRIVATE_KEY = '0x' + '22'.repeat(32);
  process.env.MEXC_API_KEY = 'k'.repeat(10);
  process.env.MEXC_API_SECRET = 's'.repeat(10);
  const cfg = loadConfig();
  const db = o.db ?? new Db(':memory:');
  const risk = new Risk(db, cfg.mode, cfg);
  const alerts: string[] = [];
  const calls: string[] = [];
  const dexPrice = o.dexPrice ?? 1.15;
  const state = {
    mexc: { USDT: 1000, XYZ: 0 } as Record<string, number>,
    wallet: { [XYZ]: 0n, [USDC]: 0n } as Record<string, bigint>,
    withdrawStatus: o.withdrawStatus ?? 4,
  };
  const orders = new Map<string, Order>();
  let lastQuote: QuoteRequest | null = null;

  const mexc: TransferMexc = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD')],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }],
    coinConfigs: async () => [coin('XYZ', XYZ), coin('BAD', '0x2222222222222222222222222222222222222222', true, false)],
    bookTickers: async () => new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }]]),
    depth: async () => ({ bids: [[0.999, 1e6]], asks: [[1.0, 1e6]], ts: Date.now() }),
    balances: async () => ({ ...state.mexc }),
    limitOrder: async (_s, side, q, p) => {
      calls.push(`limit ${side} ${q} @ ${p}`);
      const qty = Number(q);
      state.mexc.USDT -= qty * 1.0;
      state.mexc.XYZ += qty * (1 - cfg.mexcTakerFee);
      orders.set('b1', { orderId: 'b1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(qty * 1.0), origQty: q, price: p, side });
      return { orderId: 'b1' };
    },
    marketSell: async (_s, q) => {
      calls.push(`market SELL ${q}`);
      state.mexc.XYZ -= Number(q);
      orders.set('s1', { orderId: 's1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(Number(q) * 0.999), origQty: q, price: '0', side: 'SELL' });
      return { orderId: 's1' };
    },
    getOrder: async (_s, id) => orders.get(id)!,
    cancelOrder: async (_s, id) => orders.get(id)!,
    withdraw: async (p) => {
      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
      if (o.withdrawThrows) throw new Error('no withdraw permission');
      state.mexc.XYZ -= Number(p.amount);
      return 'w1';
    },
    withdrawStatus: async () => ({ status: state.withdrawStatus }),
  };

  const quote = (r: QuoteRequest, firm: boolean): Quote => {
    const out = (r.sellAmount * BigInt(Math.round(dexPrice * 1e6))) / 10n ** 18n; // token(18) -> USDC(6)
    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
  };

  const chain: TransferChain = {
    address: '0xMyWallet',
    gas: async () => ({ baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI }),
    decimals: async () => 18,
    tokenBalance: async (t) => state.wallet[t] ?? 0n,
    approveExact: async (_t, s, amount) => {
      calls.push(`approve ${s} ${amount}`);
      return { ok: true, gasCostWei: 60_000n * 10n * GWEI };
    },
    simulate: async () => (calls.push('simulate'), 150_000n),
    send: async () => {
      calls.push('send');
      const r = lastQuote!;
      state.wallet[XYZ] -= r.sellAmount;
      state.wallet[USDC] += quote(r, true).buyAmount;
      return { ok: true, hash: '0xhash', gasCostWei: 150_000n * 10n * GWEI };
    },
  };

  const engine = new TransferEngine({
    cfg, mexc, chain, db, risk,
    tg: { send: async (t) => void alerts.push(t) },
    agg: { name: '0x', price: async (r) => quote(r, false), quote: async (r) => ((lastQuote = r), quote(r, true)) },
    dexPricesFn: async () => new Map([[XYZ, { price: dexPrice, tvl: 1e6 }]]),
    sleep: async () => {},
  });
  const arrive = (tokens: number) => (state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n);
  return { engine, db, risk, alerts, calls, state, arrive, cfg };
}

test('loadUniverse keeps only ERC20 tokens with deposit AND withdraw open', async () => {
  const { engine } = setup();
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']); // BAD has withdrawals suspended
  assert.equal(engine.universe[0].address, XYZ);
  assert.equal(engine.universe[0].netWork, 'ETH');
  assert.equal(engine.universe[0].withdrawFee, 1);
});

test('findGaps: filters TVL, too-small and absurd gaps, sorts biggest first', () => {
  const tok = (base: string, address: string): ScanToken => ({ base, symbol: `${base}USDT`, address, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6 });
  const tokens = [tok('A', '0xa'), tok('B', '0xb'), tok('C', '0xc'), tok('D', '0xd'), tok('E', '0xe')];
  const tickers = new Map(['A', 'B', 'C', 'D', 'E'].map((b) => [`${b}USDT`, { bid: 0.99, ask: 1 }]));
  const dex = new Map([
    ['0xa', { price: 1.05, tvl: 1e6 }], // 5%
    ['0xb', { price: 1.1, tvl: 1e6 }], // 10%
    ['0xc', { price: 1.1, tvl: 1000 }], // thin pool
    ['0xd', { price: 1.01, tvl: 1e6 }], // 1% < min
    ['0xe', { price: 3, tvl: 1e6 }], // 200%: broken / different token
  ]);
  const g = findGaps(tokens, tickers, dex, { minTvlUsd: 200_000, minGapPct: 3 });
  assert.deepEqual(g.map((x) => x.token.base), ['B', 'A']);
});

test('evaluateTransfer subtracts withdraw fee, drift reserve and all costs', () => {
  const plan = planCexBuy({ sizeUsd: 200, asks: [[1, 1e6]], qtyStep: 0.01, takerFee: 0.0005 })!;
  const ev = evaluateTransfer({ plan, withdrawFeeTokens: 1, usdcOut: 228.7, usdcMin: 228.5, gasUsd: 4, driftBps: 150, costs: { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 } });
  assert.ok(Math.abs(ev.arriving - (200 * 0.9995 - 1)) < 1e-9);
  const expected = 228.7 - 200 - 4 - (0.4 + 0.2) - 228.7 * 0.015 - 2;
  assert.ok(Math.abs(ev.net - expected) < 1e-9);
});

test('full cycle: buy on MEXC -> withdraw to own wallet -> wait -> sell on DEX -> PnL', async () => {
  const { engine, db, calls, alerts, arrive } = setup();
  await engine.tick(); // finds gap, buys, withdraws
  assert.equal(calls[0], 'limit BUY 200.00 @ 1.0020');
  assert.equal(calls[1], 'withdraw 199.90 XYZ ETH -> 0xMyWallet'); // only ever our own wallet
  assert.equal(db.openTransfers()[0].status, 'withdrawing');
  assert.ok(alerts.some((a) => a.startsWith('📤 TRANSFER #1 XYZ')));

  await engine.tick(); // still on its way: nothing new is bought meanwhile
  assert.equal(calls.filter((c) => c.startsWith('limit')).length, 1);

  arrive(198.9); // 199.9 - 1 withdraw fee
  await engine.tick();
  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
  assert.ok(calls.includes('simulate') && calls.includes('send'));
  assert.ok(!db.openTransfers().some((t) => t.id === 1)); // #1 done (a new one may start: gap still open)

  const s = db.statsSince(0, 'live');
  assert.equal(s.total.trades, 1);
  assert.equal(s.total.failed, 0);
  const usdcOut = Math.floor(198.9 * 1.15 * 1e6) / 1e6;
  const gas = (0.0006 + 0.0015) * 2000;
  assert.ok(Math.abs(s.total.pnl - (usdcOut - 200 - gas)) < 1e-6, String(s.total.pnl));
  assert.ok(alerts.some((a) => a.includes('TRANSFER #1 XYZ done') && a.includes('Net PnL')));
});

test('restart while withdrawing: a new engine resumes the same transfer', async () => {
  const first = setup();
  await first.engine.tick();
  // "restart": new engine, same database and balances
  const second = setup({ db: first.db });
  Object.assign(second.state, first.state);
  second.state.wallet[XYZ] = BigInt(198.9e6) * 10n ** 12n;
  await second.engine.tick();
  assert.ok(!first.db.openTransfers().some((t) => t.id === 1));
  assert.equal(first.db.statsSince(0, 'live').total.trades, 1);
});

test('withdraw rejected: sells the tokens back on MEXC and records a failure', async () => {
  const { engine, db, calls, alerts } = setup({ withdrawThrows: true });
  await engine.tick();
  assert.ok(calls.includes('market SELL 199.90'));
  assert.equal(db.openTransfers().length, 0);
  assert.equal(db.statsSince(0, 'live').total.failed, 1);
  assert.ok(alerts.some((a) => a.includes('withdraw failed')));
});

test('withdrawal FAILED on MEXC side: sells back on MEXC', async () => {
  const { engine, db, calls, state } = setup();
  await engine.tick();
  state.withdrawStatus = 8;
  state.mexc.XYZ += 199.9; // funds returned to the MEXC account
  await engine.tick();
  assert.ok(calls.includes('market SELL 199.90'));
  assert.ok(!db.openTransfers().some((t) => t.id === 1));
});

test('gap too small after exact costs: nothing happens', async () => {
  const { engine, calls } = setup({ dexPrice: 1.05 }); // 5% gap, but drift+gas+fees+min $15 eat it
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('paused bot does not open new transfers', async () => {
  const { engine, risk, calls } = setup();
  risk.pause('Telegram /stop');
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('paper mode records the opportunity without orders or withdrawals', async () => {
  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
  await engine.tick();
  assert.deepEqual(calls, []);
  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER TRANSFER XYZ')));
});

test('loadUniverse respects WATCHLIST', async () => {
  const fake = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC')],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }, { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' }],
    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', '0x3333333333333333333333333333333333333333')],
  };
  const u = await loadUniverse(fake as never, { minVolumeUsd: 1, only: ['ABC'] });
  assert.deepEqual(u.map((t) => t.base), ['ABC']);
});
```

