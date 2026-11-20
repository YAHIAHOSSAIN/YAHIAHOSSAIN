# mexc-dex-arb: full source for review

MEXC <-> Ethereum DEX arbitrage bot (TypeScript, Node 20). Default MODE=paper, STRATEGY=inventory. Line numbers are per file.

## `package.json`

```json
     1	{
     2	  "name": "mexc-dex-arb",
     3	  "version": "1.0.0",
     4	  "private": true,
     5	  "description": "MEXC spot <-> Ethereum DEX (0x / 1inch) inventory arbitrage bot",
     6	  "type": "module",
     7	  "engines": {
     8	    "node": ">=20"
     9	  },
    10	  "scripts": {
    11	    "build": "tsc -p tsconfig.json",
    12	    "start": "node dist/main.js",
    13	    "dev": "tsx src/main.ts",
    14	    "report": "node dist/report.js",
    15	    "test": "tsx --test test/*.test.ts",
    16	    "typecheck": "tsc -p tsconfig.json --noEmit"
    17	  },
    18	  "dependencies": {
    19	    "better-sqlite3": "^12.0.0",
    20	    "dotenv": "^16.6.1",
    21	    "ethers": "6.17.0",
    22	    "ws": "^8.18.3"
    23	  },
    24	  "devDependencies": {
    25	    "@types/better-sqlite3": "^7.6.13",
    26	    "@types/node": "^20.19.0",
    27	    "@types/ws": "^8.18.1",
    28	    "tsx": "^4.20.0",
    29	    "typescript": "^5.9.0"
    30	  }
    31	}
```

## `tsconfig.json`

```json
     1	{
     2	  "compilerOptions": {
     3	    "target": "ES2022",
     4	    "module": "NodeNext",
     5	    "moduleResolution": "NodeNext",
     6	    "outDir": "dist",
     7	    "rootDir": "src",
     8	    "strict": true,
     9	    "esModuleInterop": true,
    10	    "skipLibCheck": true,
    11	    "sourceMap": true
    12	  },
    13	  "include": ["src"]
    14	}
```

## `.gitignore`

```text
     1	node_modules/
     2	dist/
     3	data/
     4	logs/
     5	.env
```

## `.env.example`

```bash
     1	# Copy to .env, fill in, then: chmod 600 .env
     2	# The bot refuses to start in live mode if .env is readable by other users.
     3	
     4	# paper (default: no orders, no transactions) | live (real money)
     5	# Run paper for at least 7 days first, then live with MAX_TRADE_USD=50.
     6	MODE=paper
     7	
     8	# inventory = hold tokens on both sides, trade both legs at the same moment (default, NO withdrawals)
     9	# transfer  = buy on MEXC -> WITHDRAW to wallet -> sell on DEX. Needs a withdraw-enabled MEXC key and
    10	#             an unhedged position for 5-60+ min. Refuses to start unless ALLOW_WITHDRAWALS=yes.
    11	STRATEGY=inventory
    12	ALLOW_WITHDRAWALS=no
    13	
    14	# ---------- Ethereum ----------
    15	# Your own RPC (Alchemy / Infura / QuickNode). Used for reading and simulation.
    16	RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
    17	# Private RPC for sending (never the public mempool): MEV Blocker or Flashbots Protect
    18	SEND_RPC_URL=https://rpc.mevblocker.io
    19	# SEND_RPC_URL=https://rpc.flashbots.net/fast
    20	# NEW hot wallet used only by this bot. Keep only the trading inventory in it.
    21	PRIVATE_KEY=
    22	
    23	# ---------- DEX aggregator ----------
    24	# 0x (https://dashboard.0x.org) or 1inch (https://portal.1inch.dev)
    25	DEX_AGGREGATOR=0x
    26	ZEROX_API_KEY=
    27	ONEINCH_API_KEY=
    28	
    29	# ---------- MEXC ----------
    30	# API key: Spot TRADE permission ONLY. NO withdraw permission. IP-whitelisted to your VPS.
    31	# (Only for STRATEGY=transfer + ALLOW_WITHDRAWALS=yes would withdraw be needed - not recommended.)
    32	MEXC_API_KEY=
    33	MEXC_API_SECRET=
    34	MEXC_TAKER_FEE=0.0005
    35	
    36	# ---------- Telegram ----------
    37	# Create a bot with @BotFather, send it any message, then get your chat id from
    38	# https://api.telegram.org/bot<TOKEN>/getUpdates  (message.chat.id)
    39	TELEGRAM_BOT_TOKEN=
    40	TELEGRAM_CHAT_ID=
    41	# Your own Telegram user id (message.from.id). Commands are obeyed only from this user, in a private chat.
    42	TELEGRAM_ADMIN_ID=
    43	
    44	# ---------- Watchlist ----------
    45	# Optional: only these tokens (MEXC base symbols). Empty = auto-discover by volume.
    46	WATCHLIST=
    47	WATCHLIST_MAX=8
    48	MIN_DEX_TVL_USD=200000
    49	MIN_MEXC_VOLUME_USD=500000
    50	
    51	# ---------- Profit rules ----------
    52	# Trade only if net > max(MIN_PROFIT_USD, MIN_PROFIT_PCT% of size)
    53	# Keep this small vs MAX_TRADE_USD (the bot refuses > 10%): $15 on a $50 trade = only fake gaps pass.
    54	MIN_PROFIT_USD=2
    55	MIN_PROFIT_PCT=0.5
    56	DEX_SLIPPAGE_BPS=30
    57	CEX_SLIPPAGE_BPS=20
    58	SAFETY_MARGIN_USD=2
    59	PRIORITY_FEE_GWEI=1
    60	
    61	# ---------- Risk limits ----------
    62	MAX_TRADE_USD=50
    63	MIN_TRADE_USD=25
    64	MAX_TRADES_PER_DAY=20
    65	DAILY_LOSS_LIMIT_USD=30
    66	# Skip a trade if losing this % of its size (+ gas) would break what is left of the daily loss budget
    67	WORST_CASE_LOSS_PCT=5
    68	MAX_GAS_GWEI=40
    69	MAX_CONSECUTIVE_FAILS=3
    70	MIN_ETH_FOR_GAS=0.01
    71	TX_TIMEOUT_SEC=60
    72	
    73	# ---------- Transfer strategy ----------
    74	SCAN_INTERVAL_SEC=20
    75	# Cheap pre-filter (MEXC ask vs DexScreener price) before exact quotes
    76	SCAN_MIN_GAP_PCT=3
    77	# Bigger "gaps" are almost always a wrong token or a dead pool
    78	SCAN_MAX_GAP_PCT=30
    79	SCAN_EXACT_QUOTES=5
    80	# Price-move reserve while the withdrawal travels (150 = 1.5%)
    81	TRANSFER_DRIFT_BPS=150
    82	TRANSFER_TIMEOUT_MIN=90
    83	MAX_OPEN_TRANSFERS=1
    84	# On arrival, do not auto-sell at more than this % loss vs the MEXC cost: hold + alert (/sell <id> forces)
    85	TRANSFER_MAX_LOSS_PCT=3
    86	
    87	DB_PATH=data/bot.sqlite
```

## `ecosystem.config.cjs`

```js
     1	// pm2 start ecosystem.config.cjs
     2	module.exports = {
     3	  apps: [
     4	    {
     5	      name: 'mexc-dex-arb',
     6	      script: 'dist/main.js',
     7	      cwd: __dirname,
     8	      autorestart: true,
     9	      // Keep restarting (with growing delay) instead of giving up silently after a few crashes.
    10	      max_restarts: 1000,
    11	      min_uptime: '60s',
    12	      exp_backoff_restart_delay: 5000,
    13	      time: true,
    14	      out_file: 'logs/out.log',
    15	      error_file: 'logs/error.log',
    16	    },
    17	  ],
    18	};
```

## `src/config.ts`

```ts
     1	import 'dotenv/config';
     2	
     3	export type Mode = 'live' | 'paper';
     4	export type AggregatorName = '0x' | '1inch';
     5	
     6	function str(name: string, def?: string): string {
     7	  const v = process.env[name];
     8	  if (v === undefined || v === '') {
     9	    if (def === undefined) throw new Error(`Missing required env var ${name} (see .env.example)`);
    10	    return def;
    11	  }
    12	  return v.trim();
    13	}
    14	function num(name: string, def: number): number {
    15	  const v = Number(str(name, String(def)));
    16	  if (!Number.isFinite(v)) throw new Error(`Env var ${name} must be a number`);
    17	  return v;
    18	}
    19	
    20	export function loadConfig() {
    21	  const mode = str('MODE', 'paper').toLowerCase() as Mode;
    22	  if (mode !== 'live' && mode !== 'paper') throw new Error('MODE must be live or paper');
    23	  const aggregator = str('DEX_AGGREGATOR', '0x') as AggregatorName;
    24	  if (aggregator !== '0x' && aggregator !== '1inch') throw new Error('DEX_AGGREGATOR must be 0x or 1inch');
    25	
    26	  const strategy = str('STRATEGY', 'inventory').toLowerCase();
    27	  if (strategy !== 'transfer' && strategy !== 'inventory') throw new Error('STRATEGY must be transfer or inventory');
    28	  // Transfer mode needs a MEXC key that can WITHDRAW. That is off unless explicitly allowed.
    29	  if (strategy === 'transfer' && str('ALLOW_WITHDRAWALS', 'no').toLowerCase() !== 'yes') {
    30	    throw new Error('STRATEGY=transfer needs MEXC withdrawals; set ALLOW_WITHDRAWALS=yes only if you accept that risk');
    31	  }
    32	
    33	  return {
    34	    mode,
    35	    // transfer  = scan all MEXC ERC20 tokens, buy on MEXC, withdraw to wallet, sell on DEX
    36	    // inventory = hold tokens on both sides and trade both legs at the same moment
    37	    strategy: strategy as 'transfer' | 'inventory',
    38	    // --- Ethereum ---
    39	    rpcUrl: str('RPC_URL'),
    40	    // Private RPC for sending: never the public mempool.
    41	    sendRpcUrl: str('SEND_RPC_URL', 'https://rpc.mevblocker.io'),
    42	    privateKey: mode === 'live' ? str('PRIVATE_KEY') : str('PRIVATE_KEY', ''),
    43	    usdc: str('USDC_ADDRESS', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48').toLowerCase(),
    44	    // --- DEX aggregator ---
    45	    aggregator,
    46	    zeroExApiKey: str('ZEROX_API_KEY', ''),
    47	    oneInchApiKey: str('ONEINCH_API_KEY', ''),
    48	    // --- MEXC ---
    49	    mexcApiKey: mode === 'live' ? str('MEXC_API_KEY') : str('MEXC_API_KEY', ''),
    50	    mexcApiSecret: mode === 'live' ? str('MEXC_API_SECRET') : str('MEXC_API_SECRET', ''),
    51	    mexcTakerFee: num('MEXC_TAKER_FEE', 0.0005),
    52	    // --- Telegram ---
    53	    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    54	    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    55	    // Only this Telegram user may send commands (in a private chat with the bot).
    56	    telegramAdminId: str('TELEGRAM_ADMIN_ID', ''),
    57	    // --- Watchlist ---
    58	    watchlist: str('WATCHLIST', '')
    59	      .split(',')
    60	      .map((s) => s.trim().toUpperCase())
    61	      .filter(Boolean),
    62	    watchlistMax: num('WATCHLIST_MAX', 8),
    63	    minDexTvlUsd: num('MIN_DEX_TVL_USD', 200_000),
    64	    minMexcVolumeUsd: num('MIN_MEXC_VOLUME_USD', 500_000),
    65	    // --- Costs & thresholds ---
    66	    // Must be small relative to MAX_TRADE_USD: $15 on a $50 trade would need a ~30% gap = only fake gaps pass.
    67	    minProfitUsd: num('MIN_PROFIT_USD', 2),
    68	    minProfitPct: num('MIN_PROFIT_PCT', 0.5), // percent of trade size
    69	    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
    70	    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 20),
    71	    safetyMarginUsd: num('SAFETY_MARGIN_USD', 2),
    72	    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
    73	    // --- Risk limits ---
    74	    maxTradeUsd: num('MAX_TRADE_USD', 50),
    75	    minTradeUsd: num('MIN_TRADE_USD', 25),
    76	    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
    77	    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
    78	    // Skip a trade if losing this % of its size (+ gas) would break the remaining daily loss budget.
    79	    worstCaseLossPct: num('WORST_CASE_LOSS_PCT', 5),
    80	    maxGasGwei: num('MAX_GAS_GWEI', 40),
    81	    maxConsecutiveFails: num('MAX_CONSECUTIVE_FAILS', 3),
    82	    minEthForGas: num('MIN_ETH_FOR_GAS', 0.01),
    83	    txTimeoutSec: num('TX_TIMEOUT_SEC', 60),
    84	    // --- Transfer strategy (scanner) ---
    85	    scanIntervalSec: num('SCAN_INTERVAL_SEC', 20),
    86	    scanMinGapPct: num('SCAN_MIN_GAP_PCT', 3), // cheap pre-filter before exact quotes
    87	    scanMaxGapPct: num('SCAN_MAX_GAP_PCT', 30), // bigger gaps are almost always a wrong token / dead pool
    88	    scanExactQuotes: num('SCAN_EXACT_QUOTES', 5), // max exact DEX quotes per scan
    89	    transferDriftBps: num('TRANSFER_DRIFT_BPS', 150), // price-move reserve while withdrawing
    90	    transferTimeoutMin: num('TRANSFER_TIMEOUT_MIN', 90),
    91	    maxOpenTransfers: num('MAX_OPEN_TRANSFERS', 1),
    92	    // After arrival, do not sell automatically if it would lose more than this % of the cost: hold + alert.
    93	    transferMaxLossPct: num('TRANSFER_MAX_LOSS_PCT', 3),
    94	    // --- Misc ---
    95	    dbPath: str('DB_PATH', 'data/bot.sqlite'),
    96	    envPath: str('ENV_PATH', '.env'),
    97	  };
    98	}
    99	
   100	export type Config = ReturnType<typeof loadConfig>;
   101	
   102	/** Reject settings that would make the bot trade backwards or without limits. */
   103	export function validateConfig(c: Config): Config {
   104	  const errs: string[] = [];
   105	  const range = (name: string, v: number, min: number, max: number) => {
   106	    if (!(v >= min && v <= max)) errs.push(`${name}=${v} must be between ${min} and ${max}`);
   107	  };
   108	  range('MIN_PROFIT_USD', c.minProfitUsd, 0, 1e6);
   109	  // A floor above 10% of the trade size means only absurd (fake / dead-pool) gaps could ever pass.
   110	  if (c.minProfitUsd > c.maxTradeUsd * 0.1) {
   111	    errs.push(`MIN_PROFIT_USD=${c.minProfitUsd} is more than 10% of MAX_TRADE_USD=${c.maxTradeUsd}: only fake gaps could pass`);
   112	  }
   113	  range('MIN_PROFIT_PCT', c.minProfitPct, 0, 100);
   114	  range('DEX_SLIPPAGE_BPS', c.dexSlippageBps, 1, 500);
   115	  range('CEX_SLIPPAGE_BPS', c.cexSlippageBps, 0, 500);
   116	  range('SAFETY_MARGIN_USD', c.safetyMarginUsd, 0, 1e6);
   117	  range('MEXC_TAKER_FEE', c.mexcTakerFee, 0, 0.01);
   118	  range('MAX_TRADE_USD', c.maxTradeUsd, 1, 1e7);
   119	  range('MIN_TRADE_USD', c.minTradeUsd, 1, c.maxTradeUsd);
   120	  range('MAX_TRADES_PER_DAY', c.maxTradesPerDay, 1, 10_000);
   121	  range('DAILY_LOSS_LIMIT_USD', c.dailyLossLimitUsd, 0.01, 1e7);
   122	  range('WORST_CASE_LOSS_PCT', c.worstCaseLossPct, 0, 100);
   123	  range('MAX_GAS_GWEI', c.maxGasGwei, 0.01, 1000);
   124	  range('MAX_CONSECUTIVE_FAILS', c.maxConsecutiveFails, 1, 100);
   125	  range('TX_TIMEOUT_SEC', c.txTimeoutSec, 12, 600);
   126	  range('SCAN_INTERVAL_SEC', c.scanIntervalSec, 5, 3600);
   127	  range('SCAN_MIN_GAP_PCT', c.scanMinGapPct, 0, c.scanMaxGapPct);
   128	  range('SCAN_MAX_GAP_PCT', c.scanMaxGapPct, c.scanMinGapPct, 100);
   129	  range('TRANSFER_DRIFT_BPS', c.transferDriftBps, 0, 5000);
   130	  range('TRANSFER_TIMEOUT_MIN', c.transferTimeoutMin, 5, 24 * 60);
   131	  range('TRANSFER_MAX_LOSS_PCT', c.transferMaxLossPct, 0, 100);
   132	  range('MAX_OPEN_TRANSFERS', c.maxOpenTransfers, 1, 10);
   133	  if (errs.length) throw new Error(`Invalid config:\n  ${errs.join('\n  ')}`);
   134	  return c;
   135	}
   136	
   137	/** Every secret value, so the logger can scrub them from any output. */
   138	export function secretsOf(cfg: Config): string[] {
   139	  // RPC URLs usually embed a provider API key (Alchemy/Infura), so they are secrets too.
   140	  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken, cfg.rpcUrl, cfg.sendRpcUrl]
   141	    .filter((s) => s && s.length >= 8)
   142	    .flatMap((s) => [s, s.replace(/^0x/, '')]);
   143	}
```

## `src/db.ts`

```ts
     1	// SQLite storage: trades and persistent bot state (pause flag, failure streak, ...).
     2	import Database from 'better-sqlite3';
     3	import fs from 'node:fs';
     4	import path from 'node:path';
     5	
     6	// 'approval' = gas spent on an approval for a trade that was then skipped (a real cost, not a trade).
     7	// 'executing' = written BEFORE the legs fire; if the bot dies mid-trade, startup finds it and stays paused.
     8	export type TradeStatus = 'ok' | 'one_sided' | 'dex_failed' | 'cex_failed' | 'paper' | 'approval' | 'executing';
     9	
    10	export interface TradeRow {
    11	  ts: number;
    12	  day: string; // Bangladesh day
    13	  mode: string;
    14	  symbol: string;
    15	  direction: string;
    16	  size_usd: number;
    17	  qty: number;
    18	  buy_price: number;
    19	  sell_price: number;
    20	  expected_net: number;
    21	  cex_fee_usd: number;
    22	  gas_usd: number;
    23	  pnl_usd: number;
    24	  status: TradeStatus;
    25	  dex_tx: string | null;
    26	  cex_order_id: string | null;
    27	  note: string | null;
    28	}
    29	
    30	// One buy -> withdraw -> sell cycle. Persisted so a restart resumes it where it stopped.
    31	export type TransferStatus = 'buying' | 'withdrawing' | 'selling' | 'done' | 'failed' | 'stuck';
    32	export interface TransferRow {
    33	  id?: number;
    34	  ts: number;
    35	  updated: number;
    36	  base: string;
    37	  symbol: string;
    38	  address: string;
    39	  decimals: number;
    40	  net_work: string;
    41	  qty_step: number;
    42	  price_decimals: number;
    43	  status: TransferStatus;
    44	  buy_qty: number;
    45	  cost_usd: number;
    46	  buy_order_id: string | null;
    47	  withdraw_amount: string | null;
    48	  withdraw_id: string | null;
    49	  wallet_before: string | null; // token balance (base units) before the withdrawal
    50	  received: string | null; // base units that arrived
    51	  usdc_out: number | null;
    52	  gas_usd: number;
    53	  expected_net: number;
    54	  pnl: number | null;
    55	  sell_attempts: number;
    56	  alerted_timeout: number; // 0 none, 1 slow alert sent, 2 given up waiting (no longer blocks new trades)
    57	  note: string | null;
    58	  withdraw_fee: number; // tokens, fixed at decision time
    59	  next_try: number; // ms timestamp: no sell attempt before this (backoff)
    60	  force_sell: number; // 1 = /sell command: sell even below the loss floor
    61	  hold_alerted: number;
    62	  sell_tx: string | null; // DEX sale tx hash, written before broadcast (crash safety)
    63	}
    64	
    65	const TRANSFER_MIGRATIONS = [
    66	  'ALTER TABLE transfers ADD COLUMN withdraw_fee REAL NOT NULL DEFAULT 0',
    67	  'ALTER TABLE transfers ADD COLUMN next_try INTEGER NOT NULL DEFAULT 0',
    68	  'ALTER TABLE transfers ADD COLUMN force_sell INTEGER NOT NULL DEFAULT 0',
    69	  'ALTER TABLE transfers ADD COLUMN hold_alerted INTEGER NOT NULL DEFAULT 0',
    70	  'ALTER TABLE transfers ADD COLUMN sell_tx TEXT',
    71	];
    72	
    73	export class Db {
    74	  private db: Database.Database;
    75	
    76	  constructor(file: string) {
    77	    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    78	    this.db = new Database(file);
    79	    this.db.pragma('journal_mode = WAL');
    80	    this.db.exec(`
    81	      CREATE TABLE IF NOT EXISTS trades (
    82	        id INTEGER PRIMARY KEY AUTOINCREMENT,
    83	        ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
    84	        symbol TEXT NOT NULL, direction TEXT NOT NULL,
    85	        size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
    86	        expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL,
    87	        status TEXT NOT NULL, dex_tx TEXT, cex_order_id TEXT, note TEXT
    88	      );
    89	      CREATE INDEX IF NOT EXISTS trades_day ON trades(day, mode);
    90	      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    91	      CREATE TABLE IF NOT EXISTS transfers (
    92	        id INTEGER PRIMARY KEY AUTOINCREMENT,
    93	        ts INTEGER NOT NULL, updated INTEGER NOT NULL,
    94	        base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL,
    95	        net_work TEXT NOT NULL, qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL,
    96	        status TEXT NOT NULL, buy_qty REAL, cost_usd REAL, buy_order_id TEXT,
    97	        withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT,
    98	        usdc_out REAL, gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL,
    99	        sell_attempts INTEGER NOT NULL DEFAULT 0, alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT
   100	      );
   101	    `);
   102	    const cols = new Set((this.db.prepare('PRAGMA table_info(transfers)').all() as { name: string }[]).map((c) => c.name));
   103	    for (const m of TRANSFER_MIGRATIONS) {
   104	      const col = m.split(' ')[5];
   105	      if (!cols.has(col)) this.db.exec(m);
   106	    }
   107	  }
   108	
   109	  insertTrade(t: TradeRow): number {
   110	    return Number(this.db
   111	      .prepare(
   112	        `INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net,
   113	          cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note)
   114	         VALUES (@ts, @day, @mode, @symbol, @direction, @size_usd, @qty, @buy_price, @sell_price, @expected_net,
   115	          @cex_fee_usd, @gas_usd, @pnl_usd, @status, @dex_tx, @cex_order_id, @note)`,
   116	      )
   117	      .run(t).lastInsertRowid);
   118	  }
   119	
   120	  updateTrade(id: number, fields: Partial<TradeRow>): void {
   121	    const cols = Object.keys(fields);
   122	    if (!cols.length) return;
   123	    this.db.prepare(`UPDATE trades SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
   124	  }
   125	
   126	  /** Trades that were in flight when the bot stopped. */
   127	  executingTrades(): (TradeRow & { id: number })[] {
   128	    return this.db.prepare(`SELECT * FROM trades WHERE status = 'executing' ORDER BY id`).all() as (TradeRow & { id: number })[];
   129	  }
   130	
   131	  dayStats(day: string, mode: string): { trades: number; pnl: number; gas: number; failed: number } {
   132	    const r = this.db
   133	      .prepare(
   134	        `SELECT SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades,
   135	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   136	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   137	         FROM trades WHERE day = ? AND mode = ?`,
   138	      )
   139	      .get(day, mode) as { trades: number | null; pnl: number; gas: number; failed: number | null };
   140	    return { trades: r.trades ?? 0, pnl: r.pnl, gas: r.gas, failed: r.failed ?? 0 };
   141	  }
   142	
   143	  /** Stats since a timestamp, overall and per symbol. */
   144	  statsSince(sinceTs: number, mode?: string) {
   145	    const where = mode ? 'ts >= ? AND mode = ?' : 'ts >= ?';
   146	    const args = mode ? [sinceTs, mode] : [sinceTs];
   147	    const total = this.db
   148	      .prepare(
   149	        `SELECT COALESCE(SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END),0) trades,
   150	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   151	                COALESCE(SUM(cex_fee_usd),0) fees,
   152	                COALESCE(SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END),0) failed
   153	         FROM trades WHERE ${where}`,
   154	      )
   155	      .get(...args) as { trades: number; pnl: number; gas: number; fees: number; failed: number };
   156	    const bySymbol = this.db
   157	      .prepare(
   158	        `SELECT symbol, SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades, SUM(pnl_usd) pnl, SUM(gas_usd) gas,
   159	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   160	         FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`,
   161	      )
   162	      .all(...args) as { symbol: string; trades: number; pnl: number; gas: number; failed: number }[];
   163	    return { total, bySymbol };
   164	  }
   165	
   166	  insertTransfer(t: TransferRow): number {
   167	    const cols = Object.keys(t).filter((k) => k !== 'id');
   168	    const r = this.db
   169	      .prepare(`INSERT INTO transfers (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
   170	      .run(t);
   171	    return Number(r.lastInsertRowid);
   172	  }
   173	
   174	  updateTransfer(id: number, fields: Partial<TransferRow>): void {
   175	    const f = { ...fields, updated: Date.now() };
   176	    const cols = Object.keys(f).filter((k) => k !== 'id');
   177	    this.db.prepare(`UPDATE transfers SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...f, id });
   178	  }
   179	
   180	  /** Transfers the bot still works on automatically ('stuck' waits for a human: /sell or /clear). */
   181	  openTransfers(): TransferRow[] {
   182	    return this.db.prepare(`SELECT * FROM transfers WHERE status IN ('buying','withdrawing','selling') ORDER BY id`).all() as TransferRow[];
   183	  }
   184	
   185	  /** Transfers that hold back new trades (open, and not given up on). */
   186	  blockingTransfers(): TransferRow[] {
   187	    return this.openTransfers().filter((t) => t.alerted_timeout < 2);
   188	  }
   189	
   190	  stuckTransfers(): TransferRow[] {
   191	    return this.db.prepare(`SELECT * FROM transfers WHERE status = 'stuck' ORDER BY id`).all() as TransferRow[];
   192	  }
   193	
   194	  getTransfer(id: number): TransferRow | undefined {
   195	    return this.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as TransferRow | undefined;
   196	  }
   197	
   198	  getState(key: string): string | undefined {
   199	    return (this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined)?.value;
   200	  }
   201	
   202	  setState(key: string, value: string): void {
   203	    this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
   204	  }
   205	
   206	  close(): void {
   207	    this.db.close();
   208	  }
   209	}
