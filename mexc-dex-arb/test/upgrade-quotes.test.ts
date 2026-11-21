// Phase-1 upgrade, item 4: KyberSwap, best-of quotes, 0x fee, rate limiter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BestOf,
  KYBER_ROUTER_V2,
  Kyber,
  Limited,
  QuoteBudgetError,
  TokenBucket,
  applyZeroExFee,
  type Aggregator,
  type Quote,
  type QuoteRequest,
} from '../src/dex/aggregator.js';
import { RateLimitError } from '../src/mexc/rest.js';

const req: QuoteRequest = { sellToken: '0xSELL', buyToken: '0xBUY', sellAmount: 1000n, taker: '0xme', slippageBps: 30 };
const ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'; // as the API returns it (mixed case)

function kyberWith(router = ROUTER) {
  const calls: { url: string; body?: unknown; headers: Record<string, string> }[] = [];
  const fetchFn = (async (u: string, o: { headers: Record<string, string>; method?: string; body?: string }) => {
    calls.push({ url: u, body: o.body ? JSON.parse(o.body) : undefined, headers: o.headers });
    if (u.includes('/routes')) {
      return new Response(JSON.stringify({ code: 0, data: { routerAddress: router, routeSummary: { amountOut: '5000', gas: '250000', routeID: 'r1' } } }));
    }
    return new Response(JSON.stringify({ code: 0, data: { amountOut: '4990', gas: '260000', data: '0xcalldata', routerAddress: router, transactionValue: '0' } }));
  }) as unknown as typeof fetch;
  return { k: new Kyber('base', 'mexc-dex-arb', fetchFn), calls };
}

test('Kyber price: routes on the right chain path, x-client-id header, router pinned', async () => {
  const { k, calls } = kyberWith();
  const q = await k.price(req);
  assert.match(calls[0].url, /aggregator-api\.kyberswap\.com\/base\/api\/v1\/routes\?tokenIn=0xSELL&tokenOut=0xBUY&amountIn=1000/);
  assert.equal(calls[0].headers['x-client-id'], 'mexc-dex-arb');
  assert.equal(q.buyAmount, 5000n);
  assert.equal(q.minBuyAmount, 4985n); // 30 bps
  assert.equal(q.spender, KYBER_ROUTER_V2);
  assert.equal(q.source, 'kyber');
});

test('Kyber quote: build with slippage in bps, output to our own wallet, tx.to pinned', async () => {
  const { k, calls } = kyberWith();
  const q = await k.quote(req);
  const body = calls[1].body as { slippageTolerance: number; sender: string; recipient: string; routeSummary: { routeID: string } };
  assert.equal(body.slippageTolerance, 30);
  assert.equal(body.sender, '0xme');
  assert.equal(body.recipient, '0xme');
  assert.equal(body.routeSummary.routeID, 'r1');
  assert.equal(q.tx?.to, KYBER_ROUTER_V2);
  assert.equal(q.tx?.data, '0xcalldata');
  assert.equal(q.buyAmount, 4990n);
});

test('Kyber response with an unknown router is rejected', async () => {
  const { k } = kyberWith('0x000000000000000000000000000000000000bad1');
  await assert.rejects(k.price(req), /not the allowlisted contract/);
});

test('0x fee is treated as a cost (until proven already net)', () => {
  const base = { buyAmount: 1000n, minBuyAmount: 990n };
  assert.deepEqual(applyZeroExFee(base, { amount: '15', token: '0xbuy' }, req), { buyAmount: 985n, minBuyAmount: 975n });
  // fee in the sell token: the output shrinks in proportion (sold 1000, 15 of it was fee)
  assert.deepEqual(applyZeroExFee(base, { amount: '15', token: '0xSELL' }, req), { buyAmount: 985n, minBuyAmount: 975n });
  assert.deepEqual(applyZeroExFee(base, null, req), base);
});

test('token bucket: at most `rps` calls per second; a 429 blocks for Retry-After', async () => {
  let t = 0;
  const b = new TokenBucket(2, () => t);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false); // budget used
  t += 500;
  assert.equal(b.take(), true); // refilled one
  b.block(10);
  t += 5_000;
  assert.equal(b.take(), false);
  t += 6_000;
  assert.equal(b.take(), true);
});

test('Limited: over budget -> QuoteBudgetError; a 429 blocks the aggregator', async () => {
  let calls = 0;
  const inner: Aggregator = {
    name: 'x',
    price: async () => {
      calls++;
      throw new RateLimitError('429', 30);
    },
    quote: async () => ({}) as Quote,
  };
  let t = 0;
  const l = new Limited(inner, new TokenBucket(5, () => t));
  await assert.rejects(l.price(req), (e) => e instanceof RateLimitError);
  await assert.rejects(l.price(req), (e) => e instanceof QuoteBudgetError); // blocked for 30 s, not called
  assert.equal(calls, 1);
});

test('BestOf: best output AFTER gas wins; all rate-limited -> QuoteBudgetError', async () => {
  const mk = (name: string, buy: bigint, gas: bigint): Aggregator => ({
    name,
    price: async () => ({ buyAmount: buy, minBuyAmount: buy, gas, spender: '0x', source: name }),
    quote: async () => ({ buyAmount: buy, minBuyAmount: buy, gas, spender: '0x', source: name }),
  });
  const b = new BestOf([mk('0x', 1000n, 100n), mk('kyber', 1010n, 500n)]);
  assert.equal((await b.price(req)).source, 'kyber'); // more output, gas not valued
  b.gasInOutput = (g) => g / 10n; // gas worth 10 vs 50 output units
  assert.equal((await b.price(req)).source, '0x'); // 1000-10 > 1010-50
  const limited: Aggregator = { name: 'z', price: async () => { throw new QuoteBudgetError('x'); }, quote: async () => { throw new QuoteBudgetError('x'); } };
  await assert.rejects(new BestOf([limited, limited]).price(req), (e) => e instanceof QuoteBudgetError);
});
