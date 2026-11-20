# mexc-dex-arb: full source for review

MEXC <-> Ethereum DEX arbitrage bot (TypeScript, Node 20). Strategies: transfer (buy MEXC -> withdraw -> sell DEX) and inventory. Please review for bugs, money-loss risks and security issues.

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
     4	# live (real money, default) | paper (no orders, no transactions)
     5	MODE=live
     6	
     7	# transfer  = scan ALL MEXC ERC20 tokens; buy on MEXC -> withdraw to wallet -> sell on DEX (default)
     8	# inventory = hold tokens on both sides, trade both legs at the same moment (no withdrawals)
     9	STRATEGY=transfer
    10	
    11	# ---------- Ethereum ----------
    12	# Your own RPC (Alchemy / Infura / QuickNode). Used for reading and simulation.
    13	RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
    14	# Private RPC for sending (never the public mempool): MEV Blocker or Flashbots Protect
    15	SEND_RPC_URL=https://rpc.mevblocker.io
    16	# SEND_RPC_URL=https://rpc.flashbots.net/fast
    17	# NEW hot wallet used only by this bot. Keep only the trading inventory in it.
    18	PRIVATE_KEY=
    19	
    20	# ---------- DEX aggregator ----------
    21	# 0x (https://dashboard.0x.org) or 1inch (https://portal.1inch.dev)
    22	DEX_AGGREGATOR=0x
    23	ZEROX_API_KEY=
    24	ONEINCH_API_KEY=
    25	
    26	# ---------- MEXC ----------
    27	# STRATEGY=inventory: Spot trading ONLY, NO withdrawal.
    28	# STRATEGY=transfer : Spot trading + Withdraw. Bind the key to your VPS IP AND turn on the MEXC
    29	#                     withdrawal address whitelist with ONLY your hot wallet address in it.
    30	MEXC_API_KEY=
    31	MEXC_API_SECRET=
    32	MEXC_TAKER_FEE=0.0005
    33	
    34	# ---------- Telegram ----------
    35	# Create a bot with @BotFather, send it any message, then get your chat id from
    36	# https://api.telegram.org/bot<TOKEN>/getUpdates  (message.chat.id)
    37	TELEGRAM_BOT_TOKEN=
    38	TELEGRAM_CHAT_ID=
    39	
    40	# ---------- Watchlist ----------
    41	# Optional: only these tokens (MEXC base symbols). Empty = auto-discover by volume.
    42	WATCHLIST=
    43	WATCHLIST_MAX=8
    44	MIN_DEX_TVL_USD=200000
    45	MIN_MEXC_VOLUME_USD=500000
    46	
    47	# ---------- Profit rules ----------
    48	# Trade only if net > max(MIN_PROFIT_USD, MIN_PROFIT_PCT% of size)
    49	MIN_PROFIT_USD=15
    50	MIN_PROFIT_PCT=0.5
    51	DEX_SLIPPAGE_BPS=30
    52	CEX_SLIPPAGE_BPS=20
    53	SAFETY_MARGIN_USD=2
    54	PRIORITY_FEE_GWEI=1
    55	
    56	# ---------- Risk limits ----------
    57	MAX_TRADE_USD=200
    58	MIN_TRADE_USD=25
    59	MAX_TRADES_PER_DAY=20
    60	DAILY_LOSS_LIMIT_USD=30
    61	MAX_GAS_GWEI=40
    62	MAX_CONSECUTIVE_FAILS=3
    63	MIN_ETH_FOR_GAS=0.01
    64	TX_TIMEOUT_SEC=60
    65	
    66	# ---------- Transfer strategy ----------
    67	SCAN_INTERVAL_SEC=20
    68	# Cheap pre-filter (MEXC ask vs DexScreener price) before exact quotes
    69	SCAN_MIN_GAP_PCT=3
    70	# Bigger "gaps" are almost always a wrong token or a dead pool
    71	SCAN_MAX_GAP_PCT=30
    72	SCAN_EXACT_QUOTES=5
    73	# Price-move reserve while the withdrawal travels (150 = 1.5%)
    74	TRANSFER_DRIFT_BPS=150
    75	TRANSFER_TIMEOUT_MIN=90
    76	MAX_OPEN_TRANSFERS=1
    77	# On arrival, do not auto-sell at more than this % loss vs the MEXC cost: hold + alert (/sell <id> forces)
    78	TRANSFER_MAX_LOSS_PCT=3
    79	
    80	DB_PATH=data/bot.sqlite
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
    21	  const mode = str('MODE', 'live').toLowerCase() as Mode;
    22	  if (mode !== 'live' && mode !== 'paper') throw new Error('MODE must be live or paper');
    23	  const aggregator = str('DEX_AGGREGATOR', '0x') as AggregatorName;
    24	  if (aggregator !== '0x' && aggregator !== '1inch') throw new Error('DEX_AGGREGATOR must be 0x or 1inch');
    25	
    26	  const strategy = str('STRATEGY', 'transfer').toLowerCase();
    27	  if (strategy !== 'transfer' && strategy !== 'inventory') throw new Error('STRATEGY must be transfer or inventory');
    28	
    29	  return {
    30	    mode,
    31	    // transfer  = scan all MEXC ERC20 tokens, buy on MEXC, withdraw to wallet, sell on DEX
    32	    // inventory = hold tokens on both sides and trade both legs at the same moment
    33	    strategy: strategy as 'transfer' | 'inventory',
    34	    // --- Ethereum ---
    35	    rpcUrl: str('RPC_URL'),
    36	    // Private RPC for sending: never the public mempool.
    37	    sendRpcUrl: str('SEND_RPC_URL', 'https://rpc.mevblocker.io'),
    38	    privateKey: mode === 'live' ? str('PRIVATE_KEY') : str('PRIVATE_KEY', ''),
    39	    usdc: str('USDC_ADDRESS', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48').toLowerCase(),
    40	    // --- DEX aggregator ---
    41	    aggregator,
    42	    zeroExApiKey: str('ZEROX_API_KEY', ''),
    43	    oneInchApiKey: str('ONEINCH_API_KEY', ''),
    44	    // --- MEXC ---
    45	    mexcApiKey: mode === 'live' ? str('MEXC_API_KEY') : str('MEXC_API_KEY', ''),
    46	    mexcApiSecret: mode === 'live' ? str('MEXC_API_SECRET') : str('MEXC_API_SECRET', ''),
    47	    mexcTakerFee: num('MEXC_TAKER_FEE', 0.0005),
    48	    // --- Telegram ---
    49	    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    50	    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    51	    // --- Watchlist ---
    52	    watchlist: str('WATCHLIST', '')
    53	      .split(',')
    54	      .map((s) => s.trim().toUpperCase())
    55	      .filter(Boolean),
    56	    watchlistMax: num('WATCHLIST_MAX', 8),
    57	    minDexTvlUsd: num('MIN_DEX_TVL_USD', 200_000),
    58	    minMexcVolumeUsd: num('MIN_MEXC_VOLUME_USD', 500_000),
    59	    // --- Costs & thresholds ---
    60	    minProfitUsd: num('MIN_PROFIT_USD', 15),
    61	    minProfitPct: num('MIN_PROFIT_PCT', 0.5), // percent of trade size
    62	    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
    63	    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 20),
    64	    safetyMarginUsd: num('SAFETY_MARGIN_USD', 2),
    65	    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
    66	    // --- Risk limits ---
    67	    maxTradeUsd: num('MAX_TRADE_USD', 200),
    68	    minTradeUsd: num('MIN_TRADE_USD', 25),
    69	    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
    70	    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
    71	    maxGasGwei: num('MAX_GAS_GWEI', 40),
    72	    maxConsecutiveFails: num('MAX_CONSECUTIVE_FAILS', 3),
    73	    minEthForGas: num('MIN_ETH_FOR_GAS', 0.01),
    74	    txTimeoutSec: num('TX_TIMEOUT_SEC', 60),
    75	    // --- Transfer strategy (scanner) ---
    76	    scanIntervalSec: num('SCAN_INTERVAL_SEC', 20),
    77	    scanMinGapPct: num('SCAN_MIN_GAP_PCT', 3), // cheap pre-filter before exact quotes
    78	    scanMaxGapPct: num('SCAN_MAX_GAP_PCT', 30), // bigger gaps are almost always a wrong token / dead pool
    79	    scanExactQuotes: num('SCAN_EXACT_QUOTES', 5), // max exact DEX quotes per scan
    80	    transferDriftBps: num('TRANSFER_DRIFT_BPS', 150), // price-move reserve while withdrawing
    81	    transferTimeoutMin: num('TRANSFER_TIMEOUT_MIN', 90),
    82	    maxOpenTransfers: num('MAX_OPEN_TRANSFERS', 1),
    83	    // After arrival, do not sell automatically if it would lose more than this % of the cost: hold + alert.
    84	    transferMaxLossPct: num('TRANSFER_MAX_LOSS_PCT', 3),
    85	    // --- Misc ---
    86	    dbPath: str('DB_PATH', 'data/bot.sqlite'),
    87	    envPath: str('ENV_PATH', '.env'),
    88	  };
    89	}
    90	
    91	export type Config = ReturnType<typeof loadConfig>;
    92	
    93	/** Reject settings that would make the bot trade backwards or without limits. */
    94	export function validateConfig(c: Config): Config {
    95	  const errs: string[] = [];
    96	  const range = (name: string, v: number, min: number, max: number) => {
    97	    if (!(v >= min && v <= max)) errs.push(`${name}=${v} must be between ${min} and ${max}`);
    98	  };
    99	  range('MIN_PROFIT_USD', c.minProfitUsd, 0, 1e6);
   100	  range('MIN_PROFIT_PCT', c.minProfitPct, 0, 100);
   101	  range('DEX_SLIPPAGE_BPS', c.dexSlippageBps, 1, 500);
   102	  range('CEX_SLIPPAGE_BPS', c.cexSlippageBps, 0, 500);
   103	  range('SAFETY_MARGIN_USD', c.safetyMarginUsd, 0, 1e6);
   104	  range('MEXC_TAKER_FEE', c.mexcTakerFee, 0, 0.01);
   105	  range('MAX_TRADE_USD', c.maxTradeUsd, 1, 1e7);
   106	  range('MIN_TRADE_USD', c.minTradeUsd, 1, c.maxTradeUsd);
   107	  range('MAX_TRADES_PER_DAY', c.maxTradesPerDay, 1, 10_000);
   108	  range('DAILY_LOSS_LIMIT_USD', c.dailyLossLimitUsd, 0.01, 1e7);
   109	  range('MAX_GAS_GWEI', c.maxGasGwei, 0.01, 1000);
   110	  range('MAX_CONSECUTIVE_FAILS', c.maxConsecutiveFails, 1, 100);
   111	  range('TX_TIMEOUT_SEC', c.txTimeoutSec, 12, 600);
   112	  range('SCAN_INTERVAL_SEC', c.scanIntervalSec, 5, 3600);
   113	  range('SCAN_MIN_GAP_PCT', c.scanMinGapPct, 0, c.scanMaxGapPct);
   114	  range('SCAN_MAX_GAP_PCT', c.scanMaxGapPct, c.scanMinGapPct, 100);
   115	  range('TRANSFER_DRIFT_BPS', c.transferDriftBps, 0, 5000);
   116	  range('TRANSFER_TIMEOUT_MIN', c.transferTimeoutMin, 5, 24 * 60);
   117	  range('TRANSFER_MAX_LOSS_PCT', c.transferMaxLossPct, 0, 100);
   118	  range('MAX_OPEN_TRANSFERS', c.maxOpenTransfers, 1, 10);
   119	  if (errs.length) throw new Error(`Invalid config:\n  ${errs.join('\n  ')}`);
   120	  return c;
   121	}
   122	
   123	/** Every secret value, so the logger can scrub them from any output. */
   124	export function secretsOf(cfg: Config): string[] {
   125	  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken]
   126	    .filter((s) => s && s.length >= 8)
   127	    .flatMap((s) => [s, s.replace(/^0x/, '')]);
   128	}
