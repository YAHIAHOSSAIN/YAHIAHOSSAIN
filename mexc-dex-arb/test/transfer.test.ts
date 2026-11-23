// Transfer strategy: scan -> buy MEXC -> withdraw -> wait -> sell DEX, with fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { TransferEngine, pickTradeSize, winnersFirst, type TransferMexc, type TransferChain } from '../src/transfer.js';
import { dexPrices, findGaps, loadUniverse, type ScanToken } from '../src/scanner.js';
import { evaluateTransfer, planCexBuy } from '../src/pricing.js';
import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
import { BestOf, Limited, TokenBucket, type Aggregator } from '../src/dex/aggregator.js';
import { AmbiguousRequestError, type Order } from '../src/mexc/rest.js';

const GWEI = 1_000_000_000n;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const XYZ = '0x1111111111111111111111111111111111111111';
const DEPOSIT_ADDR = '0x' + 'ab'.repeat(20); // fake MEXC USDC deposit address (Phase 8)

const symbolInfo = (base: string) => ({
  symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true,
  baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'],
});
const coin = (base: string, contract: string, dep = true, wd = true, net: { netWork: string; network: string } = { netWork: 'ETH', network: 'Ethereum(ERC20)' }) => ({
  coin: base,
  networkList: [{ coin: base, network: net.network, netWork: net.netWork, contract, depositEnable: dep, withdrawEnable: wd, withdrawFee: '1', withdrawMin: '10' }],
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
    freshDexPrice?: number; // price the FRESH quote after a failed swap sees (Phase 7); first + firm quotes use dexPrice/firmDexPrice
    freshQuoteThrows?: boolean; // the fresh quote after a failed swap throws (Phase 7)
    agg?: Aggregator; // override the fake aggregator (e.g. a BestOf of two fakes)
    now?: () => number;
    extraTokens?: { base: string; contract: string }[]; // extra ERC20 tokens that pass the base filters
    provenFilter?: (tokens: ScanToken[]) => ScanToken[]; // live proven-only filter
    dexVol24h?: number; // fake DexScreener 24h volume for XYZ (default 1e6, passes any DEX-volume floor)
    minDexVolumeUsd?: number; // MIN_DEX_VOLUME_USD knob for this engine (default 0 = off)
    depthAsks?: [number, number][]; // fake MEXC asks for XYZ (default [[1.0, 1e6]] = $1m deep)
    depthThrows?: boolean; // fake depth read fails (fail-open test)
    stableDecimals?: number; // DEX-stable decimals for this engine (default 6 = USDC; 18 = BSC USDT)
    chain?: string; // CHAIN for this engine (default 'ethereum'; 'bsc' prices gas in BNB)
    minTradeUsd?: number; // MIN_TRADE_USD knob for this engine (default 200 = MAX, so the size is fixed)
    maxTradeUsd?: number; // MAX_TRADE_USD knob for this engine (default 200)
    dexTvl?: number; // fake best-pool TVL for XYZ (default 1e6, deep)
    minDexTvlUsd?: number; // MIN_DEX_TVL_USD knob for this engine (default 200000)
    minPoolLiquidityUsd?: number; // MIN_POOL_LIQUIDITY_USD knob (default 150000)
    depthMaxImpactBps?: number; // DEPTH_MAX_IMPACT_BPS knob (default 70 = 0.7%)
    depthMaxSizePct?: number; // DEPTH_MAX_SIZE_PCT knob (default 1)
    dexPricesFn?: (addrs: string[]) => Promise<Map<string, { price: number; tvl: number; vol24h: number }>>; // override the fake DexScreener lookup
    dexArbEnabled?: boolean; // DEX_ARB_ENABLED knob for this engine (default off; the transfer tick runs its own DEX-DEX scan when on)
    checkUnresolved?: () => Promise<{ state: 'clear' | 'pending'; dropped?: boolean }>; // fake chain checkUnresolved (default: none = clear)
    decimalsThrows?: boolean; // fake chain.decimals throws (DEX-ARB per-token skip test)
    decimalsCalls?: string[]; // records every chain.decimals address (DEX-ARB retry test)
    bookTickers?: Map<string, { bid: number; ask: number }>; // override the fake MEXC book tickers (stable-rate test)
    rand?: () => number; // random source for the per-tick trade size (default Math.random)
    scanExactQuotes?: number; // SCAN_EXACT_QUOTES knob for this engine (default 5)
    transferUniverseMax?: number; // TRANSFER_UNIVERSE_MAX knob for this engine (default 0 = no cap)
    dexPriceByToken?: Map<string, number>; // exact-quote DEX price per token contract (lowercase); default: one price for all
    minProfitBpsEth?: number; // MIN_PROFIT_BPS_ETH knob (default 0 = off, falls back to MIN_PROFIT_BPS)
    builderTipGwei?: number; // BUILDER_TIP_GWEI knob (default 0 = off)
    recycleCredit?: boolean; // Phase 8: MEXC credits the USDC deposit (default true; false = stuck in transit)
  } = {},
) {
  process.env.CHAIN = o.chain ?? 'ethereum';
  process.env.MODE = o.mode ?? 'live';
  process.env.STRATEGY = 'transfer';
  process.env.ALLOW_WITHDRAWALS = 'yes';
  process.env.RPC_URL = 'http://localhost';
  process.env.MAX_TRADE_USD = String(o.maxTradeUsd ?? 200); // tests use $200 trades (default is 50)
  // MIN defaults to MAX: existing tests keep the fixed $200 size (deterministic);
  // the random-size tests below set a real range (e.g. 100–300) with a fixed rand.
  process.env.MIN_TRADE_USD = String(o.minTradeUsd ?? o.maxTradeUsd ?? 200);
  process.env.TRANSFER_DRIFT_BPS = '150'; // pin the code default (a VPS .env value would change the nets)
  process.env.QUOTE_RPS_VELORA = '1'; // pin the code defaults (a VPS .env value cannot leak in)
  process.env.QUOTE_RPS_OPENOCEAN = '2';
  process.env.REBALANCE_LOW_X = '1'; // pin the Phase-4 knobs to their code defaults
  process.env.DEX_ARB_ENABLED = o.dexArbEnabled ? 'yes' : 'no'; // Phase 4: the transfer tick runs its own DEX-DEX scan when on
  process.env.MIN_PROFIT_USD = '15';
  // Pin the transfer knobs to their defaults: config.ts loads dotenv, so a
  // VPS .env that sets them (e.g. MIN_DEX_VOLUME_USD=10000 for the live
  // $10k universe) would otherwise leak into the tests and drop the fake
  // tokens that have no DexScreener entry (2026-11-22: 2 provenFilter
  // tests failed on the VPS for exactly this reason).
  process.env.MIN_DEX_VOLUME_USD = String(o.minDexVolumeUsd ?? 0);
  process.env.TRANSFER_UNIVERSE_MAX = String(o.transferUniverseMax ?? 0);
  process.env.SCAN_EXACT_QUOTES = String(o.scanExactQuotes ?? 5); // pin the code default (a VPS .env value would change the slot count)
  process.env.MIN_DEX_TVL_USD = String(o.minDexTvlUsd ?? 200_000);
  // Pin the depth-filter knobs to their code defaults (a VPS .env value
  // would otherwise leak in and change which fake pools pass).
  process.env.MIN_POOL_LIQUIDITY_USD = String(o.minPoolLiquidityUsd ?? 150_000);
  process.env.DEPTH_MAX_IMPACT_BPS = String(o.depthMaxImpactBps ?? 70);
  process.env.DEPTH_MAX_SIZE_PCT = String(o.depthMaxSizePct ?? 1);
  process.env.SCAN_MIN_GAP_PCT = '3';
  // These older tests keep the pre-upgrade cost settings, so their numbers stay meaningful.
  process.env.MIN_PROFIT_BPS = '50';
  process.env.MIN_PROFIT_BPS_ETH = String(o.minProfitBpsEth ?? 0); // pin the Phase-5 hurdle (0 = off)
  process.env.BUILDER_TIP_GWEI = String(o.builderTipGwei ?? 0); // pin the Phase-5 builder tip (0 = off)
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
    mexc: { USDT: 1000, XYZ: 0, USDC: 0 } as Record<string, number>,
    wallet: { [XYZ]: 0n, [USDC]: 0n } as Record<string, bigint>,
    withdrawStatus: o.withdrawStatus ?? 4,
    dexPrice,
    withdrawals: [] as { id: string; status: number; amount: string; withdrawOrderId?: string }[],
    // Phase 8 recycle bookkeeping (shared across a "restart" via Object.assign).
    deposits: [] as { txId: string; amount: string }[],
    depositSends: 0,
    recycleSells: 0,
    recycleCredit: o.recycleCredit ?? true,
  };
  const orders = new Map<string, Order>();
  const ordersByCid = new Map<string, Order>();
  let lastQuote: QuoteRequest | null = null;

  const extra = o.extraTokens ?? [];
  // The fake MEXC coin must list the network this chain withdraws on, or the
  // universe filter drops it (the old code scanned Ethereum contracts on
  // every chain — fixed 2026-11-22, bug #2).
  const net =
    o.chain === 'bsc'
      ? { netWork: 'BSC', network: 'BNB Smart Chain (BEP20)' }
      : o.chain === 'arbitrum'
        ? { netWork: 'ARB', network: 'Arbitrum One(ARB)' }
        : { netWork: 'ETH', network: 'Ethereum(ERC20)' };
  const cids: string[] = [];
  const mexc: TransferMexc = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD'), symbolInfo('USDC'), ...extra.map((t) => symbolInfo(t.base))],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }, ...extra.map((t) => ({ symbol: `${t.base}USDT`, quoteVolume: '9000000', lastPrice: '1' }))],
    coinConfigs: async () => [coin('XYZ', XYZ, true, true, net), coin('BAD', '0x2222222222222222222222222222222222222222', true, false, net), coin('USDC', USDC, true, true, net), ...extra.map((t) => coin(t.base, t.contract, true, true, net))],
    // Phase 8 recycle: the MEXC USDC deposit address (fixed fake; the GET/POST
    // split is covered against the real client in test/recycle.test.ts).
    depositAddress: async (_coin, network) => {
      calls.push(`depositAddress ${_coin}/${network}`);
      return DEPOSIT_ADDR;
    },
    depositHistory: async () => state.deposits.map((d) => ({ txId: d.txId, status: 1, amount: d.amount })),
    findDeposit: async (_coin, _since, txId) => {
      const norm = (h: string) => h.toLowerCase().replace(/^0x/, '');
      return state.deposits.find((d) => norm(d.txId) === norm(txId)) ? { txId, status: 1, amount: '0' } : null;
    },
    bookTickers: async () => o.bookTickers ?? new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }], ['BNBUSDT', { bid: 900, ask: 900 }], ['USDCUSDT', { bid: 1, ask: 1 }], ...extra.map((t) => [`${t.base}USDT`, { bid: 0.999, ask: 1.0 }] as const)]),
    depth: async () => {
      if (o.depthThrows) throw new Error('depth down');
      return { bids: [[0.999, 1e6]], asks: o.depthAsks ?? [[1.0, 1e6]], ts: Date.now() };
    },
    balances: async () => ({ ...state.mexc }),
    syncTime: async () => 0,
    account: async () => ({ canTrade: true, balances: [] }),
    limitOrder: async (_s, side, q, p, cid) => {
      if (cid) cids.push(cid);
      calls.push(`limit ${side} ${q} @ ${p}`);
      const qty = Number(q);
      const base = _s.replace(/USDT$/, '');
      state.mexc.USDT -= qty * 1.0;
      state.mexc[base] = (state.mexc[base] ?? 0) + qty * (1 - cfg.mexcTakerFee);
      const order = { orderId: 'b1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(qty * 1.0), origQty: q, price: p, side };
      orders.set('b1', order);
      if (cid) ordersByCid.set(cid, order);
      return { orderId: 'b1' };
    },
    marketSell: async (s, q, cid) => {
      calls.push(`market SELL ${s} ${q}`);
      if (s === 'USDCUSDT') {
        // Phase 8 recycle sell: USDC -> USDT on MEXC spot.
        state.recycleSells++;
        const n = Number(q);
        state.mexc.USDC -= n;
        state.mexc.USDT += n * 0.999;
        const order = { orderId: 'rs1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(n * 0.999), origQty: q, price: '1', side: 'SELL' as const };
        orders.set('rs1', order);
        if (cid) ordersByCid.set(cid, order);
        return { orderId: 'rs1' };
      }
      const base = s.replace(/USDT$/, '');
      state.mexc[base] = (state.mexc[base] ?? 0) - Number(q);
      const order = { orderId: 's1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(Number(q) * 0.999), origQty: q, price: '0', side: 'SELL' as const };
      orders.set('s1', order);
      if (cid) ordersByCid.set(cid, order);
      return { orderId: 's1' };
    },
    getOrder: async (_s, id) => orders.get(id)!,
    getOrderByClientId: async (_s, cid) => ordersByCid.get(cid) ?? null,
    cancelOrder: async (_s, id) => orders.get(id)!,
    withdraw: async (p) => {
      if (p.withdrawOrderId) cids.push(p.withdrawOrderId);
      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
      if (o.withdrawThrows) throw new Error('no withdraw permission');
      state.mexc[p.coin] = (state.mexc[p.coin] ?? 0) - Number(p.amount);
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
    // The firm quote after the approval may see a different price (round-3 M3 test);
    // the fresh quote after a failed swap may see yet another (Phase 7 test).
    // Phase 9: the exact quote can differ per token (dexPriceByToken, keyed by
    // the token contract, lowercase); default is one price for all tokens.
    let px = o.dexPriceByToken?.get(r.sellToken.toLowerCase()) ?? state.dexPrice;
    if (firm) {
      if (firmCalls >= 2 && o.freshDexPrice !== undefined) px = o.freshDexPrice;
      else if (firmCalls > 0 && o.firmDexPrice !== undefined) px = o.firmDexPrice;
      firmCalls++;
    }
    const stableDec = o.stableDecimals ?? 6;
    const out = (r.sellAmount * BigInt(Math.round(px * 10 ** stableDec))) / 10n ** 18n; // token(18) -> stable(stableDec)
    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
  };

  const chain: TransferChain = {
    address: '0xMyWallet',
    gas: async () => ({ baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI }),
    decimals: async (addr) => {
      o.decimalsCalls?.push(addr);
      if (o.decimalsThrows) throw new Error('decimals down');
      return 18;
    },
    ...(o.checkUnresolved ? { checkUnresolved: o.checkUnresolved } : {}),
    tokenBalance: async (t) => state.wallet[t] ?? 0n,
    ethBalance: async () => 1n * 10n ** 18n, // 1 ETH: the Phase 8 gas-reserve check passes
    approveExact: async (_t, s, amount) => {
      calls.push(`approve ${s} ${amount}`);
      return { ok: true, gasCostWei: 60_000n * 10n * GWEI };
    },
    simulate: async () => (calls.push('simulate'), 150_000n),
    send: async (tx, _limit, _gas, _timeout, onSigned) => {
      if (tx.to === USDC) {
        // Phase 8 recycle: ERC20 USDC transfer to the MEXC deposit address.
        const amountUnits = BigInt(`0x${tx.data.slice(-64)}`);
        const amount = Number(amountUnits) / 1e6;
        state.depositSends++;
        calls.push(`send USDC-deposit ${amount}`);
        onSigned?.('0xdeposittx', 1);
        state.wallet[USDC] -= amountUnits;
        if (state.recycleCredit) {
          state.mexc.USDC += amount;
          state.deposits.push({ txId: '0xdeposittx', amount: String(amount) });
        }
        return { ok: true, hash: '0xdeposittx', gasCostWei: 60_000n * 10n * GWEI };
      }
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
    agg: o.agg ?? {
      name: '0x',
      price: async (r) => quote(r, false),
      quote: async (r) => {
        // Phase 7 test: the fresh quote after a failed swap can itself fail.
        if (o.freshQuoteThrows && firmCalls >= 2) throw new Error('aggregator down');
        lastQuote = r;
        return quote(r, true);
      },
    },
    dexPricesFn: o.dexPricesFn ?? (async () => new Map([[XYZ, { price: dexPrice, tvl: o.dexTvl ?? 1e6, vol24h: o.dexVol24h ?? 1e6 }]])),
    sleep: async () => {},
    now: o.now,
    provenFilter: o.provenFilter,
    stableDecimals: o.stableDecimals,
    rand: o.rand,
  });
  // The withdrawal lands: MEXC reports SUCCESS (7) and the wallet balance grows.
  const arrive = (tokens: number) => {
    state.withdrawStatus = 7;
    state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n;
  };
  return { engine, db, risk, alerts, calls, cids, state, arrive, cfg };
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

test('Phase 7: failed swap while the quote is still profitable retries FAST (~25 s, not 2 min)', async () => {
  let t = Date.UTC(2026, 10, 20, 6);
  const { engine, db, calls, arrive } = setup({ sendFails: true, now: () => t });
  await engine.tick();
  arrive(198.9);
  await engine.tick(); // attempt 1: swap reverts (live ACN #3)
  const row = db.getTransfer(1)!;
  assert.equal(row.sell_attempts, 1);
  assert.equal(row.status, 'selling');
  assert.equal(row.next_try - t, 25_000); // fast retry, not the 2-min backoff
  await engine.tick(); // same instant: still waiting
  assert.equal(calls.filter((c) => c === 'send').length, 1);
  t += 25_000 + 1;
  await engine.tick(); // the fast retry executes (fails again: sendFails)
  assert.equal(calls.filter((c) => c === 'send').length, 2);
  // The second failure is no longer the first retry: the long schedule resumes (10 min).
  assert.equal(db.getTransfer(1)!.next_try - t, 10 * 60_000);
});

test('Phase 7: failed swap + fresh quote below the loss floor holds (no fast retry, no sale)', async () => {
  let t = Date.UTC(2026, 10, 20, 6);
  const { engine, db, calls, alerts, arrive } = setup({ sendFails: true, freshDexPrice: 0.9, now: () => t });
  await engine.tick();
  arrive(198.9);
  await engine.tick(); // attempt 1: first + firm quotes profitable (1.15), swap reverts; fresh quote 0.9 -> hold
  assert.equal(calls.filter((c) => c === 'send').length, 1);
  const row = db.getTransfer(1)!;
  assert.equal(row.sell_attempts, 1);
  assert.equal(row.status, 'selling');
  assert.equal(row.next_try - t, 5 * 60_000); // the existing hold path: re-check in 5 min
  assert.ok(alerts.some((a) => a.includes('HOLDING 198.9 XYZ')));
  t += 6 * 60_000;
  await engine.tick(); // re-check: quote still 0.9 -> still holding, no sale
  assert.equal(calls.filter((c) => c === 'send').length, 1);
});

test('Phase 7: failed swap + fresh quote errors falls back to the existing backoff', async () => {
  let t = Date.UTC(2026, 10, 20, 6);
  const { engine, db, calls, arrive } = setup({ sendFails: true, freshQuoteThrows: true, now: () => t });
  await engine.tick();
  arrive(198.9);
  await engine.tick(); // attempt 1 fails; the fresh quote throws too
  const row = db.getTransfer(1)!;
  assert.equal(row.sell_attempts, 1);
  assert.equal(row.status, 'selling');
  assert.equal(row.next_try - t, 2 * 60_000); // the existing 2-min backoff, not a fast retry
  await engine.tick(); // inside the backoff: no attempt
  assert.equal(calls.filter((c) => c === 'send').length, 1);
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
  assert.ok(calls.includes('market SELL XYZUSDT 199.90'));
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
  assert.ok(calls.includes('market SELL XYZUSDT 199.90'));
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

test('pickTradeSize: whole dollars in [min, max], deterministic with an injected rand', () => {
  assert.equal(pickTradeSize(100, 300, () => 0), 100);
  assert.equal(pickTradeSize(100, 300, () => 0.999), 300);
  assert.equal(pickTradeSize(100, 300, () => 0.5), 200);
  assert.equal(pickTradeSize(200, 200, () => 0.7), 200);
  for (let i = 0; i < 1000; i++) {
    const s = pickTradeSize(100, 300);
    assert.ok(Number.isInteger(s) && s >= 100 && s <= 300, String(s));
  }
});

test('random trade size (unknown TVL fallback): rand 0 rolls the minimum ($100) paper trade', async () => {
  // Phase 2: the random roll survives ONLY as the fail-open fallback for an
  // unknown pool TVL — so this test sets dexTvl 0 (and minDexTvlUsd 0, or the
  // gap would never be found). A known pool ignores rand (see the test above).
  const { engine, db } = setup({ mode: 'paper', minTradeUsd: 100, maxTradeUsd: 300, rand: () => 0, dexPrice: 1.29, dexTvl: 0, minDexTvlUsd: 0 });
  await engine.tick();
  const trades = db.all<Record<string, unknown>>('SELECT * FROM trades');
  assert.equal(trades.length, 1);
  assert.ok(Math.abs(Number(trades[0].size_usd) - 100) < 0.5, String(trades[0].size_usd));
});

test('random trade size (unknown TVL fallback): rand ~1 rolls the maximum ($300) paper trade', async () => {
  const { engine, db } = setup({ mode: 'paper', minTradeUsd: 100, maxTradeUsd: 300, rand: () => 0.999, dexPrice: 1.15, dexTvl: 0, minDexTvlUsd: 0 });
  await engine.tick();
  const trades = db.all<Record<string, unknown>>('SELECT * FROM trades');
  assert.equal(trades.length, 1);
  assert.ok(Math.abs(Number(trades[0].size_usd) - 300) < 0.5, String(trades[0].size_usd));
});

test('loadUniverse respects WATCHLIST', async () => {
  const fake = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC')],
    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }, { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' }],
    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', '0x3333333333333333333333333333333333333333')],
  };
  const { tokens: u } = await loadUniverse(fake as never, { minVolumeUsd: 1, only: ['ABC'] });
  assert.deepEqual(u.map((t) => t.base), ['ABC']);
});

test('dexPrices returns the max 24h DEX volume per token', async () => {
  const AAA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const pairs = [
    { chainId: 'ethereum', priceUsd: '2', liquidity: { usd: 500_000 }, volume: { h24: 30_000 }, baseToken: { address: AAA } },
    { chainId: 'ethereum', priceUsd: '2.1', liquidity: { usd: 900_000 }, volume: { h24: 15_000 }, baseToken: { address: AAA } },
    { chainId: 'bsc', priceUsd: '9', liquidity: { usd: 9e6 }, volume: { h24: 9e6 }, baseToken: { address: AAA } },
    { chainId: 'ethereum', priceUsd: '1', liquidity: { usd: 100_000 }, baseToken: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } },
  ];
  const fetchFn = (async () => ({ ok: true, json: async () => pairs })) as never;
  const m = await dexPrices([AAA, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], fetchFn);
  assert.equal(m.get(AAA.toLowerCase())?.price, 2.1); // deepest pair wins the price
  assert.equal(m.get(AAA.toLowerCase())?.tvl, 900_000);
  assert.equal(m.get(AAA.toLowerCase())?.vol24h, 30_000); // max h24 across its pairs
  assert.equal(m.get('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')?.vol24h, 0); // no volume field
});

test('loadUniverse filters by DEX 24h volume and caps at max, best MEXC volume first', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  const DEF = '0x4444444444444444444444444444444444444444';
  const fake = {
    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC'), symbolInfo('DEF')],
    tickers24h: async () => [
      { symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' },
      { symbol: 'ABCUSDT', quoteVolume: '5e6', lastPrice: '1' },
      { symbol: 'DEFUSDT', quoteVolume: '8e6', lastPrice: '1' },
    ],
    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', ABC), coin('DEF', DEF)],
  };
  const dexFn = (async (addrs: string[]) => new Map(addrs.map((a) => [a, {
    price: 1, tvl: 1e6,
    vol24h: a === XYZ ? 50_000 : a === ABC ? 10_000 : 30_000,
  }]))) as never;
  const { tokens: u } = await loadUniverse(fake as never, { minVolumeUsd: 1, only: [], minDexVolumeUsd: 20_000, max: 2 }, dexFn);
  assert.deepEqual(u.map((t) => t.base), ['XYZ', 'DEF']); // ABC dropped (DEX vol 10k); sorted by MEXC vol desc
  const { tokens: capped } = await loadUniverse(fake as never, { minVolumeUsd: 1, only: [], minDexVolumeUsd: 20_000, max: 1 }, dexFn);
  assert.deepEqual(capped.map((t) => t.base), ['XYZ']);
});

test('refreshUniverse honours MIN_DEX_VOLUME_USD (live volume rule)', async () => {
  const { engine } = setup({ minDexVolumeUsd: 20000 }); // fake DEX vol 1e6 -> XYZ passes
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']);
  const low = setup({ minDexVolumeUsd: 20000, dexVol24h: 100 }); // below the $20k floor -> dropped
  await low.engine.refreshUniverse(true);
  assert.deepEqual(low.engine.universe, []);
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

test('provenFilter restricts the transfer universe to proven tokens only', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  const { engine } = setup({
    extraTokens: [{ base: 'ABC', contract: ABC }],
    provenFilter: (t) => t.filter((x) => x.base === 'XYZ'),
  });
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']);
  assert.equal(engine.provenFilteredEmpty, false);
});

test('no provenFilter scans every token that passes the base filters', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  const { engine } = setup({ extraTokens: [{ base: 'ABC', contract: ABC }] });
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe.map((t) => t.base).sort(), ['ABC', 'XYZ']);
});

test('provenFilter empty waits instead of trading (provenFilteredEmpty)', async () => {
  const { engine } = setup({ provenFilter: () => [] });
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe, []);
  assert.equal(engine.provenFilteredEmpty, true);
  await engine.tick(); // must not throw or trade with an empty universe
  assert.deepEqual(engine.universe, []);
});

test('provenFilter re-applies on rescan, so newly proven tokens join live', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  let proven = ['XYZ'];
  const { engine } = setup({
    extraTokens: [{ base: 'ABC', contract: ABC }],
    provenFilter: (t) => t.filter((x) => proven.includes(x.base)),
  });
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']);
  proven = ['XYZ', 'ABC'];
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.universe.map((t) => t.base).sort(), ['ABC', 'XYZ']);
});

