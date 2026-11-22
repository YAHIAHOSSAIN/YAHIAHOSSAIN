// Phase-1 upgrade, item 4: KyberSwap, best-of quotes, 0x fee, rate limiter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BestOf,
  KYBER_ROUTER_V2,
  Kyber,
  Limited,
  OPENOCEAN_EXCHANGE_V2,
  OpenOcean,
  QuoteBudgetError,
  TokenBucket,
  VELORA_ROUTER_V6_2,
  Velora,
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

// --- Phase 3: Velora (ex-ParaSwap, Market API v6.2) ---

const VROUTER = '0x6A000F20005980200259B80c5102003040001068'; // as the API returns it (mixed case)
const veloraRoute = {
  srcToken: '0xSELL',
  srcAmount: '1000',
  destToken: '0xBUY',
  destAmount: '5000',
  gasCost: '250000',
  contractAddress: VROUTER,
  tokenTransferProxy: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
  version: '6.2',
  hmac: 'deadbeef',
};

function veloraWith(route: object = veloraRoute, txTo: string = VROUTER, pricesStatus = 200) {
  const calls: { url: string; body?: unknown; method?: string }[] = [];
  const fetchFn = (async (u: string, o: { method?: string; body?: string }) => {
    calls.push({ url: u, body: o.body ? JSON.parse(o.body) : undefined, method: o.method });
    if (u.includes('/prices/')) {
      if (pricesStatus === 429) return new Response('slow down', { status: 429, headers: { 'retry-after': '7' } });
      if (pricesStatus !== 200) return new Response(JSON.stringify({ error: 'No route found' }), { status: pricesStatus });
      return new Response(JSON.stringify({ priceRoute: route }));
    }
    return new Response(JSON.stringify({ from: '0xme', to: txTo, chainId: 1, value: '0', data: '0xcalldata', gas: '260000' }));
  }) as unknown as typeof fetch;
  return { v: new Velora(1, 'mexc-dex-arb', fetchFn), calls };
}

test('Velora price: /prices with version 6.2, SELL side, partner; amounts, gas, router pinned', async () => {
  const { v, calls } = veloraWith();
  const q = await v.price(req);
  assert.match(calls[0].url, /api\.velora\.xyz\/prices\/\?srcToken=0xSELL&destToken=0xBUY&amount=1000&side=SELL&network=1&version=6\.2&partner=mexc-dex-arb/);
  assert.equal(q.buyAmount, 5000n);
  assert.equal(q.minBuyAmount, 4985n); // 30 bps
  assert.equal(q.gas, 250000n);
  assert.equal(q.spender, VELORA_ROUTER_V6_2);
  assert.equal(q.source, 'velora');
  assert.equal(q.tx, undefined); // indicative only
});

test('Velora quote: POSTs the priceRoute unmodified to /transactions, tx.to pinned', async () => {
  const { v, calls } = veloraWith();
  const q = await v.quote(req);
  assert.match(calls[1].url, /api\.velora\.xyz\/transactions\/1$/);
  assert.equal(calls[1].method, 'POST');
  const body = calls[1].body as { srcToken: string; destToken: string; srcAmount: string; priceRoute: unknown; slippage: number; userAddress: string; partner: string };
  assert.deepEqual(body.priceRoute, veloraRoute); // byte-for-byte: the API rejects a modified route
  assert.equal(body.slippage, 30);
  assert.equal(body.userAddress, '0xme');
  assert.equal(body.srcAmount, '1000');
  assert.equal(body.partner, 'mexc-dex-arb');
  assert.equal(q.tx?.to, VELORA_ROUTER_V6_2);
  assert.equal(q.tx?.data, '0xcalldata');
  assert.equal(q.tx?.value, 0n);
  assert.equal(q.buyAmount, 5000n);
  assert.equal(q.gas, 260000n); // build gas wins over the price gas
});

test('Velora rejects a wrong router, a non-6.2 route, and a wrong tx.to', async () => {
  const { v } = veloraWith({ ...veloraRoute, contractAddress: '0x000000000000000000000000000000000000bad1' });
  await assert.rejects(v.price(req), /not the allowlisted contract/);
  const { v: v5 } = veloraWith({ ...veloraRoute, version: '5' });
  await assert.rejects(v5.price(req), /not 6\.2/);
  const { v: badTx } = veloraWith(veloraRoute, '0x000000000000000000000000000000000000bad2');
  await assert.rejects(badTx.quote(req), /not the allowlisted contract/);
});

test('Velora: 429 -> RateLimitError (with Retry-After); no route propagates as an error', async () => {
  const { v } = veloraWith(veloraRoute, VROUTER, 429);
  await assert.rejects(v.price(req), (e: unknown) => e instanceof RateLimitError && (e as RateLimitError).retryAfterSec === 7);
  const { v: noRoute } = veloraWith(veloraRoute, VROUTER, 400);
  await assert.rejects(noRoute.price(req), /No route found/);
});

