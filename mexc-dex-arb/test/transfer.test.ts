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
import { BestOf, type Aggregator } from '../src/dex/aggregator.js';
import { AmbiguousRequestError, type Order } from '../src/mexc/rest.js';

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

function setup(
  o: {
    dexPrice?: number;
    withdrawThrows?: boolean;
    withdrawAmbiguous?: boolean;
    withdrawStatus?: number;
    db?: Db;
    mode?: 'live' | 'paper';
    sendFails?: boolean;
    sendUnknown?: boolean;
    firmDexPrice?: number; // price the FIRM quote (after approval) sees; first quote uses dexPrice
    agg?: Aggregator; // override the fake aggregator (e.g. a BestOf of two fakes)
    now?: () => number;
  } = {},
) {
  process.env.MODE = o.mode ?? 'live';
  process.env.STRATEGY = 'transfer';
  process.env.ALLOW_WITHDRAWALS = 'yes';
  process.env.RPC_URL = 'http://localhost';
  process.env.MAX_TRADE_USD = '200'; // tests use $200 trades (default is 50)
  process.env.MIN_PROFIT_USD = '15';
  // These older tests keep the pre-upgrade cost settings, so their numbers stay meaningful.
  process.env.MIN_PROFIT_BPS = '50';
  process.env.SAFETY_MARGIN_USD = '2';
  process.env.SAFETY_MARGIN_BPS = '0';
  process.env.CEX_SLIPPAGE_BPS = '20';
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
    dexPrice,
    withdrawals: [] as { id: string; status: number; amount: string; withdrawOrderId?: string }[],
  };
  const orders = new Map<string, Order>();
  let lastQuote: QuoteRequest | null = null;

  const mexc: TransferMexc = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD')],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }],
    coinConfigs: async () => [coin('XYZ', XYZ), coin('BAD', '0x2222222222222222222222222222222222222222', true, false)],
    bookTickers: async () => new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }], ['USDCUSDT', { bid: 1, ask: 1 }]]),
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
    getOrderByClientId: async () => null,
    cancelOrder: async (_s, id) => orders.get(id)!,
    withdraw: async (p) => {
      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
      if (o.withdrawThrows) throw new Error('no withdraw permission');
      state.mexc.XYZ -= Number(p.amount);
      state.withdrawals.push({ id: 'w1', status: 4, amount: p.amount, withdrawOrderId: p.withdrawOrderId });
      if (o.withdrawAmbiguous) throw new AmbiguousRequestError('timeout');
      return 'w1';
    },
    findWithdraw: async (_c, _since, ref) => {
      const w = state.withdrawals.find((x) => (ref.id && x.id === ref.id) || (ref.withdrawOrderId && x.withdrawOrderId === ref.withdrawOrderId));
      return w ? { ...w, status: state.withdrawStatus } : null;
    },
  };

  let firmCalls = 0;
  const quote = (r: QuoteRequest, firm: boolean): Quote => {
    // The firm quote after the approval may see a different price (round-3 M3 test).
    const px = firm && firmCalls++ > 0 && o.firmDexPrice !== undefined ? o.firmDexPrice : state.dexPrice;
    const out = (r.sellAmount * BigInt(Math.round(px * 1e6))) / 10n ** 18n; // token(18) -> USDC(6)
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
      if (o.sendUnknown) return { ok: false, unknown: true, hash: '0xhash', gasCostWei: 0n, reason: 'unknown' };
      if (o.sendFails) return { ok: false, hash: '0xhash', gasCostWei: 0n, reason: 'reverted' };
      const r = lastQuote!;
      state.wallet[XYZ] -= r.sellAmount;
      state.wallet[USDC] += quote(r, true).buyAmount;
      return { ok: true, hash: '0xhash', gasCostWei: 150_000n * 10n * GWEI };
    },
  };

  const engine = new TransferEngine({
    cfg, mexc, chain, db, risk,
    tg: { send: async (t) => void alerts.push(t) },
    agg: o.agg ?? { name: '0x', price: async (r) => quote(r, false), quote: async (r) => ((lastQuote = r), quote(r, true)) },
    dexPricesFn: async () => new Map([[XYZ, { price: dexPrice, tvl: 1e6 }]]),
    sleep: async () => {},
    now: o.now,
  });
  // The withdrawal lands: MEXC reports SUCCESS (7) and the wallet balance grows.
  const arrive = (tokens: number) => {
    state.withdrawStatus = 7;
    state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n;
  };
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
  const rules = { qtyStep: 0.01, priceDecimals: 4, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT'], tradeSideType: 1 };
  const tok = (base: string, address: string): ScanToken => ({ base, symbol: `${base}USDT`, address, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6, rules });
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
  second.state.withdrawStatus = 7; // MEXC reports SUCCESS
  await second.engine.tick();
  assert.ok(!first.db.openTransfers().some((t) => t.id === 1));
  assert.equal(first.db.statsSince(0, 'live').total.trades, 1);
});