```

## `src/engine.ts`

```ts
     1	// The trading loop: find the best opportunity each block, confirm it, trade both legs, clean up, account.
     2	import type { Config } from './config.js';
     3	import type { Aggregator, Quote, QuoteRequest } from './dex/aggregator.js';
     4	import type { GasInfo, TxResult } from './dex/chain.js';
     5	import type { Book, Order, Side } from './mexc/rest.js';
     6	import type { Db, TradeStatus } from './db.js';
     7	import type { Risk, RiskEvent } from './risk.js';
     8	import type { Token } from './watchlist.js';
     9	import { type Balances, inventoryWarnings, portfolioUsd } from './inventory.js';
    10	import {
    11	  type Opportunity,
    12	  evaluateCexBuy,
    13	  evaluateDexBuy,
    14	  gasUsd,
    15	  planCexBuy,
    16	  planCexBuyQty,
    17	  threshold,
    18	  unwindPlan,
    19	} from './pricing.js';
    20	import { log, errMsg } from './log.js';
    21	import { AmbiguousRequestError } from './mexc/rest.js';
    22	import { aggressiveOffset, orderProblem } from './mexc/rules.js';
    23	import crypto from 'node:crypto';
    24	
    25	/** A close/unwind that only partly filled: `remaining` is what is still open. */
    26	export class PartialCloseError extends Error {
    27	  constructor(msg: string, readonly remaining: number) {
    28	    super(msg);
    29	  }
    30	}
    31	
    32	/** Unique id we give MEXC orders, so an order can be found even if the request timed out. */
    33	export const clientId = (tag: string) => `arb${tag}${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 32);
    34	
    35	const FINAL_ORDER = new Set(['FILLED', 'CANCELED', 'PARTIALLY_CANCELED']);
    36	
    37	/** A cancel could not be confirmed: the order may still be live on MEXC. Never place a second close for it. */
    38	export class OrderStillOpenError extends Error {
    39	  constructor(readonly orderId: string, status: string) {
    40	    super(`MEXC order ${orderId} still ${status} after cancel attempts: it may still fill`);
    41	  }
    42	}
    43	
    44	/**
    45	 * Cancel an order and keep checking until MEXC reports a final status (FILLED / CANCELED / PARTIALLY_CANCELED).
    46	 * Throws OrderStillOpenError if that cannot be confirmed within ~10s.
    47	 */
    48	export async function cancelAndConfirm(
    49	  mexc: Pick<CexApi, 'getOrder' | 'cancelOrder'>,
    50	  symbol: string,
    51	  orderId: string,
    52	  sleep: (ms: number) => Promise<void>,
    53	): Promise<Order> {
    54	  let last = '?';
    55	  for (let i = 0; i < 6; i++) {
    56	    const o = await mexc.getOrder(symbol, orderId).catch(() => null);
    57	    if (o) {
    58	      if (FINAL_ORDER.has(o.status)) return o;
    59	      last = o.status;
    60	    }
    61	    await mexc.cancelOrder(symbol, orderId).catch((e) => log.warn(`cancel ${orderId}: ${errMsg(e)}`));
    62	    await sleep(500 * (i + 1));
    63	  }
    64	  const o = await mexc.getOrder(symbol, orderId).catch(() => null);
    65	  if (o && FINAL_ORDER.has(o.status)) return o;
    66	  throw new OrderStillOpenError(orderId, o?.status ?? last);
    67	}
    68	
    69	/**
    70	 * Place an order; if the request is ambiguous (timeout / 5xx) look it up by client id
    71	 * instead of assuming it was not placed. Throws UNKNOWN_ORDER_STATE if that is impossible.
    72	 */
    73	export async function placeSafely(
    74	  mexc: Pick<CexApi, 'getOrderByClientId'>,
    75	  symbol: string,
    76	  cid: string,
    77	  place: () => Promise<{ orderId: string }>,
    78	  sleep: (ms: number) => Promise<void>,
    79	): Promise<{ orderId: string }> {
    80	  try {
    81	    return await place();
    82	  } catch (e) {
    83	    if (!(e instanceof AmbiguousRequestError)) throw e; // clearly rejected: nothing was placed
    84	    // MEXC may take a few seconds to index a just-placed order: look for ~20s with backoff.
    85	    let notFound = 0;
    86	    for (const wait of [1000, 2000, 3000, 4000, 5000, 5000]) {
    87	      await sleep(wait);
    88	      let o: Order | null;
    89	      try {
    90	        o = await mexc.getOrderByClientId(symbol, cid);
    91	      } catch {
    92	        continue; // lookup itself failed: try again
    93	      }
    94	      if (o) return { orderId: o.orderId }; // it WAS placed
    95	      if (++notFound >= 4) throw e; // MEXC says four times (over ~10s+) that no such order exists
    96	    }
    97	    throw new Error(`UNKNOWN_ORDER_STATE client id ${cid}: ${errMsg(e)}`);
    98	  }
    99	}
   100	import { decimalsOfStep, dhakaDay, sleep as realSleep, toFloat, toUnits, usd } from './util.js';
   101	
   102	export const USDC_DECIMALS = 6;
   103	export { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
   104	import { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
   105	const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
   106	
   107	// Narrow interfaces so tests can plug in fakes.
   108	export interface CexApi {
   109	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
   110	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
   111	  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
   112	  getOrder(symbol: string, orderId: string): Promise<Order>;
   113	  cancelOrder(symbol: string, orderId: string): Promise<Order>;
   114	}
   115	export interface ChainApi {
   116	  readonly address: string;
   117	  gas(): Promise<GasInfo>;
   118	  approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint>;
   119	  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
   120	  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
   121	  send(
   122	    tx: { to: string; data: string; value?: bigint },
   123	    gasLimit: bigint,
   124	    gas: GasInfo,
   125	    timeoutSec: number,
   126	    onSigned?: (hash: string, nonce: number) => void,
   127	  ): Promise<TxResult>;
   128	  /** Unresolved earlier tx (outcome unknown): no new trades until it is 'clear'. */
   129	  checkUnresolved?(): Promise<{ state: 'clear' | 'pending'; dropped?: boolean }>;
   130	}
   131	export interface Notifier {
   132	  send(text: string): Promise<void>;
   133	}
   134	
   135	export interface EngineDeps {
   136	  cfg: Config;
   137	  mexc: CexApi;
   138	  chain: ChainApi;
   139	  agg: Aggregator;
   140	  db: Db;
   141	  risk: Risk;
   142	  tg: Notifier;
   143	  book: (symbol: string) => Promise<Book>;
   144	  /** Authoritative book (REST) used for the final check right before trading; defaults to `book`. */
   145	  freshBook?: (symbol: string) => Promise<Book>;
   146	  /** total=true: free + locked MEXC balances (for exact PnL); default free (for sizing). */
   147	  balances: (total?: boolean) => Promise<Balances>;
   148	  tokens: Token[];
   149	  sleep?: (ms: number) => Promise<void>;
   150	}
   151	
   152	export interface Candidate {
   153	  token: Token;
   154	  opp: Opportunity;
   155	  req: QuoteRequest;
   156	  spender: string;
   157	  approvalGas: bigint;
   158	  tokenUsd: number;
   159	}
   160	
   161	const mid = (b: Book) => (b.bids[0][0] + b.asks[0][0]) / 2;
   162	
   163	export class Engine {
   164	  private lastNote = new Map<string, string>();
   165	  private lastAlert = new Map<string, number>();
   166	  private sleep: (ms: number) => Promise<void>;
   167	  lastGasGwei = 0;
   168	
   169	  constructor(private d: EngineDeps) {
   170	    this.sleep = d.sleep ?? realSleep;
   171	  }
   172	
   173	  private get cfg() {
   174	    return this.d.cfg;
   175	  }
   176	  private get live() {
   177	    return this.cfg.mode === 'live';
   178	  }
   179	  private get taker() {
   180	    return this.live ? this.d.chain.address : PAPER_TAKER;
   181	  }
   182	  private costs() {
   183	    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
   184	  }
   185	  private need(sizeUsd: number) {
   186	    return threshold(sizeUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
   187	  }
   188	
   189	  /** Log a status line only when it changes (avoids spamming every block). */
   190	  private note(key: string, msg: string) {
   191	    if (this.lastNote.get(key) !== msg) {
   192	      this.lastNote.set(key, msg);
   193	      log.info(msg);
   194	    }
   195	  }
   196	
   197	  async alertThrottled(key: string, text: string, everyMs = 6 * 3600_000) {
   198	    const last = this.lastAlert.get(key) ?? 0;
   199	    if (Date.now() - last < everyMs) return;
   200	    this.lastAlert.set(key, Date.now());
   201	    await this.d.tg.send(text);
   202	  }
   203	
   204	  /** One scan; executes at most one trade. */
   205	  async tick(): Promise<void> {
   206	    const block = this.d.risk.blockReason();
   207	    if (block) return this.note('block', `trading blocked: ${block}`);
   208	    this.note('block', 'trading enabled');
   209	
   210	    if (this.d.chain.checkUnresolved) {
   211	      const u = await this.d.chain.checkUnresolved();
   212	      if (u.dropped) await this.d.tg.send('ℹ️ An unresolved DEX tx was dropped by every RPC (never mined); its nonce is free again.');
   213	      if (u.state === 'pending') {
   214	        await this.alertThrottled('unresolved', '⏳ An earlier DEX tx is still unresolved: no new trades until it is mined or dropped. /status for details.', 3600_000);
   215	        return this.note('unresolved', 'an earlier DEX tx is still unresolved: no new trades until it is mined or dropped');
   216	      }
   217	    }
   218	    this.note('unresolved', 'no unresolved tx');
   219	
   220	    const gas = await this.d.chain.gas();
   221	    this.lastGasGwei = Number(gas.effective) / 1e9;
   222	    if (this.lastGasGwei > this.cfg.maxGasGwei) {
   223	      return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > MAX_GAS_GWEI ${this.cfg.maxGasGwei}, waiting`);
   224	    }
   225	    this.note('gas', 'gas ok');
   226	
   227	    const ethUsd = mid(await this.d.book('ETHUSDT'));
   228	    const bal = await this.d.balances();
   229	    const books = new Map<string, Book>();
   230	    const prices: Record<string, number> = {};
   231	    for (const t of this.d.tokens) {
   232	      try {
   233	        const b = await this.d.book(t.symbol);
   234	        if (b.bids.length && b.asks.length) {
   235	          books.set(t.symbol, b);
   236	          prices[t.base] = mid(b);
   237	        }
   238	      } catch (e) {
   239	        log.warn(`${t.symbol} book: ${errMsg(e)}`);
   240	      }
   241	    }
   242	
   243	    if (this.live) {
   244	      for (const w of inventoryWarnings(bal, this.d.tokens, prices, this.cfg.minTradeUsd, this.cfg.minEthForGas)) {
   245	        await this.alertThrottled(`inv-${w.key}`, `📦 Inventory: ${w.text}`);
   246	      }
   247	    }
   248	
   249	    let best: Candidate | null = null;
   250	    for (const t of this.d.tokens) {
   251	      const b = books.get(t.symbol);
   252	      if (!b) continue;
   253	      if (!t.depositOk || !t.withdrawOk) {
   254	        this.note(`susp-${t.base}`, `${t.base}: MEXC deposit/withdraw suspended, skipping`);
   255	        continue;
   256	      }
   257	      this.note(`susp-${t.base}`, `${t.base}: active`);
   258	      try {
   259	        for (const c of await this.candidates(t, b, bal, gas, ethUsd)) {
   260	          log.info(`${t.base} ${c.opp.direction} size ${usd(c.opp.sizeUsd)} net ${usd(c.opp.net)} (need ${usd(this.need(c.opp.sizeUsd))})`);
   261	          if (c.opp.net > this.need(c.opp.sizeUsd) && (!best || c.opp.net > best.opp.net)) best = c;
   262	        }
   263	      } catch (e) {
   264	        log.warn(`${t.base} quote: ${errMsg(e)}`);
   265	      }
   266	    }
   267	    if (best) await this.execute(best, gas, ethUsd);
   268	  }
   269	
   270	  /** Indicative opportunities in both directions for one token. */
   271	  async candidates(t: Token, b: Book, bal: Balances, gas: GasInfo, ethUsd: number): Promise<Candidate[]> {
   272	    const out: Candidate[] = [];
   273	    const bestBid = b.bids[0][0];
   274	    const tokenUsd = mid(b);
   275	    const cexTok = bal.mexc[t.base] ?? 0;
   276	    const walTok = bal.walletToken[t.base] ?? 0;
   277	    const slippageBps = this.cfg.dexSlippageBps;
   278	
   279	    // DEX_BUY: USDC -> token on DEX, token -> USDT on MEXC.
   280	    const sizeA = Math.floor(Math.min(this.cfg.maxTradeUsd, bal.walletUsdc * 0.99, cexTok * bestBid * 0.99) * 100) / 100;
   281	    if (sizeA >= this.cfg.minTradeUsd) {
   282	      const req = { sellToken: this.cfg.usdc, buyToken: t.address, sellAmount: toUnits(sizeA, USDC_DECIMALS), taker: this.taker, slippageBps };
   283	      const q = await this.d.agg.price(req);
   284	      const spender = this.spenderOf(q);
   285	      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   286	      const opp = evaluateDexBuy({
   287	        sizeUsd: sizeA,
   288	        tokensOut: toFloat(q.buyAmount, t.decimals),
   289	        tokensMin: toFloat(q.minBuyAmount, t.decimals),
   290	        bids: b.bids,
   291	        qtyStep: t.qtyStep,
   292	        gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
   293	        costs: this.costs(),
   294	      });
   295	      const problem = opp && orderProblem(t.rules, 'SELL', opp.cexQty, opp.cexLimitPrice);
   296	      if (problem) this.note(`rule-${t.base}-A`, `${t.base} DEX_BUY skipped: MEXC would reject the sell (${problem})`);
   297	      else if (opp && opp.cexQty <= cexTok) out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
   298	    }
   299	
   300	    // CEX_BUY: USDT -> token on MEXC, token -> USDC on DEX.
   301	    const sizeB = Math.min(this.cfg.maxTradeUsd, (bal.mexc.USDT ?? 0) * 0.99, walTok * bestBid * 0.99);
   302	    if (sizeB >= this.cfg.minTradeUsd) {
   303	      const plan = planCexBuy({ sizeUsd: sizeB, asks: b.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
   304	      if (plan && plan.tokensToSell <= walTok) {
   305	        const req = { sellToken: t.address, buyToken: this.cfg.usdc, sellAmount: toUnits(plan.tokensToSell, t.decimals), taker: this.taker, slippageBps };
   306	        const q = await this.d.agg.price(req);
   307	        const spender = this.spenderOf(q);
   308	        const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   309	        const opp = evaluateCexBuy({
   310	          plan,
   311	          usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
   312	          usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
   313	          gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
   314	          costs: this.costs(),
   315	        });
   316	        const problem = orderProblem(t.rules, 'BUY', opp.cexQty, opp.cexLimitPrice);
   317	        if (problem) this.note(`rule-${t.base}-B`, `${t.base} CEX_BUY skipped: MEXC would reject the buy (${problem})`);
   318	        else out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
   319	      }
   320	    }
   321	    return out;
   322	  }
   323	
   324	  private spenderOf(q: Quote): string {
   325	    if (q.spender) return q.spender;
   326	    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
   327	    throw new Error('aggregator did not return a spender');
   328	  }
   329	
   330	  /** Re-check with a firm quote + simulation, then trade both legs at once. */
   331	  async execute(c: Candidate, gas: GasInfo, ethUsd: number): Promise<void> {
   332	    const { token: t } = c;
   333	    if (!this.live) return this.recordPaper(c);
   334	
   335	    let approvalCostWei = 0n;
   336	    const skip = async (why: string) => {
   337	      log.info(`${t.base} skip: ${why}`);
   338	      if (approvalCostWei > 0n) {
   339	        // The approval gas was really spent; book it so PnL and the loss limit stay honest.
   340	        const g = (Number(approvalCostWei) / 1e18) * ethUsd;
   341	        this.record(c, 'approval', { pnl: -g, gas: g, note: `approval, then skipped: ${why}` });
   342	      }
   343	    };
   344	
   345	    // 0) Worst case must fit in what is left of today's loss budget.
   346	    const worst = (c.opp.sizeUsd * this.cfg.worstCaseLossPct) / 100 + c.opp.gasUsd;
   347	    const budget = this.d.risk.remainingLossBudget();
   348	    if (worst > budget) return skip(`worst case ${usd(worst)} > remaining daily loss budget ${usd(budget)}`);
   349	
   350	    // Snapshot BEFORE the approval, so approval gas is part of the measured PnL.
   351	    const before = await this.d.balances(true);
   352	
   353	    // 1) Exact approval (never unlimited).
   354	    if (c.approvalGas > 0n) {
   355	      const r = await this.d.chain.approveExact(c.req.sellToken, c.spender, c.req.sellAmount, gas);
   356	      approvalCostWei = r.gasCostWei;
   357	      if (!r.ok) {
   358	        await skip(`approval failed (${r.reason})`);
   359	        await this.d.tg.send(`⚠️ Approval failed for ${t.base}: ${r.reason} ${r.hash ?? ''}`);
   360	        return;
   361	      }
   362	    }
   363	
   364	    // 2) Firm quote + simulation (eth_call). Abort on any doubt.
   365	    let firm: Quote;
   366	    let gasEst: bigint;
   367	    try {
   368	      firm = await this.d.agg.quote(c.req);
   369	      if (!firm.tx) return skip('firm quote has no transaction');
   370	      gasEst = await this.d.chain.simulate(firm.tx);
   371	    } catch (e) {
   372	      return skip(`simulation/quote failed: ${errMsg(e)}`);
   373	    }
   374	    const tx = firm.tx;
   375	
   376	    // 3) Re-evaluate with a fresh REST book, firm amounts and simulated gas.
   377	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   378	    const g = gasUsd(gasEst, gas.effective, ethUsd);
   379	    let opp: Opportunity | null;
   380	    if (c.opp.direction === 'DEX_BUY') {
   381	      opp = evaluateDexBuy({
   382	        sizeUsd: c.opp.sizeUsd,
   383	        tokensOut: toFloat(firm.buyAmount, t.decimals),
   384	        tokensMin: toFloat(firm.minBuyAmount, t.decimals),
   385	        bids: b.bids,
   386	        qtyStep: t.qtyStep,
   387	        gasUsd: g,
   388	        costs: this.costs(),
   389	      });
   390	    } else {
   391	      // Same quantity as quoted on the DEX, priced against the fresh MEXC book.
   392	      const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.cfg.mexcTakerFee);
   393	      opp = plan
   394	        ? evaluateCexBuy({
   395	            plan,
   396	            usdcOut: toFloat(firm.buyAmount, USDC_DECIMALS),
   397	            usdcMin: toFloat(firm.minBuyAmount, USDC_DECIMALS),
   398	            gasUsd: g,
   399	            costs: this.costs(),
   400	          })
   401	        : null;
   402	    }
   403	    const need = this.need(c.opp.sizeUsd);
   404	    if (!opp || opp.net <= need) return skip(`profit fell to ${usd(opp?.net ?? 0)} after firm quote (need ${usd(need)})`);
   405	    // MEXC symbol rules on the FINAL numbers, before anything is sent: a rejected MEXC leg after a sent DEX tx = one-sided.
   406	    const problem = orderProblem(t.rules, opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY', opp.cexQty, opp.cexLimitPrice);
   407	    if (problem) return skip(`MEXC would reject the order: ${problem}`);
   408	
   409	    // 4) Persist the trade as 'executing' BEFORE anything is sent: if the bot dies now, startup sees it.
   410	    const cid = clientId('t');
   411	    const tradeId = this.record({ ...c, opp }, 'executing', { pnl: 0, gas: 0, orderId: cid, note: `client order id ${cid}` });
   412	
   413	    // Both legs are sent together. They do NOT complete together: the MEXC order fills in ~1.5s,
   414	    // the DEX tx needs 12-60s to be mined. If the DEX side fails in between, step 5 unwinds on MEXC.
   415	    log.info(`${t.base} EXECUTE ${opp.direction} size ${usd(opp.sizeUsd)} expected ${usd(opp.net)}`);
   416	    const [cexR, dexR] = await Promise.allSettled([
   417	      this.cexLeg(t, opp, cid),
   418	      this.d.chain.send(tx, (gasEst * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash, nonce) =>
   419	        this.d.db.updateTrade(tradeId, { dex_tx: hash, note: `client order id ${cid}; nonce ${nonce}` }),
   420	      ),
   421	    ]);
   422	
   423	    const dex: TxResult = dexR.status === 'fulfilled' ? dexR.value : { ok: false, gasCostWei: 0n, reason: errMsg(dexR.reason) };
   424	    let cexFilled = 0;
   425	    let orderId: string | null = null;
   426	    let cexUnknown = false;
   427	    if (cexR.status === 'fulfilled') {
   428	      cexFilled = cexR.value.filled;
   429	      orderId = cexR.value.orderId;
   430	    } else if (String((cexR.reason as Error)?.message ?? '').startsWith('UNKNOWN_ORDER_STATE')) {
   431	      cexUnknown = true;
   432	      this.d.risk.pause('MEXC order state unknown', true);
   433	      await this.d.tg.send(`🚨 ${t.base}: MEXC order state unknown after placing. Trading PAUSED. Check MEXC manually.\n${errMsg(cexR.reason)}`);
   434	    } else {
   435	      log.warn(`${t.base} MEXC leg failed: ${errMsg(cexR.reason)}`);
   436	    }
   437	
   438	    // 5) One-sided? Close the open position at market right away.
   439	    let status: TradeStatus = 'ok';
   440	    const notes: string[] = [];
   441	    if (!dex.ok) notes.push(`DEX: ${dex.reason}`);
   442	    if (dex.unknown) {
   443	      // We cannot tell if the swap executed. Unwinding could DOUBLE the position. Stop and ask a human.
   444	      this.d.risk.pause(`DEX tx unknown ${dex.hash}`, true);
   445	      await this.d.tg.send(
   446	        `🚨 ${t.base}: DEX tx ${dex.hash} outcome UNKNOWN (not mined, cancel not confirmed). MEXC filled ${cexFilled}/${opp.cexQty}.\n` +
   447	          `NOT unwinding automatically. Trading PAUSED. Check the wallet on etherscan, fix by hand, then /start confirm.`,
   448	      );
   449	    }
   450	    const unwind = cexUnknown || dex.unknown ? null : unwindPlan(opp.direction, dex.ok, opp.cexQty, cexFilled, this.cfg.mexcTakerFee, t.qtyStep);
   451	    if (cexUnknown || dex.unknown) {
   452	      status = 'one_sided';
   453	    } else if (unwind) {
   454	      status = 'one_sided';
   455	      const qty = unwind.qty.toFixed(decimalsOfStep(t.qtyStep));
   456	      try {
   457	        const r = await this.closeAtMarket(t, unwind.side, qty);
   458	        if (r.dust) {
   459	          notes.push(`unwind ${unwind.side} ${qty} not sent: ${r.dust}`);
   460	          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base}: leftover ${unwind.side} ${qty} is below MEXC minimums (${r.dust}). Left as dust; fix inventory by hand.`);
   461	        } else {
   462	          notes.push(`unwind ${unwind.side} ${qty} (${r.orderId}, filled ${r.filled})`);
   463	          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base} ${opp.direction}\n${unwind.reason}\nClosed: MEXC ${unwind.side} ${r.filled} ${t.base}`);
   464	        }
   465	      } catch (e) {
   466	        const remaining = e instanceof PartialCloseError ? e.remaining : Number(qty);
   467	        if (e instanceof OrderStillOpenError) notes.push(`close order ${e.orderId} may still be live on MEXC: cancel it by hand`);
   468	        this.d.risk.pause(`unwind failed for ${t.base}`, true);
   469	        notes.push(`UNWIND FAILED: ${errMsg(e)}`);
   470	        await this.d.tg.send(
   471	          `🚨 ONE-SIDED FILL ${t.base} and the market close FAILED: ${errMsg(e)}\n` +
   472	            `Still open: MEXC ${unwind.side} ${remaining} ${t.base} needed.\nTrading PAUSED. Close it manually, then /start confirm.`,
   473	        );
   474	      }
   475	    } else if (!dex.ok) {
   476	      status = 'dex_failed'; // nothing filled on either side
   477	    }
   478	
   479	    // 6) Exact PnL = change in total value of everything the trade touched, at pre-trade prices.
   480	    //    Orders are closed (filled/cancelled) by now; free + locked balances avoid counting held funds as lost.
   481	    await this.sleep(2500);
   482	    const after = await this.d.balances(true);
   483	    const pnl = portfolioUsd(after, t, c.tokenUsd, ethUsd) - portfolioUsd(before, t, c.tokenUsd, ethUsd);
   484	    const gasPaid = (Number(dex.gasCostWei + approvalCostWei) / 1e18) * ethUsd;
   485	    this.d.db.updateTrade(tradeId, {
   486	      status,
   487	      pnl_usd: pnl,
   488	      gas_usd: gasPaid,
   489	      dex_tx: dex.hash ?? null,
   490	      cex_order_id: orderId ?? cid,
   491	      note: [`client order id ${cid}`, ...notes].join('; '),
   492	    });
   493	
   494	    const dexIsBuy = opp.direction === 'DEX_BUY';
   495	    await this.d.tg.send(
   496	      [
   497	        `${status === 'ok' ? '✅' : '⚠️'} LIVE ${t.base} ${opp.direction} [${status}]`,
   498	        `Buy  ${dexIsBuy ? 'DEX ' : 'MEXC'} @ ${opp.buyPrice.toPrecision(6)}`,
   499	        `Sell ${dexIsBuy ? 'MEXC' : 'DEX '} @ ${opp.sellPrice.toPrecision(6)}`,
   500	        `Qty ${opp.cexQty} ${t.base} | size ${usd(opp.sizeUsd)}`,
   501	        `MEXC fee ${usd(opp.cexFeeUsd)} | Gas ${usd(gasPaid)}`,
   502	        `Expected ${usd(opp.net)} | Net PnL ${usd(pnl)}`,
   503	        dex.hash ? `https://etherscan.io/tx/${dex.hash}` : '',
   504	        notes.length ? `Notes: ${notes.join('; ')}` : '',
   505	      ]
   506	        .filter(Boolean)
   507	        .join('\n'),
   508	    );
   509	    await this.handleRisk(this.d.risk.afterTrade(status));
   510	  }
   511	
   512	  /**
   513	   * Close a position on MEXC now with an aggressive LIMIT 2% through the book, for BOTH sides.
   514	   * (No MEXC spot symbol offers IMMEDIATE_OR_CANCEL, and some have no MARKET; LIMIT works everywhere.)
   515	   * Reads the order back and never assumes it filled. Below MEXC minimums -> returns `dust`, sends nothing.
   516	   */
   517	  async closeAtMarket(t: Token, side: Side, qty: string): Promise<{ orderId: string; filled: number; dust?: string }> {
   518	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   519	    const f = 10 ** t.priceDecimals;
   520	    const off = aggressiveOffset(t.rules); // 2%, or less if the symbol's price band is tight
   521	    const pxNum = side === 'BUY' ? Math.ceil(b.asks[0][0] * (1 + off) * f) / f : Math.floor(b.bids[0][0] * (1 - off) * f) / f;
   522	    const dust = orderProblem(t.rules, side, Number(qty), pxNum);
   523	    if (dust) return { orderId: '', filled: 0, dust };
   524	    const px = pxNum.toFixed(t.priceDecimals);
   525	    const cid = clientId('c');
   526	    const { orderId } = await placeSafely(this.d.mexc, t.symbol, cid, () => this.d.mexc.limitOrder(t.symbol, side, qty, px, cid), this.sleep);
   527	    await this.sleep(1500);
   528	    let o = await this.d.mexc.getOrder(t.symbol, orderId);
   529	    if (o.status !== 'FILLED') o = await cancelAndConfirm(this.d.mexc, t.symbol, orderId, this.sleep);
   530	    const filled = Number(o.executedQty);
   531	    if (filled < Number(qty) * 0.999) {
   532	      const remaining = Number((Number(qty) - filled).toFixed(decimalsOfStep(t.qtyStep)));
   533	      throw new PartialCloseError(`close ${side} only filled ${filled}/${qty}, ${remaining} remaining`, remaining);
   534	    }
   535	    return { orderId, filled };
   536	  }
   537	
   538	  /** MEXC marketable limit order; cancels any unfilled rest. Returns filled quantity. */
   539	  async cexLeg(t: Token, opp: Opportunity, cid = clientId('t')): Promise<{ orderId: string; filled: number }> {
   540	    const side: Side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
   541	    const qty = opp.cexQty.toFixed(decimalsOfStep(t.qtyStep));
   542	    const f = 10 ** t.priceDecimals;
   543	    const px = side === 'SELL' ? Math.floor(opp.cexLimitPrice * f) / f : Math.ceil(opp.cexLimitPrice * f) / f;
   544	    const { orderId } = await placeSafely(
   545	      this.d.mexc,
   546	      t.symbol,
   547	      cid,
   548	      () => this.d.mexc.limitOrder(t.symbol, side, qty, px.toFixed(t.priceDecimals), cid),
   549	      this.sleep,
   550	    );
   551	    log.info(`MEXC ${side} ${qty} ${t.symbol} @ ${px} id=${orderId}`);
   552	    await this.sleep(1500);
   553	
   554	    const read = async (): Promise<Order> => {
   555	      for (let i = 0; i < 3; i++) {
   556	        try {
   557	          return await this.d.mexc.getOrder(t.symbol, orderId);
   558	        } catch (e) {
   559	          log.warn(`getOrder retry: ${errMsg(e)}`);
   560	          await this.sleep(1000);
   561	        }
   562	      }
   563	      throw new Error(`UNKNOWN_ORDER_STATE ${orderId}`);
   564	    };
   565	    let o = await read();
   566	    if (o.status !== 'FILLED') {
   567	      try {
   568	        o = await cancelAndConfirm(this.d.mexc, t.symbol, orderId, this.sleep);
   569	      } catch (e) {
   570	        // The order may still fill later: its state is unknown, so no unwind may be based on it.
   571	        if (e instanceof OrderStillOpenError) throw new Error(`UNKNOWN_ORDER_STATE ${e.message}`);
   572	        throw e;
   573	      }
   574	    }
   575	    return { orderId, filled: Number(o.executedQty) };
   576	  }
   577	
   578	  private async recordPaper(c: Candidate) {
   579	    const { token: t, opp } = c;
   580	    this.record(c, 'paper', { pnl: opp.net, gas: opp.gasUsd });
   581	    await this.d.tg.send(
   582	      `📝 PAPER ${t.base} ${opp.direction}\nBuy @ ${opp.buyPrice.toPrecision(6)} | Sell @ ${opp.sellPrice.toPrecision(6)}\n` +
   583	        `Qty ${opp.cexQty} | size ${usd(opp.sizeUsd)} | fee ${usd(opp.cexFeeUsd)} | gas ${usd(opp.gasUsd)}\nNet ${usd(opp.net)}`,
   584	    );
   585	    await this.handleRisk(this.d.risk.afterTrade('paper'));
   586	  }
   587	
   588	  private record(
   589	    c: Candidate,
   590	    status: TradeStatus,
   591	    r: { pnl: number; gas: number; dexTx?: string; orderId?: string | null; note?: string | null },
   592	  ): number {
   593	    const now = Date.now();
   594	    return this.d.db.insertTrade({
   595	      ts: now,
   596	      day: dhakaDay(now),
   597	      mode: this.cfg.mode,
   598	      symbol: c.token.base,
   599	      direction: c.opp.direction,
   600	      size_usd: c.opp.sizeUsd,
   601	      qty: c.opp.cexQty,
   602	      buy_price: c.opp.buyPrice,
   603	      sell_price: c.opp.sellPrice,
   604	      expected_net: c.opp.net,
   605	      cex_fee_usd: status === 'approval' ? 0 : c.opp.cexFeeUsd,
   606	      gas_usd: r.gas,
   607	      pnl_usd: r.pnl,
   608	      status,
   609	      dex_tx: r.dexTx ?? null,
   610	      cex_order_id: r.orderId ?? null,
   611	      note: r.note ?? null,
   612	    });
   613	  }
   614	
   615	  private async handleRisk(events: RiskEvent[]) {
   616	    for (const e of events) {
   617	      if (e.kind === 'loss_limit') await this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). Trading STOPPED. Send /start to resume.`);
   618	      if (e.kind === 'fail_streak') await this.d.tg.send(`🛑 ${e.count} failed trades in a row. Trading PAUSED. Check logs, then /start.`);
   619	      if (e.kind === 'trade_limit') await this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}). Resumes tomorrow (Dhaka time).`);
   620	    }
   621	  }
   622	}
```

## `src/inventory.ts`

```ts
     1	// Balances on both sides and rebalancing alerts. The bot never moves funds itself.
     2	import type { Chain } from './dex/chain.js';
     3	import type { MexcRest } from './mexc/rest.js';
     4	import type { Token } from './watchlist.js';
     5	import { toFloat } from './util.js';
     6	
     7	export interface Balances {
     8	  walletEth: number;
     9	  walletUsdc: number;
    10	  walletToken: Record<string, number>; // by token base symbol
    11	  mexc: Record<string, number>; // free balance by asset
    12	}
    13	
    14	export async function snapshot(chain: Chain, mexc: MexcRest, usdc: string, tokens: Token[], total = false): Promise<Balances> {
    15	  const [eth, usdcBal, mexcBal, ...toks] = await Promise.all([
    16	    chain.ethBalance(),
    17	    chain.tokenBalance(usdc),
    18	    mexc.balances(total),
    19	    ...tokens.map((t) => chain.tokenBalance(t.address)),
    20	  ]);
    21	  return {
    22	    walletEth: toFloat(eth, 18),
    23	    walletUsdc: toFloat(usdcBal, 6),
    24	    walletToken: Object.fromEntries(tokens.map((t, i) => [t.base, toFloat(toks[i], t.decimals)])),
    25	    mexc: mexcBal,
    26	  };
    27	}
    28	
    29	/** Paper mode: unlimited fake balances, so only MAX_TRADE_USD limits the size. */
    30	export function paperBalances(tokens: Token[]): Balances {
    31	  const big = 1e12;
    32	  return {
    33	    walletEth: 1,
    34	    walletUsdc: big,
    35	    walletToken: Object.fromEntries(tokens.map((t) => [t.base, big])),
    36	    mexc: { USDT: big, ...Object.fromEntries(tokens.map((t) => [t.base, big])) },
    37	  };
    38	}
    39	
    40	/** USD value of the assets a trade in `token` can touch (used for exact PnL). */
    41	export function portfolioUsd(b: Balances, token: Token, tokenUsd: number, ethUsd: number): number {
    42	  return (
    43	    b.walletUsdc +
    44	    (b.mexc.USDT ?? 0) +
    45	    ((b.walletToken[token.base] ?? 0) + (b.mexc[token.base] ?? 0)) * tokenUsd +
    46	    b.walletEth * ethUsd
    47	  );
    48	}
    49	
    50	/** Human-readable warnings for low or one-sided inventory. */
    51	export function inventoryWarnings(
    52	  b: Balances,
    53	  tokens: Token[],
    54	  prices: Record<string, number>,
    55	  minTradeUsd: number,
    56	  minEth: number,
    57	): { key: string; text: string }[] {
    58	  const w: { key: string; text: string }[] = [];
    59	  if (b.walletEth < minEth) w.push({ key: 'eth', text: `Wallet ETH for gas is low: ${b.walletEth.toFixed(4)} ETH` });
    60	  if (b.walletUsdc < minTradeUsd) w.push({ key: 'usdc', text: `Wallet USDC low: $${b.walletUsdc.toFixed(2)} (DEX buys blocked)` });
    61	  if ((b.mexc.USDT ?? 0) < minTradeUsd) w.push({ key: 'usdt', text: `MEXC USDT low: $${(b.mexc.USDT ?? 0).toFixed(2)} (MEXC buys blocked)` });
    62	  for (const t of tokens) {
    63	    const p = prices[t.base];
    64	    if (!p) continue;
    65	    const wal = (b.walletToken[t.base] ?? 0) * p;
    66	    const cex = (b.mexc[t.base] ?? 0) * p;
    67	    if (wal < minTradeUsd) w.push({ key: `w-${t.base}`, text: `Wallet ${t.base} low: $${wal.toFixed(2)} (DEX sells blocked)` });
    68	    if (cex < minTradeUsd) w.push({ key: `m-${t.base}`, text: `MEXC ${t.base} low: $${cex.toFixed(2)} (MEXC sells blocked)` });
    69	    const total = wal + cex;
    70	    if (total > 0 && Math.min(wal, cex) / total < 0.2 && total >= 2 * minTradeUsd) {
    71	      w.push({
    72	        key: `r-${t.base}`,
    73	        text: `${t.base} needs rebalancing: wallet $${wal.toFixed(0)} / MEXC $${cex.toFixed(0)}`,
    74	      });
    75	    }
    76	  }
    77	  return w;
    78	}
```

## `src/log.ts`

```ts
     1	// Console logger that scrubs secrets (private key, API keys, bot token) from every line.
     2	
     3	let secrets: string[] = [];
     4	
     5	export function registerSecrets(values: string[]): void {
     6	  secrets = [...new Set(values)].sort((a, b) => b.length - a.length);
     7	}
     8	
     9	export function redact(text: string): string {
    10	  let out = text;
    11	  for (const s of secrets) out = out.split(s).join('***');
    12	  return out;
    13	}
    14	
    15	function fmt(args: unknown[]): string {
    16	  return redact(
    17	    args
    18	      .map((a) => (a instanceof Error ? `${a.message}` : typeof a === 'string' ? a : JSON.stringify(a, bigintSafe)))
    19	      .join(' '),
    20	  );
    21	}
    22	
    23	export function bigintSafe(_k: string, v: unknown): unknown {
    24	  return typeof v === 'bigint' ? v.toString() : v;
    25	}
    26	
    27	export function errMsg(e: unknown): string {
    28	  if (e && typeof e === 'object') {
    29	    const o = e as { shortMessage?: string; message?: string };
    30	    return redact(o.shortMessage || o.message || String(e));
    31	  }
    32	  return redact(String(e));
    33	}
    34	
    35	const ts = () => new Date().toISOString();
    36	export const log = {
    37	  info: (...a: unknown[]) => console.log(`${ts()} INFO  ${fmt(a)}`),
    38	  warn: (...a: unknown[]) => console.warn(`${ts()} WARN  ${fmt(a)}`),
    39	  error: (...a: unknown[]) => console.error(`${ts()} ERROR ${fmt(a)}`),
    40	};
