// SQLite storage: trades and persistent bot state (pause flag, failure streak, ...).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// 'approval' = gas spent on an approval for a trade that was then skipped (a real cost, not a trade).
// 'executing' = written BEFORE the legs fire; if the bot dies mid-trade, startup finds it and stays paused.
export type TradeStatus = 'ok' | 'one_sided' | 'dex_failed' | 'cex_failed' | 'paper' | 'approval' | 'executing';

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
  alerted_timeout: number; // 0 none, 1 slow alert sent, 2 given up waiting (no longer blocks new trades)
  note: string | null;
  withdraw_fee: number; // tokens, fixed at decision time
  next_try: number; // ms timestamp: no sell attempt before this (backoff)
  force_sell: number; // 1 = /sell command: sell even below the loss floor
  hold_alerted: number;
  sell_tx: string | null; // DEX sale tx hash, written before broadcast (crash safety)
}

const TRANSFER_MIGRATIONS = [
  'ALTER TABLE transfers ADD COLUMN withdraw_fee REAL NOT NULL DEFAULT 0',
  'ALTER TABLE transfers ADD COLUMN next_try INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE transfers ADD COLUMN force_sell INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE transfers ADD COLUMN hold_alerted INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE transfers ADD COLUMN sell_tx TEXT',
];

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
    const cols = new Set((this.db.prepare('PRAGMA table_info(transfers)').all() as { name: string }[]).map((c) => c.name));
    for (const m of TRANSFER_MIGRATIONS) {
      const col = m.split(' ')[5];
      if (!cols.has(col)) this.db.exec(m);
    }
  }

  insertTrade(t: TradeRow): number {
    return Number(this.db
      .prepare(
        `INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net,
          cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note)
         VALUES (@ts, @day, @mode, @symbol, @direction, @size_usd, @qty, @buy_price, @sell_price, @expected_net,
          @cex_fee_usd, @gas_usd, @pnl_usd, @status, @dex_tx, @cex_order_id, @note)`,
      )
      .run(t).lastInsertRowid);
  }

  updateTrade(id: number, fields: Partial<TradeRow>): void {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    this.db.prepare(`UPDATE trades SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  }

  /** Trades that were in flight when the bot stopped. */
  executingTrades(): (TradeRow & { id: number })[] {
    return this.db.prepare(`SELECT * FROM trades WHERE status = 'executing' ORDER BY id`).all() as (TradeRow & { id: number })[];
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

  /** Transfers the bot still works on automatically ('stuck' waits for a human: /sell or /clear). */
  openTransfers(): TransferRow[] {
    return this.db.prepare(`SELECT * FROM transfers WHERE status IN ('buying','withdrawing','selling') ORDER BY id`).all() as TransferRow[];
  }

  /** Transfers that hold back new trades (open, and not given up on). */
  blockingTransfers(): TransferRow[] {
    return this.openTransfers().filter((t) => t.alerted_timeout < 2);
  }

  stuckTransfers(): TransferRow[] {
    return this.db.prepare(`SELECT * FROM transfers WHERE status = 'stuck' ORDER BY id`).all() as TransferRow[];
  }

  getTransfer(id: number): TransferRow | undefined {
    return this.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as TransferRow | undefined;
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
