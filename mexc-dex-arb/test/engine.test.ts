// End-to-end tests of the trading engine with fake MEXC, chain and aggregator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hurdleBps, loadConfig } from '../src/config.js';
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
  minPoolLiquidityUsd?: number; // MIN_POOL_LIQUIDITY_USD knob for this engine (default 150000)
  dexTvlUsd?: number; // best-pool TVL for LINK (default 1e6, deep)
  dexArbEnabled?: boolean; // DEX_ARB_ENABLED knob for this engine (default false = detection off)
  lowX?: number; // REBALANCE_LOW_X knob for this engine (default 1)
  dexSellBoost?: number; // multiply the fake DEX sell-leg output (default 1): makes a DEX-DEX spread appear
  chain?: string; // CHAIN for this engine (default 'ethereum')
  minProfitBpsEth?: number; // MIN_PROFIT_BPS_ETH knob (default 0 = off, falls back to MIN_PROFIT_BPS)
  builderTipGwei?: number; // BUILDER_TIP_GWEI knob (default 0 = off)
}) {
  process.env.CHAIN = opts.chain ?? 'ethereum';
  process.env.MODE = opts.mode ?? 'live';
  process.env.RPC_URL = 'http://localhost';
  process.env.MAX_TRADE_USD = '200'; // tests use $200 trades (default is 50)
  process.env.MIN_TRADE_USD = '25'; // default: the multi-size test quotes 0.5x of the $100 base = $50
  process.env.TRANSFER_DRIFT_BPS = '150'; // default: pin so a VPS .env value cannot leak in
  process.env.QUOTE_RPS_VELORA = '1'; // pin the code defaults (a VPS .env value cannot leak in)
  process.env.QUOTE_RPS_OPENOCEAN = '2';
  // Pin the Phase-4 knobs to their code defaults (a VPS .env value cannot leak in).
  process.env.REBALANCE_LOW_X = String(opts.lowX ?? 1);
  process.env.DEX_ARB_ENABLED = opts.dexArbEnabled ? 'yes' : 'no';
  process.env.MIN_PROFIT_USD = '15';
  // Pin the depth-filter knobs to their code defaults (a VPS .env value
  // would otherwise leak in and change which fake pools pass).
  process.env.MIN_POOL_LIQUIDITY_USD = String(opts.minPoolLiquidityUsd ?? 150000);
  process.env.DEPTH_MAX_IMPACT_BPS = '70';
  process.env.DEPTH_MAX_SIZE_PCT = '1';
  // These older tests keep the pre-upgrade cost settings, so their numbers stay meaningful.
  process.env.MIN_PROFIT_BPS = '50';
  process.env.MIN_PROFIT_BPS_ETH = String(opts.minProfitBpsEth ?? 0); // pin the Phase-5 hurdle (0 = off)
  process.env.BUILDER_TIP_GWEI = String(opts.builderTipGwei ?? 0); // pin the Phase-5 builder tip (0 = off)
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

  // DEX price = 10 USDC per LINK, 0.1% minOut buffer. With dexSellBoost, the
  // token->USDC leg pays more (a cross-pool spread for the DEX-DEX scan only).
  const boost = BigInt(Math.round((opts.dexSellBoost ?? 1) * 100));
  const dexQuote = (r: QuoteRequest, firm: boolean): Quote => {
    const buyingToken = r.sellToken === cfg.usdc; // chain's DEX stable (Ethereum USDC here; Arbitrum's own USDC on that chain)
    const out = buyingToken ? (r.sellAmount * 10n ** 12n) / 10n : ((r.sellAmount * 10n) / 10n ** 12n) * boost / 100n;
    return {
      buyAmount: out,
      minBuyAmount: (out * 999n) / 1000n,
      gas: 150_000n,
      spender: '0xspender',
      tx: firm ? { to: '0xrouter', data: '0xdead', value: 0n } : undefined,
    };
  };
  let lastFirm: QuoteRequest | null = null;

  const priced: bigint[] = []; // sellAmount of every indicative DEX quote
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

  const token = { ...LINK, dexTvlUsd: opts.dexTvlUsd ?? 1e6, rules: { ...LINK.rules, minNotional: opts.minNotional ?? 1 } };
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
      price: async (r) => (priced.push(r.sellAmount), dexQuote(r, false)),
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
        if (r.sellToken === cfg.usdc) {
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
  return { engine, db, risk, alerts, calls, bal, cfg, priced };
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
  assert.ok(alerts.some((a) => a.includes('https://etherscan.io/tx/0xtx'))); // chain explorer, not a hardcoded host (round-3 L4)
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

// ---------------- Phase-1 upgrade: items 2, 4e, 5 ----------------
const opps = (db: Db) => db.all<{ token: string; direction: string; size_usd: number | null; decision: string; reason: string | null; net_usd: number | null; gross_bps: number | null }>('SELECT * FROM opportunities');

test('every evaluated candidate is logged to opportunities, with its decision', async () => {
  const { engine, db } = setup({ bid: 10.9 }); // below the hurdle
  await engine.tick();
  const rows = opps(db);
  assert.ok(rows.length >= 2); // both directions
  assert.ok(rows.every((r) => r.token === 'LINK'));
  assert.ok(rows.some((r) => r.decision === 'below_hurdle' && r.gross_bps !== null && r.net_usd !== null));
});

test('a traded candidate is logged as trade; paused ticks are logged as paused', async () => {
  const s1 = setup({});
  await s1.engine.tick();
  assert.ok(opps(s1.db).some((r) => r.decision === 'trade'));
  const s2 = setup({});
  s2.risk.pause('Telegram /stop');
  await s2.engine.tick();
  assert.ok(opps(s2.db).every((r) => r.decision === 'paused'));
});

test('multi-size: near the hurdle, the depth ladder (100/75/50% of safe size) is quoted and the best net is used', async () => {
  // Grok v2 review: the inventory ladder is the transfer ladder. $50k pool
  // (floor lowered to 0, or the pool-floor reject would fire first): safe
  // size is 0.7% of the $25k half = $175, ladder $175 / $131 / $87. At a
  // 10% gap the $175 gross (~$17.40) is below the $15 need but close
  // (0.7 * need = $10.50), so the smaller steps are quoted too; the $87
  // gross (~$8.65) is no longer close, so the ladder stops there. No size
  // passes, so no trade is booked — the largest net ($175) is the best.
  const { engine, priced, db } = setup({ dexTvlUsd: 50_000, minPoolLiquidityUsd: 0, bid: 11 });
  await engine.tick();
  assert.deepEqual(usdcSizes(priced), [175, 131, 87]);
  assert.equal(trades(db).total.trades, 0);
});

test('legs: a live trade writes one dex and one mexc leg with latency', async () => {
  const { engine, db } = setup({});
  await engine.tick();
  const legs = db.all<{ leg: string; quoted_price: number; executed_qty: number | null; latency_quote_ms: number | null; latency_mexc_ack_ms: number | null }>('SELECT * FROM legs');
  assert.deepEqual(legs.map((l) => l.leg).sort(), ['dex', 'mexc']);
  assert.ok(legs.find((l) => l.leg === 'dex')!.latency_quote_ms !== null);
  assert.equal(legs.find((l) => l.leg === 'mexc')!.executed_qty, 19.98);
});

test('paper: the trade is booked at the re-quoted net, not the first quote', async () => {
  const { engine, db } = setup({ mode: 'paper' });
  await engine.tick();
  const t = db.all<{ pnl_usd: number; expected_net: number; requoted_net: number | null }>("SELECT * FROM trades WHERE mode = 'paper'")[0];
  assert.ok(t.requoted_net !== null);
  assert.equal(t.pnl_usd, t.requoted_net);
});

test('skewed hurdle: a trade that worsens the wallet/MEXC balance needs more, one that restores it needs less', () => {
  const { engine, bal } = setup({});
  const tok = { ...LINK, rules: { ...LINK.rules } };
  const plain = 15; // need without skew: max(MIN_PROFIT_USD 15, 50 bps of $200)
  const lopsided = { ...bal, walletToken: { LINK: 150 }, mexc: { ...bal.mexc, LINK: 50 } }; // 75% in the wallet
  const worse = engine.needFor(tok, 'DEX_BUY', 200, lopsided, 10); // 75% -> 85% wallet: worse by 0.10
  const better = engine.needFor(tok, 'CEX_BUY', 200, lopsided, 10); // 75% -> 65%: restores
  assert.ok(Math.abs(worse - plain * (1 + 0.75 * 0.1)) < 1e-9, String(worse)); // SKEW_K 0.75
  assert.ok(Math.abs(better - plain * 0.8) < 1e-9, String(better));
});

test('rebalance ticket: a side low for REBALANCE_AFTER_MIN opens ONE ticket and alerts once', async () => {
  process.env.REBALANCE_AFTER_MIN = '0';
  try {
    const { engine, db, alerts, bal } = setup({});
    bal.mexc.LINK = 0.5; // MEXC side of LINK far below 1x the trade size
    await engine.tick();
    await engine.tick();
    const open = db.openTickets().filter((k) => k.token === 'LINK' && k.side === 'mexc');
    assert.equal(open.length, 1);
    assert.match(open[0].direction, /deposit wallet→MEXC/);
    assert.equal(alerts.filter((a) => a.startsWith('🎫 Rebalance ticket') && a.includes('LINK')).length, 1);
  } finally {
    delete process.env.REBALANCE_AFTER_MIN;
  }
});

test('expected_net subtracts the approval gas already spent (round-3 L3)', async () => {
  const readExpected = (db: Db) =>
    db.all<{ expected_net: number }>(`SELECT expected_net FROM trades WHERE status = 'ok'`).map((r) => r.expected_net);
  const a = setup({});
  await a.engine.tick();
  const b = setup({ approvalNeeded: true });
  await b.engine.tick();
  assert.equal(readExpected(a.db).length, 1);
  assert.equal(readExpected(b.db).length, 1);
  // Same quotes, same books: the re-checked net is identical; only the approval gas ($1.20) differs.
  // The approval gas sits inside the balance-based PnL, so the stored expectation must not promise it back.
  assert.ok(Math.abs((readExpected(a.db)[0] - readExpected(b.db)[0]) - 1.2) < 1e-9,
    `${readExpected(a.db)[0]} vs ${readExpected(b.db)[0]}`);
});

test('L1_FEE_USD reserve lowers the estimated net (round-3 M1)', async () => {
  const saved = { ...process.env };
  try {
    const run = async () => {
      const { engine, db } = setup({ mode: 'paper' });
      await engine.tick();
      return db.all<{ expected_net: number }>(`SELECT expected_net FROM trades WHERE status = 'paper'`).map((r) => r.expected_net);
    };
    delete process.env.L1_FEE_USD;
    const base = await run();
    process.env.L1_FEE_USD = '2';
    const withReserve = await run();
    assert.equal(base.length, 1);
    assert.equal(withReserve.length, 1);
    assert.ok(Math.abs((base[0] - withReserve[0]) - 2) < 1e-9, `${base[0]} vs ${withReserve[0]}`);
  } finally {
    process.env = saved;
  }
});

// ---------------- Phase 1 depth filter ----------------
test('depth reject: a thin pool writes a rule row and spends no DEX quote', async () => {
  const { engine, db, priced } = setup({ dexTvlUsd: 42_000 });
  await engine.tick();
  assert.equal(priced.length, 0); // evalAt returned before agg.price()
  assert.equal(trades(db).total.trades, 0);
  const rows = opps(db);
  assert.ok(rows.length >= 2, `both directions should be evaluated, got ${rows.length}`); // DEX_BUY + CEX_BUY
  assert.ok(
    rows.every((r) => r.decision === 'rule' && (r.reason ?? '').startsWith('depth reject pool $42k < $150k')),
    JSON.stringify(rows),
  );
  assert.ok(rows.every((r) => r.net_usd === null)); // no quote was taken, so no net
});

test('depth-unknown pool (tvl 0) is fail-open: it still quotes', async () => {
  const { engine, priced } = setup({ dexTvlUsd: 0 });
  await engine.tick();
  assert.ok(priced.length > 0); // the exact quote still gates the trade
});

// ---------------- Phase 2 dynamic sizing ----------------
// DEX_BUY quotes are in USDC base units (size * 1e6); CEX_BUY quotes are in
// token units (>> 1e9), so this filter isolates the DEX_BUY sizes.
const usdcSizes = (priced: bigint[]) =>
  priced.filter((x) => x % 1_000_000n === 0n && x <= 1_000_000_000n).map((x) => Number(x / 1_000_000n));

test('depth-derived base: a shallow pool shrinks the base to the safe size', async () => {
  // $20k pool (floor lowered to 0 for this test, or the pool-floor reject
  // would fire first): safe size is 0.7% of the $10k half = $70 < the $100
  // default base, so DEX_BUY quotes $70 — and its gross ($8.32) is below
  // 0.7 * need, so no multi-size follows.
  const { engine, priced } = setup({ dexTvlUsd: 20_000, minPoolLiquidityUsd: 0 });
  await engine.tick();
  assert.deepEqual(usdcSizes(priced), [70]);
});

test('depth-derived base: multi-size is seeded from the depth-derived base', async () => {
  // Same $20k pool, but a 20% gap (MEXC bid 12 vs DEX 10): the $70 gross
  // ($13.92) reaches 0.7 * need, so the ladder's next step ($52) is tried —
  // its gross (~$10.34) is no longer close, so the $35 step is never
  // quoted. (The old 0.5x/2x trigger is gone: the 2x step would have been
  // depth-rejected at 1.4% impact anyway.)
  const { engine, priced } = setup({ dexTvlUsd: 20_000, minPoolLiquidityUsd: 0, bid: 12 });
  await engine.tick();
  assert.deepEqual(usdcSizes(priced), [70, 52]); // 35 never quoted
});

test('depth-derived base: unknown TVL keeps the old $100 base (and its multi-size)', async () => {
  const { engine, priced } = setup({ dexTvlUsd: 0 });
  await engine.tick();
  const usdc = usdcSizes(priced);
  assert.ok(usdc.includes(100) && usdc.includes(50) && usdc.includes(200), String(usdc));
});

// ---------------- Phase 4: REBALANCE_LOW_X + DEX-DEX detection ----------------
const dexArbRows = (db: Db) =>
  db.all<{ token: string; direction: string; size_usd: number | null; decision: string; reason: string | null; net_usd: number | null }>(
    "SELECT * FROM opportunities WHERE direction = 'DEX_ARB'",
  );

test('REBALANCE_LOW_X: a side at ~1.36x the trade size tickets at LOW_X=1.5 but not at 1', async () => {
  // Trade size is MAX_TRADE_USD/2 = $100; MEXC LINK 12.5 tokens ≈ $136 at the
  // $10.90 bid (bid 10.9 keeps the gap below the hurdle, so no trade moves balances).
  const run = async (lowX: number) => {
    process.env.REBALANCE_AFTER_MIN = '0';
    try {
      const { engine, db, alerts, bal } = setup({ lowX, bid: 10.9 });
      bal.mexc.LINK = 12.5;
      await engine.tick();
      await engine.tick();
      return { open: db.openTickets().filter((k) => k.token === 'LINK' && k.side === 'mexc'), alerts };
    } finally {
      delete process.env.REBALANCE_AFTER_MIN;
    }
  };
  const at1 = await run(1);
  assert.equal(at1.open.length, 0); // ~$136 >= 1x $100: not low, no ticket
  const at15 = await run(1.5);
  assert.equal(at15.open.length, 1); // ~$136 < 1.5x $100: low, one ticket
  assert.equal(at15.alerts.filter((a) => a.startsWith('🎫 Rebalance ticket') && a.includes('LINK')).length, 1);
});

test('shortfall warning: sent once (throttled) via alertThrottled, never as a ticket', async () => {
  process.env.REBALANCE_AFTER_MIN = '0';
  try {
    // Bid 10.9: no trade, balances stay put. Wallet USDC $10, MEXC USDT $50,
    // target $300: the wallet STABLE side needs $290 more, the other side has $50.
    const { engine, db, alerts, bal } = setup({ bid: 10.9 });
    bal.walletUsdc = 10;
    bal.mexc.USDT = 50;
    await engine.tick();
    await engine.tick();
    const warns = alerts.filter((a) => a.includes('STABLE wallet needs $290.00 more'));
    assert.equal(warns.length, 1); // throttled: sent once, not once per tick
    assert.match(warns[0], /needs \$290\.00 more, but the other side only has \$50\.00/);
    assert.match(warns[0], /deposit fresh funds/);
    assert.ok(!warns.some((a) => a.startsWith('🎫'))); // the warning itself is not a ticket
    // The low STABLE wallet side still gets its (separate) rebalance ticket.
    assert.equal(db.openTickets().filter((k) => k.token === 'STABLE' && k.side === 'wallet').length, 1);
  } finally {
    delete process.env.REBALANCE_AFTER_MIN;
  }
});

test('DEX-ARB disabled: the scan never runs (counting agg)', async () => {
  // A thin pool ($42k) is depth-rejected before any DEX quote, so the normal
  // evaluation spends zero quotes. With detection off (the pinned default),
  // the tick must stay at zero quotes and record no DEX_ARB rows.
  const { engine, db, priced } = setup({ dexTvlUsd: 42_000 });
  await engine.tick();
  assert.equal(priced.length, 0);
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB enabled: the scan runs (2 more quotes) and records a below_hurdle row', async () => {
  // Same thin pool, detection on: the scan still prices both legs (its only
  // skips are unknown TVL / safe size < MIN_TRADE_USD — $42k gives $147).
  // The fake DEX is symmetric ($10 both ways), so the spread is just -gas.
  const { engine, db, priced } = setup({ dexTvlUsd: 42_000, dexArbEnabled: true });
  await engine.tick();
  assert.equal(priced.length, 2); // buy leg + sell leg, nothing else
  const rows = dexArbRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'below_hurdle');
  assert.match(rows[0].reason ?? '', /dex-arb detection only — no execution/);
  assert.ok((rows[0].net_usd ?? 0) < 0);
  assert.equal(rows[0].size_usd, 147); // depth-safe size of a $42k pool
});

test('DEX-ARB enabled with a real spread: recorded as trade (detection only — nothing executed)', async () => {
  // dexSellBoost 1.2: the token->USDC leg pays $12 per LINK instead of $10.
  // Scan: buy $200 -> 20 LINK, sell 20 LINK -> $240, gas $3/leg, net $34 > need $15.
  const { engine, db, alerts } = setup({ mode: 'paper', dexArbEnabled: true, dexSellBoost: 1.2 });
  await engine.tick();
  const rows = dexArbRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'trade');
  assert.equal(rows[0].reason, 'dex-arb detection only — no execution');
  assert.ok(Math.abs((rows[0].net_usd ?? 0) - 34) < 1e-9, String(rows[0].net_usd));
  // Detection only: the normal paper trade is the only trade recorded, and no
  // extra live trade was executed for the DEX-ARB spread.
  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
  assert.ok(!alerts.some((a) => a.includes('DEX-ARB')));
});

