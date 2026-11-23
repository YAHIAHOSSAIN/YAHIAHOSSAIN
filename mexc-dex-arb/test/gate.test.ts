// Gate.io API v4 adapter: signing, symbol mapping, order/withdraw mapping, error mapping, config.
// All network calls are mocked — no real keys, no real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbiguousRequestError, RateLimitError } from '../src/mexc/rest.js';
import {
  EMPTY_BODY_SHA512,
  GateApiError,
  GateRest,
  fromGatePair,
  gateChainCode,
  gateOrderText,
  gateSign,
  toGatePair,
} from '../src/gate/rest.js';
import { loadConfig, validateConfig } from '../src/config.js';
import type { TransferMexc } from '../src/transfer.js';

type Captured = { method: string; url: string; headers: Record<string, string>; body?: string };

function makeFetch(
  routes: Record<string, { status?: number; body: unknown; headers?: Record<string, string> }>,
  captured: Captured[] = [],
): typeof fetch {
  return (async (input: unknown, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = String(v);
    captured.push({ method, url, headers, body: init?.body });
    const key = `${method} ${new URL(url).pathname}`;
    const route = routes[key];
    if (!route) {
      return new Response(JSON.stringify({ label: 'NOT_FOUND', message: `no mock route for ${key}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(typeof route.body === 'function' ? (route.body as () => unknown)() : route.body), { status: route.status ?? 200, headers: route.headers });
  }) as unknown as typeof fetch;
}

const GATE_ORDER = {
  id: '123456789',
  text: 't-arbethereum1b1234567890abcd',
  currency_pair: 'ETH_USDT',
  status: 'closed',
  type: 'limit',
  side: 'buy',
  amount: '0.01',
  price: '1700',
  left: '0',
  filled_total: '17',
};

const ETH_PAIR = {
  id: 'ETH_USDT',
  base: 'ETH',
  quote: 'USDT',
  fee: '0.2',
  min_base_amount: '0.001',
  min_quote_amount: '3',
  max_base_amount: '1000',
  max_quote_amount: '5000000',
  amount_precision: 4,
  precision: 2,
  trade_status: 'tradable',
  market_order_max_money: '5000000',
};

test('signing: GET vector matches an independent Python HMAC-SHA512 computation', () => {
  assert.equal(EMPTY_BODY_SHA512, 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e');
  assert.equal(
    gateSign('testsecret', 'GET', '/api/v4/spot/tickers', 'currency_pair=ETH_USDT', '', 1700000000),
    '38549149f9e23b0f74d92407ba35221661d0e016e741ba80743b377dcf5ae132594d2fcf2396697ac538a0f86c0420b5497bdbe9c0e5d317f31900d0408ec2ac',
  );
});

test('signing: POST vector matches an independent Python HMAC-SHA512 computation', () => {
  const body =
    '{"currency_pair":"ETH_USDT","side":"buy","type":"limit","amount":"0.01","price":"1700","time_in_force":"gtc","account":"spot","text":"t-arbethereum1b1234567890abcd"}';
  assert.equal(
    gateSign('testsecret', 'POST', '/api/v4/spot/orders', '', body, 1700000001),
    '3ab34df9a9ed790ad85584788af3cea3192e4accc99b3735aa2baf895cff8f74af515c5c2db85635235caf649a03c11b0dbbdf692ad52a3b85aa11db2440ebee',
  );
});

test('signing: signed request sends KEY/Timestamp/SIGN that verify against gateSign', async () => {
  const captured: Captured[] = [];
  const gate = new GateRest('testkey', 'testsecret', 'https://api.gateio.ws/api/v4', makeFetch(
    { 'POST /api/v4/spot/orders': { status: 201, body: GATE_ORDER } },
    captured,
  ));
  await gate.limitOrder('ETHUSDT', 'BUY', '0.01', '1700', 'arbethereum1b1234567890abcd');
  assert.equal(captured.length, 1);
  const c = captured[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.headers.key, 'testkey');
  assert.match(c.headers.timestamp ?? '', /^\d+$/);
  assert.equal(c.headers.sign, gateSign('testsecret', 'POST', '/api/v4/spot/orders', '', c.body ?? '', Number(c.headers.timestamp)));
  assert.equal(
    c.body,
    '{"currency_pair":"ETH_USDT","side":"buy","type":"limit","amount":"0.01","price":"1700","time_in_force":"gtc","account":"spot","text":"t-arbethereum1b1234567890abcd"}',
  );
});

test('symbol mapping both ways; non-USDT pairs rejected', () => {
  assert.equal(toGatePair('BTCUSDT'), 'BTC_USDT');
  assert.equal(toGatePair('USDCUSDT'), 'USDC_USDT');
  assert.equal(fromGatePair('ETH_USDT'), 'ETHUSDT');
  assert.equal(fromGatePair('BTC_USDT'), 'BTCUSDT');
  assert.throws(() => toGatePair('ETHBTC'), /only trades USDT pairs/);
});

test('order text: t- prefix, 32-char engine cid truncated to 28 bytes', () => {
  const cid32 = 'arbethereum1b' + 'a'.repeat(19); // 32 chars, like engine clientId()
  assert.equal(cid32.length, 32);
  assert.equal(gateOrderText(cid32), `t-${cid32.slice(0, 28)}`);
  assert.equal(gateOrderText(cid32).length, 30);
  assert.equal(gateOrderText('arbethereum1b1234567890abcd'), 't-arbethereum1b1234567890abcd');
});

test('chain codes: Gate uses ARBEVM for Arbitrum One', () => {
  assert.equal(gateChainCode('ARB'), 'ARBEVM');
  assert.equal(gateChainCode('ERC20'), 'ETH');
  assert.equal(gateChainCode('BEP20'), 'BSC');
  assert.equal(gateChainCode('ETH'), 'ETH');
  assert.equal(gateChainCode('ARBEVM'), 'ARBEVM');
  assert.equal(gateChainCode('BSC'), 'BSC');
  assert.equal(gateChainCode('Arbitrum One'), 'ARBEVM');
});

test('exchangeInfo: fee percent -> fraction, precisions, tradable -> ENABLED', async () => {
  const gate = new GateRest('', '', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/spot/currency_pairs': { body: [ETH_PAIR, { ...ETH_PAIR, id: 'BTC_ETH', base: 'BTC', quote: 'ETH', trade_status: 'untradable' }] },
  }));
  const infos = await gate.exchangeInfo();
  assert.equal(infos.length, 2);
  const eth = infos[0];
  assert.equal(eth.symbol, 'ETHUSDT');
  assert.equal(eth.baseAsset, 'ETH');
  assert.equal(eth.quoteAsset, 'USDT');
  assert.equal(eth.status, 'ENABLED');
  assert.equal(eth.isSpotTradingAllowed, true);
  assert.equal(eth.takerCommission, '0.002'); // Gate fee "0.2" is a PERCENT (0.20%)
  assert.equal(eth.makerCommission, '0.002');
  assert.equal(eth.baseSizePrecision, '0.001');
  assert.equal(eth.baseAssetPrecision, 4);
  assert.equal(eth.quotePrecision, 2);
  assert.deepEqual(eth.orderTypes, ['LIMIT', 'MARKET']);
  assert.equal(eth.quoteAmountPrecision, '3');
  assert.equal(eth.maxQuoteAmount, '5000000');
  assert.equal(infos[1].status, 'BREAK');
  assert.equal(infos[1].isSpotTradingAllowed, false);
});

test('tickers24h + bookTickers: only USDT pairs, quote volume + best bid/ask', async () => {
  const tickers = [
    { currency_pair: 'ETH_USDT', last: '1735.59', lowest_ask: '1735.25', lowest_size: '46.1', highest_bid: '1735.24', highest_size: '44.4', quote_volume: '285545423.79' },
    { currency_pair: 'BTC_ETH', last: '20.1', lowest_ask: '20.2', lowest_size: '1', highest_bid: '20.0', highest_size: '2', quote_volume: '999' },
  ];
  const gate = new GateRest('', '', 'https://api.gateio.ws/api/v4', makeFetch({ 'GET /api/v4/spot/tickers': { body: tickers } }));
  const t24 = await gate.tickers24h();
  assert.deepEqual(t24, [{ symbol: 'ETHUSDT', quoteVolume: '285545423.79', lastPrice: '1735.59' }]);
  const books = await gate.bookTickers();
  assert.deepEqual([...books.entries()], [['ETHUSDT', { bid: 1735.24, ask: 1735.25 }]]);
});

test('coinConfigs: per-chain contract addresses + disabled flags; delisted skipped', async () => {
  const currencies = [
    {
      currency: 'USDT',
      delisted: false,
      withdraw_disabled: false,
      deposit_disabled: false,
      chains: [
        { name: 'ETH', addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', withdraw_disabled: false, withdraw_delayed: false, deposit_disabled: false },
        { name: 'ARBEVM', addr: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', withdraw_disabled: false, withdraw_delayed: false, deposit_disabled: false },
        { name: 'BSC', addr: '0x55d398326f99059fF775485246999027B3197955', withdraw_disabled: true, withdraw_delayed: false, deposit_disabled: false },
      ],
    },
    { currency: 'DEAD', delisted: true, withdraw_disabled: false, deposit_disabled: false, chains: [] },
  ];
  const gate = new GateRest('', '', 'https://api.gateio.ws/api/v4', makeFetch({ 'GET /api/v4/spot/currencies': { body: currencies } }));
  const configs = await gate.coinConfigs();
  assert.equal(configs.length, 1);
  assert.equal(configs[0].coin, 'USDT');
  assert.deepEqual(
    configs[0].networkList.map((n) => [n.network, n.netWork, n.contract, n.depositEnable, n.withdrawEnable]),
    [
      ['ETH', 'ETH', '0xdAC17F958D2ee523a2206206994597C13D831ec7', true, true],
      ['ARBEVM', 'ARBEVM', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', true, true],
      ['BSC', 'BSC', '0x55d398326f99059fF775485246999027B3197955', true, false],
    ],
  );
});

test('depth: Gate order book -> number levels', async () => {
  const gate = new GateRest('', '', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/spot/order_book': { body: { asks: [['1735.02', '0.76'], ['1735.03', '0.30']], bids: [['1735.01', '3.00'], ['1734.86', '3.40']] } },
  }));
  const d = await gate.depth('ETHUSDT', 2);
  assert.deepEqual(d.asks, [[1735.02, 0.76], [1735.03, 0.3]]);
  assert.deepEqual(d.bids, [[1735.01, 3], [1734.86, 3.4]]);
});

test('limitOrder: body mapping + filled order mapping', async () => {
  const captured: Captured[] = [];
  const gate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch(
    { 'POST /api/v4/spot/orders': { status: 201, body: GATE_ORDER } },
    captured,
  ));
  const o = await gate.limitOrder('ETHUSDT', 'BUY', '0.01', '1700', 'arbethereum1b1234567890abcd');
  assert.deepEqual(o, { orderId: '123456789', status: 'FILLED', executedQty: '0.01', cummulativeQuoteQty: '17', origQty: '0.01', price: '1700', side: 'BUY' });
  assert.equal(captured[0].url, 'https://api.gateio.ws/api/v4/spot/orders');
});

test('marketSell: market body has no price, amount is base; open partial maps to PARTIALLY_FILLED', async () => {
  const captured: Captured[] = [];
  const gate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch(
    { 'POST /api/v4/spot/orders': { status: 201, body: { ...GATE_ORDER, status: 'open', left: '0.004', filled_total: '10.2', type: 'market', side: 'sell' } } },
    captured,
  ));
  const o = await gate.marketSell('ETHUSDT', '0.01', 'arbethereum1s' + 'b'.repeat(20));
  assert.equal(o.status, 'PARTIALLY_FILLED');
  assert.equal(o.executedQty, '0.006');
  assert.equal(o.side, 'SELL');
  const body = JSON.parse(captured[0].body ?? '{}') as Record<string, unknown>;
  assert.equal(body.type, 'market');
  assert.equal(body.time_in_force, 'ioc');
  assert.equal(body.amount, '0.01');
  assert.equal('price' in body, false);
});

test('getOrderByClientId: open list, then finished list, then null; truncated text used', async () => {
  const cid = 'arbethereum1b' + 'c'.repeat(19); // 32 chars
  const text = gateOrderText(cid);
  const openHit = { ...GATE_ORDER, text, status: 'open', left: '0.01', filled_total: '0' };
  const mk = (orders: Record<string, unknown>[], finished: Record<string, unknown>[]) => {
    let n = 0;
    return new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
      'GET /api/v4/spot/orders': {
        body: () => {
          n += 1;
          return n === 1 ? orders : finished;
        },
      },
    }));
  };
  // Found in the open list.
  const g1 = mk([openHit], []);
  const o1 = await g1.getOrderByClientId('ETHUSDT', cid);
  assert.equal(o1?.status, 'NEW');
  assert.equal(o1?.orderId, '123456789');
  // Open list misses, finished list hits (cancelled, partially filled).
  const g2 = mk([], [{ ...GATE_ORDER, text, status: 'cancelled', left: '0.004', filled_total: '10.2' }]);
  const o2 = await g2.getOrderByClientId('ETHUSDT', cid);
  assert.equal(o2?.status, 'PARTIALLY_CANCELED');
  assert.equal(o2?.executedQty, '0.006');
  // Neither list has it.
  const g3 = mk([], []);
  assert.equal(await g3.getOrderByClientId('ETHUSDT', cid), null);
});

test('cancelOrder: DELETE with currency_pair, cancelled maps to CANCELED', async () => {
  const captured: Captured[] = [];
  const gate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch(
    { 'DELETE /api/v4/spot/orders/123456789': { body: { ...GATE_ORDER, status: 'cancelled', left: '0.01', filled_total: '0' } } },
    captured,
  ));
  const o = await gate.cancelOrder('ETHUSDT', '123456789');
  assert.equal(o.status, 'CANCELED');
  assert.equal(captured[0].method, 'DELETE');
  assert.equal(new URL(captured[0].url).searchParams.get('currency_pair'), 'ETH_USDT');
});

test('withdraw: chain alias ARB -> ARBEVM, withdraw_order_id passed through, id returned', async () => {
  const captured: Captured[] = [];
  const gate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch(
    { 'POST /api/v4/withdrawals': { body: { id: 'w1879219868', status: 'REQUEST' } } },
    captured,
  ));
  const id = await gate.withdraw({ coin: 'XYZ', netWork: 'ARB', address: '0x49cDBE83A07E47c9c3238c81bD97a2937706dAb0', amount: '100', withdrawOrderId: 'arbitrum1w' });
  assert.equal(id, 'w1879219868');
  const body = JSON.parse(captured[0].body ?? '{}') as Record<string, unknown>;
  assert.equal(body.chain, 'ARBEVM');
  assert.equal(body.currency, 'XYZ');
  assert.equal(body.withdraw_order_id, 'arbitrum1w');
});

test('findWithdraw: by id, by withdraw_order_id, status mapping, null when empty', async () => {
  const rec = (status: string) => ({ id: 'w1', txid: '0xabc', withdraw_order_id: 'ethereum1w', amount: '100', fee: '1', currency: 'XYZ', status });
  const byId = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/wallet/withdrawals': { body: [rec('DONE')] },
  }));
  const done = await byId.findWithdraw('XYZ', Date.now(), { id: 'w1' });
  assert.deepEqual(done, { id: 'w1', status: 7, amount: '100', transactionFee: '1', txId: '0xabc', withdrawOrderId: 'ethereum1w' });

  for (const [gateStatus, expected] of [['FAIL', 8], ['CANCEL', 9], ['MANUAL', 10], ['REJECT', 8], ['REQUEST', 1], ['EXTPEND', 1]] as const) {
    const g = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
      'GET /api/v4/wallet/withdrawals': { body: [rec(gateStatus)] },
    }));
    const r = await g.findWithdraw('XYZ', Date.now(), { withdrawOrderId: 'ethereum1w' });
    assert.equal(r?.status, expected, gateStatus);
  }
  const empty = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/wallet/withdrawals': { body: [] },
  }));
  assert.equal(await empty.findWithdraw('XYZ', Date.now(), { id: 'w1' }), null);
});

test('depositAddress: multichain entry picked by Gate chain code', async () => {
  const gate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/wallet/deposit_address': {
      body: {
        currency: 'USDC',
        address: '0xeth-default',
        multichain_addresses: [
          { chain: 'ETH', address: '0xeth-addr' },
          { chain: 'ARBEVM', address: '0xarb-addr' },
        ],
      },
    },
  }));
  assert.equal(await gate.depositAddress('USDC', 'ARBEVM'), '0xarb-addr');
  assert.equal(await gate.depositAddress('USDC', 'ETH'), '0xeth-addr');
  assert.equal(await gate.depositAddress('USDC', 'BSC'), null);
});

test('depositHistory + findDeposit: from is Unix seconds; txid matched case-insensitively', async () => {
  const captured: Captured[] = [];
  const gate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch(
    {
      'GET /api/v4/wallet/deposits': {
        body: [
          { txid: '0xAbC123', status: 'DONE', amount: '263.5' },
          { txid: '0xdef456', status: 'DONE', amount: '10' },
        ],
      },
    },
    captured,
  ));
  const sinceMs = 1795412614000;
  const found = await gate.findDeposit('USDC', sinceMs, '0xabc123');
  assert.deepEqual(found, { txId: '0xAbC123', status: 1, amount: '263.5' });
  assert.equal(await gate.findDeposit('USDC', sinceMs, '0xmissing'), null);
  assert.equal(new URL(captured[0].url).searchParams.get('from'), String(Math.floor(sinceMs / 1000)));
});

test('balances + account: spot accounts mapped; canTrade is true (Gate has no flag)', async () => {
  const gate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/spot/accounts': { body: [{ currency: 'USDT', available: '550.02', locked: '0' }, { currency: 'XYZ', available: '0', locked: '5' }] },
  }));
  assert.deepEqual(await gate.balances(), { USDT: 550.02, XYZ: 0 });
  const acc = await gate.account();
  assert.equal(acc.canTrade, true);
  assert.deepEqual(acc.balances, [
    { asset: 'USDT', free: '550.02', locked: '0' },
    { asset: 'XYZ', free: '0', locked: '5' },
  ]);
});

test('syncTime: Date header of a public call sets the offset', async () => {
  const serverDate = new Date(Date.now() + 5000).toUTCString();
  const gate = new GateRest('', '', 'https://api.gateio.ws/api/v4', makeFetch(
    { 'GET /api/v4/spot/tickers': { body: [], headers: { date: serverDate } } },
  ));
  const offset = await gate.syncTime();
  assert.ok(Math.abs(offset - 5000) < 1000, `offset ${offset} should be ~5000`);
});

test('error mapping: 429 -> RateLimitError, Gate label -> GateApiError, 5xx POST -> ambiguous', async () => {
  const rate = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/spot/tickers': { status: 429, body: { label: 'RATE_LIMIT', message: 'too fast' }, headers: { 'retry-after': '7' } },
  }));
  await assert.rejects(() => rate.tickers24h(), (e: unknown) => e instanceof RateLimitError && (e as RateLimitError).retryAfterSec === 7);

  const bad = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'POST /api/v4/spot/orders': { status: 400, body: { label: 'INVALID_CURRENCY_PAIR', message: 'currency_pair is invalid' } },
  }));
  await assert.rejects(() => bad.limitOrder('ETHUSDT', 'BUY', '1', '1'), (e: unknown) => {
    return e instanceof GateApiError && (e as GateApiError).status === 400 && (e as GateApiError).label === 'INVALID_CURRENCY_PAIR';
  });

  const down = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'POST /api/v4/spot/orders': { status: 502, body: 'bad gateway' },
  }));
  await assert.rejects(() => down.limitOrder('ETHUSDT', 'BUY', '1', '1'), (e: unknown) => e instanceof AmbiguousRequestError);

  const downGet = new GateRest('k', 's', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/spot/tickers': { status: 502, body: 'bad gateway' },
  }));
  await assert.rejects(() => downGet.tickers24h(), (e: unknown) => e instanceof GateApiError && (e as GateApiError).status === 502);
});

test('signed calls without keys fail loudly instead of signing with an empty secret', async () => {
  const gate = new GateRest('', '', 'https://api.gateio.ws/api/v4', makeFetch({
    'GET /api/v4/spot/accounts': { body: [] },
  }));
  await assert.rejects(() => gate.balances(), /GATE_API_KEY\/SECRET are not configured/);
});

test('GateRest satisfies the TransferMexc interface', () => {
  const gate: TransferMexc = new GateRest('k', 's');
  assert.equal(typeof gate.exchangeInfo, 'function');
  assert.equal(typeof gate.getOrderByClientId, 'function');
  assert.equal(typeof gate.findWithdraw, 'function');
});

// --- Config selection ---

const ENV_KEYS = ['MODE', 'STRATEGY', 'CHAIN', 'ALLOW_WITHDRAWALS', 'CEX', 'GATE_API_KEY', 'GATE_API_SECRET', 'GATE_TAKER_FEE', 'RPC_URL', 'MEXC_API_KEY', 'MEXC_API_SECRET'];

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const k of ENV_KEYS) saved.set(k, process.env[k]);
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const PAPER_TRANSFER = { MODE: 'paper', STRATEGY: 'transfer', CHAIN: 'ethereum', ALLOW_WITHDRAWALS: 'yes', RPC_URL: 'https://example.invalid' };

test('config: CEX defaults to mexc; gate selected when set; gate taker fee default 0.002', () => {
  withEnv({ ...PAPER_TRANSFER }, () => {
    const c = validateConfig(loadConfig());
    assert.equal(c.cex, 'mexc');
    assert.equal(c.gateTakerFee, 0.002);
  });
  withEnv({ ...PAPER_TRANSFER, CEX: 'gate', GATE_TAKER_FEE: '0.001' }, () => {
    const c = validateConfig(loadConfig());
    assert.equal(c.cex, 'gate');
    assert.equal(c.gateTakerFee, 0.001);
  });
});

test('config: CEX=gate + inventory is rejected (inventory uses the MEXC WebSocket book)', () => {
  withEnv({ MODE: 'paper', STRATEGY: 'inventory', CHAIN: 'ethereum', CEX: 'gate', RPC_URL: 'https://example.invalid' }, () => {
    assert.throws(() => validateConfig(loadConfig()), /CEX=gate only supports STRATEGY=transfer/);
  });
});

test('config: unknown CEX is rejected', () => {
  withEnv({ ...PAPER_TRANSFER, CEX: 'binance' }, () => {
    assert.throws(() => loadConfig(), /CEX must be mexc or gate/);
  });
});
