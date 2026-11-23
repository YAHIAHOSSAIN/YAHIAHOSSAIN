// Pairing-code dashboard (2026-11-23) — bot side: code generation, snapshot
// shape (public-safe only), push/revoke transport (never throws).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db.js';
import {
  generatePairingCode, isValidPairingCode, getOrCreatePairingCode, rotatePairingCode,
  buildSnapshot, pushSnapshot, revokeCode, PAIRING_CODE_RE, type RemoteSnapshotCtx,
} from '../src/remote.js';
import { dhakaDay } from '../src/util.js';

function seedDb(): Db {
  const db = new Db(':memory:');
  const now = Date.now();
  const today = dhakaDay(now);
  const trade = (symbol: string, status: string, pnl: number, ts: number) => {
    const id = db.insertTrade({
      ts, day: today, mode: 'live', symbol, direction: 'TRANSFER', size_usd: 200, qty: 10,
      buy_price: 1, sell_price: 1.1, expected_net: 10, cex_fee_usd: 1, gas_usd: 4, pnl_usd: pnl,
      status: status as never, dex_tx: '0xSECRET', cex_order_id: 'cid-secret', note: 'gap 15%',
      aggregator: 'kyber', pool_tvl_usd: 300000, safe_size_usd: 1050,
    });
    // insertTrade does not write requoted_net (the bot sets it later via updateTrade).
    db.updateTrade(id, { requoted_net: pnl - 1 });
  };
  trade('XYZ', 'ok', 10, now);
  trade('XYZ', 'ok', -3, now - 1000);
  trade('ABC', 'one_sided', -5, now - 2000);
  // In-flight row: must never count (PnL 0 anyway) and never appear in recent.
  trade('PENDING', 'executing', 0, now - 500);
  db.insertTransfer({
    ts: now - 3000, updated: now, base: 'XYZ', symbol: 'XYZUSDT', address: '0xWALLETSECRET',
    decimals: 18, net_work: 'ETH', qty_step: 0.01, price_decimals: 4, status: 'selling',
    buy_qty: 10, cost_usd: 200, buy_order_id: 'buy-secret', withdraw_amount: null, withdraw_id: null,
    wallet_before: null, received: null, usdc_out: null, gas_usd: 0, expected_net: 10, pnl: null,
    sell_attempts: 1, alerted_timeout: 0, note: 'waiting', withdraw_fee: 0, next_try: 0,
    force_sell: 0, hold_alerted: 0, sell_tx: '0xSELLSECRET', recycle_status: null, recycle_held: 0,
    recycled_usdc: null, recycled_usdt: null, recycle_address: null, recycle_tx: null,
    recycle_order_id: null, recycle_note: null, recycle_deadline: 0, recycle_mexc_before: null,
    recycle_usdt_before: null,
  });
  db.insertInventorySnapshot([{ ts: now, token: 'XYZ', wallet_usd: 12.5, mexc_usd: 0 }]);
  db.insertDepthRejects({ ts: now, chain: 'ethereum', total: 3, detail: JSON.stringify([
    { token: 'XYZ', liq_usd: 42000, impact_pct: 1.43, reason: 'pool $42k < $150k' },
  ]) });
  db.insertOpportunities([{
    ts: now, chain: 'ethereum', token: 'LINK', direction: 'DEX_ARB', size_usd: 200,
    mexc_bid: null, mexc_ask: null, book_age_ms: null, aggregator: '0x', dex_out: null,
    dex_min_out: null, usdc_usdt: null, gross_bps: 80, fee_bps: null, gas_usd: 4,
    net_usd: 12.5, hurdle_usd: 5, decision: 'trade', reason: 'dex-arb detection only',
  }]);
  for (const [k, v] of [
    ['cfg:aggregators', '0x,kyber'],
    ['cfg:dex_arb_enabled', 'no'],
    ['cfg:min_pool_liquidity_usd', '150000'],
    ['cfg:depth_max_impact_bps', '70'],
    ['cfg:strategy', 'transfer'],
  ]) db.setState(k, v);
  return db;
}

const ctx: RemoteSnapshotCtx = {
  chain: 'ethereum', mode: 'live', strategy: 'transfer', maxTradeUsd: 300,
  aggregators: ['0x'], dexArbEnabled: false, minPoolLiquidityUsd: 150000,
  depthMaxImpactBps: 70, version: '1.0.0', walletAddress: '0x1111111111111111111111111111111111111111',
  uptimeSec: 3600, lastScanTs: Date.now(),
  mexcUsdt: 1493.97, walletNative: 0.0303, walletUsdc: 0, nativeSymbol: 'ETH',
};

