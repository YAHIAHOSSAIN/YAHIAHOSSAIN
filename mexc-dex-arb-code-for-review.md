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
    53	MIN_PROFIT_USD=15
    54	MIN_PROFIT_PCT=0.5
    55	DEX_SLIPPAGE_BPS=30
    56	CEX_SLIPPAGE_BPS=20
    57	SAFETY_MARGIN_USD=2
    58	PRIORITY_FEE_GWEI=1
    59	
    60	# ---------- Risk limits ----------
    61	MAX_TRADE_USD=50
    62	MIN_TRADE_USD=25
    63	MAX_TRADES_PER_DAY=20
    64	DAILY_LOSS_LIMIT_USD=30
    65	# Skip a trade if losing this % of its size (+ gas) would break what is left of the daily loss budget
    66	WORST_CASE_LOSS_PCT=5
    67	MAX_GAS_GWEI=40
    68	MAX_CONSECUTIVE_FAILS=3
    69	MIN_ETH_FOR_GAS=0.01
    70	TX_TIMEOUT_SEC=60
    71	
    72	# ---------- Transfer strategy ----------
    73	SCAN_INTERVAL_SEC=20
    74	# Cheap pre-filter (MEXC ask vs DexScreener price) before exact quotes
    75	SCAN_MIN_GAP_PCT=3
    76	# Bigger "gaps" are almost always a wrong token or a dead pool
    77	SCAN_MAX_GAP_PCT=30
    78	SCAN_EXACT_QUOTES=5
    79	# Price-move reserve while the withdrawal travels (150 = 1.5%)
    80	TRANSFER_DRIFT_BPS=150
    81	TRANSFER_TIMEOUT_MIN=90
    82	MAX_OPEN_TRANSFERS=1
    83	# On arrival, do not auto-sell at more than this % loss vs the MEXC cost: hold + alert (/sell <id> forces)
    84	TRANSFER_MAX_LOSS_PCT=3
    85	
    86	DB_PATH=data/bot.sqlite
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
    66	    minProfitUsd: num('MIN_PROFIT_USD', 15),
    67	    minProfitPct: num('MIN_PROFIT_PCT', 0.5), // percent of trade size
    68	    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
    69	    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 20),
    70	    safetyMarginUsd: num('SAFETY_MARGIN_USD', 2),
    71	    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
    72	    // --- Risk limits ---
    73	    maxTradeUsd: num('MAX_TRADE_USD', 50),
    74	    minTradeUsd: num('MIN_TRADE_USD', 25),
    75	    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
    76	    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
    77	    // Skip a trade if losing this % of its size (+ gas) would break the remaining daily loss budget.
    78	    worstCaseLossPct: num('WORST_CASE_LOSS_PCT', 5),
    79	    maxGasGwei: num('MAX_GAS_GWEI', 40),
    80	    maxConsecutiveFails: num('MAX_CONSECUTIVE_FAILS', 3),
    81	    minEthForGas: num('MIN_ETH_FOR_GAS', 0.01),
    82	    txTimeoutSec: num('TX_TIMEOUT_SEC', 60),
    83	    // --- Transfer strategy (scanner) ---
    84	    scanIntervalSec: num('SCAN_INTERVAL_SEC', 20),
    85	    scanMinGapPct: num('SCAN_MIN_GAP_PCT', 3), // cheap pre-filter before exact quotes
    86	    scanMaxGapPct: num('SCAN_MAX_GAP_PCT', 30), // bigger gaps are almost always a wrong token / dead pool
    87	    scanExactQuotes: num('SCAN_EXACT_QUOTES', 5), // max exact DEX quotes per scan
    88	    transferDriftBps: num('TRANSFER_DRIFT_BPS', 150), // price-move reserve while withdrawing
    89	    transferTimeoutMin: num('TRANSFER_TIMEOUT_MIN', 90),
    90	    maxOpenTransfers: num('MAX_OPEN_TRANSFERS', 1),
    91	    // After arrival, do not sell automatically if it would lose more than this % of the cost: hold + alert.
    92	    transferMaxLossPct: num('TRANSFER_MAX_LOSS_PCT', 3),
    93	    // --- Misc ---
    94	    dbPath: str('DB_PATH', 'data/bot.sqlite'),
    95	    envPath: str('ENV_PATH', '.env'),
    96	  };
    97	}
    98	
    99	export type Config = ReturnType<typeof loadConfig>;
   100	
   101	/** Reject settings that would make the bot trade backwards or without limits. */
   102	export function validateConfig(c: Config): Config {
   103	  const errs: string[] = [];
   104	  const range = (name: string, v: number, min: number, max: number) => {
   105	    if (!(v >= min && v <= max)) errs.push(`${name}=${v} must be between ${min} and ${max}`);
   106	  };
   107	  range('MIN_PROFIT_USD', c.minProfitUsd, 0, 1e6);
   108	  range('MIN_PROFIT_PCT', c.minProfitPct, 0, 100);
   109	  range('DEX_SLIPPAGE_BPS', c.dexSlippageBps, 1, 500);
   110	  range('CEX_SLIPPAGE_BPS', c.cexSlippageBps, 0, 500);
   111	  range('SAFETY_MARGIN_USD', c.safetyMarginUsd, 0, 1e6);
   112	  range('MEXC_TAKER_FEE', c.mexcTakerFee, 0, 0.01);
   113	  range('MAX_TRADE_USD', c.maxTradeUsd, 1, 1e7);
   114	  range('MIN_TRADE_USD', c.minTradeUsd, 1, c.maxTradeUsd);
   115	  range('MAX_TRADES_PER_DAY', c.maxTradesPerDay, 1, 10_000);
   116	  range('DAILY_LOSS_LIMIT_USD', c.dailyLossLimitUsd, 0.01, 1e7);
   117	  range('WORST_CASE_LOSS_PCT', c.worstCaseLossPct, 0, 100);
   118	  range('MAX_GAS_GWEI', c.maxGasGwei, 0.01, 1000);
   119	  range('MAX_CONSECUTIVE_FAILS', c.maxConsecutiveFails, 1, 100);
   120	  range('TX_TIMEOUT_SEC', c.txTimeoutSec, 12, 600);
   121	  range('SCAN_INTERVAL_SEC', c.scanIntervalSec, 5, 3600);
   122	  range('SCAN_MIN_GAP_PCT', c.scanMinGapPct, 0, c.scanMaxGapPct);
   123	  range('SCAN_MAX_GAP_PCT', c.scanMaxGapPct, c.scanMinGapPct, 100);
   124	  range('TRANSFER_DRIFT_BPS', c.transferDriftBps, 0, 5000);
   125	  range('TRANSFER_TIMEOUT_MIN', c.transferTimeoutMin, 5, 24 * 60);
   126	  range('TRANSFER_MAX_LOSS_PCT', c.transferMaxLossPct, 0, 100);
   127	  range('MAX_OPEN_TRANSFERS', c.maxOpenTransfers, 1, 10);
   128	  if (errs.length) throw new Error(`Invalid config:\n  ${errs.join('\n  ')}`);
   129	  return c;
   130	}
   131	
   132	/** Every secret value, so the logger can scrub them from any output. */
   133	export function secretsOf(cfg: Config): string[] {
   134	  // RPC URLs usually embed a provider API key (Alchemy/Infura), so they are secrets too.
   135	  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken, cfg.rpcUrl, cfg.sendRpcUrl]
   136	    .filter((s) => s && s.length >= 8)
   137	    .flatMap((s) => [s, s.replace(/^0x/, '')]);
   138	}
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
    62	}
    63	
    64	const TRANSFER_MIGRATIONS = [
    65	  'ALTER TABLE transfers ADD COLUMN withdraw_fee REAL NOT NULL DEFAULT 0',
    66	  'ALTER TABLE transfers ADD COLUMN next_try INTEGER NOT NULL DEFAULT 0',
    67	  'ALTER TABLE transfers ADD COLUMN force_sell INTEGER NOT NULL DEFAULT 0',
    68	  'ALTER TABLE transfers ADD COLUMN hold_alerted INTEGER NOT NULL DEFAULT 0',
    69	];
    70	
    71	export class Db {
    72	  private db: Database.Database;
    73	
    74	  constructor(file: string) {
    75	    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    76	    this.db = new Database(file);
    77	    this.db.pragma('journal_mode = WAL');
    78	    this.db.exec(`
    79	      CREATE TABLE IF NOT EXISTS trades (
    80	        id INTEGER PRIMARY KEY AUTOINCREMENT,
    81	        ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
    82	        symbol TEXT NOT NULL, direction TEXT NOT NULL,
    83	        size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
    84	        expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL,
    85	        status TEXT NOT NULL, dex_tx TEXT, cex_order_id TEXT, note TEXT
    86	      );
    87	      CREATE INDEX IF NOT EXISTS trades_day ON trades(day, mode);
    88	      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    89	      CREATE TABLE IF NOT EXISTS transfers (
    90	        id INTEGER PRIMARY KEY AUTOINCREMENT,
    91	        ts INTEGER NOT NULL, updated INTEGER NOT NULL,
    92	        base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL,
    93	        net_work TEXT NOT NULL, qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL,
    94	        status TEXT NOT NULL, buy_qty REAL, cost_usd REAL, buy_order_id TEXT,
    95	        withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT,
    96	        usdc_out REAL, gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL,
    97	        sell_attempts INTEGER NOT NULL DEFAULT 0, alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT
    98	      );
    99	    `);
   100	    const cols = new Set((this.db.prepare('PRAGMA table_info(transfers)').all() as { name: string }[]).map((c) => c.name));
   101	    for (const m of TRANSFER_MIGRATIONS) {
   102	      const col = m.split(' ')[5];
   103	      if (!cols.has(col)) this.db.exec(m);
   104	    }
   105	  }
   106	
   107	  insertTrade(t: TradeRow): number {
   108	    return Number(this.db
   109	      .prepare(
   110	        `INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net,
   111	          cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note)
   112	         VALUES (@ts, @day, @mode, @symbol, @direction, @size_usd, @qty, @buy_price, @sell_price, @expected_net,
   113	          @cex_fee_usd, @gas_usd, @pnl_usd, @status, @dex_tx, @cex_order_id, @note)`,
   114	      )
   115	      .run(t).lastInsertRowid);
   116	  }
   117	
   118	  updateTrade(id: number, fields: Partial<TradeRow>): void {
   119	    const cols = Object.keys(fields);
   120	    if (!cols.length) return;
   121	    this.db.prepare(`UPDATE trades SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
   122	  }
   123	
   124	  /** Trades that were in flight when the bot stopped. */
   125	  executingTrades(): (TradeRow & { id: number })[] {
   126	    return this.db.prepare(`SELECT * FROM trades WHERE status = 'executing' ORDER BY id`).all() as (TradeRow & { id: number })[];
   127	  }
   128	
   129	  dayStats(day: string, mode: string): { trades: number; pnl: number; gas: number; failed: number } {
   130	    const r = this.db
   131	      .prepare(
   132	        `SELECT SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades,
   133	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   134	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   135	         FROM trades WHERE day = ? AND mode = ?`,
   136	      )
   137	      .get(day, mode) as { trades: number | null; pnl: number; gas: number; failed: number | null };
   138	    return { trades: r.trades ?? 0, pnl: r.pnl, gas: r.gas, failed: r.failed ?? 0 };
   139	  }
   140	
   141	  /** Stats since a timestamp, overall and per symbol. */
   142	  statsSince(sinceTs: number, mode?: string) {
   143	    const where = mode ? 'ts >= ? AND mode = ?' : 'ts >= ?';
   144	    const args = mode ? [sinceTs, mode] : [sinceTs];
   145	    const total = this.db
   146	      .prepare(
   147	        `SELECT COALESCE(SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END),0) trades,
   148	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   149	                COALESCE(SUM(cex_fee_usd),0) fees,
   150	                COALESCE(SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END),0) failed
   151	         FROM trades WHERE ${where}`,
   152	      )
   153	      .get(...args) as { trades: number; pnl: number; gas: number; fees: number; failed: number };
   154	    const bySymbol = this.db
   155	      .prepare(
   156	        `SELECT symbol, SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades, SUM(pnl_usd) pnl, SUM(gas_usd) gas,
   157	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   158	         FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`,
   159	      )
   160	      .all(...args) as { symbol: string; trades: number; pnl: number; gas: number; failed: number }[];
   161	    return { total, bySymbol };
   162	  }
   163	
   164	  insertTransfer(t: TransferRow): number {
   165	    const cols = Object.keys(t).filter((k) => k !== 'id');
   166	    const r = this.db
   167	      .prepare(`INSERT INTO transfers (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
   168	      .run(t);
   169	    return Number(r.lastInsertRowid);
   170	  }
   171	
   172	  updateTransfer(id: number, fields: Partial<TransferRow>): void {
   173	    const f = { ...fields, updated: Date.now() };
   174	    const cols = Object.keys(f).filter((k) => k !== 'id');
   175	    this.db.prepare(`UPDATE transfers SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...f, id });
   176	  }
   177	
   178	  /** Transfers the bot still works on automatically ('stuck' waits for a human: /sell or /clear). */
   179	  openTransfers(): TransferRow[] {
   180	    return this.db.prepare(`SELECT * FROM transfers WHERE status IN ('buying','withdrawing','selling') ORDER BY id`).all() as TransferRow[];
   181	  }
   182	
   183	  /** Transfers that hold back new trades (open, and not given up on). */
   184	  blockingTransfers(): TransferRow[] {
   185	    return this.openTransfers().filter((t) => t.alerted_timeout < 2);
   186	  }
   187	
   188	  stuckTransfers(): TransferRow[] {
   189	    return this.db.prepare(`SELECT * FROM transfers WHERE status = 'stuck' ORDER BY id`).all() as TransferRow[];
   190	  }
   191	
   192	  getTransfer(id: number): TransferRow | undefined {
   193	    return this.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as TransferRow | undefined;
   194	  }
   195	
   196	  getState(key: string): string | undefined {
   197	    return (this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined)?.value;
   198	  }
   199	
   200	  setState(key: string, value: string): void {
   201	    this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
   202	  }
   203	
   204	  close(): void {
   205	    this.db.close();
   206	  }
   207	}
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
    22	import { orderProblem } from './mexc/rules.js';
    23	
    24	/** A close/unwind that only partly filled: `remaining` is what is still open. */
    25	export class PartialCloseError extends Error {
    26	  constructor(msg: string, readonly remaining: number) {
    27	    super(msg);
    28	  }
    29	}
    30	
    31	/** Unique id we give MEXC orders, so an order can be found even if the request timed out. */
    32	export const clientId = (tag: string) => `arb${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.slice(0, 32);
    33	
    34	/**
    35	 * Place an order; if the request is ambiguous (timeout / 5xx) look it up by client id
    36	 * instead of assuming it was not placed. Throws UNKNOWN_ORDER_STATE if that is impossible.
    37	 */
    38	export async function placeSafely(
    39	  mexc: Pick<CexApi, 'getOrderByClientId'>,
    40	  symbol: string,
    41	  cid: string,
    42	  place: () => Promise<{ orderId: string }>,
    43	  sleep: (ms: number) => Promise<void>,
    44	): Promise<{ orderId: string }> {
    45	  try {
    46	    return await place();
    47	  } catch (e) {
    48	    if (!(e instanceof AmbiguousRequestError)) throw e; // clearly rejected: nothing was placed
    49	    let notFound = 0;
    50	    for (let i = 0; i < 5; i++) {
    51	      await sleep(1000);
    52	      let o: Order | null;
    53	      try {
    54	        o = await mexc.getOrderByClientId(symbol, cid);
    55	      } catch {
    56	        continue; // lookup itself failed: try again
    57	      }
    58	      if (o) return { orderId: o.orderId }; // it WAS placed
    59	      if (++notFound >= 3) throw e; // MEXC says three times that no such order exists
    60	    }
    61	    throw new Error(`UNKNOWN_ORDER_STATE client id ${cid}: ${errMsg(e)}`);
    62	  }
    63	}
    64	import { decimalsOfStep, dhakaDay, sleep as realSleep, toFloat, toUnits, usd } from './util.js';
    65	
    66	export const USDC_DECIMALS = 6;
    67	export { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
    68	import { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
    69	const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
    70	
    71	// Narrow interfaces so tests can plug in fakes.
    72	export interface CexApi {
    73	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
    74	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
    75	  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
    76	  getOrder(symbol: string, orderId: string): Promise<Order>;
    77	  cancelOrder(symbol: string, orderId: string): Promise<Order>;
    78	}
    79	export interface ChainApi {
    80	  readonly address: string;
    81	  gas(): Promise<GasInfo>;
    82	  approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint>;
    83	  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
    84	  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
    85	  send(
    86	    tx: { to: string; data: string; value?: bigint },
    87	    gasLimit: bigint,
    88	    gas: GasInfo,
    89	    timeoutSec: number,
    90	    onSigned?: (hash: string, nonce: number) => void,
    91	  ): Promise<TxResult>;
    92	  /** Unresolved earlier tx (outcome unknown): no new trades until it is 'clear'. */
    93	  checkUnresolved?(): Promise<{ state: 'clear' | 'pending' }>;
    94	}
    95	export interface Notifier {
    96	  send(text: string): Promise<void>;
    97	}
    98	
    99	export interface EngineDeps {
   100	  cfg: Config;
   101	  mexc: CexApi;
   102	  chain: ChainApi;
   103	  agg: Aggregator;
   104	  db: Db;
   105	  risk: Risk;
   106	  tg: Notifier;
   107	  book: (symbol: string) => Promise<Book>;
   108	  /** Authoritative book (REST) used for the final check right before trading; defaults to `book`. */
   109	  freshBook?: (symbol: string) => Promise<Book>;
   110	  /** total=true: free + locked MEXC balances (for exact PnL); default free (for sizing). */
   111	  balances: (total?: boolean) => Promise<Balances>;
   112	  tokens: Token[];
   113	  sleep?: (ms: number) => Promise<void>;
   114	}
   115	
   116	export interface Candidate {
   117	  token: Token;
   118	  opp: Opportunity;
   119	  req: QuoteRequest;
   120	  spender: string;
   121	  approvalGas: bigint;
   122	  tokenUsd: number;
   123	}
   124	
   125	const mid = (b: Book) => (b.bids[0][0] + b.asks[0][0]) / 2;
   126	
   127	export class Engine {
   128	  private lastNote = new Map<string, string>();
   129	  private lastAlert = new Map<string, number>();
   130	  private sleep: (ms: number) => Promise<void>;
   131	  lastGasGwei = 0;
   132	
   133	  constructor(private d: EngineDeps) {
   134	    this.sleep = d.sleep ?? realSleep;
   135	  }
   136	
   137	  private get cfg() {
   138	    return this.d.cfg;
   139	  }
   140	  private get live() {
   141	    return this.cfg.mode === 'live';
   142	  }
   143	  private get taker() {
   144	    return this.live ? this.d.chain.address : PAPER_TAKER;
   145	  }
   146	  private costs() {
   147	    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
   148	  }
   149	  private need(sizeUsd: number) {
   150	    return threshold(sizeUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
   151	  }
   152	
   153	  /** Log a status line only when it changes (avoids spamming every block). */
   154	  private note(key: string, msg: string) {
   155	    if (this.lastNote.get(key) !== msg) {
   156	      this.lastNote.set(key, msg);
   157	      log.info(msg);
   158	    }
   159	  }
   160	
   161	  async alertThrottled(key: string, text: string, everyMs = 6 * 3600_000) {
   162	    const last = this.lastAlert.get(key) ?? 0;
   163	    if (Date.now() - last < everyMs) return;
   164	    this.lastAlert.set(key, Date.now());
   165	    await this.d.tg.send(text);
   166	  }
   167	
   168	  /** One scan; executes at most one trade. */
   169	  async tick(): Promise<void> {
   170	    const block = this.d.risk.blockReason();
   171	    if (block) return this.note('block', `trading blocked: ${block}`);
   172	    this.note('block', 'trading enabled');
   173	
   174	    if (this.d.chain.checkUnresolved && (await this.d.chain.checkUnresolved()).state === 'pending') {
   175	      return this.note('unresolved', 'an earlier DEX tx is still unresolved: no new trades until it is mined or replaced');
   176	    }
   177	    this.note('unresolved', 'no unresolved tx');
   178	
   179	    const gas = await this.d.chain.gas();
   180	    this.lastGasGwei = Number(gas.effective) / 1e9;
   181	    if (this.lastGasGwei > this.cfg.maxGasGwei) {
   182	      return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > MAX_GAS_GWEI ${this.cfg.maxGasGwei}, waiting`);
   183	    }
   184	    this.note('gas', 'gas ok');
   185	
   186	    const ethUsd = mid(await this.d.book('ETHUSDT'));
   187	    const bal = await this.d.balances();
   188	    const books = new Map<string, Book>();
   189	    const prices: Record<string, number> = {};
   190	    for (const t of this.d.tokens) {
   191	      try {
   192	        const b = await this.d.book(t.symbol);
   193	        if (b.bids.length && b.asks.length) {
   194	          books.set(t.symbol, b);
   195	          prices[t.base] = mid(b);
   196	        }
   197	      } catch (e) {
   198	        log.warn(`${t.symbol} book: ${errMsg(e)}`);
   199	      }
   200	    }
   201	
   202	    if (this.live) {
   203	      for (const w of inventoryWarnings(bal, this.d.tokens, prices, this.cfg.minTradeUsd, this.cfg.minEthForGas)) {
   204	        await this.alertThrottled(`inv-${w.key}`, `📦 Inventory: ${w.text}`);
   205	      }
   206	    }
   207	
   208	    let best: Candidate | null = null;
   209	    for (const t of this.d.tokens) {
   210	      const b = books.get(t.symbol);
   211	      if (!b) continue;
   212	      if (!t.depositOk || !t.withdrawOk) {
   213	        this.note(`susp-${t.base}`, `${t.base}: MEXC deposit/withdraw suspended, skipping`);
   214	        continue;
   215	      }
   216	      this.note(`susp-${t.base}`, `${t.base}: active`);
   217	      try {
   218	        for (const c of await this.candidates(t, b, bal, gas, ethUsd)) {
   219	          log.info(`${t.base} ${c.opp.direction} size ${usd(c.opp.sizeUsd)} net ${usd(c.opp.net)} (need ${usd(this.need(c.opp.sizeUsd))})`);
   220	          if (c.opp.net > this.need(c.opp.sizeUsd) && (!best || c.opp.net > best.opp.net)) best = c;
   221	        }
   222	      } catch (e) {
   223	        log.warn(`${t.base} quote: ${errMsg(e)}`);
   224	      }
   225	    }
   226	    if (best) await this.execute(best, gas, ethUsd);
   227	  }
   228	
   229	  /** Indicative opportunities in both directions for one token. */
   230	  async candidates(t: Token, b: Book, bal: Balances, gas: GasInfo, ethUsd: number): Promise<Candidate[]> {
   231	    const out: Candidate[] = [];
   232	    const bestBid = b.bids[0][0];
   233	    const tokenUsd = mid(b);
   234	    const cexTok = bal.mexc[t.base] ?? 0;
   235	    const walTok = bal.walletToken[t.base] ?? 0;
   236	    const slippageBps = this.cfg.dexSlippageBps;
   237	
   238	    // DEX_BUY: USDC -> token on DEX, token -> USDT on MEXC.
   239	    const sizeA = Math.floor(Math.min(this.cfg.maxTradeUsd, bal.walletUsdc * 0.99, cexTok * bestBid * 0.99) * 100) / 100;
   240	    if (sizeA >= this.cfg.minTradeUsd) {
   241	      const req = { sellToken: this.cfg.usdc, buyToken: t.address, sellAmount: toUnits(sizeA, USDC_DECIMALS), taker: this.taker, slippageBps };
   242	      const q = await this.d.agg.price(req);
   243	      const spender = this.spenderOf(q);
   244	      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   245	      const opp = evaluateDexBuy({
   246	        sizeUsd: sizeA,
   247	        tokensOut: toFloat(q.buyAmount, t.decimals),
   248	        tokensMin: toFloat(q.minBuyAmount, t.decimals),
   249	        bids: b.bids,
   250	        qtyStep: t.qtyStep,
   251	        gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
   252	        costs: this.costs(),
   253	      });
   254	      const problem = opp && orderProblem(t.rules, 'SELL', opp.cexQty, opp.cexLimitPrice);
   255	      if (problem) this.note(`rule-${t.base}-A`, `${t.base} DEX_BUY skipped: MEXC would reject the sell (${problem})`);
   256	      else if (opp && opp.cexQty <= cexTok) out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
   257	    }
   258	
   259	    // CEX_BUY: USDT -> token on MEXC, token -> USDC on DEX.
   260	    const sizeB = Math.min(this.cfg.maxTradeUsd, (bal.mexc.USDT ?? 0) * 0.99, walTok * bestBid * 0.99);
   261	    if (sizeB >= this.cfg.minTradeUsd) {
   262	      const plan = planCexBuy({ sizeUsd: sizeB, asks: b.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
   263	      if (plan && plan.tokensToSell <= walTok) {
   264	        const req = { sellToken: t.address, buyToken: this.cfg.usdc, sellAmount: toUnits(plan.tokensToSell, t.decimals), taker: this.taker, slippageBps };
   265	        const q = await this.d.agg.price(req);
   266	        const spender = this.spenderOf(q);
   267	        const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   268	        const opp = evaluateCexBuy({
   269	          plan,
   270	          usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
   271	          usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
   272	          gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
   273	          costs: this.costs(),
   274	        });
   275	        const problem = orderProblem(t.rules, 'BUY', opp.cexQty, opp.cexLimitPrice);
   276	        if (problem) this.note(`rule-${t.base}-B`, `${t.base} CEX_BUY skipped: MEXC would reject the buy (${problem})`);
   277	        else out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
   278	      }
   279	    }
   280	    return out;
   281	  }
   282	
   283	  private spenderOf(q: Quote): string {
   284	    if (q.spender) return q.spender;
   285	    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
   286	    throw new Error('aggregator did not return a spender');
   287	  }
   288	
   289	  /** Re-check with a firm quote + simulation, then trade both legs at once. */
   290	  async execute(c: Candidate, gas: GasInfo, ethUsd: number): Promise<void> {
   291	    const { token: t } = c;
   292	    if (!this.live) return this.recordPaper(c);
   293	
   294	    let approvalCostWei = 0n;
   295	    const skip = async (why: string) => {
   296	      log.info(`${t.base} skip: ${why}`);
   297	      if (approvalCostWei > 0n) {
   298	        // The approval gas was really spent; book it so PnL and the loss limit stay honest.
   299	        const g = (Number(approvalCostWei) / 1e18) * ethUsd;
   300	        this.record(c, 'approval', { pnl: -g, gas: g, note: `approval, then skipped: ${why}` });
   301	      }
   302	    };
   303	
   304	    // 0) Worst case must fit in what is left of today's loss budget.
   305	    const worst = (c.opp.sizeUsd * this.cfg.worstCaseLossPct) / 100 + c.opp.gasUsd;
   306	    const budget = this.d.risk.remainingLossBudget();
   307	    if (worst > budget) return skip(`worst case ${usd(worst)} > remaining daily loss budget ${usd(budget)}`);
   308	
   309	    // Snapshot BEFORE the approval, so approval gas is part of the measured PnL.
   310	    const before = await this.d.balances(true);
   311	
   312	    // 1) Exact approval (never unlimited).
   313	    if (c.approvalGas > 0n) {
   314	      const r = await this.d.chain.approveExact(c.req.sellToken, c.spender, c.req.sellAmount, gas);
   315	      approvalCostWei = r.gasCostWei;
   316	      if (!r.ok) {
   317	        await skip(`approval failed (${r.reason})`);
   318	        await this.d.tg.send(`⚠️ Approval failed for ${t.base}: ${r.reason} ${r.hash ?? ''}`);
   319	        return;
   320	      }
   321	    }
   322	
   323	    // 2) Firm quote + simulation (eth_call). Abort on any doubt.
   324	    let firm: Quote;
   325	    let gasEst: bigint;
   326	    try {
   327	      firm = await this.d.agg.quote(c.req);
   328	      if (!firm.tx) return skip('firm quote has no transaction');
   329	      gasEst = await this.d.chain.simulate(firm.tx);
   330	    } catch (e) {
   331	      return skip(`simulation/quote failed: ${errMsg(e)}`);
   332	    }
   333	    const tx = firm.tx;
   334	
   335	    // 3) Re-evaluate with a fresh REST book, firm amounts and simulated gas.
   336	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   337	    const g = gasUsd(gasEst, gas.effective, ethUsd);
   338	    let opp: Opportunity | null;
   339	    if (c.opp.direction === 'DEX_BUY') {
   340	      opp = evaluateDexBuy({
   341	        sizeUsd: c.opp.sizeUsd,
   342	        tokensOut: toFloat(firm.buyAmount, t.decimals),
   343	        tokensMin: toFloat(firm.minBuyAmount, t.decimals),
   344	        bids: b.bids,
   345	        qtyStep: t.qtyStep,
   346	        gasUsd: g,
   347	        costs: this.costs(),
   348	      });
   349	    } else {
   350	      // Same quantity as quoted on the DEX, priced against the fresh MEXC book.
   351	      const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.cfg.mexcTakerFee);
   352	      opp = plan
   353	        ? evaluateCexBuy({
   354	            plan,
   355	            usdcOut: toFloat(firm.buyAmount, USDC_DECIMALS),
   356	            usdcMin: toFloat(firm.minBuyAmount, USDC_DECIMALS),
   357	            gasUsd: g,
   358	            costs: this.costs(),
   359	          })
   360	        : null;
   361	    }
   362	    const need = this.need(c.opp.sizeUsd);
   363	    if (!opp || opp.net <= need) return skip(`profit fell to ${usd(opp?.net ?? 0)} after firm quote (need ${usd(need)})`);
   364	    // MEXC symbol rules on the FINAL numbers, before anything is sent: a rejected MEXC leg after a sent DEX tx = one-sided.
   365	    const problem = orderProblem(t.rules, opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY', opp.cexQty, opp.cexLimitPrice);
   366	    if (problem) return skip(`MEXC would reject the order: ${problem}`);
   367	
   368	    // 4) Persist the trade as 'executing' BEFORE anything is sent: if the bot dies now, startup sees it.
   369	    const cid = clientId('t');
   370	    const tradeId = this.record({ ...c, opp }, 'executing', { pnl: 0, gas: 0, orderId: cid, note: `client order id ${cid}` });
   371	
   372	    // Both legs are sent together. They do NOT complete together: the MEXC order fills in ~1.5s,
   373	    // the DEX tx needs 12-60s to be mined. If the DEX side fails in between, step 5 unwinds on MEXC.
   374	    log.info(`${t.base} EXECUTE ${opp.direction} size ${usd(opp.sizeUsd)} expected ${usd(opp.net)}`);
   375	    const [cexR, dexR] = await Promise.allSettled([
   376	      this.cexLeg(t, opp, cid),
   377	      this.d.chain.send(tx, (gasEst * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash, nonce) =>
   378	        this.d.db.updateTrade(tradeId, { dex_tx: hash, note: `client order id ${cid}; nonce ${nonce}` }),
   379	      ),
   380	    ]);
   381	
   382	    const dex: TxResult = dexR.status === 'fulfilled' ? dexR.value : { ok: false, gasCostWei: 0n, reason: errMsg(dexR.reason) };
   383	    let cexFilled = 0;
   384	    let orderId: string | null = null;
   385	    let cexUnknown = false;
   386	    if (cexR.status === 'fulfilled') {
   387	      cexFilled = cexR.value.filled;
   388	      orderId = cexR.value.orderId;
   389	    } else if (String((cexR.reason as Error)?.message ?? '').startsWith('UNKNOWN_ORDER_STATE')) {
   390	      cexUnknown = true;
   391	      this.d.risk.pause('MEXC order state unknown', true);
   392	      await this.d.tg.send(`🚨 ${t.base}: MEXC order state unknown after placing. Trading PAUSED. Check MEXC manually.\n${errMsg(cexR.reason)}`);
   393	    } else {
   394	      log.warn(`${t.base} MEXC leg failed: ${errMsg(cexR.reason)}`);
   395	    }
   396	
   397	    // 5) One-sided? Close the open position at market right away.
   398	    let status: TradeStatus = 'ok';
   399	    const notes: string[] = [];
   400	    if (!dex.ok) notes.push(`DEX: ${dex.reason}`);
   401	    if (dex.unknown) {
   402	      // We cannot tell if the swap executed. Unwinding could DOUBLE the position. Stop and ask a human.
   403	      this.d.risk.pause(`DEX tx unknown ${dex.hash}`, true);
   404	      await this.d.tg.send(
   405	        `🚨 ${t.base}: DEX tx ${dex.hash} outcome UNKNOWN (not mined, cancel not confirmed). MEXC filled ${cexFilled}/${opp.cexQty}.\n` +
   406	          `NOT unwinding automatically. Trading PAUSED. Check the wallet on etherscan, fix by hand, then /start confirm.`,
   407	      );
   408	    }
   409	    const unwind = cexUnknown || dex.unknown ? null : unwindPlan(opp.direction, dex.ok, opp.cexQty, cexFilled, this.cfg.mexcTakerFee, t.qtyStep);
   410	    if (cexUnknown || dex.unknown) {
   411	      status = 'one_sided';
   412	    } else if (unwind) {
   413	      status = 'one_sided';
   414	      const qty = unwind.qty.toFixed(decimalsOfStep(t.qtyStep));
   415	      try {
   416	        const r = await this.closeAtMarket(t, unwind.side, qty);
   417	        if (r.dust) {
   418	          notes.push(`unwind ${unwind.side} ${qty} not sent: ${r.dust}`);
   419	          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base}: leftover ${unwind.side} ${qty} is below MEXC minimums (${r.dust}). Left as dust; fix inventory by hand.`);
   420	        } else {
   421	          notes.push(`unwind ${unwind.side} ${qty} (${r.orderId}, filled ${r.filled})`);
   422	          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base} ${opp.direction}\n${unwind.reason}\nClosed: MEXC ${unwind.side} ${r.filled} ${t.base}`);
   423	        }
   424	      } catch (e) {
   425	        const remaining = e instanceof PartialCloseError ? e.remaining : Number(qty);
   426	        this.d.risk.pause(`unwind failed for ${t.base}`, true);
   427	        notes.push(`UNWIND FAILED: ${errMsg(e)}`);
   428	        await this.d.tg.send(
   429	          `🚨 ONE-SIDED FILL ${t.base} and the market close FAILED: ${errMsg(e)}\n` +
   430	            `Still open: MEXC ${unwind.side} ${remaining} ${t.base} needed.\nTrading PAUSED. Close it manually, then /start confirm.`,
   431	        );
   432	      }
   433	    } else if (!dex.ok) {
   434	      status = 'dex_failed'; // nothing filled on either side
   435	    }
   436	
   437	    // 6) Exact PnL = change in total value of everything the trade touched, at pre-trade prices.
   438	    //    Orders are closed (filled/cancelled) by now; free + locked balances avoid counting held funds as lost.
   439	    await this.sleep(2500);
   440	    const after = await this.d.balances(true);
   441	    const pnl = portfolioUsd(after, t, c.tokenUsd, ethUsd) - portfolioUsd(before, t, c.tokenUsd, ethUsd);
   442	    const gasPaid = (Number(dex.gasCostWei + approvalCostWei) / 1e18) * ethUsd;
   443	    this.d.db.updateTrade(tradeId, {
   444	      status,
   445	      pnl_usd: pnl,
   446	      gas_usd: gasPaid,
   447	      dex_tx: dex.hash ?? null,
   448	      cex_order_id: orderId ?? cid,
   449	      note: [`client order id ${cid}`, ...notes].join('; '),
   450	    });
   451	
   452	    const dexIsBuy = opp.direction === 'DEX_BUY';
   453	    await this.d.tg.send(
   454	      [
   455	        `${status === 'ok' ? '✅' : '⚠️'} LIVE ${t.base} ${opp.direction} [${status}]`,
   456	        `Buy  ${dexIsBuy ? 'DEX ' : 'MEXC'} @ ${opp.buyPrice.toPrecision(6)}`,
   457	        `Sell ${dexIsBuy ? 'MEXC' : 'DEX '} @ ${opp.sellPrice.toPrecision(6)}`,
   458	        `Qty ${opp.cexQty} ${t.base} | size ${usd(opp.sizeUsd)}`,
   459	        `MEXC fee ${usd(opp.cexFeeUsd)} | Gas ${usd(gasPaid)}`,
   460	        `Expected ${usd(opp.net)} | Net PnL ${usd(pnl)}`,
   461	        dex.hash ? `https://etherscan.io/tx/${dex.hash}` : '',
   462	        notes.length ? `Notes: ${notes.join('; ')}` : '',
   463	      ]
   464	        .filter(Boolean)
   465	        .join('\n'),
   466	    );
   467	    await this.handleRisk(this.d.risk.afterTrade(status));
   468	  }
   469	
   470	  /**
   471	   * Close a position on MEXC now with an aggressive LIMIT 2% through the book, for BOTH sides.
   472	   * (No MEXC spot symbol offers IMMEDIATE_OR_CANCEL, and some have no MARKET; LIMIT works everywhere.)
   473	   * Reads the order back and never assumes it filled. Below MEXC minimums -> returns `dust`, sends nothing.
   474	   */
   475	  async closeAtMarket(t: Token, side: Side, qty: string): Promise<{ orderId: string; filled: number; dust?: string }> {
   476	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   477	    const f = 10 ** t.priceDecimals;
   478	    const pxNum = side === 'BUY' ? Math.ceil(b.asks[0][0] * 1.02 * f) / f : Math.floor(b.bids[0][0] * 0.98 * f) / f;
   479	    const dust = orderProblem(t.rules, side, Number(qty), pxNum);
   480	    if (dust) return { orderId: '', filled: 0, dust };
   481	    const px = pxNum.toFixed(t.priceDecimals);
   482	    const cid = clientId('c');
   483	    const { orderId } = await placeSafely(this.d.mexc, t.symbol, cid, () => this.d.mexc.limitOrder(t.symbol, side, qty, px, cid), this.sleep);
   484	    await this.sleep(1500);
   485	    let o = await this.d.mexc.getOrder(t.symbol, orderId);
   486	    if (o.status !== 'FILLED') {
   487	      await this.d.mexc.cancelOrder(t.symbol, orderId).catch(() => {});
   488	      o = await this.d.mexc.getOrder(t.symbol, orderId);
   489	    }
   490	    const filled = Number(o.executedQty);
   491	    if (filled < Number(qty) * 0.999) {
   492	      const remaining = Number((Number(qty) - filled).toFixed(decimalsOfStep(t.qtyStep)));
   493	      throw new PartialCloseError(`close ${side} only filled ${filled}/${qty}, ${remaining} remaining`, remaining);
   494	    }
   495	    return { orderId, filled };
   496	  }
   497	
   498	  /** MEXC marketable limit order; cancels any unfilled rest. Returns filled quantity. */
   499	  async cexLeg(t: Token, opp: Opportunity, cid = clientId('t')): Promise<{ orderId: string; filled: number }> {
   500	    const side: Side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
   501	    const qty = opp.cexQty.toFixed(decimalsOfStep(t.qtyStep));
   502	    const f = 10 ** t.priceDecimals;
   503	    const px = side === 'SELL' ? Math.floor(opp.cexLimitPrice * f) / f : Math.ceil(opp.cexLimitPrice * f) / f;
   504	    const { orderId } = await placeSafely(
   505	      this.d.mexc,
   506	      t.symbol,
   507	      cid,
   508	      () => this.d.mexc.limitOrder(t.symbol, side, qty, px.toFixed(t.priceDecimals), cid),
   509	      this.sleep,
   510	    );
   511	    log.info(`MEXC ${side} ${qty} ${t.symbol} @ ${px} id=${orderId}`);
   512	    await this.sleep(1500);
   513	
   514	    const read = async (): Promise<Order> => {
   515	      for (let i = 0; i < 3; i++) {
   516	        try {
   517	          return await this.d.mexc.getOrder(t.symbol, orderId);
   518	        } catch (e) {
   519	          log.warn(`getOrder retry: ${errMsg(e)}`);
   520	          await this.sleep(1000);
   521	        }
   522	      }
   523	      throw new Error(`UNKNOWN_ORDER_STATE ${orderId}`);
   524	    };
   525	    let o = await read();
   526	    if (o.status !== 'FILLED') {
   527	      await this.d.mexc.cancelOrder(t.symbol, orderId).catch((e) => log.warn(`cancel: ${errMsg(e)}`));
   528	      await this.sleep(500);
   529	      o = await read();
   530	    }
   531	    return { orderId, filled: Number(o.executedQty) };
   532	  }
   533	
   534	  private async recordPaper(c: Candidate) {
   535	    const { token: t, opp } = c;
   536	    this.record(c, 'paper', { pnl: opp.net, gas: opp.gasUsd });
   537	    await this.d.tg.send(
   538	      `📝 PAPER ${t.base} ${opp.direction}\nBuy @ ${opp.buyPrice.toPrecision(6)} | Sell @ ${opp.sellPrice.toPrecision(6)}\n` +
   539	        `Qty ${opp.cexQty} | size ${usd(opp.sizeUsd)} | fee ${usd(opp.cexFeeUsd)} | gas ${usd(opp.gasUsd)}\nNet ${usd(opp.net)}`,
   540	    );
   541	    await this.handleRisk(this.d.risk.afterTrade('paper'));
   542	  }
   543	
   544	  private record(
   545	    c: Candidate,
   546	    status: TradeStatus,
   547	    r: { pnl: number; gas: number; dexTx?: string; orderId?: string | null; note?: string | null },
   548	  ): number {
   549	    const now = Date.now();
   550	    return this.d.db.insertTrade({
   551	      ts: now,
   552	      day: dhakaDay(now),
   553	      mode: this.cfg.mode,
   554	      symbol: c.token.base,
   555	      direction: c.opp.direction,
   556	      size_usd: c.opp.sizeUsd,
   557	      qty: c.opp.cexQty,
   558	      buy_price: c.opp.buyPrice,
   559	      sell_price: c.opp.sellPrice,
   560	      expected_net: c.opp.net,
   561	      cex_fee_usd: status === 'approval' ? 0 : c.opp.cexFeeUsd,
   562	      gas_usd: r.gas,
   563	      pnl_usd: r.pnl,
   564	      status,
   565	      dex_tx: r.dexTx ?? null,
   566	      cex_order_id: r.orderId ?? null,
   567	      note: r.note ?? null,
   568	    });
   569	  }
   570	
   571	  private async handleRisk(events: RiskEvent[]) {
   572	    for (const e of events) {
   573	      if (e.kind === 'loss_limit') await this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). Trading STOPPED. Send /start to resume.`);
   574	      if (e.kind === 'fail_streak') await this.d.tg.send(`🛑 ${e.count} failed trades in a row. Trading PAUSED. Check logs, then /start.`);
   575	      if (e.kind === 'trade_limit') await this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}). Resumes tomorrow (Dhaka time).`);
   576	    }
   577	  }
   578	}
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
    76	/** /start handler shared by both strategies: critical pauses need "/start confirm". */
    77	function startHandler(risk: Risk, statusText: () => Promise<string>, onConfirm: () => void) {
    78	  return async (args: string[]) => {
    79	    const confirm = args[0]?.toLowerCase() === 'confirm';
    80	    if (risk.paused && risk.critical && !confirm) {
    81	      return `⚠️ Critical pause: ${risk.pauseReason}\nCheck these positions and balances first:\n\n${await statusText()}\n\nThen send: /start confirm`;
    82	    }
    83	    risk.resume(confirm);
    84	    if (confirm) onConfirm();
    85	    const block = risk.blockReason();
    86	    return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
    87	  };
    88	}
    89	
    90	/** Refuse to trade live if .env is readable by other users. */
    91	function checkEnvPermissions(path: string) {
    92	  if (!fs.existsSync(path)) return log.warn(`${path} not found; make sure secrets come from a protected place`);
    93	  const mode = fs.statSync(path).mode & 0o777;
    94	  if (mode & 0o077) throw new Error(`${path} has permissions ${mode.toString(8)}; run: chmod 600 ${path}`);
    95	}
    96	
    97	async function main() {
    98	  if (cfg.mode === 'live') checkEnvPermissions(cfg.envPath);
    99	
   100	  const db = new Db(cfg.dbPath);
   101	  const risk = new Risk(db, cfg.mode, cfg);
   102	  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId, fetch, cfg.telegramAdminId);
   103	  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
   104	  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
   105	  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei);
   106	  const agg: Aggregator = cfg.aggregator === '0x' ? new ZeroEx(cfg.zeroExApiKey) : new OneInch(cfg.oneInchApiKey);
   107	
   108	  // --- Pre-flight checks: fail at startup, not in the middle of the first trade ---
   109	  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
   110	  if (chainId !== 1n) throw new Error(`RPC_URL is chain ${chainId}, expected Ethereum mainnet (1)`);
   111	  if (!cfg.mexcApiKey || !cfg.mexcApiSecret) {
   112	    // Coin/network info (contract addresses, deposit/withdraw status) is a signed MEXC endpoint.
   113	    throw new Error('MEXC_API_KEY/SECRET are required even in paper mode (a read-only key is enough for paper)');
   114	  }
   115	  const skew = await mexc.syncTime();
   116	  if (Math.abs(skew) > 1000) log.warn(`VPS clock is ${skew} ms off MEXC time; corrected, but enable NTP (timedatectl set-ntp true)`);
   117	  // Aggregator key and route smoke test: quote 100 USDC -> WETH.
   118	  await agg.price({
   119	    sellToken: cfg.usdc,
   120	    buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
   121	    sellAmount: 100_000_000n,
   122	    taker: chain.wallet?.address ?? '0x000000000000000000000000000000000000dEaD',
   123	    slippageBps: cfg.dexSlippageBps,
   124	  });
   125	  if (cfg.mode === 'live') {
   126	    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
   127	    if (!cfg.telegramAdminId) throw new Error('Live mode needs TELEGRAM_ADMIN_ID (only this user may send /stop /start)');
   128	    const acc = await mexc.account();
   129	    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
   130	    const eth = Number(await chain.ethBalance()) / 1e18;
   131	    if (eth < cfg.minEthForGas) throw new Error(`Hot wallet has ${eth} ETH, need at least MIN_ETH_FOR_GAS=${cfg.minEthForGas}`);
   132	    const usdt = Number(acc.balances.find((b) => b.asset === 'USDT')?.free ?? 0);
   133	    log.info(`wallet ${chain.address}: ${eth.toFixed(4)} ETH | MEXC USDT ${usdt.toFixed(2)}`);
   134	    if (usdt < cfg.minTradeUsd) log.warn(`MEXC USDT ${usdt} < MIN_TRADE_USD: MEXC buys are blocked until you deposit`);
   135	    if (cfg.strategy === 'transfer') {
   136	      await tg.send(
   137	        `🔐 Reminder: STRATEGY=transfer uses MEXC withdrawals. Make sure the API key is IP-bound to this VPS and the MEXC ` +
   138	          `withdrawal address whitelist contains ONLY ${chain.address}.`,
   139	      );
   140	    }
   141	  }
   142	
   143	  if (cfg.mode === 'live') await recoverExecuting(db, risk, tg, mexc, (h) => chain.provider.getTransactionReceipt(h));
   144	  // Keep signed MEXC timestamps inside recvWindow even if the VPS clock drifts.
   145	  setInterval(() => void mexc.syncTime().catch((e) => log.warn(`clock sync: ${errMsg(e)}`)), 10 * 60_000);
   146	
   147	  if (cfg.strategy === 'transfer') return runTransfer(db, risk, tg, mexc, chain, agg);
   148	
   149	  const tokens = await buildWatchlist(mexc, (a) => chain.decimals(a), {
   150	    only: cfg.watchlist,
   151	    max: cfg.watchlistMax,
   152	    minTvlUsd: cfg.minDexTvlUsd,
   153	    minVolumeUsd: cfg.minMexcVolumeUsd,
   154	  });
   155	  if (tokens.length === 0) throw new Error('Watchlist is empty: no token passed the filters');
   156	  log.info(`watchlist: ${tokens.map((t) => `${t.base}(${t.address.slice(0, 8)}…, tvl $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`);
   157	
   158	  const stream = new MexcBookStream(['ETHUSDT', ...tokens.map((t) => t.symbol)]);
   159	  stream.start();
   160	  const book = async (symbol: string) => stream.get(symbol) ?? mexc.depth(symbol, 20);
   161	  const balances =
   162	    cfg.mode === 'live' ? (total?: boolean) => snapshot(chain, mexc, cfg.usdc, tokens, total) : async () => paperBalances(tokens);
   163	
   164	  const freshBook = (symbol: string) => mexc.depth(symbol, 20);
   165	  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, freshBook, balances, tokens });
   166	
   167	  // --- Telegram commands ---
   168	  const statusText = async () => {
   169	    const t = risk.today();
   170	    const lines = [
   171	      `MODE=${cfg.mode} | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   172	      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   173	      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, max gas ${cfg.maxGasGwei} gwei (now ${engine.lastGasGwei.toFixed(1)})`,
   174	      `Fail streak: ${risk.consecutiveFails}/${cfg.maxConsecutiveFails}`,
   175	    ];
   176	    if (cfg.mode === 'live') {
   177	      try {
   178	        const b = await balances();
   179	        lines.push(`Wallet: ${b.walletEth.toFixed(4)} ETH, ${usd(b.walletUsdc)} USDC | MEXC: ${usd(b.mexc.USDT ?? 0)} USDT`);
   180	        for (const tk of tokens) {
   181	          lines.push(`  ${tk.base}: wallet ${(b.walletToken[tk.base] ?? 0).toFixed(4)} | MEXC ${(b.mexc[tk.base] ?? 0).toFixed(4)}${tk.depositOk && tk.withdrawOk ? '' : ' (suspended)'}`);
   182	        }
   183	      } catch (e) {
   184	        lines.push(`Inventory error: ${errMsg(e)}`);
   185	      }
   186	    }
   187	    return lines.join('\n');
   188	  };
   189	  void tg.startPolling({
   190	    '/stop': () => {
   191	      risk.pause('Telegram /stop');
   192	      return '🛑 Trading STOPPED. Send /start to resume.';
   193	    },
   194	    '/start': startHandler(risk, statusText, () => (chain.unresolved = null)),
   195	    '/status': statusText,
   196	  });
   197	
   198	  // --- Main loop: one scan per block ---
   199	  let busy = false;
   200	  let errors = 0;
   201	  chain.provider.on('block', async () => {
   202	    if (busy || rateLimited() || lifecycle.stopping) return;
   203	    busy = lifecycle.busy = true;
   204	    try {
   205	      await engine.tick();
   206	      errors = 0;
   207	      rateLimitOk();
   208	    } catch (e) {
   209	      if (onScanError(e)) return;
   210	      errors++;
   211	      log.error(`tick: ${errMsg(e)}`);
   212	      if (errors >= 5) await engine.alertThrottled('tick-errors', `❗ Bot errors (${errors} in a row): ${errMsg(e)}`, 3600_000);
   213	    } finally {
   214	      busy = lifecycle.busy = false;
   215	    }
   216	  });
   217	
   218	  // MEXC deposit/withdraw status every 10 minutes.
   219	  setInterval(async () => {
   220	    try {
   221	      const changed = await refreshStatus(mexc, tokens);
   222	      if (changed.length) await tg.send(`ℹ️ MEXC network status changed:\n${changed.join('\n')}`);
   223	    } catch (e) {
   224	      log.warn(`status refresh: ${errMsg(e)}`);
   225	    }
   226	  }, 10 * 60_000);
   227	
   228	  // Daily summary at 23:00 Bangladesh time.
   229	  setInterval(async () => {
   230	    const { hour } = dhakaHourMinute();
   231	    const today = dhakaDay();
   232	    if (hour === 23 && db.getState('last_summary_day') !== today) {
   233	      db.setState('last_summary_day', today);
   234	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   235	    }
   236	  }, 30_000);
   237	
   238	  installProcessHandlers(tg, () => stream.stop());
   239	
   240	  await tg.send(
   241	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} via ${agg.name}\nTokens: ${tokens.map((t) => t.base).join(', ')}\n` +
   242	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   243	  );
   244	}
   245	
   246	/** TRANSFER strategy: scan every MEXC ERC20 token, buy on MEXC, withdraw, sell on DEX. */
   247	async function runTransfer(db: Db, risk: Risk, tg: Telegram, mexc: MexcRest, chain: Chain, agg: Aggregator) {
   248	  const engine = new TransferEngine({ cfg, mexc, chain, agg, db, risk, tg });
   249	  await engine.refreshUniverse(true);
   250	  if (engine.universe.length === 0) throw new Error('No MEXC ERC20 token passed the filters');
   251	
   252	  void tg.startPolling({
   253	    '/stop': () => {
   254	      risk.pause('Telegram /stop');
   255	      return '🛑 New trades STOPPED. An open transfer still finishes (selling the tokens already bought is the safe exit). /start to resume.';
   256	    },
   257	    '/start': async (args: string[]) => startHandler(risk, transferStatus, () => (chain.unresolved = null))(args),
   258	    '/status': async () => transferStatus(),
   259	    '/sell': ([id]: string[]) => (id ? engine.forceSell(Number(id)) : 'Usage: /sell <transfer id>'),
   260	    '/clear': ([id]: string[]) => (id ? engine.clear(Number(id)) : 'Usage: /clear <transfer id>'),
   261	  });
   262	
   263	  async function transferStatus() {
   264	    const t = risk.today();
   265	    const open = db.openTransfers();
   266	    const lines = [
   267	      `MODE=${cfg.mode} STRATEGY=transfer | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   268	      `Scanning ${engine.universe.length} MEXC ERC20 tokens every ${cfg.scanIntervalSec}s`,
   269	      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   270	      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, gas ${engine.lastGasGwei.toFixed(1)}/${cfg.maxGasGwei} gwei`,
   271	      `Top gaps: ${engine.lastTopGaps.map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ') || 'none'}`,
   272	      open.length ? `Open: ${open.map((o) => `#${o.id} ${o.base} ${o.status}`).join(', ')}` : 'Open transfers: none',
   273	    ];
   274	    const stuck = db.stuckTransfers();
   275	    if (stuck.length) lines.push(`🚨 Needs you: ${stuck.map((o) => `#${o.id} ${o.base} (${o.note ?? 'stuck'})`).join('; ')} -> /sell <id> or /clear <id>`);
   276	    if (cfg.mode === 'live') {
   277	      try {
   278	        const b = await mexc.balances();
   279	        const eth = await chain.ethBalance();
   280	        const usdc = await chain.tokenBalance(cfg.usdc);
   281	        lines.push(`MEXC ${usd(b.USDT ?? 0)} USDT | wallet ${(Number(eth) / 1e18).toFixed(4)} ETH, ${usd(Number(usdc) / 1e6)} USDC`);
   282	      } catch (e) {
   283	        lines.push(`Balance error: ${errMsg(e)}`);
   284	      }
   285	    }
   286	    return lines.join('\n');
   287	  }
   288	
   289	  let busy = false;
   290	  let errors = 0;
   291	  let lastLow = 0;
   292	  const loop = async () => {
   293	    if (busy || rateLimited() || lifecycle.stopping) return;
   294	    busy = lifecycle.busy = true;
   295	    try {
   296	      await engine.tick();
   297	      errors = 0;
   298	      rateLimitOk();
   299	      // MEXC USDT is spent by buys and comes back only when you move USDC from the wallet to MEXC.
   300	      if (cfg.mode === 'live' && Date.now() - lastLow > 6 * 3600_000) {
   301	        const usdt = (await mexc.balances()).USDT ?? 0;
   302	        const eth = Number(await chain.ethBalance()) / 1e18;
   303	        if (usdt < cfg.minTradeUsd || eth < cfg.minEthForGas) {
   304	          lastLow = Date.now();
   305	          await tg.send(`📦 Rebalance needed: MEXC USDT ${usd(usdt)}, wallet ETH ${eth.toFixed(4)}. Move USDC profits from the wallet back to MEXC.`);
   306	        }
   307	      }
   308	    } catch (e) {
   309	      if (onScanError(e)) return;
   310	      errors++;
   311	      log.error(`scan: ${errMsg(e)}`);
   312	      if (errors === 5) await tg.send(`❗ Bot errors (5 in a row): ${errMsg(e)}`);
   313	    } finally {
   314	      busy = lifecycle.busy = false;
   315	    }
   316	  };
   317	  setInterval(loop, cfg.scanIntervalSec * 1000);
   318	  void loop();
   319	
   320	  setInterval(async () => {
   321	    const today = dhakaDay();
   322	    if (dhakaHourMinute().hour === 23 && db.getState('last_summary_day') !== today) {
   323	      db.setState('last_summary_day', today);
   324	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   325	    }
   326	  }, 30_000);
   327	
   328	  installProcessHandlers(tg, () => {});
   329	
   330	  const open = db.openTransfers();
   331	  await tg.send(
   332	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} STRATEGY=transfer via ${agg.name}\n` +
   333	      `Scanning ${engine.universe.length} MEXC ERC20 tokens (buy MEXC -> withdraw -> sell DEX)\n` +
   334	      (open.length ? `Resuming ${open.length} open transfer(s)\n` : '') +
   335	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   336	  );
   337	}
   338	
   339	main().catch(async (e) => {
   340	  log.error(`startup failed: ${errMsg(e)}`);
   341	  await new Telegram(cfg.telegramToken, cfg.telegramChatId).send(`❗ Bot failed to start: ${errMsg(e)}`);
   342	  process.exit(1);
   343	});
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
     9	 * Startup recovery: a trade row still 'executing' means the bot died mid-trade. Look up what happened,
    10	 * report it, and stay PAUSED (critical) until a human sends /start confirm.
    11	 */
    12	export async function recoverExecuting(
    13	  db: Db,
    14	  risk: Risk,
    15	  tg: Notifier,
    16	  mexc: Pick<MexcRest, 'getOrderByClientId'>,
    17	  receipt: (hash: string) => Promise<{ status: number | null } | null>,
    18	) {
    19	  const rows = db.executingTrades();
    20	  if (!rows.length) return;
    21	  const lines: string[] = [];
    22	  for (const r of rows) {
    23	    const cid = /client order id (\S+?)(;|$)/.exec(r.note ?? '')?.[1];
    24	    let cex = 'MEXC order: unknown';
    25	    if (cid) {
    26	      try {
    27	        const o = await mexc.getOrderByClientId(`${r.symbol}USDT`, cid);
    28	        cex = o ? `MEXC order ${o.orderId}: ${o.status}, filled ${o.executedQty}` : 'MEXC order: never placed';
    29	      } catch (e) {
    30	        cex = `MEXC lookup failed: ${errMsg(e)}`;
    31	      }
    32	    }
    33	    let dex = 'DEX tx: none signed';
    34	    if (r.dex_tx) {
    35	      const rc = await receipt(r.dex_tx).catch(() => null);
    36	      dex = rc ? `DEX tx ${r.dex_tx}: ${rc.status === 1 ? 'SUCCESS' : 'REVERTED'}` : `DEX tx ${r.dex_tx}: NOT MINED (may still be pending)`;
    37	    }
    38	    db.updateTrade(r.id, { status: 'one_sided', note: `${r.note ?? ''}; recovered at startup: ${cex}; ${dex}` });
    39	    lines.push(`#${r.id} ${r.symbol} ${r.direction} qty ${r.qty}\n  ${cex}\n  ${dex}`);
    40	  }
    41	  risk.pause('bot restarted during a trade', true);
    42	  await tg.send(
    43	    `🚨 Bot restarted while ${rows.length} trade(s) were running:\n${lines.join('\n')}\n` +
    44	      `Trading PAUSED. Check balances (/status), fix any open position by hand, then /start confirm.`,
    45	  );
    46	}
    47	
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
    46	    this.db.setState('paused', '0');
    47	    this.db.setState('pause_reason', '');
    48	    this.db.setState('pause_critical', '0');
    49	    this.db.setState('consecutive_fails', '0');
    50	    return true;
    51	  }
    52	
    53	  /** Remaining daily loss budget (USD) before the limit is hit. */
    54	  remainingLossBudget(): number {
    55	    return this.limits.dailyLossLimitUsd + this.today().pnl;
    56	  }
    57	
    58	  today() {
    59	    return this.db.dayStats(dhakaDay(this.now()), this.mode);
    60	  }
    61	
    62	  /** null = allowed, otherwise the reason trading is blocked right now. */
    63	  blockReason(): string | null {
    64	    if (this.paused) return `paused: ${this.pauseReason}`;
    65	    const t = this.today();
    66	    if (t.trades >= this.limits.maxTradesPerDay) return `daily trade limit reached (${t.trades})`;
    67	    if (t.pnl <= -this.limits.dailyLossLimitUsd) return `daily loss limit reached (${t.pnl.toFixed(2)})`;
    68	    return null;
    69	  }
    70	
    71	  /** Update streaks after a trade; returns events that need an alert. */
    72	  afterTrade(status: TradeStatus): RiskEvent[] {
    73	    const events: RiskEvent[] = [];
    74	    if (status === 'ok' || status === 'paper') {
    75	      this.db.setState('consecutive_fails', '0');
    76	    } else {
    77	      const n = this.consecutiveFails + 1;
    78	      this.db.setState('consecutive_fails', String(n));
    79	      if (n >= this.limits.maxConsecutiveFails) {
    80	        this.pause(`${n} failed trades in a row`);
    81	        events.push({ kind: 'fail_streak', count: n });
    82	      }
    83	    }
    84	    const t = this.today();
    85	    if (t.pnl <= -this.limits.dailyLossLimitUsd) {
    86	      this.pause(`daily loss limit hit (${t.pnl.toFixed(2)} USD)`);
    87	      events.push({ kind: 'loss_limit', pnl: t.pnl });
    88	    }
    89	    if (t.trades >= this.limits.maxTradesPerDay) events.push({ kind: 'trade_limit', trades: t.trades });
    90	    return events;
    91	  }
    92	}
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
     8	type Update = { message?: { chat?: { id: number | string; type?: string }; from?: { id: number | string }; text?: string } };
     9	
    10	export class Telegram {
    11	  private offset = 0;
    12	  private running = false;
    13	
    14	  constructor(
    15	    private token: string,
    16	    private chatId: string,
    17	    private fetchFn: FetchFn = fetch,
    18	    private adminId = '',
    19	  ) {}
    20	
    21	  get enabled(): boolean {
    22	    return Boolean(this.token && this.chatId);
    23	  }
    24	
    25	  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    26	    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
    27	      method: 'POST',
    28	      headers: { 'Content-Type': 'application/json' },
    29	      body: JSON.stringify(body),
    30	      signal: AbortSignal.timeout(timeoutMs),
    31	    });
    32	    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    33	    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    34	    return j.result;
    35	  }
    36	
    37	  /** Never throws: alerts must not crash the bot. */
    38	  async send(text: string): Promise<void> {
    39	    const msg = redact(text);
    40	    log.info(`[telegram] ${msg.replace(/\n/g, ' | ')}`);
    41	    if (!this.enabled) return;
    42	    try {
    43	      await this.api('sendMessage', { chat_id: this.chatId, text: msg.slice(0, 4000), disable_web_page_preview: true });
    44	    } catch (e) {
    45	      log.warn(`telegram send failed: ${errMsg(e)}`);
    46	    }
    47	  }
    48	
    49	  /** Dispatch one update; exported for tests. */
    50	  async handle(update: Update, handlers: Record<string, Handler>) {
    51	    const m = update.message;
    52	    if (!m?.text || String(m.chat?.id) !== String(this.chatId)) return; // other chats
    53	    // In a group anyone could type /start: require the admin user in a private chat.
    54	    if (!this.adminId || String(m.from?.id) !== String(this.adminId) || m.chat?.type !== 'private') {
    55	      log.warn(`telegram: ignored command from user ${m.from?.id} in ${m.chat?.type ?? '?'} chat`);
    56	      return;
    57	    }
    58	    const [first, ...args] = m.text.trim().split(/\s+/);
    59	    const cmd = first.split('@')[0].toLowerCase();
    60	    const h = handlers[cmd];
    61	    const reply = h ? await h(args) : `Commands: ${Object.keys(handlers).join(' ')}`;
    62	    await this.send(reply);
    63	  }
    64	
    65	  async startPolling(handlers: Record<string, Handler>): Promise<void> {
    66	    if (!this.enabled || this.running) return;
    67	    this.running = true;
    68	    while (this.running) {
    69	      try {
    70	        const updates = await this.api<({ update_id: number } & Update)[]>(
    71	          'getUpdates',
    72	          { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
    73	          35_000,
    74	        );
    75	        for (const u of updates) {
    76	          this.offset = u.update_id + 1;
    77	          await this.handle(u, handlers).catch((e) => log.warn(`telegram handler: ${errMsg(e)}`));
    78	        }
    79	      } catch (e) {
    80	        log.warn(`telegram poll: ${errMsg(e)}`);
    81	        await sleep(5000);
    82	      }
    83	    }
    84	  }
    85	
    86	  stop(): void {
    87	    this.running = false;
    88	  }
    89	}
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
    23	import { USDC_DECIMALS, clientId, placeSafely } from './engine.js';
    24	import { type Gap, type ScanToken, dexPrices, findGaps, loadUniverse } from './scanner.js';
    25	import { evaluateTransfer, gasUsd, planCexBuy, threshold } from './pricing.js';
    26	import { log, errMsg } from './log.js';
    27	import { decimalsOfStep, dhakaDay, floorToStep, sleep as realSleep, toFloat, toUnits, usd } from './util.js';
    28	
    29	const APPROVE_GAS = 60_000n;
    30	const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
    31	const SELL_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000]; // after attempt 1, 2, 3; attempt 4 -> stuck
    32	const MAX_SELL_ATTEMPTS = 4;
    33	const FALSE_GAP_COOLDOWN_MS = 10 * 60_000;
    34	
    35	export interface TransferMexc {
    36	  exchangeInfo(): Promise<SymbolInfo[]>;
    37	  tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]>;
    38	  coinConfigs(): Promise<CoinConfig[]>;
    39	  bookTickers(): Promise<Map<string, { bid: number; ask: number }>>;
    40	  depth(symbol: string, limit?: number): Promise<Book>;
    41	  balances(): Promise<Record<string, number>>;
    42	  limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
    43	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
    44	  getOrder(symbol: string, orderId: string): Promise<Order>;
    45	  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
    46	  cancelOrder(symbol: string, orderId: string): Promise<Order>;
    47	  withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string>;
    48	  findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null>;
    49	}
    50	export interface TransferChain {
    51	  readonly address: string;
    52	  gas(): Promise<GasInfo>;
    53	  decimals(token: string): Promise<number>;
    54	  tokenBalance(token: string): Promise<bigint>;
    55	  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
    56	  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
    57	  send(tx: { to: string; data: string; value?: bigint }, gasLimit: bigint, gas: GasInfo, timeoutSec: number): Promise<TxResult>;
    58	}
    59	
    60	export interface TransferDeps {
    61	  cfg: Config;
    62	  mexc: TransferMexc;
    63	  chain: TransferChain;
    64	  agg: Aggregator;
    65	  db: Db;
    66	  risk: Risk;
    67	  tg: Notifier;
    68	  dexPricesFn?: typeof dexPrices;
    69	  sleep?: (ms: number) => Promise<void>;
    70	  now?: () => number;
    71	}
    72	
    73	interface Candidate {
    74	  gap: Gap;
    75	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
    76	  ev: ReturnType<typeof evaluateTransfer>;
    77	  decimals: number;
    78	}
    79	
    80	const WITHDRAW_FAILED = new Set([8, 9]); // FAILED, CANCEL
    81	const WITHDRAW_MANUAL = 10;
    82	const buyCid = (id: number) => `arb${id}b`;
    83	const withdrawCid = (id: number) => `arb${id}w`;
    84	
    85	export class TransferEngine {
    86	  universe: ScanToken[] = [];
    87	  private universeTs = 0;
    88	  private lastNote = new Map<string, string>();
    89	  private cooldown = new Map<string, number>(); // token -> skip exact quotes until
    90	  private alerted = new Set<string>();
    91	  private sleep: (ms: number) => Promise<void>;
    92	  private now: () => number;
    93	  lastGasGwei = 0;
    94	  lastTopGaps: Gap[] = [];
    95	
    96	  constructor(private d: TransferDeps) {
    97	    this.sleep = d.sleep ?? realSleep;
    98	    this.now = d.now ?? Date.now;
    99	  }
   100	
   101	  private get cfg() {
   102	    return this.d.cfg;
   103	  }
   104	  private get live() {
   105	    return this.cfg.mode === 'live';
   106	  }
   107	  private costs() {
   108	    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
   109	  }
   110	  private note(key: string, msg: string) {
   111	    if (this.lastNote.get(key) !== msg) {
   112	      this.lastNote.set(key, msg);
   113	      log.info(msg);
   114	    }
   115	  }
   116	  /** Telegram once per key (per process). */
   117	  private async alertOnce(key: string, text: string) {
   118	    if (this.alerted.has(key)) return;
   119	    this.alerted.add(key);
   120	    await this.d.tg.send(text);
   121	  }
   122	  private reload(row: TransferRow): TransferRow {
   123	    return this.d.db.getTransfer(row.id!)!;
   124	  }
   125	
   126	  async refreshUniverse(force = false): Promise<void> {
   127	    if (!force && this.now() - this.universeTs < 10 * 60_000) return;
   128	    this.universe = await loadUniverse(this.d.mexc, { minVolumeUsd: this.cfg.minMexcVolumeUsd, only: this.cfg.watchlist });
   129	    this.universeTs = this.now();
   130	    log.info(`scanner universe: ${this.universe.length} MEXC ERC20 tokens (deposit+withdraw open, volume >= $${this.cfg.minMexcVolumeUsd})`);
   131	  }
   132	
   133	  /** One scan cycle. Always advances open transfers first. */
   134	  async tick(): Promise<void> {
   135	    const gas = await this.d.chain.gas();
   136	    this.lastGasGwei = Number(gas.effective) / 1e9;
   137	    const tickers = await this.d.mexc.bookTickers();
   138	    const eth = tickers.get('ETHUSDT');
   139	    if (!eth) throw new Error('no ETHUSDT ticker');
   140	    const ethUsd = (eth.bid + eth.ask) / 2;
   141	
   142	    for (const row of this.d.db.openTransfers()) {
   143	      try {
   144	        await this.advance(row, gas, ethUsd);
   145	      } catch (e) {
   146	        log.error(`transfer #${row.id} ${row.base}: ${errMsg(e)}`);
   147	      }
   148	    }
   149	
   150	    await this.refreshUniverse();
   151	    const dex = await (this.d.dexPricesFn ?? dexPrices)(this.universe.map((t) => t.address));
   152	    const now = this.now();
   153	    const gaps = findGaps(this.universe, tickers, dex, {
   154	      minTvlUsd: this.cfg.minDexTvlUsd,
   155	      minGapPct: this.cfg.scanMinGapPct,
   156	      maxGapPct: this.cfg.scanMaxGapPct,
   157	    });
   158	    this.lastTopGaps = gaps.slice(0, 5);
   159	    this.note(
   160	      'gaps',
   161	      gaps.length
   162	        ? `scan: ${gaps.length} gaps >= ${this.cfg.scanMinGapPct}%: ${gaps.slice(0, 5).map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ')}`
   163	        : `scan: ${this.universe.length} tokens, no gap >= ${this.cfg.scanMinGapPct}%`,
   164	    );
   165	
   166	    const block = this.d.risk.blockReason();
   167	    if (block) return this.note('block', `new trades blocked: ${block}`);
   168	    this.note('block', 'new trades enabled');
   169	    if (this.d.db.blockingTransfers().length >= this.cfg.maxOpenTransfers) return this.note('open', 'waiting for open transfer to finish');
   170	    this.note('open', 'no open transfer');
   171	    if (this.lastGasGwei > this.cfg.maxGasGwei) return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > ${this.cfg.maxGasGwei}, no new trades`);
   172	    this.note('gas', 'gas ok');
   173	
   174	    // Skip tokens whose exact quote recently showed the gap was not real, so they cannot starve the rest.
   175	    const fresh = gaps.filter((g) => (this.cooldown.get(g.token.base) ?? 0) <= now);
   176	    if (!fresh.length) return;
   177	
   178	    const usdt = this.live ? ((await this.d.mexc.balances()).USDT ?? 0) : 1e12;
   179	    let best: Candidate | null = null;
   180	    for (const g of fresh.slice(0, this.cfg.scanExactQuotes)) {
   181	      try {
   182	        const c = await this.evaluate(g, gas, ethUsd, usdt);
   183	        if (!c) {
   184	          this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   185	          continue;
   186	        }
   187	        const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
   188	        log.info(`${g.token.base}: gap ${g.gapPct.toFixed(2)}%, size ${usd(c.ev.costUsd)}, exact net ${usd(c.ev.net)} (need ${usd(need)})`);
   189	        if (c.ev.net <= need) this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   190	        else if (!best || c.ev.net > best.ev.net) best = c;
   191	      } catch (e) {
   192	        log.warn(`${g.token.base} evaluate: ${errMsg(e)}`);
   193	        this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   194	      }
   195	    }
   196	    if (!best) return;
   197	    if (!this.live) return this.recordPaper(best);
   198	    await this.start(best, gas, ethUsd);
   199	  }
   200	
   201	  /** Exact, size-specific numbers: MEXC depth walk + withdraw fee + aggregator quote + gas + drift reserve. */
   202	  async evaluate(g: Gap, gas: GasInfo, ethUsd: number, usdt: number): Promise<Candidate | null> {
   203	    const size = Math.min(this.cfg.maxTradeUsd, usdt * 0.99);
   204	    if (size < this.cfg.minTradeUsd) {
   205	      this.note('usdt', `MEXC USDT too low for a trade (${usd(usdt)})`);
   206	      return null;
   207	    }
   208	    const t = g.token;
   209	    const book = await this.d.mexc.depth(t.symbol, 20);
   210	    const plan = planCexBuy({ sizeUsd: size, asks: book.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
   211	    if (!plan || plan.tokensToSell < t.withdrawMin) return null;
   212	    const arriving = plan.tokensToSell - t.withdrawFee;
   213	    if (arriving <= 0) return null;
   214	    const decimals = await this.d.chain.decimals(t.address);
   215	    const q = await this.d.agg.price({
   216	      sellToken: t.address,
   217	      buyToken: this.cfg.usdc,
   218	      sellAmount: toUnits(arriving, decimals),
   219	      taker: this.live ? this.d.chain.address : PAPER_TAKER,
   220	      slippageBps: this.cfg.dexSlippageBps,
   221	    });
   222	    const ev = evaluateTransfer({
   223	      plan,
   224	      withdrawFeeTokens: t.withdrawFee,
   225	      usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
   226	      usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
   227	      gasUsd: gasUsd(q.gas + APPROVE_GAS, gas.effective, ethUsd),
   228	      driftBps: this.cfg.transferDriftBps,
   229	      costs: this.costs(),
   230	    });
   231	    return { gap: g, plan, ev, decimals };
   232	  }
   233	
   234	  private async recordPaper(c: Candidate) {
   235	    const t = c.gap.token;
   236	    const now = this.now();
   237	    this.d.db.insertTrade({
   238	      ts: now, day: dhakaDay(now), mode: 'paper', symbol: t.base, direction: 'TRANSFER',
   239	      size_usd: c.ev.costUsd, qty: c.plan.qty, buy_price: c.ev.buyPrice, sell_price: c.ev.sellPrice,
   240	      expected_net: c.ev.net, cex_fee_usd: c.ev.cexFeeUsd + c.ev.withdrawFeeUsd, gas_usd: c.ev.gasUsd,
   241	      pnl_usd: c.ev.net, status: 'paper', dex_tx: null, cex_order_id: null, note: `gap ${c.gap.gapPct.toFixed(2)}%`,
   242	    });
   243	    await this.d.tg.send(
   244	      `📝 PAPER TRANSFER ${t.base}: buy MEXC @ ${c.ev.buyPrice.toPrecision(6)} -> sell DEX @ ${c.ev.sellPrice.toPrecision(6)}\n` +
   245	        `Size ${usd(c.ev.costUsd)} | fees ${usd(c.ev.cexFeeUsd + c.ev.withdrawFeeUsd)} | gas ${usd(c.ev.gasUsd)} | drift reserve ${usd(c.ev.driftUsd)}\nNet ${usd(c.ev.net)}`,
   246	    );
   247	    this.d.risk.afterTrade('paper');
   248	    this.cooldown.set(t.base, this.now() + FALSE_GAP_COOLDOWN_MS); // one paper trade per gap
   249	  }
   250	
   251	  /** Create the persisted transfer and run its first steps right away. */
   252	  private async start(c: Candidate, gas: GasInfo, ethUsd: number) {
   253	    const t = c.gap.token;
   254	    const now = this.now();
   255	    const id = this.d.db.insertTransfer({
   256	      ts: now, updated: now, base: t.base, symbol: t.symbol, address: t.address, decimals: c.decimals,
   257	      net_work: t.netWork, qty_step: t.qtyStep, price_decimals: t.priceDecimals, status: 'buying',
   258	      buy_qty: c.plan.qty, cost_usd: c.ev.costUsd, buy_order_id: null, withdraw_amount: null, withdraw_id: null,
   259	      wallet_before: null, received: null, usdc_out: null, gas_usd: 0, expected_net: c.ev.net, pnl: null,
   260	      sell_attempts: 0, alerted_timeout: 0, note: null, withdraw_fee: t.withdrawFee, next_try: 0, force_sell: 0, hold_alerted: 0,
   261	    });
   262	    log.info(`transfer #${id} ${t.base}: START gap ${c.gap.gapPct.toFixed(2)}% expected ${usd(c.ev.net)}`);
   263	    const row = this.d.db.getTransfer(id)!;
   264	    try {
   265	      await this.buy(row, c.plan.worst * (1 + this.cfg.cexSlippageBps / 10_000));
   266	    } catch (e) {
   267	      if (String((e as Error).message).startsWith('UNKNOWN_ORDER_STATE')) {
   268	        this.d.risk.pause(`MEXC buy state unknown for transfer #${id}`, true);
   269	        await this.d.tg.send(`🚨 TRANSFER #${id} ${t.base}: MEXC buy state unknown (${errMsg(e)}). Trading PAUSED; the bot keeps looking for the order.`);
   270	        return;
   271	      }
   272	      const now2 = this.reload(row);
   273	      if (now2.buy_order_id) {
   274	        log.warn(`transfer #${id}: error after the buy was placed (${errMsg(e)}); continuing next scan`);
   275	        return;
   276	      }
   277	      return this.fail(now2, `MEXC buy rejected: ${errMsg(e)}`, 0, false);
   278	    }
   279	    const next = this.d.db.getTransfer(id)!;
   280	    if (next.status === 'withdrawing') await this.advance(next, gas, ethUsd);
   281	  }
   282	
   283	  /** Move one transfer forward as far as it can go right now. */
   284	  async advance(row: TransferRow, gas: GasInfo, ethUsd: number): Promise<void> {
   285	    if (row.status === 'buying') {
   286	      if (!row.buy_order_id) {
   287	        // Crashed or timed out while placing: find the order by our client id, never guess.
   288	        const o = await this.d.mexc.getOrderByClientId(row.symbol, buyCid(row.id!));
   289	        if (!o) return this.fail(row, 'MEXC buy was never placed', 0, false);
   290	        this.d.db.updateTransfer(row.id!, { buy_order_id: o.orderId });
   291	        row = this.reload(row);
   292	      }
   293	      await this.finishBuy(row);
   294	      row = this.reload(row);
   295	      if (row.status !== 'withdrawing') return;
   296	    }
   297	    if (row.status === 'withdrawing') return this.withdrawStep(row, gas, ethUsd);
   298	    if (row.status === 'selling') return this.sellStep(row, gas, ethUsd);
   299	  }
   300	
   301	  private async buy(row: TransferRow, limitPrice: number) {
   302	    const f = 10 ** row.price_decimals;
   303	    const px = (Math.ceil(limitPrice * f) / f).toFixed(row.price_decimals);
   304	    const qty = row.buy_qty.toFixed(decimalsOfStep(row.qty_step));
   305	    const cid = buyCid(row.id!);
   306	    const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, () => this.d.mexc.limitOrder(row.symbol, 'BUY', qty, px, cid), this.sleep);
   307	    this.d.db.updateTransfer(row.id!, { buy_order_id: orderId });
   308	    log.info(`transfer #${row.id} MEXC BUY ${qty} ${row.base} @ ${px} id=${orderId}`);
   309	    await this.sleep(1500);
   310	    await this.finishBuy(this.reload(row));
   311	  }
   312	
   313	  private async finishBuy(row: TransferRow) {
   314	    let o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
   315	    if (o.status !== 'FILLED') {
   316	      await this.d.mexc.cancelOrder(row.symbol, row.buy_order_id!).catch((e) => log.warn(`cancel: ${errMsg(e)}`));
   317	      await this.sleep(500);
   318	      o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
   319	      if (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED') return; // cancel not done yet: check again next tick
   320	    }
   321	    const filled = Number(o.executedQty);
   322	    const cost = Number(o.cummulativeQuoteQty);
   323	    if (filled <= 0) return this.fail(row, 'MEXC buy did not fill (price moved)', 0, false);
   324	    this.d.db.updateTransfer(row.id!, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
   325	  }
   326	
   327	  private async withdrawStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
   328	    const since = row.ts - 60_000;
   329	
   330	    if (!row.withdraw_id) {
   331	      if (row.withdraw_amount) {
   332	        // A request was sent before but its result was lost (timeout / restart). Look it up; NEVER resend.
   333	        const rec = await this.d.mexc.findWithdraw(row.base, since, { withdrawOrderId: withdrawCid(row.id!) });
   334	        if (rec) {
   335	          this.d.db.updateTransfer(row.id!, { withdraw_id: rec.id });
   336	          return;
   337	        }
   338	        if (this.now() - row.updated > 10 * 60_000) {
   339	          this.d.db.updateTransfer(row.id!, { status: 'stuck', note: 'withdraw request outcome unknown' });
   340	          await this.d.tg.send(
   341	            `🚨 TRANSFER #${row.id} ${row.base}: withdraw request was sent but MEXC shows no record after 10 min.\n` +
   342	              `Check MEXC withdraw history. If nothing went out: /sell ${row.id} is NOT right (tokens are on MEXC), sell them on MEXC by hand, then /clear ${row.id}.`,
   343	          );
   344	        }
   345	        return;
   346	      }
   347	
   348	      const free = (await this.d.mexc.balances())[row.base] ?? 0;
   349	      const amount = floorToStep(Math.min(free, row.buy_qty * (1 - this.cfg.mexcTakerFee)), row.qty_step);
   350	      const amountStr = amount.toFixed(decimalsOfStep(row.qty_step));
   351	      const min = this.universe.find((t) => t.base === row.base)?.withdrawMin ?? 0;
   352	      if (amount <= 0 || amount < min) {
   353	        const proceeds = amount > 0 ? await this.sellOnMexc(row, amountStr) : 0;
   354	        return this.fail(row, `amount ${amountStr} below MEXC withdraw minimum ${min}; sold back on MEXC`, proceeds - row.cost_usd);
   355	      }
   356	      const before = await this.d.chain.tokenBalance(row.address);
   357	      // Persist BEFORE sending, so a crash during the request can never cause a second withdrawal.
   358	      this.d.db.updateTransfer(row.id!, { withdraw_amount: amountStr, wallet_before: before.toString() });
   359	      try {
   360	        const id = await this.d.mexc.withdraw({
   361	          coin: row.base,
   362	          netWork: row.net_work,
   363	          address: this.d.chain.address, // ONLY ever our own hot wallet
   364	          amount: amountStr,
   365	          contractAddress: row.address,
   366	          withdrawOrderId: withdrawCid(row.id!),
   367	        });
   368	        this.d.db.updateTransfer(row.id!, { withdraw_id: id });
   369	        await this.d.tg.send(`📤 TRANSFER #${row.id} ${row.base}: bought ${row.buy_qty} on MEXC for ${usd(row.cost_usd)}, withdrawing ${amountStr} to wallet`);
   370	      } catch (e) {
   371	        if (e instanceof AmbiguousRequestError) {
   372	          log.warn(`transfer #${row.id} withdraw request ambiguous, will look it up: ${errMsg(e)}`);
   373	          return; // next tick: findWithdraw by withdrawOrderId
   374	        }
   375	        // Clearly rejected: nothing left MEXC. Close the position there instead.
   376	        this.d.db.updateTransfer(row.id!, { withdraw_amount: null });
   377	        const proceeds = await this.sellOnMexc(row, amountStr);
   378	        return this.fail(this.reload(row), `withdraw rejected: ${errMsg(e)}; sold back on MEXC`, proceeds - row.cost_usd);
   379	      }
   380	      return;
   381	    }
   382	
   383	    const rec = await this.d.mexc.findWithdraw(row.base, since, { id: row.withdraw_id, withdrawOrderId: withdrawCid(row.id!) }).catch(() => undefined);
   384	    const bal = await this.d.chain.tokenBalance(row.address);
   385	    const diff = bal - BigInt(row.wallet_before ?? '0');
   386	    const expected = toUnits(Math.max(0, Number(row.withdraw_amount) - row.withdraw_fee), row.decimals);
   387	
   388	    if (diff > 0n && (rec?.status === 7 || diff * 100n >= expected * 98n)) {
   389	      this.d.db.updateTransfer(row.id!, { status: 'selling', received: diff.toString() });
   390	      log.info(`transfer #${row.id} ${row.base}: ${toFloat(diff, row.decimals)} arrived in wallet`);
   391	      return this.sellStep(this.reload(row), gas, ethUsd);
   392	    }
   393	    if (rec && WITHDRAW_FAILED.has(rec.status) && diff <= 0n) {
   394	      // Funds go back to the MEXC account; sell there once they are visible.
   395	      const free = (await this.d.mexc.balances())[row.base] ?? 0;
   396	      if (free < Number(row.withdraw_amount) * 0.99) {
   397	        return this.alertOnce(`wfail-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: MEXC withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}; waiting for the tokens to return to MEXC`);
   398	      }
   399	      await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}, selling back on MEXC`);
   400	      const proceeds = await this.sellOnMexc(row, row.withdraw_amount!);
   401	      return this.fail(row, `withdraw status ${rec.status}`, proceeds - row.cost_usd);
   402	    }
   403	    if (rec?.status === WITHDRAW_MANUAL) {
   404	      await this.alertOnce(`wmanual-${row.id}`, `⏳ TRANSFER #${row.id} ${row.base}: MEXC put the withdrawal under MANUAL review. Waiting.`);
   405	    }
   406	    if (rec === null) {
   407	      await this.alertOnce(`wmissing-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${row.withdraw_id} not found in MEXC history. Still watching the wallet.`);
   408	    }
   409	
   410	    const ageMin = (this.now() - row.ts) / 60_000;
   411	    if (ageMin > this.cfg.transferTimeoutMin && row.alerted_timeout < 1) {
   412	      this.d.db.updateTransfer(row.id!, { alerted_timeout: 1 });
   413	      await this.d.tg.send(
   414	        `⏳ TRANSFER #${row.id} ${row.base}: not in wallet after ${Math.round(ageMin)} min (MEXC status ${rec?.status ?? '?'}). Still waiting.`,
   415	      );
   416	    } else if (ageMin > 2 * this.cfg.transferTimeoutMin && row.alerted_timeout < 2) {
   417	      // Give up blocking: new trades may start, this one is still watched every scan (read-only, no gas).
   418	      this.d.db.updateTransfer(row.id!, { alerted_timeout: 2 });
   419	      await this.d.tg.send(
   420	        `⏳ TRANSFER #${row.id} ${row.base}: still not in wallet after ${Math.round(ageMin)} min. It no longer blocks new trades; ` +
   421	          `the bot keeps watching and sells when it arrives. Check MEXC support if it stays missing.`,
   422	      );
   423	    }
   424	  }
   425	
   426	  private async sellStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
   427	    if (row.next_try > this.now()) return;
   428	    if (Number(gas.effective) / 1e9 > this.cfg.maxGasGwei) return this.note(`sell-${row.id}`, `transfer #${row.id}: gas too high, sale waits`);
   429	    const amount = BigInt(row.received!);
   430	    const qty = toFloat(amount, row.decimals);
   431	    const req = { sellToken: row.address, buyToken: this.cfg.usdc, sellAmount: amount, taker: this.d.chain.address, slippageBps: this.cfg.dexSlippageBps };
   432	    let gasWei = 0n;
   433	    let txHash: string | undefined;
   434	    try {
   435	      const first = await this.d.agg.quote(req);
   436	
   437	      // Loss floor: price may have fallen while the withdrawal travelled. Hold instead of locking in a big loss.
   438	      const worstOut = toFloat(first.minBuyAmount, USDC_DECIMALS);
   439	      const floor = row.cost_usd * (1 - this.cfg.transferMaxLossPct / 100);
   440	      if (worstOut < floor && !row.force_sell) {
   441	        this.d.db.updateTransfer(row.id!, { next_try: this.now() + 5 * 60_000 });
   442	        if (!row.hold_alerted) {
   443	          this.d.db.updateTransfer(row.id!, { hold_alerted: 1 });
   444	          await this.d.tg.send(
   445	            `✋ TRANSFER #${row.id} ${row.base}: DEX would pay only ${usd(worstOut)} for tokens that cost ${usd(row.cost_usd)} ` +
   446	              `(more than ${this.cfg.transferMaxLossPct}% loss). HOLDING ${qty} ${row.base} in the wallet and re-checking every 5 min.\n` +
   447	              `Send /sell ${row.id} to sell anyway.`,
   448	          );
   449	        }
   450	        return;
   451	      }
   452	
   453	      const ap = await this.d.chain.approveExact(row.address, this.spenderOf(first), amount, gas);
   454	      gasWei += ap.gasCostWei;
   455	      if (ap.unknown) return this.unknownOutcome(row, `approval ${ap.hash}`, gasWei, ethUsd);
   456	      if (!ap.ok) throw new Error(`approval failed: ${ap.reason}`);
   457	      const firm = await this.d.agg.quote(req); // fresh after the approval
   458	      if (!firm.tx) throw new Error('quote without transaction');
   459	      const est = await this.d.chain.simulate(firm.tx);
   460	      const usdcBefore = await this.d.chain.tokenBalance(this.cfg.usdc);
   461	      const r = await this.d.chain.send(firm.tx, (est * 13n) / 10n, gas, this.cfg.txTimeoutSec);
   462	      gasWei += r.gasCostWei;
   463	      txHash = r.hash;
   464	      if (r.unknown) return this.unknownOutcome(row, `swap ${r.hash}`, gasWei, ethUsd);
   465	      if (!r.ok) throw new Error(`swap ${r.reason}`);
   466	      const usdcOut = toFloat((await this.d.chain.tokenBalance(this.cfg.usdc)) - usdcBefore, USDC_DECIMALS);
   467	      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
   468	      const pnl = usdcOut - row.cost_usd - gasTotal;
   469	      this.d.db.updateTransfer(row.id!, { status: 'done', usdc_out: usdcOut, gas_usd: gasTotal, pnl });
   470	      this.recordTrade(row, 'ok', pnl, gasTotal, txHash, `sold ${qty} for ${usd(usdcOut)}`, usdcOut / qty);
   471	      await this.d.tg.send(
   472	        [
   473	          `${pnl >= 0 ? '✅' : '🔻'} TRANSFER #${row.id} ${row.base} done`,
   474	          `Buy MEXC: ${row.buy_qty} for ${usd(row.cost_usd)} (@ ${(row.cost_usd / row.buy_qty).toPrecision(6)})`,
   475	          `Sell DEX: ${qty} for ${usd(usdcOut)} (@ ${(usdcOut / qty).toPrecision(6)})`,
   476	          `Withdraw fee ${row.withdraw_fee} ${row.base} | Gas ${usd(gasTotal)}`,
   477	          `Expected ${usd(row.expected_net)} | Net PnL ${usd(pnl)}`,
   478	          `https://etherscan.io/tx/${txHash}`,
   479	        ].join('\n'),
   480	      );
   481	      this.afterRisk('ok');
   482	    } catch (e) {
   483	      const attempts = row.sell_attempts + 1;
   484	      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
   485	      const stuck = attempts >= MAX_SELL_ATTEMPTS;
   486	      const wait = SELL_BACKOFF_MS[Math.min(attempts - 1, SELL_BACKOFF_MS.length - 1)];
   487	      this.d.db.updateTransfer(row.id!, {
   488	        sell_attempts: attempts,
   489	        gas_usd: gasTotal,
   490	        status: stuck ? 'stuck' : 'selling',
   491	        next_try: this.now() + wait,
   492	        note: errMsg(e),
   493	      });
   494	      log.warn(`transfer #${row.id} ${row.base} sell attempt ${attempts} failed: ${errMsg(e)}${stuck ? '' : `; retry in ${wait / 60_000} min`}`);
   495	      if (stuck) {
   496	        await this.d.tg.send(
   497	          `🚨 TRANSFER #${row.id} ${row.base}: DEX sale failed ${attempts} times (${errMsg(e)}). Automatic retries STOPPED.\n` +
   498	            `${qty} ${row.base} are in the hot wallet. Send /sell ${row.id} to try again, or sell by hand and send /clear ${row.id}.`,
   499	        );
   500	        this.afterRisk('one_sided');
   501	      }
   502	    }
   503	  }
   504	
   505	  /** On-chain outcome unknown: do not retry (could double-sell). Pause and hand over to a human. */
   506	  private async unknownOutcome(row: TransferRow, what: string, gasWei: bigint, ethUsd: number) {
   507	    this.d.db.updateTransfer(row.id!, {
   508	      status: 'stuck',
   509	      gas_usd: row.gas_usd + (Number(gasWei) / 1e18) * ethUsd,
   510	      note: `${what} outcome unknown`,
   511	    });
   512	    this.d.risk.pause(`transfer #${row.id}: ${what} outcome unknown`, true);
   513	    await this.d.tg.send(
   514	      `🚨 TRANSFER #${row.id} ${row.base}: ${what} was not mined and its cancel was not confirmed. Outcome UNKNOWN.\n` +
   515	        `Trading PAUSED. Check the wallet on etherscan. Then /sell ${row.id} (if the tokens are still there) or /clear ${row.id}, and /start.`,
   516	    );
   517	  }
   518	
   519	  private spenderOf(q: Quote): string {
   520	    if (q.spender) return q.spender;
   521	    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
   522	    throw new Error('aggregator did not return a spender');
   523	  }
   524	
   525	  /**
   526	   * Market-sell on MEXC; returns the net USDT received.
   527	   * MEXC's docs do not say whether the fee is inside cummulativeQuoteQty, so we measure the
   528	   * real USDT balance change instead of assuming.
   529	   */
   530	  private async sellOnMexc(row: TransferRow, qty: string): Promise<number> {
   531	    try {
   532	      const usdtBefore = (await this.d.mexc.balances()).USDT ?? 0;
   533	      const cid = clientId(`${row.id}s`);
   534	      const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, () => this.d.mexc.marketSell(row.symbol, qty, cid), this.sleep);
   535	      await this.sleep(1000);
   536	      const o = await this.d.mexc.getOrder(row.symbol, orderId);
   537	      const filled = Number(o.executedQty);
   538	      if (filled < Number(qty) * 0.999) {
   539	        this.d.risk.pause(`MEXC sell of ${row.base} only partly filled`, true);
   540	        await this.d.tg.send(
   541	          `🚨 ${row.base}: MEXC market sell filled only ${filled}/${qty}. The rest is still on MEXC. Trading PAUSED: sell it by hand, then /start.`,
   542	        );
   543	      }
   544	      await this.sleep(1500);
   545	      const received = ((await this.d.mexc.balances()).USDT ?? 0) - usdtBefore;
   546	      // Fallback only if the balance read is clearly off (e.g. a concurrent deposit/withdrawal).
   547	      return received > 0 ? received : Number(o.cummulativeQuoteQty) * (1 - this.cfg.mexcTakerFee);
   548	    } catch (e) {
   549	      this.d.risk.pause(`could not close ${row.base} on MEXC`, true);
   550	      await this.d.tg.send(`🚨 ${row.base}: MEXC market sell of ${qty} FAILED (${errMsg(e)}). Trading PAUSED. Close it manually, then /start.`);
   551	      return 0;
   552	    }
   553	  }
   554	
   555	  private async fail(row: TransferRow, why: string, pnl: number, countAsFailure = true) {
   556	    this.d.db.updateTransfer(row.id!, { status: 'failed', pnl, note: why });
   557	    log.warn(`transfer #${row.id} ${row.base} failed: ${why}`);
   558	    if (!countAsFailure) return; // e.g. buy simply did not fill: no money moved
   559	    this.recordTrade(row, 'one_sided', pnl, row.gas_usd, undefined, why);
   560	    await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base} failed: ${why}\nPnL ${usd(pnl)}`);
   561	    this.afterRisk('one_sided');
   562	  }
   563	
   564	  /** Telegram /sell <id>: retry a stuck or held sale now (even below the loss floor). */
   565	  forceSell(id: number): string {
   566	    const t = this.d.db.getTransfer(id);
   567	    if (!t) return `No transfer #${id}`;
   568	    if (!t.received) return `Transfer #${id} has no tokens in the wallet yet (status ${t.status})`;
   569	    if (t.status !== 'stuck' && t.status !== 'selling') return `Transfer #${id} is ${t.status}`;
   570	    this.d.db.updateTransfer(id, { status: 'selling', force_sell: 1, next_try: 0, sell_attempts: 0 });
   571	    return `Transfer #${id}: selling on the next scan (loss floor ignored).`;
   572	  }
   573	
   574	  /** Telegram /clear <id>: you resolved it by hand; close the record. */
   575	  clear(id: number): string {
   576	    const t = this.d.db.getTransfer(id);
   577	    if (!t) return `No transfer #${id}`;
   578	    if (t.status === 'done' || t.status === 'failed') return `Transfer #${id} is already ${t.status}`;
   579	    this.d.db.updateTransfer(id, { status: 'failed', note: 'cleared manually via /clear' });
   580	    // Gas already burned on this transfer is a real cost: book it so the daily loss limit sees it.
   581	    if (t.gas_usd > 0) this.recordTrade(t, 'one_sided', -t.gas_usd, t.gas_usd, undefined, 'cleared manually; gas spent');
   582	    return `Transfer #${id} closed manually. Gas spent (${usd(t.gas_usd)}) is booked; the token result is not, check balances yourself.`;
   583	  }
   584	
   585	  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0) {
   586	    const now = this.now();
   587	    const buyPrice = row.cost_usd / (row.buy_qty || 1);
   588	    this.d.db.insertTrade({
   589	      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
   590	      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: buyPrice, sell_price: sellPrice, expected_net: row.expected_net,
   591	      // informational only: PnL is measured from real balances and already includes every fee
   592	      cex_fee_usd: row.cost_usd * this.cfg.mexcTakerFee + row.withdraw_fee * buyPrice,
   593	      gas_usd: gas, pnl_usd: pnl, status, dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
   594	    });
   595	  }
   596	
   597	  private afterRisk(status: 'ok' | 'one_sided') {
   598	    for (const e of this.d.risk.afterTrade(status)) {
   599	      if (e.kind === 'loss_limit') void this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). New trades STOPPED. Send /start to resume.`);
   600	      if (e.kind === 'fail_streak') void this.d.tg.send(`🛑 ${e.count} failed trades in a row. New trades PAUSED. /start to resume.`);
   601	      if (e.kind === 'trade_limit') void this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}).`);
   602	    }
   603	  }
   604	}
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
    59	  const out: Token[] = [];
    60	  for (const s of candidates) {
    61	    if (out.length >= opts.max) break;
    62	    const coin = coinBy.get(s.baseAsset.toUpperCase());
    63	    const net = coin && ethNetwork(coin);
    64	    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue; // not an Ethereum token on MEXC
    65	    const address = net.contract.toLowerCase();
    66	    try {
    67	      const tvl = await dexTvl(address);
    68	      if (tvl < opts.minTvlUsd) {
    69	        log.info(`watchlist: skip ${s.baseAsset}, DEX TVL $${Math.round(tvl)}`);
    70	        continue;
    71	      }
    72	      out.push({
    73	        base: s.baseAsset.toUpperCase(),
    74	        symbol: s.symbol,
    75	        address,
    76	        decimals: await decimalsOf(address),
    77	        qtyStep: rulesFrom(s).qtyStep,
    78	        priceDecimals: s.quotePrecision,
    79	        rules: rulesFrom(s),
    80	        dexTvlUsd: tvl,
    81	        mexcVolumeUsd: volume.get(s.symbol) ?? 0,
    82	        depositOk: net.depositEnable,
    83	        withdrawOk: net.withdrawEnable,
    84	      });
    85	    } catch (e) {
    86	      log.warn(`watchlist: ${s.baseAsset} check failed: ${errMsg(e)}`);
    87	    }
    88	  }
    89	  return out;
    90	}
    91	
    92	/** Refresh deposit/withdraw flags (tokens with either suspended are skipped). */
    93	export async function refreshStatus(mexc: MexcRest, tokens: Token[]): Promise<string[]> {
    94	  const coins = new Map((await mexc.coinConfigs()).map((c) => [c.coin.toUpperCase(), c]));
    95	  const changed: string[] = [];
    96	  for (const t of tokens) {
    97	    const net = coins.get(t.base) && ethNetwork(coins.get(t.base)!);
    98	    const dep = Boolean(net?.depositEnable && net.contract?.toLowerCase() === t.address);
    99	    const wd = Boolean(net?.withdrawEnable);
   100	    if (dep !== t.depositOk || wd !== t.withdrawOk) changed.push(`${t.base}: deposit ${dep ? 'on' : 'OFF'}, withdraw ${wd ? 'on' : 'OFF'}`);
   101	    t.depositOk = dep;
   102	    t.withdrawOk = wd;
   103	  }
   104	  return changed;
   105	}
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
    24	  tradeSideType?: number; // 1 all, 2 buy only, 3 sell only, 4 close only
    25	}
    26	export interface CoinNetwork {
    27	  coin: string;
    28	  network: string;
    29	  netWork?: string;
    30	  contract?: string;
    31	  depositEnable: boolean;
    32	  withdrawEnable: boolean;
    33	  withdrawFee?: string; // in the coin itself
    34	  withdrawMin?: string;
    35	  withdrawMax?: string;
    36	}
    37	export interface CoinConfig {
    38	  coin: string;
    39	  networkList: CoinNetwork[];
    40	}
    41	export interface Order {
    42	  orderId: string;
    43	  status: string; // NEW, FILLED, PARTIALLY_FILLED, CANCELED, PARTIALLY_CANCELED
    44	  executedQty: string;
    45	  cummulativeQuoteQty: string;
    46	  origQty: string;
    47	  price: string;
    48	  side: Side;
    49	}
    50	
    51	type FetchFn = typeof fetch;
    52	
    53	/** HTTP 429/418 from any API: callers back off instead of hammering. */
    54	export class RateLimitError extends Error {}
    55	
    56	/**
    57	 * The request may or may not have reached MEXC (timeout / connection reset on a POST).
    58	 * Never assume "not placed": look the order / withdrawal up by our own client id.
    59	 */
    60	export class AmbiguousRequestError extends Error {}
    61	
    62	export interface WithdrawRecord {
    63	  id: string;
    64	  status: number;
    65	  amount: string;
    66	  txId?: string;
    67	  withdrawOrderId?: string;
    68	}
    69	
    70	export class MexcRest {
    71	  /** serverTime - localTime, so signed timestamps stay inside recvWindow even if the VPS clock drifts. */
    72	  timeOffsetMs = 0;
    73	
    74	  constructor(
    75	    private apiKey = '',
    76	    private apiSecret = '',
    77	    private baseUrl = 'https://api.mexc.com',
    78	    private fetchFn: FetchFn = fetch,
    79	  ) {}
    80	
    81	  sign(query: string): string {
    82	    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
    83	  }
    84	
    85	  async request<T>(method: string, path: string, params: Record<string, string | number> = {}, signed = false): Promise<T> {
    86	    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    87	    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    88	    if (signed) {
    89	      if (!this.apiKey || !this.apiSecret) throw new Error('MEXC API key/secret not configured');
    90	      qs.set('timestamp', String(Date.now() + this.timeOffsetMs));
    91	      qs.set('recvWindow', '5000');
    92	      qs.set('signature', this.sign(qs.toString()));
    93	      headers['X-MEXC-APIKEY'] = this.apiKey;
    94	    }
    95	    const q = qs.toString();
    96	    let res: Response;
    97	    let text: string;
    98	    try {
    99	      res = await this.fetchFn(`${this.baseUrl}${path}${q ? `?${q}` : ''}`, {
   100	        method,
   101	        headers,
   102	        signal: AbortSignal.timeout(10_000),
   103	      });
   104	      text = await res.text();
   105	    } catch (e) {
   106	      const msg = redact(`MEXC ${method} ${path}: ${(e as Error).message}`);
   107	      // A write that timed out may still have been executed by MEXC.
   108	      if (method !== 'GET') throw new AmbiguousRequestError(msg);
   109	      throw new Error(msg);
   110	    }
   111	    let body: unknown;
   112	    try {
   113	      body = JSON.parse(text);
   114	    } catch {
   115	      body = text;
   116	    }
   117	    const err = redact(`MEXC ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
   118	    if (res.status === 429 || res.status === 418) throw new RateLimitError(err);
   119	    if (res.status >= 500 && method !== 'GET') throw new AmbiguousRequestError(err);
   120	    if (!res.ok) throw new Error(err);
   121	    return body as T;
   122	  }
   123	
   124	  /** Measure clock skew against MEXC; returns the offset in ms. */
   125	  async syncTime(): Promise<number> {
   126	    const t0 = Date.now();
   127	    const r = await this.request<{ serverTime: number }>('GET', '/api/v3/time');
   128	    const t1 = Date.now();
   129	    this.timeOffsetMs = Math.round(r.serverTime - (t0 + t1) / 2);
   130	    return this.timeOffsetMs;
   131	  }
   132	
   133	  async depth(symbol: string, limit = 20): Promise<Book> {
   134	    const d = await this.request<{ bids: [string, string][]; asks: [string, string][] }>('GET', '/api/v3/depth', { symbol, limit });
   135	    const conv = (l: [string, string][]): Level[] => l.map(([p, q]) => [Number(p), Number(q)]);
   136	    return { bids: conv(d.bids), asks: conv(d.asks), ts: Date.now() };
   137	  }
   138	
   139	  async exchangeInfo(): Promise<SymbolInfo[]> {
   140	    const r = await this.request<{ symbols: SymbolInfo[] }>('GET', '/api/v3/exchangeInfo');
   141	    return r.symbols;
   142	  }
   143	
   144	  async tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]> {
   145	    return this.request('GET', '/api/v3/ticker/24hr');
   146	  }
   147	
   148	  async price(symbol: string): Promise<number> {
   149	    const r = await this.request<{ price: string }>('GET', '/api/v3/ticker/price', { symbol });
   150	    return Number(r.price);
   151	  }
   152	
   153	  /** Deposit/withdraw status and contract address per network (signed). */
   154	  async coinConfigs(): Promise<CoinConfig[]> {
   155	    return this.request('GET', '/api/v3/capital/config/getall', {}, true);
   156	  }
   157	
   158	  async account(): Promise<{ canTrade: boolean; balances: { asset: string; free: string; locked: string }[] }> {
   159	    return this.request('GET', '/api/v3/account', {}, true);
   160	  }
   161	
   162	  /** Free balances (what can be traded now); includeLocked adds funds held in open orders. */
   163	  async balances(includeLocked = false): Promise<Record<string, number>> {
   164	    const a = await this.account();
   165	    return Object.fromEntries(a.balances.map((b) => [b.asset, Number(b.free) + (includeLocked ? Number(b.locked) : 0)]));
   166	  }
   167	
   168	  /** Best bid/ask for every symbol in one call. */
   169	  async bookTickers(): Promise<Map<string, { bid: number; ask: number }>> {
   170	    const r = await this.request<{ symbol: string; bidPrice: string; askPrice: string }[]>('GET', '/api/v3/ticker/bookTicker');
   171	    return new Map(r.map((t) => [t.symbol, { bid: Number(t.bidPrice), ask: Number(t.askPrice) }]));
   172	  }
   173	
   174	  /** Withdraw (new endpoint). Requires an API key with withdraw permission. Returns the withdraw id. */
   175	  async withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string> {
   176	    const params: Record<string, string> = { coin: p.coin, netWork: p.netWork, address: p.address, amount: p.amount };
   177	    if (p.contractAddress) params.contractAddress = p.contractAddress;
   178	    if (p.withdrawOrderId) params.withdrawOrderId = p.withdrawOrderId;
   179	    const r = await this.request<{ id: string }>('POST', '/api/v3/capital/withdraw', params, true);
   180	    return r.id;
   181	  }
   182	
   183	  /** Recent withdrawals of a coin (status: 1 APPLY .. 6 WAIT_CONFIRM, 7 SUCCESS, 8 FAILED, 9 CANCEL, 10 MANUAL). */
   184	  async withdrawHistory(coin: string, sinceTs: number): Promise<WithdrawRecord[]> {
   185	    const r = await this.request<{ id: string; status: number | string; amount: string; txId?: string; withdrawOrderId?: string }[]>(
   186	      'GET',
   187	      '/api/v3/capital/withdraw/history',
   188	      { coin, startTime: Math.max(0, Math.floor(sinceTs)), limit: 1000 },
   189	      true,
   190	    );
   191	    return r.map((w) => ({ id: w.id, status: Number(w.status), amount: w.amount, txId: w.txId, withdrawOrderId: w.withdrawOrderId }));
   192	  }
   193	
   194	  /** Find a withdrawal by MEXC id or by our own withdrawOrderId. null = not in history. */
   195	  async findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null> {
   196	    const h = await this.withdrawHistory(coin, sinceTs);
   197	    return h.find((w) => (ref.id && w.id === ref.id) || (ref.withdrawOrderId && w.withdrawOrderId === ref.withdrawOrderId)) ?? null;
   198	  }
   199	
   200	  /** `clientOrderId` makes the order findable even if this request times out. */
   201	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }> {
   202	    const p: Record<string, string> = { symbol, side, type: 'LIMIT', quantity, price };
   203	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   204	    return this.request('POST', '/api/v3/order', p, true);
   205	  }
   206	
   207	  /** Look an order up by our own client id; null if MEXC has no such order. */
   208	  async getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null> {
   209	    try {
   210	      return await this.request<Order>('GET', '/api/v3/order', { symbol, origClientOrderId: clientOrderId }, true);
   211	    } catch (e) {
   212	      // MEXC documents -2011 "Unknown order sent"; anything else is a real error (caller retries).
   213	      if (/-2011|unknown order|does not exist|not exist/i.test((e as Error).message)) return null;
   214	      throw e;
   215	    }
   216	  }
   217	
   218	  /** MARKET SELL by base quantity (documented). For buys use an aggressive LIMIT instead. */
   219	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }> {
   220	    const p: Record<string, string> = { symbol, side: 'SELL', type: 'MARKET', quantity };
   221	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   222	    return this.request('POST', '/api/v3/order', p, true);
   223	  }
   224	
   225	  getOrder(symbol: string, orderId: string): Promise<Order> {
   226	    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
   227	  }
   228	
   229	  cancelOrder(symbol: string, orderId: string): Promise<Order> {
   230	    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
   231	  }
   232	}
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
     8	//   orderTypes           -> allowed types (no MEXC spot symbol lists IMMEDIATE_OR_CANCEL; some have no MARKET)
     9	//   tradeSideType        -> 1 all, 2 buy only, 3 sell only, 4 close only
    10	import type { Side, SymbolInfo } from './rest.js';
    11	
    12	export interface SymbolRules {
    13	  qtyStep: number;
    14	  priceDecimals: number;
    15	  minQty: number;
    16	  minNotional: number;
    17	  maxNotional: number;
    18	  orderTypes: string[];
    19	  tradeSideType: number;
    20	}
    21	
    22	export function rulesFrom(s: SymbolInfo): SymbolRules {
    23	  const qtyDecimals = s.baseAssetPrecision ?? Math.max(0, Math.round(-Math.log10(Number(s.baseSizePrecision) || 1)));
    24	  return {
    25	    qtyStep: 1 / 10 ** qtyDecimals, // exact (10 ** -5 is 0.000009999…)
    26	    priceDecimals: s.quotePrecision,
    27	    minQty: Number(s.baseSizePrecision) || 0,
    28	    minNotional: Number(s.quoteAmountPrecision) || 0,
    29	    maxNotional: Number(s.maxQuoteAmount) || Number.POSITIVE_INFINITY,
    30	    orderTypes: s.orderTypes ?? ['LIMIT'],
    31	    tradeSideType: Number(s.tradeSideType ?? 1),
    32	  };
    33	}
    34	
    35	/** null = the order is allowed; otherwise why MEXC would reject it. */
    36	export function orderProblem(r: SymbolRules, side: Side, qty: number, price: number, type = 'LIMIT'): string | null {
    37	  if (!r.orderTypes.includes(type)) return `order type ${type} not allowed (${r.orderTypes.join(',')})`;
    38	  if (r.tradeSideType === 4) return 'symbol is close-only';
    39	  if (r.tradeSideType === 2 && side === 'SELL') return 'symbol is buy-only';
    40	  if (r.tradeSideType === 3 && side === 'BUY') return 'symbol is sell-only';
    41	  if (!(qty > 0)) return 'quantity is zero';
    42	  if (qty < r.minQty) return `quantity ${qty} < minimum ${r.minQty}`;
    43	  const notional = qty * price;
    44	  if (notional < r.minNotional) return `order value ${notional.toFixed(4)} < minimum ${r.minNotional} USDT`;
    45	  if (notional > r.maxNotional) return `order value ${notional.toFixed(2)} > maximum ${r.maxNotional} USDT`;
    46	  return null;
    47	}
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
   126	    }
   127	    return this.spender;
   128	  }
   129	  private minOut(amount: bigint, bps: number) {
   130	    return (amount * BigInt(10_000 - bps)) / 10_000n;
   131	  }
   132	
   133	  async price(r: QuoteRequest): Promise<Quote> {
   134	    const q = new URLSearchParams({ src: r.sellToken, dst: r.buyToken, amount: r.sellAmount.toString(), includeGas: 'true' });
   135	    const d = await getJson<{ dstAmount: string; gas?: number }>(this.fetchFn, `${this.base}/quote?${q}`, this.headers);
   136	    const buy = BigInt(d.dstAmount);
   137	    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.gas ?? 300_000), spender: await this.getSpender() };
   138	  }
   139	
   140	  async quote(r: QuoteRequest): Promise<Quote> {
   141	    const q = new URLSearchParams({
   142	      src: r.sellToken,
   143	      dst: r.buyToken,
   144	      amount: r.sellAmount.toString(),
   145	      from: r.taker,
   146	      origin: r.taker,
   147	      slippage: String(r.slippageBps / 100), // percent
   148	      disableEstimate: 'true', // we simulate ourselves with eth_call
   149	      includeGas: 'true',
   150	    });
   151	    const d = await getJson<{ dstAmount: string; tx: { to: string; data: string; value: string; gas: number } }>(
   152	      this.fetchFn,
   153	      `${this.base}/swap?${q}`,
   154	      this.headers,
   155	    );
   156	    const buy = BigInt(d.dstAmount);
   157	    requireAddress('1inch tx.to', d.tx.to, ONEINCH_ROUTER_V6);
   158	    return {
   159	      buyAmount: buy,
   160	      minBuyAmount: this.minOut(buy, r.slippageBps),
   161	      gas: BigInt(d.tx.gas || 300_000),
   162	      spender: await this.getSpender(),
   163	      tx: { to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value || '0') },
   164	    };
   165	  }
   166	}
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
    15	export interface GasInfo {
    16	  baseFee: bigint;
    17	  tip: bigint;
    18	  /** What we expect to actually pay per gas (baseFee + tip). */
    19	  effective: bigint;
    20	  /** maxFeePerGas to set on the tx (headroom for base fee rises). */
    21	  maxFee: bigint;
    22	}
    23	
    24	export interface TxResult {
    25	  ok: boolean;
    26	  hash?: string;
    27	  gasCostWei: bigint;
    28	  reason?: string;
    29	  /**
    30	   * true = we do NOT know whether the tx executed (not mined, cancel not confirmed either).
    31	   * Callers must not unwind or retry: pause and let a human check the wallet.
    32	   */
    33	  unknown?: boolean;
    34	}
    35	
    36	export class Chain {
    37	  readonly provider: ethers.JsonRpcProvider;
    38	  readonly sendProvider: ethers.JsonRpcProvider;
    39	  readonly wallet?: ethers.Wallet;
    40	  private decimalsCache = new Map<string, number>();
    41	
    42	  constructor(rpcUrl: string, sendRpcUrl: string, privateKey: string, private priorityFeeGwei: number) {
    43	    this.provider = new ethers.JsonRpcProvider(rpcUrl, 1, { staticNetwork: true });
    44	    this.sendProvider = new ethers.JsonRpcProvider(sendRpcUrl, 1, { staticNetwork: true });
    45	    if (privateKey) this.wallet = new ethers.Wallet(privateKey, this.provider);
    46	  }
    47	
    48	  get address(): string {
    49	    if (!this.wallet) throw new Error('PRIVATE_KEY not set');
    50	    return this.wallet.address;
    51	  }
    52	
    53	  erc20(token: string) {
    54	    return new ethers.Contract(token, ERC20_ABI, this.wallet ?? this.provider);
    55	  }
    56	
    57	  async decimals(token: string): Promise<number> {
    58	    const key = token.toLowerCase();
    59	    if (!this.decimalsCache.has(key)) this.decimalsCache.set(key, Number(await this.erc20(token).decimals()));
    60	    return this.decimalsCache.get(key)!;
    61	  }
    62	
    63	  async tokenBalance(token: string, owner = this.address): Promise<bigint> {
    64	    return this.erc20(token).balanceOf(owner);
    65	  }
    66	
    67	  async ethBalance(owner = this.address): Promise<bigint> {
    68	    return this.provider.getBalance(owner);
    69	  }
    70	
    71	  async gas(): Promise<GasInfo> {
    72	    const block = await this.provider.getBlock('latest');
    73	    const baseFee = block?.baseFeePerGas ?? 0n;
    74	    const tip = ethers.parseUnits(String(this.priorityFeeGwei), 'gwei');
    75	    return { baseFee, tip, effective: baseFee + tip, maxFee: baseFee * 2n + tip };
    76	  }
    77	
    78	  /** Gas units needed for an approval before the swap (0 if allowance already covers it). */
    79	  async approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint> {
    80	    if (!this.wallet) return 0n;
    81	    const allowance: bigint = await this.erc20(token).allowance(this.address, spender);
    82	    if (allowance >= amount) return 0n;
    83	    return allowance > 0n ? APPROVE_GAS * 2n : APPROVE_GAS; // USDT-style tokens need approve(0) first
    84	  }
    85	
    86	  /** Approve exactly `amount` (never unlimited). Sent through the private RPC. */
    87	  async approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult> {
    88	    const c = this.erc20(token);
    89	    let cost = 0n;
    90	    const current: bigint = await c.allowance(this.address, spender);
    91	    if (current >= amount) return { ok: true, gasCostWei: 0n };
    92	    if (current > 0n) {
    93	      const data0 = c.interface.encodeFunctionData('approve', [spender, 0n]);
    94	      const r = await this.send({ to: token, data: data0 }, await this.approveGasLimit(token, data0), gas, 60);
    95	      cost += r.gasCostWei;
    96	      if (!r.ok) return { ...r, gasCostWei: cost };
    97	    }
    98	    const data = c.interface.encodeFunctionData('approve', [spender, amount]);
    99	    const r = await this.send({ to: token, data }, await this.approveGasLimit(token, data), gas, 60);
   100	    return { ...r, gasCostWei: cost + r.gasCostWei };
   101	  }
   102	
   103	  /** Some tokens need more than 60k gas for approve: estimate, +30%, never below 60k. */
   104	  private async approveGasLimit(token: string, data: string): Promise<bigint> {
   105	    try {
   106	      const est = await this.provider.estimateGas({ from: this.address, to: token, data });
   107	      const limit = (est * 13n) / 10n;
   108	      return limit > APPROVE_GAS ? limit : APPROVE_GAS;
   109	    } catch {
   110	      return APPROVE_GAS * 2n;
   111	    }
   112	  }
   113	
   114	  /** eth_call + estimateGas. Returns the gas estimate, or throws with the revert reason. */
   115	  async simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint> {
   116	    const req = { from: this.address, to: tx.to, data: tx.data, value: tx.value };
   117	    await this.provider.call(req);
   118	    return this.provider.estimateGas(req);
   119	  }
   120	
   121	  // ---- Nonce manager ----
   122	  // Our txs go through a PRIVATE RPC, so the public RPC's 'pending' count does not see them.
   123	  // We track nonces locally, starting from the confirmed ('latest') count, and refuse to send
   124	  // while an earlier tx is unresolved (outcome unknown), so a nonce is never reused by accident.
   125	  private nextNonce: number | null = null;
   126	  /** A tx (and maybe its cancel) whose outcome we do not know yet. */
   127	  unresolved: { nonce: number; hashes: string[]; since: number } | null = null;
   128	
   129	  private async takeNonce(): Promise<number> {
   130	    const confirmed = await this.provider.getTransactionCount(this.address, 'latest');
   131	    if (this.nextNonce === null || this.nextNonce < confirmed) this.nextNonce = confirmed;
   132	    return this.nextNonce;
   133	  }
   134	
   135	  /**
   136	   * Re-check an unresolved tx. Returns 'clear' once its nonce is consumed on-chain (by the tx or its cancel),
   137	   * 'pending' while nothing is mined yet.
   138	   */
   139	  async checkUnresolved(): Promise<{ state: 'clear' | 'pending'; executedHash?: string; ok?: boolean }> {
   140	    const u = this.unresolved;
   141	    if (!u) return { state: 'clear' };
   142	    for (const h of u.hashes) {
   143	      const r = await this.provider.getTransactionReceipt(h).catch(() => null);
   144	      if (r) {
   145	        this.unresolved = null;
   146	        this.nextNonce = Math.max(this.nextNonce ?? 0, u.nonce + 1);
   147	        return { state: 'clear', executedHash: h, ok: r.status === 1 };
   148	      }
   149	    }
   150	    const confirmed = await this.provider.getTransactionCount(this.address, 'latest').catch(() => -1);
   151	    if (confirmed > u.nonce) {
   152	      // Nonce used by something we did not see a receipt for (RPC lag): treat as clear, keep counting up.
   153	      this.unresolved = null;
   154	      this.nextNonce = Math.max(this.nextNonce ?? 0, confirmed);
   155	      return { state: 'clear' };
   156	    }
   157	    return { state: 'pending' };
   158	  }
   159	
   160	  /**
   161	   * Sign and send through the private RPC, wait for inclusion.
   162	   * If it is not mined within timeoutSec, replace it with a 0-value self-transfer (cancel).
   163	   * Result states: ok (mined, success), ok:false (mined and reverted / cancelled), unknown (we cannot tell).
   164	   */
   165	  async send(
   166	    tx: { to: string; data: string; value?: bigint },
   167	    gasLimit: bigint,
   168	    gas: GasInfo,
   169	    timeoutSec: number,
   170	    onSigned?: (hash: string, nonce: number) => void,
   171	  ): Promise<TxResult> {
   172	    const wallet = this.wallet!;
   173	    if (this.unresolved && (await this.checkUnresolved()).state === 'pending') {
   174	      return { ok: false, gasCostWei: 0n, reason: `refusing to send: earlier tx ${this.unresolved.hashes[0]} unresolved` };
   175	    }
   176	    const nonce = await this.takeNonce();
   177	    const base = { chainId: 1n, type: 2, nonce, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip };
   178	    const signed = await wallet.signTransaction({ ...base, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit });
   179	    const hash = ethers.keccak256(signed);
   180	    this.nextNonce = nonce + 1;
   181	    onSigned?.(hash, nonce); // persisted before broadcast, so a crash cannot lose the hash
   182	    try {
   183	      await this.sendProvider.send('eth_sendRawTransaction', [signed]);
   184	    } catch (e) {
   185	      // The RPC may have accepted it before failing to answer: outcome unknown, nonce may be consumed.
   186	      this.unresolved = { nonce, hashes: [hash], since: Date.now() };
   187	      return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `send error, outcome unknown: ${errMsg(e)}` };
   188	    }
   189	    log.info(`tx sent ${hash} (nonce ${nonce})`);
   190	
   191	    let receipt = await this.waitReceipt(hash, timeoutSec);
   192	    if (!receipt) {
   193	      log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
   194	      const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
   195	      const cancel = await wallet.signTransaction({
   196	        ...base,
   197	        maxFeePerGas: bump(gas.maxFee),
   198	        maxPriorityFeePerGas: bump(gas.tip),
   199	        to: wallet.address,
   200	        value: 0n,
   201	        gasLimit: 21_000n,
   202	      });
   203	      const cancelHash = ethers.keccak256(cancel);
   204	      await this.sendProvider.send('eth_sendRawTransaction', [cancel]).catch((e) => log.warn(`cancel send failed: ${errMsg(e)}`));
   205	      const deadline = Date.now() + timeoutSec * 1000;
   206	      while (Date.now() < deadline && !receipt) {
   207	        receipt = await this.provider.getTransactionReceipt(hash).catch(() => null);
   208	        const cancelReceipt = await this.provider.getTransactionReceipt(cancelHash).catch(() => null);
   209	        if (cancelReceipt) {
   210	          return { ok: false, hash, gasCostWei: cancelReceipt.gasUsed * cancelReceipt.gasPrice, reason: 'not mined, cancelled' };
   211	        }
   212	        if (!receipt) await sleep(3000);
   213	      }
   214	      if (!receipt) {
   215	        this.unresolved = { nonce, hashes: [hash, cancelHash], since: Date.now() };
   216	        return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `not mined and cancel ${cancelHash} not confirmed: outcome UNKNOWN` };
   217	      }
   218	    }
   219	    const cost = receipt.gasUsed * receipt.gasPrice;
   220	    return receipt.status === 1 ? { ok: true, hash, gasCostWei: cost } : { ok: false, hash, gasCostWei: cost, reason: 'reverted' };
   221	  }
   222	
   223	  private async waitReceipt(hash: string, timeoutSec: number) {
   224	    const deadline = Date.now() + timeoutSec * 1000;
   225	    while (Date.now() < deadline) {
   226	      const r = await this.provider.getTransactionReceipt(hash).catch(() => null);
   227	      if (r) return r;
   228	      await sleep(2000);
   229	    }
   230	    return null;
   231	  }
   232	}
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
    39	  process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
    40	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    41	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    42	  const cfg = loadConfig();
    43	  const db = new Db(':memory:');
    44	  const risk = new Risk(db, cfg.mode, cfg);
    45	  const alerts: string[] = [];
    46	  const calls: string[] = [];
    47	
    48	  const fee = cfg.mexcTakerFee;
    49	  const bid = opts.bid ?? 11.2;
    50	  // Real-ish balances that the fakes update, so PnL is computed from balance changes.
    51	  const bal: Balances = { walletEth: 1, walletUsdc: 1000, walletToken: { LINK: 100 }, mexc: { USDT: 1000, LINK: 100 } };
    52	  const ethUsd = 2000;
    53	
    54	  const books: Record<string, Book> = {
    55	    ETHUSDT: { bids: [[ethUsd, 100]], asks: [[ethUsd, 100]], ts: Date.now() },
    56	    LINKUSDT: { bids: [[bid, 1000]], asks: [[bid + 0.01, 1000]], ts: Date.now() },
    57	  };
    58	
    59	  // DEX price = 10 USDC per LINK, 0.1% minOut buffer.
    60	  const dexQuote = (r: QuoteRequest, firm: boolean): Quote => {
    61	    const buyingToken = r.sellToken === USDC;
    62	    const out = buyingToken ? (r.sellAmount * 10n ** 12n) / 10n : (r.sellAmount * 10n) / 10n ** 12n;
    63	    return {
    64	      buyAmount: out,
    65	      minBuyAmount: (out * 999n) / 1000n,
    66	      gas: 150_000n,
    67	      spender: '0xspender',
    68	      tx: firm ? { to: '0xrouter', data: '0xdead', value: 0n } : undefined,
    69	    };
    70	  };
    71	  let lastFirm: QuoteRequest | null = null;
    72	
    73	  const orders = new Map<string, Order>();
    74	  const byCid = new Map<string, string>();
    75	  let nextId = 1;
    76	  const fill = (side: 'BUY' | 'SELL', qty: number, price: number) => {
    77	    if (side === 'SELL') {
    78	      bal.mexc.LINK -= qty;
    79	      bal.mexc.USDT += qty * price * (1 - fee);
    80	    } else {
    81	      bal.mexc.LINK += qty * (1 - fee);
    82	      bal.mexc.USDT -= qty * price;
    83	    }
    84	  };
    85	
    86	  const token = { ...LINK, rules: { ...LINK.rules, minNotional: opts.minNotional ?? 1 } };
    87	  const engine = new Engine({
    88	    cfg,
    89	    db,
    90	    risk,
    91	    tokens: [token],
    92	    sleep: async () => {},
    93	    tg: { send: async (t) => void alerts.push(t) },
    94	    book: async (s) => books[s],
    95	    balances: async () => structuredClone(bal),
    96	    agg: {
    97	      name: '0x',
    98	      price: async (r) => dexQuote(r, false),
    99	      quote: async (r) => ((lastFirm = r), dexQuote(r, true)),
   100	    },
   101	    chain: {
   102	      address: '0xme',
   103	      gas: async () => {
   104	        const base = (opts.gasGwei ?? 9n) * GWEI;
   105	        return { baseFee: base, tip: GWEI, effective: base + GWEI, maxFee: base * 2n + GWEI };
   106	      },
   107	      approvalGasNeeded: async () => (opts.approvalNeeded ? 60_000n : 0n),
   108	      approveExact: async (_t, _s, amount) => {
   109	        calls.push(`approve ${amount}`);
   110	        bal.walletEth -= 0.0006;
   111	        return { ok: true, gasCostWei: 600_000n * GWEI };
   112	      },
   113	      checkUnresolved: async () => ({ state: opts.unresolved ? 'pending' : 'clear' }),
   114	      simulate: async () => {
   115	        calls.push('simulate');
   116	        if (opts.simulateThrows) throw new Error('execution reverted');
   117	        return 150_000n;
   118	      },
   119	      send: async (): Promise<TxResult> => {
   120	        calls.push('send');
   121	        const gasWei = 150_000n * 10n * GWEI;
   122	        bal.walletEth -= 0.0015;
   123	        if (opts.dexUnknown) return { ok: false, unknown: true, hash: '0xtx', gasCostWei: 0n, reason: 'unknown' };
   124	        if (opts.dexOk === false) return { ok: false, hash: '0xtx', gasCostWei: gasWei, reason: 'reverted' };
   125	        const r = lastFirm!;
   126	        if (r.sellToken === USDC) {
   127	          bal.walletUsdc -= Number(r.sellAmount) / 1e6;
   128	          bal.walletToken.LINK += (Number(r.sellAmount) / 1e6) / 10;
   129	        } else {
   130	          const tokens = Number(r.sellAmount) / 1e18;
   131	          bal.walletToken.LINK -= tokens;
   132	          bal.walletUsdc += tokens * 10;
   133	        }
   134	        return { ok: true, hash: '0xtx', gasCostWei: gasWei };
   135	      },
   136	    },
   137	    mexc: {
   138	      limitOrder: async (_s, side, q, p, cid) => {
   139	        calls.push(`limit ${side} ${q} @ ${p}`);
   140	        const id = String(nextId++);
   141	        const first = id === '1';
   142	        const filled = Number(q) * ((first ? opts.mexcFillRatio : opts.closeFillRatio) ?? 1);
   143	        fill(side, filled, Number(p));
   144	        orders.set(id, { orderId: id, status: filled === Number(q) ? 'FILLED' : 'PARTIALLY_FILLED', executedQty: String(filled), cummulativeQuoteQty: '0', origQty: q, price: p, side });
   145	        if (cid) byCid.set(cid, id);
   146	        // MEXC executed it, but our HTTP request timed out / got a 5xx:
   147	        if (first && opts.placeAmbiguous) throw new AmbiguousRequestError('MEXC POST /api/v3/order -> 503');
   148	        return { orderId: id };
   149	      },
   150	      marketSell: async (_s, q) => {
   151	        calls.push(`market SELL ${q}`);
   152	        const filled = Number(q) * (opts.marketFillRatio ?? 1);
   153	        fill('SELL', filled, bid);
   154	        orders.set('m', { orderId: 'm', status: 'FILLED', executedQty: String(filled), cummulativeQuoteQty: String(filled * bid), origQty: q, price: '0', side: 'SELL' });
   155	        return { orderId: 'm' };
   156	      },
   157	      getOrderByClientId: async (_s, cid) => (byCid.has(cid) ? orders.get(byCid.get(cid)!)! : null),
   158	      getOrder: async (_s, id) => orders.get(id)!,
   159	      cancelOrder: async (_s, id) => {
   160	        calls.push(`cancel ${id}`);
   161	        const o = orders.get(id)!;
   162	        o.status = 'PARTIALLY_CANCELED';
   163	        return o;
   164	      },
   165	    },
   166	  });
   167	  return { engine, db, risk, alerts, calls, bal, cfg };
   168	}
   169	
   170	const trades = (db: Db) => db.statsSince(0);
   171	
   172	test('profitable gap: both legs trade, PnL comes from real balance changes', async () => {
   173	  const { engine, db, alerts, calls } = setup({});
   174	  await engine.tick();
   175	  // MEXC sell 20 LINK (bought 20 on DEX for $200), limit = 11.2 * (1 - 0.2%) rounded down.
   176	  // MEXC sells what the DEX guarantees (minBuyAmount 19.98), not the expected 20.
   177	  assert.deepEqual(calls, ['simulate', 'limit SELL 19.98 @ 11.177', 'send']);
   178	  const s = trades(db);
   179	  assert.equal(s.total.trades, 1);
   180	  assert.equal(s.total.failed, 0);
   181	  // +20 LINK in wallet, -19.98 on MEXC (0.02 kept, valued at mid 11.205); -$200 USDC; USDT in; -0.0015 ETH gas
   182	  const expected = -200 + 19.98 * 11.177 * 0.9995 + 0.02 * 11.205 - 0.0015 * 2000;
   183	  assert.ok(Math.abs(s.total.pnl - expected) < 1e-6, `${s.total.pnl} vs ${expected}`);
   184	  assert.ok(Math.abs(s.total.gas - 3) < 1e-9);
   185	  assert.ok(alerts.some((a) => a.includes('✅ LIVE LINK DEX_BUY [ok]') && a.includes('Net PnL')));
   186	});
   187	
   188	test('no trade when the gap is below max($15, 0.5%)', async () => {
   189	  const { engine, db, calls } = setup({ bid: 10.9 });
   190	  await engine.tick();
   191	  assert.deepEqual(calls, []);
   192	  assert.equal(trades(db).total.trades, 0);
   193	});
   194	
   195	test('DEX leg fails after MEXC sold: buys back at market, alerts one-sided', async () => {
   196	  const { engine, db, alerts, calls, bal } = setup({ dexOk: false });
   197	  await engine.tick();
   198	  assert.ok(calls.includes('limit BUY 19.98 @ 11.435')); // close: aggressive limit 2% over ask 11.21
   199	  const row = trades(db);
   200	  assert.equal(row.total.failed, 1);
   201	  assert.ok(alerts.some((a) => a.startsWith('⚠️ ONE-SIDED FILL LINK')));
   202	  assert.ok(Math.abs(bal.walletToken.LINK - 100) < 1e-9); // wallet untouched
   203	  assert.ok(Math.abs(bal.mexc.LINK - 100 + 19.98 * 0.0005) < 1e-9); // flat again except the fee
   204	});
   205	
   206	test('MEXC partial fill: rest is cancelled and closed at market', async () => {
   207	  const { engine, calls } = setup({ mexcFillRatio: 0.5 });
   208	  await engine.tick();
   209	  assert.ok(calls.includes('cancel 1'));
   210	  assert.ok(calls.includes('limit SELL 9.99 @ 10.976')); // rest closed with an aggressive limit 2% under the bid
   211	});
   212	
   213	test('simulation failure: nothing is sent, approval gas is still booked', async () => {
   214	  const { engine, db, calls } = setup({ simulateThrows: true, approvalNeeded: true });
   215	  await engine.tick();
   216	  assert.ok(calls[0].startsWith('approve 200000000')); // exact amount: 200 USDC, never MaxUint256
   217	  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
   218	  const s = trades(db);
   219	  assert.equal(s.total.trades, 0); // approval rows are not trades
   220	  assert.ok(s.total.pnl < 0 && s.total.gas > 0);
   221	});
   222	
   223	test('gas above MAX_GAS_GWEI: no quotes at all', async () => {
   224	  const { engine, calls } = setup({ gasGwei: 50n });
   225	  await engine.tick();
   226	  assert.deepEqual(calls, []);
   227	});
   228	
   229	test('kill switch: paused bot does nothing', async () => {
   230	  const { engine, risk, calls } = setup({});
   231	  risk.pause('Telegram /stop');
   232	  await engine.tick();
   233	  assert.deepEqual(calls, []);
   234	});
   235	
   236	test('3 failed trades in a row pause trading', async () => {
   237	  const { engine, risk, alerts } = setup({ dexOk: false });
   238	  await engine.tick();
   239	  await engine.tick();
   240	  await engine.tick();
   241	  assert.equal(risk.paused, true);
   242	  assert.ok(alerts.some((a) => a.includes('3 failed trades in a row')));
   243	  const before = alerts.length;
   244	  await engine.tick();
   245	  assert.equal(alerts.length, before); // stays stopped
   246	});
   247	
   248	test('paper mode: records the trade, sends nothing real', async () => {
   249	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   250	  await engine.tick();
   251	  assert.deepEqual(calls, []);
   252	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   253	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER LINK')));
   254	});
   255	
   256	test('DEX outcome unknown: NO automatic unwind, trading paused', async () => {
   257	  const { engine, risk, calls, alerts } = setup({ dexUnknown: true });
   258	  await engine.tick();
   259	  assert.ok(!calls.some((c) => c.startsWith('market') || c.startsWith('limit BUY')));
   260	  assert.equal(risk.paused, true);
   261	  assert.ok(alerts.some((a) => a.includes('outcome UNKNOWN')));
   262	});
   263	
   264	test('unwind SELL that only partly fills is detected (not assumed flat)', async () => {
   265	  const { engine, risk, calls, alerts } = setup({ mexcFillRatio: 0.5, closeFillRatio: 0.5 });
   266	  await engine.tick();
   267	  assert.ok(calls.includes('limit SELL 9.99 @ 10.976'));
   268	  assert.equal(risk.paused, true);
   269	  assert.equal(risk.critical, true);
   270	  // reports what is REALLY still open (half of 9.99), not the full quantity
   271	  assert.ok(alerts.some((a) => a.includes('market close FAILED') && a.includes('Still open: MEXC SELL 5 LINK')));
   272	});
   273	
   274	test('MEXC 5xx on order placement: found by clientOrderId, no double sell', async () => {
   275	  const { engine, db, calls } = setup({ placeAmbiguous: true });
   276	  await engine.tick();
   277	  assert.equal(calls.filter((c) => c.startsWith('limit SELL')).length, 1); // never re-sent, never "unwound"
   278	  assert.ok(!calls.some((c) => c.startsWith('limit BUY')));
   279	  assert.equal(trades(db).total.failed, 0);
   280	});
   281	
   282	test('order below MEXC minNotional: rejected BEFORE any DEX tx', async () => {
   283	  const { engine, calls } = setup({ minNotional: 1000 });
   284	  await engine.tick();
   285	  assert.deepEqual(calls, []); // no simulate, no send, no MEXC order
   286	});
   287	
   288	test('unresolved earlier DEX tx: no new trades', async () => {
   289	  const { engine, calls } = setup({ unresolved: true });
   290	  await engine.tick();
   291	  assert.deepEqual(calls, []);
   292	});
   293	
   294	test('critical pause needs /start confirm; soft pause does not', () => {
   295	  const { risk } = setup({});
   296	  risk.pause('Telegram /stop');
   297	  assert.equal(risk.resume(), true);
   298	  risk.pause('DEX tx unknown 0xabc', true);
   299	  risk.pause('Telegram /stop'); // a later soft pause must not downgrade it
   300	  assert.equal(risk.critical, true);
   301	  assert.equal(risk.resume(), false);
   302	  assert.equal(risk.paused, true);
   303	  assert.equal(risk.resume(true), true);
   304	  assert.equal(risk.paused, false);
   305	});
   306	
   307	test('worst case beyond the remaining daily loss budget: skipped before any order', async () => {
   308	  const { engine, db, calls } = setup({});
   309	  db.insertTrade({ ts: Date.now(), day: (await import('../src/util.js')).dhakaDay(), mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 1, qty: 1, buy_price: 1, sell_price: 1, expected_net: 0, cex_fee_usd: 0, gas_usd: 0, pnl_usd: -25, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
   310	  await engine.tick(); // budget left $5 < 5% of $200 + gas
   311	  assert.deepEqual(calls, []);
   312	});
   313	
   314	test('restart with an executing row: looked up, reported, paused until /start confirm', async () => {
   315	  const { db, risk } = setup({});
   316	  const { recoverExecuting } = await import('../src/recovery.js');
   317	  db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 200, qty: 19.98, buy_price: 10, sell_price: 11, expected_net: 18, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: '0xpending', cex_order_id: 'cidX', note: 'client order id cidX; nonce 7' });
   318	  const alerts: string[] = [];
   319	  await recoverExecuting(
   320	    db, risk, { send: async (t) => void alerts.push(t) },
   321	    { getOrderByClientId: async () => ({ orderId: '9', status: 'FILLED', executedQty: '19.98' }) as Order },
   322	    async () => null,
   323	  );
   324	  assert.equal(risk.paused, true);
   325	  assert.equal(risk.critical, true);
   326	  assert.equal(risk.resume(), false);
   327	  assert.equal(db.executingTrades().length, 0);
   328	  assert.ok(alerts[0].includes('MEXC order 9: FILLED, filled 19.98') && alerts[0].includes('NOT MINED'));
   329	});
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
    44	  process.env.PRIVATE_KEY = '0x' + '22'.repeat(32);
    45	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    46	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    47	  const cfg = loadConfig();
    48	  const db = o.db ?? new Db(':memory:');
    49	  const risk = new Risk(db, cfg.mode, cfg);
    50	  const alerts: string[] = [];
    51	  const calls: string[] = [];
    52	  const dexPrice = o.dexPrice ?? 1.15;
    53	  const state = {
    54	    mexc: { USDT: 1000, XYZ: 0 } as Record<string, number>,
    55	    wallet: { [XYZ]: 0n, [USDC]: 0n } as Record<string, bigint>,
    56	    withdrawStatus: o.withdrawStatus ?? 4,
    57	    dexPrice,
    58	    withdrawals: [] as { id: string; status: number; amount: string; withdrawOrderId?: string }[],
    59	  };
    60	  const orders = new Map<string, Order>();
    61	  let lastQuote: QuoteRequest | null = null;
    62	
    63	  const mexc: TransferMexc = {
    64	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD')],
    65	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }],
    66	    coinConfigs: async () => [coin('XYZ', XYZ), coin('BAD', '0x2222222222222222222222222222222222222222', true, false)],
    67	    bookTickers: async () => new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }]]),
    68	    depth: async () => ({ bids: [[0.999, 1e6]], asks: [[1.0, 1e6]], ts: Date.now() }),
    69	    balances: async () => ({ ...state.mexc }),
    70	    limitOrder: async (_s, side, q, p) => {
    71	      calls.push(`limit ${side} ${q} @ ${p}`);
    72	      const qty = Number(q);
    73	      state.mexc.USDT -= qty * 1.0;
    74	      state.mexc.XYZ += qty * (1 - cfg.mexcTakerFee);
    75	      orders.set('b1', { orderId: 'b1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(qty * 1.0), origQty: q, price: p, side });
    76	      return { orderId: 'b1' };
    77	    },
    78	    marketSell: async (_s, q) => {
    79	      calls.push(`market SELL ${q}`);
    80	      state.mexc.XYZ -= Number(q);
    81	      orders.set('s1', { orderId: 's1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(Number(q) * 0.999), origQty: q, price: '0', side: 'SELL' });
    82	      return { orderId: 's1' };
    83	    },
    84	    getOrder: async (_s, id) => orders.get(id)!,
    85	    getOrderByClientId: async () => null,
    86	    cancelOrder: async (_s, id) => orders.get(id)!,
    87	    withdraw: async (p) => {
    88	      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
    89	      if (o.withdrawThrows) throw new Error('no withdraw permission');
    90	      state.mexc.XYZ -= Number(p.amount);
    91	      state.withdrawals.push({ id: 'w1', status: 4, amount: p.amount, withdrawOrderId: p.withdrawOrderId });
    92	      if (o.withdrawAmbiguous) throw new AmbiguousRequestError('timeout');
    93	      return 'w1';
    94	    },
    95	    findWithdraw: async (_c, _since, ref) => {
    96	      const w = state.withdrawals.find((x) => (ref.id && x.id === ref.id) || (ref.withdrawOrderId && x.withdrawOrderId === ref.withdrawOrderId));
    97	      return w ? { ...w, status: state.withdrawStatus } : null;
    98	    },
    99	  };
   100	
   101	  const quote = (r: QuoteRequest, firm: boolean): Quote => {
   102	    const out = (r.sellAmount * BigInt(Math.round(state.dexPrice * 1e6))) / 10n ** 18n; // token(18) -> USDC(6)
   103	    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
   104	  };
   105	
   106	  const chain: TransferChain = {
   107	    address: '0xMyWallet',
   108	    gas: async () => ({ baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI }),
   109	    decimals: async () => 18,
   110	    tokenBalance: async (t) => state.wallet[t] ?? 0n,
   111	    approveExact: async (_t, s, amount) => {
   112	      calls.push(`approve ${s} ${amount}`);
   113	      return { ok: true, gasCostWei: 60_000n * 10n * GWEI };
   114	    },
   115	    simulate: async () => (calls.push('simulate'), 150_000n),
   116	    send: async () => {
   117	      calls.push('send');
   118	      if (o.sendUnknown) return { ok: false, unknown: true, hash: '0xhash', gasCostWei: 0n, reason: 'unknown' };
   119	      if (o.sendFails) return { ok: false, hash: '0xhash', gasCostWei: 0n, reason: 'reverted' };
   120	      const r = lastQuote!;
   121	      state.wallet[XYZ] -= r.sellAmount;
   122	      state.wallet[USDC] += quote(r, true).buyAmount;
   123	      return { ok: true, hash: '0xhash', gasCostWei: 150_000n * 10n * GWEI };
   124	    },
   125	  };
   126	
   127	  const engine = new TransferEngine({
   128	    cfg, mexc, chain, db, risk,
   129	    tg: { send: async (t) => void alerts.push(t) },
   130	    agg: { name: '0x', price: async (r) => quote(r, false), quote: async (r) => ((lastQuote = r), quote(r, true)) },
   131	    dexPricesFn: async () => new Map([[XYZ, { price: dexPrice, tvl: 1e6 }]]),
   132	    sleep: async () => {},
   133	    now: o.now,
   134	  });
   135	  const arrive = (tokens: number) => (state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n);
   136	  return { engine, db, risk, alerts, calls, state, arrive, cfg };
   137	}
   138	
   139	test('loadUniverse keeps only ERC20 tokens with deposit AND withdraw open', async () => {
   140	  const { engine } = setup();
   141	  await engine.refreshUniverse(true);
   142	  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']); // BAD has withdrawals suspended
   143	  assert.equal(engine.universe[0].address, XYZ);
   144	  assert.equal(engine.universe[0].netWork, 'ETH');
   145	  assert.equal(engine.universe[0].withdrawFee, 1);
   146	});
   147	
   148	test('findGaps: filters TVL, too-small and absurd gaps, sorts biggest first', () => {
   149	  const rules = { qtyStep: 0.01, priceDecimals: 4, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT'], tradeSideType: 1 };
   150	  const tok = (base: string, address: string): ScanToken => ({ base, symbol: `${base}USDT`, address, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6, rules });
   151	  const tokens = [tok('A', '0xa'), tok('B', '0xb'), tok('C', '0xc'), tok('D', '0xd'), tok('E', '0xe')];
   152	  const tickers = new Map(['A', 'B', 'C', 'D', 'E'].map((b) => [`${b}USDT`, { bid: 0.99, ask: 1 }]));
   153	  const dex = new Map([
   154	    ['0xa', { price: 1.05, tvl: 1e6 }], // 5%
   155	    ['0xb', { price: 1.1, tvl: 1e6 }], // 10%
   156	    ['0xc', { price: 1.1, tvl: 1000 }], // thin pool
   157	    ['0xd', { price: 1.01, tvl: 1e6 }], // 1% < min
   158	    ['0xe', { price: 3, tvl: 1e6 }], // 200%: broken / different token
   159	  ]);
   160	  const g = findGaps(tokens, tickers, dex, { minTvlUsd: 200_000, minGapPct: 3 });
   161	  assert.deepEqual(g.map((x) => x.token.base), ['B', 'A']);
   162	});
   163	
   164	test('evaluateTransfer subtracts withdraw fee, drift reserve and all costs', () => {
   165	  const plan = planCexBuy({ sizeUsd: 200, asks: [[1, 1e6]], qtyStep: 0.01, takerFee: 0.0005 })!;
   166	  const ev = evaluateTransfer({ plan, withdrawFeeTokens: 1, usdcOut: 228.7, usdcMin: 228.5, gasUsd: 4, driftBps: 150, costs: { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 } });
   167	  assert.ok(Math.abs(ev.arriving - (200 * 0.9995 - 1)) < 1e-9);
   168	  const expected = 228.7 - 200 - 4 - (0.4 + 0.2) - 228.7 * 0.015 - 2;
   169	  assert.ok(Math.abs(ev.net - expected) < 1e-9);
   170	});
   171	
   172	test('full cycle: buy on MEXC -> withdraw to own wallet -> wait -> sell on DEX -> PnL', async () => {
   173	  const { engine, db, calls, alerts, arrive } = setup();
   174	  await engine.tick(); // finds gap, buys, withdraws
   175	  assert.equal(calls[0], 'limit BUY 200.00 @ 1.0020');
   176	  assert.equal(calls[1], 'withdraw 199.90 XYZ ETH -> 0xMyWallet'); // only ever our own wallet
   177	  assert.equal(db.openTransfers()[0].status, 'withdrawing');
   178	  assert.ok(alerts.some((a) => a.startsWith('📤 TRANSFER #1 XYZ')));
   179	
   180	  await engine.tick(); // still on its way: nothing new is bought meanwhile
   181	  assert.equal(calls.filter((c) => c.startsWith('limit')).length, 1);
   182	
   183	  arrive(198.9); // 199.9 - 1 withdraw fee
   184	  await engine.tick();
   185	  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
   186	  assert.ok(calls.includes('simulate') && calls.includes('send'));
   187	  assert.ok(!db.openTransfers().some((t) => t.id === 1)); // #1 done (a new one may start: gap still open)
   188	
   189	  const s = db.statsSince(0, 'live');
   190	  assert.equal(s.total.trades, 1);
   191	  assert.equal(s.total.failed, 0);
   192	  const usdcOut = Math.floor(198.9 * 1.15 * 1e6) / 1e6;
   193	  const gas = (0.0006 + 0.0015) * 2000;
   194	  assert.ok(Math.abs(s.total.pnl - (usdcOut - 200 - gas)) < 1e-6, String(s.total.pnl));
   195	  assert.ok(alerts.some((a) => a.includes('TRANSFER #1 XYZ done') && a.includes('Net PnL')));
   196	});
   197	
   198	test('restart while withdrawing: a new engine resumes the same transfer', async () => {
   199	  const first = setup();
   200	  await first.engine.tick();
   201	  // "restart": new engine, same database and balances
   202	  const second = setup({ db: first.db });
   203	  Object.assign(second.state, first.state);
   204	  second.state.wallet[XYZ] = BigInt(198.9e6) * 10n ** 12n;
   205	  await second.engine.tick();
   206	  assert.ok(!first.db.openTransfers().some((t) => t.id === 1));
   207	  assert.equal(first.db.statsSince(0, 'live').total.trades, 1);
   208	});
   209	
   210	test('withdraw request times out: never re-sent, found later by withdrawOrderId', async () => {
   211	  const { engine, db, calls, arrive } = setup({ withdrawAmbiguous: true });
   212	  await engine.tick();
   213	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   214	  await engine.tick(); // looks it up instead of withdrawing again
   215	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   216	  assert.equal(db.getTransfer(1)!.withdraw_id, 'w1');
   217	  arrive(198.9);
   218	  await engine.tick();
   219	  assert.equal(db.getTransfer(1)!.status, 'done');
   220	});
   221	
   222	test('price fell during the withdrawal: holds instead of selling at a big loss; /sell overrides', async () => {
   223	  let t = Date.UTC(2026, 10, 20, 6);
   224	  const { engine, db, calls, alerts, arrive, state } = setup({ now: () => t });
   225	  await engine.tick();
   226	  state.dexPrice = 0.9; // 10% below the MEXC buy price
   227	  arrive(198.9);
   228	  await engine.tick();
   229	  assert.ok(!calls.includes('send'));
   230	  assert.equal(db.getTransfer(1)!.status, 'selling');
   231	  assert.ok(alerts.some((a) => a.startsWith('✋ TRANSFER #1 XYZ') && a.includes('/sell 1')));
   232	  t += 6 * 60_000;
   233	  await engine.tick();
   234	  assert.ok(!calls.includes('send')); // still holding
   235	  assert.match(engine.forceSell(1), /selling on the next scan/);
   236	  await engine.tick();
   237	  assert.ok(calls.includes('send'));
   238	  assert.equal(db.getTransfer(1)!.status, 'done');
   239	});
   240	
   241	test('failed DEX sales back off, then stop retrying (no gas burn loop)', async () => {
   242	  let t = Date.UTC(2026, 10, 20, 6);
   243	  const { engine, db, calls, alerts, arrive } = setup({ sendFails: true, now: () => t });
   244	  await engine.tick();
   245	  arrive(198.9);
   246	  await engine.tick(); // attempt 1
   247	  await engine.tick(); // inside backoff: no attempt
   248	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   249	  for (const wait of [2, 10, 30]) {
   250	    t += wait * 60_000 + 1;
   251	    await engine.tick();
   252	  }
   253	  assert.equal(calls.filter((c) => c === 'send').length, 4);
   254	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   255	  t += 24 * 3600_000;
   256	  await engine.tick();
   257	  assert.equal(calls.filter((c) => c === 'send').length, 4); // no more automatic tries
   258	  assert.ok(alerts.some((a) => a.includes('Automatic retries STOPPED')));
   259	  assert.match(engine.clear(1), /closed manually/);
   260	});
   261	
   262	test('swap outcome unknown: stuck + paused, never retried automatically', async () => {
   263	  const { engine, db, risk, calls, arrive } = setup({ sendUnknown: true });
   264	  await engine.tick();
   265	  arrive(198.9);
   266	  await engine.tick();
   267	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   268	  assert.equal(risk.paused, true);
   269	  await engine.tick();
   270	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   271	});
   272	
   273	test('withdrawal never arrives: after 2x timeout it stops blocking new trades but is still watched', async () => {
   274	  let t = Date.UTC(2026, 10, 20, 6);
   275	  const { engine, db, calls, alerts, cfg } = setup({ now: () => t });
   276	  await engine.tick();
   277	  t += (cfg.transferTimeoutMin + 1) * 60_000;
   278	  await engine.tick();
   279	  assert.ok(alerts.some((a) => a.includes('not in wallet after')));
   280	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1); // still blocking
   281	  t += cfg.transferTimeoutMin * 60_000;
   282	  await engine.tick(); // gives up blocking
   283	  assert.equal(db.getTransfer(1)!.alerted_timeout, 2);
   284	  assert.equal(db.getTransfer(1)!.status, 'withdrawing'); // still watched
   285	  await engine.tick();
   286	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 2); // new trade allowed
   287	});
   288	
   289	test('withdraw rejected: sells the tokens back on MEXC and records a failure', async () => {
   290	  const { engine, db, calls, alerts } = setup({ withdrawThrows: true });
   291	  await engine.tick();
   292	  assert.ok(calls.includes('market SELL 199.90'));
   293	  assert.equal(db.openTransfers().length, 0);
   294	  assert.equal(db.statsSince(0, 'live').total.failed, 1);
   295	  assert.ok(alerts.some((a) => a.includes('withdraw rejected')));
   296	});
   297	
   298	test('withdrawal FAILED on MEXC side: sells back on MEXC', async () => {
   299	  const { engine, db, calls, state } = setup();
   300	  await engine.tick();
   301	  state.withdrawStatus = 8;
   302	  state.mexc.XYZ += 199.9; // funds returned to the MEXC account
   303	  await engine.tick();
   304	  assert.ok(calls.includes('market SELL 199.90'));
   305	  assert.ok(!db.openTransfers().some((t) => t.id === 1));
   306	});
   307	
   308	test('gap too small after exact costs: nothing happens', async () => {
   309	  const { engine, calls } = setup({ dexPrice: 1.05 }); // 5% gap, but drift+gas+fees+min $15 eat it
   310	  await engine.tick();
   311	  assert.deepEqual(calls, []);
   312	});
   313	
   314	test('paused bot does not open new transfers', async () => {
   315	  const { engine, risk, calls } = setup();
   316	  risk.pause('Telegram /stop');
   317	  await engine.tick();
   318	  assert.deepEqual(calls, []);
   319	});
   320	
   321	test('paper mode records the opportunity without orders or withdrawals', async () => {
   322	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   323	  await engine.tick();
   324	  assert.deepEqual(calls, []);
   325	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   326	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER TRANSFER XYZ')));
   327	});
   328	
   329	test('loadUniverse respects WATCHLIST', async () => {
   330	  const fake = {
   331	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC')],
   332	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }, { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' }],
   333	    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', '0x3333333333333333333333333333333333333333')],
   334	  };
   335	  const u = await loadUniverse(fake as never, { minVolumeUsd: 1, only: ['ABC'] });
   336	  assert.deepEqual(u.map((t) => t.base), ['ABC']);
   337	});
```

