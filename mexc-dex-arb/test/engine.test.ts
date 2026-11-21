// End-to-end tests of the trading engine with fake MEXC, chain and aggregator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { Engine } from '../src/engine.js';
import type { Balances } from '../src/inventory.js';
import type { Token } from '../src/watchlist.js';
import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
import type { TxResult } from '../src/dex/chain.js';
import { AmbiguousRequestError, type Book, type Order } from '../src/mexc/rest.js';

const GWEI = 1_000_000_000n;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const LINK: Token = {
  base: 'LINK', symbol: 'LINKUSDT', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18,
  qtyStep: 0.01, priceDecimals: 3, dexTvlUsd: 1e6, mexcVolumeUsd: 1e7, depositOk: true, withdrawOk: true,
  rules: { qtyStep: 0.01, priceDecimals: 3, minQty: 0.01, minNotional: 1, maxNotional: 2e6, orderTypes: ['LIMIT', 'MARKET', 'LIMIT_MAKER'], tradeSideType: 1 },
};

function setup(opts: {
  mode?: 'live' | 'paper';
  bid?: number;
  gasGwei?: bigint;
  dexOk?: boolean;
  simulateThrows?: boolean;
  approvalNeeded?: boolean;
  mexcFillRatio?: number;
  closeFillRatio?: number;
  dexUnknown?: boolean;
  placeAmbiguous?: boolean;
  minNotional?: number;
  unresolved?: boolean;
  notReady?: boolean;
  usdcUsdt?: number;
}) {
  process.env.MODE = opts.mode ?? 'live';
  process.env.RPC_URL = 'http://localhost';
  process.env.MAX_TRADE_USD = '200'; // tests use $200 trades (default is 50)
  process.env.MIN_PROFIT_USD = '15';
  // These older tests keep the pre-upgrade cost settings, so their numbers stay meaningful.
  process.env.MIN_PROFIT_BPS = '50';
  process.env.SAFETY_MARGIN_USD = '2';
  process.env.SAFETY_MARGIN_BPS = '0';
  process.env.CEX_SLIPPAGE_BPS = '20';
  process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
  process.env.MEXC_API_KEY = 'k'.repeat(10);
  process.env.MEXC_API_SECRET = 's'.repeat(10);
  const cfg = loadConfig();
  const db = new Db(':memory:');
  const risk = new Risk(db, cfg.mode, cfg);
  const alerts: string[] = [];
  const calls: string[] = [];

  const fee = cfg.mexcTakerFee;
  const bid = opts.bid ?? 11.2;
  // Real-ish balances that the fakes update, so PnL is computed from balance changes.
  const bal: Balances = { walletEth: 1, walletUsdc: 1000, walletToken: { LINK: 100 }, mexc: { USDT: 1000, LINK: 100 } };
  const ethUsd = 2000;

  const books: Record<string, Book> = {
    ETHUSDT: { bids: [[ethUsd, 100]], asks: [[ethUsd, 100]], ts: Date.now() },
    USDCUSDT: { bids: [[opts.usdcUsdt ?? 1, 1e6]], asks: [[opts.usdcUsdt ?? 1, 1e6]], ts: Date.now() },
    LINKUSDT: { bids: [[bid, 1000]], asks: [[bid + 0.01, 1000]], ts: Date.now() },
  };

  // DEX price = 10 USDC per LINK, 0.1% minOut buffer.
  const dexQuote = (r: QuoteRequest, firm: boolean): Quote => {
    const buyingToken = r.sellToken === USDC;
    const out = buyingToken ? (r.sellAmount * 10n ** 12n) / 10n : (r.sellAmount * 10n) / 10n ** 12n;
    return {
      buyAmount: out,
      minBuyAmount: (out * 999n) / 1000n,
      gas: 150_000n,
      spender: '0xspender',
      tx: firm ? { to: '0xrouter', data: '0xdead', value: 0n } : undefined,
    };
  };
  let lastFirm: QuoteRequest | null = null;

  const orders = new Map<string, Order>();
  const byCid = new Map<string, string>();
  let nextId = 1;
  const fill = (side: 'BUY' | 'SELL', qty: number, price: number) => {
    if (side === 'SELL') {
      bal.mexc.LINK -= qty;
      bal.mexc.USDT += qty * price * (1 - fee);
    } else {
      bal.mexc.LINK += qty * (1 - fee);
      bal.mexc.USDT -= qty * price;
    }
  };

  const token = { ...LINK, rules: { ...LINK.rules, minNotional: opts.minNotional ?? 1 } };
  const engine = new Engine({
    cfg,
    db,
    risk,
    tokens: [token],
    sleep: async () => {},
    tg: { send: async (t) => void alerts.push(t) },
    book: async (s) => books[s],
    balances: async () => structuredClone(bal),
    agg: {
      name: '0x',
      price: async (r) => dexQuote(r, false),
      quote: async (r) => ((lastFirm = r), dexQuote(r, true)),
    },
    chain: {
      address: '0xme',
      gas: async () => {
        const base = (opts.gasGwei ?? 9n) * GWEI;
        return { baseFee: base, tip: GWEI, effective: base + GWEI, maxFee: base * 2n + GWEI };
      },
      approvalGasNeeded: async () => (opts.approvalNeeded ? 60_000n : 0n),
      approveExact: async (_t, _s, amount) => {
        calls.push(`approve ${amount}`);
        bal.walletEth -= 0.0006;
        return { ok: true, gasCostWei: 600_000n * GWEI };
      },
      checkUnresolved: async () => ({ state: opts.unresolved ? 'pending' : 'clear' }),
      readyToSend: async () => (opts.notReady ? { ok: false, reason: 'nonce gap' } : { ok: true }),
      simulate: async () => {
        calls.push('simulate');
        if (opts.simulateThrows) throw new Error('execution reverted');
        return 150_000n;
      },
      send: async (): Promise<TxResult> => {
        calls.push('send');
        const gasWei = 150_000n * 10n * GWEI;
        bal.walletEth -= 0.0015;
        if (opts.dexUnknown) return { ok: false, unknown: true, hash: '0xtx', gasCostWei: 0n, reason: 'unknown' };
        if (opts.dexOk === false) return { ok: false, hash: '0xtx', gasCostWei: gasWei, reason: 'reverted' };
        const r = lastFirm!;
        if (r.sellToken === USDC) {
          bal.walletUsdc -= Number(r.sellAmount) / 1e6;
          bal.walletToken.LINK += (Number(r.sellAmount) / 1e6) / 10;
        } else {
          const tokens = Number(r.sellAmount) / 1e18;
          bal.walletToken.LINK -= tokens;
          bal.walletUsdc += tokens * 10;
        }
        return { ok: true, hash: '0xtx', gasCostWei: gasWei };
      },
    },
    mexc: {
      limitOrder: async (_s, side, q, p, cid) => {
        calls.push(`limit ${side} ${q} @ ${p}`);
        const id = String(nextId++);
        const first = id === '1';
        const filled = Number(q) * ((first ? opts.mexcFillRatio : opts.closeFillRatio) ?? 1);
        fill(side, filled, Number(p));
        orders.set(id, { orderId: id, status: filled === Number(q) ? 'FILLED' : 'PARTIALLY_FILLED', executedQty: String(filled), cummulativeQuoteQty: '0', origQty: q, price: p, side });
        if (cid) byCid.set(cid, id);
        // MEXC executed it, but our HTTP request timed out / got a 5xx:
        if (first && opts.placeAmbiguous) throw new AmbiguousRequestError('MEXC POST /api/v3/order -> 503');
        return { orderId: id };
      },
      marketSell: async (_s, q) => {
        calls.push(`market SELL ${q}`);
        const filled = Number(q) * (opts.marketFillRatio ?? 1);
        fill('SELL', filled, bid);
        orders.set('m', { orderId: 'm', status: 'FILLED', executedQty: String(filled), cummulativeQuoteQty: String(filled * bid), origQty: q, price: '0', side: 'SELL' });
        return { orderId: 'm' };
      },
      getOrderByClientId: async (_s, cid) => (byCid.has(cid) ? orders.get(byCid.get(cid)!)! : null),
      getOrder: async (_s, id) => orders.get(id)!,
      cancelOrder: async (_s, id) => {
        calls.push(`cancel ${id}`);
        const o = orders.get(id)!;
        o.status = 'PARTIALLY_CANCELED';
        return o;
      },
    },
  });
  return { engine, db, risk, alerts, calls, bal, cfg };
}

