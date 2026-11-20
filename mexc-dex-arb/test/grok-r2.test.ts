// Tests for Grok's round-2 fix prompt (items 1-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TxSender, type TxBackend, type GasInfo } from '../src/dex/txsender.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { makeUnresolvedCheck, resolveTrade, startHandler } from '../src/commands.js';
import { MexcApiError, MexcRest, AmbiguousRequestError } from '../src/mexc/rest.js';
import { placeSafely } from '../src/engine.js';
import { bandProblem, closePrice, rulesFrom } from '../src/mexc/rules.js';
import { recoverExecuting } from '../src/recovery.js';

const gas: GasInfo = { baseFee: 10n, tip: 1n, effective: 11n, maxFee: 21n };
const limits = { maxTradesPerDay: 20, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 };

function backend(state: { confirmed: number; receipts: Map<string, number>; signed: number[]; store?: () => string | undefined; seenDuringBroadcast?: string }) {
  const b: TxBackend = {
    address: '0xme',
    confirmedNonce: async () => state.confirmed,
    receipt: async (h) => (state.receipts.has(h) ? { status: state.receipts.get(h)!, gasUsed: 1n, gasPrice: 1n } : null),
    knowsTx: async () => true,
    sign: async (t) => {
      state.signed.push(t.nonce);
      return { raw: `raw${state.signed.length}`, hash: `0xh${state.signed.length}` };
    },
    broadcast: async (raw) => {
      state.seenDuringBroadcast = state.store?.();
      state.receipts.set(`0xh${raw.slice(3)}`, 1);
    },
    gas: async () => gas,
  };
  return b;
}
const memStore = () => {
  let v: string | undefined;
  return { get: () => v, set: (x: string | null) => (v = x ?? undefined) };
};

// ---- 1) nonce gap ----
test('1) readyToSend: resets a local nonce that ran ahead of the chain, refuses while a tx is unresolved', async () => {
  const st = { confirmed: 5, receipts: new Map<string, number>(), signed: [] as number[] };
  const s = new TxSender(backend(st), memStore(), Date.now, async () => {});
  await s.send({ to: '0xr', data: '0x' }, 1n, gas, 5); // nonce 5, mined -> local next = 6
  // ...but the chain says 5 (e.g. that tx was replaced / dropped): a send at 6 could never be mined.
  assert.deepEqual(await s.readyToSend(), { ok: true });
  await s.send({ to: '0xr', data: '0x' }, 1n, gas, 5);
  assert.deepEqual(st.signed, [5, 5]); // reset to the chain's nonce, no gap

  const store = memStore();
  store.set(JSON.stringify({ nonce: 7, hashes: ['0xold'], since: Date.now(), unknown: true }));
  const s2 = new TxSender(backend({ confirmed: 7, receipts: new Map(), signed: [] }), store, Date.now, async () => {});
  const r = await s2.readyToSend();
  assert.equal(r.ok, false);
  assert.match(r.reason!, /nonce 7 unresolved/);
});

// ---- 3) in-flight tx persisted before broadcast ----
test('3) a tx is recorded as in flight BEFORE broadcast, and cleared once mined', async () => {
  const store = memStore();
  const st = { confirmed: 3, receipts: new Map<string, number>(), signed: [] as number[], store: store.get };
  const s = new TxSender(backend(st), store, Date.now, async () => {});
  await s.send({ to: '0xr', data: '0x' }, 1n, gas, 5);
  assert.equal(JSON.parse(st.seenDuringBroadcast!).nonce, 3); // a crash during broadcast would leave this behind
  assert.equal(s.unresolved, null); // mined -> cleared
});

// ---- 2) /start confirm ----
test('2) /start confirm is refused while a tx is pending; when clear it resets the nonce', async () => {
  const db = new Db(':memory:');
  const risk = new Risk(db, 'live', limits);
  let pending = true;
  let resets = 0;
  const chain = {
    get unresolved() {
      return pending ? { nonce: 9, hashes: ['0xa', '0xb'] } : null;
    },
    checkUnresolved: async () => ({ state: pending ? ('pending' as const) : ('clear' as const) }),
    resetNonce: () => void resets++,
  };
  const start = startHandler(risk, async () => 'status', makeUnresolvedCheck(db, chain));
  risk.pause('DEX tx unknown 0xa', true);
  assert.match(await start(['confirm']), /Not resuming.*nonce 9.*\/cancelnonce/s);
  assert.equal(risk.paused, true);
  pending = false;
  assert.match(await start(['confirm']), /resumed/i);
  assert.equal(risk.paused, false);
  assert.equal(resets, 1);
});