// Gap-record fix (2026-11-22): transfer mode kept the best rough gaps in
// memory only, so sub-threshold gaps were invisible. tick() now writes the
// top 5 rough gaps per tick to the opportunities table.
test('tick records the top sub-threshold gaps', async () => {
  const { engine, db } = setup({ dexPrice: 1.01 }); // gap 1% < 3% threshold -> no trade
  await engine.tick();
  const rows = db.all<Record<string, unknown>>('SELECT * FROM opportunities');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.token, 'XYZ');
  assert.equal(r.gross_bps, 100);
  assert.equal(r.decision, 'below_hurdle');
  assert.equal(r.reason, 'transfer-scan');
  assert.equal(r.net_usd, null); // rough row: no exact quote was taken
  assert.equal(r.size_usd, null);
  assert.equal(r.aggregator, 'dexscreener');
  assert.equal(r.direction, 'CEX_BUY');
  assert.equal(r.mexc_ask, 1.0);
  assert.equal(r.dex_out, 1.01);
  assert.equal(engine.lastTopGaps[0].token.base, 'XYZ');
});

test('tick records above-threshold gaps as trade', async () => {
  const { engine, db } = setup({ dexPrice: 1.15, mode: 'paper' }); // gap 15% >= 3%
  await engine.tick();
  const rows = db.all<Record<string, unknown>>('SELECT * FROM opportunities');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gross_bps, 1500);
  assert.equal(rows[0].decision, 'trade');
  assert.equal(rows[0].reason, 'transfer-scan');
  assert.equal(rows[0].net_usd, null); // still a rough row, even when it trades
  // The paper trade itself was still booked.
  assert.equal(db.all('SELECT * FROM trades').length, 1);
});

