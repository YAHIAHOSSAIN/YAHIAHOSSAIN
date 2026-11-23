// Pairing-code dashboard (2026-11-23) — central receiver: ingest sanitizing,
// per-code storage, revoke, offline detection, retention, rate limiting.
// Security core: a code is a password, no enumeration, and NO secret field
// (key, token, tx hash, order id) can ever be stored/served. The hot wallet
// address is the one exception: it is stored in its own DB column (never in
// the public snapshot blob) and shown in full only on the key-gated owner
// page; public pages get at most its fingerprint.
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

// The receiver module reads REMOTE_DB + OWNER_KEY at import time, so set
// them before import. OWNER_KEY here is a TEST key only — the live key lives
// in the VPS pm2 env and never in the repo.
const OWNER_KEY = 'AbCdEfGhIjKlMnOpQrStUvWx'; // 24 chars
process.env.OWNER_KEY = OWNER_KEY;
const ADDR_Y = '0x1111111111111111111111111111111111111111'; // synthetic operator address (never a real wallet)
const ADDR_F = '0x000000000000000000000000000000000000beef'; // a second operator
process.env.REMOTE_DB = remoteDbPath;

const server = await import('../status-server.mjs');
const {
  sanitizeSnapshot, ingestSnapshot, revokeRemoteCode, readRemote, remoteJson,
  hashPairingCode, isValidRemoteCode, RateLimiter, ownerJson, readOwnerSummary,
  readOwnerAddress, walletFingerprint,
} = server;

const CODE_A = 'abcdefghijklmnopqrstuvwx'; // 24 chars
const CODE_B = 'ABCDEFGHIJKLMNOPQRSTUVWX'; // 24 chars
const CODE_C = '0123456789abcdefghijklmn'; // 24 chars
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

// ---------------- Owner board (2026-11-23): address identity + summary ----------------

test('ingest: wallet address lands in its own column, never in the stored snapshot', () => {
  const db = freshDb();
  const now = Date.now();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot({ walletAddress: ADDR_Y }), now), { ok: true });
  const row = db.prepare('SELECT address, snapshot FROM remote_bots WHERE code_hash = ?').get(hashPairingCode(CODE_A));
  assert.equal(row.address, ADDR_Y);
  assert.ok(!row.snapshot.includes(ADDR_Y), 'raw address in stored snapshot blob');
  assert.ok(!row.snapshot.includes('walletAddress'), 'walletAddress field in stored snapshot blob');
  // A malformed address stores NULL but the snapshot still lands.
  assert.deepEqual(ingestSnapshot(db, CODE_B, 'arbitrum', goodSnapshot({ chain: 'arbitrum', walletAddress: 'not-an-address' }), now), { ok: true });
  const rowB = db.prepare('SELECT address FROM remote_bots WHERE code_hash = ?').get(hashPairingCode(CODE_B));
  assert.equal(rowB.address, null);
  // No address at all (old bot version): also NULL, still ok.
  assert.deepEqual(ingestSnapshot(db, CODE_C, 'bsc', goodSnapshot({ chain: 'bsc' }), now), { ok: true });
  const rowC = db.prepare('SELECT address FROM remote_bots WHERE code_hash = ?').get(hashPairingCode(CODE_C));
  assert.equal(rowC.address, null);
  db.close();
});

