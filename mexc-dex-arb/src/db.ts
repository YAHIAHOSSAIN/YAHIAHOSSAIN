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
  requoted_net?: number | null;
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

/** One evaluated candidate (paper and live), written for EVERY candidate, traded or not. */
export interface OpportunityRow {
  ts: number;
  chain: string;
  token: string;
  direction: string;
  size_usd: number | null;
  mexc_bid: number | null;
  mexc_ask: number | null;
  book_age_ms: number | null;
  aggregator: string | null;
  dex_out: number | null;
  dex_min_out: number | null;
  usdc_usdt: number | null;
  gross_bps: number | null;
  fee_bps: number | null;
  gas_usd: number | null;
  net_usd: number | null;
  hurdle_usd: number | null;
  decision: 'trade' | 'below_hurdle' | 'inventory' | 'rule' | 'gas' | 'rate_limited' | 'paused';
  reason: string | null;
}

/** One executed leg of a live trade. */
export interface LegRow {
  trade_id: number;
  leg: 'dex' | 'mexc' | 'unwind';
  quoted_price: number | null;
  filled_price: number | null;
  slippage_bps: number | null;
  min_out: number | null;
  real_out: number | null;
  gas_used: string | null;
  gas_price: string | null;
  l1_fee: string | null;
  executed_qty: number | null;
  avg_price: number | null;
  fee: number | null;
  fee_asset: string | null;
  latency_quote_ms: number | null;
  latency_sign_ms: number | null;
  latency_inclusion_ms: number | null;
  latency_mexc_ack_ms: number | null;
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
    // trades.cids: JSON array of every MEXC client order id used by the trade (entry, closes), written BEFORE placing.
    const tcols = new Set((this.db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map((c) => c.name));
    if (!tcols.has('cids')) this.db.exec('ALTER TABLE trades ADD COLUMN cids TEXT');
    // trades.requoted_net: paper mode books the net after a simulated latency + re-quote, not the first quote.
    if (!tcols.has('requoted_net')) this.db.exec('ALTER TABLE trades ADD COLUMN requoted_net REAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, chain TEXT, token TEXT NOT NULL, direction TEXT,
        size_usd REAL, mexc_bid REAL, mexc_ask REAL, book_age_ms INTEGER, aggregator TEXT, dex_out REAL, dex_min_out REAL,
        usdc_usdt REAL, gross_bps REAL, fee_bps REAL, gas_usd REAL, net_usd REAL, hurdle_usd REAL,
        decision TEXT NOT NULL, reason TEXT
      );
      CREATE INDEX IF NOT EXISTS opp_token_ts ON opportunities(token, ts);
      CREATE INDEX IF NOT EXISTS opp_decision_ts ON opportunities(decision, ts);
      CREATE INDEX IF NOT EXISTS opp_ts ON opportunities(ts);
      CREATE TABLE IF NOT EXISTS legs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, trade_id INTEGER NOT NULL, leg TEXT NOT NULL,
        quoted_price REAL, filled_price REAL, slippage_bps REAL, min_out REAL, real_out REAL,
        gas_used TEXT, gas_price TEXT, l1_fee TEXT, executed_qty REAL, avg_price REAL, fee REAL, fee_asset TEXT,
        latency_quote_ms INTEGER, latency_sign_ms INTEGER, latency_inclusion_ms INTEGER, latency_mexc_ack_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS rebalance_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, token TEXT NOT NULL, side TEXT NOT NULL,
        asset TEXT NOT NULL, amount REAL NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', closed_ts INTEGER
      );
      CREATE TABLE IF NOT EXISTS inventory_snapshots (
        ts INTEGER NOT NULL, token TEXT NOT NULL, wallet_usd REAL, mexc_usd REAL
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

  appendCid(tradeId: number, cid: string): void {
    const row = this.db.prepare('SELECT cids FROM trades WHERE id = ?').get(tradeId) as { cids: string | null } | undefined;
    const list = row?.cids ? (JSON.parse(row.cids) as string[]) : [];
    list.push(cid);
    this.db.prepare('UPDATE trades SET cids = ? WHERE id = ?').run(JSON.stringify(list), tradeId);
  }

  cidsOf(tradeId: number): string[] {
    const row = this.db.prepare('SELECT cids FROM trades WHERE id = ?').get(tradeId) as { cids: string | null } | undefined;
    return row?.cids ? (JSON.parse(row.cids) as string[]) : [];
  }

  insertOpportunities(rows: OpportunityRow[]): void {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const stmt = this.db.prepare(`INSERT INTO opportunities (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`);
    this.db.transaction((rs: OpportunityRow[]) => rs.forEach((r) => stmt.run(r)))(rows);
  }

  pruneOpportunities(olderThanTs: number): number {
    return Number(this.db.prepare('DELETE FROM opportunities WHERE ts < ?').run(olderThanTs).changes);
  }

  insertLeg(r: LegRow): void {
    const cols = Object.keys(r);
    this.db.prepare(`INSERT INTO legs (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(r);
  }

  openTicket(t: { token: string; side: string; asset: string; amount: number; direction: string }): number {
    return Number(
      this.db
        .prepare(`INSERT INTO rebalance_tickets (ts, token, side, asset, amount, direction) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(Date.now(), t.token, t.side, t.asset, t.amount, t.direction).lastInsertRowid,
    );
  }

  openTickets(): { id: number; ts: number; token: string; side: string; asset: string; amount: number; direction: string }[] {
    return this.db.prepare(`SELECT id, ts, token, side, asset, amount, direction FROM rebalance_tickets WHERE status = 'open' ORDER BY id`).all() as never;
  }

  closeTickets(token: string, side: string): void {
    this.db.prepare(`UPDATE rebalance_tickets SET status = 'closed', closed_ts = ? WHERE token = ? AND side = ? AND status = 'open'`).run(Date.now(), token, side);
  }

  insertInventorySnapshot(rows: { ts: number; token: string; wallet_usd: number; mexc_usd: number }[]): void {
    const stmt = this.db.prepare('INSERT INTO inventory_snapshots (ts, token, wallet_usd, mexc_usd) VALUES (@ts, @token, @wallet_usd, @mexc_usd)');
    this.db.transaction((rs: typeof rows) => rs.forEach((r) => stmt.run(r)))(rows);
  }

  /** Raw access for read-only reports. */
  all<T>(sql: string, ...args: unknown[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }

  /** Trades whose real PnL is unknown (one-sided / recovered) and not yet set with /resolve. */
  unresolvedTrades(): (TradeRow & { id: number })[] {
    return this.db
      .prepare(`SELECT * FROM trades WHERE status = 'one_sided' AND (note IS NULL OR note NOT LIKE '%pnl resolved%') AND note LIKE '%pnl unknown%' ORDER BY id`)
      .all() as (TradeRow & { id: number })[];
  }

  tradeByDexTx(hash: string): (TradeRow & { id: number }) | undefined {
    return this.db.prepare('SELECT * FROM trades WHERE dex_tx = ? ORDER BY id DESC LIMIT 1').get(hash) as (TradeRow & { id: number }) | undefined;
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
