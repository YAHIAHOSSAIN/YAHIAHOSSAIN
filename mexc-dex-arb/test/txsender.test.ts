// Nonce manager + unresolved-tx handling (round 2 review: R2-P0-2, R2-P0-3, R2-P2-8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DROP_AFTER_MS, TxSender, classifySendError, type TxBackend, type GasInfo } from '../src/dex/txsender.js';

const gas: GasInfo = { baseFee: 10n, tip: 1n, effective: 11n, maxFee: 21n };
const tx = { to: '0xrouter', data: '0x01' };

function backend(o: { broadcastError?: unknown; mined?: boolean; confirmed?: number; knows?: boolean } = {}) {
  const state = { confirmed: o.confirmed ?? 5, signed: [] as { nonce: number; to: string; maxFeePerGas: bigint }[], receipts: new Map<string, number>(), gasReads: 0 };
  const b: TxBackend = {
    address: '0xme',
    confirmedNonce: async () => state.confirmed,
    receipt: async (h) => (state.receipts.has(h) ? { status: state.receipts.get(h)!, gasUsed: 100n, gasPrice: 2n } : null),
    knowsTx: async () => o.knows ?? true,
    sign: async (t) => {
      state.signed.push({ nonce: t.nonce, to: t.to, maxFeePerGas: t.maxFeePerGas });
      const hash = `0xh${state.signed.length}`;
      return { raw: `raw-${hash}`, hash };
    },
    broadcast: async (raw) => {
      if (o.broadcastError && raw === 'raw-0xh1') throw o.broadcastError;
      if (o.mined) state.receipts.set(raw.slice(4), 1);
    },
    gas: async () => {
      state.gasReads++;
      return { ...gas, maxFee: 1000n, tip: 50n }; // base fee spiked while we waited
    },
  };
  return { b, state };
}

const memStore = () => {
  let v: string | undefined;
  return { get: () => v, set: (x: string | null) => (v = x ?? undefined) };
};

test('classifySendError: clear rejections vs ambiguous vs already-known', () => {
  assert.equal(classifySendError(Object.assign(new Error('insufficient funds for gas * price + value'), { code: 'INSUFFICIENT_FUNDS' })), 'rejected');
  assert.equal(classifySendError(new Error('nonce too low')), 'rejected');
  assert.equal(classifySendError(Object.assign(new Error('rpc error'), { error: { code: -32000, message: 'x' } })), 'rejected');
  assert.equal(classifySendError(Object.assign(new Error('request timeout'), { code: 'TIMEOUT' })), 'ambiguous');
  assert.equal(classifySendError(new Error('socket hang up')), 'ambiguous');
  assert.equal(classifySendError(new Error('already known')), 'accepted');
});

test('mined tx: ok, nonce counts up locally', async () => {
  const { b, state } = backend({ mined: true });
  const s = new TxSender(b, memStore(), Date.now, async () => {});
  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
  assert.deepEqual(state.signed.map((x) => x.nonce), [5, 6]); // public RPC still says 5: local counter wins
});

test('RPC rejection: NOT unresolved, nonce reused, next send allowed', async () => {
  const { b, state } = backend({ broadcastError: new Error('insufficient funds for gas'), mined: true });
  const s = new TxSender(b, memStore(), Date.now, async () => {});
  const r = await s.send(tx, 100n, gas, 10);
  assert.equal(r.rejected, true);
  assert.equal(r.unknown, undefined);
  assert.equal(s.unresolved, null);
  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
  assert.deepEqual(state.signed.map((x) => x.nonce), [5, 5]);
});

test('ambiguous send error: unresolved, next send refused (not counted as an attempt)', async () => {
  const { b } = backend({ broadcastError: Object.assign(new Error('timeout'), { code: 'TIMEOUT' }) });
  const s = new TxSender(b, memStore(), Date.now, async () => {});
  const r = await s.send(tx, 100n, gas, 10);
  assert.equal(r.unknown, true);
  assert.equal(s.unresolved?.nonce, 5);
  const r2 = await s.send(tx, 100n, gas, 10);
  assert.equal(r2.refused, true);
});

test('restart with a pending tx: the persisted record still blocks sends', async () => {
  const store = memStore();
  const first = backend({ broadcastError: new Error('ECONNRESET') });
  await new TxSender(first.b, store, Date.now, async () => {}).send(tx, 100n, gas, 10);
  // "restart": a brand new sender, same store
  const again = backend({ mined: true });
  const s2 = new TxSender(again.b, store, Date.now, async () => {});
  assert.equal(s2.unresolved?.nonce, 5);
  assert.equal((await s2.send(tx, 100n, gas, 10)).refused, true);
  assert.equal(again.state.signed.length, 0); // the pending nonce was NOT reused
});

test('unresolved clears when mined, when the nonce is consumed, or when every RPC dropped it', async () => {
  let t = 1_000_000;
  const store = memStore();
  const { b, state } = backend({ broadcastError: new Error('ECONNRESET'), knows: false });
  const s = new TxSender(b, store, () => t, async (ms) => void (t += ms)); // fake clock advances on sleep
  await s.send(tx, 100n, gas, 10);
  assert.equal((await s.checkUnresolved()).state, 'pending'); // too early to call it dropped
  t += DROP_AFTER_MS + 1;
  const c = await s.checkUnresolved();
  assert.equal(c.state, 'clear');
  assert.equal(c.dropped, true);

  await s.send(tx, 100n, gas, 10).catch(() => {});
  state.confirmed = 99; // someone mined that nonce
  assert.equal((await s.checkUnresolved()).state, 'clear');
});

test('not mined in time: cancel is priced from FRESH gas, outcome unknown if neither mines', async () => {
  let t = 0;
  const { b, state } = backend();
  const s = new TxSender(b, memStore(), () => t, async (ms) => void (t += ms));
  const r = await s.send(tx, 100n, gas, 10);
  assert.equal(r.unknown, true);
  assert.equal(state.signed[1].to, '0xme'); // the cancel: 0-value self transfer, same nonce
  assert.equal(state.signed[1].nonce, 5);
  assert.ok(state.signed[1].maxFeePerGas >= 1300n); // 1.3 x the spiked fee, not the stale one
  assert.equal(s.unresolved?.hashes.length, 2);
});
