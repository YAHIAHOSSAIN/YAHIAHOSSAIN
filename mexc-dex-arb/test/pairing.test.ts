// Pairing-code dashboard (2026-11-23) — central receiver: ingest sanitizing,
// per-code storage, revoke, offline detection, retention, rate limiting.
// Security core: a code is a password, no enumeration, and NO secret field
// (wallet address, key, token, tx hash, order id) can ever be stored/served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pairing-'));
const remoteDbPath = path.join(dir, 'remote-bots.sqlite');

// The receiver module reads REMOTE_DB at import time, so set it before import.
process.env.REMOTE_DB = remoteDbPath;

const server = await import('../status-server.mjs');
const {
  sanitizeSnapshot, ingestSnapshot, revokeRemoteCode, readRemote, remoteJson,
  hashPairingCode, isValidRemoteCode, RateLimiter,
} = server;

const CODE_A = 'abcdefghijklmnopqrstuvwx'; // 24 chars
const CODE_B = 'ABCDEFGHIJKLMNOPQRSTUVWX'; // 24 chars
const BAD_CODE = 'too-short';

function goodSnapshot(overrides = {}) {
  return {
    schema: 1, chain: 'ethereum', mode: 'live', version: '1.0.0', uptimeSec: 3600,
    lastScanTs: Date.now(), pm2: { state: 'online' }, maxTradeUsd: 300,
    hero: { trades: 3, pnl: 15.79, gas: 12, fees: 3, wins: 2, bestToken: 'ACN', bestTokenPnl: 15.79 },
    today: { day: '2026-11-23', trades: 1, pnl: 15.79, gas: 4, fees: 1, wins: 1, losses: 0 },
    week7d: { trades: 3, pnl: 15.79 },
    perToken: [{ symbol: 'ACN', trades: 1, pnl: 15.79, wins: 1 }],
    daily: [{ day: '2026-11-23', trades: 1, pnl: 15.79, gas: 4, fees: 1 }],
    recent: [{
      ts: Date.now(), day: '23 Nov', time: '03:10', symbol: 'ACN', direction: 'TRANSFER',
      size: 248, buy: 1, sell: 1.1, expected: 16, booked: 15.79, gas: 4, fees: 1, pnl: 15.79,
      aggregator: 'kyber', poolTvl: 300000, safeSize: 1050, status: 'ok', note: 'sold',
    }],
    transfers: [{ ts: Date.now(), day: '23 Nov', time: '03:10', base: 'ACN', status: 'done', note: '', pnl: 15.79, usdc_out: 263.6 }],
    inventory: [{ token: 'ACN', wallet_usd: 0, mexc_usd: 0 }],
    winners: [{ symbol: 'ACN', trades: 1, pnl: 15.79, wins: 1 }],
    gaps: { buckets: { lt30: 0, b30_50: 0, b50_100: 0, b100_200: 0, b200_300: 0, b300p: 0, total: 0 }, bestBps: null, bestNet: null, hourly: [] },
    config: { aggregators: ['0x', 'kyber'], dexArbEnabled: false, minPoolLiquidityUsd: 150000, depthMaxImpactBps: 70, strategy: 'transfer' },
    depthRejects: { available: true, total: 4, rows: 2, tokens: [{ token: 'XYZ', count: 3, topReason: 'pool thin', maxImpactPct: 1.43, maxLiqUsd: 42000 }] },
    dexArb: { count: 0, bestNet: null, tradeDecisions: 0 },
    balances: { mexcUsdt: 1493.97, walletNative: 0.0303, walletUsdc: 0, nativeSymbol: 'ETH' },
    openTransfers: 0, stuckTransfers: 0,
    ...overrides,
  };
}

function freshDb() {
  return new Database(path.join(dir, `t-${Date.now()}-${Math.random()}.sqlite`));
}

test('code format: 24 URL-safe chars only', () => {
  assert.equal(isValidRemoteCode(CODE_A), true);
  assert.equal(isValidRemoteCode(CODE_B), true);
  assert.equal(isValidRemoteCode(BAD_CODE), false);
  assert.equal(isValidRemoteCode('abcdefghijklmnopqrstuvw!'), false);
  assert.equal(isValidRemoteCode(''), false);
  assert.equal(isValidRemoteCode(undefined), false);
  assert.equal(isValidRemoteCode(null), false);
});

test('hashPairingCode: deterministic sha256, never the code itself', () => {
  const h1 = hashPairingCode(CODE_A);
  const h2 = hashPairingCode(CODE_A);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(hashPairingCode(CODE_A), hashPairingCode(CODE_B));
  assert.ok(!h1.includes(CODE_A));
});