const trades = (db: Db) => db.statsSince(0);

test('profitable gap: both legs trade, PnL comes from real balance changes', async () => {
  const { engine, db, alerts, calls } = setup({});
  await engine.tick();
  // MEXC sell 20 LINK (bought 20 on DEX for $200), limit = 11.2 * (1 - 0.2%) rounded down.
  // MEXC sells what the DEX guarantees (minBuyAmount 19.98), not the expected 20.
  assert.deepEqual(calls, ['simulate', 'limit SELL 19.98 @ 11.177', 'send']);
  const s = trades(db);
  assert.equal(s.total.trades, 1);
  assert.equal(s.total.failed, 0);
  // +20 LINK in wallet, -19.98 on MEXC (0.02 kept, valued at mid 11.205); -$200 USDC; USDT in; -0.0015 ETH gas
  const expected = -200 + 19.98 * 11.177 * 0.9995 + 0.02 * 11.205 - 0.0015 * 2000;
  assert.ok(Math.abs(s.total.pnl - expected) < 1e-6, `${s.total.pnl} vs ${expected}`);
  assert.ok(Math.abs(s.total.gas - 3) < 1e-9);
  assert.ok(alerts.some((a) => a.includes('✅ LIVE LINK DEX_BUY [ok]') && a.includes('Net PnL')));
});