test('tick with no positive gap records nothing', async () => {
  const { engine, db } = setup({ dexPrice: 0.99 }); // DEX below MEXC: gap -1%
  await engine.tick();
  assert.equal(db.all('SELECT * FROM opportunities').length, 0);
  assert.deepEqual(engine.lastTopGaps, []);
});

test('a failing gap write does not kill the tick', async () => {
  const { engine, db } = setup({ dexPrice: 1.01 });
  db.insertOpportunities = () => {
    throw new Error('boom');
  };
  await engine.tick(); // must resolve, not throw
  assert.equal(db.all('SELECT * FROM opportunities').length, 0);
});

test('tick drops a thin-book gap: records it as thin-book, no trade', async () => {
  // FOLD live: 2.1% gap but top-20 asks totalled $165.96 < $300 size.
  const { engine, db } = setup({ dexPrice: 1.15, mode: 'paper', depthAsks: [[1.0, 100]] }); // asks total $100 < $200 size
  await engine.tick();
  const rows = db.all<Record<string, unknown>>('SELECT * FROM opportunities');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, 'XYZ');
  assert.equal(rows[0].gross_bps, 1500);
  assert.equal(rows[0].decision, 'rule'); // not a trade candidate
  assert.equal(rows[0].reason, 'thin-book');
  assert.equal(rows[0].net_usd, null);
  assert.equal(db.all('SELECT * FROM trades').length, 0); // never evaluated
  assert.equal(engine.lastTopGaps[0].token.base, 'XYZ'); // the rough gap is still tracked
});