```

## `src/main.ts`

```ts
     1	// Entry point. Wires everything together, runs one scan per Ethereum block.
     2	import fs from 'node:fs';
     3	import { loadConfig, secretsOf, validateConfig } from './config.js';
     4	import { log, errMsg, registerSecrets } from './log.js';
     5	import { Db } from './db.js';
     6	import { Risk } from './risk.js';
     7	import { Telegram } from './telegram.js';
     8	import { MexcRest, RateLimitError } from './mexc/rest.js';
     9	import { MexcBookStream } from './mexc/ws.js';
    10	import { Chain } from './dex/chain.js';
    11	import { OneInch, ZeroEx, type Aggregator } from './dex/aggregator.js';
    12	import { buildWatchlist, refreshStatus } from './watchlist.js';
    13	import { paperBalances, snapshot } from './inventory.js';
    14	import { Engine } from './engine.js';
    15	import { TransferEngine } from './transfer.js';
    16	import { formatReport } from './summary.js';
    17	import { recoverExecuting } from './recovery.js';
    18	import { dhakaDay, dhakaHourMinute, usd } from './util.js';
    19	
    20	const cfg = validateConfig(loadConfig());
    21	registerSecrets(secretsOf(cfg));
    22	
    23	/** Backoff after HTTP 429/418 from any API: skip scans for 1, 2, 4 ... up to 15 minutes. */
    24	const rateLimit = { until: 0, level: 0 };
    25	function onScanError(e: unknown): boolean {
    26	  if (e instanceof RateLimitError || /\b(429|418)\b/.test(errMsg(e))) {
    27	    const wait = Math.min(15 * 60_000, 60_000 * 2 ** rateLimit.level++);
    28	    rateLimit.until = Date.now() + wait;
    29	    log.warn(`rate limited, pausing scans for ${wait / 60_000} min`);
    30	    return true;
    31	  }
    32	  return false;
    33	}
    34	function rateLimited(): boolean {
    35	  if (Date.now() < rateLimit.until) return true;
    36	  return false;
    37	}
    38	function rateLimitOk() {
    39	  rateLimit.level = 0;
    40	}
    41	
    42	/** Set by shutdown: loops stop starting new ticks. */
    43	export const lifecycle = { stopping: false, busy: false };
    44	
    45	/**
    46	 * Crash handlers: exit (pm2 restarts) only on real crashes; a stray rejected promise is logged and alerted.
    47	 * On SIGINT/SIGTERM/crash: stop new ticks and wait for a running trade to finish (up to TX_TIMEOUT_SEC*2+30s).
    48	 */
    49	function installProcessHandlers(tg: Telegram, cleanup: () => void) {
    50	  let shuttingDown = false;
    51	  const shutdown = async (why: string, code: number) => {
    52	    if (shuttingDown) return;
    53	    shuttingDown = true;
    54	    lifecycle.stopping = true;
    55	    const deadline = Date.now() + (cfg.txTimeoutSec * 2 + 30) * 1000;
    56	    if (lifecycle.busy) log.info('shutdown: waiting for the running trade to finish');
    57	    while (lifecycle.busy && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    58	    await tg.send(`🔌 Bot stopped: ${why}${lifecycle.busy ? ' (a trade was still running: check /status after restart)' : ''}`);
    59	    cleanup();
    60	    tg.stop();
    61	    process.exit(code);
    62	  };
    63	  let lastRejectAlert = 0;
    64	  process.on('SIGINT', () => void shutdown('SIGINT', 0));
    65	  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
    66	  process.on('unhandledRejection', (e) => {
    67	    log.error(`unhandled rejection: ${errMsg(e)}`);
    68	    if (Date.now() - lastRejectAlert > 3600_000) {
    69	      lastRejectAlert = Date.now();
    70	      void tg.send(`❗ Unhandled error (bot keeps running): ${errMsg(e)}`);
    71	    }
    72	  });
    73	  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
    74	}
    75	
    76	/**
    77	 * /start handler shared by both strategies: critical pauses need "/start confirm", and even then
    78	 * the bot re-checks that nothing is still unresolved (pending DEX tx, executing trade) before resuming.
    79	 */
    80	function startHandler(risk: Risk, statusText: () => Promise<string>, stillUnresolved: () => Promise<string | null>) {
    81	  return async (args: string[]) => {
    82	    const confirm = args[0]?.toLowerCase() === 'confirm';
    83	    if (risk.paused && risk.critical && !confirm) {
    84	      return `⚠️ Critical pause: ${risk.pauseReason}\nCheck these positions and balances first:\n\n${await statusText()}\n\nThen send: /start confirm`;
    85	    }
    86	    if (risk.paused && risk.critical) {
    87	      const open = await stillUnresolved();
    88	      if (open) return `⛔ Not resuming: ${open}\nResolve it first (check etherscan / MEXC), then /start confirm again.`;
    89	    }
    90	    risk.resume(confirm);
    91	    const block = risk.blockReason();
    92	    return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
    93	  };
    94	}
    95	
    96	/** What still blocks a critical resume, or null. */
    97	function makeUnresolvedCheck(db: Db, chain: Chain) {
    98	  return async (): Promise<string | null> => {
    99	    const u = await chain.checkUnresolved();
   100	    if (u.state === 'pending') return `DEX tx ${chain.unresolved?.hashes.join(' / ')} (nonce ${chain.unresolved?.nonce}) is still pending`;
   101	    const ex = db.executingTrades();
   102	    if (ex.length) return `${ex.length} trade(s) still marked executing (#${ex.map((t) => t.id).join(', #')})`;
   103	    return null;
   104	  };
   105	}
   106	
   107	/** Refuse to trade live if .env is readable by other users. */
   108	function checkEnvPermissions(path: string) {
   109	  if (!fs.existsSync(path)) return log.warn(`${path} not found; make sure secrets come from a protected place`);
   110	  const mode = fs.statSync(path).mode & 0o777;
   111	  if (mode & 0o077) throw new Error(`${path} has permissions ${mode.toString(8)}; run: chmod 600 ${path}`);
   112	}
   113	
   114	async function main() {
   115	  if (cfg.mode === 'live') checkEnvPermissions(cfg.envPath);
   116	
   117	  const db = new Db(cfg.dbPath);
   118	  const risk = new Risk(db, cfg.mode, cfg);
   119	  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId, fetch, cfg.telegramAdminId, {
   120	    get: () => db.getState('telegram_offset'),
   121	    set: (v) => db.setState('telegram_offset', v),
   122	  });
   123	  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
   124	  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
   125	  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei, {
   126	    get: () => db.getState('unresolved_tx') || undefined,
   127	    set: (v) => db.setState('unresolved_tx', v ?? ''),
   128	  });
   129	  const agg: Aggregator = cfg.aggregator === '0x' ? new ZeroEx(cfg.zeroExApiKey) : new OneInch(cfg.oneInchApiKey);
   130	
   131	  // --- Pre-flight checks: fail at startup, not in the middle of the first trade ---
   132	  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
   133	  if (chainId !== 1n) throw new Error(`RPC_URL is chain ${chainId}, expected Ethereum mainnet (1)`);
   134	  if (!cfg.mexcApiKey || !cfg.mexcApiSecret) {
   135	    // Coin/network info (contract addresses, deposit/withdraw status) is a signed MEXC endpoint.
   136	    throw new Error('MEXC_API_KEY/SECRET are required even in paper mode (a read-only key is enough for paper)');
   137	  }
   138	  const skew = await mexc.syncTime();
   139	  if (Math.abs(skew) > 1000) log.warn(`VPS clock is ${skew} ms off MEXC time; corrected, but enable NTP (timedatectl set-ntp true)`);
   140	  // Aggregator key and route smoke test: quote 100 USDC -> WETH.
   141	  await agg.price({
   142	    sellToken: cfg.usdc,
   143	    buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
   144	    sellAmount: 100_000_000n,
   145	    taker: chain.wallet?.address ?? '0x000000000000000000000000000000000000dEaD',
   146	    slippageBps: cfg.dexSlippageBps,
   147	  });
   148	  if (cfg.mode === 'live') {
   149	    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
   150	    if (!cfg.telegramAdminId) throw new Error('Live mode needs TELEGRAM_ADMIN_ID (only this user may send /stop /start)');
   151	    const acc = await mexc.account();
   152	    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
   153	    const eth = Number(await chain.ethBalance()) / 1e18;
   154	    if (eth < cfg.minEthForGas) throw new Error(`Hot wallet has ${eth} ETH, need at least MIN_ETH_FOR_GAS=${cfg.minEthForGas}`);
   155	    const usdt = Number(acc.balances.find((b) => b.asset === 'USDT')?.free ?? 0);
   156	    log.info(`wallet ${chain.address}: ${eth.toFixed(4)} ETH | MEXC USDT ${usdt.toFixed(2)}`);
   157	    if (usdt < cfg.minTradeUsd) log.warn(`MEXC USDT ${usdt} < MIN_TRADE_USD: MEXC buys are blocked until you deposit`);
   158	    if (cfg.strategy === 'transfer') {
   159	      await tg.send(
   160	        `🔐 Reminder: STRATEGY=transfer uses MEXC withdrawals. Make sure the API key is IP-bound to this VPS and the MEXC ` +
   161	          `withdrawal address whitelist contains ONLY ${chain.address}.`,
   162	      );
   163	    }
   164	  }
   165	
   166	  if (cfg.mode === 'live') await recoverExecuting(db, risk, tg, mexc, (h) => chain.provider.getTransactionReceipt(h), () => chain.checkUnresolved());
   167	  // Keep signed MEXC timestamps inside recvWindow even if the VPS clock drifts.
   168	  setInterval(() => void mexc.syncTime().catch((e) => log.warn(`clock sync: ${errMsg(e)}`)), 10 * 60_000);
   169	
   170	  if (cfg.strategy === 'transfer') return runTransfer(db, risk, tg, mexc, chain, agg);
   171	
   172	  const tokens = await buildWatchlist(mexc, (a) => chain.decimals(a), {
   173	    only: cfg.watchlist,
   174	    max: cfg.watchlistMax,
   175	    minTvlUsd: cfg.minDexTvlUsd,
   176	    minVolumeUsd: cfg.minMexcVolumeUsd,
   177	  });
   178	  if (tokens.length === 0) throw new Error('Watchlist is empty: no token passed the filters');
   179	  log.info(`watchlist: ${tokens.map((t) => `${t.base}(${t.address.slice(0, 8)}…, tvl $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`);
   180	
   181	  const stream = new MexcBookStream(['ETHUSDT', ...tokens.map((t) => t.symbol)]);
   182	  stream.start();
   183	  const book = async (symbol: string) => stream.get(symbol) ?? mexc.depth(symbol, 20);
   184	  const balances =
   185	    cfg.mode === 'live' ? (total?: boolean) => snapshot(chain, mexc, cfg.usdc, tokens, total) : async () => paperBalances(tokens);
   186	
   187	  const freshBook = (symbol: string) => mexc.depth(symbol, 20);
   188	  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, freshBook, balances, tokens });
   189	
   190	  // --- Telegram commands ---
   191	  const statusText = async () => {
   192	    const t = risk.today();
   193	    const lines = [
   194	      `MODE=${cfg.mode} | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   195	      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   196	      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, max gas ${cfg.maxGasGwei} gwei (now ${engine.lastGasGwei.toFixed(1)})`,
   197	      `Fail streak: ${risk.consecutiveFails}/${cfg.maxConsecutiveFails}`,
   198	    ];
   199	    if (cfg.mode === 'live') {
   200	      try {
   201	        const b = await balances();
   202	        lines.push(`Wallet: ${b.walletEth.toFixed(4)} ETH, ${usd(b.walletUsdc)} USDC | MEXC: ${usd(b.mexc.USDT ?? 0)} USDT`);
   203	        for (const tk of tokens) {
   204	          lines.push(`  ${tk.base}: wallet ${(b.walletToken[tk.base] ?? 0).toFixed(4)} | MEXC ${(b.mexc[tk.base] ?? 0).toFixed(4)}${tk.depositOk && tk.withdrawOk ? '' : ' (suspended)'}`);
   205	        }
   206	      } catch (e) {
   207	        lines.push(`Inventory error: ${errMsg(e)}`);
   208	      }
   209	    }
   210	    return lines.join('\n');
   211	  };
   212	  void tg.startPolling({
   213	    '/stop': () => {
   214	      risk.pause('Telegram /stop');
   215	      return '🛑 Trading STOPPED. Send /start to resume.';
   216	    },
   217	    '/start': startHandler(risk, statusText, makeUnresolvedCheck(db, chain)),
   218	    '/status': statusText,
   219	  });
   220	
   221	  // --- Main loop: one scan per block ---
   222	  let busy = false;
   223	  let errors = 0;
   224	  let lastTick = Date.now();
   225	  let lastStallAlert = 0;
   226	  const runTick = async () => {
   227	    if (busy || rateLimited() || lifecycle.stopping) return;
   228	    lastTick = Date.now();
   229	    busy = lifecycle.busy = true;
   230	    try {
   231	      await engine.tick();
   232	      errors = 0;
   233	      rateLimitOk();
   234	    } catch (e) {
   235	      if (onScanError(e)) return;
   236	      errors++;
   237	      log.error(`tick: ${errMsg(e)}`);
   238	      if (errors >= 5) await engine.alertThrottled('tick-errors', `❗ Bot errors (${errors} in a row): ${errMsg(e)}`, 3600_000);
   239	    } finally {
   240	      busy = lifecycle.busy = false;
   241	    }
   242	  };
   243	  chain.provider.on('block', runTick);
   244	  // Watchdog: if the RPC stops emitting blocks, still scan on a timer, and alert once per hour.
   245	  setInterval(() => {
   246	    const idle = Date.now() - lastTick;
   247	    if (idle > 30_000) void runTick();
   248	    if (idle > 3 * 60_000 && Date.now() - lastStallAlert > 3600_000) {
   249	      lastStallAlert = Date.now();
   250	      void tg.send(`⚠️ No new Ethereum block from RPC for ${Math.round(idle / 60_000)} min: scanning on a timer. Check RPC_URL.`);
   251	    }
   252	  }, 15_000);
   253	
   254	  // MEXC deposit/withdraw status every 10 minutes.
   255	  setInterval(async () => {
   256	    try {
   257	      const changed = await refreshStatus(mexc, tokens);
   258	      if (changed.length) await tg.send(`ℹ️ MEXC network status changed:\n${changed.join('\n')}`);
   259	    } catch (e) {
   260	      log.warn(`status refresh: ${errMsg(e)}`);
   261	    }
   262	  }, 10 * 60_000);
   263	
   264	  // Daily summary at 23:00 Bangladesh time.
   265	  setInterval(async () => {
   266	    const { hour } = dhakaHourMinute();
   267	    const today = dhakaDay();
   268	    if (hour === 23 && db.getState('last_summary_day') !== today) {
   269	      db.setState('last_summary_day', today);
   270	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   271	    }
   272	  }, 30_000);
   273	
   274	  installProcessHandlers(tg, () => stream.stop());
   275	
   276	  await tg.send(
   277	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} via ${agg.name}\nTokens: ${tokens.map((t) => t.base).join(', ')}\n` +
   278	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   279	  );
   280	}
   281	
   282	/** TRANSFER strategy: scan every MEXC ERC20 token, buy on MEXC, withdraw, sell on DEX. */
   283	async function runTransfer(db: Db, risk: Risk, tg: Telegram, mexc: MexcRest, chain: Chain, agg: Aggregator) {
   284	  const engine = new TransferEngine({ cfg, mexc, chain, agg, db, risk, tg });
   285	  await engine.refreshUniverse(true);
   286	  if (engine.universe.length === 0) throw new Error('No MEXC ERC20 token passed the filters');
   287	
   288	  void tg.startPolling({
   289	    '/stop': () => {
   290	      risk.pause('Telegram /stop');
   291	      return '🛑 New trades STOPPED. An open transfer still finishes (selling the tokens already bought is the safe exit). /start to resume.';
   292	    },
   293	    '/start': async (args: string[]) => startHandler(risk, transferStatus, makeUnresolvedCheck(db, chain))(args),
   294	    '/status': async () => transferStatus(),
   295	    '/sell': ([id]: string[]) => (id ? engine.forceSell(Number(id)) : 'Usage: /sell <transfer id>'),
   296	    '/clear': ([id]: string[]) => (id ? engine.clear(Number(id)) : 'Usage: /clear <transfer id>'),
   297	  });
   298	
   299	  async function transferStatus() {
   300	    const t = risk.today();
   301	    const open = db.openTransfers();
   302	    const lines = [
   303	      `MODE=${cfg.mode} STRATEGY=transfer | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   304	      `Scanning ${engine.universe.length} MEXC ERC20 tokens every ${cfg.scanIntervalSec}s`,
   305	      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   306	      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, gas ${engine.lastGasGwei.toFixed(1)}/${cfg.maxGasGwei} gwei`,
   307	      `Top gaps: ${engine.lastTopGaps.map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ') || 'none'}`,
   308	      open.length ? `Open: ${open.map((o) => `#${o.id} ${o.base} ${o.status}`).join(', ')}` : 'Open transfers: none',
   309	    ];
   310	    const stuck = db.stuckTransfers();
   311	    if (stuck.length) lines.push(`🚨 Needs you: ${stuck.map((o) => `#${o.id} ${o.base} (${o.note ?? 'stuck'})`).join('; ')} -> /sell <id> or /clear <id>`);
   312	    if (cfg.mode === 'live') {
   313	      try {
   314	        const b = await mexc.balances();
   315	        const eth = await chain.ethBalance();
   316	        const usdc = await chain.tokenBalance(cfg.usdc);
   317	        lines.push(`MEXC ${usd(b.USDT ?? 0)} USDT | wallet ${(Number(eth) / 1e18).toFixed(4)} ETH, ${usd(Number(usdc) / 1e6)} USDC`);
   318	      } catch (e) {
   319	        lines.push(`Balance error: ${errMsg(e)}`);
   320	      }
   321	    }
   322	    return lines.join('\n');
   323	  }
   324	
   325	  let busy = false;
   326	  let errors = 0;
   327	  let lastLow = 0;
   328	  const loop = async () => {
   329	    if (busy || rateLimited() || lifecycle.stopping) return;
   330	    busy = lifecycle.busy = true;
   331	    try {
   332	      await engine.tick();
   333	      errors = 0;
   334	      rateLimitOk();
   335	      // MEXC USDT is spent by buys and comes back only when you move USDC from the wallet to MEXC.
   336	      if (cfg.mode === 'live' && Date.now() - lastLow > 6 * 3600_000) {
   337	        const usdt = (await mexc.balances()).USDT ?? 0;
   338	        const eth = Number(await chain.ethBalance()) / 1e18;
   339	        if (usdt < cfg.minTradeUsd || eth < cfg.minEthForGas) {
   340	          lastLow = Date.now();
   341	          await tg.send(`📦 Rebalance needed: MEXC USDT ${usd(usdt)}, wallet ETH ${eth.toFixed(4)}. Move USDC profits from the wallet back to MEXC.`);
   342	        }
   343	      }
   344	    } catch (e) {
   345	      if (onScanError(e)) return;
   346	      errors++;
   347	      log.error(`scan: ${errMsg(e)}`);
   348	      if (errors === 5) await tg.send(`❗ Bot errors (5 in a row): ${errMsg(e)}`);
   349	    } finally {
   350	      busy = lifecycle.busy = false;
   351	    }
   352	  };
   353	  setInterval(loop, cfg.scanIntervalSec * 1000);
   354	  void loop();
   355	
   356	  setInterval(async () => {
   357	    const today = dhakaDay();
   358	    if (dhakaHourMinute().hour === 23 && db.getState('last_summary_day') !== today) {
   359	      db.setState('last_summary_day', today);
   360	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   361	    }
   362	  }, 30_000);
   363	
   364	  installProcessHandlers(tg, () => {});
   365	
   366	  const open = db.openTransfers();
   367	  await tg.send(
   368	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} STRATEGY=transfer via ${agg.name}\n` +
   369	      `Scanning ${engine.universe.length} MEXC ERC20 tokens (buy MEXC -> withdraw -> sell DEX)\n` +
   370	      (open.length ? `Resuming ${open.length} open transfer(s)\n` : '') +
   371	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   372	  );
   373	}
   374	
   375	main().catch(async (e) => {
   376	  log.error(`startup failed: ${errMsg(e)}`);
   377	  await new Telegram(cfg.telegramToken, cfg.telegramChatId).send(`❗ Bot failed to start: ${errMsg(e)}`);
   378	  process.exit(1);
   379	});
```

## `src/pricing.ts`

```ts
     1	// Pure profit math. No I/O, so it is fully unit tested.
     2	//
     3	// net = sell value - buy value - MEXC taker fee - gas - slippage (both sides) - safety margin
     4	// DEX fees are already inside the aggregator's buyAmount.
     5	import type { Level } from './mexc/rest.js';
     6	import { floorToStep } from './util.js';
     7	
     8	export type Direction = 'DEX_BUY' | 'CEX_BUY';
     9	// DEX_BUY: buy token on DEX with USDC, sell token on MEXC for USDT.
    10	// CEX_BUY: buy token on MEXC with USDT, sell token on DEX for USDC.
    11	
    12	export interface CostParams {
    13	  takerFee: number; // 0.0005 = 0.05%
    14	  cexSlippageBps: number;
    15	  safetyMarginUsd: number;
    16	}
    17	
    18	export interface Opportunity {
    19	  direction: Direction;
    20	  sizeUsd: number; // USD put into the buy leg
    21	  cexQty: number; // token quantity for the MEXC order
    22	  cexLimitPrice: number; // worst acceptable MEXC price (book walk + slippage)
    23	  dexTokens: number; // tokens bought (DEX_BUY) or sold (CEX_BUY) on the DEX
    24	  buyPrice: number; // effective USD per token paid
    25	  sellPrice: number; // effective USD per token received
    26	  cexFeeUsd: number;
    27	  gasUsd: number;
    28	  slippageUsd: number;
    29	  net: number;
    30	}
    31	
    32	/** Sell `qty` base into bids. */
    33	export function fillBase(levels: Level[], qty: number): { quote: number; worst: number } | null {
    34	  let left = qty;
    35	  let quote = 0;
    36	  let worst = 0;
    37	  for (const [price, size] of levels) {
    38	    if (left <= 1e-12) break;
    39	    const take = Math.min(left, size);
    40	    quote += take * price;
    41	    worst = price;
    42	    left -= take;
    43	  }
    44	  return left <= 1e-9 * Math.max(1, qty) ? { quote, worst } : null;
    45	}
    46	
    47	/** Spend `quoteAmount` on asks; returns base quantity bought. */
    48	export function fillQuote(levels: Level[], quoteAmount: number): { qty: number; worst: number } | null {
    49	  let left = quoteAmount;
    50	  let qty = 0;
    51	  let worst = 0;
    52	  for (const [price, size] of levels) {
    53	    if (left <= 1e-9) break;
    54	    const cost = Math.min(left, size * price);
    55	    qty += cost / price;
    56	    worst = price;
    57	    left -= cost;
    58	  }
    59	  return left <= 1e-6 ? { qty, worst } : null;
    60	}
    61	
    62	export function threshold(sizeUsd: number, minProfitUsd: number, minProfitPct: number): number {
    63	  return Math.max(minProfitUsd, (sizeUsd * minProfitPct) / 100);
    64	}
    65	
    66	/**
    67	 * DEX_BUY: we spent `sizeUsd` USDC on the DEX for `tokensOut` (floor `tokensMin`) and sell them on MEXC bids.
    68	 */
    69	export function evaluateDexBuy(p: {
    70	  sizeUsd: number;
    71	  tokensOut: number;
    72	  tokensMin: number;
    73	  bids: Level[];
    74	  qtyStep: number;
    75	  gasUsd: number;
    76	  costs: CostParams;
    77	}): Opportunity | null {
    78	  // Sell on MEXC only what the DEX GUARANTEES (minBuyAmount), so we never sell tokens we may not get.
    79	  const qty = floorToStep(p.tokensMin, p.qtyStep);
    80	  if (qty <= 0) return null;
    81	  const fill = fillBase(p.bids, qty);
    82	  if (!fill) return null;
    83	  const sellPrice = fill.quote / qty;
    84	  const cexFeeUsd = fill.quote * p.costs.takerFee;
    85	  const cexSlip = (fill.quote * p.costs.cexSlippageBps) / 10_000;
    86	  // DEX slippage is covered by sizing from tokensMin; reported for information only.
    87	  const slippageUsd = cexSlip + Math.max(0, p.tokensOut - p.tokensMin) * sellPrice;
    88	  // Worst case we receive exactly tokensMin; the part below the MEXC step stays as inventory.
    89	  const dustUsd = (p.tokensMin - qty) * sellPrice;
    90	  const net = fill.quote - cexFeeUsd - (p.sizeUsd - dustUsd) - p.gasUsd - cexSlip - p.costs.safetyMarginUsd;
    91	  return {
    92	    direction: 'DEX_BUY',
    93	    sizeUsd: p.sizeUsd,
    94	    cexQty: qty,
    95	    cexLimitPrice: fill.worst * (1 - p.costs.cexSlippageBps / 10_000),
    96	    dexTokens: p.tokensOut,
    97	    buyPrice: p.sizeUsd / p.tokensOut,
    98	    sellPrice,
    99	    cexFeeUsd,
   100	    gasUsd: p.gasUsd,
   101	    slippageUsd,
   102	    net,
   103	  };
   104	}
   105	
   106	/**
   107	 * CEX_BUY step 1: how many tokens `sizeUsd` USDT buys on MEXC asks.
   108	 * MEXC charges the buy fee in the token, so we only sell qty * (1 - fee) on the DEX.
   109	 */
   110	export function planCexBuy(p: { sizeUsd: number; asks: Level[]; qtyStep: number; takerFee: number }) {
   111	  const f = fillQuote(p.asks, p.sizeUsd);
   112	  if (!f) return null;
   113	  const qty = floorToStep(f.qty, p.qtyStep);
   114	  if (qty <= 0) return null;
   115	  const fill = fillBase(p.asks, qty);
   116	  if (!fill) return null;
   117	  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - p.takerFee) };
   118	}
   119	
   120	/** CEX_BUY plan for an exact quantity (used when re-checking a trade with a fresh book). */
   121	export function planCexBuyQty(asks: Level[], qty: number, takerFee: number) {
   122	  const fill = fillBase(asks, qty);
   123	  if (!fill) return null;
   124	  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - takerFee) };
   125	}
   126	
   127	/** CEX_BUY step 2: given the DEX quote for selling those tokens, compute net. */
   128	export function evaluateCexBuy(p: {
   129	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
   130	  usdcOut: number;
   131	  usdcMin: number;
   132	  gasUsd: number;
   133	  costs: CostParams;
   134	}): Opportunity {
   135	  const { plan } = p;
   136	  const buyPrice = plan.costUsd / plan.qty;
   137	  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
   138	  const cexSlip = (plan.costUsd * p.costs.cexSlippageBps) / 10_000;
   139	  const dexSlip = Math.max(0, p.usdcOut - p.usdcMin);
   140	  const slippageUsd = cexSlip + dexSlip;
   141	  // cost already includes the token fee implicitly: we paid for qty but only sell qty*(1-fee).
   142	  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - p.costs.safetyMarginUsd;
   143	  return {
   144	    direction: 'CEX_BUY',
   145	    sizeUsd: plan.costUsd,
   146	    cexQty: plan.qty,
   147	    cexLimitPrice: plan.worst * (1 + p.costs.cexSlippageBps / 10_000),
   148	    dexTokens: plan.tokensToSell,
   149	    buyPrice,
   150	    sellPrice: p.usdcOut / plan.tokensToSell,
   151	    cexFeeUsd,
   152	    gasUsd: p.gasUsd,
   153	    slippageUsd,
   154	    net,
   155	  };
   156	}
   157	
   158	/** Gas cost in USD for `gasUnits` at `weiPerGas`. */
   159	export function gasUsd(gasUnits: bigint, weiPerGas: bigint, ethUsd: number): number {
   160	  return (Number(gasUnits * weiPerGas) / 1e18) * ethUsd;
   161	}
   162	
   163	/**
   164	 * What to do after both legs ran. Returns the MEXC market order needed to get flat again (or null).
   165	 * cexFilled is the MEXC executed quantity.
   166	 */
   167	export function unwindPlan(
   168	  direction: Direction,
   169	  dexOk: boolean,
   170	  cexQty: number,
   171	  cexFilled: number,
   172	  takerFee: number,
   173	  qtyStep: number,
   174	): { side: 'BUY' | 'SELL'; qty: number; reason: string } | null {
   175	  const mk = (side: 'BUY' | 'SELL', q: number, reason: string) => {
   176	    const qty = floorToStep(q, qtyStep);
   177	    return qty > 0 ? { side, qty, reason } : null;
   178	  };
   179	  if (direction === 'DEX_BUY') {
   180	    // Wanted: +tokens in wallet (DEX), -tokens on MEXC (sell).
   181	    if (!dexOk) return mk('BUY', cexFilled, 'DEX leg failed: buy back what was sold on MEXC');
   182	    return mk('SELL', cexQty - cexFilled, 'MEXC sell only partly filled: sell the rest at market');
   183	  }
   184	  // CEX_BUY wanted: +tokens on MEXC (buy), -tokens in wallet (DEX sell).
   185	  if (!dexOk) return mk('SELL', cexFilled * (1 - takerFee), 'DEX leg failed: sell what was bought on MEXC');
   186	  return mk('BUY', cexQty - cexFilled, 'MEXC buy only partly filled: buy the rest at market');
   187	}
   188	
   189	/**
   190	 * TRANSFER: buy on MEXC -> withdraw to wallet -> sell on DEX. Not atomic: the price can move
   191	 * while the withdrawal is on its way, so `driftBps` of the sale value is reserved as extra risk cost.
   192	 */
   193	export function evaluateTransfer(p: {
   194	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
   195	  withdrawFeeTokens: number; // MEXC withdraw fee, paid in the token
   196	  usdcOut: number; // DEX quote for selling the tokens that arrive
   197	  usdcMin: number;
   198	  gasUsd: number; // approval + swap
   199	  driftBps: number;
   200	  costs: CostParams;
   201	}) {
   202	  const { plan } = p;
   203	  const arriving = plan.tokensToSell - p.withdrawFeeTokens;
   204	  const buyPrice = plan.costUsd / plan.qty;
   205	  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
   206	  const withdrawFeeUsd = p.withdrawFeeTokens * buyPrice;
   207	  const slippageUsd = (plan.costUsd * p.costs.cexSlippageBps) / 10_000 + Math.max(0, p.usdcOut - p.usdcMin);
   208	  const driftUsd = (p.usdcOut * p.driftBps) / 10_000;
   209	  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - driftUsd - p.costs.safetyMarginUsd;
   210	  return {
   211	    arriving,
   212	    buyPrice,
   213	    sellPrice: arriving > 0 ? p.usdcOut / arriving : 0,
   214	    cexFeeUsd,
   215	    withdrawFeeUsd,
   216	    slippageUsd,
   217	    driftUsd,
   218	    gasUsd: p.gasUsd,
   219	    costUsd: plan.costUsd,
   220	    net,
   221	  };
   222	}
```

## `src/recovery.ts`

```ts
     1	// Startup recovery after a crash/restart in the middle of a trade.
     2	import type { Db } from './db.js';
     3	import type { Risk } from './risk.js';
     4	import type { MexcRest } from './mexc/rest.js';
     5	import type { Notifier } from './engine.js';
     6	import { errMsg } from './log.js';
     7	
     8	/**
     9	 * Startup recovery:
    10	 *  - a trade row still 'executing' means the bot died mid-trade: look up the MEXC order (by our client id)
    11	 *    and the DEX receipt. Both legs complete -> 'ok' (PnL could not be measured). Anything else -> 'one_sided'
    12	 *    and a CRITICAL pause until a human sends /start confirm.
    13	 *  - an unresolved DEX tx from before the restart (persisted) also keeps the bot in a critical pause.
    14	 */
    15	export async function recoverExecuting(
    16	  db: Db,
    17	  risk: Risk,
    18	  tg: Notifier,
    19	  mexc: Pick<MexcRest, 'getOrderByClientId'>,
    20	  receipt: (hash: string) => Promise<{ status: number | null } | null>,
    21	  checkUnresolved?: () => Promise<{ state: 'clear' | 'pending' }>,
    22	) {
    23	  const lines: string[] = [];
    24	  let incomplete = 0;
    25	
    26	  for (const r of db.executingTrades()) {
    27	    const cid = /client order id (\S+?)(;|$)/.exec(r.note ?? '')?.[1];
    28	    let cex = 'MEXC order: unknown';
    29	    let cexDone = false;
    30	    if (cid) {
    31	      try {
    32	        const o = await mexc.getOrderByClientId(`${r.symbol}USDT`, cid);
    33	        cex = o ? `MEXC order ${o.orderId}: ${o.status}, filled ${o.executedQty}` : 'MEXC order: never placed';
    34	        cexDone = Boolean(o && Number(o.executedQty) >= r.qty * 0.999 && o.status === 'FILLED');
    35	      } catch (e) {
    36	        cex = `MEXC lookup failed: ${errMsg(e)}`;
    37	      }
    38	    }
    39	    let dex = 'DEX tx: none signed';
    40	    let dexDone = false;
    41	    if (r.dex_tx) {
    42	      const rc = await receipt(r.dex_tx).catch(() => null);
    43	      dex = rc ? `DEX tx ${r.dex_tx}: ${rc.status === 1 ? 'SUCCESS' : 'REVERTED'}` : `DEX tx ${r.dex_tx}: NOT MINED (may still be pending)`;
    44	      dexDone = rc?.status === 1;
    45	    }
    46	    const complete = cexDone && dexDone;
    47	    if (!complete) incomplete++;
    48	    db.updateTrade(r.id, {
    49	      status: complete ? 'ok' : 'one_sided',
    50	      note: `${r.note ?? ''}; recovered at startup: ${cex}; ${dex}${complete ? '; both legs done, PnL not measured' : ''}`,
    51	    });
    52	    lines.push(`${complete ? '✅' : '⚠️'} #${r.id} ${r.symbol} ${r.direction} qty ${r.qty}\n  ${cex}\n  ${dex}`);
    53	  }
    54	
    55	  const pendingTx = checkUnresolved ? (await checkUnresolved().catch(() => ({ state: 'pending' as const }))).state === 'pending' : false;
    56	  if (pendingTx) {
    57	    incomplete++;
    58	    lines.push('⚠️ A DEX tx sent before the restart is still unresolved (pending, not mined).');
    59	  }
    60	  if (!lines.length) return;
    61	
    62	  if (incomplete) risk.pause('bot restarted during a trade', true);
    63	  await tg.send(
    64	    `${incomplete ? '🚨' : 'ℹ️'} Bot restarted while trade(s) were running:\n${lines.join('\n')}\n` +
    65	      (incomplete
    66	        ? `Trading PAUSED. Check balances (/status), fix any open position by hand, then /start confirm.`
    67	        : `All legs completed; no action needed (PnL of these trades was not measured).`),
    68	  );
    69	}
```

## `src/report.ts`

```ts
     1	// npm run report -- [hours] [mode]   e.g. `npm run report -- 24 live`
     2	import 'dotenv/config';
     3	import { Db } from './db.js';
     4	import { formatReport } from './summary.js';
     5	
     6	const hours = Number(process.argv[2] ?? 24);
     7	const mode = process.argv[3] ?? process.env.MODE ?? 'live';
     8	const db = new Db(process.env.DB_PATH || 'data/bot.sqlite');
     9	console.log(formatReport(db, mode, hours, 'Report'));
    10	db.close();
```

## `src/risk.ts`

```ts
     1	// Risk limits: daily trade count, daily loss limit, failure streak, manual kill switch.
     2	// All state lives in SQLite, so a restart (pm2) never resets the limits.
     3	import type { Db, TradeStatus } from './db.js';
     4	import { dhakaDay } from './util.js';
     5	
     6	export interface RiskLimits {
     7	  maxTradesPerDay: number;
     8	  dailyLossLimitUsd: number;
     9	  maxConsecutiveFails: number;
    10	}
    11	
    12	export type RiskEvent =
    13	  | { kind: 'loss_limit'; pnl: number }
    14	  | { kind: 'fail_streak'; count: number }
    15	  | { kind: 'trade_limit'; trades: number };
    16	
    17	export class Risk {
    18	  constructor(private db: Db, private mode: string, private limits: RiskLimits, private now = () => Date.now()) {}
    19	
    20	  get paused(): boolean {
    21	    return this.db.getState('paused') === '1';
    22	  }
    23	  get pauseReason(): string {
    24	    return this.db.getState('pause_reason') ?? '';
    25	  }
    26	  get consecutiveFails(): number {
    27	    return Number(this.db.getState('consecutive_fails') ?? '0');
    28	  }
    29	
    30	  /** Critical pauses mean money may be in an unknown state; only `/start confirm` clears them. */
    31	  get critical(): boolean {
    32	    return this.db.getState('pause_critical') === '1';
    33	  }
    34	
    35	  pause(reason: string, critical = false): void {
    36	    // Never downgrade: a soft pause on top of a critical one keeps it critical.
    37	    const keepCritical = this.paused && this.critical && !critical;
    38	    this.db.setState('paused', '1');
    39	    if (!keepCritical) this.db.setState('pause_reason', reason);
    40	    this.db.setState('pause_critical', critical || keepCritical ? '1' : '0');
    41	  }
    42	
    43	  /** Returns false (and stays paused) if a critical pause is not confirmed. */
    44	  resume(confirm = false): boolean {
    45	    if (this.paused && this.critical && !confirm) return false;
    46	    // After a critical incident the failure streak is NOT forgiven: the bot does not get a fresh budget.
    47	    if (!this.critical) this.db.setState('consecutive_fails', '0');
    48	    this.db.setState('paused', '0');
    49	    this.db.setState('pause_reason', '');
    50	    this.db.setState('pause_critical', '0');
    51	    return true;
    52	  }
    53	
    54	  /** Remaining daily loss budget (USD) before the limit is hit. */
    55	  remainingLossBudget(): number {
    56	    return this.limits.dailyLossLimitUsd + this.today().pnl;
    57	  }
    58	
    59	  today() {
    60	    return this.db.dayStats(dhakaDay(this.now()), this.mode);
    61	  }
    62	
    63	  /** null = allowed, otherwise the reason trading is blocked right now. */
    64	  blockReason(): string | null {
    65	    if (this.paused) return `paused: ${this.pauseReason}`;
    66	    const t = this.today();
    67	    if (t.trades >= this.limits.maxTradesPerDay) return `daily trade limit reached (${t.trades})`;
    68	    if (t.pnl <= -this.limits.dailyLossLimitUsd) return `daily loss limit reached (${t.pnl.toFixed(2)})`;
    69	    return null;
    70	  }
    71	
    72	  /** Update streaks after a trade; returns events that need an alert. */
    73	  afterTrade(status: TradeStatus): RiskEvent[] {
    74	    const events: RiskEvent[] = [];
    75	    if (status === 'ok' || status === 'paper') {
    76	      this.db.setState('consecutive_fails', '0');
    77	    } else {
    78	      const n = this.consecutiveFails + 1;
    79	      this.db.setState('consecutive_fails', String(n));
    80	      if (n >= this.limits.maxConsecutiveFails) {
    81	        this.pause(`${n} failed trades in a row`);
    82	        events.push({ kind: 'fail_streak', count: n });
    83	      }
    84	    }
    85	    const t = this.today();
    86	    if (t.pnl <= -this.limits.dailyLossLimitUsd) {
    87	      this.pause(`daily loss limit hit (${t.pnl.toFixed(2)} USD)`);
    88	      events.push({ kind: 'loss_limit', pnl: t.pnl });
    89	    }
    90	    if (t.trades >= this.limits.maxTradesPerDay) events.push({ kind: 'trade_limit', trades: t.trades });
    91	    return events;
    92	  }
    93	}