// ---------------- Phase 5: parallel directions + dynamic hurdle + rejection counts ----------------
test('Phase 5: candidates() evaluates both directions (parallel refactor drops neither)', async () => {
  const { engine, bal } = setup({});
  const book = { bids: [[11.2, 1000]], asks: [[11.21, 1000]], ts: Date.now() };
  const gas = { baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI };
  const out = await engine.candidates({ ...LINK, dexTvlUsd: 1e6 }, book, bal, gas, 2000);
  assert.deepEqual(out.map((c) => c.opp.direction).sort(), ['CEX_BUY', 'DEX_BUY']);
});

test('Phase 5: thin-pool depth rejects are counted (lastDepthRejects)', async () => {
  const { engine, bal, db } = setup({});
  const book = { bids: [[11.2, 1000]], asks: [[11.21, 1000]], ts: Date.now() };
  const gas = { baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI };
  // $42k pool < $150k floor: both directions reject before any exact quote.
  const out = await engine.candidates({ ...LINK, dexTvlUsd: 42_000 }, book, bal, gas, 2000);
  assert.deepEqual(out, []);
  assert.equal(engine.lastDepthRejects, 2);
  // Phase 6: flushing writes exactly ONE summary row for the tick (total 2,
  // one detail entry per rejected direction), not one row per candidate.
  engine.flushDepthRejects();
  const rows = db.all<Record<string, unknown>>('SELECT * FROM depth_rejects');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 2);
  assert.equal(rows[0].chain, 'ethereum');
  const detail = JSON.parse(String(rows[0].detail)) as { token: string; liq_usd: number; reason: string }[];
  assert.equal(detail.length, 2);
  assert.ok(detail.every((d) => d.token === 'LINK' && d.liq_usd === 42_000));
  assert.ok(detail.every((d) => /pool \$42k < \$150k/.test(d.reason)));
  // flushDepthRejects writes one row per call; the tick calls it exactly
  // once (a second manual call would write a second row — the test only
  // proves the first call wrote exactly one).
  assert.equal(db.all('SELECT * FROM depth_rejects').length, 1);
});