test('withdraw request times out: never re-sent, found later by withdrawOrderId', async () => {
  const { engine, db, calls, arrive } = setup({ withdrawAmbiguous: true });
  await engine.tick();
  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
  await engine.tick(); // looks it up instead of withdrawing again
  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
  assert.equal(db.getTransfer(1)!.withdraw_id, 'w1');
  arrive(198.9);
  await engine.tick();
  assert.equal(db.getTransfer(1)!.status, 'done');
});

test('price fell during the withdrawal: holds instead of selling at a big loss; /sell overrides', async () => {
  let t = Date.UTC(2026, 10, 20, 6);
  const { engine, db, calls, alerts, arrive, state } = setup({ now: () => t });
  await engine.tick();
  state.dexPrice = 0.9; // 10% below the MEXC buy price
  arrive(198.9);
  await engine.tick();
  assert.ok(!calls.includes('send'));
  assert.equal(db.getTransfer(1)!.status, 'selling');
  assert.ok(alerts.some((a) => a.startsWith('✋ TRANSFER #1 XYZ') && a.includes('/sell 1')));
  t += 6 * 60_000;
  await engine.tick();
  assert.ok(!calls.includes('send')); // still holding
  assert.match(engine.forceSell(1), /selling on the next scan/);
  await engine.tick();
  assert.ok(calls.includes('send'));
  assert.equal(db.getTransfer(1)!.status, 'done');
});

test('failed DEX sales back off, then stop retrying (no gas burn loop)', async () => {
  let t = Date.UTC(2026, 10, 20, 6);
  const { engine, db, calls, alerts, arrive } = setup({ sendFails: true, now: () => t });
  await engine.tick();
  arrive(198.9);
  await engine.tick(); // attempt 1
  await engine.tick(); // inside backoff: no attempt
  assert.equal(calls.filter((c) => c === 'send').length, 1);
  for (const wait of [2, 10, 30]) {
    t += wait * 60_000 + 1;
    await engine.tick();
  }
  assert.equal(calls.filter((c) => c === 'send').length, 4);
  assert.equal(db.getTransfer(1)!.status, 'stuck');
  t += 24 * 3600_000;
  await engine.tick();
  assert.equal(calls.filter((c) => c === 'send').length, 4); // no more automatic tries
  assert.ok(alerts.some((a) => a.includes('Automatic retries STOPPED')));
  assert.match(engine.clear(1), /closed manually/);
});

test('swap outcome unknown: stuck + paused, never retried automatically', async () => {
  const { engine, db, risk, calls, arrive } = setup({ sendUnknown: true });
  await engine.tick();
  arrive(198.9);
  await engine.tick();
  assert.equal(db.getTransfer(1)!.status, 'stuck');
  assert.equal(risk.paused, true);
  await engine.tick();
  assert.equal(calls.filter((c) => c === 'send').length, 1);
});