```

## `src/scanner.ts`

```ts
     1	// Continuously scans EVERY MEXC USDT pair whose coin is an Ethereum (ERC20) token,
     2	// and finds tokens that are cheaper on MEXC than on Ethereum DEXs.
     3	//
     4	// Cheap first pass (2 + N/30 HTTP calls per scan):
     5	//   MEXC bookTicker (all symbols, one call)  vs  DexScreener price (30 tokens per call)
     6	// Only the biggest gaps then get an exact, size-specific aggregator quote (see transfer.ts).
     7	import type { MexcRest } from './mexc/rest.js';
     8	import { ethNetwork, isOnline } from './watchlist.js';
     9	import { type SymbolRules, rulesFrom } from './mexc/rules.js';
    10	
    11	export interface ScanToken {
    12	  base: string;
    13	  symbol: string;
    14	  address: string; // lowercase, from MEXC's own deposit info -> same token as on-chain
    15	  netWork: string; // MEXC network id for withdrawals
    16	  withdrawFee: number; // tokens
    17	  withdrawMin: number;
    18	  qtyStep: number;
    19	  priceDecimals: number;
    20	  rules: SymbolRules;
    21	  volumeUsd: number;
    22	}
    23	
    24	export interface Gap {
    25	  token: ScanToken;
    26	  ask: number; // MEXC best ask
    27	  dexPrice: number; // DexScreener price of the deepest Ethereum pool
    28	  tvlUsd: number;
    29	  gapPct: number; // (dexPrice / ask - 1) * 100, positive = MEXC cheaper
    30	}
    31	
    32	const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH']);
    33	
    34	/** All tradable MEXC/USDT ERC20 tokens with deposits AND withdrawals open and enough volume. */
    35	export async function loadUniverse(
    36	  mexc: Pick<MexcRest, 'exchangeInfo' | 'tickers24h' | 'coinConfigs'>,
    37	  opts: { minVolumeUsd: number; only: string[] },
    38	): Promise<ScanToken[]> {
    39	  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
    40	  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
    41	  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
    42	  const out: ScanToken[] = [];
    43	  for (const s of symbols) {
    44	    const base = s.baseAsset.toUpperCase();
    45	    if (s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed || !isOnline(s.status) || SKIP.has(base)) continue;
    46	    if ((s.tradeSideType ?? 1) !== 1) continue; // transfer needs to buy and (for exits) sell
    47	    if (opts.only.length && !opts.only.includes(base)) continue;
    48	    const vol = volume.get(s.symbol) ?? 0;
    49	    if (vol < opts.minVolumeUsd) continue;
    50	    const coin = coinBy.get(base);
    51	    const net = coin && ethNetwork(coin);
    52	    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue;
    53	    if (!net.depositEnable || !net.withdrawEnable) continue; // suspended -> skip
    54	    out.push({
    55	      base,
    56	      symbol: s.symbol,
    57	      address: net.contract.toLowerCase(),
    58	      netWork: net.netWork ?? net.network,
    59	      withdrawFee: Number(net.withdrawFee ?? 0),
    60	      withdrawMin: Number(net.withdrawMin ?? 0),
    61	      qtyStep: rulesFrom(s).qtyStep,
    62	      priceDecimals: s.quotePrecision,
    63	      rules: rulesFrom(s),
    64	      volumeUsd: vol,
    65	    });
    66	  }
    67	  return out;
    68	}
    69	
    70	type FetchFn = typeof fetch;
    71	
    72	/** DexScreener prices for many tokens (30 per request). Uses each token's deepest Ethereum pool. */
    73	export async function dexPrices(addresses: string[], fetchFn: FetchFn = fetch): Promise<Map<string, { price: number; tvl: number }>> {
    74	  const out = new Map<string, { price: number; tvl: number }>();
    75	  for (let i = 0; i < addresses.length; i += 30) {
    76	    const chunk = addresses.slice(i, i + 30);
    77	    const res = await fetchFn(`https://api.dexscreener.com/tokens/v1/ethereum/${chunk.join(',')}`, { signal: AbortSignal.timeout(10_000) });
    78	    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    79	    const pairs = (await res.json()) as { chainId: string; priceUsd?: string; liquidity?: { usd?: number }; baseToken: { address: string } }[];
    80	    for (const p of pairs) {
    81	      if (p.chainId !== 'ethereum' || !p.priceUsd) continue;
    82	      const addr = p.baseToken.address.toLowerCase(); // priceUsd is the price of baseToken
    83	      const tvl = p.liquidity?.usd ?? 0;
    84	      if (!out.has(addr) || tvl > out.get(addr)!.tvl) out.set(addr, { price: Number(p.priceUsd), tvl });
    85	    }
    86	  }
    87	  return out;
    88	}
    89	
    90	/** Tokens cheaper on MEXC than on DEX by at least minGapPct, biggest gap first. */
    91	export function findGaps(
    92	  tokens: ScanToken[],
    93	  tickers: Map<string, { bid: number; ask: number }>,
    94	  dex: Map<string, { price: number; tvl: number }>,
    95	  opts: { minTvlUsd: number; minGapPct: number; maxGapPct?: number },
    96	): Gap[] {
    97	  const gaps: Gap[] = [];
    98	  for (const token of tokens) {
    99	    const t = tickers.get(token.symbol);
   100	    const d = dex.get(token.address);
   101	    if (!t || !d || t.ask <= 0 || d.price <= 0 || d.tvl < opts.minTvlUsd) continue;
   102	    const gapPct = (d.price / t.ask - 1) * 100;
   103	    // Huge gaps usually mean a different/broken token or a dead pool, not an opportunity.
   104	    if (gapPct >= opts.minGapPct && gapPct < (opts.maxGapPct ?? 30)) gaps.push({ token, ask: t.ask, dexPrice: d.price, tvlUsd: d.tvl, gapPct });
   105	  }
   106	  return gaps.sort((a, b) => b.gapPct - a.gapPct);
   107	}
```

## `src/summary.ts`

```ts
     1	import type { Db } from './db.js';
     2	import { usd } from './util.js';
     3	
     4	/** Text report for the last `hours` (used by the 23:00 summary and `npm run report`). */
     5	export function formatReport(db: Db, mode: string, hours: number, title: string): string {
     6	  const { total, bySymbol } = db.statsSince(Date.now() - hours * 3600_000, mode);
     7	  const lines = [
     8	    `${title} (${mode}, last ${hours}h)`,
     9	    `Trades: ${total.trades} | Failed/one-sided: ${total.failed}`,
    10	    `Net PnL: ${usd(total.pnl)} | Gas spent: ${usd(total.gas)} | MEXC fees: ${usd(total.fees)}`,
    11	  ];
    12	  if (bySymbol.length) {
    13	    lines.push('Per token:');
    14	    for (const s of bySymbol) {
    15	      lines.push(`  ${s.pnl >= 0 ? '🟢' : '🔴'} ${s.symbol}: ${usd(s.pnl)} (${s.trades} trades, ${s.failed} failed, gas ${usd(s.gas)})`);
    16	    }
    17	  }
    18	  return lines.join('\n');
    19	}
```

## `src/telegram.ts`

```ts
     1	// Telegram alerts + commands (/stop, /start, /status, ...).
     2	// Commands are obeyed only from the admin user, in a private chat with the bot.
     3	import { log, errMsg, redact } from './log.js';
     4	import { sleep } from './util.js';
     5	
     6	type Handler = (args: string[]) => Promise<string> | string;
     7	type FetchFn = typeof fetch;
     8	type Update = {
     9	  message?: { chat?: { id: number | string; type?: string }; from?: { id: number | string }; text?: string; date?: number };
    10	};
    11	
    12	export class Telegram {
    13	  private offset = 0;
    14	  private running = false;
    15	
    16	  /** Commands sent before this moment are never executed (a restart must not replay an old /start confirm). */
    17	  private readonly startedAt = Math.floor(Date.now() / 1000);
    18	
    19	  constructor(
    20	    private token: string,
    21	    private chatId: string,
    22	    private fetchFn: FetchFn = fetch,
    23	    private adminId = '',
    24	    /** Persists the update offset across restarts. */
    25	    private offsetStore?: { get(): string | undefined; set(v: string): void },
    26	  ) {}
    27	
    28	  get enabled(): boolean {
    29	    return Boolean(this.token && this.chatId);
    30	  }
    31	
    32	  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    33	    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
    34	      method: 'POST',
    35	      headers: { 'Content-Type': 'application/json' },
    36	      body: JSON.stringify(body),
    37	      signal: AbortSignal.timeout(timeoutMs),
    38	    });
    39	    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    40	    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    41	    return j.result;
    42	  }
    43	
    44	  /** Never throws: alerts must not crash the bot. */
    45	  async send(text: string): Promise<void> {
    46	    const msg = redact(text);
    47	    log.info(`[telegram] ${msg.replace(/\n/g, ' | ')}`);
    48	    if (!this.enabled) return;
    49	    try {
    50	      await this.api('sendMessage', { chat_id: this.chatId, text: msg.slice(0, 4000), disable_web_page_preview: true });
    51	    } catch (e) {
    52	      log.warn(`telegram send failed: ${errMsg(e)}`);
    53	    }
    54	  }
    55	
    56	  /** Dispatch one update; exported for tests. */
    57	  async handle(update: Update, handlers: Record<string, Handler>) {
    58	    const m = update.message;
    59	    if (!m?.text || String(m.chat?.id) !== String(this.chatId)) return; // other chats
    60	    if (m.date !== undefined && m.date < this.startedAt) {
    61	      log.warn(`telegram: ignored command sent before this start (${m.text.split(/\s/)[0]})`);
    62	      return;
    63	    }
    64	    // In a group anyone could type /start: require the admin user in a private chat.
    65	    if (!this.adminId || String(m.from?.id) !== String(this.adminId) || m.chat?.type !== 'private') {
    66	      log.warn(`telegram: ignored command from user ${m.from?.id} in ${m.chat?.type ?? '?'} chat`);
    67	      return;
    68	    }
    69	    const [first, ...args] = m.text.trim().split(/\s+/);
    70	    const cmd = first.split('@')[0].toLowerCase();
    71	    const h = handlers[cmd];
    72	    const reply = h ? await h(args) : `Commands: ${Object.keys(handlers).join(' ')}`;
    73	    await this.send(reply);
    74	  }
    75	
    76	  async startPolling(handlers: Record<string, Handler>): Promise<void> {
    77	    if (!this.enabled || this.running) return;
    78	    this.running = true;
    79	    this.offset = Number(this.offsetStore?.get() ?? 0) || 0;
    80	    let backoff = 5000;
    81	    while (this.running) {
    82	      try {
    83	        const updates = await this.api<({ update_id: number } & Update)[]>(
    84	          'getUpdates',
    85	          { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
    86	          35_000,
    87	        );
    88	        for (const u of updates) {
    89	          this.offset = u.update_id + 1;
    90	          this.offsetStore?.set(String(this.offset)); // acknowledged before handling: never handled twice
    91	          await this.handle(u, handlers).catch((e) => log.warn(`telegram handler: ${errMsg(e)}`));
    92	        }
    93	        backoff = 5000;
    94	      } catch (e) {
    95	        log.warn(`telegram poll: ${errMsg(e)} (retry in ${backoff / 1000}s)`);
    96	        await sleep(backoff);
    97	        backoff = Math.min(backoff * 2, 5 * 60_000); // e.g. a bad token: do not hammer the API
    98	      }
    99	    }
   100	  }
   101	
   102	  stop(): void {
   103	    this.running = false;
   104	  }
   105	}
```

## `src/transfer.ts`

```ts
     1	// TRANSFER strategy: scan all MEXC ERC20 tokens -> buy the one that is cheaper on MEXC ->
     2	// withdraw it to the hot wallet -> sell it on an Ethereum DEX.
     3	//
     4	// Each cycle is a persisted state machine (buying -> withdrawing -> selling -> done),
     5	// so a crash or pm2 restart continues where it stopped.
     6	//
     7	// Safety rules:
     8	//  - Orders and withdrawals carry our own client id; an ambiguous request (timeout) is looked up,
     9	//    never blindly repeated.
    10	//  - A withdrawal is only ever sent to our own hot wallet, and never re-sent automatically.
    11	//  - Failed DEX sales back off (2m, 10m, 30m) and then wait for a human (/sell <id>, /clear <id>).
    12	//  - If arrival-time price would lose more than TRANSFER_MAX_LOSS_PCT, the tokens are held (alert).
    13	//  - An unknown on-chain outcome pauses trading instead of retrying.
    14	import type { Config } from './config.js';
    15	import type { Aggregator, Quote } from './dex/aggregator.js';
    16	import { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
    17	import type { GasInfo, TxResult } from './dex/chain.js';
    18	import type { Book, CoinConfig, Order, SymbolInfo, WithdrawRecord } from './mexc/rest.js';
    19	import { AmbiguousRequestError } from './mexc/rest.js';
    20	import type { Db, TransferRow } from './db.js';
    21	import type { Risk } from './risk.js';
    22	import type { Notifier } from './engine.js';
    23	import { USDC_DECIMALS, cancelAndConfirm, clientId, placeSafely } from './engine.js';
    24	import { orderProblem } from './mexc/rules.js';
    25	import { type Gap, type ScanToken, dexPrices, findGaps, loadUniverse } from './scanner.js';
    26	import { evaluateTransfer, gasUsd, planCexBuy, threshold } from './pricing.js';
    27	import { log, errMsg } from './log.js';
    28	import { decimalsOfStep, dhakaDay, floorToStep, sleep as realSleep, toFloat, toUnits, usd } from './util.js';
    29	
    30	const APPROVE_GAS = 60_000n;
    31	const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
    32	const SELL_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000]; // after attempt 1, 2, 3; attempt 4 -> stuck
    33	const MAX_SELL_ATTEMPTS = 4;
    34	const FALSE_GAP_COOLDOWN_MS = 10 * 60_000;
    35	
    36	export interface TransferMexc {
    37	  exchangeInfo(): Promise<SymbolInfo[]>;
    38	  tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]>;
    39	  coinConfigs(): Promise<CoinConfig[]>;
    40	  bookTickers(): Promise<Map<string, { bid: number; ask: number }>>;
    41	  depth(symbol: string, limit?: number): Promise<Book>;
    42	  balances(): Promise<Record<string, number>>;
    43	  limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
    44	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
    45	  getOrder(symbol: string, orderId: string): Promise<Order>;
    46	  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
    47	  cancelOrder(symbol: string, orderId: string): Promise<Order>;
    48	  withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string>;
    49	  findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null>;
    50	}
    51	export interface TransferChain {
    52	  readonly address: string;
    53	  gas(): Promise<GasInfo>;
    54	  decimals(token: string): Promise<number>;
    55	  tokenBalance(token: string): Promise<bigint>;
    56	  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
    57	  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
    58	  send(
    59	    tx: { to: string; data: string; value?: bigint },
    60	    gasLimit: bigint,
    61	    gas: GasInfo,
    62	    timeoutSec: number,
    63	    onSigned?: (hash: string, nonce: number) => void,
    64	  ): Promise<TxResult>;
    65	  checkUnresolved?(): Promise<{ state: 'clear' | 'pending'; dropped?: boolean }>;
    66	  receipt?(hash: string): Promise<{ status: number | null } | null>;
    67	}
    68	
    69	export interface TransferDeps {
    70	  cfg: Config;
    71	  mexc: TransferMexc;
    72	  chain: TransferChain;
    73	  agg: Aggregator;
    74	  db: Db;
    75	  risk: Risk;
    76	  tg: Notifier;
    77	  dexPricesFn?: typeof dexPrices;
    78	  sleep?: (ms: number) => Promise<void>;
    79	  now?: () => number;
    80	}
    81	
    82	interface Candidate {
    83	  gap: Gap;
    84	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
    85	  ev: ReturnType<typeof evaluateTransfer>;
    86	  decimals: number;
    87	}
    88	
    89	const WITHDRAW_FAILED = new Set([8, 9]); // FAILED, CANCEL
    90	const WITHDRAW_MANUAL = 10;
    91	const buyCid = (id: number) => `arb${id}b`;
    92	const withdrawCid = (id: number) => `arb${id}w`;
    93	
    94	export class TransferEngine {
    95	  universe: ScanToken[] = [];
    96	  private universeTs = 0;
    97	  private lastNote = new Map<string, string>();
    98	  private cooldown = new Map<string, number>(); // token -> skip exact quotes until
    99	  private alerted = new Set<string>();
   100	  private sleep: (ms: number) => Promise<void>;
   101	  private now: () => number;
   102	  lastGasGwei = 0;
   103	  lastTopGaps: Gap[] = [];
   104	
   105	  constructor(private d: TransferDeps) {
   106	    this.sleep = d.sleep ?? realSleep;
   107	    this.now = d.now ?? Date.now;
   108	  }
   109	
   110	  private get cfg() {
   111	    return this.d.cfg;
   112	  }
   113	  private get live() {
   114	    return this.cfg.mode === 'live';
   115	  }
   116	  private costs() {
   117	    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
   118	  }
   119	  private note(key: string, msg: string) {
   120	    if (this.lastNote.get(key) !== msg) {
   121	      this.lastNote.set(key, msg);
   122	      log.info(msg);
   123	    }
   124	  }
   125	  /** Telegram once per key (per process). */
   126	  private async alertOnce(key: string, text: string) {
   127	    if (this.alerted.has(key)) return;
   128	    this.alerted.add(key);
   129	    await this.d.tg.send(text);
   130	  }
   131	  private reload(row: TransferRow): TransferRow {
   132	    return this.d.db.getTransfer(row.id!)!;
   133	  }
   134	
   135	  async refreshUniverse(force = false): Promise<void> {
   136	    if (!force && this.now() - this.universeTs < 10 * 60_000) return;
   137	    this.universe = await loadUniverse(this.d.mexc, { minVolumeUsd: this.cfg.minMexcVolumeUsd, only: this.cfg.watchlist });
   138	    this.universeTs = this.now();
   139	    log.info(`scanner universe: ${this.universe.length} MEXC ERC20 tokens (deposit+withdraw open, volume >= $${this.cfg.minMexcVolumeUsd})`);
   140	  }
   141	
   142	  /** One scan cycle. Always advances open transfers first. */
   143	  async tick(): Promise<void> {
   144	    const gas = await this.d.chain.gas();
   145	    this.lastGasGwei = Number(gas.effective) / 1e9;
   146	    const tickers = await this.d.mexc.bookTickers();
   147	    const eth = tickers.get('ETHUSDT');
   148	    if (!eth) throw new Error('no ETHUSDT ticker');
   149	    const ethUsd = (eth.bid + eth.ask) / 2;
   150	
   151	    // An earlier DEX tx with unknown outcome blocks every new send (same nonce rule as the inventory engine).
   152	    let txBlocked = false;
   153	    if (this.d.chain.checkUnresolved) {
   154	      const u = await this.d.chain.checkUnresolved();
   155	      if (u.dropped) await this.d.tg.send('ℹ️ An unresolved DEX tx was dropped by every RPC (never mined); its nonce is free again.');
   156	      txBlocked = u.state === 'pending';
   157	      if (txBlocked) await this.alertOnce('unresolved-tx', '⏳ An earlier DEX tx is still unresolved: no DEX sales or new trades until it is mined or dropped.');
   158	      else this.alerted.delete('unresolved-tx');
   159	    }
   160	
   161	    for (const row of this.d.db.openTransfers()) {
   162	      if (txBlocked && row.status === 'selling') continue; // would only be refused
   163	      try {
   164	        await this.advance(row, gas, ethUsd);
   165	      } catch (e) {
   166	        log.error(`transfer #${row.id} ${row.base}: ${errMsg(e)}`);
   167	      }
   168	    }
   169	
   170	    await this.refreshUniverse();
   171	    const dex = await (this.d.dexPricesFn ?? dexPrices)(this.universe.map((t) => t.address));
   172	    const now = this.now();
   173	    const gaps = findGaps(this.universe, tickers, dex, {
   174	      minTvlUsd: this.cfg.minDexTvlUsd,
   175	      minGapPct: this.cfg.scanMinGapPct,
   176	      maxGapPct: this.cfg.scanMaxGapPct,
   177	    });
   178	    this.lastTopGaps = gaps.slice(0, 5);
   179	    this.note(
   180	      'gaps',
   181	      gaps.length
   182	        ? `scan: ${gaps.length} gaps >= ${this.cfg.scanMinGapPct}%: ${gaps.slice(0, 5).map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ')}`
   183	        : `scan: ${this.universe.length} tokens, no gap >= ${this.cfg.scanMinGapPct}%`,
   184	    );
   185	
   186	    const block = this.d.risk.blockReason();
   187	    if (block) return this.note('block', `new trades blocked: ${block}`);
   188	    this.note('block', 'new trades enabled');
   189	    if (txBlocked) return;
   190	    if (this.d.db.blockingTransfers().length >= this.cfg.maxOpenTransfers) return this.note('open', 'waiting for open transfer to finish');
   191	    this.note('open', 'no open transfer');
   192	    if (this.lastGasGwei > this.cfg.maxGasGwei) return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > ${this.cfg.maxGasGwei}, no new trades`);
   193	    this.note('gas', 'gas ok');
   194	
   195	    // Skip tokens whose exact quote recently showed the gap was not real, so they cannot starve the rest.
   196	    // Never two transfers of the same token at once (they would share one wallet balance), even after
   197	    // an old one stopped blocking because of a long withdrawal.
   198	    const busyTokens = new Set([...this.d.db.openTransfers(), ...this.d.db.stuckTransfers()].map((t) => t.base));
   199	    const fresh = gaps.filter((g) => (this.cooldown.get(g.token.base) ?? 0) <= now && !busyTokens.has(g.token.base));
   200	    if (!fresh.length) return;
   201	
   202	    const usdt = this.live ? ((await this.d.mexc.balances()).USDT ?? 0) : 1e12;
   203	    let best: Candidate | null = null;
   204	    for (const g of fresh.slice(0, this.cfg.scanExactQuotes)) {
   205	      try {
   206	        const c = await this.evaluate(g, gas, ethUsd, usdt);
   207	        if (!c) {
   208	          this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   209	          continue;
   210	        }
   211	        const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
   212	        log.info(`${g.token.base}: gap ${g.gapPct.toFixed(2)}%, size ${usd(c.ev.costUsd)}, exact net ${usd(c.ev.net)} (need ${usd(need)})`);
   213	        if (c.ev.net <= need) this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   214	        else if (!best || c.ev.net > best.ev.net) best = c;
   215	      } catch (e) {
   216	        log.warn(`${g.token.base} evaluate: ${errMsg(e)}`);
   217	        this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   218	      }
   219	    }
   220	    if (!best) return;
   221	    if (!this.live) return this.recordPaper(best);
   222	    await this.start(best, gas, ethUsd);
   223	  }
   224	
   225	  /** Exact, size-specific numbers: MEXC depth walk + withdraw fee + aggregator quote + gas + drift reserve. */
   226	  async evaluate(g: Gap, gas: GasInfo, ethUsd: number, usdt: number): Promise<Candidate | null> {
   227	    const size = Math.min(this.cfg.maxTradeUsd, usdt * 0.99);
   228	    if (size < this.cfg.minTradeUsd) {
   229	      this.note('usdt', `MEXC USDT too low for a trade (${usd(usdt)})`);
   230	      return null;
   231	    }
   232	    const t = g.token;
   233	    const book = await this.d.mexc.depth(t.symbol, 20);
   234	    const plan = planCexBuy({ sizeUsd: size, asks: book.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
   235	    if (!plan || plan.tokensToSell < t.withdrawMin) return null;
   236	    const arriving = plan.tokensToSell - t.withdrawFee;
   237	    if (arriving <= 0) return null;
   238	    const decimals = await this.d.chain.decimals(t.address);
   239	    const q = await this.d.agg.price({
   240	      sellToken: t.address,
   241	      buyToken: this.cfg.usdc,
   242	      sellAmount: toUnits(arriving, decimals),
   243	      taker: this.live ? this.d.chain.address : PAPER_TAKER,
   244	      slippageBps: this.cfg.dexSlippageBps,
   245	    });
   246	    const ev = evaluateTransfer({
   247	      plan,
   248	      withdrawFeeTokens: t.withdrawFee,
   249	      usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
   250	      usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
   251	      gasUsd: gasUsd(q.gas + APPROVE_GAS, gas.effective, ethUsd),
   252	      driftBps: this.cfg.transferDriftBps,
   253	      costs: this.costs(),
   254	    });
   255	    return { gap: g, plan, ev, decimals };
   256	  }
   257	
   258	  private async recordPaper(c: Candidate) {
   259	    const t = c.gap.token;
   260	    const now = this.now();
   261	    this.d.db.insertTrade({
   262	      ts: now, day: dhakaDay(now), mode: 'paper', symbol: t.base, direction: 'TRANSFER',
   263	      size_usd: c.ev.costUsd, qty: c.plan.qty, buy_price: c.ev.buyPrice, sell_price: c.ev.sellPrice,
   264	      expected_net: c.ev.net, cex_fee_usd: c.ev.cexFeeUsd + c.ev.withdrawFeeUsd, gas_usd: c.ev.gasUsd,
   265	      pnl_usd: c.ev.net, status: 'paper', dex_tx: null, cex_order_id: null, note: `gap ${c.gap.gapPct.toFixed(2)}%`,
   266	    });
   267	    await this.d.tg.send(
   268	      `📝 PAPER TRANSFER ${t.base}: buy MEXC @ ${c.ev.buyPrice.toPrecision(6)} -> sell DEX @ ${c.ev.sellPrice.toPrecision(6)}\n` +
   269	        `Size ${usd(c.ev.costUsd)} | fees ${usd(c.ev.cexFeeUsd + c.ev.withdrawFeeUsd)} | gas ${usd(c.ev.gasUsd)} | drift reserve ${usd(c.ev.driftUsd)}\nNet ${usd(c.ev.net)}`,
   270	    );
   271	    this.d.risk.afterTrade('paper');
   272	    this.cooldown.set(t.base, this.now() + FALSE_GAP_COOLDOWN_MS); // one paper trade per gap
   273	  }
   274	
   275	  /** Create the persisted transfer and run its first steps right away. */
   276	  private async start(c: Candidate, gas: GasInfo, ethUsd: number) {
   277	    const t = c.gap.token;
   278	    const now = this.now();
   279	    const id = this.d.db.insertTransfer({
   280	      ts: now, updated: now, base: t.base, symbol: t.symbol, address: t.address, decimals: c.decimals,
   281	      net_work: t.netWork, qty_step: t.qtyStep, price_decimals: t.priceDecimals, status: 'buying',
   282	      buy_qty: c.plan.qty, cost_usd: c.ev.costUsd, buy_order_id: null, withdraw_amount: null, withdraw_id: null,
   283	      wallet_before: null, received: null, usdc_out: null, gas_usd: 0, expected_net: c.ev.net, pnl: null,
   284	      sell_attempts: 0, alerted_timeout: 0, note: null, withdraw_fee: t.withdrawFee, next_try: 0, force_sell: 0, hold_alerted: 0, sell_tx: null,
   285	    });
   286	    log.info(`transfer #${id} ${t.base}: START gap ${c.gap.gapPct.toFixed(2)}% expected ${usd(c.ev.net)}`);
   287	    const row = this.d.db.getTransfer(id)!;
   288	    try {
   289	      await this.buy(row, c.plan.worst * (1 + this.cfg.cexSlippageBps / 10_000));
   290	    } catch (e) {
   291	      if (String((e as Error).message).startsWith('UNKNOWN_ORDER_STATE')) {
   292	        this.d.risk.pause(`MEXC buy state unknown for transfer #${id}`, true);
   293	        await this.d.tg.send(`🚨 TRANSFER #${id} ${t.base}: MEXC buy state unknown (${errMsg(e)}). Trading PAUSED; the bot keeps looking for the order.`);
   294	        return;
   295	      }
   296	      const now2 = this.reload(row);
   297	      if (now2.buy_order_id) {
   298	        log.warn(`transfer #${id}: error after the buy was placed (${errMsg(e)}); continuing next scan`);
   299	        return;
   300	      }
   301	      return this.fail(now2, `MEXC buy rejected: ${errMsg(e)}`, 0, false);
   302	    }
   303	    const next = this.d.db.getTransfer(id)!;
   304	    if (next.status === 'withdrawing') await this.advance(next, gas, ethUsd);
   305	  }
   306	
   307	  /** Move one transfer forward as far as it can go right now. */
   308	  async advance(row: TransferRow, gas: GasInfo, ethUsd: number): Promise<void> {
   309	    if (row.status === 'buying') {
   310	      if (!row.buy_order_id) {
   311	        // Crashed or timed out while placing: find the order by our client id, never guess.
   312	        const o = await this.d.mexc.getOrderByClientId(row.symbol, buyCid(row.id!));
   313	        if (!o) return this.fail(row, 'MEXC buy was never placed', 0, false);
   314	        this.d.db.updateTransfer(row.id!, { buy_order_id: o.orderId });
   315	        row = this.reload(row);
   316	      }
   317	      await this.finishBuy(row);
   318	      row = this.reload(row);
   319	      if (row.status !== 'withdrawing') return;
   320	    }
   321	    if (row.status === 'withdrawing') return this.withdrawStep(row, gas, ethUsd);
   322	    if (row.status === 'selling') return this.sellStep(row, gas, ethUsd);
   323	  }
   324	
   325	  private async buy(row: TransferRow, limitPrice: number) {
   326	    const f = 10 ** row.price_decimals;
   327	    const px = (Math.ceil(limitPrice * f) / f).toFixed(row.price_decimals);
   328	    const qty = row.buy_qty.toFixed(decimalsOfStep(row.qty_step));
   329	    const cid = buyCid(row.id!);
   330	    const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, () => this.d.mexc.limitOrder(row.symbol, 'BUY', qty, px, cid), this.sleep);
   331	    this.d.db.updateTransfer(row.id!, { buy_order_id: orderId });
   332	    log.info(`transfer #${row.id} MEXC BUY ${qty} ${row.base} @ ${px} id=${orderId}`);
   333	    await this.sleep(1500);
   334	    await this.finishBuy(this.reload(row));
   335	  }
   336	
   337	  private async finishBuy(row: TransferRow) {
   338	    let o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
   339	    if (o.status !== 'FILLED') {
   340	      try {
   341	        o = await cancelAndConfirm(this.d.mexc, row.symbol, row.buy_order_id!, this.sleep);
   342	      } catch (e) {
   343	        log.warn(`transfer #${row.id}: ${errMsg(e)}; checking again next scan`);
   344	        return; // still 'buying': the order is re-read next tick, never assumed
   345	      }
   346	    }
   347	    const filled = Number(o.executedQty);
   348	    const cost = Number(o.cummulativeQuoteQty);
   349	    if (filled <= 0) return this.fail(row, 'MEXC buy did not fill (price moved)', 0, false);
   350	    this.d.db.updateTransfer(row.id!, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
   351	  }
   352	
   353	  private async withdrawStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
   354	    const since = row.ts - 60_000;
   355	
   356	    if (!row.withdraw_id) {
   357	      if (row.withdraw_amount) {
   358	        // A request was sent before but its result was lost (timeout / restart). Look it up; NEVER resend.
   359	        const rec = await this.d.mexc.findWithdraw(row.base, since, { withdrawOrderId: withdrawCid(row.id!) });
   360	        if (rec) {
   361	          this.d.db.updateTransfer(row.id!, { withdraw_id: rec.id });
   362	          return;
   363	        }
   364	        if (this.now() - row.updated > 10 * 60_000) {
   365	          this.d.db.updateTransfer(row.id!, { status: 'stuck', note: 'withdraw request outcome unknown' });
   366	          await this.d.tg.send(
   367	            `🚨 TRANSFER #${row.id} ${row.base}: withdraw request was sent but MEXC shows no record after 10 min.\n` +
   368	              `Check MEXC withdraw history. If nothing went out: /sell ${row.id} is NOT right (tokens are on MEXC), sell them on MEXC by hand, then /clear ${row.id}.`,
   369	          );
   370	        }
   371	        return;
   372	      }
   373	
   374	      const free = (await this.d.mexc.balances())[row.base] ?? 0;
   375	      const amount = floorToStep(Math.min(free, row.buy_qty * (1 - this.cfg.mexcTakerFee)), row.qty_step);
   376	      const amountStr = amount.toFixed(decimalsOfStep(row.qty_step));
   377	      const min = this.universe.find((t) => t.base === row.base)?.withdrawMin ?? 0;
   378	      if (amount <= 0 || amount < min) {
   379	        const proceeds = amount > 0 ? await this.sellOnMexc(row, amountStr) : 0;
   380	        return this.fail(row, `amount ${amountStr} below MEXC withdraw minimum ${min}; sold back on MEXC`, proceeds - row.cost_usd);
   381	      }
   382	      const before = await this.d.chain.tokenBalance(row.address);
   383	      // Persist BEFORE sending, so a crash during the request can never cause a second withdrawal.
   384	      this.d.db.updateTransfer(row.id!, { withdraw_amount: amountStr, wallet_before: before.toString() });
   385	      try {
   386	        const id = await this.d.mexc.withdraw({
   387	          coin: row.base,
   388	          netWork: row.net_work,
   389	          address: this.d.chain.address, // ONLY ever our own hot wallet
   390	          amount: amountStr,
   391	          contractAddress: row.address,
   392	          withdrawOrderId: withdrawCid(row.id!),
   393	        });
   394	        this.d.db.updateTransfer(row.id!, { withdraw_id: id });
   395	        await this.d.tg.send(`📤 TRANSFER #${row.id} ${row.base}: bought ${row.buy_qty} on MEXC for ${usd(row.cost_usd)}, withdrawing ${amountStr} to wallet`);
   396	      } catch (e) {
   397	        if (e instanceof AmbiguousRequestError) {
   398	          log.warn(`transfer #${row.id} withdraw request ambiguous, will look it up: ${errMsg(e)}`);
   399	          return; // next tick: findWithdraw by withdrawOrderId
   400	        }
   401	        // Clearly rejected: nothing left MEXC. Close the position there instead.
   402	        this.d.db.updateTransfer(row.id!, { withdraw_amount: null });
   403	        const proceeds = await this.sellOnMexc(row, amountStr);
   404	        return this.fail(this.reload(row), `withdraw rejected: ${errMsg(e)}; sold back on MEXC`, proceeds - row.cost_usd);
   405	      }
   406	      return;
   407	    }
   408	
   409	    const rec = await this.d.mexc.findWithdraw(row.base, since, { id: row.withdraw_id, withdrawOrderId: withdrawCid(row.id!) }).catch(() => undefined);
   410	    const bal = await this.d.chain.tokenBalance(row.address);
   411	    const diff = bal - BigInt(row.wallet_before ?? '0');
   412	    // Fee actually charged by MEXC (history) beats the configured one.
   413	    const fee = rec?.transactionFee !== undefined && rec.transactionFee !== '' ? Number(rec.transactionFee) : row.withdraw_fee;
   414	    const expected = toUnits(Math.max(0, Number(row.withdraw_amount) - fee), row.decimals);
   415	
   416	    // Arrival needs BOTH: MEXC says SUCCESS and the wallet grew by (almost) the expected amount.
   417	    // A balance change alone could be an unrelated deposit / airdrop.
   418	    if (rec?.status === 7 && diff > 0n && diff * 100n < expected * 98n) {
   419	      await this.alertOnce(
   420	        `wshort-${row.id}`,
   421	        `⚠️ TRANSFER #${row.id} ${row.base}: MEXC says SUCCESS but the wallet only grew by ${toFloat(diff, row.decimals)} (expected ~${toFloat(expected, row.decimals)}). Waiting; check the wallet.`,
   422	      );
   423	    }
   424	    if (rec?.status === 7 && diff > 0n && diff * 100n >= expected * 98n) {
   425	      // Sell what was withdrawn, never more (extra balance may belong to something else).
   426	      const received = diff > (expected * 102n) / 100n ? expected : diff;
   427	      this.d.db.updateTransfer(row.id!, { status: 'selling', received: received.toString() });
   428	      log.info(`transfer #${row.id} ${row.base}: ${toFloat(received, row.decimals)} arrived in wallet`);
   429	      return this.sellStep(this.reload(row), gas, ethUsd);
   430	    }
   431	    if (rec && WITHDRAW_FAILED.has(rec.status) && diff <= 0n) {
   432	      // Funds go back to the MEXC account; sell there once they are visible.
   433	      const free = (await this.d.mexc.balances())[row.base] ?? 0;
   434	      if (free < Number(row.withdraw_amount) * 0.99) {
   435	        return this.alertOnce(`wfail-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: MEXC withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}; waiting for the tokens to return to MEXC`);
   436	      }
   437	      await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}, selling back on MEXC`);
   438	      // Sell what is actually free on MEXC, never more than was withdrawn.
   439	      const qty = floorToStep(Math.min(free, Number(row.withdraw_amount)), row.qty_step).toFixed(decimalsOfStep(row.qty_step));
   440	      const proceeds = await this.sellOnMexc(row, qty);
   441	      return this.fail(row, `withdraw status ${rec.status}`, proceeds - row.cost_usd);
   442	    }
   443	    if (rec?.status === WITHDRAW_MANUAL) {
   444	      await this.alertOnce(`wmanual-${row.id}`, `⏳ TRANSFER #${row.id} ${row.base}: MEXC put the withdrawal under MANUAL review. Waiting.`);
   445	    }
   446	    if (rec === null) {
   447	      await this.alertOnce(`wmissing-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${row.withdraw_id} not found in MEXC history. Still watching the wallet.`);
   448	    }
   449	
   450	    const ageMin = (this.now() - row.ts) / 60_000;
   451	    if (ageMin > this.cfg.transferTimeoutMin && row.alerted_timeout < 1) {
   452	      this.d.db.updateTransfer(row.id!, { alerted_timeout: 1 });
   453	      await this.d.tg.send(
   454	        `⏳ TRANSFER #${row.id} ${row.base}: not in wallet after ${Math.round(ageMin)} min (MEXC status ${rec?.status ?? '?'}). Still waiting.`,
   455	      );
   456	    } else if (ageMin > 2 * this.cfg.transferTimeoutMin && row.alerted_timeout < 2) {
   457	      // Give up blocking: new trades may start, this one is still watched every scan (read-only, no gas).
   458	      this.d.db.updateTransfer(row.id!, { alerted_timeout: 2 });
   459	      await this.d.tg.send(
   460	        `⏳ TRANSFER #${row.id} ${row.base}: still not in wallet after ${Math.round(ageMin)} min. It no longer blocks new trades; ` +
   461	          `the bot keeps watching and sells when it arrives. Check MEXC support if it stays missing.`,
   462	      );
   463	    }
   464	  }
   465	
   466	  private async sellStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
   467	    if (row.next_try > this.now()) return;
   468	    if (Number(gas.effective) / 1e9 > this.cfg.maxGasGwei) return this.note(`sell-${row.id}`, `transfer #${row.id}: gas too high, sale waits`);
   469	
   470	    // Crash safety: a sale tx was signed before (hash persisted). Did it already execute?
   471	    if (row.sell_tx && this.d.chain.receipt) {
   472	      const rc = await this.d.chain.receipt(row.sell_tx).catch(() => null);
   473	      if (rc?.status === 1) {
   474	        this.d.db.updateTransfer(row.id!, { status: 'done', note: 'sale completed before a restart; PnL not measured' });
   475	        this.recordTrade(row, 'ok', 0, row.gas_usd, row.sell_tx, 'sale completed before a restart; PnL not measured');
   476	        await this.d.tg.send(`✅ TRANSFER #${row.id} ${row.base}: the DEX sale ${row.sell_tx} had already executed before the restart. Marked done (PnL not measured).`);
   477	        return;
   478	      }
   479	    }
   480	    // Never sell more than is really in the wallet now.
   481	    const balance = await this.d.chain.tokenBalance(row.address);
   482	    const amount = balance < BigInt(row.received!) ? balance : BigInt(row.received!);
   483	    if (amount * 100n < BigInt(row.received!)) {
   484	      this.d.db.updateTransfer(row.id!, { status: 'stuck', note: 'tokens no longer in the wallet' });
   485	      await this.d.tg.send(
   486	        `🚨 TRANSFER #${row.id} ${row.base}: the tokens are no longer in the wallet (sold before a restart, or moved). Check etherscan, then /clear ${row.id}.`,
   487	      );
   488	      return;
   489	    }
   490	    const qty = toFloat(amount, row.decimals);
   491	    const req = { sellToken: row.address, buyToken: this.cfg.usdc, sellAmount: amount, taker: this.d.chain.address, slippageBps: this.cfg.dexSlippageBps };
   492	    let gasWei = 0n;
   493	    let txHash: string | undefined;
   494	    try {
   495	      const first = await this.d.agg.quote(req);
   496	
   497	      // Loss floor: price may have fallen while the withdrawal travelled. Hold instead of locking in a big loss.
   498	      const worstOut = toFloat(first.minBuyAmount, USDC_DECIMALS);
   499	      const floor = row.cost_usd * (1 - this.cfg.transferMaxLossPct / 100);
   500	      if (worstOut >= floor && row.hold_alerted) this.d.db.updateTransfer(row.id!, { hold_alerted: 0 }); // recovered: alert again if it falls
   501	      if (worstOut < floor && !row.force_sell) {
   502	        this.d.db.updateTransfer(row.id!, { next_try: this.now() + 5 * 60_000 });
   503	        if (!row.hold_alerted) {
   504	          this.d.db.updateTransfer(row.id!, { hold_alerted: 1 });
   505	          await this.d.tg.send(
   506	            `✋ TRANSFER #${row.id} ${row.base}: DEX would pay only ${usd(worstOut)} for tokens that cost ${usd(row.cost_usd)} ` +
   507	              `(more than ${this.cfg.transferMaxLossPct}% loss). HOLDING ${qty} ${row.base} in the wallet and re-checking every 5 min.\n` +
   508	              `Send /sell ${row.id} to sell anyway.`,
   509	          );
   510	        }
   511	        return;
   512	      }
   513	
   514	      const ap = await this.d.chain.approveExact(row.address, this.spenderOf(first), amount, gas);
   515	      gasWei += ap.gasCostWei;
   516	      if (ap.unknown) return this.unknownOutcome(row, `approval ${ap.hash}`, gasWei, ethUsd);
   517	      if (!ap.ok) throw new Error(`approval failed: ${ap.reason}`);
   518	      const firm = await this.d.agg.quote(req); // fresh after the approval
   519	      if (!firm.tx) throw new Error('quote without transaction');
   520	      const est = await this.d.chain.simulate(firm.tx);
   521	      const usdcBefore = await this.d.chain.tokenBalance(this.cfg.usdc);
   522	      const r = await this.d.chain.send(firm.tx, (est * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash) =>
   523	        this.d.db.updateTransfer(row.id!, { sell_tx: hash }),
   524	      );
   525	      if (r.refused) return; // an earlier tx is unresolved: not an attempt, try again later
   526	      gasWei += r.gasCostWei;
   527	      txHash = r.hash;
   528	      if (r.unknown) return this.unknownOutcome(row, `swap ${r.hash}`, gasWei, ethUsd);
   529	      if (!r.ok) throw new Error(`swap ${r.reason}`);
   530	      const usdcOut = toFloat((await this.d.chain.tokenBalance(this.cfg.usdc)) - usdcBefore, USDC_DECIMALS);
   531	      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
   532	      const pnl = usdcOut - row.cost_usd - gasTotal;
   533	      this.d.db.updateTransfer(row.id!, { status: 'done', usdc_out: usdcOut, gas_usd: gasTotal, pnl });
   534	      this.recordTrade(row, 'ok', pnl, gasTotal, txHash, `sold ${qty} for ${usd(usdcOut)}`, usdcOut / qty);
   535	      await this.d.tg.send(
   536	        [
   537	          `${pnl >= 0 ? '✅' : '🔻'} TRANSFER #${row.id} ${row.base} done`,
   538	          `Buy MEXC: ${row.buy_qty} for ${usd(row.cost_usd)} (@ ${(row.cost_usd / row.buy_qty).toPrecision(6)})`,
   539	          `Sell DEX: ${qty} for ${usd(usdcOut)} (@ ${(usdcOut / qty).toPrecision(6)})`,
   540	          `Withdraw fee ${row.withdraw_fee} ${row.base} | Gas ${usd(gasTotal)}`,
   541	          `Expected ${usd(row.expected_net)} | Net PnL ${usd(pnl)}`,
   542	          `https://etherscan.io/tx/${txHash}`,
   543	        ].join('\n'),
   544	      );
   545	      this.afterRisk('ok');
   546	    } catch (e) {
   547	      const attempts = row.sell_attempts + 1;
   548	      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
   549	      const stuck = attempts >= MAX_SELL_ATTEMPTS;
   550	      const wait = SELL_BACKOFF_MS[Math.min(attempts - 1, SELL_BACKOFF_MS.length - 1)];
   551	      this.d.db.updateTransfer(row.id!, {
   552	        sell_attempts: attempts,
   553	        gas_usd: gasTotal,
   554	        status: stuck ? 'stuck' : 'selling',
   555	        next_try: this.now() + wait,
   556	        note: errMsg(e),
   557	      });
   558	      log.warn(`transfer #${row.id} ${row.base} sell attempt ${attempts} failed: ${errMsg(e)}${stuck ? '' : `; retry in ${wait / 60_000} min`}`);
   559	      if (stuck) {
   560	        await this.d.tg.send(
   561	          `🚨 TRANSFER #${row.id} ${row.base}: DEX sale failed ${attempts} times (${errMsg(e)}). Automatic retries STOPPED.\n` +
   562	            `${qty} ${row.base} are in the hot wallet. Send /sell ${row.id} to try again, or sell by hand and send /clear ${row.id}.`,
   563	        );
   564	        this.afterRisk('one_sided');
   565	      }
   566	    }
   567	  }
   568	
   569	  /** On-chain outcome unknown: do not retry (could double-sell). Pause and hand over to a human. */
   570	  private async unknownOutcome(row: TransferRow, what: string, gasWei: bigint, ethUsd: number) {
   571	    this.d.db.updateTransfer(row.id!, {
   572	      status: 'stuck',
   573	      gas_usd: row.gas_usd + (Number(gasWei) / 1e18) * ethUsd,
   574	      note: `${what} outcome unknown`,
   575	    });
   576	    this.d.risk.pause(`transfer #${row.id}: ${what} outcome unknown`, true);
   577	    await this.d.tg.send(
   578	      `🚨 TRANSFER #${row.id} ${row.base}: ${what} was not mined and its cancel was not confirmed. Outcome UNKNOWN.\n` +
   579	        `Trading PAUSED. Check the wallet on etherscan. Then /sell ${row.id} (if the tokens are still there) or /clear ${row.id}, and /start.`,
   580	    );
   581	  }
   582	
   583	  private spenderOf(q: Quote): string {
   584	    if (q.spender) return q.spender;
   585	    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
   586	    throw new Error('aggregator did not return a spender');
   587	  }
   588	
   589	  /**
   590	   * Market-sell on MEXC; returns the net USDT received.
   591	   * MEXC's docs do not say whether the fee is inside cummulativeQuoteQty, so we measure the
   592	   * real USDT balance change instead of assuming.
   593	   */
   594	  private async sellOnMexc(row: TransferRow, qty: string): Promise<number> {
   595	    const rules = this.universe.find((t) => t.base === row.base)?.rules;
   596	    const px = row.cost_usd / (row.buy_qty || 1);
   597	    const problem = rules && orderProblem(rules, 'SELL', Number(qty), px, 'MARKET');
   598	    if (problem) {
   599	      this.d.risk.pause(`cannot sell ${row.base} on MEXC: ${problem}`, true);
   600	      await this.d.tg.send(`🚨 ${row.base}: cannot market-sell ${qty} on MEXC (${problem}). Trading PAUSED: sell it by hand, then /start confirm.`);
   601	      return 0;
   602	    }
   603	    try {
   604	      const usdtBefore = (await this.d.mexc.balances()).USDT ?? 0;
   605	      const cid = clientId(`${row.id}s`);
   606	      const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, () => this.d.mexc.marketSell(row.symbol, qty, cid), this.sleep);
   607	      await this.sleep(1000);
   608	      const o = await this.d.mexc.getOrder(row.symbol, orderId);
   609	      const filled = Number(o.executedQty);
   610	      if (filled < Number(qty) * 0.999) {
   611	        this.d.risk.pause(`MEXC sell of ${row.base} only partly filled`, true);
   612	        await this.d.tg.send(
   613	          `🚨 ${row.base}: MEXC market sell filled only ${filled}/${qty}. The rest is still on MEXC. Trading PAUSED: sell it by hand, then /start.`,
   614	        );
   615	      }
   616	      await this.sleep(1500);
   617	      const received = ((await this.d.mexc.balances()).USDT ?? 0) - usdtBefore;
   618	      // Fallback only if the balance read is clearly off (e.g. a concurrent deposit/withdrawal).
   619	      return received > 0 ? received : Number(o.cummulativeQuoteQty) * (1 - this.cfg.mexcTakerFee);
   620	    } catch (e) {
   621	      this.d.risk.pause(`could not close ${row.base} on MEXC`, true);
   622	      await this.d.tg.send(`🚨 ${row.base}: MEXC market sell of ${qty} FAILED (${errMsg(e)}). Trading PAUSED. Close it manually, then /start.`);
   623	      return 0;
   624	    }
   625	  }
   626	
   627	  private async fail(row: TransferRow, why: string, pnl: number, countAsFailure = true) {
   628	    this.d.db.updateTransfer(row.id!, { status: 'failed', pnl, note: why });
   629	    log.warn(`transfer #${row.id} ${row.base} failed: ${why}`);
   630	    if (!countAsFailure) return; // e.g. buy simply did not fill: no money moved
   631	    this.recordTrade(row, 'one_sided', pnl, row.gas_usd, undefined, why);
   632	    await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base} failed: ${why}\nPnL ${usd(pnl)}`);
   633	    this.afterRisk('one_sided');
   634	  }
   635	
   636	  /** Telegram /sell <id>: retry a stuck or held sale now (even below the loss floor). */
   637	  forceSell(id: number): string {
   638	    const t = this.d.db.getTransfer(id);
   639	    if (!t) return `No transfer #${id}`;
   640	    if (!t.received) return `Transfer #${id} has no tokens in the wallet yet (status ${t.status})`;
   641	    if (t.status !== 'stuck' && t.status !== 'selling') return `Transfer #${id} is ${t.status}`;
   642	    this.d.db.updateTransfer(id, { status: 'selling', force_sell: 1, next_try: 0, sell_attempts: 0 });
   643	    return `Transfer #${id}: selling on the next scan (loss floor ignored).`;
   644	  }
   645	
   646	  /** Telegram /clear <id>: you resolved it by hand; close the record. */
   647	  clear(id: number): string {
   648	    const t = this.d.db.getTransfer(id);
   649	    if (!t) return `No transfer #${id}`;
   650	    if (t.status === 'done' || t.status === 'failed') return `Transfer #${id} is already ${t.status}`;
   651	    this.d.db.updateTransfer(id, { status: 'failed', note: 'cleared manually via /clear' });
   652	    // Gas already burned on this transfer is a real cost: book it so the daily loss limit sees it.
   653	    if (t.gas_usd > 0) this.recordTrade(t, 'one_sided', -t.gas_usd, t.gas_usd, undefined, 'cleared manually; gas spent');
   654	    return `Transfer #${id} closed manually. Gas spent (${usd(t.gas_usd)}) is booked; the token result is not, check balances yourself.`;
   655	  }
   656	
   657	  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0) {
   658	    const now = this.now();
   659	    const buyPrice = row.cost_usd / (row.buy_qty || 1);
   660	    this.d.db.insertTrade({
   661	      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
   662	      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: buyPrice, sell_price: sellPrice, expected_net: row.expected_net,
   663	      // informational only: PnL is measured from real balances and already includes every fee
   664	      cex_fee_usd: row.cost_usd * this.cfg.mexcTakerFee + row.withdraw_fee * buyPrice,
   665	      gas_usd: gas, pnl_usd: pnl, status, dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
   666	    });
   667	  }
   668	
   669	  private afterRisk(status: 'ok' | 'one_sided') {
   670	    for (const e of this.d.risk.afterTrade(status)) {
   671	      if (e.kind === 'loss_limit') void this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). New trades STOPPED. Send /start to resume.`);
   672	      if (e.kind === 'fail_streak') void this.d.tg.send(`🛑 ${e.count} failed trades in a row. New trades PAUSED. /start to resume.`);
   673	      if (e.kind === 'trade_limit') void this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}).`);
   674	    }
   675	  }
   676	}