test('a failed depth read is fail-open: the gap stays a trade candidate', async () => {
  const { engine, db } = setup({ dexPrice: 1.15, mode: 'paper', depthThrows: true });
  await engine.tick();
  const rows = db.all<Record<string, unknown>>('SELECT * FROM opportunities');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'trade'); // NOT marked thin-book
  assert.equal(rows[0].reason, 'transfer-scan');
  // No trade is booked here only because this fake's depth also fails
  // inside evaluate(); the filter itself did not drop the token.
});

test('stableDecimals 18 (BSC USDT): an 18-decimal stable converts like a 6-decimal one', async () => {
  // Without the stableDec fix the engine converts the 18-decimal quote with 6
  // decimals and the booked sell price is ~1e12x too big.
  const { engine, db } = setup({ dexPrice: 1.15, mode: 'paper', stableDecimals: 18 });
  await engine.tick();
  const trades = db.all<Record<string, unknown>>('SELECT * FROM trades');
  assert.equal(trades.length, 1);
  const sell = Number(trades[0].sell_price);
  assert.ok(sell > 1.0 && sell < 1.3, `sell_price ${sell} should be near the DEX price 1.15`);
  assert.ok(Number(trades[0].expected_net) > 0);
});

test('BSC gas is priced in BNB, not ETH (audit 2026-11-22, H2)', async () => {
  // Same flow as the below-floor hold test, but on BSC: the approval gas is
  // 60,000 gas x 10 gwei = 0.0006 BNB x $900 = $0.54. The old code priced it
  // in ETH ($2000) and booked $1.20 — ~3x too much.
  const { engine, db, arrive } = setup({ chain: 'bsc', stableDecimals: 18, firmDexPrice: 0.9 });
  await engine.tick(); // finds gap, buys, withdraws
  arrive(198.9);
  await engine.tick(); // first quote ok, approval, firm quote 0.9 -> hold
  const row = db.openTransfers().find((t) => t.id === 1)!;
  assert.equal(row.status, 'selling');
  assert.ok(Math.abs((row.gas_usd ?? 0) - 0.54) < 1e-9, `gas_usd ${row.gas_usd} should be $0.54 (BNB-priced), not $1.20 (ETH-priced)`);
});

test('MEXC client order ids are unique per chain (audit 2026-11-22, H1)', async () => {
  const bsc = setup({ chain: 'bsc', stableDecimals: 18, firmDexPrice: 0.9 });
  await bsc.engine.tick();
  bsc.arrive(198.9);
  await bsc.engine.tick();
  assert.ok(bsc.cids.includes('bsc1b'), `buy cid should be bsc1b, got ${bsc.cids}`);
  assert.ok(bsc.cids.includes('bsc1w'), `withdraw cid should be bsc1w, got ${bsc.cids}`);
  const eth = setup({ firmDexPrice: 0.9 });
  await eth.engine.tick();
  eth.arrive(198.9);
  await eth.engine.tick();
  assert.ok(eth.cids.includes('ethereum1b'), `buy cid should be ethereum1b, got ${eth.cids}`);
  assert.ok(eth.cids.includes('ethereum1w'), `withdraw cid should be ethereum1w, got ${eth.cids}`);
  // No twin may ever emit the old bare format: all three twins share one
  // MEXC account and their transfer ids each restart at 1.
  assert.ok(![...bsc.cids, ...eth.cids].some((c) => /^arb\d+[bw]$/.test(c)), `old bare cid format found: ${[...bsc.cids, ...eth.cids]}`);
});

// ---------------- Phase 1 depth filter ----------------
// A counting aggregator: price() must NOT be called for a depth-rejected
// candidate (the whole point is to save the exact quote).
const countingAgg = (counter: { price: number }, px = 1.15): Aggregator => ({
  name: '0x',
  price: async (r) => {
    counter.price++;
    const out = (r.sellAmount * BigInt(Math.round(px * 100))) / 100n / 1_000_000_000_000n; // token(18) -> stable(6) at px
    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender' };
  },
  quote: async (r) => {
    const out = (r.sellAmount * BigInt(Math.round(px * 100))) / 100n / 1_000_000_000_000n;
    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: { to: '0xah', data: '0x01', value: 0n } };
  },
});
const thinToken = (): ScanToken => ({
  base: 'XYZ', symbol: 'XYZUSDT', address: XYZ, netWork: 'ETH', withdrawFee: 1, withdrawMin: 10,
  qtyStep: 0.01, priceDecimals: 4, volumeUsd: 9e6,
  rules: { qtyStep: 0.01, priceDecimals: 4, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT'], tradeSideType: 1 },
});
const gasInfo = { baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI };

test('evaluate() returns null on a thin pool and never asks the aggregator', async () => {
  const counter = { price: 0 };
  const { engine } = setup({ agg: countingAgg(counter) });
  const gap = { token: thinToken(), ask: 1.0, dexPrice: 1.15, tvlUsd: 42_000, gapPct: 15 };
  assert.equal(await engine.evaluate(gap, gasInfo, 2000, 200), null);
  assert.equal(counter.price, 0); // no exact quote was spent on the $42k pool
});

test('evaluate() on a deep pool still quotes normally', async () => {
  const counter = { price: 0 };
  const { engine } = setup({ agg: countingAgg(counter) });
  const gap = { token: thinToken(), ask: 1.0, dexPrice: 1.15, tvlUsd: 1_000_000, gapPct: 15 };
  const c = await engine.evaluate(gap, gasInfo, 2000, 200);
  assert.ok(c !== null);
  assert.equal(counter.price, 1);
  assert.ok(c.ev.net > 0, `net ${c.ev.net} should be positive on a 15% gap`);
});

test('evaluate() with unknown pool tvl (0) is fail-open: it still quotes', async () => {
  const counter = { price: 0 };
  const { engine } = setup({ agg: countingAgg(counter) });
  const gap = { token: thinToken(), ask: 1.0, dexPrice: 1.15, tvlUsd: 0, gapPct: 15 };
  const c = await engine.evaluate(gap, gasInfo, 2000, 200);
  assert.ok(c !== null);
  assert.equal(counter.price, 1);
});

test('tick() logs a depth rejection for a thin pool and books no trade', async () => {
  const counter = { price: 0 };
  // The pool thins out AFTER the universe load (deep then, $42k now): the
  // universe filter keeps XYZ, so the tick-level depth filter is what drops
  // it. (With a static $42k tvl the universe filter would drop it first.)
  let calls = 0;
  const dexPricesFn = async (addrs: string[]) => {
    calls++;
    const tvl = calls === 1 ? 1e6 : 42_000;
    return new Map(addrs.map((a) => [a, { price: 1.15, tvl, vol24h: 1e6 }]));
  };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, agg: countingAgg(counter), dexPricesFn });
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    await engine.tick();
  } finally {
    console.log = origLog;
  }
  assert.ok(lines.some((l) => l.includes('XYZ: depth reject — pool $42k < $150k')), lines.join('\n'));
  assert.equal(counter.price, 0);
  assert.equal(db.all('SELECT * FROM trades').length, 0);
  // Phase 6: the thin-pool tick persisted exactly ONE summary row (not one
  // row per rejected candidate), with the top-10 detail JSON.
  const rejects = db.all<Record<string, unknown>>('SELECT * FROM depth_rejects');
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].total, 1);
  assert.equal(rejects[0].chain, 'ethereum');
  const detail = JSON.parse(String(rejects[0].detail)) as { token: string; liq_usd: number; impact_pct: number; reason: string }[];
  assert.equal(detail.length, 1);
  assert.equal(detail[0].token, 'XYZ');
  assert.equal(detail[0].liq_usd, 42_000);
  assert.match(detail[0].reason, /pool \$42k < \$150k/);
});

// Grok v2 review / board audit M1: the pool-liquidity floor in loadUniverse
// used to drop known-thin pools with only a log line, so the dashboard
// Depth section stayed empty. refreshUniverse must record every such drop
// through the same depth-rejects path, so the tick's flush persists it.
test('refreshUniverse records universe-build depth drops in depth_rejects', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  // XYZ is thin at universe-load ($42k); ABC is deep ($1M) so the tick has
  // a live candidate and proceeds to the end-of-tick flush.
  const dexPricesFn = async (addrs: string[]) =>
    new Map(addrs.map((a) => [a, { price: 1.15, tvl: a === XYZ.toLowerCase() ? 42_000 : 1_000_000, vol24h: 1e6 }]));
  const { engine, db } = setup({
    mode: 'paper', minDexTvlUsd: 0,
    extraTokens: [{ base: 'ABC', contract: ABC }],
    dexPricesFn,
  });
  await engine.tick();
  // lastDepthRejects is 0 by design here: refreshUniverse flushed the
  // universe drop immediately and reset the per-tick counter, so the
  // tick-end flush only covers candidates evaluated in the tick. The
  // persisted row below is the source of truth.
  assert.equal(engine.lastDepthRejects, 0);
  const rejects = db.all<Record<string, unknown>>('SELECT * FROM depth_rejects');
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].total, 1);
  assert.equal(rejects[0].chain, 'ethereum');
  const detail = JSON.parse(String(rejects[0].detail)) as { token: string; liq_usd: number; impact_pct: number; reason: string }[];
  assert.equal(detail.length, 1);
  assert.equal(detail[0].token, 'XYZ');
  assert.equal(detail[0].liq_usd, 42_000);
  assert.match(detail[0].reason, /pool \$42k < \$150k/);
});

