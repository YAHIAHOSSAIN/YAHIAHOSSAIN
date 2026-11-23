import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decodeDepthPush } from '../src/mexc/proto.js';
import { MexcRest } from '../src/mexc/rest.js';
import { ZeroEx, ZEROX_ALLOWANCE_HOLDER } from '../src/dex/aggregator.js';
import { AmbiguousRequestError } from '../src/mexc/rest.js';
import { placeSafely } from '../src/engine.js';
import { hurdleBps, loadConfig, secretsOf, validateConfig } from '../src/config.js';
import { Telegram } from '../src/telegram.js';
import { redact, registerSecrets } from '../src/log.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { ethNetwork, provenTokens, type Token } from '../src/watchlist.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- tiny protobuf encoder for building test messages ---
const varint = (n: number) => {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const field = (num: number, bytes: Uint8Array | number[]) => [...varint(num * 8 + 2), ...varint(bytes.length), ...bytes];
const s = (x: string) => [...Buffer.from(x)];
const level = (p: string, q: string) => [...field(1, s(p)), ...field(2, s(q))];

test('provenTokens keeps only paper-profitable tokens, best P&L first', () => {
  const tok = (base: string): Token => ({
    base, symbol: `${base}USDT`, address: `0x${base}`, decimals: 18, qtyStep: 0.001, priceDecimals: 4,
    rules: {} as Token['rules'], dexTvlUsd: 1_000_000, mexcVolumeUsd: 100_000, depositOk: true, withdrawOk: true,
  });
  const tokens = ['NPC', 'BGB', 'METAON', 'FET', 'PEPE'].map(tok);
  const stats = [
    { symbol: 'NPC', trades: 2, wins: 2, pnl: 19.41 },
    { symbol: 'BGB', trades: 4, wins: 4, pnl: 7.11 },
    { symbol: 'METAON', trades: 1, wins: 1, pnl: 1.38 },
    { symbol: 'FET', trades: 3, wins: 0, pnl: -1.95 },
  ];
  assert.deepEqual(provenTokens(tokens, stats, 2, 0, 10).map((t) => t.base), ['NPC', 'BGB']);
  assert.deepEqual(provenTokens(tokens, stats, 2, 0, 1).map((t) => t.base), ['NPC']);
  assert.deepEqual(provenTokens(tokens, [], 2, 0, 10), []);
});

test('twin: live bot reads paper history from the paper bot DB (readonly)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avh-twin-'));
  const file = path.join(dir, 'paper.sqlite');
  const paper = new Db(file);
  const row = (symbol: string, pnl: number) => paper.insertTrade({ ts: Date.now(), day: '2026-11-21', mode: 'paper', symbol, direction: 'CEX_BUY', size_usd: 300, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 0, pnl_usd: pnl, status: 'paper', dex_tx: null, cex_order_id: null, note: null });
  row('NPC', 10);
  row('NPC', 9.41);
  row('BGB', -1);
  const twin = new Db(file, true);
  const stats = twin.paperTokenStats().sort((a, b) => a.symbol.localeCompare(b.symbol));
  assert.deepEqual(stats, [
    { symbol: 'BGB', trades: 1, wins: 0, pnl: -1 },
    { symbol: 'NPC', trades: 2, wins: 2, pnl: 19.41 },
  ]);
  twin.close();
  paper.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('decodes a MEXC limit-depth protobuf push', () => {
  const depth = [
    ...field(1, level('101.5', '2')),
    ...field(1, level('101.0', '1')),
    ...field(2, level('100.0', '3')),
    ...field(2, level('100.5', '4')),
    ...field(3, s('spot@public.limit.depth.v3.api.pb')),
  ];
  const msg = Uint8Array.from([
    ...field(1, s('spot@public.limit.depth.v3.api.pb@LINKUSDT@20')),
    ...field(3, s('LINKUSDT')),
    ...varint(6 * 8), ...varint(1_795_193_165_568), // sendTime int64
    ...field(303, depth),
  ]);
  const d = decodeDepthPush(msg)!;
  assert.equal(d.symbol, 'LINKUSDT');
  assert.deepEqual(d.asks, [[101, 1], [101.5, 2]]); // sorted best first
  assert.deepEqual(d.bids, [[100.5, 4], [100, 3]]);
  assert.equal(decodeDepthPush(Uint8Array.from(field(1, s('x')))), null);
});