```

## `src/util.ts`

```ts
     1	export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
     2	
     3	const DHAKA_OFFSET_MS = 6 * 3600 * 1000; // Bangladesh: UTC+6, no DST
     4	
     5	/** Calendar day in Bangladesh time, e.g. "2026-11-20". Daily limits reset at Dhaka midnight. */
     6	export function dhakaDay(t = Date.now()): string {
     7	  return new Date(t + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
     8	}
     9	
    10	export function dhakaHourMinute(t = Date.now()): { hour: number; minute: number } {
    11	  const d = new Date(t + DHAKA_OFFSET_MS);
    12	  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
    13	}
    14	
    15	/** Round down to a multiple of `step` (e.g. MEXC quantity precision) and format without float noise. */
    16	export function floorToStep(x: number, step: number): number {
    17	  if (step <= 0) return x;
    18	  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    19	  const v = Math.floor(x / step + 1e-9) * step;
    20	  return Number(v.toFixed(decimals));
    21	}
    22	
    23	export function decimalsOfStep(step: number): number {
    24	  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    25	}
    26	
    27	export const usd = (x: number) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`;
    28	
    29	/** Token amount (bigint base units) -> float. Fine for pricing; never used for on-chain amounts. */
    30	export function toFloat(amount: bigint, decimals: number): number {
    31	  const s = amount.toString().padStart(decimals + 1, '0');
    32	  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals) || '0'}`);
    33	}
    34	
    35	/** Float -> base units, truncated (never rounded up, so we never ask for more than we hold). */
    36	export function toUnits(x: number, decimals: number): bigint {
    37	  if (!(x > 0) || !Number.isFinite(x)) return 0n;
    38	  // Work on the shortest exact decimal string of the number and CUT it: toFixed() would round
    39	  // (0.1239999999 -> "0.124"), and the full binary expansion is slightly above the intended value.
    40	  const [i, f = ''] = plainDecimal(x).split('.');
    41	  return BigInt(i + f.padEnd(decimals, '0').slice(0, decimals));
    42	}
    43	
    44	/** Number -> plain decimal string without exponent ("1.5e-7" -> "0.00000015"). */
    45	function plainDecimal(x: number): string {
    46	  const s = String(x);
    47	  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
    48	  if (!m) return s;
    49	  const digits = m[1] + (m[2] ?? '');
    50	  const point = m[1].length + Number(m[3]);
    51	  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
    52	  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
    53	  return `${digits.slice(0, point)}.${digits.slice(point)}`;
    54	}
```

## `src/watchlist.ts`

```ts
     1	// Builds the token list: on MEXC (USDT pair) AND on Ethereum, with the SAME contract address
     2	// (taken from MEXC's own deposit network info), enough DEX TVL and MEXC volume.
     3	import type { CoinConfig, MexcRest } from './mexc/rest.js';
     4	import { log, errMsg } from './log.js';
     5	import { type SymbolRules, rulesFrom } from './mexc/rules.js';
     6	
     7	/** exchangeInfo status: live API returns "1"; the docs example shows "ENABLED". Accept both. */
     8	export const isOnline = (status: unknown) => String(status) === '1' || String(status).toUpperCase() === 'ENABLED';
     9	
    10	export interface Token {
    11	  base: string; // e.g. LINK
    12	  symbol: string; // MEXC symbol, e.g. LINKUSDT
    13	  address: string; // Ethereum contract (lowercase)
    14	  decimals: number;
    15	  qtyStep: number; // MEXC quantity step (from baseAssetPrecision)
    16	  priceDecimals: number; // MEXC price precision
    17	  rules: SymbolRules;
    18	  dexTvlUsd: number;
    19	  mexcVolumeUsd: number;
    20	  depositOk: boolean;
    21	  withdrawOk: boolean;
    22	}
    23	
    24	const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH', 'WBTC']);
    25	
    26	/** MEXC's Ethereum network entry for a coin (network names vary: "ERC20", "Ethereum(ERC20)", netWork "ETH"). */
    27	export function ethNetwork(cfg: CoinConfig) {
    28	  return cfg.networkList.find(
    29	    (n) => n.netWork === 'ETH' || /ERC20/i.test(n.network) || /^ethereum$/i.test(n.network),
    30	  );
    31	}
    32	
    33	type FetchFn = typeof fetch;
    34	
    35	/** Highest liquidity (USD) of any Ethereum pool for the token, from DexScreener. */
    36	export async function dexTvl(address: string, fetchFn: FetchFn = fetch): Promise<number> {
    37	  const res = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
    38	  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    39	  const j = (await res.json()) as { pairs?: { chainId: string; liquidity?: { usd?: number } }[] | null };
    40	  return Math.max(0, ...(j.pairs ?? []).filter((p) => p.chainId === 'ethereum').map((p) => p.liquidity?.usd ?? 0));
    41	}
    42	
    43	export async function buildWatchlist(
    44	  mexc: MexcRest,
    45	  decimalsOf: (address: string) => Promise<number>,
    46	  opts: { only: string[]; max: number; minTvlUsd: number; minVolumeUsd: number },
    47	): Promise<Token[]> {
    48	  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
    49	  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
    50	  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
    51	
    52	  const candidates = symbols
    53	    .filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed && isOnline(s.status))
    54	    .filter((s) => !SKIP.has(s.baseAsset.toUpperCase()))
    55	    .filter((s) => opts.only.length === 0 || opts.only.includes(s.baseAsset.toUpperCase()))
    56	    .filter((s) => (volume.get(s.symbol) ?? 0) >= opts.minVolumeUsd)
    57	    .sort((a, b) => (volume.get(b.symbol) ?? 0) - (volume.get(a.symbol) ?? 0));
    58	
    59	  // Check candidates 8 at a time (each DexScreener call can take seconds), stop once we have enough.
    60	  const out: Token[] = [];
    61	  const check = async (s: (typeof candidates)[number]): Promise<Token | null> => {
    62	    const coin = coinBy.get(s.baseAsset.toUpperCase());
    63	    const net = coin && ethNetwork(coin);
    64	    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) return null; // not an Ethereum token on MEXC
    65	    const address = net.contract.toLowerCase();
    66	    try {
    67	      const tvl = await dexTvl(address);
    68	      if (tvl < opts.minTvlUsd) {
    69	        log.info(`watchlist: skip ${s.baseAsset}, DEX TVL $${Math.round(tvl)}`);
    70	        return null;
    71	      }
    72	      const rules = rulesFrom(s);
    73	      return {
    74	        base: s.baseAsset.toUpperCase(),
    75	        symbol: s.symbol,
    76	        address,
    77	        decimals: await decimalsOf(address),
    78	        qtyStep: rules.qtyStep,
    79	        priceDecimals: s.quotePrecision,
    80	        rules,
    81	        dexTvlUsd: tvl,
    82	        mexcVolumeUsd: volume.get(s.symbol) ?? 0,
    83	        depositOk: net.depositEnable,
    84	        withdrawOk: net.withdrawEnable,
    85	      };
    86	    } catch (e) {
    87	      log.warn(`watchlist: ${s.baseAsset} check failed: ${errMsg(e)}`);
    88	      return null;
    89	    }
    90	  };
    91	  for (let i = 0; i < candidates.length && out.length < opts.max; i += 8) {
    92	    const batch = await Promise.all(candidates.slice(i, i + 8).map(check));
    93	    for (const t of batch) if (t && out.length < opts.max) out.push(t);
    94	  }
    95	  return out;
    96	}
    97	
    98	/** Refresh deposit/withdraw flags (tokens with either suspended are skipped). */
    99	export async function refreshStatus(mexc: MexcRest, tokens: Token[]): Promise<string[]> {
   100	  const coins = new Map((await mexc.coinConfigs()).map((c) => [c.coin.toUpperCase(), c]));
   101	  const changed: string[] = [];
   102	  for (const t of tokens) {
   103	    const net = coins.get(t.base) && ethNetwork(coins.get(t.base)!);
   104	    const dep = Boolean(net?.depositEnable && net.contract?.toLowerCase() === t.address);
   105	    const wd = Boolean(net?.withdrawEnable);
   106	    if (dep !== t.depositOk || wd !== t.withdrawOk) changed.push(`${t.base}: deposit ${dep ? 'on' : 'OFF'}, withdraw ${wd ? 'on' : 'OFF'}`);
   107	    t.depositOk = dep;
   108	    t.withdrawOk = wd;
   109	  }
   110	  return changed;
   111	}
```

## `src/mexc/proto.ts`

```ts
     1	// Minimal protobuf decoder for MEXC WebSocket pushes (wss://wbs-api.mexc.com/ws).
     2	// MEXC sends PushDataV3ApiWrapper messages:
     3	//   1: channel (string), 3: symbol (string), 6: sendTime (int64),
     4	//   303: publicLimitDepths { 1: asks[], 2: bids[], 3: eventType, 4: version }
     5	//   each level: { 1: price (string), 2: quantity (string) }
     6	// Only the fields we use are decoded; everything else is skipped by wire type.
     7	
     8	type Field = { num: number; wire: number; value: number | Uint8Array };
     9	
    10	function readVarint(buf: Uint8Array, pos: number): [number, number] {
    11	  let result = 0;
    12	  let shift = 0;
    13	  for (;;) {
    14	    if (pos >= buf.length) throw new Error('truncated varint');
    15	    const b = buf[pos++];
    16	    result += (b & 0x7f) * 2 ** shift; // avoid 32-bit overflow of <<
    17	    if ((b & 0x80) === 0) return [result, pos];
    18	    shift += 7;
    19	  }
    20	}
    21	
    22	export function decodeFields(buf: Uint8Array): Field[] {
    23	  const out: Field[] = [];
    24	  let pos = 0;
    25	  while (pos < buf.length) {
    26	    let key: number;
    27	    [key, pos] = readVarint(buf, pos);
    28	    const num = Math.floor(key / 8);
    29	    const wire = key & 7;
    30	    if (wire === 0) {
    31	      let v: number;
    32	      [v, pos] = readVarint(buf, pos);
    33	      out.push({ num, wire, value: v });
    34	    } else if (wire === 2) {
    35	      let len: number;
    36	      [len, pos] = readVarint(buf, pos);
    37	      if (pos + len > buf.length) throw new Error('truncated field');
    38	      out.push({ num, wire, value: buf.subarray(pos, pos + len) });
    39	      pos += len;
    40	    } else if (wire === 1) {
    41	      pos += 8;
    42	    } else if (wire === 5) {
    43	      pos += 4;
    44	    } else {
    45	      throw new Error(`unsupported wire type ${wire}`);
    46	    }
    47	  }
    48	  return out;
    49	}
    50	
    51	const text = new TextDecoder();
    52	const str = (v: Field['value'] | string) => (v instanceof Uint8Array ? text.decode(v) : String(v));
    53	
    54	function levels(fields: Field[], num: number): [number, number][] {
    55	  return fields
    56	    .filter((f) => f.num === num && f.value instanceof Uint8Array)
    57	    .map((f) => {
    58	      const lv = decodeFields(f.value as Uint8Array);
    59	      const price = Number(str(lv.find((x) => x.num === 1)?.value ?? '0'));
    60	      const qty = Number(str(lv.find((x) => x.num === 2)?.value ?? '0'));
    61	      return [price, qty] as [number, number];
    62	    });
    63	}
    64	
    65	export interface DepthPush {
    66	  channel: string;
    67	  symbol: string;
    68	  asks: [number, number][];
    69	  bids: [number, number][];
    70	}
    71	
    72	/** Decode a limit-depth push; returns null for other message types. */
    73	export function decodeDepthPush(buf: Uint8Array): DepthPush | null {
    74	  const top = decodeFields(buf);
    75	  const depth = top.find((f) => f.num === 303 && f.value instanceof Uint8Array);
    76	  if (!depth) return null;
    77	  const inner = decodeFields(depth.value as Uint8Array);
    78	  return {
    79	    channel: str(top.find((f) => f.num === 1)?.value ?? ''),
    80	    symbol: str(top.find((f) => f.num === 3)?.value ?? ''),
    81	    asks: levels(inner, 1).sort((a, b) => a[0] - b[0]),
    82	    bids: levels(inner, 2).sort((a, b) => b[0] - a[0]),
    83	  };
    84	}