```

## `src/db.ts`

```ts
     1	// SQLite storage: trades and persistent bot state (pause flag, failure streak, ...).
     2	import Database from 'better-sqlite3';
     3	import fs from 'node:fs';
     4	import path from 'node:path';
     5	
     6	// 'approval' = gas spent on an approval for a trade that was then skipped (a real cost, not a trade).
     7	export type TradeStatus = 'ok' | 'one_sided' | 'dex_failed' | 'cex_failed' | 'paper' | 'approval';
     8	
     9	export interface TradeRow {
    10	  ts: number;
    11	  day: string; // Bangladesh day
    12	  mode: string;
    13	  symbol: string;
    14	  direction: string;
    15	  size_usd: number;
    16	  qty: number;
    17	  buy_price: number;
    18	  sell_price: number;
    19	  expected_net: number;
    20	  cex_fee_usd: number;
    21	  gas_usd: number;
    22	  pnl_usd: number;
    23	  status: TradeStatus;
    24	  dex_tx: string | null;
    25	  cex_order_id: string | null;
    26	  note: string | null;
    27	}
    28	
    29	// One buy -> withdraw -> sell cycle. Persisted so a restart resumes it where it stopped.
    30	export type TransferStatus = 'buying' | 'withdrawing' | 'selling' | 'done' | 'failed' | 'stuck';
    31	export interface TransferRow {
    32	  id?: number;
    33	  ts: number;
    34	  updated: number;
    35	  base: string;
    36	  symbol: string;
    37	  address: string;
    38	  decimals: number;
    39	  net_work: string;
    40	  qty_step: number;
    41	  price_decimals: number;
    42	  status: TransferStatus;
    43	  buy_qty: number;
    44	  cost_usd: number;
    45	  buy_order_id: string | null;
    46	  withdraw_amount: string | null;
    47	  withdraw_id: string | null;
    48	  wallet_before: string | null; // token balance (base units) before the withdrawal
    49	  received: string | null; // base units that arrived
    50	  usdc_out: number | null;
    51	  gas_usd: number;
    52	  expected_net: number;
    53	  pnl: number | null;
    54	  sell_attempts: number;
    55	  alerted_timeout: number; // 0 none, 1 slow alert sent, 2 given up waiting (no longer blocks new trades)
    56	  note: string | null;
    57	  withdraw_fee: number; // tokens, fixed at decision time
    58	  next_try: number; // ms timestamp: no sell attempt before this (backoff)
    59	  force_sell: number; // 1 = /sell command: sell even below the loss floor
    60	  hold_alerted: number;
    61	}
    62	
    63	const TRANSFER_MIGRATIONS = [
    64	  'ALTER TABLE transfers ADD COLUMN withdraw_fee REAL NOT NULL DEFAULT 0',
    65	  'ALTER TABLE transfers ADD COLUMN next_try INTEGER NOT NULL DEFAULT 0',
    66	  'ALTER TABLE transfers ADD COLUMN force_sell INTEGER NOT NULL DEFAULT 0',
    67	  'ALTER TABLE transfers ADD COLUMN hold_alerted INTEGER NOT NULL DEFAULT 0',
    68	];
    69	
    70	export class Db {
    71	  private db: Database.Database;
    72	
    73	  constructor(file: string) {
    74	    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    75	    this.db = new Database(file);
    76	    this.db.pragma('journal_mode = WAL');
    77	    this.db.exec(`
    78	      CREATE TABLE IF NOT EXISTS trades (
    79	        id INTEGER PRIMARY KEY AUTOINCREMENT,
    80	        ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
    81	        symbol TEXT NOT NULL, direction TEXT NOT NULL,
    82	        size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
    83	        expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL,
    84	        status TEXT NOT NULL, dex_tx TEXT, cex_order_id TEXT, note TEXT
    85	      );
    86	      CREATE INDEX IF NOT EXISTS trades_day ON trades(day, mode);
    87	      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    88	      CREATE TABLE IF NOT EXISTS transfers (
    89	        id INTEGER PRIMARY KEY AUTOINCREMENT,
    90	        ts INTEGER NOT NULL, updated INTEGER NOT NULL,
    91	        base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL,
    92	        net_work TEXT NOT NULL, qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL,
    93	        status TEXT NOT NULL, buy_qty REAL, cost_usd REAL, buy_order_id TEXT,
    94	        withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT,
    95	        usdc_out REAL, gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL,
    96	        sell_attempts INTEGER NOT NULL DEFAULT 0, alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT
    97	      );
    98	    `);
    99	    const cols = new Set((this.db.prepare('PRAGMA table_info(transfers)').all() as { name: string }[]).map((c) => c.name));
   100	    for (const m of TRANSFER_MIGRATIONS) {
   101	      const col = m.split(' ')[5];
   102	      if (!cols.has(col)) this.db.exec(m);
   103	    }
   104	  }
   105	
   106	  insertTrade(t: TradeRow): void {
   107	    this.db
   108	      .prepare(
   109	        `INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net,
   110	          cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note)
   111	         VALUES (@ts, @day, @mode, @symbol, @direction, @size_usd, @qty, @buy_price, @sell_price, @expected_net,
   112	          @cex_fee_usd, @gas_usd, @pnl_usd, @status, @dex_tx, @cex_order_id, @note)`,
   113	      )
   114	      .run(t);
   115	  }
   116	
   117	  dayStats(day: string, mode: string): { trades: number; pnl: number; gas: number; failed: number } {
   118	    const r = this.db
   119	      .prepare(
   120	        `SELECT SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades,
   121	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   122	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   123	         FROM trades WHERE day = ? AND mode = ?`,
   124	      )
   125	      .get(day, mode) as { trades: number | null; pnl: number; gas: number; failed: number | null };
   126	    return { trades: r.trades ?? 0, pnl: r.pnl, gas: r.gas, failed: r.failed ?? 0 };
   127	  }
   128	
   129	  /** Stats since a timestamp, overall and per symbol. */
   130	  statsSince(sinceTs: number, mode?: string) {
   131	    const where = mode ? 'ts >= ? AND mode = ?' : 'ts >= ?';
   132	    const args = mode ? [sinceTs, mode] : [sinceTs];
   133	    const total = this.db
   134	      .prepare(
   135	        `SELECT COALESCE(SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END),0) trades,
   136	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   137	                COALESCE(SUM(cex_fee_usd),0) fees,
   138	                COALESCE(SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END),0) failed
   139	         FROM trades WHERE ${where}`,
   140	      )
   141	      .get(...args) as { trades: number; pnl: number; gas: number; fees: number; failed: number };
   142	    const bySymbol = this.db
   143	      .prepare(
   144	        `SELECT symbol, SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades, SUM(pnl_usd) pnl, SUM(gas_usd) gas,
   145	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   146	         FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`,
   147	      )
   148	      .all(...args) as { symbol: string; trades: number; pnl: number; gas: number; failed: number }[];
   149	    return { total, bySymbol };
   150	  }
   151	
   152	  insertTransfer(t: TransferRow): number {
   153	    const cols = Object.keys(t).filter((k) => k !== 'id');
   154	    const r = this.db
   155	      .prepare(`INSERT INTO transfers (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
   156	      .run(t);
   157	    return Number(r.lastInsertRowid);
   158	  }
   159	
   160	  updateTransfer(id: number, fields: Partial<TransferRow>): void {
   161	    const f = { ...fields, updated: Date.now() };
   162	    const cols = Object.keys(f).filter((k) => k !== 'id');
   163	    this.db.prepare(`UPDATE transfers SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...f, id });
   164	  }
   165	
   166	  /** Transfers the bot still works on automatically ('stuck' waits for a human: /sell or /clear). */
   167	  openTransfers(): TransferRow[] {
   168	    return this.db.prepare(`SELECT * FROM transfers WHERE status IN ('buying','withdrawing','selling') ORDER BY id`).all() as TransferRow[];
   169	  }
   170	
   171	  /** Transfers that hold back new trades (open, and not given up on). */
   172	  blockingTransfers(): TransferRow[] {
   173	    return this.openTransfers().filter((t) => t.alerted_timeout < 2);
   174	  }
   175	
   176	  stuckTransfers(): TransferRow[] {
   177	    return this.db.prepare(`SELECT * FROM transfers WHERE status = 'stuck' ORDER BY id`).all() as TransferRow[];
   178	  }
   179	
   180	  getTransfer(id: number): TransferRow | undefined {
   181	    return this.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as TransferRow | undefined;
   182	  }
   183	
   184	  getState(key: string): string | undefined {
   185	    return (this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined)?.value;
   186	  }
   187	
   188	  setState(key: string, value: string): void {
   189	    this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
   190	  }
   191	
   192	  close(): void {
   193	    this.db.close();
   194	  }
   195	}
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
    22	
    23	/** Unique id we give MEXC orders, so an order can be found even if the request timed out. */
    24	export const clientId = (tag: string) => `arb${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.slice(0, 32);
    25	
    26	/**
    27	 * Place an order; if the request is ambiguous (timeout / 5xx) look it up by client id
    28	 * instead of assuming it was not placed. Throws UNKNOWN_ORDER_STATE if that is impossible.
    29	 */
    30	export async function placeSafely(
    31	  mexc: Pick<CexApi, 'getOrderByClientId'>,
    32	  symbol: string,
    33	  cid: string,
    34	  place: () => Promise<{ orderId: string }>,
    35	  sleep: (ms: number) => Promise<void>,
    36	): Promise<{ orderId: string }> {
    37	  try {
    38	    return await place();
    39	  } catch (e) {
    40	    if (!(e instanceof AmbiguousRequestError)) throw e; // clearly rejected: nothing was placed
    41	    let notFound = 0;
    42	    for (let i = 0; i < 5; i++) {
    43	      await sleep(1000);
    44	      let o: Order | null;
    45	      try {
    46	        o = await mexc.getOrderByClientId(symbol, cid);
    47	      } catch {
    48	        continue; // lookup itself failed: try again
    49	      }
    50	      if (o) return { orderId: o.orderId }; // it WAS placed
    51	      if (++notFound >= 3) throw e; // MEXC says three times that no such order exists
    52	    }
    53	    throw new Error(`UNKNOWN_ORDER_STATE client id ${cid}: ${errMsg(e)}`);
    54	  }
    55	}
    56	import { decimalsOfStep, dhakaDay, sleep as realSleep, toFloat, toUnits, usd } from './util.js';
    57	
    58	export const USDC_DECIMALS = 6;
    59	export { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
    60	import { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
    61	const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
    62	
    63	// Narrow interfaces so tests can plug in fakes.
    64	export interface CexApi {
    65	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
    66	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
    67	  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
    68	  getOrder(symbol: string, orderId: string): Promise<Order>;
    69	  cancelOrder(symbol: string, orderId: string): Promise<Order>;
    70	}
    71	export interface ChainApi {
    72	  readonly address: string;
    73	  gas(): Promise<GasInfo>;
    74	  approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint>;
    75	  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
    76	  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
    77	  send(tx: { to: string; data: string; value?: bigint }, gasLimit: bigint, gas: GasInfo, timeoutSec: number): Promise<TxResult>;
    78	}
    79	export interface Notifier {
    80	  send(text: string): Promise<void>;
    81	}
    82	
    83	export interface EngineDeps {
    84	  cfg: Config;
    85	  mexc: CexApi;
    86	  chain: ChainApi;
    87	  agg: Aggregator;
    88	  db: Db;
    89	  risk: Risk;
    90	  tg: Notifier;
    91	  book: (symbol: string) => Promise<Book>;
    92	  /** Authoritative book (REST) used for the final check right before trading; defaults to `book`. */
    93	  freshBook?: (symbol: string) => Promise<Book>;
    94	  balances: () => Promise<Balances>;
    95	  tokens: Token[];
    96	  sleep?: (ms: number) => Promise<void>;
    97	}
    98	
    99	export interface Candidate {
   100	  token: Token;
   101	  opp: Opportunity;
   102	  req: QuoteRequest;
   103	  spender: string;
   104	  approvalGas: bigint;
   105	  tokenUsd: number;
   106	}
   107	
   108	const mid = (b: Book) => (b.bids[0][0] + b.asks[0][0]) / 2;
   109	
   110	export class Engine {
   111	  private lastNote = new Map<string, string>();
   112	  private lastAlert = new Map<string, number>();
   113	  private sleep: (ms: number) => Promise<void>;
   114	  lastGasGwei = 0;
   115	
   116	  constructor(private d: EngineDeps) {
   117	    this.sleep = d.sleep ?? realSleep;
   118	  }
   119	
   120	  private get cfg() {
   121	    return this.d.cfg;
   122	  }
   123	  private get live() {
   124	    return this.cfg.mode === 'live';
   125	  }
   126	  private get taker() {
   127	    return this.live ? this.d.chain.address : PAPER_TAKER;
   128	  }
   129	  private costs() {
   130	    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
   131	  }
   132	  private need(sizeUsd: number) {
   133	    return threshold(sizeUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
   134	  }
   135	
   136	  /** Log a status line only when it changes (avoids spamming every block). */
   137	  private note(key: string, msg: string) {
   138	    if (this.lastNote.get(key) !== msg) {
   139	      this.lastNote.set(key, msg);
   140	      log.info(msg);
   141	    }
   142	  }
   143	
   144	  async alertThrottled(key: string, text: string, everyMs = 6 * 3600_000) {
   145	    const last = this.lastAlert.get(key) ?? 0;
   146	    if (Date.now() - last < everyMs) return;
   147	    this.lastAlert.set(key, Date.now());
   148	    await this.d.tg.send(text);
   149	  }
   150	
   151	  /** One scan; executes at most one trade. */
   152	  async tick(): Promise<void> {
   153	    const block = this.d.risk.blockReason();
   154	    if (block) return this.note('block', `trading blocked: ${block}`);
   155	    this.note('block', 'trading enabled');
   156	
   157	    const gas = await this.d.chain.gas();
   158	    this.lastGasGwei = Number(gas.effective) / 1e9;
   159	    if (this.lastGasGwei > this.cfg.maxGasGwei) {
   160	      return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > MAX_GAS_GWEI ${this.cfg.maxGasGwei}, waiting`);
   161	    }
   162	    this.note('gas', 'gas ok');
   163	
   164	    const ethUsd = mid(await this.d.book('ETHUSDT'));
   165	    const bal = await this.d.balances();
   166	    const books = new Map<string, Book>();
   167	    const prices: Record<string, number> = {};
   168	    for (const t of this.d.tokens) {
   169	      try {
   170	        const b = await this.d.book(t.symbol);
   171	        if (b.bids.length && b.asks.length) {
   172	          books.set(t.symbol, b);
   173	          prices[t.base] = mid(b);
   174	        }
   175	      } catch (e) {
   176	        log.warn(`${t.symbol} book: ${errMsg(e)}`);
   177	      }
   178	    }
   179	
   180	    if (this.live) {
   181	      for (const w of inventoryWarnings(bal, this.d.tokens, prices, this.cfg.minTradeUsd, this.cfg.minEthForGas)) {
   182	        await this.alertThrottled(`inv-${w.key}`, `📦 Inventory: ${w.text}`);
   183	      }
   184	    }
   185	
   186	    let best: Candidate | null = null;
   187	    for (const t of this.d.tokens) {
   188	      const b = books.get(t.symbol);
   189	      if (!b) continue;
   190	      if (!t.depositOk || !t.withdrawOk) {
   191	        this.note(`susp-${t.base}`, `${t.base}: MEXC deposit/withdraw suspended, skipping`);
   192	        continue;
   193	      }
   194	      this.note(`susp-${t.base}`, `${t.base}: active`);
   195	      try {
   196	        for (const c of await this.candidates(t, b, bal, gas, ethUsd)) {
   197	          log.info(`${t.base} ${c.opp.direction} size ${usd(c.opp.sizeUsd)} net ${usd(c.opp.net)} (need ${usd(this.need(c.opp.sizeUsd))})`);
   198	          if (c.opp.net > this.need(c.opp.sizeUsd) && (!best || c.opp.net > best.opp.net)) best = c;
   199	        }
   200	      } catch (e) {
   201	        log.warn(`${t.base} quote: ${errMsg(e)}`);
   202	      }
   203	    }
   204	    if (best) await this.execute(best, gas, ethUsd);
   205	  }
   206	
   207	  /** Indicative opportunities in both directions for one token. */
   208	  async candidates(t: Token, b: Book, bal: Balances, gas: GasInfo, ethUsd: number): Promise<Candidate[]> {
   209	    const out: Candidate[] = [];
   210	    const bestBid = b.bids[0][0];
   211	    const tokenUsd = mid(b);
   212	    const cexTok = bal.mexc[t.base] ?? 0;
   213	    const walTok = bal.walletToken[t.base] ?? 0;
   214	    const slippageBps = this.cfg.dexSlippageBps;
   215	
   216	    // DEX_BUY: USDC -> token on DEX, token -> USDT on MEXC.
   217	    const sizeA = Math.floor(Math.min(this.cfg.maxTradeUsd, bal.walletUsdc * 0.99, cexTok * bestBid * 0.99) * 100) / 100;
   218	    if (sizeA >= this.cfg.minTradeUsd) {
   219	      const req = { sellToken: this.cfg.usdc, buyToken: t.address, sellAmount: toUnits(sizeA, USDC_DECIMALS), taker: this.taker, slippageBps };
   220	      const q = await this.d.agg.price(req);
   221	      const spender = this.spenderOf(q);
   222	      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   223	      const opp = evaluateDexBuy({
   224	        sizeUsd: sizeA,
   225	        tokensOut: toFloat(q.buyAmount, t.decimals),
   226	        tokensMin: toFloat(q.minBuyAmount, t.decimals),
   227	        bids: b.bids,
   228	        qtyStep: t.qtyStep,
   229	        gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
   230	        costs: this.costs(),
   231	      });
   232	      if (opp && opp.cexQty <= cexTok) out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
   233	    }
   234	
   235	    // CEX_BUY: USDT -> token on MEXC, token -> USDC on DEX.
   236	    const sizeB = Math.min(this.cfg.maxTradeUsd, (bal.mexc.USDT ?? 0) * 0.99, walTok * bestBid * 0.99);
   237	    if (sizeB >= this.cfg.minTradeUsd) {
   238	      const plan = planCexBuy({ sizeUsd: sizeB, asks: b.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
   239	      if (plan && plan.tokensToSell <= walTok) {
   240	        const req = { sellToken: t.address, buyToken: this.cfg.usdc, sellAmount: toUnits(plan.tokensToSell, t.decimals), taker: this.taker, slippageBps };
   241	        const q = await this.d.agg.price(req);
   242	        const spender = this.spenderOf(q);
   243	        const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   244	        const opp = evaluateCexBuy({
   245	          plan,
   246	          usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
   247	          usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
   248	          gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
   249	          costs: this.costs(),
   250	        });
   251	        out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
   252	      }
   253	    }
   254	    return out;
   255	  }
   256	
   257	  private spenderOf(q: Quote): string {
   258	    if (q.spender) return q.spender;
   259	    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
   260	    throw new Error('aggregator did not return a spender');
   261	  }
   262	
   263	  /** Re-check with a firm quote + simulation, then trade both legs at once. */
   264	  async execute(c: Candidate, gas: GasInfo, ethUsd: number): Promise<void> {
   265	    const { token: t } = c;
   266	    if (!this.live) return this.recordPaper(c);
   267	
   268	    let approvalCostWei = 0n;
   269	    const skip = async (why: string) => {
   270	      log.info(`${t.base} skip: ${why}`);
   271	      if (approvalCostWei > 0n) {
   272	        // The approval gas was really spent; book it so PnL and the loss limit stay honest.
   273	        const g = (Number(approvalCostWei) / 1e18) * ethUsd;
   274	        this.record(c, 'approval', { pnl: -g, gas: g, note: `approval, then skipped: ${why}` });
   275	      }
   276	    };
   277	
   278	    // 1) Exact approval (never unlimited).
   279	    if (c.approvalGas > 0n) {
   280	      const r = await this.d.chain.approveExact(c.req.sellToken, c.spender, c.req.sellAmount, gas);
   281	      approvalCostWei = r.gasCostWei;
   282	      if (!r.ok) {
   283	        await skip(`approval failed (${r.reason})`);
   284	        await this.d.tg.send(`⚠️ Approval failed for ${t.base}: ${r.reason} ${r.hash ?? ''}`);
   285	        return;
   286	      }
   287	    }
   288	
   289	    // 2) Firm quote + simulation (eth_call). Abort on any doubt.
   290	    let firm: Quote;
   291	    let gasEst: bigint;
   292	    try {
   293	      firm = await this.d.agg.quote(c.req);
   294	      if (!firm.tx) return skip('firm quote has no transaction');
   295	      gasEst = await this.d.chain.simulate(firm.tx);
   296	    } catch (e) {
   297	      return skip(`simulation/quote failed: ${errMsg(e)}`);
   298	    }
   299	    const tx = firm.tx;
   300	
   301	    // 3) Re-evaluate with a fresh REST book, firm amounts and simulated gas.
   302	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   303	    const g = gasUsd(gasEst, gas.effective, ethUsd);
   304	    let opp: Opportunity | null;
   305	    if (c.opp.direction === 'DEX_BUY') {
   306	      opp = evaluateDexBuy({
   307	        sizeUsd: c.opp.sizeUsd,
   308	        tokensOut: toFloat(firm.buyAmount, t.decimals),
   309	        tokensMin: toFloat(firm.minBuyAmount, t.decimals),
   310	        bids: b.bids,
   311	        qtyStep: t.qtyStep,
   312	        gasUsd: g,
   313	        costs: this.costs(),
   314	      });
   315	    } else {
   316	      // Same quantity as quoted on the DEX, priced against the fresh MEXC book.
   317	      const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.cfg.mexcTakerFee);
   318	      opp = plan
   319	        ? evaluateCexBuy({
   320	            plan,
   321	            usdcOut: toFloat(firm.buyAmount, USDC_DECIMALS),
   322	            usdcMin: toFloat(firm.minBuyAmount, USDC_DECIMALS),
   323	            gasUsd: g,
   324	            costs: this.costs(),
   325	          })
   326	        : null;
   327	    }
   328	    const need = this.need(c.opp.sizeUsd);
   329	    if (!opp || opp.net <= need) return skip(`profit fell to ${usd(opp?.net ?? 0)} after firm quote (need ${usd(need)})`);
   330	
   331	    // 4) Both legs are sent together. They do NOT complete together: the MEXC order fills in ~1.5s,
   332	    //    the DEX tx needs 12-60s to be mined. If the DEX side fails in between, step 5 unwinds on MEXC.
   333	    const before = await this.d.balances();
   334	    log.info(`${t.base} EXECUTE ${opp.direction} size ${usd(opp.sizeUsd)} expected ${usd(opp.net)}`);
   335	    const [cexR, dexR] = await Promise.allSettled([
   336	      this.cexLeg(t, opp),
   337	      this.d.chain.send(tx, (gasEst * 13n) / 10n, gas, this.cfg.txTimeoutSec),
   338	    ]);
   339	
   340	    const dex: TxResult = dexR.status === 'fulfilled' ? dexR.value : { ok: false, gasCostWei: 0n, reason: errMsg(dexR.reason) };
   341	    let cexFilled = 0;
   342	    let orderId: string | null = null;
   343	    let cexUnknown = false;
   344	    if (cexR.status === 'fulfilled') {
   345	      cexFilled = cexR.value.filled;
   346	      orderId = cexR.value.orderId;
   347	    } else if (String((cexR.reason as Error)?.message ?? '').startsWith('UNKNOWN_ORDER_STATE')) {
   348	      cexUnknown = true;
   349	      this.d.risk.pause('MEXC order state unknown');
   350	      await this.d.tg.send(`🚨 ${t.base}: MEXC order state unknown after placing. Trading PAUSED. Check MEXC manually.\n${errMsg(cexR.reason)}`);
   351	    } else {
   352	      log.warn(`${t.base} MEXC leg failed: ${errMsg(cexR.reason)}`);
   353	    }
   354	
   355	    // 5) One-sided? Close the open position at market right away.
   356	    let status: TradeStatus = 'ok';
   357	    const notes: string[] = [];
   358	    if (!dex.ok) notes.push(`DEX: ${dex.reason}`);
   359	    if (dex.unknown) {
   360	      // We cannot tell if the swap executed. Unwinding could DOUBLE the position. Stop and ask a human.
   361	      this.d.risk.pause(`DEX tx outcome unknown (${dex.hash})`);
   362	      await this.d.tg.send(
   363	        `🚨 ${t.base}: DEX tx ${dex.hash} outcome UNKNOWN (not mined, cancel not confirmed). MEXC filled ${cexFilled}/${opp.cexQty}.\n` +
   364	          `NOT unwinding automatically. Trading PAUSED. Check the wallet on etherscan, fix by hand, then /start.`,
   365	      );
   366	    }
   367	    const unwind = cexUnknown || dex.unknown ? null : unwindPlan(opp.direction, dex.ok, opp.cexQty, cexFilled, this.cfg.mexcTakerFee, t.qtyStep);
   368	    if (cexUnknown || dex.unknown) {
   369	      status = 'one_sided';
   370	    } else if (unwind) {
   371	      status = 'one_sided';
   372	      const qty = unwind.qty.toFixed(decimalsOfStep(t.qtyStep));
   373	      try {
   374	        const r = await this.closeAtMarket(t, unwind.side, qty);
   375	        notes.push(`unwind ${unwind.side} ${qty} @market (${r.orderId}, filled ${r.filled})`);
   376	        await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base} ${opp.direction}\n${unwind.reason}\nClosed: MEXC MARKET ${unwind.side} ${qty} ${t.base}`);
   377	      } catch (e) {
   378	        this.d.risk.pause(`unwind failed for ${t.base}`);
   379	        notes.push(`UNWIND FAILED: ${errMsg(e)}`);
   380	        await this.d.tg.send(
   381	          `🚨 ONE-SIDED FILL ${t.base} and the market close FAILED: ${errMsg(e)}\n` +
   382	            `Open position: MEXC ${unwind.side} ${qty} ${t.base} still needed.\nTrading PAUSED. Close it manually, then /start.`,
   383	        );
   384	      }
   385	    } else if (!dex.ok) {
   386	      status = 'dex_failed'; // nothing filled on either side
   387	    }
   388	
   389	    // 6) Exact PnL = change in total value of everything the trade touched, at pre-trade prices.
   390	    await this.sleep(2500); // let MEXC balances settle
   391	    const after = await this.d.balances();
   392	    const pnl = portfolioUsd(after, t, c.tokenUsd, ethUsd) - portfolioUsd(before, t, c.tokenUsd, ethUsd);
   393	    const gasPaid = (Number(dex.gasCostWei + approvalCostWei) / 1e18) * ethUsd;
   394	    this.record({ ...c, opp }, status, { pnl, gas: gasPaid, dexTx: dex.hash, orderId, note: notes.join('; ') || null });
   395	
   396	    const dexIsBuy = opp.direction === 'DEX_BUY';
   397	    await this.d.tg.send(
   398	      [
   399	        `${status === 'ok' ? '✅' : '⚠️'} LIVE ${t.base} ${opp.direction} [${status}]`,
   400	        `Buy  ${dexIsBuy ? 'DEX ' : 'MEXC'} @ ${opp.buyPrice.toPrecision(6)}`,
   401	        `Sell ${dexIsBuy ? 'MEXC' : 'DEX '} @ ${opp.sellPrice.toPrecision(6)}`,
   402	        `Qty ${opp.cexQty} ${t.base} | size ${usd(opp.sizeUsd)}`,
   403	        `MEXC fee ${usd(opp.cexFeeUsd)} | Gas ${usd(gasPaid)}`,
   404	        `Expected ${usd(opp.net)} | Net PnL ${usd(pnl)}`,
   405	        dex.hash ? `https://etherscan.io/tx/${dex.hash}` : '',
   406	        notes.length ? `Notes: ${notes.join('; ')}` : '',
   407	      ]
   408	        .filter(Boolean)
   409	        .join('\n'),
   410	    );
   411	    await this.handleRisk(this.d.risk.afterTrade(status));
   412	  }
   413	
   414	  /**
   415	   * Close a position on MEXC now. SELL uses a MARKET order. BUY uses a LIMIT 2% above the best ask
   416	   * (MEXC documents MARKET buys by quote amount only, and we need an exact token quantity).
   417	   */
   418	  async closeAtMarket(t: Token, side: Side, qty: string): Promise<{ orderId: string; filled: number }> {
   419	    if (side === 'SELL') {
   420	      const cid = clientId('c');
   421	      const { orderId } = await placeSafely(this.d.mexc, t.symbol, cid, () => this.d.mexc.marketSell(t.symbol, qty, cid), this.sleep);
   422	      await this.sleep(1000);
   423	      const o = await this.d.mexc.getOrder(t.symbol, orderId);
   424	      if (Number(o.executedQty) < Number(qty) * 0.999) throw new Error(`close SELL only filled ${o.executedQty}/${qty}`);
   425	      return { orderId, filled: Number(o.executedQty) };
   426	    }
   427	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   428	    const f = 10 ** t.priceDecimals;
   429	    const px = (Math.ceil(b.asks[0][0] * 1.02 * f) / f).toFixed(t.priceDecimals);
   430	    const cid = clientId('c');
   431	    const { orderId } = await placeSafely(this.d.mexc, t.symbol, cid, () => this.d.mexc.limitOrder(t.symbol, 'BUY', qty, px, cid), this.sleep);
   432	    await this.sleep(1500);
   433	    let o = await this.d.mexc.getOrder(t.symbol, orderId);
   434	    if (o.status !== 'FILLED') {
   435	      await this.d.mexc.cancelOrder(t.symbol, orderId).catch(() => {});
   436	      o = await this.d.mexc.getOrder(t.symbol, orderId);
   437	      if (Number(o.executedQty) < Number(qty) * 0.999) throw new Error(`close BUY only filled ${o.executedQty}/${qty}`);
   438	    }
   439	    return { orderId, filled: Number(o.executedQty) };
   440	  }
   441	
   442	  /** MEXC marketable limit order; cancels any unfilled rest. Returns filled quantity. */
   443	  async cexLeg(t: Token, opp: Opportunity): Promise<{ orderId: string; filled: number }> {
   444	    const side: Side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
   445	    const qty = opp.cexQty.toFixed(decimalsOfStep(t.qtyStep));
   446	    const f = 10 ** t.priceDecimals;
   447	    const px = side === 'SELL' ? Math.floor(opp.cexLimitPrice * f) / f : Math.ceil(opp.cexLimitPrice * f) / f;
   448	    const cid = clientId('t');
   449	    const { orderId } = await placeSafely(
   450	      this.d.mexc,
   451	      t.symbol,
   452	      cid,
   453	      () => this.d.mexc.limitOrder(t.symbol, side, qty, px.toFixed(t.priceDecimals), cid),
   454	      this.sleep,
   455	    );
   456	    log.info(`MEXC ${side} ${qty} ${t.symbol} @ ${px} id=${orderId}`);
   457	    await this.sleep(1500);
   458	
   459	    const read = async (): Promise<Order> => {
   460	      for (let i = 0; i < 3; i++) {
   461	        try {
   462	          return await this.d.mexc.getOrder(t.symbol, orderId);
   463	        } catch (e) {
   464	          log.warn(`getOrder retry: ${errMsg(e)}`);
   465	          await this.sleep(1000);
   466	        }
   467	      }
   468	      throw new Error(`UNKNOWN_ORDER_STATE ${orderId}`);
   469	    };
   470	    let o = await read();
   471	    if (o.status !== 'FILLED') {
   472	      await this.d.mexc.cancelOrder(t.symbol, orderId).catch((e) => log.warn(`cancel: ${errMsg(e)}`));
   473	      await this.sleep(500);
   474	      o = await read();
   475	    }
   476	    return { orderId, filled: Number(o.executedQty) };
   477	  }
   478	
   479	  private async recordPaper(c: Candidate) {
   480	    const { token: t, opp } = c;
   481	    this.record(c, 'paper', { pnl: opp.net, gas: opp.gasUsd });
   482	    await this.d.tg.send(
   483	      `📝 PAPER ${t.base} ${opp.direction}\nBuy @ ${opp.buyPrice.toPrecision(6)} | Sell @ ${opp.sellPrice.toPrecision(6)}\n` +
   484	        `Qty ${opp.cexQty} | size ${usd(opp.sizeUsd)} | fee ${usd(opp.cexFeeUsd)} | gas ${usd(opp.gasUsd)}\nNet ${usd(opp.net)}`,
   485	    );
   486	    await this.handleRisk(this.d.risk.afterTrade('paper'));
   487	  }
   488	
   489	  private record(
   490	    c: Candidate,
   491	    status: TradeStatus,
   492	    r: { pnl: number; gas: number; dexTx?: string; orderId?: string | null; note?: string | null },
   493	  ) {
   494	    const now = Date.now();
   495	    this.d.db.insertTrade({
   496	      ts: now,
   497	      day: dhakaDay(now),
   498	      mode: this.cfg.mode,
   499	      symbol: c.token.base,
   500	      direction: c.opp.direction,
   501	      size_usd: c.opp.sizeUsd,
   502	      qty: c.opp.cexQty,
   503	      buy_price: c.opp.buyPrice,
   504	      sell_price: c.opp.sellPrice,
   505	      expected_net: c.opp.net,
   506	      cex_fee_usd: status === 'approval' ? 0 : c.opp.cexFeeUsd,
   507	      gas_usd: r.gas,
   508	      pnl_usd: r.pnl,
   509	      status,
   510	      dex_tx: r.dexTx ?? null,
   511	      cex_order_id: r.orderId ?? null,
   512	      note: r.note ?? null,
   513	    });
   514	  }
   515	
   516	  private async handleRisk(events: RiskEvent[]) {
   517	    for (const e of events) {
   518	      if (e.kind === 'loss_limit') await this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). Trading STOPPED. Send /start to resume.`);
   519	      if (e.kind === 'fail_streak') await this.d.tg.send(`🛑 ${e.count} failed trades in a row. Trading PAUSED. Check logs, then /start.`);
   520	      if (e.kind === 'trade_limit') await this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}). Resumes tomorrow (Dhaka time).`);
   521	    }
   522	  }
   523	}
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
    14	export async function snapshot(chain: Chain, mexc: MexcRest, usdc: string, tokens: Token[]): Promise<Balances> {
    15	  const [eth, usdcBal, mexcBal, ...toks] = await Promise.all([
    16	    chain.ethBalance(),
    17	    chain.tokenBalance(usdc),
    18	    mexc.balances(),
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
    17	import { dhakaDay, dhakaHourMinute, usd } from './util.js';
    18	
    19	const cfg = validateConfig(loadConfig());
    20	registerSecrets(secretsOf(cfg));
    21	
    22	/** Backoff after HTTP 429/418 from any API: skip scans for 1, 2, 4 ... up to 15 minutes. */
    23	const rateLimit = { until: 0, level: 0 };
    24	function onScanError(e: unknown): boolean {
    25	  if (e instanceof RateLimitError || /\b(429|418)\b/.test(errMsg(e))) {
    26	    const wait = Math.min(15 * 60_000, 60_000 * 2 ** rateLimit.level++);
    27	    rateLimit.until = Date.now() + wait;
    28	    log.warn(`rate limited, pausing scans for ${wait / 60_000} min`);
    29	    return true;
    30	  }
    31	  return false;
    32	}
    33	function rateLimited(): boolean {
    34	  if (Date.now() < rateLimit.until) return true;
    35	  return false;
    36	}
    37	function rateLimitOk() {
    38	  rateLimit.level = 0;
    39	}
    40	
    41	/** Crash handlers: exit (pm2 restarts) only on real crashes; a stray rejected promise is logged and alerted. */
    42	function installProcessHandlers(tg: Telegram, cleanup: () => void) {
    43	  const shutdown = async (why: string, code: number) => {
    44	    await tg.send(`🔌 Bot stopped: ${why}`);
    45	    cleanup();
    46	    tg.stop();
    47	    process.exit(code);
    48	  };
    49	  let lastRejectAlert = 0;
    50	  process.on('SIGINT', () => void shutdown('SIGINT', 0));
    51	  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
    52	  process.on('unhandledRejection', (e) => {
    53	    log.error(`unhandled rejection: ${errMsg(e)}`);
    54	    if (Date.now() - lastRejectAlert > 3600_000) {
    55	      lastRejectAlert = Date.now();
    56	      void tg.send(`❗ Unhandled error (bot keeps running): ${errMsg(e)}`);
    57	    }
    58	  });
    59	  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
    60	}
    61	
    62	/** Refuse to trade live if .env is readable by other users. */
    63	function checkEnvPermissions(path: string) {
    64	  if (!fs.existsSync(path)) return log.warn(`${path} not found; make sure secrets come from a protected place`);
    65	  const mode = fs.statSync(path).mode & 0o777;
    66	  if (mode & 0o077) throw new Error(`${path} has permissions ${mode.toString(8)}; run: chmod 600 ${path}`);
    67	}
    68	
    69	async function main() {
    70	  if (cfg.mode === 'live') checkEnvPermissions(cfg.envPath);
    71	
    72	  const db = new Db(cfg.dbPath);
    73	  const risk = new Risk(db, cfg.mode, cfg);
    74	  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId);
    75	  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
    76	  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
    77	  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei);
    78	  const agg: Aggregator = cfg.aggregator === '0x' ? new ZeroEx(cfg.zeroExApiKey) : new OneInch(cfg.oneInchApiKey);
    79	
    80	  // --- Pre-flight checks: fail at startup, not in the middle of the first trade ---
    81	  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
    82	  if (chainId !== 1n) throw new Error(`RPC_URL is chain ${chainId}, expected Ethereum mainnet (1)`);
    83	  if (!cfg.mexcApiKey || !cfg.mexcApiSecret) {
    84	    // Coin/network info (contract addresses, deposit/withdraw status) is a signed MEXC endpoint.
    85	    throw new Error('MEXC_API_KEY/SECRET are required even in paper mode (a read-only key is enough for paper)');
    86	  }
    87	  const skew = await mexc.syncTime();
    88	  if (Math.abs(skew) > 1000) log.warn(`VPS clock is ${skew} ms off MEXC time; corrected, but enable NTP (timedatectl set-ntp true)`);
    89	  // Aggregator key and route smoke test: quote 100 USDC -> WETH.
    90	  await agg.price({
    91	    sellToken: cfg.usdc,
    92	    buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    93	    sellAmount: 100_000_000n,
    94	    taker: chain.wallet?.address ?? '0x000000000000000000000000000000000000dEaD',
    95	    slippageBps: cfg.dexSlippageBps,
    96	  });
    97	  if (cfg.mode === 'live') {
    98	    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
    99	    const acc = await mexc.account();
   100	    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
   101	    const eth = Number(await chain.ethBalance()) / 1e18;
   102	    if (eth < cfg.minEthForGas) throw new Error(`Hot wallet has ${eth} ETH, need at least MIN_ETH_FOR_GAS=${cfg.minEthForGas}`);
   103	    const usdt = Number(acc.balances.find((b) => b.asset === 'USDT')?.free ?? 0);
   104	    log.info(`wallet ${chain.address}: ${eth.toFixed(4)} ETH | MEXC USDT ${usdt.toFixed(2)}`);
   105	    if (usdt < cfg.minTradeUsd) log.warn(`MEXC USDT ${usdt} < MIN_TRADE_USD: MEXC buys are blocked until you deposit`);
   106	    if (cfg.strategy === 'transfer') {
   107	      await tg.send(
   108	        `🔐 Reminder: STRATEGY=transfer uses MEXC withdrawals. Make sure the API key is IP-bound to this VPS and the MEXC ` +
   109	          `withdrawal address whitelist contains ONLY ${chain.address}.`,
   110	      );
   111	    }
   112	  }
   113	
   114	  if (cfg.strategy === 'transfer') return runTransfer(db, risk, tg, mexc, chain, agg);
   115	
   116	  const tokens = await buildWatchlist(mexc, (a) => chain.decimals(a), {
   117	    only: cfg.watchlist,
   118	    max: cfg.watchlistMax,
   119	    minTvlUsd: cfg.minDexTvlUsd,
   120	    minVolumeUsd: cfg.minMexcVolumeUsd,
   121	  });
   122	  if (tokens.length === 0) throw new Error('Watchlist is empty: no token passed the filters');
   123	  log.info(`watchlist: ${tokens.map((t) => `${t.base}(${t.address.slice(0, 8)}…, tvl $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`);
   124	
   125	  const stream = new MexcBookStream(['ETHUSDT', ...tokens.map((t) => t.symbol)]);
   126	  stream.start();
   127	  const book = async (symbol: string) => stream.get(symbol) ?? mexc.depth(symbol, 20);
   128	  const balances = cfg.mode === 'live' ? () => snapshot(chain, mexc, cfg.usdc, tokens) : async () => paperBalances(tokens);
   129	
   130	  const freshBook = (symbol: string) => mexc.depth(symbol, 20);
   131	  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, freshBook, balances, tokens });
   132	
   133	  // --- Telegram commands ---
   134	  const statusText = async () => {
   135	    const t = risk.today();
   136	    const lines = [
   137	      `MODE=${cfg.mode} | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   138	      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   139	      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, max gas ${cfg.maxGasGwei} gwei (now ${engine.lastGasGwei.toFixed(1)})`,
   140	      `Fail streak: ${risk.consecutiveFails}/${cfg.maxConsecutiveFails}`,
   141	    ];
   142	    if (cfg.mode === 'live') {
   143	      try {
   144	        const b = await balances();
   145	        lines.push(`Wallet: ${b.walletEth.toFixed(4)} ETH, ${usd(b.walletUsdc)} USDC | MEXC: ${usd(b.mexc.USDT ?? 0)} USDT`);
   146	        for (const tk of tokens) {
   147	          lines.push(`  ${tk.base}: wallet ${(b.walletToken[tk.base] ?? 0).toFixed(4)} | MEXC ${(b.mexc[tk.base] ?? 0).toFixed(4)}${tk.depositOk && tk.withdrawOk ? '' : ' (suspended)'}`);
   148	        }
   149	      } catch (e) {
   150	        lines.push(`Inventory error: ${errMsg(e)}`);
   151	      }
   152	    }
   153	    return lines.join('\n');
   154	  };
   155	  void tg.startPolling({
   156	    '/stop': () => {
   157	      risk.pause('Telegram /stop');
   158	      return '🛑 Trading STOPPED. Send /start to resume.';
   159	    },
   160	    '/start': () => {
   161	      risk.resume();
   162	      const block = risk.blockReason();
   163	      return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
   164	    },
   165	    '/status': statusText,
   166	  });
   167	
   168	  // --- Main loop: one scan per block ---
   169	  let busy = false;
   170	  let errors = 0;
   171	  chain.provider.on('block', async () => {
   172	    if (busy || rateLimited()) return;
   173	    busy = true;
   174	    try {
   175	      await engine.tick();
   176	      errors = 0;
   177	      rateLimitOk();
   178	    } catch (e) {
   179	      if (onScanError(e)) return;
   180	      errors++;
   181	      log.error(`tick: ${errMsg(e)}`);
   182	      if (errors >= 5) await engine.alertThrottled('tick-errors', `❗ Bot errors (${errors} in a row): ${errMsg(e)}`, 3600_000);
   183	    } finally {
   184	      busy = false;
   185	    }
   186	  });
   187	
   188	  // MEXC deposit/withdraw status every 10 minutes.
   189	  setInterval(async () => {
   190	    try {
   191	      const changed = await refreshStatus(mexc, tokens);
   192	      if (changed.length) await tg.send(`ℹ️ MEXC network status changed:\n${changed.join('\n')}`);
   193	    } catch (e) {
   194	      log.warn(`status refresh: ${errMsg(e)}`);
   195	    }
   196	  }, 10 * 60_000);
   197	
   198	  // Daily summary at 23:00 Bangladesh time.
   199	  setInterval(async () => {
   200	    const { hour } = dhakaHourMinute();
   201	    const today = dhakaDay();
   202	    if (hour === 23 && db.getState('last_summary_day') !== today) {
   203	      db.setState('last_summary_day', today);
   204	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   205	    }
   206	  }, 30_000);
   207	
   208	  installProcessHandlers(tg, () => stream.stop());
   209	
   210	  await tg.send(
   211	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} via ${agg.name}\nTokens: ${tokens.map((t) => t.base).join(', ')}\n` +
   212	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   213	  );
   214	}
   215	
   216	/** TRANSFER strategy: scan every MEXC ERC20 token, buy on MEXC, withdraw, sell on DEX. */
   217	async function runTransfer(db: Db, risk: Risk, tg: Telegram, mexc: MexcRest, chain: Chain, agg: Aggregator) {
   218	  const engine = new TransferEngine({ cfg, mexc, chain, agg, db, risk, tg });
   219	  await engine.refreshUniverse(true);
   220	  if (engine.universe.length === 0) throw new Error('No MEXC ERC20 token passed the filters');
   221	
   222	  void tg.startPolling({
   223	    '/stop': () => {
   224	      risk.pause('Telegram /stop');
   225	      return '🛑 New trades STOPPED. An open transfer still finishes (selling the tokens already bought is the safe exit). /start to resume.';
   226	    },
   227	    '/start': () => {
   228	      risk.resume();
   229	      const block = risk.blockReason();
   230	      return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
   231	    },
   232	    '/status': async () => {
   233	      const t = risk.today();
   234	      const open = db.openTransfers();
   235	      const lines = [
   236	        `MODE=${cfg.mode} STRATEGY=transfer | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   237	        `Scanning ${engine.universe.length} MEXC ERC20 tokens every ${cfg.scanIntervalSec}s`,
   238	        `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   239	        `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, gas ${engine.lastGasGwei.toFixed(1)}/${cfg.maxGasGwei} gwei`,
   240	        `Top gaps: ${engine.lastTopGaps.map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ') || 'none'}`,
   241	        open.length ? `Open: ${open.map((o) => `#${o.id} ${o.base} ${o.status}`).join(', ')}` : 'Open transfers: none',
   242	      ];
   243	      const stuck = db.stuckTransfers();
   244	      if (stuck.length) lines.push(`🚨 Needs you: ${stuck.map((o) => `#${o.id} ${o.base} (${o.note ?? 'stuck'})`).join('; ')} -> /sell <id> or /clear <id>`);
   245	      if (cfg.mode === 'live') {
   246	        try {
   247	          const b = await mexc.balances();
   248	          const eth = await chain.ethBalance();
   249	          const usdc = await chain.tokenBalance(cfg.usdc);
   250	          lines.push(`MEXC ${usd(b.USDT ?? 0)} USDT | wallet ${(Number(eth) / 1e18).toFixed(4)} ETH, ${usd(Number(usdc) / 1e6)} USDC`);
   251	        } catch (e) {
   252	          lines.push(`Balance error: ${errMsg(e)}`);
   253	        }
   254	      }
   255	      return lines.join('\n');
   256	    },
   257	    '/sell': ([id]) => (id ? engine.forceSell(Number(id)) : 'Usage: /sell <transfer id>'),
   258	    '/clear': ([id]) => (id ? engine.clear(Number(id)) : 'Usage: /clear <transfer id>'),
   259	  });
   260	
   261	  let busy = false;
   262	  let errors = 0;
   263	  let lastLow = 0;
   264	  const loop = async () => {
   265	    if (busy || rateLimited()) return;
   266	    busy = true;
   267	    try {
   268	      await engine.tick();
   269	      errors = 0;
   270	      rateLimitOk();
   271	      // MEXC USDT is spent by buys and comes back only when you move USDC from the wallet to MEXC.
   272	      if (cfg.mode === 'live' && Date.now() - lastLow > 6 * 3600_000) {
   273	        const usdt = (await mexc.balances()).USDT ?? 0;
   274	        const eth = Number(await chain.ethBalance()) / 1e18;
   275	        if (usdt < cfg.minTradeUsd || eth < cfg.minEthForGas) {
   276	          lastLow = Date.now();
   277	          await tg.send(`📦 Rebalance needed: MEXC USDT ${usd(usdt)}, wallet ETH ${eth.toFixed(4)}. Move USDC profits from the wallet back to MEXC.`);
   278	        }
   279	      }
   280	    } catch (e) {
   281	      if (onScanError(e)) return;
   282	      errors++;
   283	      log.error(`scan: ${errMsg(e)}`);
   284	      if (errors === 5) await tg.send(`❗ Bot errors (5 in a row): ${errMsg(e)}`);
   285	    } finally {
   286	      busy = false;
   287	    }
   288	  };
   289	  setInterval(loop, cfg.scanIntervalSec * 1000);
   290	  void loop();
   291	
   292	  setInterval(async () => {
   293	    const today = dhakaDay();
   294	    if (dhakaHourMinute().hour === 23 && db.getState('last_summary_day') !== today) {
   295	      db.setState('last_summary_day', today);
   296	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   297	    }
   298	  }, 30_000);
   299	
   300	  installProcessHandlers(tg, () => {});
   301	
   302	  const open = db.openTransfers();
   303	  await tg.send(
   304	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} STRATEGY=transfer via ${agg.name}\n` +
   305	      `Scanning ${engine.universe.length} MEXC ERC20 tokens (buy MEXC -> withdraw -> sell DEX)\n` +
   306	      (open.length ? `Resuming ${open.length} open transfer(s)\n` : '') +
   307	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   308	  );
   309	}
   310	
   311	main().catch(async (e) => {
   312	  log.error(`startup failed: ${errMsg(e)}`);
   313	  await new Telegram(cfg.telegramToken, cfg.telegramChatId).send(`❗ Bot failed to start: ${errMsg(e)}`);
   314	  process.exit(1);
   315	});
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
    78	  const qty = floorToStep(p.tokensOut, p.qtyStep);
    79	  if (qty <= 0) return null;
    80	  const fill = fillBase(p.bids, qty);
    81	  if (!fill) return null;
    82	  const sellPrice = fill.quote / qty;
    83	  const cexFeeUsd = fill.quote * p.costs.takerFee;
    84	  const cexSlip = (fill.quote * p.costs.cexSlippageBps) / 10_000;
    85	  const dexSlip = Math.max(0, p.tokensOut - p.tokensMin) * sellPrice;
    86	  const slippageUsd = cexSlip + dexSlip;
    87	  // Leftover dust (tokensOut - qty) stays in inventory; it is not counted as profit.
    88	  const dustUsd = (p.tokensOut - qty) * sellPrice;
    89	  const net = fill.quote - cexFeeUsd - (p.sizeUsd - dustUsd) - p.gasUsd - slippageUsd - p.costs.safetyMarginUsd;
    90	  return {
    91	    direction: 'DEX_BUY',
    92	    sizeUsd: p.sizeUsd,
    93	    cexQty: qty,
    94	    cexLimitPrice: fill.worst * (1 - p.costs.cexSlippageBps / 10_000),
    95	    dexTokens: p.tokensOut,
    96	    buyPrice: p.sizeUsd / p.tokensOut,
    97	    sellPrice,
    98	    cexFeeUsd,
    99	    gasUsd: p.gasUsd,
   100	    slippageUsd,
   101	    net,
   102	  };
   103	}
   104	
   105	/**
   106	 * CEX_BUY step 1: how many tokens `sizeUsd` USDT buys on MEXC asks.
   107	 * MEXC charges the buy fee in the token, so we only sell qty * (1 - fee) on the DEX.
   108	 */
   109	export function planCexBuy(p: { sizeUsd: number; asks: Level[]; qtyStep: number; takerFee: number }) {
   110	  const f = fillQuote(p.asks, p.sizeUsd);
   111	  if (!f) return null;
   112	  const qty = floorToStep(f.qty, p.qtyStep);
   113	  if (qty <= 0) return null;
   114	  const fill = fillBase(p.asks, qty);
   115	  if (!fill) return null;
   116	  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - p.takerFee) };
   117	}
   118	
   119	/** CEX_BUY plan for an exact quantity (used when re-checking a trade with a fresh book). */
   120	export function planCexBuyQty(asks: Level[], qty: number, takerFee: number) {
   121	  const fill = fillBase(asks, qty);
   122	  if (!fill) return null;
   123	  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - takerFee) };
   124	}
   125	
   126	/** CEX_BUY step 2: given the DEX quote for selling those tokens, compute net. */
   127	export function evaluateCexBuy(p: {
   128	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
   129	  usdcOut: number;
   130	  usdcMin: number;
   131	  gasUsd: number;
   132	  costs: CostParams;
   133	}): Opportunity {
   134	  const { plan } = p;
   135	  const buyPrice = plan.costUsd / plan.qty;
   136	  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
   137	  const cexSlip = (plan.costUsd * p.costs.cexSlippageBps) / 10_000;
   138	  const dexSlip = Math.max(0, p.usdcOut - p.usdcMin);
   139	  const slippageUsd = cexSlip + dexSlip;
   140	  // cost already includes the token fee implicitly: we paid for qty but only sell qty*(1-fee).
   141	  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - p.costs.safetyMarginUsd;
   142	  return {
   143	    direction: 'CEX_BUY',
   144	    sizeUsd: plan.costUsd,
   145	    cexQty: plan.qty,
   146	    cexLimitPrice: plan.worst * (1 + p.costs.cexSlippageBps / 10_000),
   147	    dexTokens: plan.tokensToSell,
   148	    buyPrice,
   149	    sellPrice: p.usdcOut / plan.tokensToSell,
   150	    cexFeeUsd,
   151	    gasUsd: p.gasUsd,
   152	    slippageUsd,
   153	    net,
   154	  };
   155	}
   156	
   157	/** Gas cost in USD for `gasUnits` at `weiPerGas`. */
   158	export function gasUsd(gasUnits: bigint, weiPerGas: bigint, ethUsd: number): number {
   159	  return (Number(gasUnits * weiPerGas) / 1e18) * ethUsd;
   160	}
   161	
   162	/**
   163	 * What to do after both legs ran. Returns the MEXC market order needed to get flat again (or null).
   164	 * cexFilled is the MEXC executed quantity.
   165	 */
   166	export function unwindPlan(
   167	  direction: Direction,
   168	  dexOk: boolean,
   169	  cexQty: number,
   170	  cexFilled: number,
   171	  takerFee: number,
   172	  qtyStep: number,
   173	): { side: 'BUY' | 'SELL'; qty: number; reason: string } | null {
   174	  const mk = (side: 'BUY' | 'SELL', q: number, reason: string) => {
   175	    const qty = floorToStep(q, qtyStep);
   176	    return qty > 0 ? { side, qty, reason } : null;
   177	  };
   178	  if (direction === 'DEX_BUY') {
   179	    // Wanted: +tokens in wallet (DEX), -tokens on MEXC (sell).
   180	    if (!dexOk) return mk('BUY', cexFilled, 'DEX leg failed: buy back what was sold on MEXC');
   181	    return mk('SELL', cexQty - cexFilled, 'MEXC sell only partly filled: sell the rest at market');
   182	  }
   183	  // CEX_BUY wanted: +tokens on MEXC (buy), -tokens in wallet (DEX sell).
   184	  if (!dexOk) return mk('SELL', cexFilled * (1 - takerFee), 'DEX leg failed: sell what was bought on MEXC');
   185	  return mk('BUY', cexQty - cexFilled, 'MEXC buy only partly filled: buy the rest at market');
   186	}
   187	
   188	/**
   189	 * TRANSFER: buy on MEXC -> withdraw to wallet -> sell on DEX. Not atomic: the price can move
   190	 * while the withdrawal is on its way, so `driftBps` of the sale value is reserved as extra risk cost.
   191	 */
   192	export function evaluateTransfer(p: {
   193	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
   194	  withdrawFeeTokens: number; // MEXC withdraw fee, paid in the token
   195	  usdcOut: number; // DEX quote for selling the tokens that arrive
   196	  usdcMin: number;
   197	  gasUsd: number; // approval + swap
   198	  driftBps: number;
   199	  costs: CostParams;
   200	}) {
   201	  const { plan } = p;
   202	  const arriving = plan.tokensToSell - p.withdrawFeeTokens;
   203	  const buyPrice = plan.costUsd / plan.qty;
   204	  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
   205	  const withdrawFeeUsd = p.withdrawFeeTokens * buyPrice;
   206	  const slippageUsd = (plan.costUsd * p.costs.cexSlippageBps) / 10_000 + Math.max(0, p.usdcOut - p.usdcMin);
   207	  const driftUsd = (p.usdcOut * p.driftBps) / 10_000;
   208	  const net = p.usdcOut - plan.costUsd - p.gasUsd - slippageUsd - driftUsd - p.costs.safetyMarginUsd;
   209	  return {
   210	    arriving,
   211	    buyPrice,
   212	    sellPrice: arriving > 0 ? p.usdcOut / arriving : 0,
   213	    cexFeeUsd,
   214	    withdrawFeeUsd,
   215	    slippageUsd,
   216	    driftUsd,
   217	    gasUsd: p.gasUsd,
   218	    costUsd: plan.costUsd,
   219	    net,
   220	  };
   221	}
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
    30	  pause(reason: string): void {
    31	    this.db.setState('paused', '1');
    32	    this.db.setState('pause_reason', reason);
    33	  }
    34	
    35	  resume(): void {
    36	    this.db.setState('paused', '0');
    37	    this.db.setState('pause_reason', '');
    38	    this.db.setState('consecutive_fails', '0');
    39	  }
    40	
    41	  today() {
    42	    return this.db.dayStats(dhakaDay(this.now()), this.mode);
    43	  }
    44	
    45	  /** null = allowed, otherwise the reason trading is blocked right now. */
    46	  blockReason(): string | null {
    47	    if (this.paused) return `paused: ${this.pauseReason}`;
    48	    const t = this.today();
    49	    if (t.trades >= this.limits.maxTradesPerDay) return `daily trade limit reached (${t.trades})`;
    50	    if (t.pnl <= -this.limits.dailyLossLimitUsd) return `daily loss limit reached (${t.pnl.toFixed(2)})`;
    51	    return null;
    52	  }
    53	
    54	  /** Update streaks after a trade; returns events that need an alert. */
    55	  afterTrade(status: TradeStatus): RiskEvent[] {
    56	    const events: RiskEvent[] = [];
    57	    if (status === 'ok' || status === 'paper') {
    58	      this.db.setState('consecutive_fails', '0');
    59	    } else {
    60	      const n = this.consecutiveFails + 1;
    61	      this.db.setState('consecutive_fails', String(n));
    62	      if (n >= this.limits.maxConsecutiveFails) {
    63	        this.pause(`${n} failed trades in a row`);
    64	        events.push({ kind: 'fail_streak', count: n });
    65	      }
    66	    }
    67	    const t = this.today();
    68	    if (t.pnl <= -this.limits.dailyLossLimitUsd) {
    69	      this.pause(`daily loss limit hit (${t.pnl.toFixed(2)} USD)`);
    70	      events.push({ kind: 'loss_limit', pnl: t.pnl });
    71	    }
    72	    if (t.trades >= this.limits.maxTradesPerDay) events.push({ kind: 'trade_limit', trades: t.trades });
    73	    return events;
    74	  }
    75	}
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
     8	import { ethNetwork } from './watchlist.js';
     9	
    10	export interface ScanToken {
    11	  base: string;
    12	  symbol: string;
    13	  address: string; // lowercase, from MEXC's own deposit info -> same token as on-chain
    14	  netWork: string; // MEXC network id for withdrawals
    15	  withdrawFee: number; // tokens
    16	  withdrawMin: number;
    17	  qtyStep: number;
    18	  priceDecimals: number;
    19	  volumeUsd: number;
    20	}
    21	
    22	export interface Gap {
    23	  token: ScanToken;
    24	  ask: number; // MEXC best ask
    25	  dexPrice: number; // DexScreener price of the deepest Ethereum pool
    26	  tvlUsd: number;
    27	  gapPct: number; // (dexPrice / ask - 1) * 100, positive = MEXC cheaper
    28	}
    29	
    30	const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH']);
    31	
    32	/** All tradable MEXC/USDT ERC20 tokens with deposits AND withdrawals open and enough volume. */
    33	export async function loadUniverse(
    34	  mexc: Pick<MexcRest, 'exchangeInfo' | 'tickers24h' | 'coinConfigs'>,
    35	  opts: { minVolumeUsd: number; only: string[] },
    36	): Promise<ScanToken[]> {
    37	  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
    38	  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
    39	  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
    40	  const out: ScanToken[] = [];
    41	  for (const s of symbols) {
    42	    const base = s.baseAsset.toUpperCase();
    43	    if (s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed || String(s.status) !== '1' || SKIP.has(base)) continue;
    44	    if (opts.only.length && !opts.only.includes(base)) continue;
    45	    const vol = volume.get(s.symbol) ?? 0;
    46	    if (vol < opts.minVolumeUsd) continue;
    47	    const coin = coinBy.get(base);
    48	    const net = coin && ethNetwork(coin);
    49	    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue;
    50	    if (!net.depositEnable || !net.withdrawEnable) continue; // suspended -> skip
    51	    out.push({
    52	      base,
    53	      symbol: s.symbol,
    54	      address: net.contract.toLowerCase(),
    55	      netWork: net.netWork ?? net.network,
    56	      withdrawFee: Number(net.withdrawFee ?? 0),
    57	      withdrawMin: Number(net.withdrawMin ?? 0),
    58	      qtyStep: Number(s.baseSizePrecision) || 10 ** -(s.baseAssetPrecision ?? 2),
    59	      priceDecimals: s.quotePrecision,
    60	      volumeUsd: vol,
    61	    });
    62	  }
    63	  return out;
    64	}
    65	
    66	type FetchFn = typeof fetch;
    67	
    68	/** DexScreener prices for many tokens (30 per request). Uses each token's deepest Ethereum pool. */
    69	export async function dexPrices(addresses: string[], fetchFn: FetchFn = fetch): Promise<Map<string, { price: number; tvl: number }>> {
    70	  const out = new Map<string, { price: number; tvl: number }>();
    71	  for (let i = 0; i < addresses.length; i += 30) {
    72	    const chunk = addresses.slice(i, i + 30);
    73	    const res = await fetchFn(`https://api.dexscreener.com/tokens/v1/ethereum/${chunk.join(',')}`, { signal: AbortSignal.timeout(10_000) });
    74	    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    75	    const pairs = (await res.json()) as { chainId: string; priceUsd?: string; liquidity?: { usd?: number }; baseToken: { address: string } }[];
    76	    for (const p of pairs) {
    77	      if (p.chainId !== 'ethereum' || !p.priceUsd) continue;
    78	      const addr = p.baseToken.address.toLowerCase(); // priceUsd is the price of baseToken
    79	      const tvl = p.liquidity?.usd ?? 0;
    80	      if (!out.has(addr) || tvl > out.get(addr)!.tvl) out.set(addr, { price: Number(p.priceUsd), tvl });
    81	    }
    82	  }
    83	  return out;
    84	}
    85	
    86	/** Tokens cheaper on MEXC than on DEX by at least minGapPct, biggest gap first. */
    87	export function findGaps(
    88	  tokens: ScanToken[],
    89	  tickers: Map<string, { bid: number; ask: number }>,
    90	  dex: Map<string, { price: number; tvl: number }>,
    91	  opts: { minTvlUsd: number; minGapPct: number; maxGapPct?: number },
    92	): Gap[] {
    93	  const gaps: Gap[] = [];
    94	  for (const token of tokens) {
    95	    const t = tickers.get(token.symbol);
    96	    const d = dex.get(token.address);
    97	    if (!t || !d || t.ask <= 0 || d.price <= 0 || d.tvl < opts.minTvlUsd) continue;
    98	    const gapPct = (d.price / t.ask - 1) * 100;
    99	    // Huge gaps usually mean a different/broken token or a dead pool, not an opportunity.
   100	    if (gapPct >= opts.minGapPct && gapPct < (opts.maxGapPct ?? 30)) gaps.push({ token, ask: t.ask, dexPrice: d.price, tvlUsd: d.tvl, gapPct });
   101	  }
   102	  return gaps.sort((a, b) => b.gapPct - a.gapPct);
   103	}
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
     1	// Telegram alerts + commands (/stop, /start, /status). Only the configured chat id is obeyed.
     2	import { log, errMsg, redact } from './log.js';
     3	import { sleep } from './util.js';
     4	
     5	type Handler = (args: string[]) => Promise<string> | string;
     6	type FetchFn = typeof fetch;
     7	
     8	export class Telegram {
     9	  private offset = 0;
    10	  private running = false;
    11	
    12	  constructor(private token: string, private chatId: string, private fetchFn: FetchFn = fetch) {}
    13	
    14	  get enabled(): boolean {
    15	    return Boolean(this.token && this.chatId);
    16	  }
    17	
    18	  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    19	    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
    20	      method: 'POST',
    21	      headers: { 'Content-Type': 'application/json' },
    22	      body: JSON.stringify(body),
    23	      signal: AbortSignal.timeout(timeoutMs),
    24	    });
    25	    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    26	    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    27	    return j.result;
    28	  }
    29	
    30	  /** Never throws: alerts must not crash the bot. */
    31	  async send(text: string): Promise<void> {
    32	    const msg = redact(text);
    33	    log.info(`[telegram] ${msg.replace(/\n/g, ' | ')}`);
    34	    if (!this.enabled) return;
    35	    try {
    36	      await this.api('sendMessage', { chat_id: this.chatId, text: msg.slice(0, 4000), disable_web_page_preview: true });
    37	    } catch (e) {
    38	      log.warn(`telegram send failed: ${errMsg(e)}`);
    39	    }
    40	  }
    41	
    42	  /** Dispatch one update; exported for tests. */
    43	  async handle(update: { message?: { chat?: { id: number | string }; text?: string } }, handlers: Record<string, Handler>) {
    44	    const m = update.message;
    45	    if (!m?.text || String(m.chat?.id) !== String(this.chatId)) return; // ignore strangers
    46	    const [first, ...args] = m.text.trim().split(/\s+/);
    47	    const cmd = first.split('@')[0].toLowerCase();
    48	    const h = handlers[cmd];
    49	    const reply = h ? await h(args) : `Commands: ${Object.keys(handlers).join(' ')}`;
    50	    await this.send(reply);
    51	  }
    52	
    53	  async startPolling(handlers: Record<string, Handler>): Promise<void> {
    54	    if (!this.enabled || this.running) return;
    55	    this.running = true;
    56	    while (this.running) {
    57	      try {
    58	        const updates = await this.api<{ update_id: number; message?: { chat?: { id: number }; text?: string } }[]>(
    59	          'getUpdates',
    60	          { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
    61	          35_000,
    62	        );
    63	        for (const u of updates) {
    64	          this.offset = u.update_id + 1;
    65	          await this.handle(u, handlers).catch((e) => log.warn(`telegram handler: ${errMsg(e)}`));
    66	        }
    67	      } catch (e) {
    68	        log.warn(`telegram poll: ${errMsg(e)}`);
    69	        await sleep(5000);
    70	      }
    71	    }
    72	  }
    73	
    74	  stop(): void {
    75	    this.running = false;
    76	  }
    77	}
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
   268	        this.d.risk.pause(`MEXC buy state unknown for transfer #${id}`);
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
   512	    this.d.risk.pause(`transfer #${row.id}: ${what} outcome unknown`);
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
   539	        this.d.risk.pause(`MEXC sell of ${row.base} only partly filled`);
   540	        await this.d.tg.send(
   541	          `🚨 ${row.base}: MEXC market sell filled only ${filled}/${qty}. The rest is still on MEXC. Trading PAUSED: sell it by hand, then /start.`,
   542	        );
   543	      }
   544	      await this.sleep(1500);
   545	      const received = ((await this.d.mexc.balances()).USDT ?? 0) - usdtBefore;
   546	      // Fallback only if the balance read is clearly off (e.g. a concurrent deposit/withdrawal).
   547	      return received > 0 ? received : Number(o.cummulativeQuoteQty) * (1 - this.cfg.mexcTakerFee);
   548	    } catch (e) {
   549	      this.d.risk.pause(`could not close ${row.base} on MEXC`);
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
   580	    return `Transfer #${id} closed manually. (Its PnL is not counted; check balances yourself.)`;
   581	  }
   582	
   583	  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0) {
   584	    const now = this.now();
   585	    const buyPrice = row.cost_usd / (row.buy_qty || 1);
   586	    this.d.db.insertTrade({
   587	      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
   588	      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: buyPrice, sell_price: sellPrice, expected_net: row.expected_net,
   589	      // informational only: PnL is measured from real balances and already includes every fee
   590	      cex_fee_usd: row.cost_usd * this.cfg.mexcTakerFee + row.withdraw_fee * buyPrice,
   591	      gas_usd: gas, pnl_usd: pnl, status, dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
   592	    });
   593	  }
   594	
   595	  private afterRisk(status: 'ok' | 'one_sided') {
   596	    for (const e of this.d.risk.afterTrade(status)) {
   597	      if (e.kind === 'loss_limit') void this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). New trades STOPPED. Send /start to resume.`);
   598	      if (e.kind === 'fail_streak') void this.d.tg.send(`🛑 ${e.count} failed trades in a row. New trades PAUSED. /start to resume.`);
   599	      if (e.kind === 'trade_limit') void this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}).`);
   600	    }
   601	  }
   602	}
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
    35	/** Float -> base units, truncated. */
    36	export function toUnits(x: number, decimals: number): bigint {
    37	  const [i, f = ''] = x.toFixed(Math.min(decimals, 18)).split('.');
    38	  return BigInt(i + f.padEnd(decimals, '0').slice(0, decimals));
    39	}