// The flush must happen in refreshUniverse, not at the end of the tick:
// refreshUniverse also runs at startup (before any tick), every tick
// resets the counters at its start, and a tick with no fresh gaps returns
// early — all three would lose the drops before a tick-end flush. Here
// ABC has no gap, so the tick returns early, yet the universe drop must
// still be persisted.
test('refreshUniverse persists universe-build drops even when the tick returns early (no gaps)', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  const dexPricesFn = async (addrs: string[]) =>
    new Map(addrs.map((a) => [a, { price: a === ABC.toLowerCase() ? 1.0 : 1.15, tvl: a === XYZ.toLowerCase() ? 42_000 : 1_000_000, vol24h: 1e6 }]));
  const { engine, db } = setup({
    mode: 'paper', minDexTvlUsd: 0,
    extraTokens: [{ base: 'ABC', contract: ABC }],
    dexPricesFn,
  });
  await engine.tick();
  assert.equal(db.all('SELECT * FROM trades').length, 0); // no gap -> no trade, tick returned early
  const rejects = db.all<Record<string, unknown>>('SELECT * FROM depth_rejects');
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].total, 1);
  const detail = JSON.parse(String(rejects[0].detail)) as { token: string; reason: string }[];
  assert.equal(detail[0].token, 'XYZ');
  assert.match(detail[0].reason, /pool \$42k < \$150k/);
});

test('tick() sizes down from the impact cap instead of quoting: safe size below MIN skips the token', async () => {
  const counter = { price: 0 };
  // Phase 2: the size adapts to the pool instead of being rejected at a fixed
  // size — $200 into a $300k pool at a 0.10% cap has a safe size of only
  // $150, below MIN_TRADE_USD $200, so the token is skipped with no quote.
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 300_000, depthMaxImpactBps: 10, agg: countingAgg(counter) });
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    await engine.tick();
  } finally {
    console.log = origLog;
  }
  assert.ok(lines.some((l) => l.includes('XYZ: depth size $150 < MIN_TRADE_USD $200')), lines.join('\n'));
  assert.equal(counter.price, 0);
  assert.equal(db.all('SELECT * FROM trades').length, 0);
});

test('tick() ignores the random roll for a known pool: depth-derived size $300', async () => {
  // Phase 2: the shared random roll is gone — with a $300k pool the safe size
  // is $1050, capped by MAX_TRADE_USD $300, so rand 0 (which used to roll
  // $100) no longer matters: the paper trade is booked at $300, 1 quote.
  const counter = { price: 0 };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 300_000, dexPrice: 1.29, minTradeUsd: 100, maxTradeUsd: 300, rand: () => 0, agg: countingAgg(counter, 1.29) });
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    await engine.tick();
  } finally {
    console.log = origLog;
  }
  assert.ok(lines.some((l) => l.includes('XYZ: depth size $300 (pool $300k, impact 0.70%)')), lines.join('\n'));
  assert.equal(counter.price, 1);
  const trades = db.all<Record<string, unknown>>('SELECT * FROM trades');
  assert.equal(trades.length, 1);
  assert.ok(Math.abs(Number(trades[0].size_usd) - 300) < 0.5, String(trades[0].size_usd));
  // Phase 6: the paper trade records the winning aggregator + the depth
  // context its size was derived from (pool $300k -> safe size $1050).
  assert.equal(trades[0].aggregator, '0x');
  assert.equal(trades[0].pool_tvl_usd, 300_000);
  assert.ok(Math.abs(Number(trades[0].safe_size_usd) - 1050) < 1e-6, String(trades[0].safe_size_usd));
});

// ---------------- Phase 6: depth-reject persistence ----------------
test('Phase 6: a tick with zero depth rejects writes no depth_rejects row', async () => {
  const counter = { price: 0 };
  // Deep pool, passing trade: no rejects at all, so no summary row.
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 300_000, dexPrice: 1.29, minTradeUsd: 100, maxTradeUsd: 300, rand: () => 0, agg: countingAgg(counter, 1.29) });
  await engine.tick();
  assert.equal(engine.lastDepthRejects, 0);
  assert.equal(db.all('SELECT * FROM depth_rejects').length, 0);
});

test('Phase 6: the safe-size-below-MIN reject is also persisted with its reason', async () => {
  const counter = { price: 0 };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 300_000, depthMaxImpactBps: 10, agg: countingAgg(counter) });
  await engine.tick();
  assert.equal(engine.lastDepthRejects, 1);
  assert.equal(counter.price, 0);
  const rejects = db.all<Record<string, unknown>>('SELECT * FROM depth_rejects');
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].total, 1);
  const detail = JSON.parse(String(rejects[0].detail)) as { token: string; reason: string }[];
  assert.equal(detail[0].token, 'XYZ');
  assert.match(detail[0].reason, /depth size \$150 < MIN_TRADE_USD \$200/);
});

// ---------------- Phase 2 dynamic sizing ----------------
// An aggregator whose fill worsens with size: above `splitTokens` tokens it
// pays `bigPx` per token, below it `smallPx`. Lets the $300 size lose to the
// $280 size even though both see the same rough 15% gap.
const stepAgg = (counter: { price: number }, bigPx: number, smallPx: number, splitTokens = 290): Aggregator => {
  const at = (r: QuoteRequest, firm: boolean): Quote => {
    counter.price++;
    const tokens = Number(r.sellAmount) / 1e18;
    const px = tokens > splitTokens ? bigPx : smallPx;
    const out = (r.sellAmount * BigInt(Math.round(px * 100))) / 100n / 1_000_000_000_000n; // token(18) -> stable(6) at px
    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
  };
  return { name: '0x', price: async (r) => at(r, false), quote: async (r) => at(r, true) };
};

test('depth ladder: shallow $160k pool tries $300, then $280 — and the smaller size wins', async () => {
  // Safe size is 0.7% of the $80k half = $560, so the ladder is $300 (100%,
  // capped by MAX_TRADE_USD) then $280 (50%). At $300 the quote pays 1.08
  // (net ~$10.79 < need $15, gross ~$22.76 close enough to try smaller);
  // at $280 it pays 1.12 (net ~$20.57 > $15), so the trade is booked at $280.
  const counter = { price: 0 };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 160_000, dexPrice: 1.15, minTradeUsd: 100, maxTradeUsd: 300, agg: stepAgg(counter, 1.08, 1.12) });
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    await engine.tick();
  } finally {
    console.log = origLog;
  }
  assert.ok(lines.some((l) => l.includes('XYZ: depth size $300 (pool $160k, impact 0.70%)')), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('XYZ: depth size $300 (pool $160k, impact 0.70%); ladder $300 / $280')), lines.join('\n'));
  assert.equal(counter.price, 2); // $300, then $280 — and the pass stops the ladder
  const trades = db.all<Record<string, unknown>>('SELECT * FROM trades');
  assert.equal(trades.length, 1);
  assert.ok(Math.abs(Number(trades[0].size_usd) - 280) < 0.5, String(trades[0].size_usd)); // best net wins, not the largest size
});

test('depth ladder: below the hurdle at every size costs at most 3 quotes', async () => {
  // Test-only MAX_TRADE_USD $500 (live stays $300): safe size $560 gives a
  // genuine 3-size ladder $500 / $420 / $280. A flat 1.05 fill is below the
  // $15 hurdle at every size but its gross stays close, so all three are
  // tried — and no fourth quote exists.
  const counter = { price: 0 };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 160_000, dexPrice: 1.15, minTradeUsd: 100, maxTradeUsd: 500, agg: stepAgg(counter, 1.05, 1.05) });
  await engine.tick();
  assert.equal(counter.price, 3);
  assert.ok(counter.price <= 3);
  assert.equal(db.all('SELECT * FROM trades').length, 0); // nothing passed the hurdle
});

test('depth ladder: below-hurdle at $300 with a far gross stops after 1 quote', async () => {
  // Same $160k ladder, but a 1.02 fill is nowhere near the hurdle (gross
  // ~$4.83 < 0.7 * $15): the smaller size is not worth quoting.
  const counter = { price: 0 };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 160_000, dexPrice: 1.15, minTradeUsd: 100, maxTradeUsd: 300, agg: stepAgg(counter, 1.02, 1.02) });
  await engine.tick();
  assert.equal(counter.price, 1);
  assert.equal(db.all('SELECT * FROM trades').length, 0);
});

test('depth ladder: safe size below MIN_TRADE_USD skips the token, agg.price never called', async () => {
  // $10k pool (floor lowered to 0 for this test, or the pool-floor reject
  // would fire first): safe size is 0.7% of the $5k half = $35 < MIN $100.
  const counter = { price: 0 };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, dexTvl: 10_000, minPoolLiquidityUsd: 0, minTradeUsd: 100, maxTradeUsd: 300, agg: countingAgg(counter) });
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    await engine.tick();
  } finally {
    console.log = origLog;
  }
  assert.ok(lines.some((l) => l.includes('XYZ: depth size $35 < MIN_TRADE_USD $100')), lines.join('\n'));
  assert.equal(counter.price, 0);
  assert.equal(db.all('SELECT * FROM trades').length, 0);
});

// ---------------- Phase 5: parallel evaluation + dynamic hurdle + rejection counts ----------------
// A delaying aggregator that prices per token and tracks in-flight price()
// calls, so the test can prove candidates really overlap instead of running
// one after another.
const parallelAgg = (track: { inFlight: number; maxInFlight: number; price: number }, pxByToken: Record<string, number>): Aggregator => ({
  name: '0x',
  price: async (r) => {
    track.price++;
    track.inFlight++;
    track.maxInFlight = Math.max(track.maxInFlight, track.inFlight);
    try {
      await new Promise((res) => setTimeout(res, 15));
      const px = pxByToken[r.sellToken.toLowerCase()] ?? 1.15;
      const out = (r.sellAmount * BigInt(Math.round(px * 100))) / 100n / 1_000_000_000_000n;
      return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender' };
    } finally {
      track.inFlight--;
    }
  },
  quote: async (r) => {
    const px = pxByToken[r.sellToken.toLowerCase()] ?? 1.15;
    const out = (r.sellAmount * BigInt(Math.round(px * 100))) / 100n / 1_000_000_000_000n;
    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: { to: '0xah', data: '0x01', value: 0n } };
  },
});