```

## `src/mexc/rest.ts`

```ts
     1	// MEXC Spot API v3 REST client. https://mexcdevelop.github.io/apidocs/spot_v3_en/
     2	import crypto from 'node:crypto';
     3	import { redact } from '../log.js';
     4	
     5	export type Side = 'BUY' | 'SELL';
     6	export type Level = [price: number, qty: number];
     7	export interface Book {
     8	  bids: Level[];
     9	  asks: Level[];
    10	  ts: number;
    11	}
    12	export interface SymbolInfo {
    13	  symbol: string;
    14	  baseAsset: string;
    15	  quoteAsset: string;
    16	  status: string;
    17	  isSpotTradingAllowed: boolean;
    18	  baseSizePrecision: string; // quantity step, e.g. "0.01" ("0" = use baseAssetPrecision)
    19	  baseAssetPrecision?: number;
    20	  quotePrecision: number;
    21	  orderTypes: string[];
    22	  quoteAmountPrecision?: string; // minimum order value (USDT)
    23	  maxQuoteAmount?: string;
    24	  quoteAmountPrecisionMarket?: string;
    25	  maxQuoteAmountMarket?: string;
    26	  filters?: { filterType: string; bidMultiplierUp?: string; askMultiplierDown?: string }[];
    27	  tradeSideType?: number; // 1 all, 2 buy only, 3 sell only, 4 close only
    28	}
    29	export interface CoinNetwork {
    30	  coin: string;
    31	  network: string;
    32	  netWork?: string;
    33	  contract?: string;
    34	  depositEnable: boolean;
    35	  withdrawEnable: boolean;
    36	  withdrawFee?: string; // in the coin itself
    37	  withdrawMin?: string;
    38	  withdrawMax?: string;
    39	}
    40	export interface CoinConfig {
    41	  coin: string;
    42	  networkList: CoinNetwork[];
    43	}
    44	export interface Order {
    45	  orderId: string;
    46	  status: string; // NEW, FILLED, PARTIALLY_FILLED, CANCELED, PARTIALLY_CANCELED
    47	  executedQty: string;
    48	  cummulativeQuoteQty: string;
    49	  origQty: string;
    50	  price: string;
    51	  side: Side;
    52	}
    53	
    54	type FetchFn = typeof fetch;
    55	
    56	/** HTTP 429/418 from any API: callers back off instead of hammering. */
    57	export class RateLimitError extends Error {}
    58	
    59	/**
    60	 * The request may or may not have reached MEXC (timeout / connection reset on a POST).
    61	 * Never assume "not placed": look the order / withdrawal up by our own client id.
    62	 */
    63	export class AmbiguousRequestError extends Error {}
    64	
    65	/** MEXC answered with an error body; `code` is MEXC's error code when present (e.g. -2011 "Unknown order sent"). */
    66	export class MexcApiError extends Error {
    67	  constructor(msg: string, readonly status: number, readonly code?: number) {
    68	    super(msg);
    69	  }
    70	}
    71	
    72	export interface WithdrawRecord {
    73	  id: string;
    74	  status: number;
    75	  amount: string;
    76	  /** Fee MEXC actually charged (withdraw history `transactionFee`). */
    77	  transactionFee?: string;
    78	  txId?: string;
    79	  withdrawOrderId?: string;
    80	}
    81	
    82	export class MexcRest {
    83	  /** serverTime - localTime, so signed timestamps stay inside recvWindow even if the VPS clock drifts. */
    84	  timeOffsetMs = 0;
    85	
    86	  constructor(
    87	    private apiKey = '',
    88	    private apiSecret = '',
    89	    private baseUrl = 'https://api.mexc.com',
    90	    private fetchFn: FetchFn = fetch,
    91	  ) {}
    92	
    93	  sign(query: string): string {
    94	    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
    95	  }
    96	
    97	  async request<T>(method: string, path: string, params: Record<string, string | number> = {}, signed = false): Promise<T> {
    98	    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    99	    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
   100	    if (signed) {
   101	      if (!this.apiKey || !this.apiSecret) throw new Error('MEXC API key/secret not configured');
   102	      qs.set('timestamp', String(Date.now() + this.timeOffsetMs));
   103	      qs.set('recvWindow', '5000');
   104	      qs.set('signature', this.sign(qs.toString()));
   105	      headers['X-MEXC-APIKEY'] = this.apiKey;
   106	    }
   107	    const q = qs.toString();
   108	    let res: Response;
   109	    let text: string;
   110	    try {
   111	      res = await this.fetchFn(`${this.baseUrl}${path}${q ? `?${q}` : ''}`, {
   112	        method,
   113	        headers,
   114	        signal: AbortSignal.timeout(10_000),
   115	      });
   116	      text = await res.text();
   117	    } catch (e) {
   118	      const msg = redact(`MEXC ${method} ${path}: ${(e as Error).message}`);
   119	      // A write that timed out may still have been executed by MEXC.
   120	      if (method !== 'GET') throw new AmbiguousRequestError(msg);
   121	      throw new Error(msg);
   122	    }
   123	    let body: unknown;
   124	    try {
   125	      body = JSON.parse(text);
   126	    } catch {
   127	      body = text;
   128	    }
   129	    const err = redact(`MEXC ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
   130	    if (res.status === 429 || res.status === 418) throw new RateLimitError(err);
   131	    if (res.status >= 500 && method !== 'GET') throw new AmbiguousRequestError(err);
   132	    if (!res.ok) {
   133	      const code = body && typeof body === 'object' && 'code' in body ? Number((body as { code: unknown }).code) : undefined;
   134	      throw new MexcApiError(err, res.status, Number.isFinite(code) ? code : undefined);
   135	    }
   136	    return body as T;
   137	  }
   138	
   139	  /** Measure clock skew against MEXC; returns the offset in ms. */
   140	  async syncTime(): Promise<number> {
   141	    const t0 = Date.now();
   142	    const r = await this.request<{ serverTime: number }>('GET', '/api/v3/time');
   143	    const t1 = Date.now();
   144	    this.timeOffsetMs = Math.round(r.serverTime - (t0 + t1) / 2);
   145	    return this.timeOffsetMs;
   146	  }
   147	
   148	  async depth(symbol: string, limit = 20): Promise<Book> {
   149	    const d = await this.request<{ bids: [string, string][]; asks: [string, string][] }>('GET', '/api/v3/depth', { symbol, limit });
   150	    const conv = (l: [string, string][]): Level[] => l.map(([p, q]) => [Number(p), Number(q)]);
   151	    return { bids: conv(d.bids), asks: conv(d.asks), ts: Date.now() };
   152	  }
   153	
   154	  async exchangeInfo(): Promise<SymbolInfo[]> {
   155	    const r = await this.request<{ symbols: SymbolInfo[] }>('GET', '/api/v3/exchangeInfo');
   156	    return r.symbols;
   157	  }
   158	
   159	  async tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]> {
   160	    return this.request('GET', '/api/v3/ticker/24hr');
   161	  }
   162	
   163	  async price(symbol: string): Promise<number> {
   164	    const r = await this.request<{ price: string }>('GET', '/api/v3/ticker/price', { symbol });
   165	    return Number(r.price);
   166	  }
   167	
   168	  /** Deposit/withdraw status and contract address per network (signed). */
   169	  async coinConfigs(): Promise<CoinConfig[]> {
   170	    return this.request('GET', '/api/v3/capital/config/getall', {}, true);
   171	  }
   172	
   173	  async account(): Promise<{ canTrade: boolean; balances: { asset: string; free: string; locked: string }[] }> {
   174	    return this.request('GET', '/api/v3/account', {}, true);
   175	  }
   176	
   177	  /** Free balances (what can be traded now); includeLocked adds funds held in open orders. */
   178	  async balances(includeLocked = false): Promise<Record<string, number>> {
   179	    const a = await this.account();
   180	    return Object.fromEntries(a.balances.map((b) => [b.asset, Number(b.free) + (includeLocked ? Number(b.locked) : 0)]));
   181	  }
   182	
   183	  /** Best bid/ask for every symbol in one call. */
   184	  async bookTickers(): Promise<Map<string, { bid: number; ask: number }>> {
   185	    const r = await this.request<{ symbol: string; bidPrice: string; askPrice: string }[]>('GET', '/api/v3/ticker/bookTicker');
   186	    return new Map(r.map((t) => [t.symbol, { bid: Number(t.bidPrice), ask: Number(t.askPrice) }]));
   187	  }
   188	
   189	  /** Withdraw (new endpoint). Requires an API key with withdraw permission. Returns the withdraw id. */
   190	  async withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string> {
   191	    const params: Record<string, string> = { coin: p.coin, netWork: p.netWork, address: p.address, amount: p.amount };
   192	    if (p.contractAddress) params.contractAddress = p.contractAddress;
   193	    if (p.withdrawOrderId) params.withdrawOrderId = p.withdrawOrderId;
   194	    const r = await this.request<{ id: string }>('POST', '/api/v3/capital/withdraw', params, true);
   195	    return r.id;
   196	  }
   197	
   198	  /** Recent withdrawals of a coin (status: 1 APPLY .. 6 WAIT_CONFIRM, 7 SUCCESS, 8 FAILED, 9 CANCEL, 10 MANUAL). */
   199	  async withdrawHistory(coin: string, sinceTs: number): Promise<WithdrawRecord[]> {
   200	    const r = await this.request<{ id: string; status: number | string; amount: string; transactionFee?: string; txId?: string; withdrawOrderId?: string }[]>(
   201	      'GET',
   202	      '/api/v3/capital/withdraw/history',
   203	      { coin, startTime: Math.max(0, Math.floor(sinceTs)), limit: 1000 },
   204	      true,
   205	    );
   206	    return r.map((w) => ({ id: w.id, status: Number(w.status), amount: w.amount, transactionFee: w.transactionFee, txId: w.txId, withdrawOrderId: w.withdrawOrderId }));
   207	  }
   208	
   209	  /** Find a withdrawal by MEXC id or by our own withdrawOrderId. null = not in history. */
   210	  async findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null> {
   211	    const h = await this.withdrawHistory(coin, sinceTs);
   212	    return h.find((w) => (ref.id && w.id === ref.id) || (ref.withdrawOrderId && w.withdrawOrderId === ref.withdrawOrderId)) ?? null;
   213	  }
   214	
   215	  /** `clientOrderId` makes the order findable even if this request times out. */
   216	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }> {
   217	    const p: Record<string, string> = { symbol, side, type: 'LIMIT', quantity, price };
   218	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   219	    return this.request('POST', '/api/v3/order', p, true);
   220	  }
   221	
   222	  /** Look an order up by our own client id; null if MEXC has no such order. */
   223	  async getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null> {
   224	    try {
   225	      return await this.request<Order>('GET', '/api/v3/order', { symbol, origClientOrderId: clientOrderId }, true);
   226	    } catch (e) {
   227	      // MEXC documents -2011 "Unknown order sent". Prefer the parsed code; the text match is a fallback
   228	      // because MEXC does not document its error body shape. Anything else is a real error (caller retries).
   229	      if (e instanceof MexcApiError && e.code === -2011) return null;
   230	      if (/-2011|unknown order/i.test((e as Error).message)) return null;
   231	      throw e;
   232	    }
   233	  }
   234	
   235	  /** MARKET SELL by base quantity (documented). For buys use an aggressive LIMIT instead. */
   236	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }> {
   237	    const p: Record<string, string> = { symbol, side: 'SELL', type: 'MARKET', quantity };
   238	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   239	    return this.request('POST', '/api/v3/order', p, true);
   240	  }
   241	
   242	  getOrder(symbol: string, orderId: string): Promise<Order> {
   243	    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
   244	  }
   245	
   246	  cancelOrder(symbol: string, orderId: string): Promise<Order> {
   247	    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
   248	  }
   249	}
```

## `src/mexc/rules.ts`

```ts
     1	// MEXC symbol trading rules, taken from GET /api/v3/exchangeInfo, checked BEFORE either leg is sent.
     2	// Field meanings (verified against live exchangeInfo, e.g. ETHUSDT: baseAssetPrecision 5, baseSizePrecision "0.0001"):
     3	//   baseAssetPrecision   -> quantity decimals (step = 10^-n)
     4	//   baseSizePrecision    -> MINIMUM order quantity ("0" = none)
     5	//   quotePrecision       -> price decimals
     6	//   quoteAmountPrecision -> minimum order value in USDT
     7	//   maxQuoteAmount       -> maximum order value in USDT
     8	//   orderTypes           -> allowed types. The docs define IMMEDIATE_OR_CANCEL / FILL_OR_KILL as order types
     9	//                           (there is no timeInForce parameter), but no live symbol lists them, and some
    10	//                           have no MARKET. So closes use LIMIT + a confirmed cancel.
    11	//   tradeSideType        -> 1 all, 2 buy only, 3 sell only, 4 close only
    12	//   filters PERCENT_PRICE_BY_SIDE -> price band (live exchangeInfo only, not in the docs; 0.02 .. 0.5)
    13	import type { Side, SymbolInfo } from './rest.js';
    14	
    15	export interface SymbolRules {
    16	  qtyStep: number;
    17	  priceDecimals: number;
    18	  minQty: number;
    19	  minNotional: number;
    20	  maxNotional: number;
    21	  orderTypes: string[];
    22	  tradeSideType: number;
    23	  minNotionalMarket?: number;
    24	  maxNotionalMarket?: number;
    25	  /**
    26	   * PERCENT_PRICE_BY_SIDE band (live exchangeInfo, not in the docs): a limit price more than this fraction
    27	   * away from the market is rejected. Most symbols 0.2, some only 0.02.
    28	   */
    29	  priceBand?: number;
    30	}
    31	
    32	/** How far through the book an aggressive close may go: 2%, but stay well inside the symbol's price band. */
    33	export function aggressiveOffset(r: SymbolRules): number {
    34	  return r.priceBand ? Math.min(0.02, r.priceBand * 0.5) : 0.02;
    35	}
    36	
    37	export function rulesFrom(s: SymbolInfo): SymbolRules {
    38	  const qtyDecimals = s.baseAssetPrecision ?? Math.max(0, Math.round(-Math.log10(Number(s.baseSizePrecision) || 1)));
    39	  return {
    40	    qtyStep: 1 / 10 ** qtyDecimals, // exact (10 ** -5 is 0.000009999…)
    41	    priceDecimals: s.quotePrecision,
    42	    minQty: Number(s.baseSizePrecision) || 0,
    43	    minNotional: Number(s.quoteAmountPrecision) || 0,
    44	    maxNotional: Number(s.maxQuoteAmount) || Number.POSITIVE_INFINITY,
    45	    orderTypes: s.orderTypes ?? ['LIMIT'],
    46	    tradeSideType: Number(s.tradeSideType ?? 1),
    47	    minNotionalMarket: s.quoteAmountPrecisionMarket !== undefined ? Number(s.quoteAmountPrecisionMarket) : undefined,
    48	    maxNotionalMarket: s.maxQuoteAmountMarket !== undefined ? Number(s.maxQuoteAmountMarket) : undefined,
    49	    priceBand: band(s),
    50	  };
    51	}
    52	
    53	function band(s: SymbolInfo): number | undefined {
    54	  const f = s.filters?.find((x) => x.filterType === 'PERCENT_PRICE_BY_SIDE');
    55	  if (!f) return undefined;
    56	  const v = [Number(f.bidMultiplierUp), Number(f.askMultiplierDown)].filter((x) => Number.isFinite(x) && x > 0);
    57	  return v.length ? Math.min(...v) : undefined;
    58	}
    59	
    60	/** null = the order is allowed; otherwise why MEXC would reject it. */
    61	export function orderProblem(r: SymbolRules, side: Side, qty: number, price: number, type = 'LIMIT'): string | null {
    62	  if (!r.orderTypes.includes(type)) return `order type ${type} not allowed (${r.orderTypes.join(',')})`;
    63	  if (r.tradeSideType === 4) return 'symbol is close-only';
    64	  if (r.tradeSideType === 2 && side === 'SELL') return 'symbol is buy-only';
    65	  if (r.tradeSideType === 3 && side === 'BUY') return 'symbol is sell-only';
    66	  if (!(qty > 0)) return 'quantity is zero';
    67	  if (qty < r.minQty) return `quantity ${qty} < minimum ${r.minQty}`;
    68	  const notional = qty * price;
    69	  // MARKET orders have their own limits in exchangeInfo.
    70	  const min = type === 'MARKET' ? (r.minNotionalMarket ?? r.minNotional) : r.minNotional;
    71	  const max = type === 'MARKET' ? (r.maxNotionalMarket ?? r.maxNotional) : r.maxNotional;
    72	  if (notional < min) return `order value ${notional.toFixed(4)} < minimum ${min} USDT`;
    73	  if (notional > max) return `order value ${notional.toFixed(2)} > maximum ${max} USDT`;
    74	  return null;
    75	}
```

## `src/mexc/ws.ts`

```ts
     1	// MEXC public WebSocket: keeps a live top-20 order book per symbol.
     2	import WebSocket from 'ws';
     3	import { decodeDepthPush } from './proto.js';
     4	import type { Book } from './rest.js';
     5	import { log, errMsg } from '../log.js';
     6	
     7	const URL = 'wss://wbs-api.mexc.com/ws';
     8	const MAX_SUBS_PER_CONN = 30; // MEXC limit per connection
     9	
    10	export class MexcBookStream {
    11	  private books = new Map<string, Book>();
    12	  private sockets: WebSocket[] = [];
    13	  private stopped = false;
    14	
    15	  constructor(private symbols: string[]) {}
    16	
    17	  start(): void {
    18	    for (let i = 0; i < this.symbols.length; i += MAX_SUBS_PER_CONN) {
    19	      this.connect(this.symbols.slice(i, i + MAX_SUBS_PER_CONN), 0);
    20	    }
    21	  }
    22	
    23	  stop(): void {
    24	    this.stopped = true;
    25	    for (const s of this.sockets) s.terminate();
    26	  }
    27	
    28	  /** Latest book, or undefined if missing / older than maxAgeMs. */
    29	  get(symbol: string, maxAgeMs = 5000): Book | undefined {
    30	    const b = this.books.get(symbol);
    31	    return b && Date.now() - b.ts <= maxAgeMs ? b : undefined;
    32	  }
    33	
    34	  private connect(symbols: string[], attempt: number): void {
    35	    if (this.stopped) return;
    36	    const ws = new WebSocket(URL);
    37	    this.sockets.push(ws);
    38	    let ping: NodeJS.Timeout | undefined;
    39	    let lastData = Date.now();
    40	    // MEXC drops idle subscriptions; if no data arrives for 60s, reconnect.
    41	    const watchdog = setInterval(() => {
    42	      if (Date.now() - lastData > 60_000) {
    43	        log.warn(`MEXC WS: no data for 60s on ${symbols.length} symbols, reconnecting`);
    44	        ws.terminate();
    45	      }
    46	    }, 15_000);
    47	
    48	    ws.on('open', () => {
    49	      lastData = Date.now();
    50	      const params = symbols.map((s) => `spot@public.limit.depth.v3.api.pb@${s}@20`);
    51	      ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params }));
    52	      ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ method: 'PING' })), 20_000);
    53	      log.info(`MEXC WS subscribed: ${symbols.join(',')}`);
    54	    });
    55	
    56	    ws.on('message', (data: Buffer, isBinary: boolean) => {
    57	      if (!isBinary) {
    58	        const msg = data.toString();
    59	        if (msg.includes('Blocked') || msg.includes('Not Subscribed')) log.warn(`MEXC WS: ${msg}`);
    60	        return;
    61	      }
    62	      lastData = Date.now();
    63	      attempt = 0; // reset backoff only once data really flows (a bad subscription closes right after open)
    64	      try {
    65	        const push = decodeDepthPush(data);
    66	        // Sanity check: ignore empty or crossed books instead of trading on them.
    67	        if (push && push.symbol && push.bids.length && push.asks.length && push.bids[0][0] < push.asks[0][0]) {
    68	          this.books.set(push.symbol, { bids: push.bids, asks: push.asks, ts: Date.now() });
    69	        }
    70	      } catch (e) {
    71	        log.warn(`MEXC WS decode error: ${errMsg(e)}`);
    72	      }
    73	    });
    74	
    75	    const reconnect = () => {
    76	      if (ping) clearInterval(ping);
    77	      clearInterval(watchdog);
    78	      this.sockets = this.sockets.filter((s) => s !== ws);
    79	      if (this.stopped) return;
    80	      const delay = Math.min(30_000, 1000 * 2 ** attempt);
    81	      log.warn(`MEXC WS closed, reconnecting in ${delay}ms`);
    82	      setTimeout(() => this.connect(symbols, attempt + 1), delay);
    83	    };
    84	    ws.on('close', reconnect);
    85	    ws.on('error', (e) => {
    86	      log.warn(`MEXC WS error: ${errMsg(e)}`);
    87	      ws.terminate();
    88	    });
    89	  }
    90	}
```

## `src/dex/aggregator.ts`

```ts
     1	// DEX quotes from 0x (Swap API v2, AllowanceHolder) or 1inch (Swap API v6).
     2	// Both route across Uniswap v2/v3 and other Ethereum DEXs; DEX fees are already in buyAmount.
     3	import { log, redact } from '../log.js';
     4	
     5	export interface QuoteRequest {
     6	  sellToken: string;
     7	  buyToken: string;
     8	  sellAmount: bigint;
     9	  taker: string;
    10	  slippageBps: number;
    11	}
    12	export interface Quote {
    13	  buyAmount: bigint; // expected output
    14	  minBuyAmount: bigint; // output floor enforced on-chain
    15	  gas: bigint; // estimated gas units
    16	  spender: string; // address that needs an ERC20 allowance on sellToken
    17	  tx?: { to: string; data: string; value: bigint }; // only for firm quotes
    18	}
    19	
    20	export interface Aggregator {
    21	  name: string;
    22	  /** Indicative price, cheap; no transaction. */
    23	  price(req: QuoteRequest): Promise<Quote>;
    24	  /** Firm quote with calldata ready to sign. */
    25	  quote(req: QuoteRequest): Promise<Quote>;
    26	}
    27	
    28	type FetchFn = typeof fetch;
    29	
    30	// Allowlist: we only ever approve / send to these contracts (Ethereum mainnet).
    31	// A wrong or compromised API response pointing anywhere else is rejected.
    32	export const ZEROX_ALLOWANCE_HOLDER = '0x0000000000001ff3684f28c67538d4d072c22734';
    33	export const ONEINCH_ROUTER_V6 = '0x111111125421ca6dc452d289314280a0f8842a65';
    34	
    35	function requireAddress(kind: string, got: string | undefined, allowed: string): string {
    36	  if (!got || got.toLowerCase() !== allowed) throw new Error(`${kind} ${got} is not the allowlisted contract ${allowed}`);
    37	  return allowed;
    38	}
    39	
    40	async function getJson<T>(fetchFn: FetchFn, url: string, headers: Record<string, string>): Promise<T> {
    41	  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(8000) });
    42	  const text = await res.text();
    43	  if (!res.ok) throw new Error(redact(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`));
    44	  return JSON.parse(text) as T;
    45	}
    46	
    47	interface ZeroExResponse {
    48	  liquidityAvailable: boolean;
    49	  buyAmount: string;
    50	  minBuyAmount: string;
    51	  gas?: string | null;
    52	  allowanceTarget?: string | null;
    53	  fees?: { zeroExFee?: { amount: string; token: string } | null } | null;
    54	  issues?: { allowance?: { spender: string } | null; balance?: unknown; simulationIncomplete?: boolean };
    55	  transaction?: { to: string; data: string; gas: string; value: string };
    56	}
    57	
    58	export class ZeroEx implements Aggregator {
    59	  name = '0x';
    60	  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, private chainId = 1) {
    61	    if (!apiKey) throw new Error('ZEROX_API_KEY is required for DEX_AGGREGATOR=0x');
    62	  }
    63	
    64	  private url(kind: 'price' | 'quote', r: QuoteRequest): string {
    65	    const q = new URLSearchParams({
    66	      chainId: String(this.chainId),
    67	      sellToken: r.sellToken,
    68	      buyToken: r.buyToken,
    69	      sellAmount: r.sellAmount.toString(),
    70	      taker: r.taker,
    71	      slippagePpm: String(r.slippageBps * 100), // slippageBps is deprecated in v2
    72	    });
    73	    return `https://api.0x.org/swap/allowance-holder/${kind}?${q}`;
    74	  }
    75	
    76	  private async call(kind: 'price' | 'quote', r: QuoteRequest): Promise<Quote> {
    77	    const d = await getJson<ZeroExResponse>(this.fetchFn, this.url(kind, r), { '0x-api-key': this.apiKey, '0x-version': 'v2' });
    78	    if (!d.liquidityAvailable) throw new Error('0x: no liquidity');
    79	    if (kind === 'quote') {
    80	      // A firm quote we would actually send: refuse if 0x itself could not validate it.
    81	      if (d.issues?.balance) throw new Error('0x: taker balance too low for this quote');
    82	      if (d.issues?.simulationIncomplete) throw new Error('0x: simulation incomplete');
    83	      if (d.fees?.zeroExFee) log.info(`0x fee: ${d.fees.zeroExFee.amount} of ${d.fees.zeroExFee.token}`);
    84	    }
    85	    const gas = BigInt(d.transaction?.gas ?? d.gas ?? '300000');
    86	    // With the AllowanceHolder flow, both the spender and tx.to are the AllowanceHolder contract.
    87	    // Never transaction.to for allowances (0x docs): issues.allowance.spender or allowanceTarget, pinned.
    88	    const spender = requireAddress(
    89	      '0x spender',
    90	      d.issues?.allowance?.spender ?? d.allowanceTarget ?? ZEROX_ALLOWANCE_HOLDER,
    91	      ZEROX_ALLOWANCE_HOLDER,
    92	    );
    93	    if (d.transaction) requireAddress('0x tx.to', d.transaction.to, ZEROX_ALLOWANCE_HOLDER);
    94	    return {
    95	      buyAmount: BigInt(d.buyAmount),
    96	      minBuyAmount: BigInt(d.minBuyAmount),
    97	      gas,
    98	      spender,
    99	      tx: d.transaction ? { to: d.transaction.to, data: d.transaction.data, value: BigInt(d.transaction.value || '0') } : undefined,
   100	    };
   101	  }
   102	
   103	  price(r: QuoteRequest) {
   104	    return this.call('price', r);
   105	  }
   106	  quote(r: QuoteRequest) {
   107	    return this.call('quote', r);
   108	  }
   109	}
   110	
   111	export class OneInch implements Aggregator {
   112	  name = '1inch';
   113	  private spender?: string;
   114	  private base: string;
   115	  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, chainId = 1) {
   116	    if (!apiKey) throw new Error('ONEINCH_API_KEY is required for DEX_AGGREGATOR=1inch');
   117	    this.base = `https://api.1inch.dev/swap/v6.0/${chainId}`;
   118	  }
   119	  private get headers() {
   120	    return { Authorization: `Bearer ${this.apiKey}`, accept: 'application/json' };
   121	  }
   122	  private async getSpender(): Promise<string> {
   123	    if (!this.spender) {
   124	      const a = (await getJson<{ address: string }>(this.fetchFn, `${this.base}/approve/spender`, this.headers)).address;
   125	      this.spender = requireAddress('1inch spender', a, ONEINCH_ROUTER_V6);
   126	      setTimeout(() => (this.spender = undefined), 24 * 3600_000).unref?.(); // re-check daily
   127	    }
   128	    return this.spender;
   129	  }
   130	  private minOut(amount: bigint, bps: number) {
   131	    return (amount * BigInt(10_000 - bps)) / 10_000n;
   132	  }
   133	
   134	  async price(r: QuoteRequest): Promise<Quote> {
   135	    const q = new URLSearchParams({ src: r.sellToken, dst: r.buyToken, amount: r.sellAmount.toString(), includeGas: 'true' });
   136	    const d = await getJson<{ dstAmount: string; gas?: number }>(this.fetchFn, `${this.base}/quote?${q}`, this.headers);
   137	    const buy = BigInt(d.dstAmount);
   138	    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.gas ?? 300_000), spender: await this.getSpender() };
   139	  }
   140	
   141	  async quote(r: QuoteRequest): Promise<Quote> {
   142	    const q = new URLSearchParams({
   143	      src: r.sellToken,
   144	      dst: r.buyToken,
   145	      amount: r.sellAmount.toString(),
   146	      from: r.taker,
   147	      origin: r.taker,
   148	      slippage: String(r.slippageBps / 100), // percent
   149	      disableEstimate: 'true', // we simulate ourselves with eth_call
   150	      includeGas: 'true',
   151	    });
   152	    const d = await getJson<{ dstAmount: string; tx: { to: string; data: string; value: string; gas: number } }>(
   153	      this.fetchFn,
   154	      `${this.base}/swap?${q}`,
   155	      this.headers,
   156	    );
   157	    const buy = BigInt(d.dstAmount);
   158	    requireAddress('1inch tx.to', d.tx.to, ONEINCH_ROUTER_V6);
   159	    return {
   160	      buyAmount: buy,
   161	      minBuyAmount: this.minOut(buy, r.slippageBps),
   162	      gas: BigInt(d.tx.gas || 300_000),
   163	      spender: await this.getSpender(),
   164	      tx: { to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value || '0') },
   165	    };
   166	  }
   167	}
```

## `src/dex/chain.ts`

```ts
     1	// Ethereum side: balances, gas, exact approvals, simulation and private sending.
     2	import { ethers } from 'ethers';
     3	import { log, errMsg } from '../log.js';
     4	import { sleep } from '../util.js';
     5	
     6	const ERC20_ABI = [
     7	  'function decimals() view returns (uint8)',
     8	  'function symbol() view returns (string)',
     9	  'function balanceOf(address) view returns (uint256)',
    10	  'function allowance(address,address) view returns (uint256)',
    11	  'function approve(address,uint256) returns (bool)',
    12	];
    13	const APPROVE_GAS = 60_000n;
    14	
    15	export type { GasInfo, TxResult } from './txsender.js';
    16	import { type GasInfo, type KeyValue, type TxResult, TxSender } from './txsender.js';
    17	
    18	export class Chain {
    19	  readonly provider: ethers.JsonRpcProvider;
    20	  readonly sendProvider: ethers.JsonRpcProvider;
    21	  readonly wallet?: ethers.Wallet;
    22	  private decimalsCache = new Map<string, number>();
    23	
    24	  readonly tx: TxSender;
    25	
    26	  /** `unresolvedStore` persists the unresolved-tx record (SQLite state) so a restart does not forget it. */
    27	  constructor(rpcUrl: string, sendRpcUrl: string, privateKey: string, private priorityFeeGwei: number, unresolvedStore?: KeyValue) {
    28	    this.provider = new ethers.JsonRpcProvider(rpcUrl, 1, { staticNetwork: true });
    29	    this.sendProvider = new ethers.JsonRpcProvider(sendRpcUrl, 1, { staticNetwork: true });
    30	    if (privateKey) this.wallet = new ethers.Wallet(privateKey, this.provider);
    31	    const chain = this; // eslint-disable-line @typescript-eslint/no-this-alias
    32	    this.tx = new TxSender(
    33	      {
    34	        get address() {
    35	          return chain.address;
    36	        },
    37	        confirmedNonce: () => this.provider.getTransactionCount(this.address, 'latest'),
    38	        receipt: (h) => this.provider.getTransactionReceipt(h),
    39	        knowsTx: async (h) => Boolean((await this.provider.getTransaction(h).catch(() => null)) ?? (await this.sendProvider.getTransaction(h).catch(() => null))),
    40	        sign: async (t) => {
    41	          const raw = await this.wallet!.signTransaction({ chainId: 1n, type: 2, ...t });
    42	          return { raw, hash: ethers.keccak256(raw) };
    43	        },
    44	        broadcast: async (raw) => {
    45	          await this.sendProvider.send('eth_sendRawTransaction', [raw]);
    46	        },
    47	        gas: () => this.gas(),
    48	      },
    49	      unresolvedStore,
    50	    );
    51	  }
    52	
    53	  get unresolved() {
    54	    return this.tx.unresolved;
    55	  }
    56	  checkUnresolved() {
    57	    return this.tx.checkUnresolved();
    58	  }
    59	  receipt(hash: string) {
    60	    return this.provider.getTransactionReceipt(hash);
    61	  }
    62	  send(
    63	    tx: { to: string; data: string; value?: bigint },
    64	    gasLimit: bigint,
    65	    gas: GasInfo,
    66	    timeoutSec: number,
    67	    onSigned?: (hash: string, nonce: number) => void,
    68	  ): Promise<TxResult> {
    69	    return this.tx.send(tx, gasLimit, gas, timeoutSec, onSigned);
    70	  }
    71	
    72	  get address(): string {
    73	    if (!this.wallet) throw new Error('PRIVATE_KEY not set');
    74	    return this.wallet.address;
    75	  }
    76	
    77	  erc20(token: string) {
    78	    return new ethers.Contract(token, ERC20_ABI, this.wallet ?? this.provider);
    79	  }
    80	
    81	  async decimals(token: string): Promise<number> {
    82	    const key = token.toLowerCase();
    83	    if (!this.decimalsCache.has(key)) this.decimalsCache.set(key, Number(await this.erc20(token).decimals()));
    84	    return this.decimalsCache.get(key)!;
    85	  }
    86	
    87	  async tokenBalance(token: string, owner = this.address): Promise<bigint> {
    88	    return this.erc20(token).balanceOf(owner);
    89	  }
    90	
    91	  async ethBalance(owner = this.address): Promise<bigint> {
    92	    return this.provider.getBalance(owner);
    93	  }
    94	
    95	  async gas(): Promise<GasInfo> {
    96	    const block = await this.provider.getBlock('latest');
    97	    const baseFee = block?.baseFeePerGas ?? 0n;
    98	    const tip = ethers.parseUnits(String(this.priorityFeeGwei), 'gwei');
    99	    return { baseFee, tip, effective: baseFee + tip, maxFee: baseFee * 2n + tip };
   100	  }
   101	
   102	  /** Gas units needed for an approval before the swap (0 if allowance already covers it). */
   103	  async approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint> {
   104	    if (!this.wallet) return 0n;
   105	    const allowance: bigint = await this.erc20(token).allowance(this.address, spender);
   106	    if (allowance >= amount) return 0n;
   107	    return allowance > 0n ? APPROVE_GAS * 2n : APPROVE_GAS; // USDT-style tokens need approve(0) first
   108	  }
   109	
   110	  /** Approve exactly `amount` (never unlimited). Sent through the private RPC. */
   111	  async approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult> {
   112	    const c = this.erc20(token);
   113	    let cost = 0n;
   114	    const current: bigint = await c.allowance(this.address, spender);
   115	    if (current >= amount) return { ok: true, gasCostWei: 0n };
   116	    if (current > 0n) {
   117	      const data0 = c.interface.encodeFunctionData('approve', [spender, 0n]);
   118	      const r = await this.send({ to: token, data: data0 }, await this.approveGasLimit(token, data0), gas, 60);
   119	      cost += r.gasCostWei;
   120	      if (!r.ok) return { ...r, gasCostWei: cost };
   121	    }
   122	    const data = c.interface.encodeFunctionData('approve', [spender, amount]);
   123	    const r = await this.send({ to: token, data }, await this.approveGasLimit(token, data), gas, 60);
   124	    return { ...r, gasCostWei: cost + r.gasCostWei };
   125	  }
   126	
   127	  /** Some tokens need more than 60k gas for approve: estimate, +30%, never below 60k. */
   128	  private async approveGasLimit(token: string, data: string): Promise<bigint> {
   129	    try {
   130	      const est = await this.provider.estimateGas({ from: this.address, to: token, data });
   131	      const limit = (est * 13n) / 10n;
   132	      return limit > APPROVE_GAS ? limit : APPROVE_GAS;
   133	    } catch {
   134	      return APPROVE_GAS * 2n;
   135	    }
   136	  }
   137	
   138	  /** eth_call + estimateGas. Returns the gas estimate, or throws with the revert reason. */
   139	  async simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint> {
   140	    const req = { from: this.address, to: tx.to, data: tx.data, value: tx.value };
   141	    await this.provider.call(req);
   142	    return this.provider.estimateGas(req);
   143	  }
   144	}
```

## `src/dex/txsender.ts`

```ts
     1	// Transaction sending with a local nonce manager and persisted "unresolved" state.
     2	//
     3	// Our txs go through a PRIVATE RPC, so the public RPC's 'pending' count does not see them.
     4	// Rules:
     5	//  - Nonces are tracked locally, starting from the confirmed ('latest') count.
     6	//  - A tx whose outcome we do not know (broadcast error that may still have been accepted, or not mined
     7	//    and its cancel not mined either) is "unresolved". While one exists, no new tx is sent, so a nonce is
     8	//    never reused by accident. The unresolved record is PERSISTED, so a restart does not forget it.
     9	//  - A clear RPC rejection (insufficient funds, nonce too low, underpriced, any JSON-RPC error answer)
    10	//    is NOT unresolved: nothing was broadcast, the nonce is rolled back.
    11	//  - An unresolved tx that no RPC knows any more after DROP_AFTER_MS is treated as dropped.
    12	import { errMsg, log } from '../log.js';
    13	
    14	export interface GasInfo {
    15	  baseFee: bigint;
    16	  tip: bigint;
    17	  /** What we expect to actually pay per gas (baseFee + tip). */
    18	  effective: bigint;
    19	  /** maxFeePerGas to set on the tx (headroom for base fee rises). */
    20	  maxFee: bigint;
    21	}
    22	
    23	export interface TxResult {
    24	  ok: boolean;
    25	  hash?: string;
    26	  gasCostWei: bigint;
    27	  reason?: string;
    28	  /** We do NOT know whether it executed: never unwind or retry; pause for a human. */
    29	  unknown?: boolean;
    30	  /** The RPC clearly refused it: nothing was broadcast, nothing to wait for. */
    31	  rejected?: boolean;
    32	  /** Not even attempted, because an earlier tx is still unresolved. Not a failed attempt. */
    33	  refused?: boolean;
    34	}
    35	
    36	export interface Unresolved {
    37	  nonce: number;
    38	  hashes: string[];
    39	  since: number;
    40	}
    41	
    42	export interface TxBackend {
    43	  address: string;
    44	  confirmedNonce(): Promise<number>;
    45	  receipt(hash: string): Promise<{ status: number | null; gasUsed: bigint; gasPrice: bigint } | null>;
    46	  /** true if the public or the private RPC still knows this tx (pending or mined). */
    47	  knowsTx(hash: string): Promise<boolean>;
    48	  sign(tx: { nonce: number; to: string; data: string; value: bigint; gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }): Promise<{ raw: string; hash: string }>;
    49	  broadcast(raw: string): Promise<void>;
    50	  gas(): Promise<GasInfo>;
    51	}
    52	
    53	export interface KeyValue {
    54	  get(): string | undefined;
    55	  set(v: string | null): void;
    56	}
    57	
    58	export const DROP_AFTER_MS = 10 * 60_000;
    59	
    60	/** What a broadcast error means. */
    61	export function classifySendError(e: unknown): 'accepted' | 'rejected' | 'ambiguous' {
    62	  const o = (e ?? {}) as { code?: unknown; error?: { code?: unknown }; info?: { error?: { code?: unknown } } };
    63	  const msg = errMsg(e);
    64	  if (/already known|known transaction|already imported|already in mempool/i.test(msg)) return 'accepted';
    65	  if (['INSUFFICIENT_FUNDS', 'NONCE_EXPIRED', 'REPLACEMENT_UNDERPRICED'].includes(String(o.code))) return 'rejected';
    66	  if (/nonce too low|insufficient funds|underpriced|intrinsic gas too low|exceeds block gas limit|invalid sender|max fee per gas less than/i.test(msg)) {
    67	    return 'rejected';
    68	  }
    69	  // The server answered with a JSON-RPC error object: it explicitly refused the tx.
    70	  if (typeof o.error?.code === 'number' || typeof o.info?.error?.code === 'number') return 'rejected';
    71	  return 'ambiguous'; // timeout, connection reset, 5xx, no answer: it may have been accepted
    72	}
    73	
    74	export class TxSender {
    75	  private nextNonce: number | null = null;
    76	
    77	  constructor(
    78	    private b: TxBackend,
    79	    private store?: KeyValue,
    80	    private now: () => number = Date.now,
    81	    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    82	  ) {}
    83	
    84	  get unresolved(): Unresolved | null {
    85	    const v = this.store?.get() ?? this.mem;
    86	    return v ? (JSON.parse(v) as Unresolved) : null;
    87	  }
    88	  private mem: string | undefined;
    89	  private setUnresolved(u: Unresolved | null) {
    90	    const v = u ? JSON.stringify(u) : null;
    91	    if (this.store) this.store.set(v);
    92	    else this.mem = v ?? undefined;
    93	  }
    94	
    95	  private async takeNonce(): Promise<number> {
    96	    const confirmed = await this.b.confirmedNonce();
    97	    if (this.nextNonce === null || this.nextNonce < confirmed) this.nextNonce = confirmed;
    98	    return this.nextNonce;
    99	  }
   100	
   101	  /**
   102	   * Re-check an unresolved tx. 'clear' once its nonce is consumed on-chain (by it or its cancel),
   103	   * or once no RPC knows it any more after DROP_AFTER_MS (`dropped`). 'pending' otherwise.
   104	   */
   105	  async checkUnresolved(): Promise<{ state: 'clear' | 'pending'; executedHash?: string; ok?: boolean; dropped?: boolean }> {
   106	    const u = this.unresolved;
   107	    if (!u) return { state: 'clear' };
   108	    for (const h of u.hashes) {
   109	      const r = await this.b.receipt(h).catch(() => null);
   110	      if (r) {
   111	        this.setUnresolved(null);
   112	        this.nextNonce = Math.max(this.nextNonce ?? 0, u.nonce + 1);
   113	        return { state: 'clear', executedHash: h, ok: r.status === 1 };
   114	      }
   115	    }
   116	    const confirmed = await this.b.confirmedNonce().catch(() => -1);
   117	    if (confirmed > u.nonce) {
   118	      // Nonce consumed by something we have no receipt for yet (RPC lag).
   119	      this.setUnresolved(null);
   120	      this.nextNonce = Math.max(this.nextNonce ?? 0, confirmed);
   121	      return { state: 'clear' };
   122	    }
   123	    if (this.now() - u.since > DROP_AFTER_MS) {
   124	      const known = await Promise.all(u.hashes.map((h) => this.b.knowsTx(h).catch(() => true)));
   125	      if (!known.some(Boolean)) {
   126	        // Never accepted or dropped by every mempool: the nonce is free again.
   127	        this.setUnresolved(null);
   128	        this.nextNonce = null;
   129	        return { state: 'clear', dropped: true };
   130	      }
   131	    }
   132	    return { state: 'pending' };
   133	  }
   134	
   135	  /** Human override after checking the wallet by hand (/start confirm only does this if checkUnresolved agrees). */
   136	  forget(): void {
   137	    this.setUnresolved(null);
   138	    this.nextNonce = null;
   139	  }
   140	
   141	  async send(
   142	    tx: { to: string; data: string; value?: bigint },
   143	    gasLimit: bigint,
   144	    gas: GasInfo,
   145	    timeoutSec: number,
   146	    onSigned?: (hash: string, nonce: number) => void,
   147	  ): Promise<TxResult> {
   148	    if (this.unresolved && (await this.checkUnresolved()).state === 'pending') {
   149	      return { ok: false, refused: true, gasCostWei: 0n, reason: `earlier tx ${this.unresolved!.hashes[0]} still unresolved` };
   150	    }
   151	    const nonce = await this.takeNonce();
   152	    const { raw, hash } = await this.b.sign({
   153	      nonce, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip,
   154	    });
   155	    this.nextNonce = nonce + 1;
   156	    onSigned?.(hash, nonce); // persisted before broadcast, so a crash cannot lose the hash
   157	    try {
   158	      await this.b.broadcast(raw);
   159	    } catch (e) {
   160	      const kind = classifySendError(e);
   161	      if (kind === 'rejected') {
   162	        this.nextNonce = nonce; // nothing was broadcast: reuse the nonce
   163	        return { ok: false, rejected: true, hash, gasCostWei: 0n, reason: `RPC rejected the tx: ${errMsg(e)}` };
   164	      }
   165	      if (kind === 'ambiguous') {
   166	        this.setUnresolved({ nonce, hashes: [hash], since: this.now() });
   167	        return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `send error, outcome unknown: ${errMsg(e)}` };
   168	      }
   169	      // 'accepted': already in the mempool, just wait for it below.
   170	    }
   171	    log.info(`tx sent ${hash} (nonce ${nonce})`);
   172	
   173	    let receipt = await this.waitReceipt(hash, timeoutSec);
   174	    if (receipt) return this.result(hash, receipt);
   175	
   176	    log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
   177	    // Re-read gas: if the base fee spiked while we waited, a cancel priced from the old fee would not mine either.
   178	    const fresh = await this.b.gas().catch(() => gas);
   179	    const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
   180	    const maxFee = [bump(gas.maxFee), bump(fresh.maxFee)].reduce((a, c) => (c > a ? c : a));
   181	    const tip = [bump(gas.tip), bump(fresh.tip)].reduce((a, c) => (c > a ? c : a));
   182	    const cancel = await this.b.sign({ nonce, to: this.b.address, data: '0x', value: 0n, gasLimit: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
   183	    this.setUnresolved({ nonce, hashes: [hash, cancel.hash], since: this.now() }); // before broadcasting the cancel
   184	    await this.b.broadcast(cancel.raw).catch((e) => log.warn(`cancel send failed: ${errMsg(e)}`));
   185	    const deadline = this.now() + timeoutSec * 1000;
   186	    while (this.now() < deadline) {
   187	      receipt = await this.b.receipt(hash).catch(() => null);
   188	      if (receipt) {
   189	        this.setUnresolved(null);
   190	        return this.result(hash, receipt);
   191	      }
   192	      const c = await this.b.receipt(cancel.hash).catch(() => null);
   193	      if (c) {
   194	        this.setUnresolved(null);
   195	        return { ok: false, hash, gasCostWei: c.gasUsed * c.gasPrice, reason: 'not mined, cancelled' };
   196	      }
   197	      await this.sleep(3000);
   198	    }
   199	    return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `not mined and cancel ${cancel.hash} not confirmed: outcome UNKNOWN` };
   200	  }
   201	
   202	  private result(hash: string, r: { status: number | null; gasUsed: bigint; gasPrice: bigint }): TxResult {
   203	    const cost = r.gasUsed * r.gasPrice;
   204	    return r.status === 1 ? { ok: true, hash, gasCostWei: cost } : { ok: false, hash, gasCostWei: cost, reason: 'reverted' };
   205	  }
   206	
   207	  private async waitReceipt(hash: string, timeoutSec: number) {
   208	    const deadline = this.now() + timeoutSec * 1000;
   209	    while (this.now() < deadline) {
   210	      const r = await this.b.receipt(hash).catch(() => null);
   211	      if (r) return r;
   212	      await this.sleep(2000);
   213	    }
   214	    return null;
   215	  }
   216	}
