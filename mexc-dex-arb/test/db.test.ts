// Phase 6 bot-side persistence: trades.aggregator + depth sizing columns,
// the depth_rejects summary table, and the public-config publish (option b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db, publishPublicConfig } from '../src/db.js';

test('Phase 6: trades gains aggregator / pool_tvl_usd / safe_size_usd (migration, old rows stay NULL)', () => {
  const db = new Db(':memory:');
  const cols = new Set(db.all<{ name: string }>('PRAGMA table_info(trades)').map((c) => c.name));
  assert.ok(cols.has('aggregator') && cols.has('pool_tvl_usd') && cols.has('safe_size_usd'));
  const id = db.insertTrade({
    ts: Date.now(), day: '2026-11-23', mode: 'paper', symbol: 'XYZ', direction: 'TRANSFER',
    size_usd: 300, qty: 10, buy_price: 1, sell_price: 1.15, expected_net: 20,
    cex_fee_usd: 1, gas_usd: 4, pnl_usd: 20, status: 'paper', dex_tx: null, cex_order_id: null, note: null,
    aggregator: 'kyber', pool_tvl_usd: 300_000, safe_size_usd: 1050,
  });
  const row = db.all<Record<string, unknown>>('SELECT * FROM trades WHERE id = ?', id)[0];
  assert.equal(row.aggregator, 'kyber');
  assert.equal(row.pool_tvl_usd, 300_000);
  assert.equal(row.safe_size_usd, 1050);
  // A trade recorded without the new fields keeps them NULL (old code paths / live transfer rows).
  const id2 = db.insertTrade({
    ts: Date.now(), day: '2026-11-23', mode: 'live', symbol: 'ABC', direction: 'TRANSFER',
    size_usd: 200, qty: 5, buy_price: 2, sell_price: 2.1, expected_net: 5,
    cex_fee_usd: 1, gas_usd: 4, pnl_usd: 5, status: 'ok', dex_tx: '0xabc', cex_order_id: 'c1', note: null,
  });
  const row2 = db.all<Record<string, unknown>>('SELECT * FROM trades WHERE id = ?', id2)[0];
  assert.equal(row2.aggregator, null);
  assert.equal(row2.pool_tvl_usd, null);
  assert.equal(row2.safe_size_usd, null);
  db.close();
});

test('Phase 6: depth_rejects table + insertDepthRejects write one summary row', () => {
  const db = new Db(':memory:');
  const detail = JSON.stringify([{ token: 'XYZ', liq_usd: 42_000, impact_pct: 1.43, reason: 'pool $42k < $150k' }]);
  db.insertDepthRejects({ ts: 1_000_000, chain: 'ethereum', total: 3, detail });
  const rows = db.all<Record<string, unknown>>('SELECT * FROM depth_rejects');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 3);
  assert.equal(rows[0].chain, 'ethereum');
  assert.deepEqual(JSON.parse(String(rows[0].detail)), JSON.parse(detail));
  db.close();
});

test('Phase 6: publishPublicConfig writes public keys to state (and rewrites on change, never secrets)', () => {
  const db = new Db(':memory:');
  publishPublicConfig(db, {
    aggregators: ['0x', 'kyber', 'velora'],
    dexArbEnabled: false,
    minPoolLiquidityUsd: 150_000,
    depthMaxImpactBps: 70,
    strategy: 'transfer',
  });
  assert.equal(db.getState('cfg:aggregators'), '0x,kyber,velora');
  assert.equal(db.getState('cfg:dex_arb_enabled'), 'no');
  assert.equal(db.getState('cfg:min_pool_liquidity_usd'), '150000');
  assert.equal(db.getState('cfg:depth_max_impact_bps'), '70');
  assert.equal(db.getState('cfg:strategy'), 'transfer');
  // A restart with DEX_ARB on rewrites the flag; no secret key is ever written by this call.
  publishPublicConfig(db, {
    aggregators: ['0x'], dexArbEnabled: true, minPoolLiquidityUsd: 200_000, depthMaxImpactBps: 100, strategy: 'inventory',
  });
  assert.equal(db.getState('cfg:dex_arb_enabled'), 'yes');
  assert.equal(db.getState('cfg:min_pool_liquidity_usd'), '200000');
  assert.equal(db.getState('cfg:aggregators'), '0x');
  assert.equal(db.getState('cfg:strategy'), 'inventory');
  assert.equal(db.getState('PRIVATE_KEY'), undefined);
  db.close();
});

test('Phase 9: liveTokenStats counts only finished live trades (ok + one_sided)', () => {
  const db = new Db(':memory:');
  const now = Date.now();
  const row = (symbol: string, mode: string, status: string, pnl: number) => ({
    ts: now, day: '2026-11-23', mode, symbol, direction: 'TRANSFER',
    size_usd: 200, qty: 10, buy_price: 1, sell_price: 1.1, expected_net: pnl,
    cex_fee_usd: 1, gas_usd: 4, pnl_usd: pnl, status: status as never, dex_tx: null, cex_order_id: null, note: null,
  });
  db.insertTrade(row('XYZ', 'live', 'ok', 15.79)); // ACN-style win
  db.insertTrade(row('XYZ', 'live', 'ok', 5));
  db.insertTrade(row('ABC', 'live', 'ok', 5));
  db.insertTrade(row('ABC', 'live', 'one_sided', -20)); // one win, one bigger loss: net -15, not a winner
  db.insertTrade(row('DEF', 'live', 'one_sided', -3)); // only a loss
  db.insertTrade(row('XYZ', 'paper', 'paper', 100)); // paper PnL never counts as live
  db.insertTrade(row('XYZ', 'live', 'executing', 0)); // in-flight, PnL 0
  const stats = db.liveTokenStats();
  const bySym = new Map(stats.map((s) => [s.symbol, s]));
  assert.equal(bySym.get('XYZ')?.pnl, 20.79);
  assert.equal(bySym.get('XYZ')?.trades, 2);
  assert.equal(bySym.get('XYZ')?.wins, 2);
  assert.equal(bySym.get('ABC')?.pnl, -15);
  assert.equal(bySym.get('ABC')?.trades, 2);
  assert.equal(bySym.get('ABC')?.wins, 1);
  assert.equal(bySym.get('DEF')?.pnl, -3);
  db.close();
});
