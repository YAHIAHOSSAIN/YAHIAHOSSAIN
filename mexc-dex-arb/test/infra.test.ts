import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decodeDepthPush } from '../src/mexc/proto.js';
import { MexcRest } from '../src/mexc/rest.js';
import { ZeroEx, ZEROX_ALLOWANCE_HOLDER } from '../src/dex/aggregator.js';
import { AmbiguousRequestError } from '../src/mexc/rest.js';
import { placeSafely } from '../src/engine.js';
import { loadConfig, validateConfig } from '../src/config.js';
import { Telegram } from '../src/telegram.js';
import { redact, registerSecrets } from '../src/log.js';
import { Db } from '../src/db.js';
import { Risk } from '../src/risk.js';
import { ethNetwork } from '../src/watchlist.js';

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
  const ok = loadConfig();
  assert.doesNotThrow(() => validateConfig(ok));
  assert.throws(() => validateConfig({ ...ok, minProfitPct: -1 }), /MIN_PROFIT_PCT/);
  assert.throws(() => validateConfig({ ...ok, dexSlippageBps: 20_000 }), /DEX_SLIPPAGE_BPS/);
  assert.throws(() => validateConfig({ ...ok, minTradeUsd: 500, maxTradeUsd: 200 }), /MIN_TRADE_USD/);
});

test('Telegram only obeys the configured chat', async () => {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, o: { body: string }) => {
    sent.push(JSON.parse(o.body).text);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as unknown as typeof fetch;
  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn);
  let stopped = false;
  const handlers = { '/stop': () => ((stopped = true), 'stopped') };
  await tg.handle({ message: { chat: { id: 999 }, text: '/stop' } }, handlers);
  assert.equal(stopped, false);
  await tg.handle({ message: { chat: { id: 777 }, text: '/stop@MyBot' } }, handlers);
  assert.equal(stopped, true);
  assert.deepEqual(sent, ['stopped']);
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