```

## `test/engine.test.ts`

```ts
     1	// End-to-end tests of the trading engine with fake MEXC, chain and aggregator.
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { loadConfig } from '../src/config.js';
     5	import { Db } from '../src/db.js';
     6	import { Risk } from '../src/risk.js';
     7	import { Engine } from '../src/engine.js';
     8	import type { Balances } from '../src/inventory.js';
     9	import type { Token } from '../src/watchlist.js';
    10	import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
    11	import type { TxResult } from '../src/dex/chain.js';
    12	import { AmbiguousRequestError, type Book, type Order } from '../src/mexc/rest.js';
    13	
    14	const GWEI = 1_000_000_000n;
    15	const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    16	const LINK: Token = {
    17	  base: 'LINK', symbol: 'LINKUSDT', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18,
    18	  qtyStep: 0.01, priceDecimals: 3, dexTvlUsd: 1e6, mexcVolumeUsd: 1e7, depositOk: true, withdrawOk: true,
    19	  rules: { qtyStep: 0.01, priceDecimals: 3, minQty: 0.01, minNotional: 1, maxNotional: 2e6, orderTypes: ['LIMIT', 'MARKET', 'LIMIT_MAKER'], tradeSideType: 1 },
    20	};
    21	
    22	function setup(opts: {
    23	  mode?: 'live' | 'paper';
    24	  bid?: number;
    25	  gasGwei?: bigint;
    26	  dexOk?: boolean;
    27	  simulateThrows?: boolean;
    28	  approvalNeeded?: boolean;
    29	  mexcFillRatio?: number;
    30	  closeFillRatio?: number;
    31	  dexUnknown?: boolean;
    32	  placeAmbiguous?: boolean;
    33	  minNotional?: number;
    34	  unresolved?: boolean;
    35	}) {
    36	  process.env.MODE = opts.mode ?? 'live';
    37	  process.env.RPC_URL = 'http://localhost';
    38	  process.env.MAX_TRADE_USD = '200'; // tests use $200 trades (default is 50)
    39	  process.env.MIN_PROFIT_USD = '15';
    40	  process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
    41	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    42	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    43	  const cfg = loadConfig();
    44	  const db = new Db(':memory:');
    45	  const risk = new Risk(db, cfg.mode, cfg);
    46	  const alerts: string[] = [];
    47	  const calls: string[] = [];
    48	
    49	  const fee = cfg.mexcTakerFee;
    50	  const bid = opts.bid ?? 11.2;
    51	  // Real-ish balances that the fakes update, so PnL is computed from balance changes.
    52	  const bal: Balances = { walletEth: 1, walletUsdc: 1000, walletToken: { LINK: 100 }, mexc: { USDT: 1000, LINK: 100 } };
    53	  const ethUsd = 2000;
    54	
    55	  const books: Record<string, Book> = {
    56	    ETHUSDT: { bids: [[ethUsd, 100]], asks: [[ethUsd, 100]], ts: Date.now() },
    57	    LINKUSDT: { bids: [[bid, 1000]], asks: [[bid + 0.01, 1000]], ts: Date.now() },
    58	  };
    59	
    60	  // DEX price = 10 USDC per LINK, 0.1% minOut buffer.
    61	  const dexQuote = (r: QuoteRequest, firm: boolean): Quote => {
    62	    const buyingToken = r.sellToken === USDC;
    63	    const out = buyingToken ? (r.sellAmount * 10n ** 12n) / 10n : (r.sellAmount * 10n) / 10n ** 12n;
    64	    return {
    65	      buyAmount: out,
    66	      minBuyAmount: (out * 999n) / 1000n,
    67	      gas: 150_000n,
    68	      spender: '0xspender',
    69	      tx: firm ? { to: '0xrouter', data: '0xdead', value: 0n } : undefined,
    70	    };
    71	  };
    72	  let lastFirm: QuoteRequest | null = null;
    73	
    74	  const orders = new Map<string, Order>();
    75	  const byCid = new Map<string, string>();
    76	  let nextId = 1;
    77	  const fill = (side: 'BUY' | 'SELL', qty: number, price: number) => {
    78	    if (side === 'SELL') {
    79	      bal.mexc.LINK -= qty;
    80	      bal.mexc.USDT += qty * price * (1 - fee);
    81	    } else {
    82	      bal.mexc.LINK += qty * (1 - fee);
    83	      bal.mexc.USDT -= qty * price;
    84	    }
    85	  };
    86	
    87	  const token = { ...LINK, rules: { ...LINK.rules, minNotional: opts.minNotional ?? 1 } };
    88	  const engine = new Engine({
    89	    cfg,
    90	    db,
    91	    risk,
    92	    tokens: [token],
    93	    sleep: async () => {},
    94	    tg: { send: async (t) => void alerts.push(t) },
    95	    book: async (s) => books[s],
    96	    balances: async () => structuredClone(bal),
    97	    agg: {
    98	      name: '0x',
    99	      price: async (r) => dexQuote(r, false),
   100	      quote: async (r) => ((lastFirm = r), dexQuote(r, true)),
   101	    },
   102	    chain: {
   103	      address: '0xme',
   104	      gas: async () => {
   105	        const base = (opts.gasGwei ?? 9n) * GWEI;
   106	        return { baseFee: base, tip: GWEI, effective: base + GWEI, maxFee: base * 2n + GWEI };
   107	      },
   108	      approvalGasNeeded: async () => (opts.approvalNeeded ? 60_000n : 0n),
   109	      approveExact: async (_t, _s, amount) => {
   110	        calls.push(`approve ${amount}`);
   111	        bal.walletEth -= 0.0006;
   112	        return { ok: true, gasCostWei: 600_000n * GWEI };
   113	      },
   114	      checkUnresolved: async () => ({ state: opts.unresolved ? 'pending' : 'clear' }),
   115	      simulate: async () => {
   116	        calls.push('simulate');
   117	        if (opts.simulateThrows) throw new Error('execution reverted');
   118	        return 150_000n;
   119	      },
   120	      send: async (): Promise<TxResult> => {
   121	        calls.push('send');
   122	        const gasWei = 150_000n * 10n * GWEI;
   123	        bal.walletEth -= 0.0015;
   124	        if (opts.dexUnknown) return { ok: false, unknown: true, hash: '0xtx', gasCostWei: 0n, reason: 'unknown' };
   125	        if (opts.dexOk === false) return { ok: false, hash: '0xtx', gasCostWei: gasWei, reason: 'reverted' };
   126	        const r = lastFirm!;
   127	        if (r.sellToken === USDC) {
   128	          bal.walletUsdc -= Number(r.sellAmount) / 1e6;
   129	          bal.walletToken.LINK += (Number(r.sellAmount) / 1e6) / 10;
   130	        } else {
   131	          const tokens = Number(r.sellAmount) / 1e18;
   132	          bal.walletToken.LINK -= tokens;
   133	          bal.walletUsdc += tokens * 10;
   134	        }
   135	        return { ok: true, hash: '0xtx', gasCostWei: gasWei };
   136	      },
   137	    },
   138	    mexc: {
   139	      limitOrder: async (_s, side, q, p, cid) => {
   140	        calls.push(`limit ${side} ${q} @ ${p}`);
   141	        const id = String(nextId++);
   142	        const first = id === '1';
   143	        const filled = Number(q) * ((first ? opts.mexcFillRatio : opts.closeFillRatio) ?? 1);
   144	        fill(side, filled, Number(p));
   145	        orders.set(id, { orderId: id, status: filled === Number(q) ? 'FILLED' : 'PARTIALLY_FILLED', executedQty: String(filled), cummulativeQuoteQty: '0', origQty: q, price: p, side });
   146	        if (cid) byCid.set(cid, id);
   147	        // MEXC executed it, but our HTTP request timed out / got a 5xx:
   148	        if (first && opts.placeAmbiguous) throw new AmbiguousRequestError('MEXC POST /api/v3/order -> 503');
   149	        return { orderId: id };
   150	      },
   151	      marketSell: async (_s, q) => {
   152	        calls.push(`market SELL ${q}`);
   153	        const filled = Number(q) * (opts.marketFillRatio ?? 1);
   154	        fill('SELL', filled, bid);
   155	        orders.set('m', { orderId: 'm', status: 'FILLED', executedQty: String(filled), cummulativeQuoteQty: String(filled * bid), origQty: q, price: '0', side: 'SELL' });
   156	        return { orderId: 'm' };
   157	      },
   158	      getOrderByClientId: async (_s, cid) => (byCid.has(cid) ? orders.get(byCid.get(cid)!)! : null),
   159	      getOrder: async (_s, id) => orders.get(id)!,
   160	      cancelOrder: async (_s, id) => {
   161	        calls.push(`cancel ${id}`);
   162	        const o = orders.get(id)!;
   163	        o.status = 'PARTIALLY_CANCELED';
   164	        return o;
   165	      },
   166	    },
   167	  });
   168	  return { engine, db, risk, alerts, calls, bal, cfg };
   169	}
   170	
   171	const trades = (db: Db) => db.statsSince(0);
   172	
   173	test('profitable gap: both legs trade, PnL comes from real balance changes', async () => {
   174	  const { engine, db, alerts, calls } = setup({});
   175	  await engine.tick();
   176	  // MEXC sell 20 LINK (bought 20 on DEX for $200), limit = 11.2 * (1 - 0.2%) rounded down.
   177	  // MEXC sells what the DEX guarantees (minBuyAmount 19.98), not the expected 20.
   178	  assert.deepEqual(calls, ['simulate', 'limit SELL 19.98 @ 11.177', 'send']);
   179	  const s = trades(db);
   180	  assert.equal(s.total.trades, 1);
   181	  assert.equal(s.total.failed, 0);
   182	  // +20 LINK in wallet, -19.98 on MEXC (0.02 kept, valued at mid 11.205); -$200 USDC; USDT in; -0.0015 ETH gas
   183	  const expected = -200 + 19.98 * 11.177 * 0.9995 + 0.02 * 11.205 - 0.0015 * 2000;
   184	  assert.ok(Math.abs(s.total.pnl - expected) < 1e-6, `${s.total.pnl} vs ${expected}`);
   185	  assert.ok(Math.abs(s.total.gas - 3) < 1e-9);
   186	  assert.ok(alerts.some((a) => a.includes('✅ LIVE LINK DEX_BUY [ok]') && a.includes('Net PnL')));
   187	});
   188	
   189	test('no trade when the gap is below max($15, 0.5%)', async () => {
   190	  const { engine, db, calls } = setup({ bid: 10.9 });
   191	  await engine.tick();
   192	  assert.deepEqual(calls, []);
   193	  assert.equal(trades(db).total.trades, 0);
   194	});
   195	
   196	test('DEX leg fails after MEXC sold: buys back at market, alerts one-sided', async () => {
   197	  const { engine, db, alerts, calls, bal } = setup({ dexOk: false });
   198	  await engine.tick();
   199	  assert.ok(calls.includes('limit BUY 19.98 @ 11.435')); // close: aggressive limit 2% over ask 11.21
   200	  const row = trades(db);
   201	  assert.equal(row.total.failed, 1);
   202	  assert.ok(alerts.some((a) => a.startsWith('⚠️ ONE-SIDED FILL LINK')));
   203	  assert.ok(Math.abs(bal.walletToken.LINK - 100) < 1e-9); // wallet untouched
   204	  assert.ok(Math.abs(bal.mexc.LINK - 100 + 19.98 * 0.0005) < 1e-9); // flat again except the fee
   205	});
   206	
   207	test('MEXC partial fill: rest is cancelled and closed at market', async () => {
   208	  const { engine, calls } = setup({ mexcFillRatio: 0.5 });
   209	  await engine.tick();
   210	  assert.ok(calls.includes('cancel 1'));
   211	  assert.ok(calls.includes('limit SELL 9.99 @ 10.976')); // rest closed with an aggressive limit 2% under the bid
   212	});
   213	
   214	test('simulation failure: nothing is sent, approval gas is still booked', async () => {
   215	  const { engine, db, calls } = setup({ simulateThrows: true, approvalNeeded: true });
   216	  await engine.tick();
   217	  assert.ok(calls[0].startsWith('approve 200000000')); // exact amount: 200 USDC, never MaxUint256
   218	  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
   219	  const s = trades(db);
   220	  assert.equal(s.total.trades, 0); // approval rows are not trades
   221	  assert.ok(s.total.pnl < 0 && s.total.gas > 0);
   222	});
   223	
   224	test('gas above MAX_GAS_GWEI: no quotes at all', async () => {
   225	  const { engine, calls } = setup({ gasGwei: 50n });
   226	  await engine.tick();
   227	  assert.deepEqual(calls, []);
   228	});
   229	
   230	test('kill switch: paused bot does nothing', async () => {
   231	  const { engine, risk, calls } = setup({});
   232	  risk.pause('Telegram /stop');
   233	  await engine.tick();
   234	  assert.deepEqual(calls, []);
   235	});
   236	
   237	test('3 failed trades in a row pause trading', async () => {
   238	  const { engine, risk, alerts } = setup({ dexOk: false });
   239	  await engine.tick();
   240	  await engine.tick();
   241	  await engine.tick();
   242	  assert.equal(risk.paused, true);
   243	  assert.ok(alerts.some((a) => a.includes('3 failed trades in a row')));
   244	  const before = alerts.length;
   245	  await engine.tick();
   246	  assert.equal(alerts.length, before); // stays stopped
   247	});
   248	
   249	test('paper mode: records the trade, sends nothing real', async () => {
   250	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   251	  await engine.tick();
   252	  assert.deepEqual(calls, []);
   253	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   254	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER LINK')));
   255	});
   256	
   257	test('DEX outcome unknown: NO automatic unwind, trading paused', async () => {
   258	  const { engine, risk, calls, alerts } = setup({ dexUnknown: true });
   259	  await engine.tick();
   260	  assert.ok(!calls.some((c) => c.startsWith('market') || c.startsWith('limit BUY')));
   261	  assert.equal(risk.paused, true);
   262	  assert.ok(alerts.some((a) => a.includes('outcome UNKNOWN')));
   263	});
   264	
   265	test('unwind SELL that only partly fills is detected (not assumed flat)', async () => {
   266	  const { engine, risk, calls, alerts } = setup({ mexcFillRatio: 0.5, closeFillRatio: 0.5 });
   267	  await engine.tick();
   268	  assert.ok(calls.includes('limit SELL 9.99 @ 10.976'));
   269	  assert.equal(risk.paused, true);
   270	  assert.equal(risk.critical, true);
   271	  // reports what is REALLY still open (half of 9.99), not the full quantity
   272	  assert.ok(alerts.some((a) => a.includes('market close FAILED') && a.includes('Still open: MEXC SELL 5 LINK')));
   273	});
   274	
   275	test('MEXC 5xx on order placement: found by clientOrderId, no double sell', async () => {
   276	  const { engine, db, calls } = setup({ placeAmbiguous: true });
   277	  await engine.tick();
   278	  assert.equal(calls.filter((c) => c.startsWith('limit SELL')).length, 1); // never re-sent, never "unwound"
   279	  assert.ok(!calls.some((c) => c.startsWith('limit BUY')));
   280	  assert.equal(trades(db).total.failed, 0);
   281	});
   282	
   283	test('order below MEXC minNotional: rejected BEFORE any DEX tx', async () => {
   284	  const { engine, calls } = setup({ minNotional: 1000 });
   285	  await engine.tick();
   286	  assert.deepEqual(calls, []); // no simulate, no send, no MEXC order
   287	});
   288	
   289	test('unresolved earlier DEX tx: no new trades', async () => {
   290	  const { engine, calls } = setup({ unresolved: true });
   291	  await engine.tick();
   292	  assert.deepEqual(calls, []);
   293	});
   294	
   295	test('critical pause needs /start confirm; soft pause does not', () => {
   296	  const { risk } = setup({});
   297	  risk.pause('Telegram /stop');
   298	  assert.equal(risk.resume(), true);
   299	  risk.pause('DEX tx unknown 0xabc', true);
   300	  risk.pause('Telegram /stop'); // a later soft pause must not downgrade it
   301	  assert.equal(risk.critical, true);
   302	  assert.equal(risk.resume(), false);
   303	  assert.equal(risk.paused, true);
   304	  assert.equal(risk.resume(true), true);
   305	  assert.equal(risk.paused, false);
   306	});
   307	
   308	test('worst case beyond the remaining daily loss budget: skipped before any order', async () => {
   309	  const { engine, db, calls } = setup({});
   310	  db.insertTrade({ ts: Date.now(), day: (await import('../src/util.js')).dhakaDay(), mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 1, qty: 1, buy_price: 1, sell_price: 1, expected_net: 0, cex_fee_usd: 0, gas_usd: 0, pnl_usd: -25, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
   311	  await engine.tick(); // budget left $5 < 5% of $200 + gas
   312	  assert.deepEqual(calls, []);
   313	});
   314	
   315	test('restart with an executing row: looked up, reported, paused until /start confirm', async () => {
   316	  const { db, risk } = setup({});
   317	  const { recoverExecuting } = await import('../src/recovery.js');
   318	  db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 200, qty: 19.98, buy_price: 10, sell_price: 11, expected_net: 18, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: '0xpending', cex_order_id: 'cidX', note: 'client order id cidX; nonce 7' });
   319	  const alerts: string[] = [];
   320	  await recoverExecuting(
   321	    db, risk, { send: async (t) => void alerts.push(t) },
   322	    { getOrderByClientId: async () => ({ orderId: '9', status: 'FILLED', executedQty: '19.98' }) as Order },
   323	    async () => null,
   324	  );
   325	  assert.equal(risk.paused, true);
   326	  assert.equal(risk.critical, true);
   327	  assert.equal(risk.resume(), false);
   328	  assert.equal(db.executingTrades().length, 0);
   329	  assert.ok(alerts[0].includes('MEXC order 9: FILLED, filled 19.98') && alerts[0].includes('NOT MINED'));
   330	});
   331	
   332	test('recovery: both legs done -> trade marked ok, no critical pause', async () => {
   333	  const { db, risk } = setup({});
   334	  const { recoverExecuting } = await import('../src/recovery.js');
   335	  db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 200, qty: 19.98, buy_price: 10, sell_price: 11, expected_net: 18, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: '0xdone', cex_order_id: 'cidY', note: 'client order id cidY; nonce 8' });
   336	  const alerts: string[] = [];
   337	  await recoverExecuting(
   338	    db, risk, { send: async (t) => void alerts.push(t) },
   339	    { getOrderByClientId: async () => ({ orderId: '9', status: 'FILLED', executedQty: '19.98' }) as Order },
   340	    async () => ({ status: 1 }),
   341	    async () => ({ state: 'clear' }),
   342	  );
   343	  assert.equal(risk.paused, false);
   344	  assert.equal(db.statsSince(0, 'live').total.failed, 0);
   345	  assert.ok(alerts[0].includes('All legs completed'));
   346	});
   347	
   348	test('recovery: a pending DEX tx from before the restart keeps the bot critically paused', async () => {
   349	  const { db, risk } = setup({});
   350	  const { recoverExecuting } = await import('../src/recovery.js');
   351	  await recoverExecuting(db, risk, { send: async () => {} }, { getOrderByClientId: async () => null }, async () => null, async () => ({ state: 'pending' }));
   352	  assert.equal(risk.critical, true);
   353	});
   354	
   355	test('critical resume does not reset the failure streak', () => {
   356	  const { risk, db } = setup({});
   357	  db.setState('consecutive_fails', '2');
   358	  risk.pause('DEX tx unknown', true);
   359	  risk.resume(true);
   360	  assert.equal(risk.consecutiveFails, 2);
   361	});