test('sanitizeSnapshot: drops EVERY secret field, keeps the public ones', () => {
  const dirty = goodSnapshot({
    wallet_address: '0x000000000000000000000000000000000000beef',
    walletAddress: '0x000000000000000000000000000000000000beef',
    private_key: 'deadbeef',
    api_key: 'mexc-secret',
    telegram_token: '123:ABC',
    dex_tx: '0xSECRET',
    cex_order_id: 'cid-secret',
    address: '0xWALLETSECRET',
  });
  // Secrets nested inside the allowlisted sections must die too.
  dirty.recent[0].dex_tx = '0xSECRET';
  dirty.recent[0].cex_order_id = 'cid-secret';
  dirty.transfers[0].address = '0xWALLETSECRET';
  dirty.balances.privateKey = 'deadbeef';
  dirty.hero.secret_note = 'should not survive';
  const clean = sanitizeSnapshot(dirty);
  assert.ok(clean);
  const json = JSON.stringify(clean);
  for (const secret of ['0x000000000000000000000000000000000000beef', 'deadbeef', 'mexc-secret', '123:ABC', '0xSECRET', 'cid-secret', '0xWALLETSECRET']) {
    assert.ok(!json.includes(secret), `${secret} survived sanitizing`);
  }
  for (const field of ['wallet_address', 'walletAddress', 'private_key', 'api_key', 'telegram_token', 'dex_tx', 'cex_order_id', 'address', 'secret_note']) {
    assert.ok(!json.includes(`"${field}"`), `field ${field} survived sanitizing`);
  }
  // Public fields survive intact.
  assert.equal(clean.hero.pnl, 15.79);
  assert.equal(clean.hero.bestToken, 'ACN');
  assert.equal(clean.recent[0].symbol, 'ACN');
  assert.equal(clean.recent[0].booked, 15.79);
  assert.equal(clean.balances.mexcUsdt, 1493.97);
  assert.equal(clean.chain, 'ethereum');
});

test('sanitizeSnapshot: rejects non-objects and bad chains; truncates + caps', () => {
  assert.equal(sanitizeSnapshot(null), null);
  assert.equal(sanitizeSnapshot('x'), null);
  assert.equal(sanitizeSnapshot([1, 2]), null);
  assert.equal(sanitizeSnapshot(goodSnapshot({ chain: 'solana' })), null);
  assert.equal(sanitizeSnapshot(goodSnapshot({ chain: 'ETHEREUM' })).chain, 'ethereum');
  const long = goodSnapshot({
    recent: Array.from({ length: 50 }, (_, i) => ({
      ts: i, day: '23 Nov', time: '03:10', symbol: 'X'.repeat(100), direction: 'TRANSFER',
      size: 1, buy: 1, sell: 1, expected: 1, booked: 1, gas: 1, fees: 1, pnl: 1,
      aggregator: 'kyber', poolTvl: null, safeSize: null, status: 'ok', note: 'n'.repeat(500),
    })),
  });
  const clean = sanitizeSnapshot(long);
  assert.equal(clean.recent.length, 12); // capped at 12
  assert.equal(clean.recent[0].symbol.length, 20); // truncated
  assert.equal(clean.recent[0].note.length, 200); // truncated
});

test('ingest + read round-trip: stored per code, online while fresh', () => {
  const db = freshDb();
  const now = Date.now();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot(), now), { ok: true });
  const row = readRemote(db, CODE_A, now);
  assert.ok(row);
  assert.equal(row.chain, 'ethereum');
  assert.equal(row.online, true);
  const snap = JSON.parse(row.snapshot);
  assert.equal(snap.hero.pnl, 15.79);
  assert.equal(snap.recent[0].symbol, 'ACN');
  // The raw code is NOT in the stored row: only its hash is the key.
  const stored = db.prepare('SELECT code_hash, snapshot FROM remote_bots').all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].code_hash, hashPairingCode(CODE_A));
  assert.ok(!JSON.stringify(stored[0]).includes(CODE_A), 'raw code stored in DB');
  // A second code lives beside it, never mixed.
  assert.deepEqual(ingestSnapshot(db, CODE_B, 'arbitrum', goodSnapshot({ chain: 'arbitrum' }), now), { ok: true });
  assert.equal(readRemote(db, CODE_B, now).chain, 'arbitrum');
  assert.equal(readRemote(db, CODE_A, now).chain, 'ethereum');
  db.close();
});

test('readRemote: unknown code and bad code both return null (no enumeration)', () => {
  const db = freshDb();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot()), { ok: true });
  assert.equal(readRemote(db, 'zzzzzzzzzzzzzzzzzzzzzzzz'), null); // well-formed but never seen
  assert.equal(readRemote(db, BAD_CODE), null);
  assert.equal(readRemote(db, ''), null);
  db.close();
});