test('Phase 5: parallel evaluation — two passing candidates overlap, only the best (highest net) trades', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  const track = { inFlight: 0, maxInFlight: 0, price: 0 };
  // ABC pays 1.25 on the DEX, XYZ 1.15: ABC's net is higher, so the
  // sequential loop would pick ABC too (it takes the max net) — the winner
  // must be identical, only the evaluation overlaps now.
  const dexPricesFn = async (addrs: string[]) =>
    new Map(addrs.map((a) => [a, a.toLowerCase() === ABC.toLowerCase() ? { price: 1.25, tvl: 1e6, vol24h: 1e6 } : { price: 1.15, tvl: 1e6, vol24h: 1e6 }]));
  const { engine, db } = setup({
    mode: 'paper',
    extraTokens: [{ base: 'ABC', contract: ABC }],
    dexPricesFn,
    agg: parallelAgg(track, { [XYZ.toLowerCase()]: 1.15, [ABC.toLowerCase()]: 1.25 }),
  });
  await engine.tick();
  assert.ok(track.maxInFlight >= 2, `candidates ran sequentially (max in-flight ${track.maxInFlight})`);
  assert.equal(track.price, 2); // one exact quote per candidate, no extra
  const trades = db.all<Record<string, unknown>>('SELECT * FROM trades');
  assert.equal(trades.length, 1); // exactly one transfer starts per tick — no double execution
  assert.equal(trades[0].symbol, 'ABC'); // the higher-net candidate wins
});

test('Phase 5: parallel evaluation respects the quote budget — a 1 rps bucket lets one candidate through', async () => {
  const ABC = '0x3333333333333333333333333333333333333333';
  const counter = { price: 0 };
  const dexPricesFn = async (addrs: string[]) =>
    new Map(addrs.map((a) => [a, { price: 1.15, tvl: 1e6, vol24h: 1e6 }]));
  // The Limited wrapper is what main.ts puts around every aggregator: the
  // second concurrent price() throws QuoteBudgetError, the tick cools that
  // token down instead of crashing, and at most one trade starts.
  const { engine, db } = setup({
    mode: 'paper',
    extraTokens: [{ base: 'ABC', contract: ABC }],
    dexPricesFn,
    agg: new Limited(countingAgg(counter), new TokenBucket(1)),
  });
  await engine.tick(); // must resolve, not throw
  assert.equal(counter.price, 1); // only the first candidate got a quote
  assert.ok(db.all('SELECT * FROM trades').length <= 1);
});

test('Phase 5: dynamic hurdle — MIN_PROFIT_BPS_ETH blocks the trade on Ethereum', async () => {
  // Default hurdle at $200 is max($15, 50 bps) = $15 and the 15% gap passes
  // (see 'tick records above-threshold gaps as trade'); at 5000 bps the
  // need is $100, which no $200 trade can clear.
  const { engine, db } = setup({ dexPrice: 1.15, mode: 'paper', minProfitBpsEth: 5000 });
  await engine.tick();
  assert.equal(db.all('SELECT * FROM trades').length, 0);
});

test('Phase 5: dynamic hurdle — the same MIN_PROFIT_BPS_ETH is ignored on BSC (L2 keeps the old hurdle)', async () => {
  const { engine, db } = setup({ dexPrice: 1.15, mode: 'paper', chain: 'bsc', stableDecimals: 18, minProfitBpsEth: 5000 });
  await engine.tick();
  assert.equal(db.all('SELECT * FROM trades').length, 1);
});

test('Phase 5: thin-pool rejection count — lastDepthRejects counts the dropped candidate', async () => {
  const counter = { price: 0 };
  let calls = 0;
  const dexPricesFn = async (addrs: string[]) => {
    calls++;
    const tvl = calls === 1 ? 1e6 : 42_000;
    return new Map(addrs.map((a) => [a, { price: 1.15, tvl, vol24h: 1e6 }]));
  };
  const { engine, db } = setup({ mode: 'paper', minDexTvlUsd: 0, agg: countingAgg(counter), dexPricesFn });
  await engine.tick();
  assert.equal(engine.lastDepthRejects, 1);
  assert.equal(counter.price, 0); // no exact quote was spent on the $42k pool
  assert.equal(db.all('SELECT * FROM trades').length, 0);
});

// ---------------------------------------------------------- Phase 8: USDC recycle hook

test('Phase 8: a completed sell recycles its USDC back to MEXC as USDT in the same scan', async () => {
  const { engine, db, alerts, state, arrive } = setup();
  await engine.tick(); // buy + withdraw
  arrive(198.9);
  await engine.tick(); // sell on DEX, then recycle in the same scan
  const row = db.getTransfer(1)!;
  assert.equal(row.status, 'done');
  assert.equal(row.recycle_status, 'done');
  assert.ok((row.recycled_usdc ?? 0) > 200, `recycled ${row.recycled_usdc}`);
  assert.ok(Math.abs((row.recycled_usdt ?? 0) - (row.recycled_usdc ?? 0) * 0.999) < 0.01);
  assert.equal(row.recycle_address, DEPOSIT_ADDR);
  assert.equal(row.recycle_tx, '0xdeposittx');
  assert.equal(row.recycle_order_id, 'ethereum1r');
  assert.equal(state.depositSends, 1); // one deposit send, never two
  assert.equal(state.recycleSells, 1); // one USDCUSDT sell, never two
  assert.equal(state.wallet[USDC], 0n); // proceeds left the wallet
  // MEXC USDT: 1000 - 200 (buy #1) + ~228.47 (recycle) - 200 (buy #2, gap still open) = ~828.50.
  // The recycle itself restored ~228.47 (asserted above via recycled_usdt).
  assert.ok(state.mexc.USDT > 800, `MEXC USDT: ${state.mexc.USDT}`);
  assert.ok(alerts.some((a) => a.includes('sent $') && a.includes('USDC to MEXC')));
  assert.ok(alerts.some((a) => a.includes('recycled') && a.includes('USDT on MEXC')));
});

test('Phase 8 restart: recycle resumes mid-flight without double-send', async () => {
  const first = setup({ recycleCredit: false });
  await first.engine.tick();
  first.arrive(198.9);
  await first.engine.tick(); // sell completes; the deposit is sent but never credits
  const row = first.db.getTransfer(1)!;
  assert.equal(row.status, 'done');
  assert.equal(row.recycle_status, 'sent');
  assert.equal(first.state.depositSends, 1);
  assert.equal(first.state.recycleSells, 0);
  // "Restart": new engine, same database and balances; the deposit credits while down.
  const second = setup({ db: first.db });
  Object.assign(second.state, first.state);
  second.state.recycleCredit = true;
  second.state.mexc.USDC = row.recycled_usdc ?? 0;
  second.state.deposits.push({ txId: '0xdeposittx', amount: String(row.recycled_usdc ?? 0) });
  await second.engine.tick();
  assert.equal(second.db.getTransfer(1)!.recycle_status, 'done');
  assert.equal(second.state.depositSends, 1); // the new engine sent nothing
  assert.equal(second.state.recycleSells, 1);
});

test('Phase 8 catch-up: first tick sweeps pre-existing wallet USDC (no new trade)', async () => {
  const { engine, db, alerts, state } = setup({ dexPrice: 1.0 }); // no gap: no new transfer starts
  state.wallet[USDC] = BigInt(Math.round(263.99 * 1e6)); // transfer #3's proceeds, already in the wallet
  await engine.tick();
  assert.equal(db.getState('recycle:catchup-done'), '1');
  assert.equal(state.depositSends, 1);
  assert.equal(state.recycleSells, 1);
  assert.equal(state.wallet[USDC], 0n);
  assert.ok(alerts.some((a) => a.includes('Catch-up sweep') && a.includes('263.99')));
});

test('Phase 8: /recycle resumes a held recycle', async () => {
  const { engine, db, state, arrive } = setup({ recycleCredit: false });
  await engine.tick();
  // Drive transfer #1 to done with the deposit stuck in transit.
  arrive(198.9);
  await engine.tick();
  assert.equal(db.getTransfer(1)!.recycle_status, 'sent');
  // A held recycle reports as such and resumes via /recycle.
  db.updateTransfer(1, { recycle_held: 1, recycle_note: 'test hold' });
  assert.match(engine.retryRecycle(1), /resumes on the next scan/);
  assert.equal(engine.retryRecycle(99), 'No transfer #99');
  // The catch-up already marked itself done on the dust balance in the ticks above.
  assert.equal(engine.retryCatchUp(), 'Catch-up sweep is already done.');
});

// ---------------- Phase 9: profit-token priority watch ----------------
const ABC_A = '0x3333333333333333333333333333333333333333';
const winRow = (symbol: string, pnl: number, status: 'ok' | 'one_sided' = 'ok') => ({
  ts: Date.now(), day: '2026-11-23', mode: 'live', symbol, direction: 'TRANSFER',
  size_usd: 200, qty: 10, buy_price: 1, sell_price: 1.1, expected_net: pnl,
  cex_fee_usd: 1, gas_usd: 4, pnl_usd: pnl, status, dex_tx: null, cex_order_id: null, note: null,
});

