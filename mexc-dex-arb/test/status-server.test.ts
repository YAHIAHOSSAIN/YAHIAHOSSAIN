// Phase 6: status-server readers + /api/status JSON — depth rejects, public
// config (DEX-ARB badge OFF by default), DEX-ARB stats, trade aggregator /
// sizing columns, and the public-safety whitelist (no tx hashes, order ids
// or wallet addresses ever leave the server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status6-'));
const paperDbPath = path.join(dir, 'paper.sqlite');
const liveDbPath = path.join(dir, 'live.sqlite');

function seedPaper() {
  const db = new Database(paperDbPath);
  db.exec(`
    CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
      symbol TEXT NOT NULL, direction TEXT NOT NULL, size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
      expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL, status TEXT NOT NULL,
      dex_tx TEXT, cex_order_id TEXT, note TEXT, requoted_net REAL, aggregator TEXT, pool_tvl_usd REAL, safe_size_usd REAL);
    CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, chain TEXT, token TEXT NOT NULL,
      direction TEXT, size_usd REAL, mexc_bid REAL, mexc_ask REAL, book_age_ms INTEGER, aggregator TEXT, dex_out REAL,
      dex_min_out REAL, usdc_usdt REAL, gross_bps REAL, fee_bps REAL, gas_usd REAL, net_usd REAL, hurdle_usd REAL,
      decision TEXT NOT NULL, reason TEXT);
    CREATE TABLE depth_rejects (ts INTEGER NOT NULL, chain TEXT NOT NULL, total INTEGER NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, updated INTEGER NOT NULL,
      base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL, net_work TEXT NOT NULL,
      qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL, status TEXT NOT NULL, buy_qty REAL, cost_usd REAL,
      buy_order_id TEXT, withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT, usdc_out REAL,
      gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL, sell_attempts INTEGER NOT NULL DEFAULT 0,
      alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT);
    CREATE TABLE inventory_snapshots (ts INTEGER NOT NULL, token TEXT NOT NULL, wallet_usd REAL, mexc_usd REAL);
  `);
  const now = Date.now();
  db.prepare(`INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net, cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note, aggregator, pool_tvl_usd, safe_size_usd)
    VALUES (?, ?, 'paper', 'XYZ', 'TRANSFER', 300, 10, 1, 1.15, 20, 1, 4, 20, 'paper', '0xSECRET', 'cid-secret', 'gap 15%', 'kyber', 300000, 1050)`).run(now, '2026-11-23');
  // Paper trade WITH a re-quoted net (Booked must stay the re-quoted value).
  // Earlier ts, so the XYZ row stays recent[0] for the Phase 6 assertions.
  db.prepare(`INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net, cex_fee_usd, gas_usd, pnl_usd, status, note, requoted_net, aggregator, pool_tvl_usd, safe_size_usd)
    VALUES (?, '2026-11-23', 'paper', 'BGB', 'TRANSFER', 300, 10, 1, 1.15, 20, 1, 4, 2.5, 'paper', 'gap 12%', 0.758, 'kyber', 300000, 1050)`).run(now - 1000);
  db.prepare(`INSERT INTO opportunities (ts, chain, token, direction, size_usd, aggregator, gross_bps, gas_usd, net_usd, hurdle_usd, decision, reason)
    VALUES (?, 'ethereum', 'LINK', 'DEX_ARB', 200, '0x', 80, 4, 12.5, 5, 'trade', 'dex-arb detection only — no execution')`).run(now);
  db.prepare(`INSERT INTO opportunities (ts, chain, token, direction, size_usd, aggregator, gross_bps, gas_usd, net_usd, hurdle_usd, decision, reason)
    VALUES (?, 'ethereum', 'LINK', 'DEX_ARB', 200, '0x', 40, 4, 1, 5, 'below_hurdle', 'net 1.0000 <= hurdle 5.0000 (dex-arb detection only — no execution)')`).run(now);
  db.prepare(`INSERT INTO depth_rejects (ts, chain, total, detail) VALUES (?, 'ethereum', 3, ?)`).run(
    now, JSON.stringify([
      { token: 'XYZ', liq_usd: 42_000, impact_pct: 1.43, reason: 'pool $42k < $150k' },
      { token: 'XYZ', liq_usd: 42_000, impact_pct: 1.43, reason: 'pool $42k < $150k' },
      { token: 'ABC', liq_usd: 90_000, impact_pct: 0.9, reason: 'impact 0.90% > 0.70%' },
    ]),
  );
  db.prepare(`INSERT INTO depth_rejects (ts, chain, total, detail) VALUES (?, 'ethereum', 1, ?)`).run(
    now - 1000, JSON.stringify([{ token: 'XYZ', liq_usd: 42_000, impact_pct: 1.43, reason: 'pool $42k < $150k' }]),
  );
  for (const [k, v] of [
    ['cfg:aggregators', '0x,kyber,velora'],
    ['cfg:dex_arb_enabled', 'no'],
    ['cfg:min_pool_liquidity_usd', '150000'],
    ['cfg:depth_max_impact_bps', '70'],
    ['cfg:strategy', 'transfer'],
  ]) db.prepare('INSERT INTO state (key, value) VALUES (?, ?)').run(k, v);
  db.prepare(`INSERT INTO transfers (ts, updated, base, symbol, address, decimals, net_work, qty_step, price_decimals, status, buy_qty, cost_usd, note)
    VALUES (?, ?, 'XYZ', 'XYZUSDT', '0xWALLETSECRET', 18, 'ETH', 0.01, 4, 'selling', 10, 200, 'waiting')`).run(now, now);
  db.close();
}