test('MEXC signed request: HMAC over the exact query + API key header', async () => {
  let url = '';
  let headers: Record<string, string> = {};
  const fetchFn = (async (u: string, o: { headers: Record<string, string> }) => {
    url = u;
    headers = o.headers;
    return new Response(JSON.stringify({ orderId: '42' }), { status: 200 });
  }) as unknown as typeof fetch;
  const m = new MexcRest('KEY', 'SECRET', 'https://api.mexc.com', fetchFn);
  await m.limitOrder('LINKUSDT', 'SELL', '1.50', '10.123');
  const u = new URL(url);
  const sig = u.searchParams.get('signature');
  u.searchParams.delete('signature');
  assert.equal(sig, crypto.createHmac('sha256', 'SECRET').update(u.searchParams.toString()).digest('hex'));
  assert.equal(headers['X-MEXC-APIKEY'], 'KEY');
  assert.equal(u.searchParams.get('type'), 'LIMIT');
});

test('MEXC errors never contain the secret', async () => {
  registerSecrets(['SUPERSECRETVALUE']);
  const fetchFn = (async () => new Response('bad SUPERSECRETVALUE', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(new MexcRest('k', 'SUPERSECRETVALUE', 'https://x', fetchFn).balances(), (e: Error) => !e.message.includes('SUPERSECRETVALUE'));
  assert.equal(redact('key=SUPERSECRETVALUE'), 'key=***');
});

const AH = '0x0000000000001fF3684f28c67538d4D072C22734'; // 0x AllowanceHolder (mixed case like the API)
const zeroExWith = (body: object) =>
  new ZeroEx('k', (async (_u: string, o: { headers: Record<string, string> }) => {
    assert.equal(o.headers['0x-version'], 'v2');
    return new Response(JSON.stringify({ liquidityAvailable: true, buyAmount: '1000', minBuyAmount: '990', ...body }));
  }) as unknown as typeof fetch);
const req = { sellToken: '0xa', buyToken: '0xb', sellAmount: 5n, taker: '0xt', slippageBps: 30 };

test('0x quote parsing: amounts, gas, spender, tx', async () => {
  const q = await zeroExWith({
    issues: { allowance: { spender: AH } },
    transaction: { to: AH, data: '0xabc', gas: '150000', value: '0' },
  }).quote(req);
  assert.equal(q.buyAmount, 1000n);
  assert.equal(q.minBuyAmount, 990n);
  assert.equal(q.gas, 150000n);
  assert.equal(q.spender, ZEROX_ALLOWANCE_HOLDER);
  assert.equal(q.tx?.data, '0xabc');
  // no allowance issue -> spender is still the AllowanceHolder, never tx.to blindly
  const p = await zeroExWith({ transaction: { to: AH, data: '0x', gas: '1', value: '0' } }).quote(req);
  assert.equal(p.spender, ZEROX_ALLOWANCE_HOLDER);
});

test('0x response pointing at an unknown contract is rejected (allowlist)', async () => {
  await assert.rejects(
    zeroExWith({ transaction: { to: '0x000000000000000000000000000000000000bad1', data: '0x', gas: '1', value: '0' } }).quote(req),
    /not the allowlisted contract/,
  );
  await assert.rejects(zeroExWith({ issues: { allowance: { spender: '0x000000000000000000000000000000000000bad2' } } }).price(req), /allowlisted/);
});

test('placeSafely: a timed-out order that WAS placed is found by client id; one that was not is reported', async () => {
  const sleep = async () => {};
  const ambiguous = async (): Promise<{ orderId: string }> => {
    throw new AmbiguousRequestError('timeout');
  };
  const found = await placeSafely({ getOrderByClientId: async () => ({ orderId: '77' }) as never }, 'X', 'cid', ambiguous, sleep);
  assert.equal(found.orderId, '77');
  await assert.rejects(placeSafely({ getOrderByClientId: async () => null }, 'X', 'cid', ambiguous, sleep), /timeout/);
  await assert.rejects(
    placeSafely({ getOrderByClientId: async () => { throw new Error('down'); } }, 'X', 'cid', ambiguous, sleep),
    /UNKNOWN_ORDER_STATE/,
  );
  // a clear rejection is not looked up at all
  let looked = false;
  await assert.rejects(
    placeSafely({ getOrderByClientId: async () => ((looked = true), null) }, 'X', 'cid', async () => { throw new Error('insufficient balance'); }, sleep),
    /insufficient/,
  );
  assert.equal(looked, false);
});

test('config validation rejects dangerous values', () => {
  process.env.RPC_URL = 'http://x';
  process.env.MODE = 'paper';
  // A VPS .env could set the depth knobs out of range and break this test.
  delete process.env.MIN_POOL_LIQUIDITY_USD;
  delete process.env.DEPTH_MAX_IMPACT_BPS;
  delete process.env.DEPTH_MAX_SIZE_PCT;
  delete process.env.QUOTE_RPS_VELORA;
  delete process.env.QUOTE_RPS_OPENOCEAN;
  delete process.env.REBALANCE_LOW_X;
  delete process.env.DEX_ARB_ENABLED;
  delete process.env.MIN_PROFIT_BPS_ETH;
  delete process.env.BUILDER_TIP_GWEI;
  const ok = loadConfig();
  assert.doesNotThrow(() => validateConfig(ok));
  assert.throws(() => validateConfig({ ...ok, minProfitBps: -1 }), /MIN_PROFIT_BPS/);
  assert.throws(() => validateConfig({ ...ok, dexSlippageBps: 20_000 }), /DEX_SLIPPAGE_BPS/);
  assert.throws(() => validateConfig({ ...ok, minTradeUsd: 500, maxTradeUsd: 200 }), /MIN_TRADE_USD/);
});

test('Phase 5: dynamic hurdle + builder tip — defaults off, ranges enforced, ETH-only', () => {
  const saved = { ...process.env };
  try {
    process.env.RPC_URL = 'http://x';
    process.env.MODE = 'paper';
    delete process.env.MIN_PROFIT_BPS_ETH;
    delete process.env.BUILDER_TIP_GWEI;
    delete process.env.MIN_PROFIT_BPS;
    delete process.env.CHAIN;
    let c = loadConfig();
    assert.equal(c.minProfitBpsEth, 0); // off by default: current behaviour everywhere
    assert.equal(c.builderTipGwei, 0);
    assert.equal(hurdleBps(c), 20); // falls back to MIN_PROFIT_BPS
    assert.throws(() => validateConfig({ ...c, minProfitBpsEth: -1 }), /MIN_PROFIT_BPS_ETH/);
    assert.throws(() => validateConfig({ ...c, minProfitBpsEth: 10_001 }), /MIN_PROFIT_BPS_ETH/);
    assert.throws(() => validateConfig({ ...c, builderTipGwei: -1 }), /BUILDER_TIP_GWEI/);
    assert.throws(() => validateConfig({ ...c, builderTipGwei: 101 }), /BUILDER_TIP_GWEI/);
    // Ethereum uses the override when set; L2s ignore it.
    process.env.MIN_PROFIT_BPS_ETH = '50';
    c = loadConfig();
    assert.equal(c.chain.name, 'ethereum');
    assert.equal(hurdleBps(c), 50);
    process.env.CHAIN = 'arbitrum';
    c = loadConfig();
    assert.equal(hurdleBps(c), 20);
    process.env.CHAIN = 'bsc';
    c = loadConfig();
    assert.equal(hurdleBps(c), 20);
  } finally {
    process.env = saved;
  }
});

test('Telegram only obeys the admin user in a private chat', async () => {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, o: { body: string }) => {
    sent.push(JSON.parse(o.body).text);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as unknown as typeof fetch;
  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42');
  let stopped = 0;
  const handlers = { '/stop': () => (stopped++, 'stopped') };
  await tg.handle({ message: { chat: { id: 999, type: 'private' }, from: { id: 42 }, text: '/stop' } }, handlers); // other chat
  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 13 }, text: '/stop' } }, handlers); // wrong user
  await tg.handle({ message: { chat: { id: 777, type: 'group' }, from: { id: 42 }, text: '/stop' } }, handlers); // group
  assert.equal(stopped, 0);
  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/stop@MyBot' } }, handlers);
  assert.equal(stopped, 1);
  assert.deepEqual(sent, ['stopped']);
});