```

## `test/infra.test.ts`

```ts
     1	import { test } from 'node:test';
     2	import assert from 'node:assert/strict';
     3	import crypto from 'node:crypto';
     4	import { decodeDepthPush } from '../src/mexc/proto.js';
     5	import { MexcRest } from '../src/mexc/rest.js';
     6	import { ZeroEx, ZEROX_ALLOWANCE_HOLDER } from '../src/dex/aggregator.js';
     7	import { AmbiguousRequestError } from '../src/mexc/rest.js';
     8	import { placeSafely } from '../src/engine.js';
     9	import { loadConfig, secretsOf, validateConfig } from '../src/config.js';
    10	import { Telegram } from '../src/telegram.js';
    11	import { redact, registerSecrets } from '../src/log.js';
    12	import { Db } from '../src/db.js';
    13	import { Risk } from '../src/risk.js';
    14	import { ethNetwork } from '../src/watchlist.js';
    15	
    16	// --- tiny protobuf encoder for building test messages ---
    17	const varint = (n: number) => {
    18	  const out: number[] = [];
    19	  while (n > 127) {
    20	    out.push((n & 0x7f) | 0x80);
    21	    n = Math.floor(n / 128);
    22	  }
    23	  out.push(n);
    24	  return out;
    25	};
    26	const field = (num: number, bytes: Uint8Array | number[]) => [...varint(num * 8 + 2), ...varint(bytes.length), ...bytes];
    27	const s = (x: string) => [...Buffer.from(x)];
    28	const level = (p: string, q: string) => [...field(1, s(p)), ...field(2, s(q))];
    29	
    30	test('decodes a MEXC limit-depth protobuf push', () => {
    31	  const depth = [
    32	    ...field(1, level('101.5', '2')),
    33	    ...field(1, level('101.0', '1')),
    34	    ...field(2, level('100.0', '3')),
    35	    ...field(2, level('100.5', '4')),
    36	    ...field(3, s('spot@public.limit.depth.v3.api.pb')),
    37	  ];
    38	  const msg = Uint8Array.from([
    39	    ...field(1, s('spot@public.limit.depth.v3.api.pb@LINKUSDT@20')),
    40	    ...field(3, s('LINKUSDT')),
    41	    ...varint(6 * 8), ...varint(1_795_193_165_568), // sendTime int64
    42	    ...field(303, depth),
    43	  ]);
    44	  const d = decodeDepthPush(msg)!;
    45	  assert.equal(d.symbol, 'LINKUSDT');
    46	  assert.deepEqual(d.asks, [[101, 1], [101.5, 2]]); // sorted best first
    47	  assert.deepEqual(d.bids, [[100.5, 4], [100, 3]]);
    48	  assert.equal(decodeDepthPush(Uint8Array.from(field(1, s('x')))), null);
    49	});
    50	
    51	test('MEXC signed request: HMAC over the exact query + API key header', async () => {
    52	  let url = '';
    53	  let headers: Record<string, string> = {};
    54	  const fetchFn = (async (u: string, o: { headers: Record<string, string> }) => {
    55	    url = u;
    56	    headers = o.headers;
    57	    return new Response(JSON.stringify({ orderId: '42' }), { status: 200 });
    58	  }) as unknown as typeof fetch;
    59	  const m = new MexcRest('KEY', 'SECRET', 'https://api.mexc.com', fetchFn);
    60	  await m.limitOrder('LINKUSDT', 'SELL', '1.50', '10.123');
    61	  const u = new URL(url);
    62	  const sig = u.searchParams.get('signature');
    63	  u.searchParams.delete('signature');
    64	  assert.equal(sig, crypto.createHmac('sha256', 'SECRET').update(u.searchParams.toString()).digest('hex'));
    65	  assert.equal(headers['X-MEXC-APIKEY'], 'KEY');
    66	  assert.equal(u.searchParams.get('type'), 'LIMIT');
    67	});
    68	
    69	test('MEXC errors never contain the secret', async () => {
    70	  registerSecrets(['SUPERSECRETVALUE']);
    71	  const fetchFn = (async () => new Response('bad SUPERSECRETVALUE', { status: 400 })) as unknown as typeof fetch;
    72	  await assert.rejects(new MexcRest('k', 'SUPERSECRETVALUE', 'https://x', fetchFn).balances(), (e: Error) => !e.message.includes('SUPERSECRETVALUE'));
    73	  assert.equal(redact('key=SUPERSECRETVALUE'), 'key=***');
    74	});
    75	
    76	const AH = '0x0000000000001fF3684f28c67538d4D072C22734'; // 0x AllowanceHolder (mixed case like the API)
    77	const zeroExWith = (body: object) =>
    78	  new ZeroEx('k', (async (_u: string, o: { headers: Record<string, string> }) => {
    79	    assert.equal(o.headers['0x-version'], 'v2');
    80	    return new Response(JSON.stringify({ liquidityAvailable: true, buyAmount: '1000', minBuyAmount: '990', ...body }));
    81	  }) as unknown as typeof fetch);
    82	const req = { sellToken: '0xa', buyToken: '0xb', sellAmount: 5n, taker: '0xt', slippageBps: 30 };
    83	
    84	test('0x quote parsing: amounts, gas, spender, tx', async () => {
    85	  const q = await zeroExWith({
    86	    issues: { allowance: { spender: AH } },
    87	    transaction: { to: AH, data: '0xabc', gas: '150000', value: '0' },
    88	  }).quote(req);
    89	  assert.equal(q.buyAmount, 1000n);
    90	  assert.equal(q.minBuyAmount, 990n);
    91	  assert.equal(q.gas, 150000n);
    92	  assert.equal(q.spender, ZEROX_ALLOWANCE_HOLDER);
    93	  assert.equal(q.tx?.data, '0xabc');
    94	  // no allowance issue -> spender is still the AllowanceHolder, never tx.to blindly
    95	  const p = await zeroExWith({ transaction: { to: AH, data: '0x', gas: '1', value: '0' } }).quote(req);
    96	  assert.equal(p.spender, ZEROX_ALLOWANCE_HOLDER);
    97	});
    98	
    99	test('0x response pointing at an unknown contract is rejected (allowlist)', async () => {
   100	  await assert.rejects(
   101	    zeroExWith({ transaction: { to: '0x000000000000000000000000000000000000bad1', data: '0x', gas: '1', value: '0' } }).quote(req),
   102	    /not the allowlisted contract/,
   103	  );
   104	  await assert.rejects(zeroExWith({ issues: { allowance: { spender: '0x000000000000000000000000000000000000bad2' } } }).price(req), /allowlisted/);
   105	});
   106	
   107	test('placeSafely: a timed-out order that WAS placed is found by client id; one that was not is reported', async () => {
   108	  const sleep = async () => {};
   109	  const ambiguous = async (): Promise<{ orderId: string }> => {
   110	    throw new AmbiguousRequestError('timeout');
   111	  };
   112	  const found = await placeSafely({ getOrderByClientId: async () => ({ orderId: '77' }) as never }, 'X', 'cid', ambiguous, sleep);
   113	  assert.equal(found.orderId, '77');
   114	  await assert.rejects(placeSafely({ getOrderByClientId: async () => null }, 'X', 'cid', ambiguous, sleep), /timeout/);
   115	  await assert.rejects(
   116	    placeSafely({ getOrderByClientId: async () => { throw new Error('down'); } }, 'X', 'cid', ambiguous, sleep),
   117	    /UNKNOWN_ORDER_STATE/,
   118	  );
   119	  // a clear rejection is not looked up at all
   120	  let looked = false;
   121	  await assert.rejects(
   122	    placeSafely({ getOrderByClientId: async () => ((looked = true), null) }, 'X', 'cid', async () => { throw new Error('insufficient balance'); }, sleep),
   123	    /insufficient/,
   124	  );
   125	  assert.equal(looked, false);
   126	});
   127	
   128	test('config validation rejects dangerous values', () => {
   129	  process.env.RPC_URL = 'http://x';
   130	  process.env.MODE = 'paper';
   131	  const ok = loadConfig();
   132	  assert.doesNotThrow(() => validateConfig(ok));
   133	  assert.throws(() => validateConfig({ ...ok, minProfitPct: -1 }), /MIN_PROFIT_PCT/);
   134	  assert.throws(() => validateConfig({ ...ok, dexSlippageBps: 20_000 }), /DEX_SLIPPAGE_BPS/);
   135	  assert.throws(() => validateConfig({ ...ok, minTradeUsd: 500, maxTradeUsd: 200 }), /MIN_TRADE_USD/);
   136	});
   137	
   138	test('Telegram only obeys the admin user in a private chat', async () => {
   139	  const sent: string[] = [];
   140	  const fetchFn = (async (_u: string, o: { body: string }) => {
   141	    sent.push(JSON.parse(o.body).text);
   142	    return new Response(JSON.stringify({ ok: true, result: {} }));
   143	  }) as unknown as typeof fetch;
   144	  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42');
   145	  let stopped = 0;
   146	  const handlers = { '/stop': () => (stopped++, 'stopped') };
   147	  await tg.handle({ message: { chat: { id: 999, type: 'private' }, from: { id: 42 }, text: '/stop' } }, handlers); // other chat
   148	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 13 }, text: '/stop' } }, handlers); // wrong user
   149	  await tg.handle({ message: { chat: { id: 777, type: 'group' }, from: { id: 42 }, text: '/stop' } }, handlers); // group
   150	  assert.equal(stopped, 0);
   151	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/stop@MyBot' } }, handlers);
   152	  assert.equal(stopped, 1);
   153	  assert.deepEqual(sent, ['stopped']);
   154	});
   155	
   156	test('MEXC rules: step from baseAssetPrecision, min qty from baseSizePrecision, notional and side checks', async () => {
   157	  const { rulesFrom, orderProblem } = await import('../src/mexc/rules.js');
   158	  // real ETHUSDT values from exchangeInfo
   159	  const r = rulesFrom({ symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0.0001', baseAssetPrecision: 5, quotePrecision: 2, orderTypes: ['LIMIT', 'MARKET', 'LIMIT_MAKER'], quoteAmountPrecision: '1', maxQuoteAmount: '4000000', tradeSideType: 1 });
   160	  assert.equal(r.qtyStep, 1e-5);
   161	  assert.equal(r.minQty, 0.0001);
   162	  assert.equal(orderProblem(r, 'BUY', 0.01, 1600), null);
   163	  assert.match(orderProblem(r, 'BUY', 0.00005, 1600)!, /minimum 0.0001/);
   164	  assert.match(orderProblem(r, 'BUY', 0.0005, 1600)!, /< minimum 1 USDT/);
   165	  assert.match(orderProblem(r, 'BUY', 0.01, 1600, 'IMMEDIATE_OR_CANCEL')!, /not allowed/);
   166	  assert.match(orderProblem({ ...r, tradeSideType: 3 }, 'BUY', 0.01, 1600)!, /sell-only/);
   167	  assert.match(orderProblem({ ...r, tradeSideType: 2 }, 'SELL', 0.01, 1600)!, /buy-only/);
   168	});
   169	
   170	test('toUnits truncates, never rounds up', async () => {
   171	  const { toUnits } = await import('../src/util.js');
   172	  assert.equal(toUnits(0.1239999999, 3), 123n);
   173	  assert.equal(toUnits(1.9999999, 6), 1999999n);
   174	  assert.equal(toUnits(0, 6), 0n);
   175	});
   176	
   177	test('0x requests use slippagePpm (slippageBps is deprecated) and refuse unsafe firm quotes', async () => {
   178	  let url = '';
   179	  const z = (body: object) =>
   180	    new ZeroEx('k', (async (u: string) => {
   181	      url = u;
   182	      return new Response(JSON.stringify({ liquidityAvailable: true, buyAmount: '1', minBuyAmount: '1', transaction: { to: AH, data: '0x', gas: '1', value: '0' }, ...body }));
   183	    }) as unknown as typeof fetch);
   184	  await z({}).quote(req);
   185	  assert.match(url, /slippagePpm=3000/);
   186	  assert.doesNotMatch(url, /slippageBps/);
   187	  await assert.rejects(z({ issues: { balance: { actual: '0' } } }).quote(req), /balance/);
   188	  await assert.rejects(z({ issues: { simulationIncomplete: true } }).quote(req), /simulation incomplete/);
   189	});
   190	
   191	test('Risk: loss limit, fail streak, trade limit, kill switch', () => {
   192	  const db = new Db(':memory:');
   193	  const now = Date.UTC(2026, 10, 20, 6);
   194	  const risk = new Risk(db, 'live', { maxTradesPerDay: 3, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
   195	  const row = (pnl: number, status: 'ok' | 'one_sided') =>
   196	    db.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: pnl, status, dex_tx: null, cex_order_id: null, note: null });
   197	
   198	  assert.equal(risk.blockReason(), null);
   199	  row(-10, 'one_sided');
   200	  assert.deepEqual(risk.afterTrade('one_sided'), []);
   201	  row(-10, 'one_sided');
   202	  risk.afterTrade('one_sided');
   203	  row(-5, 'one_sided');
   204	  const ev = risk.afterTrade('one_sided');
   205	  assert.ok(ev.some((e) => e.kind === 'fail_streak'));
   206	  assert.match(risk.blockReason()!, /paused/);
   207	
   208	  risk.resume();
   209	  assert.match(risk.blockReason()!, /trade limit/); // 3 trades today
   210	
   211	  const db2 = new Db(':memory:');
   212	  const r2 = new Risk(db2, 'live', { maxTradesPerDay: 20, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
   213	  db2.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: -31, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
   214	  assert.ok(r2.afterTrade('ok').some((e) => e.kind === 'loss_limit'));
   215	  assert.match(r2.blockReason()!, /loss limit/);
   216	  r2.resume();
   217	  assert.match(r2.blockReason()!, /daily loss limit/); // /start cannot override today's loss limit
   218	
   219	  r2.pause('Telegram /stop');
   220	  assert.match(r2.blockReason()!, /Telegram \/stop/);
   221	});
   222	
   223	test('ethNetwork finds the Ethereum entry in MEXC coin config', () => {
   224	  const n = ethNetwork({
   225	    coin: 'LINK',
   226	    networkList: [
   227	      { coin: 'LINK', network: 'BNB Smart Chain(BEP20)', netWork: 'BSC', contract: '0xbsc', depositEnable: true, withdrawEnable: true },
   228	      { coin: 'LINK', network: 'Ethereum(ERC20)', netWork: 'ETH', contract: '0xeth', depositEnable: true, withdrawEnable: false },
   229	    ],
   230	  });
   231	  assert.equal(n?.contract, '0xeth');
   232	});
   233	
   234	test('transfer strategy refuses to start without ALLOW_WITHDRAWALS=yes; safe defaults', () => {
   235	  const saved = { ...process.env };
   236	  try {
   237	    for (const k of ['MODE', 'STRATEGY', 'ALLOW_WITHDRAWALS', 'MAX_TRADE_USD']) delete process.env[k];
   238	    process.env.RPC_URL = 'http://x';
   239	    const d = loadConfig();
   240	    assert.equal(d.mode, 'paper');
   241	    assert.equal(d.strategy, 'inventory');
   242	    assert.equal(d.maxTradeUsd, 50);
   243	    process.env.STRATEGY = 'transfer';
   244	    assert.throws(() => loadConfig(), /ALLOW_WITHDRAWALS=yes/);
   245	    process.env.ALLOW_WITHDRAWALS = 'yes';
   246	    assert.equal(loadConfig().strategy, 'transfer');
   247	  } finally {
   248	    process.env = saved;
   249	  }
   250	});
   251	
   252	test('RPC URLs (they contain provider keys) are redacted', () => {
   253	  process.env.RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123';
   254	  process.env.MODE = 'paper';
   255	  delete process.env.STRATEGY;
   256	  const c = loadConfig();
   257	  registerSecrets(secretsOf(c));
   258	  assert.equal(redact('rpc https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123 failed'), 'rpc *** failed');
   259	});
   260	
   261	test('default economics: profit floor is small vs trade size; $15 on $50 is rejected', () => {
   262	  const saved = { ...process.env };
   263	  try {
   264	    for (const k of ['MIN_PROFIT_USD', 'MAX_TRADE_USD', 'MODE', 'STRATEGY']) delete process.env[k];
   265	    process.env.RPC_URL = 'http://x';
   266	    const d = validateConfig(loadConfig());
   267	    assert.ok(d.minProfitUsd <= d.maxTradeUsd * 0.1, `${d.minProfitUsd} vs ${d.maxTradeUsd}`);
   268	    assert.throws(() => validateConfig({ ...d, minProfitUsd: 15, maxTradeUsd: 50 }), /only fake gaps/);
   269	  } finally {
   270	    process.env = saved;
   271	  }
   272	});
   273	
   274	test('Telegram: a command sent before this start (replayed after restart) is ignored', async () => {
   275	  const tg = new Telegram('123456:TOKENTOKEN', '777', (async () => new Response(JSON.stringify({ ok: true, result: {} }))) as unknown as typeof fetch, '42');
   276	  let n = 0;
   277	  const handlers = { '/start': () => (n++, 'ok') };
   278	  const old = Math.floor(Date.now() / 1000) - 3600;
   279	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/start confirm', date: old } }, handlers);
   280	  assert.equal(n, 0);
   281	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/start confirm', date: Math.floor(Date.now() / 1000) + 1 } }, handlers);
   282	  assert.equal(n, 1);
   283	});
   284	
   285	test('aggressive close offset stays inside a tight PERCENT_PRICE_BY_SIDE band', async () => {
   286	  const { aggressiveOffset, rulesFrom } = await import('../src/mexc/rules.js');
   287	  const base = { symbol: 'X', baseAsset: 'X', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0', quotePrecision: 4, orderTypes: ['LIMIT'] };
   288	  assert.equal(aggressiveOffset(rulesFrom({ ...base, filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.2', askMultiplierDown: '0.2' }] })), 0.02);
   289	  assert.equal(aggressiveOffset(rulesFrom({ ...base, filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.02', askMultiplierDown: '0.02' }] })), 0.01);
   290	});
   291	
   292	test('MARKET orders use the market notional limits', async () => {
   293	  const { orderProblem } = await import('../src/mexc/rules.js');
   294	  const r = { qtyStep: 0.01, priceDecimals: 2, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT', 'MARKET'], tradeSideType: 1, minNotionalMarket: 5 };
   295	  assert.equal(orderProblem(r, 'SELL', 1, 2, 'LIMIT'), null);
   296	  assert.match(orderProblem(r, 'SELL', 1, 2, 'MARKET')!, /minimum 5/);
   297	});
   298	
   299	test('cancelAndConfirm: never reports a still-open order as closed', async () => {
   300	  const { cancelAndConfirm, OrderStillOpenError } = await import('../src/engine.js');
   301	  const open = { getOrder: async () => ({ orderId: '1', status: 'NEW', executedQty: '0' }) as never, cancelOrder: async () => { throw new Error('timeout'); } };
   302	  await assert.rejects(cancelAndConfirm(open, 'X', '1', async () => {}), (e: unknown) => e instanceof OrderStillOpenError);
   303	  let st = 'NEW';
   304	  const ok = { getOrder: async () => ({ orderId: '1', status: st, executedQty: '0' }) as never, cancelOrder: async () => ((st = 'CANCELED'), {} as never) };
   305	  assert.equal((await cancelAndConfirm(ok, 'X', '1', async () => {})).status, 'CANCELED');
   306	});
```

## `test/pricing.test.ts`

```ts
     1	import { test } from 'node:test';
     2	import assert from 'node:assert/strict';
     3	import {
     4	  evaluateCexBuy,
     5	  evaluateDexBuy,
     6	  fillBase,
     7	  fillQuote,
     8	  gasUsd,
     9	  planCexBuy,
    10	  planCexBuyQty,
    11	  threshold,
    12	  unwindPlan,
    13	} from '../src/pricing.js';
    14	import { floorToStep, toFloat, toUnits, dhakaDay } from '../src/util.js';
    15	
    16	const costs = { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 };
    17	const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
    18	
    19	test('fillBase / fillQuote walk the book', () => {
    20	  const asks: [number, number][] = [[10, 5], [11, 5]];
    21	  assert.deepEqual(fillBase(asks, 7), { quote: 72, worst: 11 });
    22	  assert.equal(fillBase(asks, 11), null);
    23	  const q = fillQuote(asks, 72)!;
    24	  close(q.qty, 7);
    25	  assert.equal(q.worst, 11);
    26	  assert.equal(fillQuote(asks, 1000), null);
    27	});
    28	
    29	test('threshold = max($15, 0.5% of size)', () => {
    30	  assert.equal(threshold(200, 15, 0.5), 15);
    31	  assert.equal(threshold(10_000, 15, 0.5), 50);
    32	});
    33	
    34	test('evaluateDexBuy: sells only what the DEX guarantees, every cost subtracted', () => {
    35	  // $200 on DEX buys 20 tokens expected, 19.9 guaranteed; MEXC bid 11 -> sell 19.9 for $218.90.
    36	  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.9, bids: [[11, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
    37	  const proceeds = 19.9 * 11;
    38	  close(o.net, proceeds - proceeds * 0.0005 - 200 - 3 - proceeds * 0.002 - 2);
    39	  assert.equal(o.cexQty, 19.9);
    40	  close(o.cexLimitPrice, 11 * 0.998);
    41	  close(o.buyPrice, 10);
    42	  close(o.sellPrice, 11);
    43	});
    44	
    45	test('evaluateDexBuy: dust below the MEXC step is kept as inventory, not counted as profit', () => {
    46	  const o = evaluateDexBuy({ sizeUsd: 100, tokensOut: 10.005, tokensMin: 10.005, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 0, costs: { ...costs, takerFee: 0, cexSlippageBps: 0, safetyMarginUsd: 0 } })!;
    47	  assert.equal(o.cexQty, 10);
    48	  close(o.net, 0.05, 1e-9); // 100 proceeds - (100 - 0.05 dust value)
    49	});
    50	
    51	test('planCexBuy + evaluateCexBuy: fee is paid in tokens, so fewer tokens are sold on DEX', () => {
    52	  const plan = planCexBuy({ sizeUsd: 200, asks: [[10, 100]], qtyStep: 0.01, takerFee: 0.0005 })!;
    53	  assert.equal(plan.qty, 20);
    54	  close(plan.costUsd, 200);
    55	  close(plan.tokensToSell, 20 * 0.9995);
    56	  const o = evaluateCexBuy({ plan, usdcOut: 230, usdcMin: 229, gasUsd: 3, costs });
    57	  close(o.net, 230 - 200 - 3 - (200 * 0.002 + 1) - 2);
    58	  assert.deepEqual(planCexBuyQty([[10, 100]], 20, 0.0005), plan);
    59	});
    60	
    61	test('no opportunity when prices are equal', () => {
    62	  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.94, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
    63	  assert.ok(o.net < 0);
    64	});
    65	
    66	test('gasUsd', () => {
    67	  close(gasUsd(200_000n, 20_000_000_000n, 2000), 8); // 200k gas * 20 gwei = 0.004 ETH
    68	});
    69	
    70	test('unwindPlan covers every one-sided case', () => {
    71	  assert.equal(unwindPlan('DEX_BUY', true, 10, 10, 0.0005, 0.01), null); // both filled
    72	  assert.deepEqual(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.side, 'SELL');
    73	  assert.equal(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.qty, 6);
    74	  assert.deepEqual(unwindPlan('DEX_BUY', false, 10, 10, 0.0005, 0.01)?.side, 'BUY');
    75	  assert.equal(unwindPlan('DEX_BUY', false, 10, 0, 0.0005, 0.01), null); // nothing happened
    76	  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.qty, 3);
    77	  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.side, 'BUY');
    78	  const u = unwindPlan('CEX_BUY', false, 10, 10, 0.0005, 0.01)!;
    79	  assert.equal(u.side, 'SELL');
    80	  assert.equal(u.qty, 9.99); // sell only what we received after the fee
    81	});
    82	
    83	test('util conversions', () => {
    84	  assert.equal(floorToStep(1.23456, 0.01), 1.23);
    85	  assert.equal(floorToStep(0.3, 0.1), 0.3);
    86	  assert.equal(toUnits(123.456789, 6), 123456789n);
    87	  assert.equal(toUnits(1.5e-7, 18), 150000000000n);
    88	  assert.equal(toUnits(0.1, 18), 100000000000000000n); // exactly, not 100000000000000005
    89	  assert.equal(toUnits(1, 18), 10n ** 18n);
    90	  assert.equal(toFloat(1_500_000n, 6), 1.5);
    91	  assert.equal(toFloat(5n, 18), 5e-18);
    92	  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 18, 30)), '2026-01-02'); // 00:30 in Dhaka
    93	  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 17, 59)), '2026-01-01');
    94	});
```

## `test/transfer.test.ts`

```ts
     1	// Transfer strategy: scan -> buy MEXC -> withdraw -> wait -> sell DEX, with fakes.
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { loadConfig } from '../src/config.js';
     5	import { Db } from '../src/db.js';
     6	import { Risk } from '../src/risk.js';
     7	import { TransferEngine, type TransferMexc, type TransferChain } from '../src/transfer.js';
     8	import { findGaps, loadUniverse, type ScanToken } from '../src/scanner.js';
     9	import { evaluateTransfer, planCexBuy } from '../src/pricing.js';
    10	import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
    11	import { AmbiguousRequestError, type Order } from '../src/mexc/rest.js';
    12	
    13	const GWEI = 1_000_000_000n;
    14	const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    15	const XYZ = '0x1111111111111111111111111111111111111111';
    16	
    17	const symbolInfo = (base: string) => ({
    18	  symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true,
    19	  baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'],
    20	});
    21	const coin = (base: string, contract: string, dep = true, wd = true) => ({
    22	  coin: base,
    23	  networkList: [{ coin: base, network: 'Ethereum(ERC20)', netWork: 'ETH', contract, depositEnable: dep, withdrawEnable: wd, withdrawFee: '1', withdrawMin: '10' }],
    24	});
    25	
    26	function setup(
    27	  o: {
    28	    dexPrice?: number;
    29	    withdrawThrows?: boolean;
    30	    withdrawAmbiguous?: boolean;
    31	    withdrawStatus?: number;
    32	    db?: Db;
    33	    mode?: 'live' | 'paper';
    34	    sendFails?: boolean;
    35	    sendUnknown?: boolean;
    36	    now?: () => number;
    37	  } = {},
    38	) {
    39	  process.env.MODE = o.mode ?? 'live';
    40	  process.env.STRATEGY = 'transfer';
    41	  process.env.ALLOW_WITHDRAWALS = 'yes';
    42	  process.env.RPC_URL = 'http://localhost';
    43	  process.env.MAX_TRADE_USD = '200'; // tests use $200 trades (default is 50)
    44	  process.env.MIN_PROFIT_USD = '15';
    45	  process.env.PRIVATE_KEY = '0x' + '22'.repeat(32);
    46	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    47	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    48	  const cfg = loadConfig();
    49	  const db = o.db ?? new Db(':memory:');
    50	  const risk = new Risk(db, cfg.mode, cfg);
    51	  const alerts: string[] = [];
    52	  const calls: string[] = [];
    53	  const dexPrice = o.dexPrice ?? 1.15;
    54	  const state = {
    55	    mexc: { USDT: 1000, XYZ: 0 } as Record<string, number>,
    56	    wallet: { [XYZ]: 0n, [USDC]: 0n } as Record<string, bigint>,
    57	    withdrawStatus: o.withdrawStatus ?? 4,
    58	    dexPrice,
    59	    withdrawals: [] as { id: string; status: number; amount: string; withdrawOrderId?: string }[],
    60	  };
    61	  const orders = new Map<string, Order>();
    62	  let lastQuote: QuoteRequest | null = null;
    63	
    64	  const mexc: TransferMexc = {
    65	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD')],
    66	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }],
    67	    coinConfigs: async () => [coin('XYZ', XYZ), coin('BAD', '0x2222222222222222222222222222222222222222', true, false)],
    68	    bookTickers: async () => new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }]]),
    69	    depth: async () => ({ bids: [[0.999, 1e6]], asks: [[1.0, 1e6]], ts: Date.now() }),
    70	    balances: async () => ({ ...state.mexc }),
    71	    limitOrder: async (_s, side, q, p) => {
    72	      calls.push(`limit ${side} ${q} @ ${p}`);
    73	      const qty = Number(q);
    74	      state.mexc.USDT -= qty * 1.0;
    75	      state.mexc.XYZ += qty * (1 - cfg.mexcTakerFee);
    76	      orders.set('b1', { orderId: 'b1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(qty * 1.0), origQty: q, price: p, side });
    77	      return { orderId: 'b1' };
    78	    },
    79	    marketSell: async (_s, q) => {
    80	      calls.push(`market SELL ${q}`);
    81	      state.mexc.XYZ -= Number(q);
    82	      orders.set('s1', { orderId: 's1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(Number(q) * 0.999), origQty: q, price: '0', side: 'SELL' });
    83	      return { orderId: 's1' };
    84	    },
    85	    getOrder: async (_s, id) => orders.get(id)!,
    86	    getOrderByClientId: async () => null,
    87	    cancelOrder: async (_s, id) => orders.get(id)!,
    88	    withdraw: async (p) => {
    89	      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
    90	      if (o.withdrawThrows) throw new Error('no withdraw permission');
    91	      state.mexc.XYZ -= Number(p.amount);
    92	      state.withdrawals.push({ id: 'w1', status: 4, amount: p.amount, withdrawOrderId: p.withdrawOrderId });
    93	      if (o.withdrawAmbiguous) throw new AmbiguousRequestError('timeout');
    94	      return 'w1';
    95	    },
    96	    findWithdraw: async (_c, _since, ref) => {
    97	      const w = state.withdrawals.find((x) => (ref.id && x.id === ref.id) || (ref.withdrawOrderId && x.withdrawOrderId === ref.withdrawOrderId));
    98	      return w ? { ...w, status: state.withdrawStatus } : null;
    99	    },
   100	  };
   101	
   102	  const quote = (r: QuoteRequest, firm: boolean): Quote => {
   103	    const out = (r.sellAmount * BigInt(Math.round(state.dexPrice * 1e6))) / 10n ** 18n; // token(18) -> USDC(6)
   104	    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
   105	  };
   106	
   107	  const chain: TransferChain = {
   108	    address: '0xMyWallet',
   109	    gas: async () => ({ baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI }),
   110	    decimals: async () => 18,
   111	    tokenBalance: async (t) => state.wallet[t] ?? 0n,
   112	    approveExact: async (_t, s, amount) => {
   113	      calls.push(`approve ${s} ${amount}`);
   114	      return { ok: true, gasCostWei: 60_000n * 10n * GWEI };
   115	    },
   116	    simulate: async () => (calls.push('simulate'), 150_000n),
   117	    send: async () => {
   118	      calls.push('send');
   119	      if (o.sendUnknown) return { ok: false, unknown: true, hash: '0xhash', gasCostWei: 0n, reason: 'unknown' };
   120	      if (o.sendFails) return { ok: false, hash: '0xhash', gasCostWei: 0n, reason: 'reverted' };
   121	      const r = lastQuote!;
   122	      state.wallet[XYZ] -= r.sellAmount;
   123	      state.wallet[USDC] += quote(r, true).buyAmount;
   124	      return { ok: true, hash: '0xhash', gasCostWei: 150_000n * 10n * GWEI };
   125	    },
   126	  };
   127	
   128	  const engine = new TransferEngine({
   129	    cfg, mexc, chain, db, risk,
   130	    tg: { send: async (t) => void alerts.push(t) },
   131	    agg: { name: '0x', price: async (r) => quote(r, false), quote: async (r) => ((lastQuote = r), quote(r, true)) },
   132	    dexPricesFn: async () => new Map([[XYZ, { price: dexPrice, tvl: 1e6 }]]),
   133	    sleep: async () => {},
   134	    now: o.now,
   135	  });
   136	  // The withdrawal lands: MEXC reports SUCCESS (7) and the wallet balance grows.
   137	  const arrive = (tokens: number) => {
   138	    state.withdrawStatus = 7;
   139	    state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n;
   140	  };
   141	  return { engine, db, risk, alerts, calls, state, arrive, cfg };
   142	}
   143	
   144	test('loadUniverse keeps only ERC20 tokens with deposit AND withdraw open', async () => {
   145	  const { engine } = setup();
   146	  await engine.refreshUniverse(true);
   147	  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']); // BAD has withdrawals suspended
   148	  assert.equal(engine.universe[0].address, XYZ);
   149	  assert.equal(engine.universe[0].netWork, 'ETH');
   150	  assert.equal(engine.universe[0].withdrawFee, 1);
   151	});
   152	
   153	test('findGaps: filters TVL, too-small and absurd gaps, sorts biggest first', () => {
   154	  const rules = { qtyStep: 0.01, priceDecimals: 4, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT'], tradeSideType: 1 };
   155	  const tok = (base: string, address: string): ScanToken => ({ base, symbol: `${base}USDT`, address, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6, rules });
   156	  const tokens = [tok('A', '0xa'), tok('B', '0xb'), tok('C', '0xc'), tok('D', '0xd'), tok('E', '0xe')];
   157	  const tickers = new Map(['A', 'B', 'C', 'D', 'E'].map((b) => [`${b}USDT`, { bid: 0.99, ask: 1 }]));
   158	  const dex = new Map([
   159	    ['0xa', { price: 1.05, tvl: 1e6 }], // 5%
   160	    ['0xb', { price: 1.1, tvl: 1e6 }], // 10%
   161	    ['0xc', { price: 1.1, tvl: 1000 }], // thin pool
   162	    ['0xd', { price: 1.01, tvl: 1e6 }], // 1% < min
   163	    ['0xe', { price: 3, tvl: 1e6 }], // 200%: broken / different token
   164	  ]);
   165	  const g = findGaps(tokens, tickers, dex, { minTvlUsd: 200_000, minGapPct: 3 });
   166	  assert.deepEqual(g.map((x) => x.token.base), ['B', 'A']);
   167	});
   168	
   169	test('evaluateTransfer subtracts withdraw fee, drift reserve and all costs', () => {
   170	  const plan = planCexBuy({ sizeUsd: 200, asks: [[1, 1e6]], qtyStep: 0.01, takerFee: 0.0005 })!;
   171	  const ev = evaluateTransfer({ plan, withdrawFeeTokens: 1, usdcOut: 228.7, usdcMin: 228.5, gasUsd: 4, driftBps: 150, costs: { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 } });
   172	  assert.ok(Math.abs(ev.arriving - (200 * 0.9995 - 1)) < 1e-9);
   173	  const expected = 228.7 - 200 - 4 - (0.4 + 0.2) - 228.7 * 0.015 - 2;
   174	  assert.ok(Math.abs(ev.net - expected) < 1e-9);
   175	});
   176	
   177	test('full cycle: buy on MEXC -> withdraw to own wallet -> wait -> sell on DEX -> PnL', async () => {
   178	  const { engine, db, calls, alerts, arrive } = setup();
   179	  await engine.tick(); // finds gap, buys, withdraws
   180	  assert.equal(calls[0], 'limit BUY 200.00 @ 1.0020');
   181	  assert.equal(calls[1], 'withdraw 199.90 XYZ ETH -> 0xMyWallet'); // only ever our own wallet
   182	  assert.equal(db.openTransfers()[0].status, 'withdrawing');
   183	  assert.ok(alerts.some((a) => a.startsWith('📤 TRANSFER #1 XYZ')));
   184	
   185	  await engine.tick(); // still on its way: nothing new is bought meanwhile
   186	  assert.equal(calls.filter((c) => c.startsWith('limit')).length, 1);
   187	
   188	  arrive(198.9); // 199.9 - 1 withdraw fee
   189	  await engine.tick();
   190	  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
   191	  assert.ok(calls.includes('simulate') && calls.includes('send'));
   192	  assert.ok(!db.openTransfers().some((t) => t.id === 1)); // #1 done (a new one may start: gap still open)
   193	
   194	  const s = db.statsSince(0, 'live');
   195	  assert.equal(s.total.trades, 1);
   196	  assert.equal(s.total.failed, 0);
   197	  const usdcOut = Math.floor(198.9 * 1.15 * 1e6) / 1e6;
   198	  const gas = (0.0006 + 0.0015) * 2000;
   199	  assert.ok(Math.abs(s.total.pnl - (usdcOut - 200 - gas)) < 1e-6, String(s.total.pnl));
   200	  assert.ok(alerts.some((a) => a.includes('TRANSFER #1 XYZ done') && a.includes('Net PnL')));
   201	});
   202	
   203	test('restart while withdrawing: a new engine resumes the same transfer', async () => {
   204	  const first = setup();
   205	  await first.engine.tick();
   206	  // "restart": new engine, same database and balances
   207	  const second = setup({ db: first.db });
   208	  Object.assign(second.state, first.state);
   209	  second.state.wallet[XYZ] = BigInt(198.9e6) * 10n ** 12n;
   210	  second.state.withdrawStatus = 7; // MEXC reports SUCCESS
   211	  await second.engine.tick();
   212	  assert.ok(!first.db.openTransfers().some((t) => t.id === 1));
   213	  assert.equal(first.db.statsSince(0, 'live').total.trades, 1);
   214	});
   215	
   216	test('withdraw request times out: never re-sent, found later by withdrawOrderId', async () => {
   217	  const { engine, db, calls, arrive } = setup({ withdrawAmbiguous: true });
   218	  await engine.tick();
   219	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   220	  await engine.tick(); // looks it up instead of withdrawing again
   221	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   222	  assert.equal(db.getTransfer(1)!.withdraw_id, 'w1');
   223	  arrive(198.9);
   224	  await engine.tick();
   225	  assert.equal(db.getTransfer(1)!.status, 'done');
   226	});
   227	
   228	test('price fell during the withdrawal: holds instead of selling at a big loss; /sell overrides', async () => {
   229	  let t = Date.UTC(2026, 10, 20, 6);
   230	  const { engine, db, calls, alerts, arrive, state } = setup({ now: () => t });
   231	  await engine.tick();
   232	  state.dexPrice = 0.9; // 10% below the MEXC buy price
   233	  arrive(198.9);
   234	  await engine.tick();
   235	  assert.ok(!calls.includes('send'));
   236	  assert.equal(db.getTransfer(1)!.status, 'selling');
   237	  assert.ok(alerts.some((a) => a.startsWith('✋ TRANSFER #1 XYZ') && a.includes('/sell 1')));
   238	  t += 6 * 60_000;
   239	  await engine.tick();
   240	  assert.ok(!calls.includes('send')); // still holding
   241	  assert.match(engine.forceSell(1), /selling on the next scan/);
   242	  await engine.tick();
   243	  assert.ok(calls.includes('send'));
   244	  assert.equal(db.getTransfer(1)!.status, 'done');
   245	});
   246	
   247	test('failed DEX sales back off, then stop retrying (no gas burn loop)', async () => {
   248	  let t = Date.UTC(2026, 10, 20, 6);
   249	  const { engine, db, calls, alerts, arrive } = setup({ sendFails: true, now: () => t });
   250	  await engine.tick();
   251	  arrive(198.9);
   252	  await engine.tick(); // attempt 1
   253	  await engine.tick(); // inside backoff: no attempt
   254	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   255	  for (const wait of [2, 10, 30]) {
   256	    t += wait * 60_000 + 1;
   257	    await engine.tick();
   258	  }
   259	  assert.equal(calls.filter((c) => c === 'send').length, 4);
   260	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   261	  t += 24 * 3600_000;
   262	  await engine.tick();
   263	  assert.equal(calls.filter((c) => c === 'send').length, 4); // no more automatic tries
   264	  assert.ok(alerts.some((a) => a.includes('Automatic retries STOPPED')));
   265	  assert.match(engine.clear(1), /closed manually/);
   266	});
   267	
   268	test('swap outcome unknown: stuck + paused, never retried automatically', async () => {
   269	  const { engine, db, risk, calls, arrive } = setup({ sendUnknown: true });
   270	  await engine.tick();
   271	  arrive(198.9);
   272	  await engine.tick();
   273	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   274	  assert.equal(risk.paused, true);
   275	  await engine.tick();
   276	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   277	});
   278	
   279	test('withdrawal never arrives: after 2x timeout it stops blocking, but never a 2nd transfer of the same token', async () => {
   280	  let t = Date.UTC(2026, 10, 20, 6);
   281	  const { engine, db, calls, alerts, cfg } = setup({ now: () => t });
   282	  await engine.tick();
   283	  t += (cfg.transferTimeoutMin + 1) * 60_000;
   284	  await engine.tick();
   285	  assert.ok(alerts.some((a) => a.includes('not in wallet after')));
   286	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1); // still blocking
   287	  t += cfg.transferTimeoutMin * 60_000;
   288	  await engine.tick(); // gives up blocking
   289	  assert.equal(db.getTransfer(1)!.alerted_timeout, 2);
   290	  assert.equal(db.getTransfer(1)!.status, 'withdrawing'); // still watched
   291	  await engine.tick();
   292	  // It no longer blocks by COUNT, but a second transfer of the SAME token must never start while
   293	  // the first is still out (they would share one wallet balance).
   294	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1);
   295	  assert.equal(db.blockingTransfers().length, 0);
   296	});
   297	
   298	test('withdraw rejected: sells the tokens back on MEXC and records a failure', async () => {
   299	  const { engine, db, calls, alerts } = setup({ withdrawThrows: true });
   300	  await engine.tick();
   301	  assert.ok(calls.includes('market SELL 199.90'));
   302	  assert.equal(db.openTransfers().length, 0);
   303	  assert.equal(db.statsSince(0, 'live').total.failed, 1);
   304	  assert.ok(alerts.some((a) => a.includes('withdraw rejected')));
   305	});
   306	
   307	test('withdrawal FAILED on MEXC side: sells back on MEXC', async () => {
   308	  const { engine, db, calls, state } = setup();
   309	  await engine.tick();
   310	  state.withdrawStatus = 8;
   311	  state.mexc.XYZ += 199.9; // funds returned to the MEXC account
   312	  await engine.tick();
   313	  assert.ok(calls.includes('market SELL 199.90'));
   314	  assert.ok(!db.openTransfers().some((t) => t.id === 1));
   315	});
   316	
   317	test('gap too small after exact costs: nothing happens', async () => {
   318	  const { engine, calls } = setup({ dexPrice: 1.05 }); // 5% gap, but drift+gas+fees+min $15 eat it
   319	  await engine.tick();
   320	  assert.deepEqual(calls, []);
   321	});
   322	
   323	test('paused bot does not open new transfers', async () => {
   324	  const { engine, risk, calls } = setup();
   325	  risk.pause('Telegram /stop');
   326	  await engine.tick();
   327	  assert.deepEqual(calls, []);
   328	});
   329	
   330	test('paper mode records the opportunity without orders or withdrawals', async () => {
   331	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   332	  await engine.tick();
   333	  assert.deepEqual(calls, []);
   334	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   335	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER TRANSFER XYZ')));
   336	});
   337	
   338	test('loadUniverse respects WATCHLIST', async () => {
   339	  const fake = {
   340	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC')],
   341	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }, { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' }],
   342	    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', '0x3333333333333333333333333333333333333333')],
   343	  };
   344	  const u = await loadUniverse(fake as never, { minVolumeUsd: 1, only: ['ABC'] });
   345	  assert.deepEqual(u.map((t) => t.base), ['ABC']);
   346	});
   347	
   348	test('a dust deposit during the withdrawal is NOT taken as arrival', async () => {
   349	  const { engine, db, alerts, state } = setup();
   350	  await engine.tick();
   351	  state.wallet[XYZ] += 10n ** 15n; // 0.001 XYZ airdrop, MEXC still PROCESSING
   352	  await engine.tick();
   353	  assert.equal(db.getTransfer(1)!.status, 'withdrawing');
   354	  state.withdrawStatus = 7; // MEXC says SUCCESS but only dust arrived
   355	  await engine.tick();
   356	  assert.equal(db.getTransfer(1)!.status, 'withdrawing');
   357	  assert.ok(alerts.some((a) => a.includes('only grew by')));
   358	});
```

## `test/txsender.test.ts`

```ts
     1	// Nonce manager + unresolved-tx handling (round 2 review: R2-P0-2, R2-P0-3, R2-P2-8).
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { DROP_AFTER_MS, TxSender, classifySendError, type TxBackend, type GasInfo } from '../src/dex/txsender.js';
     5	
     6	const gas: GasInfo = { baseFee: 10n, tip: 1n, effective: 11n, maxFee: 21n };
     7	const tx = { to: '0xrouter', data: '0x01' };
     8	
     9	function backend(o: { broadcastError?: unknown; mined?: boolean; confirmed?: number; knows?: boolean } = {}) {
    10	  const state = { confirmed: o.confirmed ?? 5, signed: [] as { nonce: number; to: string; maxFeePerGas: bigint }[], receipts: new Map<string, number>(), gasReads: 0 };
    11	  const b: TxBackend = {
    12	    address: '0xme',
    13	    confirmedNonce: async () => state.confirmed,
    14	    receipt: async (h) => (state.receipts.has(h) ? { status: state.receipts.get(h)!, gasUsed: 100n, gasPrice: 2n } : null),
    15	    knowsTx: async () => o.knows ?? true,
    16	    sign: async (t) => {
    17	      state.signed.push({ nonce: t.nonce, to: t.to, maxFeePerGas: t.maxFeePerGas });
    18	      const hash = `0xh${state.signed.length}`;
    19	      return { raw: `raw-${hash}`, hash };
    20	    },
    21	    broadcast: async (raw) => {
    22	      if (o.broadcastError && raw === 'raw-0xh1') throw o.broadcastError;
    23	      if (o.mined) state.receipts.set(raw.slice(4), 1);
    24	    },
    25	    gas: async () => {
    26	      state.gasReads++;
    27	      return { ...gas, maxFee: 1000n, tip: 50n }; // base fee spiked while we waited
    28	    },
    29	  };
    30	  return { b, state };
    31	}
    32	
    33	const memStore = () => {
    34	  let v: string | undefined;
    35	  return { get: () => v, set: (x: string | null) => (v = x ?? undefined) };
    36	};
    37	
    38	test('classifySendError: clear rejections vs ambiguous vs already-known', () => {
    39	  assert.equal(classifySendError(Object.assign(new Error('insufficient funds for gas * price + value'), { code: 'INSUFFICIENT_FUNDS' })), 'rejected');
    40	  assert.equal(classifySendError(new Error('nonce too low')), 'rejected');
    41	  assert.equal(classifySendError(Object.assign(new Error('rpc error'), { error: { code: -32000, message: 'x' } })), 'rejected');
    42	  assert.equal(classifySendError(Object.assign(new Error('request timeout'), { code: 'TIMEOUT' })), 'ambiguous');
    43	  assert.equal(classifySendError(new Error('socket hang up')), 'ambiguous');
    44	  assert.equal(classifySendError(new Error('already known')), 'accepted');
    45	});
    46	
    47	test('mined tx: ok, nonce counts up locally', async () => {
    48	  const { b, state } = backend({ mined: true });
    49	  const s = new TxSender(b, memStore(), Date.now, async () => {});
    50	  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
    51	  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
    52	  assert.deepEqual(state.signed.map((x) => x.nonce), [5, 6]); // public RPC still says 5: local counter wins
    53	});
    54	
    55	test('RPC rejection: NOT unresolved, nonce reused, next send allowed', async () => {
    56	  const { b, state } = backend({ broadcastError: new Error('insufficient funds for gas'), mined: true });
    57	  const s = new TxSender(b, memStore(), Date.now, async () => {});
    58	  const r = await s.send(tx, 100n, gas, 10);
    59	  assert.equal(r.rejected, true);
    60	  assert.equal(r.unknown, undefined);
    61	  assert.equal(s.unresolved, null);
    62	  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
    63	  assert.deepEqual(state.signed.map((x) => x.nonce), [5, 5]);
    64	});
    65	
    66	test('ambiguous send error: unresolved, next send refused (not counted as an attempt)', async () => {
    67	  const { b } = backend({ broadcastError: Object.assign(new Error('timeout'), { code: 'TIMEOUT' }) });
    68	  const s = new TxSender(b, memStore(), Date.now, async () => {});
    69	  const r = await s.send(tx, 100n, gas, 10);
    70	  assert.equal(r.unknown, true);
    71	  assert.equal(s.unresolved?.nonce, 5);
    72	  const r2 = await s.send(tx, 100n, gas, 10);
    73	  assert.equal(r2.refused, true);
    74	});
    75	
    76	test('restart with a pending tx: the persisted record still blocks sends', async () => {
    77	  const store = memStore();
    78	  const first = backend({ broadcastError: new Error('ECONNRESET') });
    79	  await new TxSender(first.b, store, Date.now, async () => {}).send(tx, 100n, gas, 10);
    80	  // "restart": a brand new sender, same store
    81	  const again = backend({ mined: true });
    82	  const s2 = new TxSender(again.b, store, Date.now, async () => {});
    83	  assert.equal(s2.unresolved?.nonce, 5);
    84	  assert.equal((await s2.send(tx, 100n, gas, 10)).refused, true);
    85	  assert.equal(again.state.signed.length, 0); // the pending nonce was NOT reused
    86	});
    87	
    88	test('unresolved clears when mined, when the nonce is consumed, or when every RPC dropped it', async () => {
    89	  let t = 1_000_000;
    90	  const store = memStore();
    91	  const { b, state } = backend({ broadcastError: new Error('ECONNRESET'), knows: false });
    92	  const s = new TxSender(b, store, () => t, async (ms) => void (t += ms)); // fake clock advances on sleep
    93	  await s.send(tx, 100n, gas, 10);
    94	  assert.equal((await s.checkUnresolved()).state, 'pending'); // too early to call it dropped
    95	  t += DROP_AFTER_MS + 1;
    96	  const c = await s.checkUnresolved();
    97	  assert.equal(c.state, 'clear');
    98	  assert.equal(c.dropped, true);
    99	
   100	  await s.send(tx, 100n, gas, 10).catch(() => {});
   101	  state.confirmed = 99; // someone mined that nonce
   102	  assert.equal((await s.checkUnresolved()).state, 'clear');
   103	});
   104	
   105	test('not mined in time: cancel is priced from FRESH gas, outcome unknown if neither mines', async () => {
   106	  let t = 0;
   107	  const { b, state } = backend();
   108	  const s = new TxSender(b, memStore(), () => t, async (ms) => void (t += ms));
   109	  const r = await s.send(tx, 100n, gas, 10);
   110	  assert.equal(r.unknown, true);
   111	  assert.equal(state.signed[1].to, '0xme'); // the cancel: 0-value self transfer, same nonce
   112	  assert.equal(state.signed[1].nonce, 5);
   113	  assert.ok(state.signed[1].maxFeePerGas >= 1300n); // 1.3 x the spiked fee, not the stale one
   114	  assert.equal(s.unresolved?.hashes.length, 2);
   115	});
```