function seedLive() {
  const db = new Database(liveDbPath);
  db.exec(`
    CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
      symbol TEXT NOT NULL, direction TEXT NOT NULL, size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
      expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL, status TEXT NOT NULL,
      dex_tx TEXT, cex_order_id TEXT, note TEXT, requoted_net REAL, aggregator TEXT, pool_tvl_usd REAL, safe_size_usd REAL);
    CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, chain TEXT, token TEXT NOT NULL,
      direction TEXT, size_usd REAL, mexc_bid REAL, mexc_ask REAL, book_age_ms INTEGER, aggregator TEXT, dex_out REAL,
      dex_min_out REAL, usdc_usdt REAL, gross_bps REAL, fee_bps REAL, gas_usd REAL, net_usd REAL, hurdle_usd REAL,
      decision TEXT NOT NULL, reason TEXT);
    CREATE TABLE depth_rejects (ts INTEGER NOT NULL, chain TEXT NOT NULL, total INTEGER NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, updated INTEGER NOT NULL,
      base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL, net_work TEXT NOT NULL,
      qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL, status TEXT NOT NULL, buy_qty REAL, cost_usd REAL,
      buy_order_id TEXT, withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT, usdc_out REAL,
      gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL, sell_attempts INTEGER NOT NULL DEFAULT 0,
      alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT,
      recycle_status TEXT, recycled_usdt REAL, recycle_tx TEXT, recycle_address TEXT);
    CREATE TABLE inventory_snapshots (ts INTEGER NOT NULL, token TEXT NOT NULL, wallet_usd REAL, mexc_usd REAL);
  `);
  const now = Date.now();
  // Old live row: aggregator NULL (pre-Phase-6 trade) — the dashboard shows '—'.
  db.prepare(`INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net, cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note)
    VALUES (?, ?, 'live', 'XYZ', 'TRANSFER', 200, 10, 1, 1.1, 10, 1, 4, 10, 'ok', '0xLIVESECRET', 'cid-live', NULL)`).run(now, '2026-11-23');
  // Live ACN trade (the audit's +$15.79 winner): transfer mode never writes
  // requoted_net, so Booked must fall back to pnl_usd. Earlier ts, so the
  // XYZ row stays live recent[0] for the Phase 6 assertions.
  db.prepare(`INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net, cex_fee_usd, gas_usd, pnl_usd, status, note)
    VALUES (?, '2026-11-23', 'live', 'ACN', 'TRANSFER', 300, 10, 1, 1.15, 10, 0.39, 0.19, 15.79, 'ok', NULL)`).run(now - 500);
  // Below-hurdle live gaps: bestBps 635 with bestNet NULL (the L2 case), and
  // two distinct tokens in the last hour (the L4 case).
  db.prepare(`INSERT INTO opportunities (ts, chain, token, direction, size_usd, aggregator, gross_bps, gas_usd, net_usd, hurdle_usd, decision, reason)
    VALUES (?, 'ethereum', 'ACN', 'TRANSFER', 300, '0x', 635, 4, NULL, 5, 'below_hurdle', 'net below hurdle')`).run(now);
  db.prepare(`INSERT INTO opportunities (ts, chain, token, direction, size_usd, aggregator, gross_bps, gas_usd, net_usd, hurdle_usd, decision, reason)
    VALUES (?, 'ethereum', 'METIS', 'TRANSFER', 300, '0x', 120, 4, NULL, 5, 'below_hurdle', 'net below hurdle')`).run(now);
  // Transfer #3, ACN: recycle done — 263.601851 USDC -> 263.360648 USDT.
  // recycle_tx / recycle_address are NEVER served (public safety).
  db.prepare(`INSERT INTO transfers (ts, updated, base, symbol, address, decimals, net_work, qty_step, price_decimals, status, buy_qty, cost_usd, note, usdc_out, recycle_status, recycled_usdt, recycle_tx, recycle_address)
    VALUES (?, ?, 'ACN', 'ACNUSDT', '0xWALLETSECRET', 18, 'ETH', 0.01, 4, 'done', 10, 200, 'swap reverted', 263.601851, 'done', 263.360648, '0xRECYCLETX', '0xRECYCLEADDR')`).run(now, now);
  for (const [k, v] of [
    ['cfg:aggregators', '0x'],
    ['cfg:dex_arb_enabled', 'no'],
    ['cfg:min_pool_liquidity_usd', '150000'],
    ['cfg:depth_max_impact_bps', '70'],
    ['cfg:strategy', 'transfer'],
  ]) db.prepare('INSERT INTO state (key, value) VALUES (?, ?)').run(k, v);
  db.close();
}