test('MEXC rules: step from baseAssetPrecision, min qty from baseSizePrecision, notional and side checks', async () => {
  const { rulesFrom, orderProblem } = await import('../src/mexc/rules.js');
  // real ETHUSDT values from exchangeInfo
  const r = rulesFrom({ symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0.0001', baseAssetPrecision: 5, quotePrecision: 2, orderTypes: ['LIMIT', 'MARKET', 'LIMIT_MAKER'], quoteAmountPrecision: '1', maxQuoteAmount: '4000000', tradeSideType: 1 });
  assert.equal(r.qtyStep, 1e-5);
  assert.equal(r.minQty, 0.0001);
  assert.equal(orderProblem(r, 'BUY', 0.01, 1600), null);
  assert.match(orderProblem(r, 'BUY', 0.00005, 1600)!, /minimum 0.0001/);
  assert.match(orderProblem(r, 'BUY', 0.0005, 1600)!, /< minimum 1 USDT/);
  assert.match(orderProblem(r, 'BUY', 0.01, 1600, 'IMMEDIATE_OR_CANCEL')!, /not allowed/);
  assert.match(orderProblem({ ...r, tradeSideType: 3 }, 'BUY', 0.01, 1600)!, /sell-only/);
  assert.match(orderProblem({ ...r, tradeSideType: 2 }, 'SELL', 0.01, 1600)!, /buy-only/);
});

test('toUnits truncates, never rounds up', async () => {
  const { toUnits } = await import('../src/util.js');
  assert.equal(toUnits(0.1239999999, 3), 123n);
  assert.equal(toUnits(1.9999999, 6), 1999999n);
  assert.equal(toUnits(0, 6), 0n);
});

test('0x requests use slippagePpm (slippageBps is deprecated) and refuse unsafe firm quotes', async () => {
  let url = '';
  const z = (body: object) =>
    new ZeroEx('k', (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ liquidityAvailable: true, buyAmount: '1', minBuyAmount: '1', transaction: { to: AH, data: '0x', gas: '1', value: '0' }, ...body }));
    }) as unknown as typeof fetch);
  await z({}).quote(req);
  assert.match(url, /slippagePpm=3000/);
  assert.doesNotMatch(url, /slippageBps/);
  await assert.rejects(z({ issues: { balance: { actual: '0' } } }).quote(req), /balance/);
  await assert.rejects(z({ issues: { simulationIncomplete: true } }).quote(req), /simulation incomplete/);
});