test('owner board: groups by wallet address; totals are all-time hero sums; active = 5 min', () => {
  const db = freshDb();
  const now = Date.now();
  const heroY1 = { trades: 3, pnl: 16, gas: 12, fees: 3, wins: 2, bestToken: 'ACN', bestTokenPnl: 16, volumeUsd: 600 };
  const heroY2 = { trades: 2, pnl: -5, gas: 2, fees: 1, wins: 0, bestToken: 'METIS', bestTokenPnl: -5, volumeUsd: 400 };
  const heroF = { trades: 1, pnl: 100, gas: 1, fees: 0, wins: 1, bestToken: 'XYZ', bestTokenPnl: 100, volumeUsd: 1000 };
  const recentY1 = [{ ts: now, day: '23 Nov', time: '08:00', symbol: 'ACN', direction: 'TRANSFER', size: 248, buy: 1, sell: 1.1, expected: 16, booked: 16, gas: 4, fees: 1, pnl: 16, aggregator: 'kyber', poolTvl: 300000, safeSize: 1050, status: 'ok', note: 'sold' }];
  const recentY2 = [{ ts: now - 1000, day: '23 Nov', time: '07:59', symbol: 'METIS', direction: 'TRANSFER', size: 200, buy: 1, sell: 1.1, expected: 1, booked: -5, gas: 2, fees: 1, pnl: -5, aggregator: 'kyber', poolTvl: 100000, safeSize: 300, status: 'ok', note: '' }];
  const recentF = [{ ts: now - 5000, day: '23 Nov', time: '07:55', symbol: 'XYZ', direction: 'TRANSFER', size: 1000, buy: 1, sell: 1.1, expected: 100, booked: 100, gas: 1, fees: 0, pnl: 100, aggregator: 'kyber', poolTvl: 500000, safeSize: 3000, status: 'ok', note: '' }];
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot({ hero: heroY1, recent: recentY1, walletAddress: ADDR_Y }), now), { ok: true });
  assert.deepEqual(ingestSnapshot(db, CODE_B, 'arbitrum', goodSnapshot({ chain: 'arbitrum', hero: heroY2, recent: recentY2, walletAddress: ADDR_Y }), now), { ok: true });
  // Friend's bot pushed 10 minutes ago: present in totals, NOT active.
  assert.deepEqual(ingestSnapshot(db, CODE_C, 'bsc', goodSnapshot({ chain: 'bsc', hero: heroF, recent: recentF, walletAddress: ADDR_F }), now - 10 * 60 * 1000), { ok: true });

  const sum = readOwnerSummary(db, now);
  assert.equal(sum.totals.users, 2);
  assert.equal(sum.totals.activeUsers, 1);
  assert.equal(sum.totals.totalTrades, 6);
  assert.equal(sum.totals.totalVolumeUsd, 2000);
  assert.equal(sum.totals.totalPnlUsd, 111);
  assert.equal(sum.activeAfterMs, 5 * 60 * 1000);
  // Sorted by profit desc: friend (+100) first.
  assert.equal(sum.users[0].address, ADDR_F);
  assert.equal(sum.users[0].trades, 1);
  assert.equal(sum.users[0].volumeUsd, 1000);
  assert.equal(sum.users[0].pnl, 100);
  assert.equal(sum.users[0].online, false);
  assert.equal(sum.users[0].lastTrade.symbol, 'XYZ');
  assert.equal(sum.users[0].lastTrade.pnl, 100);
  assert.deepEqual(sum.users[0].chains.map((c) => c.chain), ['bsc']);
  const y = sum.users[1];
  assert.equal(y.address, ADDR_Y);
  assert.equal(y.trades, 5);
  assert.equal(y.volumeUsd, 1000);
  assert.equal(y.pnl, 11);
  assert.equal(y.online, true);
  assert.equal(y.lastTrade.symbol, 'ACN'); // newest across both chains
  assert.equal(y.lastTrade.pnl, 16);
  assert.deepEqual(y.chains.map((c) => c.chain), ['arbitrum', 'ethereum']);
  db.close();
});