seedPaper();
seedLive();

// The server module reads its DB paths from env at import time, so set them
// before the (only) import in this file.
process.env.STATUS_DB = paperDbPath;
process.env.STATUS_LIVE_DB = liveDbPath;
process.env.CHAIN = 'ethereum';
process.env.MODE = 'paper';

const server = await import('../status-server.mjs');
const { readPublicConfig, readDepthRejects, readDexArbStats, readTradeStats, readLive, chainJson, PAGE, CHAINS, dashboardPage, paperPage } = server;

test('Phase 6: readPublicConfig returns the published config; defaults to DEX-ARB OFF', () => {
  const db = new Database(paperDbPath, { readonly: true });
  const cfg = readPublicConfig(db);
  assert.deepEqual(cfg.aggregators, ['0x', 'kyber', 'velora']);
  assert.equal(cfg.dexArbEnabled, false);
  assert.equal(cfg.minPoolLiquidityUsd, 150000);
  assert.equal(cfg.depthMaxImpactBps, 70);
  assert.equal(cfg.strategy, 'transfer');
  db.close();

  // A DB with no cfg keys yet (pre-Phase-6 deploy): code defaults, badge OFF.
  const empty = new Database(path.join(dir, 'empty.sqlite'));
  empty.exec(`CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const def = readPublicConfig(empty);
  assert.deepEqual(def.aggregators, ['0x']);
  assert.equal(def.dexArbEnabled, false);
  assert.equal(def.minPoolLiquidityUsd, 150000);
  empty.close();
});

test('Phase 6: readDepthRejects aggregates per-token counts + top reason', () => {
  const db = new Database(paperDbPath, { readonly: true });
  const dr = readDepthRejects(db);
  assert.equal(dr.available, true);
  assert.equal(dr.total, 4); // 3 + 1 across two summary rows
  assert.equal(dr.rows, 2);
  assert.equal(dr.tokens[0].token, 'XYZ');
  assert.equal(dr.tokens[0].count, 3);
  assert.equal(dr.tokens[0].topReason, 'pool $42k < $150k');
  assert.equal(dr.tokens[1].token, 'ABC');
  assert.equal(dr.tokens[1].count, 1);
  assert.equal(dr.tokens[1].topReason, 'impact 0.90% > 0.70%');
  db.close();

  // No depth_rejects table at all (old DB): "no rejections recorded yet" state.
  const old = new Database(path.join(dir, 'old.sqlite'));
  old.exec(`CREATE TABLE trades (id INTEGER PRIMARY KEY)`);
  assert.deepEqual(readDepthRejects(old), { available: false, total: 0, rows: 0, tokens: [] });
  old.close();
});

test('Phase 6: readDexArbStats counts DEX_ARB rows; trade decisions are hurdle-passes, not trades', () => {
  const db = new Database(paperDbPath, { readonly: true });
  const s = readDexArbStats(db);
  assert.equal(s.count, 2);
  assert.equal(s.bestNet, 12.5);
  assert.equal(s.tradeDecisions, 1);
  db.close();
});

test('Phase 6: readTradeStats recent rows carry aggregator + depth sizing', () => {
  const db = new Database(paperDbPath, { readonly: true });
  const stats = readTradeStats(db, 'paper', `status = 'paper'`);
  assert.equal(stats.recent.length, 2);
  assert.equal(stats.recent[0].aggregator, 'kyber');
  assert.equal(stats.recent[0].pool_tvl_usd, 300000);
  assert.equal(stats.recent[0].safe_size_usd, 1050);
  assert.equal(stats.recent[1].symbol, 'BGB');
  assert.equal(stats.recent[1].requoted_net, 0.758);
  db.close();
});

test('Phase 6: readTradeStats still works on a pre-Phase-6 DB without the new columns', () => {
  const old = new Database(path.join(dir, 'oldtrades.sqlite'));
  old.exec(`CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
    symbol TEXT NOT NULL, direction TEXT NOT NULL, size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
    expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL, status TEXT NOT NULL,
    dex_tx TEXT, cex_order_id TEXT, note TEXT, requoted_net REAL)`);
  old.prepare(`INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net, cex_fee_usd, gas_usd, pnl_usd, status)
    VALUES (?, '2026-11-23', 'paper', 'XYZ', 'TRANSFER', 200, 10, 1, 1.1, 10, 1, 4, 10, 'paper')`).run(Date.now());
  const stats = readTradeStats(old, 'paper', `status = 'paper'`);
  assert.equal(stats.recent.length, 1);
  assert.equal(stats.recent[0].aggregator, null);
  assert.equal(stats.recent[0].pool_tvl_usd, null);
  assert.equal(stats.recent[0].safe_size_usd, null);
  old.close();
});

test('Phase 6: /api/status JSON carries the new sections, DEX-ARB OFF, and no secrets', async () => {
  const out = await chainJson('ethereum');
  assert.equal(out.dbOk, true);
  assert.equal(out.config.dexArbEnabled, false); // badge OFF by default
  assert.deepEqual(out.config.aggregators, ['0x', 'kyber', 'velora']);
  assert.equal(out.depthRejects.total, 4);
  assert.equal(out.depthRejects.tokens[0].token, 'XYZ');
  assert.equal(out.dexArb.count, 2);
  assert.equal(out.dexArb.bestNet, 12.5);
  assert.equal(out.dexArb.tradeDecisions, 1);
  assert.equal(out.recent[0].aggregator, 'kyber');
  assert.equal(out.recent[0].poolTvl, 300000);
  assert.equal(out.recent[0].safeSize, 1050);
  // Live section: old row shows aggregator null; config from the live DB.
  assert.equal(out.live.dbOk, true);
  assert.deepEqual(out.live.config.aggregators, ['0x']);
  assert.equal(out.live.config.dexArbEnabled, false);
  assert.equal(out.live.recent[0].aggregator, null);
  // PUBLIC SAFETY: no tx hash, no CEX order id, no wallet address anywhere.
  const json = JSON.stringify(out);
  assert.ok(!json.includes('0xSECRET'), 'paper dex_tx leaked');
  assert.ok(!json.includes('cid-secret'), 'paper cex_order_id leaked');
  assert.ok(!json.includes('0xLIVESECRET'), 'live dex_tx leaked');
  assert.ok(!json.includes('cid-live'), 'live cex_order_id leaked');
  assert.ok(!json.includes('0xWALLETSECRET'), 'transfer wallet address leaked');
});

// ---------------- Phase 9: profit-winners on the live dashboard ----------------
test('Phase 9: readWinners lists live winners only, best PnL first, all-time', () => {
  // The seeded live DB already has XYZ live ok +10; add a net winner, a net
  // loser, and a paper row (paper PnL must never count as a live winner).
  const w = new Database(liveDbPath);
  const now = Date.now();
  const row = (symbol: string, mode: string, status: string, pnl: number) =>
    w.prepare(`INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net, cex_fee_usd, gas_usd, pnl_usd, status)
      VALUES (?, '2026-11-23', ?, ?, 'TRANSFER', 200, 10, 1, 1.1, ?, 1, 4, ?, ?)`).run(now, mode, symbol, pnl, pnl, status);
  row('ABC', 'live', 'ok', 5);
  row('ABC', 'live', 'one_sided', -2); // net +3: still a winner (loss counts against it)
  row('DEF', 'live', 'one_sided', -5); // only a loss: not a winner
  row('XYZ', 'paper', 'paper', 100); // paper PnL never counts
  w.close();

  const { readWinners } = server;
  const db = new Database(liveDbPath, { readonly: true });
  assert.deepEqual(readWinners(db), [
    { symbol: 'ACN', trades: 1, pnl: 15.79, wins: 1 },
    { symbol: 'XYZ', trades: 1, pnl: 10, wins: 1 },
    { symbol: 'ABC', trades: 2, pnl: 3, wins: 1 },
  ]);
  db.close();

  // A DB with no trades table at all (old DB): fail-soft, empty list.
  const old = new Database(path.join(dir, 'nowinners.sqlite'));
  old.exec(`CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  assert.deepEqual(readWinners(old), []);
  old.close();
});

