// Transfer strategy: scan -> buy MEXC -> withdraw -> wait -> sell DEX, with fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { TransferEngine, type TransferMexc, type TransferChain } from '../src/transfer.js';
import { findGaps, loadUniverse, type ScanToken } from '../src/scanner.js';
import { evaluateTransfer, planCexBuy } from '../src/pricing.js';
import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
import type { Order } from '../src/mexc/rest.js';

const GWEI = 1_000_000_000n;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const XYZ = '0x1111111111111111111111111111111111111111';

const symbolInfo = (base: string) => ({
  symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true,
  baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'],
});
const coin = (base: string, contract: string, dep = true, wd = true) => ({
  coin: base,
  networkList: [{ coin: base, network: 'Ethereum(ERC20)', netWork: 'ETH', contract, depositEnable: dep, withdrawEnable: wd, withdrawFee: '1', withdrawMin: '10' }],
});

function setup(o: { dexPrice?: number; withdrawThrows?: boolean; withdrawStatus?: number; db?: Db; mode?: 'live' | 'paper' } = {}) {
  process.env.MODE = o.mode ?? 'live';
  process.env.STRATEGY = 'transfer';
  process.env.RPC_URL = 'http://localhost';
  process.env.PRIVATE_KEY = '0x' + '22'.repeat(32);
  process.env.MEXC_API_KEY = 'k'.repeat(10);
  process.env.MEXC_API_SECRET = 's'.repeat(10);
  const cfg = loadConfig();
  const db = o.db ?? new Db(':memory:');
  const risk = new Risk(db, cfg.mode, cfg);
  const alerts: string[] = [];
  const calls: string[] = [];
  const dexPrice = o.dexPrice ?? 1.15;
  const state = {
    mexc: { USDT: 1000, XYZ: 0 } as Record<string, number>,
    wallet: { [XYZ]: 0n, [USDC]: 0n } as Record<string, bigint>,
    withdrawStatus: o.withdrawStatus ?? 4,
  };
  const orders = new Map<string, Order>();
  let lastQuote: QuoteRequest | null = null;

  const mexc: TransferMexc = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD')],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }],
    coinConfigs: async () => [coin('XYZ', XYZ), coin('BAD', '0x2222222222222222222222222222222222222222', true, false)],
    bookTickers: async () => new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }]]),
    depth: async () => ({ bids: [[0.999, 1e6]], asks: [[1.0, 1e6]], ts: Date.now() }),
    balances: async () => ({ ...state.mexc }),
    limitOrder: async (_s, side, q, p) => {
      calls.push(`limit ${side} ${q} @ ${p}`);
      const qty = Number(q);
      state.mexc.USDT -= qty * 1.0;
      state.mexc.XYZ += qty * (1 - cfg.mexcTakerFee);
      orders.set('b1', { orderId: 'b1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(qty * 1.0), origQty: q, price: p, side });
      return { orderId: 'b1' };
    },
    marketSell: async (_s, q) => {
      calls.push(`market SELL ${q}`);
      state.mexc.XYZ -= Number(q);
      orders.set('s1', { orderId: 's1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(Number(q) * 0.999), origQty: q, price: '0', side: 'SELL' });
      return { orderId: 's1' };
    },
    getOrder: async (_s, id) => orders.get(id)!,
    cancelOrder: async (_s, id) => orders.get(id)!,
    withdraw: async (p) => {
      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
      if (o.withdrawThrows) throw new Error('no withdraw permission');
      state.mexc.XYZ -= Number(p.amount);
      return 'w1';
    },
    withdrawStatus: async () => ({ status: state.withdrawStatus }),
  };

  const quote = (r: QuoteRequest, firm: boolean): Quote => {
    const out = (r.sellAmount * BigInt(Math.round(dexPrice * 1e6))) / 10n ** 18n; // token(18) -> USDC(6)
    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
  };

  const chain: TransferChain = {
    address: '0xMyWallet',
    gas: async () => ({ baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI }),
    decimals: async () => 18,
    tokenBalance: async (t) => state.wallet[t] ?? 0n,
    approveExact: async (_t, s, amount) => {
      calls.push(`approve ${s} ${amount}`);
      return { ok: true, gasCostWei: 60_000n * 10n * GWEI };
    },
    simulate: async () => (calls.push('simulate'), 150_000n),
    send: async () => {
      calls.push('send');
      const r = lastQuote!;
      state.wallet[XYZ] -= r.sellAmount;
      state.wallet[USDC] += quote(r, true).buyAmount;
      return { ok: true, hash: '0xhash', gasCostWei: 150_000n * 10n * GWEI };
    },
  };

  const engine = new TransferEngine({
    cfg, mexc, chain, db, risk,
    tg: { send: async (t) => void alerts.push(t) },
    agg: { name: '0x', price: async (r) => quote(r, false), quote: async (r) => ((lastQuote = r), quote(r, true)) },
    dexPricesFn: async () => new Map([[XYZ, { price: dexPrice, tvl: 1e6 }]]),
    sleep: async () => {},
  });
  const arrive = (tokens: number) => (state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n);
  return { engine, db, risk, alerts, calls, state, arrive, cfg };
}

test('loadUniverse keeps only ERC20 tokens with deposit AND withdraw open', async () => {
  const { engine } = setup();
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']); // BAD has withdrawals suspended
  assert.equal(engine.universe[0].address, XYZ);
  assert.equal(engine.universe[0].netWork, 'ETH');
  assert.equal(engine.universe[0].withdrawFee, 1);
});

test('findGaps: filters TVL, too-small and absurd gaps, sorts biggest first', () => {
  const tok = (base: string, address: string): ScanToken => ({ base, symbol: `${base}USDT`, address, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6 });
  const tokens = [tok('A', '0xa'), tok('B', '0xb'), tok('C', '0xc'), tok('D', '0xd'), tok('E', '0xe')];
  const tickers = new Map(['A', 'B', 'C', 'D', 'E'].map((b) => [`${b}USDT`, { bid: 0.99, ask: 1 }]));
  const dex = new Map([
    ['0xa', { price: 1.05, tvl: 1e6 }], // 5%
    ['0xb', { price: 1.1, tvl: 1e6 }], // 10%
    ['0xc', { price: 1.1, tvl: 1000 }], // thin pool
    ['0xd', { price: 1.01, tvl: 1e6 }], // 1% < min
    ['0xe', { price: 3, tvl: 1e6 }], // 200%: broken / different token
  ]);
  const g = findGaps(tokens, tickers, dex, { minTvlUsd: 200_000, minGapPct: 3 });
  assert.deepEqual(g.map((x) => x.token.base), ['B', 'A']);
});

test('evaluateTransfer subtracts withdraw fee, drift reserve and all costs', () => {
  const plan = planCexBuy({ sizeUsd: 200, asks: [[1, 1e6]], qtyStep: 0.01, takerFee: 0.0005 })!;
  const ev = evaluateTransfer({ plan, withdrawFeeTokens: 1, usdcOut: 228.7, usdcMin: 228.5, gasUsd: 4, driftBps: 150, costs: { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 } });
  assert.ok(Math.abs(ev.arriving - (200 * 0.9995 - 1)) < 1e-9);
  const expected = 228.7 - 200 - 4 - (0.4 + 0.2) - 228.7 * 0.015 - 2;
  assert.ok(Math.abs(ev.net - expected) < 1e-9);
});

test('full cycle: buy on MEXC -> withdraw to own wallet -> wait -> sell on DEX -> PnL', async () => {
  const { engine, db, calls, alerts, arrive } = setup();
  await engine.tick(); // finds gap, buys, withdraws
  assert.equal(calls[0], 'limit BUY 200.00 @ 1.0020');
  assert.equal(calls[1], 'withdraw 199.90 XYZ ETH -> 0xMyWallet'); // only ever our own wallet
  assert.equal(db.openTransfers()[0].status, 'withdrawing');
  assert.ok(alerts.some((a) => a.startsWith('📤 TRANSFER #1 XYZ')));

  await engine.tick(); // still on its way: nothing new is bought meanwhile
  assert.equal(calls.filter((c) => c.startsWith('limit')).length, 1);

  arrive(198.9); // 199.9 - 1 withdraw fee
  await engine.tick();
  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
  assert.ok(calls.includes('simulate') && calls.includes('send'));
  assert.ok(!db.openTransfers().some((t) => t.id === 1)); // #1 done (a new one may start: gap still open)

  const s = db.statsSince(0, 'live');
  assert.equal(s.total.trades, 1);
  assert.equal(s.total.failed, 0);
  const usdcOut = Math.floor(198.9 * 1.15 * 1e6) / 1e6;
  const gas = (0.0006 + 0.0015) * 2000;
  assert.ok(Math.abs(s.total.pnl - (usdcOut - 200 - gas)) < 1e-6, String(s.total.pnl));
  assert.ok(alerts.some((a) => a.includes('TRANSFER #1 XYZ done') && a.includes('Net PnL')));
});

test('restart while withdrawing: a new engine resumes the same transfer', async () => {
  const first = setup();
  await first.engine.tick();
  // "restart": new engine, same database and balances
  const second = setup({ db: first.db });
  Object.assign(second.state, first.state);
  second.state.wallet[XYZ] = BigInt(198.9e6) * 10n ** 12n;
  await second.engine.tick();
  assert.ok(!first.db.openTransfers().some((t) => t.id === 1));
  assert.equal(first.db.statsSince(0, 'live').total.trades, 1);
});

test('withdraw rejected: sells the tokens back on MEXC and records a failure', async () => {
  const { engine, db, calls, alerts } = setup({ withdrawThrows: true });
  await engine.tick();
  assert.ok(calls.includes('market SELL 199.90'));
  assert.equal(db.openTransfers().length, 0);
  assert.equal(db.statsSince(0, 'live').total.failed, 1);
  assert.ok(alerts.some((a) => a.includes('withdraw failed')));
});

test('withdrawal FAILED on MEXC side: sells back on MEXC', async () => {
  const { engine, db, calls, state } = setup();
  await engine.tick();
  state.withdrawStatus = 8;
  state.mexc.XYZ += 199.9; // funds returned to the MEXC account
  await engine.tick();
  assert.ok(calls.includes('market SELL 199.90'));
  assert.ok(!db.openTransfers().some((t) => t.id === 1));
});

test('gap too small after exact costs: nothing happens', async () => {
  const { engine, calls } = setup({ dexPrice: 1.05 }); // 5% gap, but drift+gas+fees+min $15 eat it
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('paused bot does not open new transfers', async () => {
  const { engine, risk, calls } = setup();
  risk.pause('Telegram /stop');
  await engine.tick();
  assert.deepEqual(calls, []);
});

test('paper mode records the opportunity without orders or withdrawals', async () => {
  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
  await engine.tick();
  assert.deepEqual(calls, []);
  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER TRANSFER XYZ')));
});

test('loadUniverse respects WATCHLIST', async () => {
  const fake = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC')],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }, { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' }],
    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', '0x3333333333333333333333333333333333333333')],
  };
  const u = await loadUniverse(fake as never, { minVolumeUsd: 1, only: ['ABC'] });
  assert.deepEqual(u.map((t) => t.base), ['ABC']);
});