```

## `src/watchlist.ts`

```ts
     1	// Builds the token list: on MEXC (USDT pair) AND on Ethereum, with the SAME contract address
     2	// (taken from MEXC's own deposit network info), enough DEX TVL and MEXC volume.
     3	import type { CoinConfig, MexcRest } from './mexc/rest.js';
     4	import { log, errMsg } from './log.js';
     5	
     6	export interface Token {
     7	  base: string; // e.g. LINK
     8	  symbol: string; // MEXC symbol, e.g. LINKUSDT
     9	  address: string; // Ethereum contract (lowercase)
    10	  decimals: number;
    11	  qtyStep: number; // MEXC quantity step
    12	  priceDecimals: number; // MEXC price precision
    13	  dexTvlUsd: number;
    14	  mexcVolumeUsd: number;
    15	  depositOk: boolean;
    16	  withdrawOk: boolean;
    17	}
    18	
    19	const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH', 'WBTC']);
    20	
    21	/** MEXC's Ethereum network entry for a coin (network names vary: "ERC20", "Ethereum(ERC20)", netWork "ETH"). */
    22	export function ethNetwork(cfg: CoinConfig) {
    23	  return cfg.networkList.find(
    24	    (n) => n.netWork === 'ETH' || /ERC20/i.test(n.network) || /^ethereum$/i.test(n.network),
    25	  );
    26	}
    27	
    28	type FetchFn = typeof fetch;
    29	
    30	/** Highest liquidity (USD) of any Ethereum pool for the token, from DexScreener. */
    31	export async function dexTvl(address: string, fetchFn: FetchFn = fetch): Promise<number> {
    32	  const res = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
    33	  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    34	  const j = (await res.json()) as { pairs?: { chainId: string; liquidity?: { usd?: number } }[] | null };
    35	  return Math.max(0, ...(j.pairs ?? []).filter((p) => p.chainId === 'ethereum').map((p) => p.liquidity?.usd ?? 0));
    36	}
    37	
    38	export async function buildWatchlist(
    39	  mexc: MexcRest,
    40	  decimalsOf: (address: string) => Promise<number>,
    41	  opts: { only: string[]; max: number; minTvlUsd: number; minVolumeUsd: number },
    42	): Promise<Token[]> {
    43	  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
    44	  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
    45	  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
    46	
    47	  const candidates = symbols
    48	    .filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed && String(s.status) === '1')
    49	    .filter((s) => !SKIP.has(s.baseAsset.toUpperCase()))
    50	    .filter((s) => opts.only.length === 0 || opts.only.includes(s.baseAsset.toUpperCase()))
    51	    .filter((s) => (volume.get(s.symbol) ?? 0) >= opts.minVolumeUsd)
    52	    .sort((a, b) => (volume.get(b.symbol) ?? 0) - (volume.get(a.symbol) ?? 0));
    53	
    54	  const out: Token[] = [];
    55	  for (const s of candidates) {
    56	    if (out.length >= opts.max) break;
    57	    const coin = coinBy.get(s.baseAsset.toUpperCase());
    58	    const net = coin && ethNetwork(coin);
    59	    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue; // not an Ethereum token on MEXC
    60	    const address = net.contract.toLowerCase();
    61	    try {
    62	      const tvl = await dexTvl(address);
    63	      if (tvl < opts.minTvlUsd) {
    64	        log.info(`watchlist: skip ${s.baseAsset}, DEX TVL $${Math.round(tvl)}`);
    65	        continue;
    66	      }
    67	      out.push({
    68	        base: s.baseAsset.toUpperCase(),
    69	        symbol: s.symbol,
    70	        address,
    71	        decimals: await decimalsOf(address),
    72	        qtyStep: Number(s.baseSizePrecision) || 10 ** -(s.baseAssetPrecision ?? 2),
    73	        priceDecimals: s.quotePrecision,
    74	        dexTvlUsd: tvl,
    75	        mexcVolumeUsd: volume.get(s.symbol) ?? 0,
    76	        depositOk: net.depositEnable,
    77	        withdrawOk: net.withdrawEnable,
    78	      });
    79	    } catch (e) {
    80	      log.warn(`watchlist: ${s.baseAsset} check failed: ${errMsg(e)}`);
    81	    }
    82	  }
    83	  return out;
    84	}
    85	
    86	/** Refresh deposit/withdraw flags (tokens with either suspended are skipped). */
    87	export async function refreshStatus(mexc: MexcRest, tokens: Token[]): Promise<string[]> {
    88	  const coins = new Map((await mexc.coinConfigs()).map((c) => [c.coin.toUpperCase(), c]));
    89	  const changed: string[] = [];
    90	  for (const t of tokens) {
    91	    const net = coins.get(t.base) && ethNetwork(coins.get(t.base)!);
    92	    const dep = Boolean(net?.depositEnable && net.contract?.toLowerCase() === t.address);
    93	    const wd = Boolean(net?.withdrawEnable);
    94	    if (dep !== t.depositOk || wd !== t.withdrawOk) changed.push(`${t.base}: deposit ${dep ? 'on' : 'OFF'}, withdraw ${wd ? 'on' : 'OFF'}`);
    95	    t.depositOk = dep;
    96	    t.withdrawOk = wd;
    97	  }
    98	  return changed;
    99	}
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
    22	}
    23	export interface CoinNetwork {
    24	  coin: string;
    25	  network: string;
    26	  netWork?: string;
    27	  contract?: string;
    28	  depositEnable: boolean;
    29	  withdrawEnable: boolean;
    30	  withdrawFee?: string; // in the coin itself
    31	  withdrawMin?: string;
    32	  withdrawMax?: string;
    33	}
    34	export interface CoinConfig {
    35	  coin: string;
    36	  networkList: CoinNetwork[];
    37	}
    38	export interface Order {
    39	  orderId: string;
    40	  status: string; // NEW, FILLED, PARTIALLY_FILLED, CANCELED, PARTIALLY_CANCELED
    41	  executedQty: string;
    42	  cummulativeQuoteQty: string;
    43	  origQty: string;
    44	  price: string;
    45	  side: Side;
    46	}
    47	
    48	type FetchFn = typeof fetch;
    49	
    50	/** HTTP 429/418 from any API: callers back off instead of hammering. */
    51	export class RateLimitError extends Error {}
    52	
    53	/**
    54	 * The request may or may not have reached MEXC (timeout / connection reset on a POST).
    55	 * Never assume "not placed": look the order / withdrawal up by our own client id.
    56	 */
    57	export class AmbiguousRequestError extends Error {}
    58	
    59	export interface WithdrawRecord {
    60	  id: string;
    61	  status: number;
    62	  amount: string;
    63	  txId?: string;
    64	  withdrawOrderId?: string;
    65	}
    66	
    67	export class MexcRest {
    68	  /** serverTime - localTime, so signed timestamps stay inside recvWindow even if the VPS clock drifts. */
    69	  timeOffsetMs = 0;
    70	
    71	  constructor(
    72	    private apiKey = '',
    73	    private apiSecret = '',
    74	    private baseUrl = 'https://api.mexc.com',
    75	    private fetchFn: FetchFn = fetch,
    76	  ) {}
    77	
    78	  sign(query: string): string {
    79	    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
    80	  }
    81	
    82	  async request<T>(method: string, path: string, params: Record<string, string | number> = {}, signed = false): Promise<T> {
    83	    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    84	    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    85	    if (signed) {
    86	      if (!this.apiKey || !this.apiSecret) throw new Error('MEXC API key/secret not configured');
    87	      qs.set('timestamp', String(Date.now() + this.timeOffsetMs));
    88	      qs.set('recvWindow', '5000');
    89	      qs.set('signature', this.sign(qs.toString()));
    90	      headers['X-MEXC-APIKEY'] = this.apiKey;
    91	    }
    92	    const q = qs.toString();
    93	    let res: Response;
    94	    let text: string;
    95	    try {
    96	      res = await this.fetchFn(`${this.baseUrl}${path}${q ? `?${q}` : ''}`, {
    97	        method,
    98	        headers,
    99	        signal: AbortSignal.timeout(10_000),
   100	      });
   101	      text = await res.text();
   102	    } catch (e) {
   103	      const msg = redact(`MEXC ${method} ${path}: ${(e as Error).message}`);
   104	      // A write that timed out may still have been executed by MEXC.
   105	      if (method !== 'GET') throw new AmbiguousRequestError(msg);
   106	      throw new Error(msg);
   107	    }
   108	    let body: unknown;
   109	    try {
   110	      body = JSON.parse(text);
   111	    } catch {
   112	      body = text;
   113	    }
   114	    const err = redact(`MEXC ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
   115	    if (res.status === 429 || res.status === 418) throw new RateLimitError(err);
   116	    if (res.status >= 500 && method !== 'GET') throw new AmbiguousRequestError(err);
   117	    if (!res.ok) throw new Error(err);
   118	    return body as T;
   119	  }
   120	
   121	  /** Measure clock skew against MEXC; returns the offset in ms. */
   122	  async syncTime(): Promise<number> {
   123	    const t0 = Date.now();
   124	    const r = await this.request<{ serverTime: number }>('GET', '/api/v3/time');
   125	    const t1 = Date.now();
   126	    this.timeOffsetMs = Math.round(r.serverTime - (t0 + t1) / 2);
   127	    return this.timeOffsetMs;
   128	  }
   129	
   130	  async depth(symbol: string, limit = 20): Promise<Book> {
   131	    const d = await this.request<{ bids: [string, string][]; asks: [string, string][] }>('GET', '/api/v3/depth', { symbol, limit });
   132	    const conv = (l: [string, string][]): Level[] => l.map(([p, q]) => [Number(p), Number(q)]);
   133	    return { bids: conv(d.bids), asks: conv(d.asks), ts: Date.now() };
   134	  }
   135	
   136	  async exchangeInfo(): Promise<SymbolInfo[]> {
   137	    const r = await this.request<{ symbols: SymbolInfo[] }>('GET', '/api/v3/exchangeInfo');
   138	    return r.symbols;
   139	  }
   140	
   141	  async tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]> {
   142	    return this.request('GET', '/api/v3/ticker/24hr');
   143	  }
   144	
   145	  async price(symbol: string): Promise<number> {
   146	    const r = await this.request<{ price: string }>('GET', '/api/v3/ticker/price', { symbol });
   147	    return Number(r.price);
   148	  }
   149	
   150	  /** Deposit/withdraw status and contract address per network (signed). */
   151	  async coinConfigs(): Promise<CoinConfig[]> {
   152	    return this.request('GET', '/api/v3/capital/config/getall', {}, true);
   153	  }
   154	
   155	  async account(): Promise<{ canTrade: boolean; balances: { asset: string; free: string; locked: string }[] }> {
   156	    return this.request('GET', '/api/v3/account', {}, true);
   157	  }
   158	
   159	  async balances(): Promise<Record<string, number>> {
   160	    const a = await this.account();
   161	    return Object.fromEntries(a.balances.map((b) => [b.asset, Number(b.free)]));
   162	  }
   163	
   164	  /** Best bid/ask for every symbol in one call. */
   165	  async bookTickers(): Promise<Map<string, { bid: number; ask: number }>> {
   166	    const r = await this.request<{ symbol: string; bidPrice: string; askPrice: string }[]>('GET', '/api/v3/ticker/bookTicker');
   167	    return new Map(r.map((t) => [t.symbol, { bid: Number(t.bidPrice), ask: Number(t.askPrice) }]));
   168	  }
   169	
   170	  /** Withdraw (new endpoint). Requires an API key with withdraw permission. Returns the withdraw id. */
   171	  async withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string> {
   172	    const params: Record<string, string> = { coin: p.coin, netWork: p.netWork, address: p.address, amount: p.amount };
   173	    if (p.contractAddress) params.contractAddress = p.contractAddress;
   174	    if (p.withdrawOrderId) params.withdrawOrderId = p.withdrawOrderId;
   175	    const r = await this.request<{ id: string }>('POST', '/api/v3/capital/withdraw', params, true);
   176	    return r.id;
   177	  }
   178	
   179	  /** Recent withdrawals of a coin (status: 1 APPLY .. 6 WAIT_CONFIRM, 7 SUCCESS, 8 FAILED, 9 CANCEL, 10 MANUAL). */
   180	  async withdrawHistory(coin: string, sinceTs: number): Promise<WithdrawRecord[]> {
   181	    const r = await this.request<{ id: string; status: number | string; amount: string; txId?: string; withdrawOrderId?: string }[]>(
   182	      'GET',
   183	      '/api/v3/capital/withdraw/history',
   184	      { coin, startTime: Math.max(0, Math.floor(sinceTs)), limit: 1000 },
   185	      true,
   186	    );
   187	    return r.map((w) => ({ id: w.id, status: Number(w.status), amount: w.amount, txId: w.txId, withdrawOrderId: w.withdrawOrderId }));
   188	  }
   189	
   190	  /** Find a withdrawal by MEXC id or by our own withdrawOrderId. null = not in history. */
   191	  async findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null> {
   192	    const h = await this.withdrawHistory(coin, sinceTs);
   193	    return h.find((w) => (ref.id && w.id === ref.id) || (ref.withdrawOrderId && w.withdrawOrderId === ref.withdrawOrderId)) ?? null;
   194	  }
   195	
   196	  /** `clientOrderId` makes the order findable even if this request times out. */
   197	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }> {
   198	    const p: Record<string, string> = { symbol, side, type: 'LIMIT', quantity, price };
   199	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   200	    return this.request('POST', '/api/v3/order', p, true);
   201	  }
   202	
   203	  /** Look an order up by our own client id; null if MEXC has no such order. */
   204	  async getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null> {
   205	    try {
   206	      return await this.request<Order>('GET', '/api/v3/order', { symbol, origClientOrderId: clientOrderId }, true);
   207	    } catch (e) {
   208	      // MEXC documents -2011 "Unknown order sent"; anything else is a real error (caller retries).
   209	      if (/-2011|unknown order|does not exist|not exist/i.test((e as Error).message)) return null;
   210	      throw e;
   211	    }
   212	  }
   213	
   214	  /** MARKET SELL by base quantity (documented). For buys use an aggressive LIMIT instead. */
   215	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }> {
   216	    const p: Record<string, string> = { symbol, side: 'SELL', type: 'MARKET', quantity };
   217	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   218	    return this.request('POST', '/api/v3/order', p, true);
   219	  }
   220	
   221	  getOrder(symbol: string, orderId: string): Promise<Order> {
   222	    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
   223	  }
   224	
   225	  cancelOrder(symbol: string, orderId: string): Promise<Order> {
   226	    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
   227	  }
   228	}
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
    39	
    40	    ws.on('open', () => {
    41	      attempt = 0;
    42	      const params = symbols.map((s) => `spot@public.limit.depth.v3.api.pb@${s}@20`);
    43	      ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params }));
    44	      ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ method: 'PING' })), 20_000);
    45	      log.info(`MEXC WS subscribed: ${symbols.join(',')}`);
    46	    });
    47	
    48	    ws.on('message', (data: Buffer, isBinary: boolean) => {
    49	      if (!isBinary) {
    50	        const msg = data.toString();
    51	        if (msg.includes('Blocked') || msg.includes('Not Subscribed')) log.warn(`MEXC WS: ${msg}`);
    52	        return;
    53	      }
    54	      try {
    55	        const push = decodeDepthPush(data);
    56	        // Sanity check: ignore empty or crossed books instead of trading on them.
    57	        if (push && push.symbol && push.bids.length && push.asks.length && push.bids[0][0] < push.asks[0][0]) {
    58	          this.books.set(push.symbol, { bids: push.bids, asks: push.asks, ts: Date.now() });
    59	        }
    60	      } catch (e) {
    61	        log.warn(`MEXC WS decode error: ${errMsg(e)}`);
    62	      }
    63	    });
    64	
    65	    const reconnect = () => {
    66	      if (ping) clearInterval(ping);
    67	      this.sockets = this.sockets.filter((s) => s !== ws);
    68	      if (this.stopped) return;
    69	      const delay = Math.min(30_000, 1000 * 2 ** attempt);
    70	      log.warn(`MEXC WS closed, reconnecting in ${delay}ms`);
    71	      setTimeout(() => this.connect(symbols, attempt + 1), delay);
    72	    };
    73	    ws.on('close', reconnect);
    74	    ws.on('error', (e) => {
    75	      log.warn(`MEXC WS error: ${errMsg(e)}`);
    76	      ws.terminate();
    77	    });
    78	  }
    79	}
```

## `src/dex/aggregator.ts`

```ts
     1	// DEX quotes from 0x (Swap API v2, AllowanceHolder) or 1inch (Swap API v6).
     2	// Both route across Uniswap v2/v3 and other Ethereum DEXs; DEX fees are already in buyAmount.
     3	import { redact } from '../log.js';
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
    52	  issues?: { allowance?: { spender: string } | null; balance?: unknown };
    53	  transaction?: { to: string; data: string; gas: string; value: string };
    54	}
    55	
    56	export class ZeroEx implements Aggregator {
    57	  name = '0x';
    58	  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, private chainId = 1) {
    59	    if (!apiKey) throw new Error('ZEROX_API_KEY is required for DEX_AGGREGATOR=0x');
    60	  }
    61	
    62	  private url(kind: 'price' | 'quote', r: QuoteRequest): string {
    63	    const q = new URLSearchParams({
    64	      chainId: String(this.chainId),
    65	      sellToken: r.sellToken,
    66	      buyToken: r.buyToken,
    67	      sellAmount: r.sellAmount.toString(),
    68	      taker: r.taker,
    69	      slippageBps: String(r.slippageBps),
    70	    });
    71	    return `https://api.0x.org/swap/allowance-holder/${kind}?${q}`;
    72	  }
    73	
    74	  private async call(kind: 'price' | 'quote', r: QuoteRequest): Promise<Quote> {
    75	    const d = await getJson<ZeroExResponse>(this.fetchFn, this.url(kind, r), { '0x-api-key': this.apiKey, '0x-version': 'v2' });
    76	    if (!d.liquidityAvailable) throw new Error('0x: no liquidity');
    77	    const gas = BigInt(d.transaction?.gas ?? d.gas ?? '300000');
    78	    // With the AllowanceHolder flow, both the spender and tx.to are the AllowanceHolder contract.
    79	    const spender = requireAddress('0x spender', d.issues?.allowance?.spender ?? ZEROX_ALLOWANCE_HOLDER, ZEROX_ALLOWANCE_HOLDER);
    80	    if (d.transaction) requireAddress('0x tx.to', d.transaction.to, ZEROX_ALLOWANCE_HOLDER);
    81	    return {
    82	      buyAmount: BigInt(d.buyAmount),
    83	      minBuyAmount: BigInt(d.minBuyAmount),
    84	      gas,
    85	      spender,
    86	      tx: d.transaction ? { to: d.transaction.to, data: d.transaction.data, value: BigInt(d.transaction.value || '0') } : undefined,
    87	    };
    88	  }
    89	
    90	  price(r: QuoteRequest) {
    91	    return this.call('price', r);
    92	  }
    93	  quote(r: QuoteRequest) {
    94	    return this.call('quote', r);
    95	  }
    96	}
    97	
    98	export class OneInch implements Aggregator {
    99	  name = '1inch';
   100	  private spender?: string;
   101	  private base: string;
   102	  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, chainId = 1) {
   103	    if (!apiKey) throw new Error('ONEINCH_API_KEY is required for DEX_AGGREGATOR=1inch');
   104	    this.base = `https://api.1inch.dev/swap/v6.0/${chainId}`;
   105	  }
   106	  private get headers() {
   107	    return { Authorization: `Bearer ${this.apiKey}`, accept: 'application/json' };
   108	  }
   109	  private async getSpender(): Promise<string> {
   110	    if (!this.spender) {
   111	      const a = (await getJson<{ address: string }>(this.fetchFn, `${this.base}/approve/spender`, this.headers)).address;
   112	      this.spender = requireAddress('1inch spender', a, ONEINCH_ROUTER_V6);
   113	    }
   114	    return this.spender;
   115	  }
   116	  private minOut(amount: bigint, bps: number) {
   117	    return (amount * BigInt(10_000 - bps)) / 10_000n;
   118	  }
   119	
   120	  async price(r: QuoteRequest): Promise<Quote> {
   121	    const q = new URLSearchParams({ src: r.sellToken, dst: r.buyToken, amount: r.sellAmount.toString(), includeGas: 'true' });
   122	    const d = await getJson<{ dstAmount: string; gas?: number }>(this.fetchFn, `${this.base}/quote?${q}`, this.headers);
   123	    const buy = BigInt(d.dstAmount);
   124	    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.gas ?? 300_000), spender: await this.getSpender() };
   125	  }
   126	
   127	  async quote(r: QuoteRequest): Promise<Quote> {
   128	    const q = new URLSearchParams({
   129	      src: r.sellToken,
   130	      dst: r.buyToken,
   131	      amount: r.sellAmount.toString(),
   132	      from: r.taker,
   133	      origin: r.taker,
   134	      slippage: String(r.slippageBps / 100), // percent
   135	      disableEstimate: 'true', // we simulate ourselves with eth_call
   136	      includeGas: 'true',
   137	    });
   138	    const d = await getJson<{ dstAmount: string; tx: { to: string; data: string; value: string; gas: number } }>(
   139	      this.fetchFn,
   140	      `${this.base}/swap?${q}`,
   141	      this.headers,
   142	    );
   143	    const buy = BigInt(d.dstAmount);
   144	    requireAddress('1inch tx.to', d.tx.to, ONEINCH_ROUTER_V6);
   145	    return {
   146	      buyAmount: buy,
   147	      minBuyAmount: this.minOut(buy, r.slippageBps),
   148	      gas: BigInt(d.tx.gas || 300_000),
   149	      spender: await this.getSpender(),
   150	      tx: { to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value || '0') },
   151	    };
   152	  }
   153	}
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
   121	  /**
   122	   * Sign and send through the private RPC, wait for inclusion.
   123	   * If it is not mined within timeoutSec, replace it with a 0-value self-transfer (cancel).
   124	   */
   125	  async send(
   126	    tx: { to: string; data: string; value?: bigint },
   127	    gasLimit: bigint,
   128	    gas: GasInfo,
   129	    timeoutSec: number,
   130	  ): Promise<TxResult> {
   131	    const wallet = this.wallet!;
   132	    const nonce = await this.provider.getTransactionCount(wallet.address, 'pending');
   133	    const base = { chainId: 1n, type: 2, nonce, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip };
   134	    const signed = await wallet.signTransaction({ ...base, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit });
   135	    const hash = ethers.keccak256(signed);
   136	    await this.sendProvider.send('eth_sendRawTransaction', [signed]);
   137	    log.info(`tx sent ${hash}`);
   138	
   139	    let receipt = await this.waitReceipt(hash, timeoutSec);
   140	    if (!receipt) {
   141	      log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
   142	      const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
   143	      const cancel = await wallet.signTransaction({
   144	        ...base,
   145	        maxFeePerGas: bump(gas.maxFee),
   146	        maxPriorityFeePerGas: bump(gas.tip),
   147	        to: wallet.address,
   148	        value: 0n,
   149	        gasLimit: 21_000n,
   150	      });
   151	      const cancelHash = ethers.keccak256(cancel);
   152	      await this.sendProvider.send('eth_sendRawTransaction', [cancel]).catch((e) => log.warn(`cancel send failed: ${errMsg(e)}`));
   153	      const deadline = Date.now() + timeoutSec * 1000;
   154	      while (Date.now() < deadline && !receipt) {
   155	        receipt = await this.provider.getTransactionReceipt(hash);
   156	        const cancelReceipt = await this.provider.getTransactionReceipt(cancelHash);
   157	        if (cancelReceipt) {
   158	          return { ok: false, hash, gasCostWei: cancelReceipt.gasUsed * cancelReceipt.gasPrice, reason: 'not mined, cancelled' };
   159	        }
   160	        if (!receipt) await sleep(3000);
   161	      }
   162	      if (!receipt) {
   163	        return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `not mined and cancel ${cancelHash} not confirmed: outcome UNKNOWN, check wallet` };
   164	      }
   165	    }
   166	    const cost = receipt.gasUsed * receipt.gasPrice;
   167	    return receipt.status === 1 ? { ok: true, hash, gasCostWei: cost } : { ok: false, hash, gasCostWei: cost, reason: 'reverted' };
   168	  }
   169	
   170	  private async waitReceipt(hash: string, timeoutSec: number) {
   171	    const deadline = Date.now() + timeoutSec * 1000;
   172	    while (Date.now() < deadline) {
   173	      const r = await this.provider.getTransactionReceipt(hash).catch(() => null);
   174	      if (r) return r;
   175	      await sleep(2000);
   176	    }
   177	    return null;
   178	  }
   179	}
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
    12	import type { Book, Order } from '../src/mexc/rest.js';
    13	
    14	const GWEI = 1_000_000_000n;
    15	const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    16	const LINK: Token = {
    17	  base: 'LINK', symbol: 'LINKUSDT', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18,
    18	  qtyStep: 0.01, priceDecimals: 3, dexTvlUsd: 1e6, mexcVolumeUsd: 1e7, depositOk: true, withdrawOk: true,
    19	};
    20	
    21	function setup(opts: {
    22	  mode?: 'live' | 'paper';
    23	  bid?: number;
    24	  gasGwei?: bigint;
    25	  dexOk?: boolean;
    26	  simulateThrows?: boolean;
    27	  approvalNeeded?: boolean;
    28	  mexcFillRatio?: number;
    29	  marketFillRatio?: number;
    30	  dexUnknown?: boolean;
    31	}) {
    32	  process.env.MODE = opts.mode ?? 'live';
    33	  process.env.RPC_URL = 'http://localhost';
    34	  process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
    35	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    36	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    37	  const cfg = loadConfig();
    38	  const db = new Db(':memory:');
    39	  const risk = new Risk(db, cfg.mode, cfg);
    40	  const alerts: string[] = [];
    41	  const calls: string[] = [];
    42	
    43	  const fee = cfg.mexcTakerFee;
    44	  const bid = opts.bid ?? 11.2;
    45	  // Real-ish balances that the fakes update, so PnL is computed from balance changes.
    46	  const bal: Balances = { walletEth: 1, walletUsdc: 1000, walletToken: { LINK: 100 }, mexc: { USDT: 1000, LINK: 100 } };
    47	  const ethUsd = 2000;
    48	
    49	  const books: Record<string, Book> = {
    50	    ETHUSDT: { bids: [[ethUsd, 100]], asks: [[ethUsd, 100]], ts: Date.now() },
    51	    LINKUSDT: { bids: [[bid, 1000]], asks: [[bid + 0.01, 1000]], ts: Date.now() },
    52	  };
    53	
    54	  // DEX price = 10 USDC per LINK, 0.1% minOut buffer.
    55	  const dexQuote = (r: QuoteRequest, firm: boolean): Quote => {
    56	    const buyingToken = r.sellToken === USDC;
    57	    const out = buyingToken ? (r.sellAmount * 10n ** 12n) / 10n : (r.sellAmount * 10n) / 10n ** 12n;
    58	    return {
    59	      buyAmount: out,
    60	      minBuyAmount: (out * 999n) / 1000n,
    61	      gas: 150_000n,
    62	      spender: '0xspender',
    63	      tx: firm ? { to: '0xrouter', data: '0xdead', value: 0n } : undefined,
    64	    };
    65	  };
    66	  let lastFirm: QuoteRequest | null = null;
    67	
    68	  const orders = new Map<string, Order>();
    69	  let nextId = 1;
    70	  const fill = (side: 'BUY' | 'SELL', qty: number, price: number) => {
    71	    if (side === 'SELL') {
    72	      bal.mexc.LINK -= qty;
    73	      bal.mexc.USDT += qty * price * (1 - fee);
    74	    } else {
    75	      bal.mexc.LINK += qty * (1 - fee);
    76	      bal.mexc.USDT -= qty * price;
    77	    }
    78	  };
    79	
    80	  const engine = new Engine({
    81	    cfg,
    82	    db,
    83	    risk,
    84	    tokens: [LINK],
    85	    sleep: async () => {},
    86	    tg: { send: async (t) => void alerts.push(t) },
    87	    book: async (s) => books[s],
    88	    balances: async () => structuredClone(bal),
    89	    agg: {
    90	      name: '0x',
    91	      price: async (r) => dexQuote(r, false),
    92	      quote: async (r) => ((lastFirm = r), dexQuote(r, true)),
    93	    },
    94	    chain: {
    95	      address: '0xme',
    96	      gas: async () => {
    97	        const base = (opts.gasGwei ?? 9n) * GWEI;
    98	        return { baseFee: base, tip: GWEI, effective: base + GWEI, maxFee: base * 2n + GWEI };
    99	      },
   100	      approvalGasNeeded: async () => (opts.approvalNeeded ? 60_000n : 0n),
   101	      approveExact: async (_t, _s, amount) => {
   102	        calls.push(`approve ${amount}`);
   103	        bal.walletEth -= 0.0006;
   104	        return { ok: true, gasCostWei: 600_000n * GWEI };
   105	      },
   106	      simulate: async () => {
   107	        calls.push('simulate');
   108	        if (opts.simulateThrows) throw new Error('execution reverted');
   109	        return 150_000n;
   110	      },
   111	      send: async (): Promise<TxResult> => {
   112	        calls.push('send');
   113	        const gasWei = 150_000n * 10n * GWEI;
   114	        bal.walletEth -= 0.0015;
   115	        if (opts.dexUnknown) return { ok: false, unknown: true, hash: '0xtx', gasCostWei: 0n, reason: 'unknown' };
   116	        if (opts.dexOk === false) return { ok: false, hash: '0xtx', gasCostWei: gasWei, reason: 'reverted' };
   117	        const r = lastFirm!;
   118	        if (r.sellToken === USDC) {
   119	          bal.walletUsdc -= Number(r.sellAmount) / 1e6;
   120	          bal.walletToken.LINK += (Number(r.sellAmount) / 1e6) / 10;
   121	        } else {
   122	          const tokens = Number(r.sellAmount) / 1e18;
   123	          bal.walletToken.LINK -= tokens;
   124	          bal.walletUsdc += tokens * 10;
   125	        }
   126	        return { ok: true, hash: '0xtx', gasCostWei: gasWei };
   127	      },
   128	    },
   129	    mexc: {
   130	      limitOrder: async (_s, side, q, p) => {
   131	        calls.push(`limit ${side} ${q} @ ${p}`);
   132	        const id = String(nextId++);
   133	        const filled = Number(q) * (opts.mexcFillRatio ?? 1);
   134	        fill(side, filled, Number(p));
   135	        orders.set(id, { orderId: id, status: filled === Number(q) ? 'FILLED' : 'PARTIALLY_FILLED', executedQty: String(filled), cummulativeQuoteQty: '0', origQty: q, price: p, side });
   136	        return { orderId: id };
   137	      },
   138	      marketSell: async (_s, q) => {
   139	        calls.push(`market SELL ${q}`);
   140	        const filled = Number(q) * (opts.marketFillRatio ?? 1);
   141	        fill('SELL', filled, bid);
   142	        orders.set('m', { orderId: 'm', status: 'FILLED', executedQty: String(filled), cummulativeQuoteQty: String(filled * bid), origQty: q, price: '0', side: 'SELL' });
   143	        return { orderId: 'm' };
   144	      },
   145	      getOrderByClientId: async () => null,
   146	      getOrder: async (_s, id) => orders.get(id)!,
   147	      cancelOrder: async (_s, id) => {
   148	        calls.push(`cancel ${id}`);
   149	        const o = orders.get(id)!;
   150	        o.status = 'PARTIALLY_CANCELED';
   151	        return o;
   152	      },
   153	    },
   154	  });
   155	  return { engine, db, risk, alerts, calls, bal, cfg };
   156	}
   157	
   158	const trades = (db: Db) => db.statsSince(0);
   159	
   160	test('profitable gap: both legs trade, PnL comes from real balance changes', async () => {
   161	  const { engine, db, alerts, calls } = setup({});
   162	  await engine.tick();
   163	  // MEXC sell 20 LINK (bought 20 on DEX for $200), limit = 11.2 * (1 - 0.2%) rounded down.
   164	  assert.deepEqual(calls, ['simulate', 'limit SELL 20.00 @ 11.177', 'send']);
   165	  const s = trades(db);
   166	  assert.equal(s.total.trades, 1);
   167	  assert.equal(s.total.failed, 0);
   168	  // +20 LINK in wallet, -20 on MEXC; -$200 USDC; +20*11.177*(1-0.0005) USDT; -0.0015 ETH gas
   169	  const expected = -200 + 20 * 11.177 * 0.9995 - 0.0015 * 2000;
   170	  assert.ok(Math.abs(s.total.pnl - expected) < 1e-6, `${s.total.pnl} vs ${expected}`);
   171	  assert.ok(Math.abs(s.total.gas - 3) < 1e-9);
   172	  assert.ok(alerts.some((a) => a.includes('✅ LIVE LINK DEX_BUY [ok]') && a.includes('Net PnL')));
   173	});
   174	
   175	test('no trade when the gap is below max($15, 0.5%)', async () => {
   176	  const { engine, db, calls } = setup({ bid: 10.9 });
   177	  await engine.tick();
   178	  assert.deepEqual(calls, []);
   179	  assert.equal(trades(db).total.trades, 0);
   180	});
   181	
   182	test('DEX leg fails after MEXC sold: buys back at market, alerts one-sided', async () => {
   183	  const { engine, db, alerts, calls, bal } = setup({ dexOk: false });
   184	  await engine.tick();
   185	  assert.ok(calls.includes('limit BUY 20.00 @ 11.435')); // close: aggressive limit 2% over ask 11.21
   186	  const row = trades(db);
   187	  assert.equal(row.total.failed, 1);
   188	  assert.ok(alerts.some((a) => a.startsWith('⚠️ ONE-SIDED FILL LINK')));
   189	  assert.ok(Math.abs(bal.walletToken.LINK - 100) < 1e-9); // wallet untouched
   190	  assert.ok(Math.abs(bal.mexc.LINK - 100 + 20 * 0.0005) < 1e-9); // flat again except the fee
   191	});
   192	
   193	test('MEXC partial fill: rest is cancelled and closed at market', async () => {
   194	  const { engine, calls } = setup({ mexcFillRatio: 0.5 });
   195	  await engine.tick();
   196	  assert.ok(calls.includes('cancel 1'));
   197	  assert.ok(calls.includes('market SELL 10.00'));
   198	});
   199	
   200	test('simulation failure: nothing is sent, approval gas is still booked', async () => {
   201	  const { engine, db, calls } = setup({ simulateThrows: true, approvalNeeded: true });
   202	  await engine.tick();
   203	  assert.ok(calls[0].startsWith('approve 200000000')); // exact amount: 200 USDC, never MaxUint256
   204	  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
   205	  const s = trades(db);
   206	  assert.equal(s.total.trades, 0); // approval rows are not trades
   207	  assert.ok(s.total.pnl < 0 && s.total.gas > 0);
   208	});
   209	
   210	test('gas above MAX_GAS_GWEI: no quotes at all', async () => {
   211	  const { engine, calls } = setup({ gasGwei: 50n });
   212	  await engine.tick();
   213	  assert.deepEqual(calls, []);
   214	});
   215	
   216	test('kill switch: paused bot does nothing', async () => {
   217	  const { engine, risk, calls } = setup({});
   218	  risk.pause('Telegram /stop');
   219	  await engine.tick();
   220	  assert.deepEqual(calls, []);
   221	});
   222	
   223	test('3 failed trades in a row pause trading', async () => {
   224	  const { engine, risk, alerts } = setup({ dexOk: false });
   225	  await engine.tick();
   226	  await engine.tick();
   227	  await engine.tick();
   228	  assert.equal(risk.paused, true);
   229	  assert.ok(alerts.some((a) => a.includes('3 failed trades in a row')));
   230	  const before = alerts.length;
   231	  await engine.tick();
   232	  assert.equal(alerts.length, before); // stays stopped
   233	});
   234	
   235	test('paper mode: records the trade, sends nothing real', async () => {
   236	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   237	  await engine.tick();
   238	  assert.deepEqual(calls, []);
   239	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   240	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER LINK')));
   241	});
   242	
   243	test('DEX outcome unknown: NO automatic unwind, trading paused', async () => {
   244	  const { engine, risk, calls, alerts } = setup({ dexUnknown: true });
   245	  await engine.tick();
   246	  assert.ok(!calls.some((c) => c.startsWith('market') || c.startsWith('limit BUY')));
   247	  assert.equal(risk.paused, true);
   248	  assert.ok(alerts.some((a) => a.includes('outcome UNKNOWN')));
   249	});
   250	
   251	test('unwind SELL that only partly fills is detected (not assumed flat)', async () => {
   252	  const { engine, risk, calls, alerts } = setup({ mexcFillRatio: 0.5, marketFillRatio: 0.5 });
   253	  await engine.tick();
   254	  assert.ok(calls.includes('market SELL 10.00'));
   255	  assert.equal(risk.paused, true);
   256	  assert.ok(alerts.some((a) => a.includes('market close FAILED') && a.includes('only filled')));
   257	});
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
     9	import { loadConfig, validateConfig } from '../src/config.js';
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
   138	test('Telegram only obeys the configured chat', async () => {
   139	  const sent: string[] = [];
   140	  const fetchFn = (async (_u: string, o: { body: string }) => {
   141	    sent.push(JSON.parse(o.body).text);
   142	    return new Response(JSON.stringify({ ok: true, result: {} }));
   143	  }) as unknown as typeof fetch;
   144	  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn);
   145	  let stopped = false;
   146	  const handlers = { '/stop': () => ((stopped = true), 'stopped') };
   147	  await tg.handle({ message: { chat: { id: 999 }, text: '/stop' } }, handlers);
   148	  assert.equal(stopped, false);
   149	  await tg.handle({ message: { chat: { id: 777 }, text: '/stop@MyBot' } }, handlers);
   150	  assert.equal(stopped, true);
   151	  assert.deepEqual(sent, ['stopped']);
   152	});
   153	
   154	test('Risk: loss limit, fail streak, trade limit, kill switch', () => {
   155	  const db = new Db(':memory:');
   156	  const now = Date.UTC(2026, 10, 20, 6);
   157	  const risk = new Risk(db, 'live', { maxTradesPerDay: 3, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
   158	  const row = (pnl: number, status: 'ok' | 'one_sided') =>
   159	    db.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: pnl, status, dex_tx: null, cex_order_id: null, note: null });
   160	
   161	  assert.equal(risk.blockReason(), null);
   162	  row(-10, 'one_sided');
   163	  assert.deepEqual(risk.afterTrade('one_sided'), []);
   164	  row(-10, 'one_sided');
   165	  risk.afterTrade('one_sided');
   166	  row(-5, 'one_sided');
   167	  const ev = risk.afterTrade('one_sided');
   168	  assert.ok(ev.some((e) => e.kind === 'fail_streak'));
   169	  assert.match(risk.blockReason()!, /paused/);
   170	
   171	  risk.resume();
   172	  assert.match(risk.blockReason()!, /trade limit/); // 3 trades today
   173	
   174	  const db2 = new Db(':memory:');
   175	  const r2 = new Risk(db2, 'live', { maxTradesPerDay: 20, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
   176	  db2.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: -31, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
   177	  assert.ok(r2.afterTrade('ok').some((e) => e.kind === 'loss_limit'));
   178	  assert.match(r2.blockReason()!, /loss limit/);
   179	  r2.resume();
   180	  assert.match(r2.blockReason()!, /daily loss limit/); // /start cannot override today's loss limit
   181	
   182	  r2.pause('Telegram /stop');
   183	  assert.match(r2.blockReason()!, /Telegram \/stop/);
   184	});
   185	
   186	test('ethNetwork finds the Ethereum entry in MEXC coin config', () => {
   187	  const n = ethNetwork({
   188	    coin: 'LINK',
   189	    networkList: [
   190	      { coin: 'LINK', network: 'BNB Smart Chain(BEP20)', netWork: 'BSC', contract: '0xbsc', depositEnable: true, withdrawEnable: true },
   191	      { coin: 'LINK', network: 'Ethereum(ERC20)', netWork: 'ETH', contract: '0xeth', depositEnable: true, withdrawEnable: false },
   192	    ],
   193	  });
   194	  assert.equal(n?.contract, '0xeth');
   195	});
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
    34	test('evaluateDexBuy: every cost is subtracted', () => {
    35	  // Bought 20 tokens for $200 on DEX (min 19.9); MEXC bid 11 -> sell 20 for $220.
    36	  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.9, bids: [[11, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
    37	  const fee = 220 * 0.0005;
    38	  const slip = 220 * 0.002 + 0.1 * 11;
    39	  close(o.net, 220 - fee - 200 - 3 - slip - 2);
    40	  assert.equal(o.cexQty, 20);
    41	  close(o.cexLimitPrice, 11 * 0.998);
    42	  close(o.buyPrice, 10);
    43	  close(o.sellPrice, 11);
    44	});
    45	
    46	test('evaluateDexBuy: dust below the MEXC step is kept as inventory, not counted as profit', () => {
    47	  const o = evaluateDexBuy({ sizeUsd: 100, tokensOut: 10.005, tokensMin: 10.005, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 0, costs: { ...costs, takerFee: 0, cexSlippageBps: 0, safetyMarginUsd: 0 } })!;
    48	  assert.equal(o.cexQty, 10);
    49	  close(o.net, 0.05, 1e-9); // 100 proceeds - (100 - 0.05 dust value)
    50	});
    51	
    52	test('planCexBuy + evaluateCexBuy: fee is paid in tokens, so fewer tokens are sold on DEX', () => {
    53	  const plan = planCexBuy({ sizeUsd: 200, asks: [[10, 100]], qtyStep: 0.01, takerFee: 0.0005 })!;
    54	  assert.equal(plan.qty, 20);
    55	  close(plan.costUsd, 200);
    56	  close(plan.tokensToSell, 20 * 0.9995);
    57	  const o = evaluateCexBuy({ plan, usdcOut: 230, usdcMin: 229, gasUsd: 3, costs });
    58	  close(o.net, 230 - 200 - 3 - (200 * 0.002 + 1) - 2);
    59	  assert.deepEqual(planCexBuyQty([[10, 100]], 20, 0.0005), plan);
    60	});
    61	
    62	test('no opportunity when prices are equal', () => {
    63	  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.94, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
    64	  assert.ok(o.net < 0);
    65	});
    66	
    67	test('gasUsd', () => {
    68	  close(gasUsd(200_000n, 20_000_000_000n, 2000), 8); // 200k gas * 20 gwei = 0.004 ETH
    69	});
    70	
    71	test('unwindPlan covers every one-sided case', () => {
    72	  assert.equal(unwindPlan('DEX_BUY', true, 10, 10, 0.0005, 0.01), null); // both filled
    73	  assert.deepEqual(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.side, 'SELL');
    74	  assert.equal(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.qty, 6);
    75	  assert.deepEqual(unwindPlan('DEX_BUY', false, 10, 10, 0.0005, 0.01)?.side, 'BUY');
    76	  assert.equal(unwindPlan('DEX_BUY', false, 10, 0, 0.0005, 0.01), null); // nothing happened
    77	  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.qty, 3);
    78	  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.side, 'BUY');
    79	  const u = unwindPlan('CEX_BUY', false, 10, 10, 0.0005, 0.01)!;
    80	  assert.equal(u.side, 'SELL');
    81	  assert.equal(u.qty, 9.99); // sell only what we received after the fee
    82	});
    83	
    84	test('util conversions', () => {
    85	  assert.equal(floorToStep(1.23456, 0.01), 1.23);
    86	  assert.equal(floorToStep(0.3, 0.1), 0.3);
    87	  assert.equal(toUnits(123.456789, 6), 123456789n);
    88	  assert.equal(toUnits(1, 18), 10n ** 18n);
    89	  assert.equal(toFloat(1_500_000n, 6), 1.5);
    90	  assert.equal(toFloat(5n, 18), 5e-18);
    91	  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 18, 30)), '2026-01-02'); // 00:30 in Dhaka
    92	  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 17, 59)), '2026-01-01');
    93	});
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
    41	  process.env.RPC_URL = 'http://localhost';
    42	  process.env.PRIVATE_KEY = '0x' + '22'.repeat(32);
    43	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    44	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    45	  const cfg = loadConfig();
    46	  const db = o.db ?? new Db(':memory:');
    47	  const risk = new Risk(db, cfg.mode, cfg);
    48	  const alerts: string[] = [];
    49	  const calls: string[] = [];
    50	  const dexPrice = o.dexPrice ?? 1.15;
    51	  const state = {
    52	    mexc: { USDT: 1000, XYZ: 0 } as Record<string, number>,
    53	    wallet: { [XYZ]: 0n, [USDC]: 0n } as Record<string, bigint>,
    54	    withdrawStatus: o.withdrawStatus ?? 4,
    55	    dexPrice,
    56	    withdrawals: [] as { id: string; status: number; amount: string; withdrawOrderId?: string }[],
    57	  };
    58	  const orders = new Map<string, Order>();
    59	  let lastQuote: QuoteRequest | null = null;
    60	
    61	  const mexc: TransferMexc = {
    62	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD')],
    63	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }],
    64	    coinConfigs: async () => [coin('XYZ', XYZ), coin('BAD', '0x2222222222222222222222222222222222222222', true, false)],
    65	    bookTickers: async () => new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }]]),
    66	    depth: async () => ({ bids: [[0.999, 1e6]], asks: [[1.0, 1e6]], ts: Date.now() }),
    67	    balances: async () => ({ ...state.mexc }),
    68	    limitOrder: async (_s, side, q, p) => {
    69	      calls.push(`limit ${side} ${q} @ ${p}`);
    70	      const qty = Number(q);
    71	      state.mexc.USDT -= qty * 1.0;
    72	      state.mexc.XYZ += qty * (1 - cfg.mexcTakerFee);
    73	      orders.set('b1', { orderId: 'b1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(qty * 1.0), origQty: q, price: p, side });
    74	      return { orderId: 'b1' };
    75	    },
    76	    marketSell: async (_s, q) => {
    77	      calls.push(`market SELL ${q}`);
    78	      state.mexc.XYZ -= Number(q);
    79	      orders.set('s1', { orderId: 's1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(Number(q) * 0.999), origQty: q, price: '0', side: 'SELL' });
    80	      return { orderId: 's1' };
    81	    },
    82	    getOrder: async (_s, id) => orders.get(id)!,
    83	    getOrderByClientId: async () => null,
    84	    cancelOrder: async (_s, id) => orders.get(id)!,
    85	    withdraw: async (p) => {
    86	      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
    87	      if (o.withdrawThrows) throw new Error('no withdraw permission');
    88	      state.mexc.XYZ -= Number(p.amount);
    89	      state.withdrawals.push({ id: 'w1', status: 4, amount: p.amount, withdrawOrderId: p.withdrawOrderId });
    90	      if (o.withdrawAmbiguous) throw new AmbiguousRequestError('timeout');
    91	      return 'w1';
    92	    },
    93	    findWithdraw: async (_c, _since, ref) => {
    94	      const w = state.withdrawals.find((x) => (ref.id && x.id === ref.id) || (ref.withdrawOrderId && x.withdrawOrderId === ref.withdrawOrderId));
    95	      return w ? { ...w, status: state.withdrawStatus } : null;
    96	    },
    97	  };
    98	
    99	  const quote = (r: QuoteRequest, firm: boolean): Quote => {
   100	    const out = (r.sellAmount * BigInt(Math.round(state.dexPrice * 1e6))) / 10n ** 18n; // token(18) -> USDC(6)
   101	    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
   102	  };
   103	
   104	  const chain: TransferChain = {
   105	    address: '0xMyWallet',
   106	    gas: async () => ({ baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI }),
   107	    decimals: async () => 18,
   108	    tokenBalance: async (t) => state.wallet[t] ?? 0n,
   109	    approveExact: async (_t, s, amount) => {
   110	      calls.push(`approve ${s} ${amount}`);
   111	      return { ok: true, gasCostWei: 60_000n * 10n * GWEI };
   112	    },
   113	    simulate: async () => (calls.push('simulate'), 150_000n),
   114	    send: async () => {
   115	      calls.push('send');
   116	      if (o.sendUnknown) return { ok: false, unknown: true, hash: '0xhash', gasCostWei: 0n, reason: 'unknown' };
   117	      if (o.sendFails) return { ok: false, hash: '0xhash', gasCostWei: 0n, reason: 'reverted' };
   118	      const r = lastQuote!;
   119	      state.wallet[XYZ] -= r.sellAmount;
   120	      state.wallet[USDC] += quote(r, true).buyAmount;
   121	      return { ok: true, hash: '0xhash', gasCostWei: 150_000n * 10n * GWEI };
   122	    },
   123	  };
   124	
   125	  const engine = new TransferEngine({
   126	    cfg, mexc, chain, db, risk,
   127	    tg: { send: async (t) => void alerts.push(t) },
   128	    agg: { name: '0x', price: async (r) => quote(r, false), quote: async (r) => ((lastQuote = r), quote(r, true)) },
   129	    dexPricesFn: async () => new Map([[XYZ, { price: dexPrice, tvl: 1e6 }]]),
   130	    sleep: async () => {},
   131	    now: o.now,
   132	  });
   133	  const arrive = (tokens: number) => (state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n);
   134	  return { engine, db, risk, alerts, calls, state, arrive, cfg };
   135	}
   136	
   137	test('loadUniverse keeps only ERC20 tokens with deposit AND withdraw open', async () => {
   138	  const { engine } = setup();
   139	  await engine.refreshUniverse(true);
   140	  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']); // BAD has withdrawals suspended
   141	  assert.equal(engine.universe[0].address, XYZ);
   142	  assert.equal(engine.universe[0].netWork, 'ETH');
   143	  assert.equal(engine.universe[0].withdrawFee, 1);
   144	});
   145	
   146	test('findGaps: filters TVL, too-small and absurd gaps, sorts biggest first', () => {
   147	  const tok = (base: string, address: string): ScanToken => ({ base, symbol: `${base}USDT`, address, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6 });
   148	  const tokens = [tok('A', '0xa'), tok('B', '0xb'), tok('C', '0xc'), tok('D', '0xd'), tok('E', '0xe')];
   149	  const tickers = new Map(['A', 'B', 'C', 'D', 'E'].map((b) => [`${b}USDT`, { bid: 0.99, ask: 1 }]));
   150	  const dex = new Map([
   151	    ['0xa', { price: 1.05, tvl: 1e6 }], // 5%
   152	    ['0xb', { price: 1.1, tvl: 1e6 }], // 10%
   153	    ['0xc', { price: 1.1, tvl: 1000 }], // thin pool
   154	    ['0xd', { price: 1.01, tvl: 1e6 }], // 1% < min
   155	    ['0xe', { price: 3, tvl: 1e6 }], // 200%: broken / different token
   156	  ]);
   157	  const g = findGaps(tokens, tickers, dex, { minTvlUsd: 200_000, minGapPct: 3 });
   158	  assert.deepEqual(g.map((x) => x.token.base), ['B', 'A']);
   159	});
   160	
   161	test('evaluateTransfer subtracts withdraw fee, drift reserve and all costs', () => {
   162	  const plan = planCexBuy({ sizeUsd: 200, asks: [[1, 1e6]], qtyStep: 0.01, takerFee: 0.0005 })!;
   163	  const ev = evaluateTransfer({ plan, withdrawFeeTokens: 1, usdcOut: 228.7, usdcMin: 228.5, gasUsd: 4, driftBps: 150, costs: { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 } });
   164	  assert.ok(Math.abs(ev.arriving - (200 * 0.9995 - 1)) < 1e-9);
   165	  const expected = 228.7 - 200 - 4 - (0.4 + 0.2) - 228.7 * 0.015 - 2;
   166	  assert.ok(Math.abs(ev.net - expected) < 1e-9);
   167	});
   168	
   169	test('full cycle: buy on MEXC -> withdraw to own wallet -> wait -> sell on DEX -> PnL', async () => {
   170	  const { engine, db, calls, alerts, arrive } = setup();
   171	  await engine.tick(); // finds gap, buys, withdraws
   172	  assert.equal(calls[0], 'limit BUY 200.00 @ 1.0020');
   173	  assert.equal(calls[1], 'withdraw 199.90 XYZ ETH -> 0xMyWallet'); // only ever our own wallet
   174	  assert.equal(db.openTransfers()[0].status, 'withdrawing');
   175	  assert.ok(alerts.some((a) => a.startsWith('📤 TRANSFER #1 XYZ')));
   176	
   177	  await engine.tick(); // still on its way: nothing new is bought meanwhile
   178	  assert.equal(calls.filter((c) => c.startsWith('limit')).length, 1);
   179	
   180	  arrive(198.9); // 199.9 - 1 withdraw fee
   181	  await engine.tick();
   182	  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
   183	  assert.ok(calls.includes('simulate') && calls.includes('send'));
   184	  assert.ok(!db.openTransfers().some((t) => t.id === 1)); // #1 done (a new one may start: gap still open)
   185	
   186	  const s = db.statsSince(0, 'live');
   187	  assert.equal(s.total.trades, 1);
   188	  assert.equal(s.total.failed, 0);
   189	  const usdcOut = Math.floor(198.9 * 1.15 * 1e6) / 1e6;
   190	  const gas = (0.0006 + 0.0015) * 2000;
   191	  assert.ok(Math.abs(s.total.pnl - (usdcOut - 200 - gas)) < 1e-6, String(s.total.pnl));
   192	  assert.ok(alerts.some((a) => a.includes('TRANSFER #1 XYZ done') && a.includes('Net PnL')));
   193	});
   194	
   195	test('restart while withdrawing: a new engine resumes the same transfer', async () => {
   196	  const first = setup();
   197	  await first.engine.tick();
   198	  // "restart": new engine, same database and balances
   199	  const second = setup({ db: first.db });
   200	  Object.assign(second.state, first.state);
   201	  second.state.wallet[XYZ] = BigInt(198.9e6) * 10n ** 12n;
   202	  await second.engine.tick();
   203	  assert.ok(!first.db.openTransfers().some((t) => t.id === 1));
   204	  assert.equal(first.db.statsSince(0, 'live').total.trades, 1);
   205	});
   206	
   207	test('withdraw request times out: never re-sent, found later by withdrawOrderId', async () => {
   208	  const { engine, db, calls, arrive } = setup({ withdrawAmbiguous: true });
   209	  await engine.tick();
   210	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   211	  await engine.tick(); // looks it up instead of withdrawing again
   212	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   213	  assert.equal(db.getTransfer(1)!.withdraw_id, 'w1');
   214	  arrive(198.9);
   215	  await engine.tick();
   216	  assert.equal(db.getTransfer(1)!.status, 'done');
   217	});
   218	
   219	test('price fell during the withdrawal: holds instead of selling at a big loss; /sell overrides', async () => {
   220	  let t = Date.UTC(2026, 10, 20, 6);
   221	  const { engine, db, calls, alerts, arrive, state } = setup({ now: () => t });
   222	  await engine.tick();
   223	  state.dexPrice = 0.9; // 10% below the MEXC buy price
   224	  arrive(198.9);
   225	  await engine.tick();
   226	  assert.ok(!calls.includes('send'));
   227	  assert.equal(db.getTransfer(1)!.status, 'selling');
   228	  assert.ok(alerts.some((a) => a.startsWith('✋ TRANSFER #1 XYZ') && a.includes('/sell 1')));
   229	  t += 6 * 60_000;
   230	  await engine.tick();
   231	  assert.ok(!calls.includes('send')); // still holding
   232	  assert.match(engine.forceSell(1), /selling on the next scan/);
   233	  await engine.tick();
   234	  assert.ok(calls.includes('send'));
   235	  assert.equal(db.getTransfer(1)!.status, 'done');
   236	});
   237	
   238	test('failed DEX sales back off, then stop retrying (no gas burn loop)', async () => {
   239	  let t = Date.UTC(2026, 10, 20, 6);
   240	  const { engine, db, calls, alerts, arrive } = setup({ sendFails: true, now: () => t });
   241	  await engine.tick();
   242	  arrive(198.9);
   243	  await engine.tick(); // attempt 1
   244	  await engine.tick(); // inside backoff: no attempt
   245	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   246	  for (const wait of [2, 10, 30]) {
   247	    t += wait * 60_000 + 1;
   248	    await engine.tick();
   249	  }
   250	  assert.equal(calls.filter((c) => c === 'send').length, 4);
   251	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   252	  t += 24 * 3600_000;
   253	  await engine.tick();
   254	  assert.equal(calls.filter((c) => c === 'send').length, 4); // no more automatic tries
   255	  assert.ok(alerts.some((a) => a.includes('Automatic retries STOPPED')));
   256	  assert.match(engine.clear(1), /closed manually/);
   257	});
   258	
   259	test('swap outcome unknown: stuck + paused, never retried automatically', async () => {
   260	  const { engine, db, risk, calls, arrive } = setup({ sendUnknown: true });
   261	  await engine.tick();
   262	  arrive(198.9);
   263	  await engine.tick();
   264	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   265	  assert.equal(risk.paused, true);
   266	  await engine.tick();
   267	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   268	});
   269	
   270	test('withdrawal never arrives: after 2x timeout it stops blocking new trades but is still watched', async () => {
   271	  let t = Date.UTC(2026, 10, 20, 6);
   272	  const { engine, db, calls, alerts, cfg } = setup({ now: () => t });
   273	  await engine.tick();
   274	  t += (cfg.transferTimeoutMin + 1) * 60_000;
   275	  await engine.tick();
   276	  assert.ok(alerts.some((a) => a.includes('not in wallet after')));
   277	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1); // still blocking
   278	  t += cfg.transferTimeoutMin * 60_000;
   279	  await engine.tick(); // gives up blocking
   280	  assert.equal(db.getTransfer(1)!.alerted_timeout, 2);
   281	  assert.equal(db.getTransfer(1)!.status, 'withdrawing'); // still watched
   282	  await engine.tick();
   283	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 2); // new trade allowed
   284	});
   285	
   286	test('withdraw rejected: sells the tokens back on MEXC and records a failure', async () => {
   287	  const { engine, db, calls, alerts } = setup({ withdrawThrows: true });
   288	  await engine.tick();
   289	  assert.ok(calls.includes('market SELL 199.90'));
   290	  assert.equal(db.openTransfers().length, 0);
   291	  assert.equal(db.statsSince(0, 'live').total.failed, 1);
   292	  assert.ok(alerts.some((a) => a.includes('withdraw rejected')));
   293	});
   294	
   295	test('withdrawal FAILED on MEXC side: sells back on MEXC', async () => {
   296	  const { engine, db, calls, state } = setup();
   297	  await engine.tick();
   298	  state.withdrawStatus = 8;
   299	  state.mexc.XYZ += 199.9; // funds returned to the MEXC account
   300	  await engine.tick();
   301	  assert.ok(calls.includes('market SELL 199.90'));
   302	  assert.ok(!db.openTransfers().some((t) => t.id === 1));
   303	});
   304	
   305	test('gap too small after exact costs: nothing happens', async () => {
   306	  const { engine, calls } = setup({ dexPrice: 1.05 }); // 5% gap, but drift+gas+fees+min $15 eat it
   307	  await engine.tick();
   308	  assert.deepEqual(calls, []);
   309	});
   310	
   311	test('paused bot does not open new transfers', async () => {
   312	  const { engine, risk, calls } = setup();
   313	  risk.pause('Telegram /stop');
   314	  await engine.tick();
   315	  assert.deepEqual(calls, []);
   316	});
   317	
   318	test('paper mode records the opportunity without orders or withdrawals', async () => {
   319	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   320	  await engine.tick();
   321	  assert.deepEqual(calls, []);
   322	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   323	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER TRANSFER XYZ')));
   324	});
   325	
   326	test('loadUniverse respects WATCHLIST', async () => {
   327	  const fake = {
   328	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC')],
   329	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }, { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' }],
   330	    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', '0x3333333333333333333333333333333333333333')],
   331	  };
   332	  const u = await loadUniverse(fake as never, { minVolumeUsd: 1, only: ['ABC'] });
   333	  assert.deepEqual(u.map((t) => t.base), ['ABC']);
   334	});
```

