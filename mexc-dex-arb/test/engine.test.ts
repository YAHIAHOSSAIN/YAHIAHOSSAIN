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
import type { Book, Order } from '../src/mexc/rest.js';

const GWEI = 1_000_000_000n;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const LINK: Token = {
  base: 'LINK', symbol: 'LINKUSDT', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18,
  qtyStep: 0.01, priceDecimals: 3, dexTvlUsd: 1e6, mexcVolumeUsd: 1e7, depositOk: true, withdrawOk: true,
};

function setup(opts: {
  mode?: 'live' | 'paper';
  bid?: number;
  gasGwei?: bigint;
  dexOk?: boolean;
  simulateThrows?: boolean;
  approvalNeeded?: boolean;
  mexcFillRatio?: number;
}) {
  process.env.MODE = opts.mode ?? 'live';
  process.env.RPC_URL = 'http://localhost';
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

  const engine = new Engine({
    cfg,
    db,
    risk,
    tokens: [LINK],
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
      simulate: async () => {
        calls.push('simulate');
        if (opts.simulateThrows) throw new Error('execution reverted');
        return 150_000n;
      },
      send: async (): Promise<TxResult> => {
        calls.push('send');
        const gasWei = 150_000n * 10n * GWEI;
        bal.walletEth -= 0.0015;
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
      limitOrder: async (_s, side, q, p) => {
        calls.push(`limit ${side} ${q} @ ${p}`);
        const id = String(nextId++);
        const filled = Number(q) * (opts.mexcFillRatio ?? 1);
        fill(side, filled, Number(p));
        orders.set(id, { orderId: id, status: filled === Number(q) ? 'FILLED' : 'PARTIALLY_FILLED', executedQty: String(filled), cummulativeQuoteQty: '0', origQty: q, price: p, side });
        return { orderId: id };
      },
      marketSell: async (_s, q) => {
        calls.push(`market SELL ${q}`);
        fill('SELL', Number(q), bid);
        return { orderId: 'm' };
      },
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
  assert.deepEqual(calls, ['simulate', 'limit SELL 20.00 @ 11.177', 'send']);
  const s = trades(db);
  assert.equal(s.total.trades, 1);
  assert.equal(s.total.failed, 0);
  // +20 LINK in wallet, -20 on MEXC; -$200 USDC; +20*11.177*(1-0.0005) USDT; -0.0015 ETH gas
  const expected = -200 + 20 * 11.177 * 0.9995 - 0.0015 * 2000;
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
  assert.ok(calls.includes('limit BUY 20.00 @ 11.435')); // close: aggressive limit 2% over ask 11.21
  const row = trades(db);
  assert.equal(row.total.failed, 1);
  assert.ok(alerts.some((a) => a.startsWith('⚠️ ONE-SIDED FILL LINK')));
  assert.ok(Math.abs(bal.walletToken.LINK - 100) < 1e-9); // wallet untouched
  assert.ok(Math.abs(bal.mexc.LINK - 100 + 20 * 0.0005) < 1e-9); // flat again except the fee
});

test('MEXC partial fill: rest is cancelled and closed at market', async () => {
  const { engine, calls } = setup({ mexcFillRatio: 0.5 });
  await engine.tick();
  assert.ok(calls.includes('cancel 1'));
  assert.ok(calls.includes('market SELL 10.00'));
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