test('Phase 9: /api/status JSON carries the live winners list (no secrets)', async () => {
  const out = await chainJson('ethereum');
  assert.equal(out.live.dbOk, true);
  assert.deepEqual(out.live.winners, [
    { symbol: 'ACN', trades: 1, pnl: 15.79, wins: 1 },
    { symbol: 'XYZ', trades: 1, pnl: 10, wins: 1 },
    { symbol: 'ABC', trades: 2, pnl: 3, wins: 1 },
  ]);
  const json = JSON.stringify(out.live.winners);
  assert.ok(!json.includes('0xLIVESECRET'), 'live dex_tx leaked into winners');
  assert.ok(!json.includes('cid-live'), 'live cex_order_id leaked into winners');
});

// ---------------- Board audit 2026-11-23: M1 + L1–L6 ----------------
test('Board audit L1: live Booked falls back to pnl (transfer mode never re-quotes); paper keeps requoted_net', async () => {
  const out = await chainJson('ethereum');
  const acn = out.live.recent.find((r: any) => r.symbol === 'ACN');
  assert.ok(acn, 'live ACN trade missing');
  assert.equal(acn.booked, 15.79); // requoted_net NULL -> pnl_usd
  const bgb = out.recent.find((r: any) => r.symbol === 'BGB');
  assert.ok(bgb, 'paper BGB trade missing');
  assert.equal(bgb.booked, 0.758); // paper keeps its re-quoted value
  const xyzPaper = out.recent.find((r: any) => r.symbol === 'XYZ');
  assert.ok(xyzPaper, 'paper XYZ trade missing');
  assert.equal(xyzPaper.booked, null); // paper without a re-quote still shows —
});