// ---- 9) not-found logic ----
test('9) getOrderByClientId: only MEXC code -2011 means "no such order"; "currency does not exist" is rethrown', async () => {
  const mk = (status: number, body: object) =>
    new MexcRest('k', 's', 'https://x', (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);
  assert.equal(await mk(400, { code: -2011, msg: 'Unknown order sent.' }).getOrderByClientId('X', 'c'), null);
  await assert.rejects(mk(400, { code: 10232, msg: 'currency does not exist' }).getOrderByClientId('X', 'c'), (e) => e instanceof MexcApiError && e.code === 10232);
});

test('9) placeSafely: a 5xx followed by "not found" is UNKNOWN_ORDER_STATE, never "not placed"', async () => {
  const sleep = async () => {};
  await assert.rejects(
    placeSafely({ getOrderByClientId: async () => null }, 'X', 'cid', async () => { throw new AmbiguousRequestError('503'); }, sleep),
    /UNKNOWN_ORDER_STATE/,
  );
});

// ---- 8) price band ----
const sym = (band: string) =>
  rulesFrom({ symbol: 'X', baseAsset: 'X', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0', baseAssetPrecision: 2, quotePrecision: 4, orderTypes: ['LIMIT'], filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: band, askMultiplierDown: band }] });

test('8) a 0.5% band clamps the close price; with a wide band the 2% close is used', () => {
  const book = { bid: 99.9, ask: 100.1 }; // ref 100
  assert.equal(closePrice(sym('0.005'), 'BUY', book), 100.4); // 100 * (1 + 0.8 * 0.005), not 102.1
  assert.equal(closePrice(sym('0.005'), 'SELL', book), 99.6);
  assert.equal(closePrice(sym('0.2'), 'BUY', book), 102.102); // ask * 1.02
});

test('8) an entry limit outside the band is rejected', () => {
  assert.match(bandProblem(sym('0.02'), 'BUY', 103, 100)!, /above/);
  assert.equal(bandProblem(sym('0.02'), 'BUY', 101.5, 100), null);
  assert.match(bandProblem(sym('0.02'), 'SELL', 97, 100)!, /below/);
});

// ---- 6) recovery: open orders and close orders ----
test('6) recovery cancels a close order that is still open and sweeps open bot orders', async () => {
  const db = new Db(':memory:');
  const risk = new Risk(db, 'live', limits);
  const id = db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 50, qty: 5, buy_price: 10, sell_price: 11, expected_net: 2, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: null, cex_order_id: 'arbt1', note: 'client order id arbt1' });
  db.appendCid(id, 'arbt1');
  db.appendCid(id, 'arbc2'); // an unwind close placed just before the crash
  const status: Record<string, string> = { '1': 'FILLED', '2': 'NEW', '3': 'NEW' };
  const cancelled: string[] = [];
  const alerts: string[] = [];
  await recoverExecuting(
    db, risk, { send: async (t) => void alerts.push(t) },
    {
      getOrderByClientId: async (_s, cid) => ({ orderId: cid === 'arbt1' ? '1' : '2', status: status[cid === 'arbt1' ? '1' : '2'], executedQty: cid === 'arbt1' ? '5' : '0' }) as never,
      getOrder: async (_s, oid) => ({ orderId: oid, status: status[oid], executedQty: '0' }) as never,
      cancelOrder: async (_s, oid) => ((cancelled.push(oid), (status[oid] = 'CANCELED')), {} as never),
      openOrders: async () => [{ orderId: '3', status: 'NEW', executedQty: '0', clientOrderId: 'arbc9', side: 'SELL', origQty: '1' }] as never,
    },
    async () => null,
    async () => ({ state: 'clear' }),
    { symbols: ['LINKUSDT'], sleep: async () => {} },
  );
  assert.deepEqual(cancelled.sort(), ['2', '3']);
  assert.equal(risk.critical, true);
  assert.ok(alerts[0].includes('was open -> cancelled'));
  assert.equal(db.unresolvedTrades().length, 1); // pnl unknown until /resolve
});

// ---- 10e) /resolve ----
test('10e) /resolve books the PnL of a one-sided trade and removes it from the list', () => {
  const db = new Db(':memory:');
  const id = db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 50, qty: 5, buy_price: 10, sell_price: 11, expected_net: 2, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'one_sided', dex_tx: null, cex_order_id: null, note: 'x; pnl unknown' });
  assert.match(resolveTrade(db, undefined, undefined), /Usage/);
  assert.match(resolveTrade(db, String(id), '-3.2'), /booked/);
  assert.equal(db.unresolvedTrades().length, 0);
  assert.equal(db.statsSince(0, 'live').total.pnl, -3.2);
});
