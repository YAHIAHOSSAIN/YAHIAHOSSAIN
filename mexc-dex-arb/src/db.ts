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