// B1 (audit 2026-11-23): the live DB was created before the address column
// existed. ensureRemoteTables must migrate it in place — the address index
// may only be created AFTER the ALTER, or every ingest/remote/owner call
// throws "no such column: address".
test('owner board: pre-upgrade DB without the address column migrates on first ingest', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE remote_bots (
      code_hash TEXT PRIMARY KEY, chain TEXT NOT NULL, snapshot TEXT NOT NULL,
      received_ts INTEGER NOT NULL, first_seen INTEGER NOT NULL
    );
    CREATE INDEX remote_bots_received ON remote_bots(received_ts);
  `);
  const colsBefore = db.prepare(`PRAGMA table_info(remote_bots)`).all().map((c) => c.name);
  assert.ok(!colsBefore.includes('address'));
  const now = Date.now();
  assert.deepEqual(ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot({ walletAddress: ADDR_Y }), now), { ok: true });
  const colsAfter = db.prepare(`PRAGMA table_info(remote_bots)`).all().map((c) => c.name);
  assert.ok(colsAfter.includes('address'));
  const row = db.prepare(`SELECT address FROM remote_bots WHERE code_hash = ?`).get(hashPairingCode(CODE_A));
  assert.equal(row.address, ADDR_Y);
  // The owner summary reads the migrated row; /remote still works too.
  assert.equal(readOwnerSummary(db, now).totals.users, 1);
  assert.equal(remoteJson(db, CODE_A, now).walletFingerprint, '0x1111…1111');
  db.close();
});

// S1 (audit 2026-11-23): a stored blob with wrong-typed hero values must
// not corrupt the owner totals via string concatenation.
test('owner board: wrong-typed stored hero values coerce to numbers, never strings', () => {
  const db = freshDb();
  const now = Date.now();
  ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot({ walletAddress: ADDR_Y }), now);
  const bad = goodSnapshot({ walletAddress: ADDR_Y });
  bad.hero = { trades: 'xx', volumeUsd: 'not-a-number', pnl: '5' };
  db.prepare(`UPDATE remote_bots SET snapshot = ? WHERE code_hash = ?`).run(JSON.stringify(bad), hashPairingCode(CODE_A));
  const sum = readOwnerSummary(db, now);
  assert.equal(typeof sum.totals.totalTrades, 'number');
  assert.equal(typeof sum.totals.totalVolumeUsd, 'number');
  assert.equal(typeof sum.totals.totalPnlUsd, 'number');
  assert.equal(sum.totals.totalTrades, 0);
  assert.equal(sum.totals.totalVolumeUsd, 0);
  assert.equal(sum.totals.totalPnlUsd, 5); // numeric string '5' still parses
  assert.equal(sum.users[0].trades, 0);
  assert.equal(sum.users[0].volumeUsd, 0);
  assert.equal(sum.users[0].pnl, 5);
  db.close();
});

// N3 (audit 2026-11-23): a re-paired bot (new code, same address+chain)
// must not double-count — only the latest push per (address, chain) counts.
test('owner board: re-paired bot with a new code does not double-count the chain', () => {
  const db = freshDb();
  const now = Date.now();
  const oldHero = { trades: 3, pnl: 16, gas: 12, fees: 3, wins: 2, bestToken: 'ACN', bestTokenPnl: 16, volumeUsd: 600 };
  const newHero = { trades: 10, pnl: 50, gas: 20, fees: 5, wins: 7, bestToken: 'ACN', bestTokenPnl: 50, volumeUsd: 2000 };
  ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot({ hero: oldHero, walletAddress: ADDR_Y }), now - 60 * 60 * 1000);
  ingestSnapshot(db, CODE_B, 'ethereum', goodSnapshot({ hero: newHero, walletAddress: ADDR_Y }), now);
  const sum = readOwnerSummary(db, now);
  assert.equal(sum.totals.users, 1);
  assert.equal(sum.totals.totalTrades, 10);
  assert.equal(sum.totals.totalVolumeUsd, 2000);
  assert.equal(sum.totals.totalPnlUsd, 50);
  assert.equal(sum.users[0].chains.length, 1);
  assert.equal(sum.users[0].chains[0].chain, 'ethereum');
  assert.equal(readOwnerAddress(db, ADDR_Y).chains.length, 1);
  db.close();
});

test('ownerJson: wrong/missing key denies; unknown address 404s; right key lists + details', () => {
  const db = freshDb();
  const now = Date.now();
  ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot({ walletAddress: ADDR_Y }), now);
  assert.deepEqual(ownerJson(db, '', ''), { ok: false, error: 'not found' });
  assert.deepEqual(ownerJson(db, 'zzzzzzzzzzzzzzzzzzzzzzzz', ''), { ok: false, error: 'not found' });
  assert.deepEqual(ownerJson(db, OWNER_KEY, '0x0000000000000000000000000000000000000000'), { ok: false, error: 'not found' });
  assert.deepEqual(ownerJson(db, OWNER_KEY, 'not-an-address'), { ok: false, error: 'not found' });
  const list = ownerJson(db, OWNER_KEY, '');
  assert.equal(list.ok, true);
  assert.equal(list.totals.users, 1);
  assert.equal(list.users[0].address, ADDR_Y);
  const detail = ownerJson(db, OWNER_KEY, ADDR_Y);
  assert.equal(detail.ok, true);
  assert.equal(detail.address, ADDR_Y);
  assert.equal(detail.chains.length, 1);
  assert.equal(detail.chains[0].chain, 'ethereum');
  assert.equal(detail.chains[0].snapshot.hero.pnl, 15.79);
  // The owner detail never carries the pairing code or its hash.
  assert.ok(!JSON.stringify(detail).includes(CODE_A));
  assert.ok(!JSON.stringify(detail).includes(hashPairingCode(CODE_A)));
  // readOwnerAddress: same shape, null on unknown/invalid.
  assert.equal(readOwnerAddress(db, '0x0000000000000000000000000000000000000000'), null);
  assert.equal(readOwnerAddress(db, 'junk'), null);
  assert.equal(readOwnerAddress(db, ADDR_Y).chains.length, 1);
  db.close();
});

test('remoteJson: shows the wallet fingerprint, never the raw address', () => {
  const db = freshDb();
  const now = Date.now();
  assert.equal(walletFingerprint(ADDR_Y), '0x1111…1111');
  assert.equal(walletFingerprint('junk'), null);
  assert.equal(walletFingerprint(null), null);
  ingestSnapshot(db, CODE_A, 'ethereum', goodSnapshot({ walletAddress: ADDR_Y }), now);
  const out = remoteJson(db, CODE_A, now);
  assert.ok(out);
  assert.equal(out.walletFingerprint, '0x1111…1111');
  assert.ok(out.error.includes('0x1111…1111'));
  assert.ok(!JSON.stringify(out).includes(ADDR_Y), 'raw address served on the public page');
  // No address at all (old bot): fingerprint null, page still works.
  ingestSnapshot(db, CODE_B, 'arbitrum', goodSnapshot({ chain: 'arbitrum' }), now);
  const outB = remoteJson(db, CODE_B, now);
  assert.equal(outB.walletFingerprint, null);
  assert.ok(!JSON.stringify(outB).includes(ADDR_Y));
  db.close();
});