test('no trade when the gap is below max($15, 0.5%)', async () => {
  const { engine, db, calls } = setup({ bid: 10.9 });
  await engine.tick();
  assert.deepEqual(calls, []);
  assert.equal(trades(db).total.trades, 0);
});

test('DEX leg fails after MEXC sold: buys back at market, alerts one-sided', async () => {
  const { engine, db, alerts, calls, bal } = setup({ dexOk: false });
  await engine.tick();
  // close: 2% over ask 11.21 = 11.4342, rounded DOWN (stays inside the price band)
  assert.ok(calls.includes('limit BUY 19.98 @ 11.434'));
  const row = trades(db);
  assert.equal(row.total.failed, 1);
  assert.ok(alerts.some((a) => a.startsWith('⚠️ ONE-SIDED FILL LINK')));
  assert.ok(Math.abs(bal.walletToken.LINK - 100) < 1e-9); // wallet untouched
  assert.ok(Math.abs(bal.mexc.LINK - 100 + 19.98 * 0.0005) < 1e-9); // flat again except the fee
});

test('MEXC partial fill: rest is cancelled and closed at market', async () => {
  const { engine, calls } = setup({ mexcFillRatio: 0.5 });
  await engine.tick();
  assert.ok(calls.includes('cancel 1'));
  assert.ok(calls.includes('limit SELL 9.99 @ 10.976')); // rest closed with an aggressive limit 2% under the bid
});

test('simulation failure: nothing is sent, approval gas is still booked', async () => {
  const { engine, db, calls } = setup({ simulateThrows: true, approvalNeeded: true });
  await engine.tick();
  assert.ok(calls[0].startsWith('approve 200000000')); // exact amount: 200 USDC, never MaxUint256
  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
  const s = trades(db);
  assert.equal(s.total.trades, 0); // approval rows are not trades
  assert.ok(s.total.pnl < 0 && s.total.gas > 0);
});