test('pairing code: 24 URL-safe chars, unique, stable once stored', () => {
  const a = generatePairingCode();
  const b = generatePairingCode();
  assert.match(a, PAIRING_CODE_RE);
  assert.match(b, PAIRING_CODE_RE);
  assert.notEqual(a, b);
  assert.equal(isValidPairingCode(a), true);
  assert.equal(isValidPairingCode('short'), false);
  assert.equal(isValidPairingCode('aaaaaaaaaaaaaaaaaaaaaaaa'), true); // 24 chars
  assert.equal(isValidPairingCode('aaaaaaaaaaaaaaaaaaaaaaaaa'), false); // 25 chars
  assert.equal(isValidPairingCode('aaaaaaaaaaaaaaaaaaaaaaa!'), false); // bad char
  assert.equal(isValidPairingCode(undefined), false);

  const db = new Db(':memory:');
  const first = getOrCreatePairingCode(db);
  assert.equal(first.isNew, true);
  assert.match(first.code, PAIRING_CODE_RE);
  const second = getOrCreatePairingCode(db);
  assert.equal(second.isNew, false);
  assert.equal(second.code, first.code);
  db.close();
});

test('snapshot: numbers match the DB; in-flight trades never count', () => {
  const db = seedDb();
  const s = buildSnapshot(db, ctx);
  assert.equal(s.schema, 1);
  assert.equal(s.chain, 'ethereum');
  assert.equal(s.mode, 'live');
  assert.equal(s.maxTradeUsd, 300);
  // The hot wallet address identifies this bot on the owner's board.
  assert.equal(s.walletAddress, '0x1111111111111111111111111111111111111111');
  // 3 finished live trades: +10, -3, -5 = +2 net; the 'executing' row excluded.
  assert.equal(s.hero.trades, 3);
  assert.equal(s.hero.pnl, 2);
  // All-time traded volume: 3 finished trades x $200 size (executing excluded).
  assert.equal(s.hero.volumeUsd, 600);
  assert.equal(s.hero.wins, 1);
  assert.equal(s.hero.bestToken, 'XYZ');
  assert.equal(s.hero.bestTokenPnl, 7);
  assert.equal(s.today.trades, 3);
  assert.equal(s.today.pnl, 2);
  assert.equal(s.today.wins, 1);
  assert.equal(s.today.losses, 2);
  assert.equal(s.week7d.trades, 3);
  // Winners: only tokens with positive total live PnL.
  assert.deepEqual(s.winners, [{ symbol: 'XYZ', trades: 2, pnl: 7, wins: 1 }]);
  // Recent: 3 finished trades, executing row absent.
  assert.equal(s.recent.length, 3);
  assert.equal(s.recent[0].symbol, 'XYZ');
  assert.equal(s.recent[0].booked, 9);
  assert.equal(s.recent[0].aggregator, 'kyber');
  assert.equal(s.recent[0].poolTvl, 300000);
  assert.ok(!s.recent.some((r) => r.symbol === 'PENDING'));
  // Transfers + inventory + depth + dex-arb from the DB.
  assert.equal(s.transfers.length, 1);
  assert.equal(s.transfers[0].base, 'XYZ');
  assert.equal(s.openTransfers, 1);
  assert.equal(s.stuckTransfers, 0);
  assert.deepEqual(s.inventory, [{ token: 'XYZ', wallet_usd: 12.5, mexc_usd: 0 }]);
  assert.equal(s.depthRejects.available, true);
  assert.equal(s.depthRejects.total, 3);
  assert.equal(s.depthRejects.tokens[0].token, 'XYZ');
  assert.equal(s.dexArb.count, 1);
  assert.equal(s.dexArb.bestNet, 12.5);
  assert.equal(s.dexArb.tradeDecisions, 1);
  assert.equal(s.config.strategy, 'transfer');
  assert.deepEqual(s.config.aggregators, ['0x', 'kyber']);
  // L4: 1 distinct token (LINK) with a gap in the last hour.
  assert.equal(s.tokensLastHour, 1);
  // Gap stats exclude DEX_ARB (detection-only): the fixture's only
  // opportunity rows are the two LINK DEX_ARB rows, so the chart is empty
  // while tokensLastHour still counts LINK as a token seen.
  assert.equal(s.gaps.buckets.total, 0);
  assert.equal(s.gaps.bestBps, null);
  assert.equal(s.gaps.bestNet, null);
  // L5: seeded transfer was never recycled.
  assert.equal(s.transfers[0].recycle_status, null);
  assert.equal(s.transfers[0].recycled_usdt, null);
  db.close();
});