test('Risk: loss limit, fail streak, trade limit, kill switch', () => {
  const db = new Db(':memory:');
  const now = Date.UTC(2026, 10, 20, 6);
  const risk = new Risk(db, 'live', { maxTradesPerDay: 3, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
  const row = (pnl: number, status: 'ok' | 'one_sided') =>
    db.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: pnl, status, dex_tx: null, cex_order_id: null, note: null });

  assert.equal(risk.blockReason(), null);
  row(-10, 'one_sided');
  assert.deepEqual(risk.afterTrade('one_sided'), []);
  row(-10, 'one_sided');
  risk.afterTrade('one_sided');
  row(-5, 'one_sided');
  const ev = risk.afterTrade('one_sided');
  assert.ok(ev.some((e) => e.kind === 'fail_streak'));
  assert.match(risk.blockReason()!, /paused/);

  risk.resume();
  assert.match(risk.blockReason()!, /trade limit/); // 3 trades today

  const db2 = new Db(':memory:');
  const r2 = new Risk(db2, 'live', { maxTradesPerDay: 20, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
  db2.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: -31, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
  assert.ok(r2.afterTrade('ok').some((e) => e.kind === 'loss_limit'));
  assert.match(r2.blockReason()!, /loss limit/);
  r2.resume();
  assert.match(r2.blockReason()!, /daily loss limit/); // /start cannot override today's loss limit

  r2.pause('Telegram /stop');
  assert.match(r2.blockReason()!, /Telegram \/stop/);
});

test('ethNetwork finds the Ethereum entry in MEXC coin config', () => {
  const n = ethNetwork({
    coin: 'LINK',
    networkList: [
      { coin: 'LINK', network: 'BNB Smart Chain(BEP20)', netWork: 'BSC', contract: '0xbsc', depositEnable: true, withdrawEnable: true },
      { coin: 'LINK', network: 'Ethereum(ERC20)', netWork: 'ETH', contract: '0xeth', depositEnable: true, withdrawEnable: false },
    ],
  });
  assert.equal(n?.contract, '0xeth');
});

test('transfer strategy refuses to start without ALLOW_WITHDRAWALS=yes; safe defaults', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['MODE', 'STRATEGY', 'ALLOW_WITHDRAWALS', 'MAX_TRADE_USD', 'MIN_POOL_LIQUIDITY_USD', 'DEPTH_MAX_IMPACT_BPS', 'DEPTH_MAX_SIZE_PCT', 'QUOTE_RPS_VELORA', 'QUOTE_RPS_OPENOCEAN', 'REBALANCE_LOW_X', 'DEX_ARB_ENABLED', 'MIN_PROFIT_BPS_ETH', 'BUILDER_TIP_GWEI']) delete process.env[k];
    process.env.RPC_URL = 'http://x';
    const d = loadConfig();
    assert.equal(d.mode, 'paper');
    assert.equal(d.strategy, 'inventory');
    assert.equal(d.maxTradeUsd, 50);
    process.env.STRATEGY = 'transfer';
    assert.throws(() => loadConfig(), /ALLOW_WITHDRAWALS=yes/);
    process.env.ALLOW_WITHDRAWALS = 'yes';
    assert.equal(loadConfig().strategy, 'transfer');
  } finally {
    process.env = saved;
  }
});