test('gas above MAX_GAS_GWEI: no quotes at all', async () => {
  const { engine, calls } = setup({ gasGwei: 50n });
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('kill switch: paused bot does nothing', async () => {
  const { engine, risk, calls } = setup({});
  risk.pause('Telegram /stop');
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('3 failed trades in a row pause trading', async () => {
  const { engine, risk, alerts } = setup({ dexOk: false });
  await engine.tick();
  await engine.tick();
  await engine.tick();
  assert.equal(risk.paused, true);
  assert.ok(alerts.some((a) => a.includes('3 failed trades in a row')));
  const before = alerts.length;
  await engine.tick();
  assert.equal(alerts.length, before); // stays stopped
});

test('paper mode: records the trade, sends nothing real', async () => {
  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
  await engine.tick();
  assert.deepEqual(calls, []);
  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER LINK')));
});

test('DEX outcome unknown: NO automatic unwind, trading paused', async () => {
  const { engine, risk, calls, alerts } = setup({ dexUnknown: true });
  await engine.tick();
  assert.ok(!calls.some((c) => c.startsWith('market') || c.startsWith('limit BUY')));
  assert.equal(risk.paused, true);
  assert.ok(alerts.some((a) => a.includes('outcome UNKNOWN')));
});

test('unwind SELL that only partly fills is detected (not assumed flat)', async () => {
  const { engine, risk, calls, alerts } = setup({ mexcFillRatio: 0.5, closeFillRatio: 0.5 });
  await engine.tick();
  assert.ok(calls.includes('limit SELL 9.99 @ 10.976'));
  assert.equal(risk.paused, true);
  assert.equal(risk.critical, true);
  // reports what is REALLY still open (half of 9.99), not the full quantity
  assert.ok(alerts.some((a) => a.includes('market close FAILED') && a.includes('Still open: MEXC SELL 5 LINK')));
});

test('MEXC 5xx on order placement: found by clientOrderId, no double sell', async () => {
  const { engine, db, calls } = setup({ placeAmbiguous: true });
  await engine.tick();
  assert.equal(calls.filter((c) => c.startsWith('limit SELL')).length, 1); // never re-sent, never "unwound"
  assert.ok(!calls.some((c) => c.startsWith('limit BUY')));
  assert.equal(trades(db).total.failed, 0);
});

test('order below MEXC minNotional: rejected BEFORE any DEX tx', async () => {
  const { engine, calls } = setup({ minNotional: 1000 });
  await engine.tick();
  assert.deepEqual(calls, []); // no simulate, no send, no MEXC order
});

test('unresolved earlier DEX tx: no new trades', async () => {
  const { engine, calls } = setup({ unresolved: true });
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('critical pause needs /start confirm; soft pause does not', () => {
  const { risk } = setup({});
  risk.pause('Telegram /stop');
  assert.equal(risk.resume(), true);
  risk.pause('DEX tx unknown 0xabc', true);
  risk.pause('Telegram /stop'); // a later soft pause must not downgrade it
  assert.equal(risk.critical, true);
  assert.equal(risk.resume(), false);
  assert.equal(risk.paused, true);
  assert.equal(risk.resume(true), true);
  assert.equal(risk.paused, false);
});

test('worst case beyond the remaining daily loss budget: skipped before any order', async () => {
  const { engine, db, calls } = setup({});
  db.insertTrade({ ts: Date.now(), day: (await import('../src/util.js')).dhakaDay(), mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 1, qty: 1, buy_price: 1, sell_price: 1, expected_net: 0, cex_fee_usd: 0, gas_usd: 0, pnl_usd: -25, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
  await engine.tick(); // budget left $5 < 5% of $200 + gas
  assert.deepEqual(calls, []);
});

test('restart with an executing row: looked up, reported, paused until /start confirm', async () => {
  const { db, risk } = setup({});
  const { recoverExecuting } = await import('../src/recovery.js');
  db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 200, qty: 19.98, buy_price: 10, sell_price: 11, expected_net: 18, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: '0xpending', cex_order_id: 'cidX', note: 'client order id cidX; nonce 7' });
  const alerts: string[] = [];
  await recoverExecuting(
    db, risk, { send: async (t) => void alerts.push(t) },
    { getOrderByClientId: async () => ({ orderId: '9', status: 'FILLED', executedQty: '19.98' }) as Order },
    async () => null,
  );
  assert.equal(risk.paused, true);
  assert.equal(risk.critical, true);
  assert.equal(risk.resume(), false);
  assert.equal(db.executingTrades().length, 0);
  assert.ok(alerts[0].includes('MEXC cidX (order 9): FILLED, filled 19.98') && alerts[0].includes('NOT MINED'));
});

test('recovery: both legs done -> trade marked ok, no critical pause', async () => {
  const { db, risk } = setup({});
  const { recoverExecuting } = await import('../src/recovery.js');
  db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 200, qty: 19.98, buy_price: 10, sell_price: 11, expected_net: 18, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: '0xdone', cex_order_id: 'cidY', note: 'client order id cidY; nonce 8' });
  const alerts: string[] = [];
  await recoverExecuting(
    db, risk, { send: async (t) => void alerts.push(t) },
    { getOrderByClientId: async () => ({ orderId: '9', status: 'FILLED', executedQty: '19.98' }) as Order },
    async () => ({ status: 1 }),
    async () => ({ state: 'clear' }),
  );
  assert.equal(risk.paused, false);
  assert.equal(db.statsSince(0, 'live').total.failed, 0);
  assert.ok(alerts[0].includes('All legs completed'));
});

test('recovery: a pending DEX tx from before the restart keeps the bot critically paused', async () => {
  const { db, risk } = setup({});
  const { recoverExecuting } = await import('../src/recovery.js');
  await recoverExecuting(db, risk, { send: async () => {} }, { getOrderByClientId: async () => null }, async () => null, async () => ({ state: 'pending' }));
  assert.equal(risk.critical, true);
});

test('critical resume does not reset the failure streak', () => {
  const { risk, db } = setup({});
  db.setState('consecutive_fails', '2');
  risk.pause('DEX tx unknown', true);
  risk.resume(true);
  assert.equal(risk.consecutiveFails, 2);
});

test('nonce not ready (gap / unresolved): the MEXC leg never fires', async () => {
  const { engine, calls } = setup({ notReady: true });
  await engine.tick();
  assert.ok(calls.includes('simulate')); // got as far as the final checks
  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
});

test('stale or unreasonable USDC/USDT rate: no trading', async () => {
  const off = setup({ usdcUsdt: 1.05 });
  await off.engine.tick();
  assert.deepEqual(off.calls, []);
});