test('snapshot L1/L4/L5: booked falls back to pnl for live (null for paper); recycle fields + tokensLastHour sent; no secrets', () => {
  const db = seedDb();
  const now = Date.now();
  const today = dhakaDay(now);
  // L1: live TRANSFER trade with NO requoted_net (insertTrade never writes
  // it; no updateTrade here) — booked must fall back to the sell-price PnL.
  db.insertTrade({
    ts: now, day: today, mode: 'live', symbol: 'NOBOOK', direction: 'TRANSFER', size_usd: 200, qty: 10,
    buy_price: 1, sell_price: 1.1, expected_net: 10, cex_fee_usd: 1, gas_usd: 4, pnl_usd: 4,
    status: 'ok', dex_tx: '0xSECRET2', cex_order_id: 'cid-secret2', note: null,
    aggregator: 'kyber', pool_tvl_usd: null, safe_size_usd: null,
  });
  // L5: newest transfer, fully recycled — secrets in the row must never be selected.
  db.insertTransfer({
    ts: now, updated: now, base: 'ACN', symbol: 'ACNUSDT', address: '0xWALLETSECRET2',
    decimals: 18, net_work: 'ETH', qty_step: 0.01, price_decimals: 4, status: 'done',
    buy_qty: 10, cost_usd: 200, buy_order_id: 'buy-secret2', withdraw_amount: null, withdraw_id: null,
    wallet_before: null, received: null, usdc_out: 263.60, gas_usd: 0, expected_net: 10, pnl: 15.79,
    sell_attempts: 1, alerted_timeout: 0, note: null, withdraw_fee: 0, next_try: 0,
    force_sell: 0, hold_alerted: 0, sell_tx: '0xSELLSECRET2', recycle_status: 'done', recycle_held: 0,
    recycled_usdc: 263.60, recycled_usdt: 263.36, recycle_address: '0xRECYCLEADDR', recycle_tx: '0xRECYCLESECRET',
    recycle_order_id: 'recycle-order-secret', recycle_note: null, recycle_deadline: 0, recycle_mexc_before: null,
    recycle_usdt_before: null,
  });
  // L4: one more distinct token inside the last hour + one stale token outside it.
  const opp = (token: string, ts: number) => ({
    ts, chain: 'ethereum', token, direction: 'TRANSFER', size_usd: 200,
    mexc_bid: null, mexc_ask: null, book_age_ms: null, aggregator: '0x', dex_out: null,
    dex_min_out: null, usdc_usdt: null, gross_bps: 80, fee_bps: null, gas_usd: 4,
    net_usd: 12.5, hurdle_usd: 5, decision: 'rule', reason: 'gap',
  });
  db.insertOpportunities([opp('ACN', now - 1000), opp('OLD', now - 2 * 3600 * 1000)]);

  const s = buildSnapshot(db, ctx);
  // L1 live: requoted_net NULL -> booked = pnl_usd; requoted_net set -> it wins.
  assert.equal(s.recent.find((r) => r.symbol === 'NOBOOK')?.booked, 4);
  assert.equal(s.recent.find((r) => r.symbol === 'XYZ')?.booked, 9);
  // L5: newest transfer first, recycle outcome present; seeded transfer untouched.
  assert.equal(s.transfers[0].base, 'ACN');
  assert.equal(s.transfers[0].recycle_status, 'done');
  assert.equal(s.transfers[0].recycled_usdt, 263.36);
  assert.equal(s.transfers[0].usdc_out, 263.6);
  assert.equal(s.transfers[1].recycle_status, null);
  assert.equal(s.transfers[1].recycled_usdt, null);
  // L4: LINK + ACN inside the hour; OLD is >1h old and must not count.
  assert.equal(s.tokensLastHour, 2);
  // No secret value or secret field name anywhere in the built snapshot.
  const json = JSON.stringify(s);
  for (const secret of ['0xSECRET2', 'cid-secret2', 'buy-secret2', '0xSELLSECRET2', '0xRECYCLEADDR', '0xRECYCLESECRET', 'recycle-order-secret', '0xWALLETSECRET2']) {
    assert.ok(!json.includes(secret), `${secret} leaked into snapshot`);
  }
  for (const field of ['recycle_tx', 'recycle_address', 'recycle_order_id', 'sell_tx', 'dex_tx', 'cex_order_id']) {
    assert.ok(!json.includes(`"${field}"`), `field ${field} present in snapshot`);
  }
  // L1 paper: same rows, booked stays null where requoted_net is null
  // (a paper-mode snapshot over a DB that still holds old live trades).
  const sp = buildSnapshot(db, { ...ctx, mode: 'paper' });
  assert.equal(sp.recent.find((r) => r.symbol === 'NOBOOK')?.booked, null);
  assert.equal(sp.recent.find((r) => r.symbol === 'XYZ')?.booked, 9);
  db.close();
});