test('withdrawal never arrives: after 2x timeout it stops blocking, but never a 2nd transfer of the same token', async () => {
  let t = Date.UTC(2026, 10, 20, 6);
  const { engine, db, calls, alerts, cfg } = setup({ now: () => t });
  await engine.tick();
  t += (cfg.transferTimeoutMin + 1) * 60_000;
  await engine.tick();
  assert.ok(alerts.some((a) => a.includes('not in wallet after')));
  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1); // still blocking
  t += cfg.transferTimeoutMin * 60_000;
  await engine.tick(); // gives up blocking
  assert.equal(db.getTransfer(1)!.alerted_timeout, 2);
  assert.equal(db.getTransfer(1)!.status, 'withdrawing'); // still watched
  await engine.tick();
  // It no longer blocks by COUNT, but a second transfer of the SAME token must never start while
  // the first is still out (they would share one wallet balance).
  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1);
  assert.equal(db.blockingTransfers().length, 0);
});

test('withdraw rejected: sells the tokens back on MEXC and records a failure', async () => {
  const { engine, db, calls, alerts } = setup({ withdrawThrows: true });
  await engine.tick();
  assert.ok(calls.includes('market SELL 199.90'));
  assert.equal(db.openTransfers().length, 0);
  assert.equal(db.statsSince(0, 'live').total.failed, 1);
  assert.ok(alerts.some((a) => a.includes('withdraw rejected')));
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

test('a dust deposit during the withdrawal is NOT taken as arrival', async () => {
  const { engine, db, alerts, state } = setup();
  await engine.tick();
  state.wallet[XYZ] += 10n ** 15n; // 0.001 XYZ airdrop, MEXC still PROCESSING
  await engine.tick();
  assert.equal(db.getTransfer(1)!.status, 'withdrawing');
  state.withdrawStatus = 7; // MEXC says SUCCESS but only dust arrived
  await engine.tick();
  assert.equal(db.getTransfer(1)!.status, 'withdrawing');
  assert.ok(alerts.some((a) => a.includes('only grew by')));
});

test('sell holds when the FIRM quote falls below the loss floor (round-3 M3)', async () => {
  const { engine, db, calls, alerts, arrive } = setup({ firmDexPrice: 0.9 });
  await engine.tick(); // finds gap, buys, withdraws
  arrive(198.9); // 199.9 - 1 withdraw fee
  await engine.tick(); // first quote ok (1.15), approval, firm quote 0.9 -> below floor -> hold
  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
  assert.ok(!calls.includes('send')); // nothing sent on a below-floor firm quote
  const row = db.openTransfers().find((t) => t.id === 1)!;
  assert.equal(row.status, 'selling'); // still selling, retried later
  assert.ok(alerts.some((a) => a.includes('HOLDING 198.9 XYZ')));
  // The approval gas was really spent: $1.20 booked on the row.
  assert.ok(Math.abs((row.gas_usd ?? 0) - 1.2) < 1e-9, String(row.gas_usd));
});

test('transfer mode sets BestOf gasInOutput so gas is compared (round-3 L7f)', async () => {
  const mkAgg = (name: '0x' | 'kyber', out: bigint, gas: bigint): Aggregator => ({
    name,
    price: async () => ({ buyAmount: out, minBuyAmount: out, gas }),
    quote: async () => ({ buyAmount: out, minBuyAmount: out, gas, tx: { to: '0xah', data: '0x01', value: 0n } }),
  });
  const bestOf = new BestOf([mkAgg('0x', 1000n, 500_000n), mkAgg('kyber', 990n, 100_000n)]);
  const { engine } = setup({ mode: 'paper', agg: bestOf });
  await engine.tick();
  assert.equal(typeof bestOf.gasInOutput, 'function');
  // 150k gas x 10 gwei effective x $2000 ETH = $3.00; fake chain decimals() is 18.
  assert.equal(bestOf.gasInOutput!(150_000n, USDC), 3_000_000_000_000_000_000n);
});