// --- Phase 3: OpenOcean (Enterprise API v4) ---

const OEX = '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64'; // as the API returns it (mixed case)
const ooQuote = { code: 200, data: { inAmount: '1000', outAmount: '5000', estimatedGas: '129211', exchange: OEX } };
const ooSwap = {
  code: 200,
  data: {
    inAmount: '1000', outAmount: '4990', minOutAmount: '4940', estimatedGas: 516812,
    from: '0xme', to: OEX, value: '0', data: '0xcalldata', gasPrice: '1000000000', chainId: 1, exchange: OEX,
  },
};

function openOceanWith(quote: object = ooQuote, swap: object = ooSwap, quoteStatus = 200) {
  const calls: { url: string }[] = [];
  const fetchFn = (async (u: string) => {
    calls.push({ url: u });
    if (u.includes('/quote')) {
      if (quoteStatus === 429) return new Response('slow down', { status: 429, headers: { 'retry-after': '5' } });
      return new Response(JSON.stringify(quote));
    }
    return new Response(JSON.stringify(swap));
  }) as unknown as typeof fetch;
  return { o: new OpenOcean(1, fetchFn), calls };
}

test('OpenOcean price: /v4/1/quote with amountDecimals + gasPriceDecimals + slippage percent; exchange pinned', async () => {
  const { o, calls } = openOceanWith();
  const q = await o.price(req);
  assert.match(
    calls[0].url,
    /open-api-enterprise\.openocean\.finance\/v4\/1\/quote\?inTokenAddress=0xSELL&outTokenAddress=0xBUY&amountDecimals=1000&gasPriceDecimals=1000000000&slippage=0\.3/,
  );
  assert.equal(q.buyAmount, 5000n);
  assert.equal(q.minBuyAmount, 4985n); // 30 bps
  assert.equal(q.gas, 129211n);
  assert.equal(q.spender, OPENOCEAN_EXCHANGE_V2);
  assert.equal(q.source, 'openocean');
  assert.equal(q.tx, undefined); // indicative only
});

test('OpenOcean quote: /swap with account=taker; API minOutAmount used, tx.to pinned', async () => {
  const { o, calls } = openOceanWith();
  const q = await o.quote(req);
  assert.match(calls[0].url, /\/v4\/1\/swap\?.*account=0xme/);
  assert.equal(q.buyAmount, 4990n);
  assert.equal(q.minBuyAmount, 4940n); // the API's own floor, not our computed one
  assert.equal(q.gas, 516812n); // numeric estimatedGas also parses
  assert.equal(q.tx?.to, OPENOCEAN_EXCHANGE_V2);
  assert.equal(q.tx?.data, '0xcalldata');
  assert.equal(q.tx?.value, 0n);
});

test('OpenOcean rejects a wrong exchange, a wrong tx.to, and a non-200 code', async () => {
  const bad = '0x000000000000000000000000000000000000bad1';
  const { o } = openOceanWith({ code: 200, data: { outAmount: '5000', estimatedGas: '1', exchange: bad } });
  await assert.rejects(o.price(req), /not the allowlisted contract/);
  const { o: badTx } = openOceanWith(ooQuote, { code: 200, data: { ...ooSwap.data, to: bad } });
  await assert.rejects(badTx.quote(req), /not the allowlisted contract/);
  const { o: noRoute } = openOceanWith({ code: 400, error: 'no route' });
  await assert.rejects(noRoute.price(req), /openocean quote: code 400/);
});

test('OpenOcean: 429 -> RateLimitError; unknown chain is disabled at construction', async () => {
  const { o } = openOceanWith(ooQuote, ooSwap, 429);
  await assert.rejects(o.price(req), (e: unknown) => e instanceof RateLimitError && (e as RateLimitError).retryAfterSec === 5);
  assert.throws(() => new OpenOcean(9999), /no verified exchange contract for chain 9999/);
  assert.throws(() => new OpenOcean(8453), /no verified exchange contract for chain 8453/); // Base: not verified
});

test('BestOf: velora + openocean participate; a failing velora does not break BestOf', async () => {
  const { v } = veloraWith();
  const { o } = openOceanWith();
  const b = new BestOf([v, o]);
  b.gasInOutput = (g) => g / 10n; // velora scores 5000-25000, openocean 5000-12921: gas decides it
  assert.equal((await b.price(req)).source, 'openocean'); // velora's 250k gas costs more than its output edge
  const b2 = new BestOf([v, o]);
  assert.equal((await b2.price(req)).source, 'velora'); // gas not valued: velora and openocean tie at 5000, first wins
  const failingVelora: Aggregator = { name: 'velora', price: async () => { throw new Error('velora: no route'); }, quote: async () => { throw new Error('velora: no route'); } };
  const b3 = new BestOf([failingVelora, o]);
  assert.equal((await b3.price(req)).source, 'openocean');
});