test('UNLIMITED_APPROVAL defaults to off (exact approvals); yes turns it on', () => {
  const saved = { ...process.env };
  try {
    delete process.env.UNLIMITED_APPROVAL;
    process.env.RPC_URL = 'http://x';
    process.env.MODE = 'paper';
    assert.equal(loadConfig().unlimitedApproval, false);
    process.env.UNLIMITED_APPROVAL = 'yes';
    assert.equal(loadConfig().unlimitedApproval, true);
    process.env.UNLIMITED_APPROVAL = 'no';
    assert.equal(loadConfig().unlimitedApproval, false);
  } finally {
    process.env = saved;
  }
});

test('transfer universe volume knobs default to off (no DEX filter, no cap)', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['MIN_DEX_VOLUME_USD', 'TRANSFER_UNIVERSE_MAX', 'MIN_POOL_LIQUIDITY_USD', 'DEPTH_MAX_IMPACT_BPS', 'DEPTH_MAX_SIZE_PCT', 'QUOTE_RPS_VELORA', 'QUOTE_RPS_OPENOCEAN', 'REBALANCE_LOW_X', 'DEX_ARB_ENABLED', 'MIN_PROFIT_BPS_ETH', 'BUILDER_TIP_GWEI']) delete process.env[k];
    process.env.RPC_URL = 'http://x';
    process.env.MODE = 'paper';
    const c = loadConfig();
    assert.equal(c.minDexVolumeUsd, 0);
    assert.equal(c.transferUniverseMax, 0);
  } finally {
    process.env = saved;
  }
});

test('depth filter knobs default to a $150k pool floor, 70 bps impact, 1% size cap', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['MIN_POOL_LIQUIDITY_USD', 'DEPTH_MAX_IMPACT_BPS', 'DEPTH_MAX_SIZE_PCT', 'QUOTE_RPS_VELORA', 'QUOTE_RPS_OPENOCEAN', 'REBALANCE_LOW_X', 'DEX_ARB_ENABLED']) delete process.env[k];
    process.env.RPC_URL = 'http://x';
    process.env.MODE = 'paper';
    const c = validateConfig(loadConfig());
    assert.equal(c.minPoolLiquidityUsd, 150_000);
    assert.equal(c.depthMaxImpactBps, 70);
    assert.equal(c.depthMaxSizePct, 1);
    assert.throws(() => validateConfig({ ...c, minPoolLiquidityUsd: -1 }), /MIN_POOL_LIQUIDITY_USD/);
    assert.throws(() => validateConfig({ ...c, depthMaxImpactBps: 5001 }), /DEPTH_MAX_IMPACT_BPS/);
    assert.throws(() => validateConfig({ ...c, depthMaxSizePct: 101 }), /DEPTH_MAX_SIZE_PCT/);
  } finally {
    process.env = saved;
  }
});