test('Phase 9: winnersFirst puts winners first, each group keeping gap order', () => {
  const rules = { qtyStep: 0.01, priceDecimals: 4, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT'], tradeSideType: 1 };
  const tok = (base: string): ScanToken => ({ base, symbol: `${base}USDT`, address: `0x${base}`, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6, rules });
  const gap = (base: string, gapPct: number): Gap => ({ token: tok(base), ask: 1, dexPrice: 1 + gapPct / 100, tvlUsd: 1e6, gapPct });
  const gaps = [gap('XYZ', 15), gap('ABC', 4), gap('DEF', 9), gap('GHI', 2)];
  assert.deepEqual(winnersFirst(gaps, new Set(['ABC', 'GHI'])).map((g) => g.token.base), ['ABC', 'GHI', 'XYZ', 'DEF']);
  assert.deepEqual(winnersFirst(gaps, new Set()).map((g) => g.token.base), ['XYZ', 'ABC', 'DEF', 'GHI']); // no winners: order untouched
});

test('Phase 9 (7a): with ONE exact-quote slot, a winner gap is evaluated before a larger non-winner gap', async () => {
  const { engine, db, calls } = setup({
    scanExactQuotes: 1,
    extraTokens: [{ base: 'ABC', contract: ABC_A }],
    // Rough gaps: XYZ 15%, ABC 4% — without priority XYZ would take the only slot.
    dexPricesFn: async (addrs: string[]) => new Map(addrs.map((a) => [a, { price: a === ABC_A.toLowerCase() ? 1.04 : 1.15, tvl: 1e6, vol24h: 1e6 }])),
  });
  db.insertTrade(winRow('ABC', 10)); // ABC is a winner: +$10 booked live
  await engine.tick();
  assert.deepEqual(engine.winners, [{ base: 'ABC', pnl: 10, trades: 1 }]);
  const transfers = db.all<{ base: string; status: string }>('SELECT base, status FROM transfers');
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].base, 'ABC'); // the winner traded, not the 15% non-winner
  assert.ok(calls.some((c) => c === 'withdraw 199.90 ABC ETH -> 0xMyWallet'), calls.join(' | '));
  assert.ok(!calls.some((c) => c.includes(' XYZ ')), 'XYZ must never have been touched');
});

test('Phase 9 (7c): with slots remaining, a non-winner still trades on merit (best net wins)', async () => {
  const { engine, db } = setup({
    scanExactQuotes: 2,
    extraTokens: [{ base: 'ABC', contract: ABC_A }],
    dexPricesFn: async (addrs: string[]) => new Map(addrs.map((a) => [a, { price: a === ABC_A.toLowerCase() ? 1.04 : 1.15, tvl: 1e6, vol24h: 1e6 }])),
    // Exact quotes: XYZ 1.15 (net ~$18.70, passes), ABC 1.14 (net ~$16.80, passes but smaller).
    // Both are evaluated (2 slots); the non-winner wins on net — priority is not a gate.
    dexPriceByToken: new Map([[ABC_A.toLowerCase(), 1.14]]),
  });
  db.insertTrade(winRow('ABC', 10));
  await engine.tick();
  const transfers = db.all<{ base: string; status: string }>('SELECT base, status FROM transfers');
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].base, 'XYZ');
});

test('Phase 9 (7b): a winner is pinned in the universe after its volume drops below the top-max cut', async () => {
  const { engine, db } = setup({
    transferUniverseMax: 1, // top-1 by volume only
    extraTokens: [{ base: 'ABC', contract: ABC_A }],
    dexPricesFn: async (addrs: string[]) => new Map(addrs.map((a) => [a, { price: 1, tvl: 1e6, vol24h: 1e6 }])),
  });
  db.insertTrade(winRow('ABC', 10));
  db.insertTrade(winRow('XYZ', 10)); // XYZ won once…
  db.insertTrade(winRow('XYZ', -25, 'one_sided')); // …then lost bigger: net -$15, NOT a winner
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.winners, [{ base: 'ABC', pnl: 10, trades: 1 }]);
  // XYZ and ABC have the same fake volume (9e6); XYZ keeps the top-1 slot and ABC is pinned past it.
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ', 'ABC']);
});

test('Phase 9 (7b): a winner that fails a safety filter is NOT pinned', async () => {
  const { engine, db } = setup({
    transferUniverseMax: 1,
    extraTokens: [{ base: 'ABC', contract: ABC_A }],
    // ABC's pool is $42k, below the $150k floor: pinning must not rescue it.
    dexPricesFn: async (addrs: string[]) => new Map(addrs.map((a) => [a, { price: 1, tvl: a === ABC_A.toLowerCase() ? 42_000 : 1e6, vol24h: 1e6 }])),
  });
  db.insertTrade(winRow('ABC', 10));
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.winners, [{ base: 'ABC', pnl: 10, trades: 1 }]); // still a winner…
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']); // …but not in the universe
});

test('Phase 9: paper mode never has winners (paper PnL is simulated, not live)', async () => {
  const { engine, db } = setup({ mode: 'paper', extraTokens: [{ base: 'ABC', contract: ABC_A }] });
  db.insertTrade({ ...winRow('ABC', 100), mode: 'paper', status: 'paper' });
  await engine.refreshUniverse(true);
  assert.deepEqual(engine.winners, []);
  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ', 'ABC']); // no cap, both in — no pinning needed
});

// ---------------- Phase 4: DEX-DEX detection in the transfer tick ----------------
// Live bots run STRATEGY=transfer, so the inventory engine's scanDexArbTick
// never runs live — the transfer tick runs its own copy (see src/transfer.ts
// scanDexArbTick). Detection only: rows are recorded, nothing is ever traded,
// sent, or approved.
const dexArbRows = (db: Db) =>
  db.all<{ token: string; direction: string; size_usd: number | null; aggregator: string | null; dex_out: number | null; gross_bps: number | null; gas_usd: number | null; net_usd: number | null; hurdle_usd: number | null; decision: string; reason: string | null }>(
    "SELECT * FROM opportunities WHERE direction = 'DEX_ARB'",
  );

// Direction-aware fake aggregator for the detection scan: the buy leg
// (stable -> token) pays buyPx per token, the sell leg (token -> stable)
// pays sellPx. `seen` records every priced token (buy or sell leg) so the
// rotation test can tell which tokens were scanned. quote() delegates to
// price() — the transfer's firm quote only runs when a real transfer starts.
const arbAgg = (buyPx: number, sellPx: number, seen: string[]): Aggregator => {
  const price = async (r: QuoteRequest): Promise<Quote> => {
    if (r.sellToken === USDC) {
      seen.push(`buy:${r.buyToken}`);
      const tokens = (r.sellAmount * 10n ** 18n) / BigInt(Math.round(buyPx * 1e6));
      return { buyAmount: tokens, minBuyAmount: tokens, gas: 150_000n, spender: '0xspender' };
    }
    seen.push(`sell:${r.sellToken}`);
    const out = (r.sellAmount * BigInt(Math.round(sellPx * 1e6))) / 10n ** 18n;
    return { buyAmount: out, minBuyAmount: out, gas: 150_000n, spender: '0xspender' };
  };
  return { name: 'test-arb', price, quote: price };
};

test('DEX-ARB disabled: the scan never runs (counting agg)', async () => {
  // No CEX gap (dexPrice 1.0), so the only quotes this tick could spend are
  // the detection scan's. With the flag off, the aggregator is never called
  // and no DEX_ARB rows are recorded.
  const seen: string[] = [];
  const { engine, db } = setup({ dexPrice: 1.0, agg: arbAgg(10, 10, seen) });
  await engine.tick();
  assert.deepEqual(seen, []);
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB enabled, flat market: below_hurdle row with the engine fields', async () => {
  // Buy $200 of XYZ at $10 (20 XYZ), sell 20 XYZ at $10 ($200). Gas $3/leg,
  // so net is -$6 against the $15 hurdle: below_hurdle, with the same fields
  // the inventory engine records (size, aggregator, dex_out, gross, gas,
  // net, hurdle) and the same reason text.
  const seen: string[] = [];
  const { engine, db, calls } = setup({ dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 10, seen) });
  await engine.tick();
  assert.equal(seen.length, 2); // buy leg + sell leg, nothing else
  const rows = dexArbRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, 'XYZ');
  assert.equal(rows[0].decision, 'below_hurdle');
  assert.match(rows[0].reason ?? '', /dex-arb detection only — no execution/);
  assert.equal(rows[0].size_usd, 200);
  assert.equal(rows[0].aggregator, 'test-arb');
  assert.equal(rows[0].dex_out, 20);
  assert.equal(rows[0].gross_bps, 0);
  assert.equal(rows[0].gas_usd, 6);
  assert.equal(rows[0].net_usd, -6);
  assert.equal(rows[0].hurdle_usd, 15);
  // Detection only: no transfer started, nothing was sent or withdrawn.
  assert.equal(db.openTransfers().length, 0);
  assert.ok(!calls.includes('send'));
  assert.ok(!calls.some((c) => c.startsWith('withdraw')));
});

test('DEX-ARB enabled with a real spread: recorded as trade, nothing executed', async () => {
  // Buy $200 at $10 (20 XYZ), sell 20 XYZ at $11.50 ($230). Gas $3/leg,
  // net $24 > hurdle $15: decision 'trade' — which here means "net beat
  // the hurdle", NOT that a trade was made.
  const seen: string[] = [];
  const { engine, db, calls } = setup({ dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 11.5, seen) });
  await engine.tick();
  const rows = dexArbRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'trade');
  assert.equal(rows[0].reason, 'dex-arb detection only — no execution');
  assert.equal(rows[0].net_usd, 24);
  assert.equal(rows[0].gross_bps, 1500);
  assert.equal(rows[0].size_usd, 200);
  assert.equal(db.openTransfers().length, 0);
  assert.ok(!calls.includes('send'));
  assert.ok(!calls.some((c) => c.startsWith('withdraw')));
});