test('snapshot: NO secret ever leaves the bot (tx hashes, order ids, keys — the hot wallet address is the designed identity)', () => {
  const db = seedDb();
  const s = buildSnapshot(db, ctx);
  const json = JSON.stringify(s);
  for (const secret of ['0xSECRET', 'cid-secret', '0xWALLETSECRET', 'buy-secret', '0xSELLSECRET']) {
    assert.ok(!json.includes(secret), `${secret} leaked into snapshot`);
  }
  // And no secret FIELD NAMES at all. (inventory rows legitimately carry a
  // `token` field — the public symbol, e.g. 'XYZ', same as the dashboard shows.)
  for (const field of ['dex_tx', 'cex_order_id', 'address', 'private', 'api_key', 'secret']) {
    assert.ok(!json.includes(`"${field}"`), `field ${field} present in snapshot`);
  }
  // The hot wallet address IS in the snapshot by design (owner decision
  // 2026-11-23): it identifies the bot on the owner's board. It is the only
  // address-like value allowed — the transfer's own address (0xWALLETSECRET
  // above) still never leaves.
  assert.equal(s.walletAddress, '0x1111111111111111111111111111111111111111');
  db.close();
});

test('snapshot: empty DB returns zeros, no crash', () => {
  const db = new Db(':memory:');
  const s = buildSnapshot(db, ctx);
  assert.equal(s.hero.trades, 0);
  assert.equal(s.recent.length, 0);
  assert.equal(s.gaps.buckets.total, 0);
  // opportunities table exists but is empty: count 0, not null.
  assert.equal(s.tokensLastHour, 0);
  // Table exists but no rows: available true + total 0 — same as the dashboard,
  // which shows its "no rejections recorded yet" state on total 0.
  assert.equal(s.depthRejects.available, true);
  assert.equal(s.depthRejects.total, 0);
  assert.equal(s.depthRejects.rows, 0);
  assert.deepEqual(s.winners, []);
  db.close();
});

test('pushSnapshot: posts code + chain + snapshot; false on failure, never throws', async () => {
  const db = seedDb();
  const s = buildSnapshot(db, ctx);
  const code = generatePairingCode();
  const seen: { url: string; body: unknown }[] = [];
  const okFetch = (async (url: string, init: { body?: string }) => {
    seen.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  assert.equal(await pushSnapshot('http://127.0.0.1:3102/api/ingest', code, s, okFetch), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://127.0.0.1:3102/api/ingest');
  const body = seen[0].body as { code: string; chain: string; snapshot: unknown };
  assert.equal(body.code, code);
  assert.equal(body.chain, 'ethereum');
  assert.ok(body.snapshot);

  // Non-200, throwing fetch, and empty URL all return false, never throw.
  const failFetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  assert.equal(await pushSnapshot('http://127.0.0.1:3102/api/ingest', code, s, failFetch), false);
  const throwFetch = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  assert.equal(await pushSnapshot('http://127.0.0.1:3102/api/ingest', code, s, throwFetch), false);
  assert.equal(await pushSnapshot('', code, s, okFetch), false);
  assert.equal(await pushSnapshot('http://127.0.0.1:3102/api/ingest', 'bad-code', s, okFetch), false);
  assert.equal(seen.length, 1); // bad code never even called fetch
  db.close();
});

test('rotatePairingCode: revokes the old code at the receiver, then stores the new one', async () => {
  const db = new Db(':memory:');
  const { code: old } = getOrCreatePairingCode(db);
  const revoked: unknown[] = [];
  const fetchFn = (async (_url: string, init: { body?: string }) => {
    revoked.push(JSON.parse(String(init.body)));
    return { ok: true, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  const { oldCode, newCode } = await rotatePairingCode(db, 'http://127.0.0.1:3102/api/ingest', fetchFn);
  assert.equal(oldCode, old);
  assert.notEqual(newCode, old);
  assert.match(newCode, PAIRING_CODE_RE);
  assert.equal(db.getState('pairing:code'), newCode);
  assert.deepEqual(revoked, [{ code: old, action: 'revoke' }]);

  // Revoke is best-effort: a dead receiver must not block the rotation.
  const deadFetch = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  const second = await rotatePairingCode(db, 'http://127.0.0.1:3102/api/ingest', deadFetch);
  assert.equal(second.oldCode, newCode);
  assert.notEqual(second.newCode, newCode);
  assert.equal(db.getState('pairing:code'), second.newCode);
  db.close();
});

test('revokeCode: posts the revoke action; false on failure', async () => {
  const code = generatePairingCode();
  let posted: unknown = null;
  const fetchFn = (async (_u: string, init: { body?: string }) => {
    posted = JSON.parse(String(init.body));
    return { ok: true, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  assert.equal(await revokeCode('http://127.0.0.1:3102/api/ingest', code, fetchFn), true);
  assert.deepEqual(posted, { code, action: 'revoke' });
  const deadFetch = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  assert.equal(await revokeCode('http://127.0.0.1:3102/api/ingest', code, deadFetch), false);
});