test('Phase 4: REBALANCE_LOW_X defaults to 1 (range 0.1..10); DEX_ARB_ENABLED defaults to no (detection only)', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['REBALANCE_LOW_X', 'DEX_ARB_ENABLED', 'MIN_POOL_LIQUIDITY_USD', 'DEPTH_MAX_IMPACT_BPS', 'DEPTH_MAX_SIZE_PCT', 'QUOTE_RPS_VELORA', 'QUOTE_RPS_OPENOCEAN']) delete process.env[k];
    process.env.RPC_URL = 'http://x';
    process.env.MODE = 'paper';
    const c = validateConfig(loadConfig());
    assert.equal(c.rebalanceLowX, 1);
    assert.equal(c.dexArbEnabled, false);
    assert.throws(() => validateConfig({ ...c, rebalanceLowX: 0.05 }), /REBALANCE_LOW_X/);
    assert.throws(() => validateConfig({ ...c, rebalanceLowX: 10.1 }), /REBALANCE_LOW_X/);
    process.env.REBALANCE_LOW_X = '1.5';
    assert.equal(loadConfig().rebalanceLowX, 1.5);
    process.env.DEX_ARB_ENABLED = 'yes';
    assert.equal(loadConfig().dexArbEnabled, true);
    process.env.DEX_ARB_ENABLED = 'no';
    assert.equal(loadConfig().dexArbEnabled, false);
  } finally {
    process.env = saved;
  }
});

test('Phase 3: velora + openocean are accepted aggregator names; unknown names rejected', () => {
  const saved = { ...process.env };
  try {
    process.env.RPC_URL = 'http://x';
    process.env.MODE = 'paper';
    process.env.DEX_AGGREGATOR = 'velora,openocean';
    assert.deepEqual(loadConfig().aggregators, ['velora', 'openocean']);
    process.env.DEX_AGGREGATOR = '0x,kyber,1inch,velora,openocean';
    assert.deepEqual(loadConfig().aggregators, ['0x', 'kyber', '1inch', 'velora', 'openocean']);
    process.env.DEX_AGGREGATOR = 'velora,paraswap';
    assert.throws(() => loadConfig(), /DEX_AGGREGATOR: unknown "paraswap"/);
    delete process.env.DEX_AGGREGATOR;
    assert.deepEqual(loadConfig().aggregators, ['0x']); // default unchanged
  } finally {
    process.env = saved;
  }
});

test('Phase 3: QUOTE_RPS_VELORA defaults to 1 (free-tier limit), QUOTE_RPS_OPENOCEAN to 2; ranges enforced', () => {
  const saved = { ...process.env };
  try {
    delete process.env.QUOTE_RPS_VELORA;
    delete process.env.QUOTE_RPS_OPENOCEAN;
    process.env.RPC_URL = 'http://x';
    process.env.MODE = 'paper';
    const c = validateConfig(loadConfig());
    assert.equal(c.quoteRps.velora, 1);
    assert.equal(c.quoteRps.openocean, 2);
    assert.equal(c.quoteRps['0x'], 4); // existing defaults unchanged
    assert.throws(() => validateConfig({ ...c, quoteRps: { ...c.quoteRps, velora: -1 } }), /QUOTE_RPS_VELORA/);
    assert.throws(() => validateConfig({ ...c, quoteRps: { ...c.quoteRps, openocean: 101 } }), /QUOTE_RPS_OPENOCEAN/);
  } finally {
    process.env = saved;
  }
});

test('RPC URLs (they contain provider keys) are redacted', () => {
  process.env.RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123';
  process.env.MODE = 'paper';
  delete process.env.STRATEGY;
  const c = loadConfig();
  registerSecrets(secretsOf(c));
  assert.equal(redact('rpc https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123 failed'), 'rpc *** failed');
});

test('default economics: profit floor is small vs trade size; $15 on $50 is rejected', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['MIN_PROFIT_USD', 'MAX_TRADE_USD', 'MIN_TRADE_USD', 'TRANSFER_DRIFT_BPS', 'MODE', 'STRATEGY', 'MIN_POOL_LIQUIDITY_USD', 'DEPTH_MAX_IMPACT_BPS', 'DEPTH_MAX_SIZE_PCT', 'QUOTE_RPS_VELORA', 'QUOTE_RPS_OPENOCEAN', 'REBALANCE_LOW_X', 'DEX_ARB_ENABLED']) delete process.env[k];
    process.env.RPC_URL = 'http://x';
    const d = validateConfig(loadConfig());
    assert.ok(d.minProfitUsd <= d.maxTradeUsd * 0.1, `${d.minProfitUsd} vs ${d.maxTradeUsd}`);
    assert.throws(() => validateConfig({ ...d, minProfitUsd: 15, maxTradeUsd: 50 }), /only fake gaps/);
  } finally {
    process.env = saved;
  }
});