test('DEX-ARB runs on the main path too (paper mode, real CEX gap)', async () => {
  // A passing CEX gap: the tick evaluates, finds the candidate, runs the
  // detection scan (main path, after evaluation), then records the paper
  // trade. Both the paper trade and the DEX_ARB row land.
  const seen: string[] = [];
  const { engine, db } = setup({ mode: 'paper', dexArbEnabled: true, dexPrice: 1.15, agg: arbAgg(10, 11.5, seen) });
  await engine.tick();
  const rows = dexArbRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'trade');
  assert.equal(db.all('SELECT * FROM trades').length, 1);
});

test('DEX-ARB runs while a transfer is open (open-blocked tick)', async () => {
  // Tick 1 starts a transfer (CEX gap passes, sell leg $10 vs MEXC $1);
  // tick 2 finds it still open (withdrawal pending) and blocks new trades —
  // but the detection scan still runs, so a second DEX_ARB row lands.
  const seen: string[] = [];
  const { engine, db } = setup({ dexArbEnabled: true, agg: arbAgg(10, 10, seen) });
  await engine.tick();
  assert.equal(db.openTransfers().length, 1);
  assert.equal(dexArbRows(db).length, 1);
  await engine.tick();
  assert.equal(db.openTransfers().length, 1); // still open, withdrawal pending
  assert.equal(dexArbRows(db).length, 2);
});

test('DEX-ARB does NOT run on an open-blocked tick when gas is over the limit (audit round 2, N1)', async () => {
  // The gas gate sits above the open-blocked branch (same order as the
  // inventory engine): a high-gas tick never spends quotes on detection,
  // even while a transfer is open. Tick 1 (normal gas) starts the transfer
  // and scans once; tick 2 runs on a second engine over the same DB with
  // MAX_GAS_GWEI=5 (fake gas is 10 gwei) and must scan nothing.
  const seen: string[] = [];
  const db = new Db(':memory:');
  const first = setup({ db, dexArbEnabled: true, agg: arbAgg(10, 10, seen) });
  await first.engine.tick();
  assert.equal(db.openTransfers().length, 1);
  assert.equal(dexArbRows(db).length, 1);
  // Tick 1 also took a CEX evaluation quote through the shared fake agg, so
  // snapshot its count rather than assuming the scan's 2 legs alone.
  const seenAfterTick1 = seen.length;
  process.env.MAX_GAS_GWEI = '5';
  try {
    const second = setup({ db, dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 10, seen) });
    await second.engine.tick();
  } finally {
    delete process.env.MAX_GAS_GWEI;
  }
  assert.equal(seen.length, seenAfterTick1); // tick 2 priced nothing
  assert.equal(dexArbRows(db).length, 1); // no new row from tick 2
});

test('DEX-ARB runs when MEXC USDT is too low for a trade (cap-null tick)', async () => {
  // A CEX gap exists but USDT is $0, so no trade can start — the detection
  // scan does not need MEXC USDT, so it still runs.
  const seen: string[] = [];
  const { engine, db, state } = setup({ dexArbEnabled: true, dexPrice: 1.15, agg: arbAgg(10, 10, seen) });
  state.mexc.USDT = 0;
  await engine.tick();
  assert.equal(dexArbRows(db).length, 1);
  assert.equal(db.openTransfers().length, 0);
});

test('DEX-ARB rotation: the window advances across ticks and covers the universe', async () => {
  // 8 tokens, 5 scanned per tick: tick 1 covers 5, tick 2 covers the other
  // 3 plus 2 repeats — the union is all 8, and the second window differs
  // from the first (the cursor advances instead of re-scanning the same
  // first tokens every tick).
  const extras = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    base: `TK${String.fromCharCode(64 + i)}`,
    contract: `0x400000000000000000000000000000000000000${i}`,
  }));
  const seen: string[] = [];
  const { engine, db } = setup({
    dexArbEnabled: true,
    dexPrice: 1.0,
    extraTokens: extras,
    agg: arbAgg(10, 10, seen),
    dexPricesFn: async (addrs: string[]) => new Map(addrs.map((a) => [a, { price: 1, tvl: 1e6, vol24h: 1e6 }])),
  });
  const distinct = (calls: string[]) => new Set(calls.map((s) => s.split(':')[1]));
  await engine.tick();
  assert.equal(dexArbRows(db).length, 5);
  assert.equal(distinct(seen).size, 5);
  const firstWindow = new Set(distinct(seen));
  await engine.tick();
  assert.equal(dexArbRows(db).length, 10);
  assert.equal(distinct(seen).size, 8);
  // Tick 2 priced 10 more legs (5 tokens); its window is not tick 1's window.
  const secondWindow = new Set(seen.slice(10).map((s) => s.split(':')[1]));
  assert.equal(secondWindow.size, 5);
  assert.notDeepEqual(secondWindow, firstWindow);
});

// Audit round 1, finding 6: the early returns that skip detection must stay
// skipped (same gates as the inventory engine), and the scan's own failure
// modes must not crash the tick or write a row.
test('DEX-ARB does NOT run on a risk-blocked tick (paused)', async () => {
  const seen: string[] = [];
  const db = new Db(':memory:');
  db.setState('paused', '1');
  db.setState('pause_reason', 'test pause');
  const { engine } = setup({ db, dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 10, seen) });
  await engine.tick();
  assert.equal(seen.length, 0);
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB does NOT run on a gas-blocked tick', async () => {
  // Fake gas is 10 gwei; MAX_GAS_GWEI=5 blocks new trades before the scan.
  const seen: string[] = [];
  process.env.MAX_GAS_GWEI = '5';
  try {
    const { engine, db } = setup({ dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 10, seen) });
    await engine.tick();
    assert.equal(seen.length, 0);
    assert.equal(dexArbRows(db).length, 0);
  } finally {
    delete process.env.MAX_GAS_GWEI;
  }
});

test('DEX-ARB does NOT run while an earlier DEX tx is unresolved', async () => {
  const seen: string[] = [];
  const { engine, db } = setup({
    dexArbEnabled: true,
    dexPrice: 1.0,
    agg: arbAgg(10, 10, seen),
    checkUnresolved: async () => ({ state: 'pending' as const }),
  });
  await engine.tick();
  assert.equal(seen.length, 0);
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB does NOT run when the USDC/USDT peg check fails', async () => {
  const seen: string[] = [];
  const { engine, db } = setup({
    dexArbEnabled: true,
    dexPrice: 1.0,
    agg: arbAgg(10, 10, seen),
    bookTickers: new Map([
      ['ETHUSDT', { bid: 2000, ask: 2000 }],
      ['USDCUSDT', { bid: 0.5, ask: 0.5 }], // peg broken: the tick returns before any scan
      ['XYZUSDT', { bid: 0.999, ask: 1.0 }],
    ]),
  });
  await engine.tick();
  assert.equal(seen.length, 0);
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB skips a token whose decimals lookup fails (no crash, no row)', async () => {
  const seen: string[] = [];
  const { engine, db } = setup({ dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 10, seen), decimalsThrows: true });
  await engine.tick();
  assert.equal(seen.length, 0);
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB retries a decimals-failed window next tick (audit round 3, N5)', async () => {
  // N2's fix: the cursor advances by the tokens actually scanned, so a
  // window that all failed decimals is retried next tick instead of being
  // skipped for a full rotation. 8 tokens, 5 per window: tick 1 calls
  // decimals for the first window's 5; tick 2 (still failing) must call
  // decimals for the SAME 5 — with the old advance-by-window-size the
  // second window would be a different 5.
  const extras = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    base: `TK${String.fromCharCode(64 + i)}`,
    contract: `0x400000000000000000000000000000000000000${i}`,
  }));
  const calls: string[] = [];
  const { engine, db } = setup({
    dexArbEnabled: true,
    dexPrice: 1.0,
    extraTokens: extras,
    agg: arbAgg(10, 10, []),
    dexPricesFn: async (addrs: string[]) => new Map(addrs.map((a) => [a, { price: 1, tvl: 1e6, vol24h: 1e6 }])),
    decimalsThrows: true,
    decimalsCalls: calls,
  });
  await engine.tick();
  assert.equal(calls.length, 5);
  assert.equal(dexArbRows(db).length, 0);
  await engine.tick();
  assert.equal(calls.length, 10);
  assert.deepEqual(new Set(calls.slice(5)), new Set(calls.slice(0, 5))); // same window retried
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB survives a failing opportunities write (scan error cannot kill the tick)', async () => {
  // The DEX-ARB write is wrapped in the scan (log.warn); a DB failure must
  // not propagate out of the tick — the scan still priced the token's legs.
  const seen: string[] = [];
  const db = new Db(':memory:');
  const orig = db.insertOpportunities.bind(db);
  db.insertOpportunities = (rows) => {
    if (rows.some((r) => r.direction === 'DEX_ARB')) throw new Error('db down');
    return orig(rows);
  };
  const { engine } = setup({ db, dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 10, seen) });
  await engine.tick(); // must resolve, not throw
  assert.equal(seen.length, 2); // both legs were priced before the write failed
  assert.equal(dexArbRows(db).length, 0); // the write failed, so no row landed
});

test('DEX-ARB with an empty universe records nothing (no crash)', async () => {
  // MIN_DEX_VOLUME_USD far above the fake volume drops every token.
  const seen: string[] = [];
  const { engine, db } = setup({ dexArbEnabled: true, dexPrice: 1.0, agg: arbAgg(10, 10, seen), minDexVolumeUsd: 1e9 });
  await engine.tick();
  assert.equal(seen.length, 0);
  assert.equal(dexArbRows(db).length, 0);
});

test('DEX-ARB with no TVL-known tokens records nothing (no quote spent)', async () => {
  const seen: string[] = [];
  const { engine, db } = setup({
    dexArbEnabled: true,
    dexPrice: 1.0,
    agg: arbAgg(10, 10, seen),
    dexPricesFn: async () => new Map(),
  });
  await engine.tick();
  assert.equal(seen.length, 0);
  assert.equal(dexArbRows(db).length, 0);
});