test('Phase 6: zero-reject flush writes nothing; paper trade records aggregator + depth sizing', async () => {
  const { engine, db } = setup({ mode: 'paper' });
  engine.flushDepthRejects();
  assert.equal(db.all('SELECT * FROM depth_rejects').length, 0);
  await engine.tick();
  const rows = db.all<Record<string, unknown>>('SELECT * FROM trades');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].aggregator, '0x');
  assert.equal(rows[0].pool_tvl_usd, 1_000_000);
  assert.ok(Math.abs(Number(rows[0].safe_size_usd) - 3500) < 1e-6, String(rows[0].safe_size_usd));
});

test('Phase 5: dynamic hurdle — MIN_PROFIT_BPS_ETH blocks the trade on Ethereum', async () => {
  // The profitable setup nets ~$20 at $200: need is max($15, 50 bps) = $15
  // by default, but 2000 bps makes it $40, which the same gap cannot clear.
  const { engine, db, calls, cfg } = setup({ minProfitBpsEth: 2000 });
  assert.equal(hurdleBps(cfg), 2000);
  await engine.tick();
  assert.deepEqual(calls, []);
  assert.equal(trades(db).total.trades, 0);
});

test('Phase 5: dynamic hurdle — the same MIN_PROFIT_BPS_ETH is ignored on Arbitrum (L2 keeps the old hurdle)', async () => {
  const { engine, db, calls, cfg } = setup({ chain: 'arbitrum', minProfitBpsEth: 2000 });
  assert.equal(hurdleBps(cfg), 50); // falls back to MIN_PROFIT_BPS on L2
  await engine.tick();
  assert.ok(calls.includes('send'));
  assert.equal(trades(db).total.trades, 1);
});