test('Telegram: a command sent before this start (replayed after restart) is ignored', async () => {
  const tg = new Telegram('123456:TOKENTOKEN', '777', (async () => new Response(JSON.stringify({ ok: true, result: {} }))) as unknown as typeof fetch, '42');
  let n = 0;
  const handlers = { '/start': () => (n++, 'ok') };
  const old = Math.floor(Date.now() / 1000) - 3600;
  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/start confirm', date: old } }, handlers);
  assert.equal(n, 0);
  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/start confirm', date: Math.floor(Date.now() / 1000) + 1 } }, handlers);
  assert.equal(n, 1);
});

test('aggressive close offset stays inside a tight PERCENT_PRICE_BY_SIDE band', async () => {
  const { aggressiveOffset, rulesFrom } = await import('../src/mexc/rules.js');
  const base = { symbol: 'X', baseAsset: 'X', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0', quotePrecision: 4, orderTypes: ['LIMIT'] };
  assert.equal(aggressiveOffset(rulesFrom({ ...base, filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.2', askMultiplierDown: '0.2' }] })), 0.02);
  assert.equal(aggressiveOffset(rulesFrom({ ...base, filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.02', askMultiplierDown: '0.02' }] })), 0.01);
});

test('MARKET orders use the market notional limits', async () => {
  const { orderProblem } = await import('../src/mexc/rules.js');
  const r = { qtyStep: 0.01, priceDecimals: 2, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT', 'MARKET'], tradeSideType: 1, minNotionalMarket: 5 };
  assert.equal(orderProblem(r, 'SELL', 1, 2, 'LIMIT'), null);
  assert.match(orderProblem(r, 'SELL', 1, 2, 'MARKET')!, /minimum 5/);
});

test('cancelAndConfirm: never reports a still-open order as closed', async () => {
  const { cancelAndConfirm, OrderStillOpenError } = await import('../src/engine.js');
  const open = { getOrder: async () => ({ orderId: '1', status: 'NEW', executedQty: '0' }) as never, cancelOrder: async () => { throw new Error('timeout'); } };
  await assert.rejects(cancelAndConfirm(open, 'X', '1', async () => {}), (e: unknown) => e instanceof OrderStillOpenError);
  let st = 'NEW';
  const ok = { getOrder: async () => ({ orderId: '1', status: st, executedQty: '0' }) as never, cancelOrder: async () => ((st = 'CANCELED'), {} as never) };
  assert.equal((await cancelAndConfirm(ok, 'X', '1', async () => {})).status, 'CANCELED');
});

test('OPP_RETENTION_DAYS defaults to 7 (round-3 M5)', () => {
  const saved = { ...process.env };
  try {
    delete process.env.OPP_RETENTION_DAYS;
    process.env.RPC_URL = 'http://x';
    assert.equal(loadConfig().oppRetentionDays, 7);
  } finally {
    process.env = saved;
  }
});

test('L1_FEE_USD defaults to 0 (round-3 M1)', () => {
  const saved = { ...process.env };
  try {
    delete process.env.L1_FEE_USD;
    process.env.RPC_URL = 'http://x';
    assert.equal(loadConfig().l1FeeUsd, 0);
  } finally {
    process.env = saved;
  }
});

test('transfer strategy runs on ethereum/arbitrum/bsc, not on base', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['MODE', 'STRATEGY', 'ALLOW_WITHDRAWALS', 'MAX_TRADE_USD', 'CHAIN', 'MIN_POOL_LIQUIDITY_USD', 'DEPTH_MAX_IMPACT_BPS', 'DEPTH_MAX_SIZE_PCT', 'QUOTE_RPS_VELORA', 'QUOTE_RPS_OPENOCEAN', 'REBALANCE_LOW_X', 'DEX_ARB_ENABLED']) delete process.env[k];
    process.env.RPC_URL = 'http://x';
    process.env.STRATEGY = 'transfer';
    process.env.ALLOW_WITHDRAWALS = 'yes';
    for (const chain of ['ethereum', 'arbitrum', 'bsc']) {
      process.env.CHAIN = chain;
      assert.equal(loadConfig().chain.name, chain);
      assert.equal(loadConfig().strategy, 'transfer');
    }
    process.env.CHAIN = 'base';
    assert.throws(() => loadConfig(), /only supported on CHAIN=ethereum\/arbitrum\/bsc/);
  } finally {
    process.env = saved;
  }
});