test('readRemote: stale snapshot (>2 min) reads as offline, not missing', () => {
  const db = freshDb();
  const now = Date.now();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot(), now - 119_000), { ok: true });
  assert.equal(readRemote(db, CODE_A, now).online, true); // 119s: still online
  assert.equal(readRemote(db, CODE_A, now + 2000).online, false); // 121s: offline
  // Offline is still found (the page shows it as offline, not as "no bot").
  assert.ok(readRemote(db, CODE_A, now + 2000));
  db.close();
});

test('revokeRemoteCode: the old code dies immediately', () => {
  const db = freshDb();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot()), { ok: true });
  assert.ok(readRemote(db, CODE_A));
  const r = revokeRemoteCode(db, CODE_A);
  assert.equal(r.ok, true);
  assert.equal(r.deleted, 1);
  assert.equal(readRemote(db, CODE_A), null);
  // Revoking again is a harmless no-op.
  assert.deepEqual(revokeRemoteCode(db, CODE_A), { ok: true, deleted: 0 });
  db.close();
});

test('ingestSnapshot: rejects bad codes, bad chains, chain mismatch', () => {
  const db = freshDb();
  assert.deepEqual(ingestSnapshot(db, BAD_CODE, 'ethereum', goodSnapshot()), { ok: false, error: 'bad code' });
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'solana', goodSnapshot()), { ok: false, error: 'bad chain' });
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'arbitrum', goodSnapshot({ chain: 'ethereum' })), { ok: false, error: 'chain mismatch' });
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', null), { ok: false, error: 'bad snapshot' });
  assert.equal(readRemote(db, CODE_A), null);
  db.close();
});

test('retention: snapshots older than 30 days are pruned on the next ingest', () => {
  const db = freshDb();
  const now = Date.now();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot(), now - 31 * 86_400_000), { ok: true });
  assert.ok(readRemote(db, CODE_A, now - 31 * 86_400_000));
  // A new ingest (any code) prunes the stale row.
  assert.deepEqual(ingestSnapshot(db, CODE_B, 'bsc', goodSnapshot({ chain: 'bsc' }), now), { ok: true });
  assert.equal(readRemote(db, CODE_A, now), null);
  assert.ok(readRemote(db, CODE_B, now));
  db.close();
});

test('remoteJson: dashboard shape — paper empty, live carries the remote bot', () => {
  const db = freshDb();
  const now = Date.now();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot(), now), { ok: true });
  const out = remoteJson(db, CODE_A, now);
  assert.ok(out);
  assert.equal(out.dbOk, false); // paper section stays empty
  assert.equal(out.chain, 'ethereum');
  assert.equal(out.online, true);
  assert.equal(out.live.dbOk, true);
  assert.equal(out.live.hero.pnl, 15.79);
  assert.equal(out.live.today.trades, 1);
  assert.equal(out.live.recent[0].symbol, 'ACN');
  assert.equal(out.live.winners[0].symbol, 'ACN');
  assert.equal(out.live.pm2.state, 'online');
  // Offline snapshot: same shape, pm2 shows stopped, error says offline.
  const stale = remoteJson(db, CODE_A, now + 180_000);
  assert.equal(stale.online, false);
  assert.equal(stale.live.pm2.state, 'stopped');
  assert.match(stale.error, /offline/);
  // Unknown code: null (the route answers 404).
  assert.equal(remoteJson(db, 'zzzzzzzzzzzzzzzzzzzzzzzz', now), null);
  // No secret anywhere in the served JSON.
  const json = JSON.stringify(out);
  for (const field of ['dex_tx', 'cex_order_id', 'address', 'private_key', 'api_key']) {
    assert.ok(!json.includes(`"${field}"`), `field ${field} in served JSON`);
  }
  db.close();
});

test('RateLimiter: allows up to the limit, then blocks until the window passes', () => {
  const rl = new RateLimiter();
  const now = 1_000_000;
  assert.equal(rl.allow('k', 3, 60_000, now), true);
  assert.equal(rl.allow('k', 3, 60_000, now + 1000), true);
  assert.equal(rl.allow('k', 3, 60_000, now + 2000), true);
  assert.equal(rl.allow('k', 3, 60_000, now + 3000), false); // 4th inside the window
  assert.equal(rl.allow('other', 3, 60_000, now + 3000), true); // different key unaffected
  assert.equal(rl.allow('k', 3, 60_000, now + 61_000), true); // window passed
  // Ingest pace: 1 per 5s per code.
  assert.equal(rl.allow('code', 1, 5000, now), true);
  assert.equal(rl.allow('code', 1, 5000, now + 4000), false);
  assert.equal(rl.allow('code', 1, 5000, now + 5000), true);
});