test('Board audit L4: live tokens seen in the last hour are reported (paper parity)', async () => {
  const out = await chainJson('ethereum');
  assert.equal(out.live.tokensLastHour, 2); // ACN + METIS
  assert.equal(out.tokensLastHour, 1); // LINK only (paper)
});

test('Board audit L5: live transfers carry the recycle outcome, and no tx hash / address leaks', async () => {
  const out = await chainJson('ethereum');
  const acn = out.live.transfers.find((t: any) => t.base === 'ACN');
  assert.ok(acn, 'live ACN transfer missing');
  assert.equal(acn.recycle_status, 'done');
  assert.equal(acn.recycled_usdt, 263.360648);
  assert.equal(acn.usdc_out, 263.601851);
  // PUBLIC SAFETY: the recycle tx hash / deposit address are never served.
  const json = JSON.stringify(out.live.transfers);
  assert.ok(!json.includes('0xRECYCLETX'), 'recycle_tx leaked');
  assert.ok(!json.includes('0xRECYCLEADDR'), 'recycle_address leaked');
  assert.ok(!json.includes('0xWALLETSECRET'), 'transfer wallet address leaked');
});

test('Board audit L5: transfers without recycle columns still load (recycle null)', () => {
  const dbPath = path.join(dir, 'oldtransfers.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
      symbol TEXT NOT NULL, direction TEXT NOT NULL, size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
      expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL, status TEXT NOT NULL,
      dex_tx TEXT, cex_order_id TEXT, note TEXT, requoted_net REAL, aggregator TEXT, pool_tvl_usd REAL, safe_size_usd REAL);
    CREATE TABLE opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, chain TEXT, token TEXT NOT NULL,
      direction TEXT, size_usd REAL, mexc_bid REAL, mexc_ask REAL, book_age_ms INTEGER, aggregator TEXT, dex_out REAL,
      dex_min_out REAL, usdc_usdt REAL, gross_bps REAL, fee_bps REAL, gas_usd REAL, net_usd REAL, hurdle_usd REAL,
      decision TEXT NOT NULL, reason TEXT);
    CREATE TABLE transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, updated INTEGER NOT NULL,
      base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL, net_work TEXT NOT NULL,
      qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL, status TEXT NOT NULL, buy_qty REAL, cost_usd REAL,
      buy_order_id TEXT, withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT, usdc_out REAL,
      gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL, sell_attempts INTEGER NOT NULL DEFAULT 0,
      alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT);
    CREATE TABLE inventory_snapshots (ts INTEGER NOT NULL, token TEXT NOT NULL, wallet_usd REAL, mexc_usd REAL);
  `);
  db.prepare(`INSERT INTO transfers (ts, updated, base, symbol, address, decimals, net_work, qty_step, price_decimals, status, buy_qty, cost_usd, note, usdc_out)
    VALUES (?, ?, 'ACN', 'ACNUSDT', '0xWALLETSECRET', 18, 'ETH', 0.01, 4, 'done', 10, 200, 'swap reverted', 100)`).run(Date.now(), Date.now());
  db.close();

  const live = readLive({ name: 'ethereum', liveDb: dbPath });
  assert.equal(live.dbOk, true);
  assert.equal(live.transfers.length, 1);
  assert.equal(live.transfers[0].recycle_status, null);
  assert.equal(live.transfers[0].recycled_usdt, null);
  assert.equal(live.transfers[0].usdc_out, 100);
});

// --- The dashboard page's own JS (gapHtml / depthHtml / load) lives inside
// the PAGE template, so these tests run it in a vm with stubbed document /
// fetch / setInterval and call the functions directly. ---
function pageCtx(fixture: unknown) {
  const script = PAGE.slice(PAGE.indexOf('<script>') + '<script>'.length, PAGE.indexOf('</script>'));
  const els = new Map<string, { innerHTML: string; textContent: string }>();
  const ctx: any = {
    document: {
      getElementById: (id: string) => {
        if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '' });
        return els.get(id);
      },
    },
    fetch: async () => ({ json: async () => fixture }),
    setInterval: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return { ctx, els };
}
const pageHtml = (els: Map<string, { innerHTML: string }>, id: string) => els.get(id)?.innerHTML ?? '';

test('Board audit L2/L3: gapHtml shows — for a null best net; total==1 never renders Infinity%', () => {
  const { ctx } = pageCtx({ dbOk: false, error: 'x' });
  const one = ctx.gapHtml({
    buckets: { lt30: 1, b30_50: 0, b50_100: 0, b100_200: 0, b200_300: 0, b300p: 0, total: 1 },
    bestBps: 100, bestNet: null, hourly: [],
  });
  assert.ok(!one.includes('Infinity'), 'total==1 rendered Infinity% width');
  assert.ok(one.includes('width:100%'), 'the lone bucket should fill the bar');
  assert.ok(one.includes('সেরা net —'), 'null best net must render —, not $0.00');
  assert.ok(!one.includes('$0.00'));
  const withNet = ctx.gapHtml({
    buckets: { lt30: 0, b30_50: 0, b50_100: 5, b100_200: 0, b200_300: 0, b300p: 0, total: 5 },
    bestBps: 200, bestNet: 12.5, hourly: [],
  });
  assert.ok(withNet.includes('সেরা net $12.50'));
});

test('Board audit M1: depth empty state explains where the filter bites (no stale Phase 6 text)', () => {
  const { ctx } = pageCtx({ dbOk: false, error: 'x' });
  const empty = ctx.depthHtml(
    { available: true, total: 0, rows: 0, tokens: [] },
    { floor: 150000, maxImpactBps: 70, tokensLastHour: 14 },
  );
  assert.ok(!empty.includes('Phase 6-এর deploy পায়নি'), 'stale Phase 6 text is still there');
  assert.ok(!empty.includes('কোনো candidate বাদ পড়েনি'), 'must not imply the filter did nothing');
  assert.ok(empty.includes('universe'), 'must say the filter bites at universe build');
  assert.ok(empty.includes('findGaps'), 'must say the filter bites in findGaps');
  assert.ok(empty.includes('$150,000'), 'must show the live pool floor');
  assert.ok(empty.includes('0.70%'), 'must show the live max impact');
  assert.ok(empty.includes('গত ১ ঘণ্টায় টোকেন দেখেছে'), 'must show the live token count');
  assert.ok(empty.includes('14 টা'));
  // With real rejections the section is unchanged (totals + top tokens).
  const full = ctx.depthHtml(
    { available: true, total: 4, rows: 2, tokens: [{ token: 'XYZ', count: 3, topReason: 'pool $42k < $150k', maxImpactPct: 1.43, maxLiqUsd: 42000 }] },
    { floor: 150000, maxImpactBps: 70, tokensLastHour: 14 },
  );
  assert.ok(full.includes('মোট rejection'));
  assert.ok(full.includes('XYZ'));
});

test('Board audit M1/L1/L2/L4/L5: the live page renders every fix end to end', async () => {
  const out = await chainJson('ethereum');
  const { els } = pageCtx(out);
  await new Promise((r) => setTimeout(r, 100));
  // M1: live depth section is truthful, no stale text.
  assert.ok(!pageHtml(els, 'live-depth').includes('Phase 6-এর deploy পায়নি'));
  assert.ok(pageHtml(els, 'live-depth').includes('universe'));
  assert.ok(pageHtml(els, 'live-depth').includes('$150,000'));
  assert.ok(pageHtml(els, 'live-depth').includes('গত ১ ঘণ্টায় টোকেন দেখেছে'));
  assert.ok(!pageHtml(els, 'depth').includes('Phase 6-এর deploy পায়নি'));
  // L4: live token count on the live status card.
  assert.ok(pageHtml(els, 'live-status').includes('গত ১ ঘণ্টায় টোকেন দেখেছে'));
  assert.ok(pageHtml(els, 'live-status').includes('2 টা'));
  // L2: best net is null -> '—', never $0.00.
  assert.ok(pageHtml(els, 'live-gap').includes('সেরা net —'));
  assert.ok(!pageHtml(els, 'live-gap').includes('$0.00'));
  // L1: live Booked shows the pnl ($15.79), with the transfer-mode note.
  assert.ok(pageHtml(els, 'live-recent').includes('$15.79'));
  assert.ok(pageHtml(els, 'live-recent').includes('re-quote হয় না'));
  // L5: recycle outcome on the ACN transfer row.
  assert.ok(pageHtml(els, 'live-transfers').includes('Recycle: done'));
  assert.ok(pageHtml(els, 'live-transfers').includes('263.60 USDC → 263.36 USDT'));
});

test('Board audit L6: /ethereum subtitle is no longer paper-only; the stale demo file is gone', () => {
  assert.ok(!CHAINS.ethereum.sub.includes('আসল টাকা নয়'));
  assert.ok(!CHAINS.ethereum.sub.includes('শুধু paper হিসাব'));
  const page = dashboardPage(CHAINS.ethereum);
  assert.ok(page.includes(CHAINS.ethereum.sub));
  assert.ok(!page.includes('আসল টাকা নয়, শুধু paper হিসাব'));
  assert.ok(!fs.existsSync(new URL('../dashboard-demo.html', import.meta.url)), 'dashboard-demo.html is still in the repo root');
});

// ---------------- ETH paper split from live (owner decision 2026-11-23) ----------------
test('ETH split: /ethereum is live-only, /ethereum-paper is paper-only', () => {
  const live = dashboardPage(CHAINS.ethereum);
  assert.ok(live.includes('<h1>🤖 MEV Bot — Ethereum Live</h1>'), 'live page h1 must say Live');
  assert.ok(live.includes('#paper-block{display:none}'), 'live page must hide the paper block');
  assert.ok(live.includes(CHAINS.ethereum.sub));
  assert.ok(!live.includes('আসল টাকা নয়, শুধু paper হিসাব'), 'live page must not carry the paper-only sub');
  assert.ok(live.includes('href="/ethereum-paper"'), 'live page nav must link to the paper page');
  const paper = paperPage(CHAINS.ethereum);
  assert.ok(paper.includes('<h1>🤖 MEV Bot — Ethereum Paper</h1>'), 'paper page h1 must say Paper');
  assert.ok(paper.includes('#live-block{display:none}'), 'paper page must hide the live block');
  assert.ok(paper.includes('আসল টাকা নয়, শুধু paper হিসাব'), 'paper page sub must say paper-only');
  assert.ok(paper.includes('bot বন্ধ'), 'paper page must say the paper bot is stopped');
  assert.ok(paper.includes("fetch('/api/status?chain=ethereum')"), 'paper page reads the same chain JSON');
  assert.ok(paper.includes('href="/ethereum"'), 'paper page nav must link back to live');
  // The other chains are live-only too (their paper block hides the "paper
  // bot নেই" note instead of showing it).
  const arb = dashboardPage(CHAINS.arbitrum);
  assert.ok(arb.includes('<h1>🤖 MEV Bot — Arbitrum Live</h1>'));
  assert.ok(arb.includes('#paper-block{display:none}'));
});
