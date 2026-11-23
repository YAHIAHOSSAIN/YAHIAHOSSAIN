// Phase 8: USDC recycle loop + one-time catch-up sweep, with fakes (no live funds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { Db, type TransferRow } from '../src/db.js';
import { MexcRest, MexcApiError } from '../src/mexc/rest.js';
import {
  RecycleEngine, RECYCLE_CREDIT_TIMEOUT_MS, CATCHUP_DONE_KEY, CATCHUP_STATE_KEY,
  type RecycleChain, type RecycleMexc,
} from '../src/recycle.js';
import type { GasInfo } from '../src/dex/chain.js';

const GWEI = 1_000_000_000n;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const XYZ = '0x1111111111111111111111111111111111111111';
const DEPOSIT_ADDR = '0x' + 'ab'.repeat(20);
const OTHER_ADDR = '0x' + 'ef'.repeat(20); // a later GET-list top (list order moves when a new address is generated)
const GAS: GasInfo = { baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI };

function makeCfg(chain = 'ethereum', mode: 'live' | 'paper' = 'live') {
  process.env.CHAIN = chain;
  process.env.MODE = mode;
  process.env.STRATEGY = 'transfer';
  process.env.ALLOW_WITHDRAWALS = 'yes';
  process.env.RPC_URL = 'http://localhost';
  process.env.MAX_TRADE_USD = '200';
  process.env.MIN_TRADE_USD = '200';
  process.env.PRIVATE_KEY = '0x' + '22'.repeat(32);
  process.env.MEXC_API_KEY = 'k'.repeat(10);
  process.env.MEXC_API_SECRET = 's'.repeat(10);
  return loadConfig();
}

interface SetupOpts {
  chain?: string;
  mode?: 'live' | 'paper';
  walletUsdc?: number; // live wallet USDC at setup
  ethBalance?: bigint;
  credit?: boolean; // MEXC credits the deposit (default true)
  history404?: boolean; // deposit-history endpoint missing -> balance-only fallback
  addressThrows?: boolean;
  addressSeq?: string[]; // successive GET-first addresses (list top moves between calls)
  marketOk?: boolean; // USDCUSDT takes MARKET sells (default true)
  receiptStatus?: number | null; // chain.receipt status for the deposit tx (default 1)
  receiptMissing?: boolean; // chain has no receipt() at all
  sendUnknown?: boolean;
  sendFails?: boolean;
  sendRefused?: boolean;
  simulateThrows?: boolean;
  depositEnable?: boolean; // MEXC USDC deposits enabled (default true)
  now?: () => number;
  db?: Db;
}

function setup(o: SetupOpts = {}) {
  const cfg = makeCfg(o.chain ?? 'ethereum', o.mode ?? 'live');
  const db = o.db ?? new Db(':memory:');
  const alerts: string[] = [];
  const calls: string[] = [];
  const netWork = o.chain === 'bsc' ? 'BSC' : o.chain === 'arbitrum' ? 'ARB' : 'ETH';
  // Real MEXC long `network` values from coinConfigs() (verified live 2026-11-23):
  // the deposit-address endpoint takes these, NOT the short netWork.
  const longNetwork = o.chain === 'bsc' ? 'BNB Smart Chain(BEP20)' : o.chain === 'arbitrum' ? 'Arbitrum One(ARB)' : 'Ethereum(ERC20)';
  const state = {
    walletUsdc: BigInt(Math.round((o.walletUsdc ?? 0) * 1e6)), // 6 decimals
    eth: o.ethBalance ?? 1_000_000_000_000_000_000n, // 1 native
    mexcUsdc: 0,
    mexcUsdt: 1000,
    deposits: [] as { txId: string; amount: string }[],
    credit: o.credit ?? true,
    sendCount: 0,
    sellCount: 0,
    depositHash: '',
    receipts: new Map<string, number | null>(), // tx hash -> receipt status (null = no receipt yet)
  };
  const ordersByCid = new Map<string, { orderId: string; status: string; executedQty: string; cummulativeQuoteQty: string; origQty: string; price: string; side: 'BUY' | 'SELL' }>();
  const orders = new Map<string, { orderId: string; status: string; executedQty: string; cummulativeQuoteQty: string; origQty: string; price: string; side: 'BUY' | 'SELL' }>();

  const mexc: RecycleMexc = {
    coinConfigs: async () => [
      {
        coin: 'USDC',
        networkList: [{ coin: 'USDC', network: longNetwork, netWork, contract: USDC, depositEnable: o.depositEnable ?? true, withdrawEnable: true, withdrawFee: '0', withdrawMin: '1' }],
      },
    ],
    depositAddress: async (_coin, network) => {
      calls.push(`depositAddress ${_coin}/${network}`);
      if (o.addressThrows) throw new Error('MEXC down');
      return o.addressSeq?.shift() ?? DEPOSIT_ADDR;
    },
    depositHistory: async () => state.deposits.map((d) => ({ txId: d.txId, status: 1, amount: d.amount })),
    findDeposit: async (_coin, _since, txId) => {
      if (o.history404) throw new MexcApiError('MEXC GET /api/v3/capital/deposit/history -> 404: Not Found', 404);
      const norm = (h: string) => h.toLowerCase().replace(/^0x/, '');
      return state.deposits.find((d) => norm(d.txId) === norm(txId)) ? { txId, status: 1, amount: '0' } : null;
    },
    balances: async () => ({ USDC: state.mexcUsdc, USDT: state.mexcUsdt }),
    exchangeInfo: async () => [
      { symbol: 'USDCUSDT', baseAsset: 'USDC', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: o.marketOk === false ? ['LIMIT'] : ['LIMIT', 'MARKET'] },
    ],
    marketSell: async (symbol, qty, cid) => {
      calls.push(`marketSell ${symbol} ${qty} ${cid ?? ''}`);
      state.sellCount++;
      const n = Number(qty);
      state.mexcUsdc -= n;
      state.mexcUsdt += n * 0.999;
      const order = { orderId: 'rs1', status: 'FILLED', executedQty: qty, cummulativeQuoteQty: String(n * 0.999), origQty: qty, price: '1', side: 'SELL' as const };
      orders.set('rs1', order);
      if (cid) ordersByCid.set(cid, order);
      return { orderId: 'rs1' };
    },
    getOrderByClientId: async (_s, cid) => ordersByCid.get(cid) ?? null,
    getOrder: async (_s, id) => orders.get(id)!,
    cancelOrder: async (_s, id) => orders.get(id)!,
  };

  const chain: RecycleChain = {
    address: '0xWallet',
    gas: async () => GAS,
    tokenBalance: async () => state.walletUsdc,
    ethBalance: async () => state.eth,
    simulate: async () => {
      if (o.simulateThrows) throw new Error('revert');
      return 60_000n;
    },
    send: async (tx, _limit, _gas, _timeout, onSigned) => {
      state.sendCount++;
      const hash = `0x${'d'.repeat(62)}${state.sendCount}`; // unique per send
      calls.push(`send ${tx.to === cfg.usdc ? 'USDC-deposit' : 'other'}`);
      if (tx.to === cfg.usdc) { // the chain's own USDC (ETH 0xa0b8… on Ethereum, 0xaf88… on Arbitrum)
        const amountUnits = BigInt(`0x${tx.data.slice(-64)}`);
        const amount = Number(amountUnits) / 1e6;
        if (o.sendRefused) return { ok: false, refused: true, hash: '', gasCostWei: 0n, reason: 'unresolved earlier tx' };
        onSigned?.(hash, 1); // fires on signing, BEFORE the broadcast outcome is known (like the real TxSender)
        if (o.sendUnknown) {
          state.receipts.set(hash, o.receiptStatus ?? 1);
          return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: 'unknown' };
        }
        if (o.sendFails) {
          state.receipts.set(hash, 0); // mined and reverted: the receipt says so
          return { ok: false, hash, gasCostWei: 0n, reason: 'reverted' };
        }
        state.walletUsdc -= amountUnits;
        state.depositHash = hash;
        state.receipts.set(hash, 1);
        if (state.credit) {
          state.mexcUsdc += amount;
          state.deposits.push({ txId: hash, amount: String(amount) });
        }
        return { ok: true, hash, gasCostWei: 60_000n * 10n * GWEI };
      }
      return { ok: true, hash, gasCostWei: 0n };
    },
    ...(o.receiptMissing
      ? {}
      : {
          receipt: async (h: string) => {
            const st = state.receipts.get(h);
            return st === undefined ? null : { status: st };
          },
        }),
  };

  const engine = new RecycleEngine({
    cfg, mexc, chain, db,
    tg: { send: async (t) => void alerts.push(t) },
    sleep: async () => {},
    now: o.now,
    stableDecimals: 6,
  });
  return { engine, db, cfg, alerts, calls, state, ordersByCid };
}

function doneTransfer(db: Db, usdcOut: number, base = 'ACN'): number {
  const row: TransferRow = {
    ts: 1, updated: 1, base, symbol: `${base}USDT`, address: XYZ, decimals: 18, net_work: 'ETH',
    qty_step: 0.01, price_decimals: 4, status: 'done', buy_qty: 200, cost_usd: 248, buy_order_id: 'b1',
    withdraw_amount: '199.9', withdraw_id: 'w1', wallet_before: '0', received: '198900000000000000000',
    usdc_out: usdcOut, gas_usd: 4, expected_net: 15, pnl: 15, sell_attempts: 1, alerted_timeout: 0,
    note: null, withdraw_fee: 1, next_try: 0, force_sell: 0, hold_alerted: 0, sell_tx: '0xhash',
    recycle_status: null, recycle_held: 0, recycled_usdc: null, recycled_usdt: null, recycle_address: null,
    recycle_tx: null, recycle_order_id: null, recycle_note: null, recycle_deadline: 0,
    recycle_mexc_before: null, recycle_usdt_before: null,
  };
  return db.insertTransfer(row);
}

// ---------------------------------------------------------- depositAddress (real client, stub fetch)

test('depositAddress: GET returns the address, POST never called', async () => {
  const seen: { method: string; url: string }[] = [];
  const fetchFn = (async (u: string, o: { method: string }) => {
    seen.push({ method: o.method, url: u });
    return new Response(JSON.stringify({ address: DEPOSIT_ADDR, coin: 'USDC', network: 'ETH' }), { status: 200 });
  }) as unknown as typeof fetch;
  const m = new MexcRest('k', 's', 'https://api.mexc.com', fetchFn);
  assert.equal(await m.depositAddress('USDC', 'ETH'), DEPOSIT_ADDR);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.match(seen[0].url, /coin=USDC&network=ETH/);
});

test('depositAddress: empty GET (object and array) -> POST generates one', async () => {
  for (const emptyBody of ['{}', '[]']) {
    const seen: string[] = [];
    const fetchFn = (async (u: string, o: { method: string }) => {
      seen.push(`${o.method} ${u}`);
      if (o.method === 'GET') return new Response(emptyBody, { status: 200 });
      return new Response(JSON.stringify({ address: DEPOSIT_ADDR }), { status: 200 });
    }) as unknown as typeof fetch;
    const m = new MexcRest('k', 's', 'https://api.mexc.com', fetchFn);
    assert.equal(await m.depositAddress('USDC', 'ARB'), DEPOSIT_ADDR);
    assert.equal(seen.filter((s) => s.startsWith('GET')).length, 1);
    assert.equal(seen.filter((s) => s.startsWith('POST')).length, 1);
    assert.ok(seen.some((s) => s.includes('network=ARB')), `network param sent: ${seen.join(' | ')}`);
  }
});

test('depositAddress: signature is the HMAC over the exact query sent', async () => {
  let url = '';
  const fetchFn = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ address: DEPOSIT_ADDR }), { status: 200 });
  }) as unknown as typeof fetch;
  const m = new MexcRest('KEY', 'SECRET', 'https://api.mexc.com', fetchFn);
  await m.depositAddress('USDC', 'ETH');
  const u = new URL(url);
  const sig = u.searchParams.get('signature');
  u.searchParams.delete('signature');
  assert.equal(sig, crypto.createHmac('sha256', 'SECRET').update(u.searchParams.toString()).digest('hex'));
});

test('depositAddress: GET with the LONG network value returns the first address, POST never called', async () => {
  const seen: { method: string; url: string }[] = [];
  const fetchFn = (async (u: string, o: { method: string }) => {
    seen.push({ method: o.method, url: u });
    return new Response(JSON.stringify([{ address: DEPOSIT_ADDR, coin: 'USDC', network: 'Ethereum(ERC20)' }]), { status: 200 });
  }) as unknown as typeof fetch;
  const m = new MexcRest('k', 's', 'https://api.mexc.com', fetchFn);
  assert.equal(await m.depositAddress('USDC', 'Ethereum(ERC20)'), DEPOSIT_ADDR);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.match(seen[0].url, /coin=USDC&network=Ethereum%28ERC20%29/);
});

test('request(): spaced values are signed and sent as %20, never + (live 700002 fix)', async () => {
  let url = '';
  const fetchFn = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify([{ address: DEPOSIT_ADDR }]), { status: 200 });
  }) as unknown as typeof fetch;
  const m = new MexcRest('KEY', 'SECRET', 'https://api.mexc.com', fetchFn);
  await m.depositAddress('USDC', 'Arbitrum One(ARB)');
  // The sent URL carries %20, and no bare `+` anywhere in the query.
  assert.ok(url.includes('network=Arbitrum%20One%28ARB%29'), url);
  assert.ok(!url.split('?')[1].includes('+'), url);
  // The signature is the HMAC over the exact %20 query that was sent
  // (rebuilt from the raw query string, not searchParams, which re-encodes %20 as +).
  const raw = url.split('?')[1];
  const sig = new URL(url).searchParams.get('signature');
  const unsigned = raw.split('&').filter((p) => !p.startsWith('signature=')).join('&');
  assert.ok(!unsigned.includes('+'), unsigned);
  assert.equal(sig, crypto.createHmac('sha256', 'SECRET').update(unsigned).digest('hex'));
});

test('request(): a literal + in a value stays %2B (only spaces become %20)', async () => {
  let url = '';
  const fetchFn = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
  const m = new MexcRest('KEY', 'SECRET', 'https://api.mexc.com', fetchFn);
  await m.request('GET', '/api/v3/x', { q: 'a+b c' }, true);
  assert.ok(url.includes('q=a%2Bb%20c'), url);
  assert.ok(!url.split('?')[1].includes('+'), url);
});

test('resolveAddress passes the LONG network value (Arbitrum One(ARB), not ARB)', async () => {
  const { engine, db, calls } = setup({ chain: 'arbitrum', walletUsdc: 100 });
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(db.getTransfer(id)!.recycle_status, 'done');
  assert.ok(calls.some((c) => c === 'depositAddress USDC/Arbitrum One(ARB)'), calls.join(' | '));
  assert.ok(!calls.some((c) => c === 'depositAddress USDC/ARB'), calls.join(' | '));
});

// ---------------------------------------------------------- the loop

test('happy path: done transfer recycles end to end, exactly once', async () => {
  const { engine, db, alerts, calls, state } = setup({ walletUsdc: 228.7 });
  const id = doneTransfer(db, 228.7);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  const row = db.getTransfer(id)!;
  assert.equal(row.recycle_status, 'done');
  assert.equal(row.recycled_usdc, 228.7);
  assert.ok(Math.abs((row.recycled_usdt ?? 0) - 228.7 * 0.999) < 0.01, `usdt ${row.recycled_usdt}`);
  assert.equal(row.recycle_address, DEPOSIT_ADDR);
  assert.ok(row.recycle_tx?.startsWith('0x'));
  assert.equal(row.recycle_order_id, 'ethereum1r');
  assert.equal(state.sendCount, 1); // one deposit send, never two
  assert.equal(state.sellCount, 1); // one USDCUSDT sell, never two
  assert.equal(state.walletUsdc, 0n); // proceeds left the wallet
  assert.ok(Math.abs(state.mexcUsdt - (1000 + 228.7 * 0.999)) < 0.01);
  assert.ok(calls.some((c) => c === 'depositAddress USDC/Ethereum(ERC20)'));
  assert.ok(alerts.some((a) => a.includes('first recycle on ethereum (Ethereum(ERC20))') && a.includes(DEPOSIT_ADDR)));
  assert.ok(alerts.some((a) => a.includes('sent $228.70') && a.includes('USDC to MEXC')));
  assert.ok(alerts.some((a) => a.includes('credited on MEXC')));
  assert.ok(alerts.some((a) => a.includes('recycled') && a.includes('USDT on MEXC')));
  // Second advance is a no-op (idempotent).
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(state.sendCount, 1);
  assert.equal(state.sellCount, 1);
});

test('first-use deposit address is Telegrammed once per chain, reused after', async () => {
  const { engine, db, alerts } = setup({ walletUsdc: 500 });
  const a = doneTransfer(db, 200, 'ACN');
  const b = doneTransfer(db, 200, 'XYZ');
  await engine.advanceTransfer(db.getTransfer(a)!, GAS, 2000);
  await engine.advanceTransfer(db.getTransfer(b)!, GAS, 2000);
  assert.equal(alerts.filter((x) => x.includes('first recycle on ethereum')).length, 1);
  assert.equal(db.getTransfer(a)!.recycle_address, db.getTransfer(b)!.recycle_address);
});

test('verified address is cached per chain: GET top moves, second job reuses the first address', async () => {
  // Live 2026-11-23: the GET list is newest-first, so its top moves whenever
  // a new address is generated. The first resolved address is cached per
  // chain, so the bot pins it and never drifts.
  const { engine, db, calls } = setup({ walletUsdc: 500, addressSeq: [DEPOSIT_ADDR, OTHER_ADDR] });
  const a = doneTransfer(db, 200, 'ACN');
  const b = doneTransfer(db, 200, 'XYZ');
  await engine.advanceTransfer(db.getTransfer(a)!, GAS, 2000);
  await engine.advanceTransfer(db.getTransfer(b)!, GAS, 2000);
  assert.equal(db.getTransfer(a)!.recycle_status, 'done');
  assert.equal(db.getTransfer(b)!.recycle_status, 'done');
  assert.equal(db.getTransfer(a)!.recycle_address, DEPOSIT_ADDR);
  assert.equal(db.getTransfer(b)!.recycle_address, DEPOSIT_ADDR); // NOT the moved top
  assert.equal(calls.filter((c) => c.startsWith('depositAddress ')).length, 1); // resolved once, then cached
  assert.equal(db.getState('recycle:deposit-addr:ethereum:Ethereum(ERC20)'), DEPOSIT_ADDR);
});

test('address fetch fails -> HOLD, nothing sent; /recycle resumes', async () => {
  const first = setup({ walletUsdc: 100, addressThrows: true });
  const id = doneTransfer(first.db, 100);
  await first.engine.advanceTransfer(first.db.getTransfer(id)!, GAS, 2000);
  const held = first.db.getTransfer(id)!;
  assert.equal(held.recycle_held, 1);
  assert.equal(first.state.sendCount, 0);
  assert.ok(first.alerts.some((a) => a.includes('HELD') && a.includes('deposit address fetch failed')));
  assert.match(first.engine.retryTransfer(id), /resumes on the next scan/);
  // "Restart": new engine, same DB, MEXC back up.
  const second = setup({ db: first.db, walletUsdc: 100 });
  Object.assign(second.state, { ...first.state, walletUsdc: BigInt(100e6), mexcUsdc: 0, mexcUsdt: 1000 });
  await second.engine.advanceTransfer(second.db.getTransfer(id)!, GAS, 2000);
  assert.equal(second.db.getTransfer(id)!.recycle_status, 'done');
  assert.equal(second.state.sendCount, 1);
});

test('deposit never credits -> HOLD at the 30-min deadline, nothing sold', async () => {
  let t = Date.UTC(2026, 10, 23, 1);
  const { engine, db, alerts, state } = setup({ walletUsdc: 100, credit: false, now: () => t });
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(db.getTransfer(id)!.recycle_status, 'sent');
  assert.equal(state.sellCount, 0);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000); // still waiting
  assert.equal(db.getTransfer(id)!.recycle_status, 'sent');
  assert.equal(db.getTransfer(id)!.recycle_held, 0);
  t += RECYCLE_CREDIT_TIMEOUT_MS + 60_000;
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  const row = db.getTransfer(id)!;
  assert.equal(row.recycle_held, 1);
  assert.match(row.recycle_note ?? '', /did not credit on MEXC within 30 min/);
  assert.equal(state.sellCount, 0);
  assert.ok(alerts.some((a) => a.includes('HELD') && a.includes('did not credit')));
});

test('USDCUSDT market unavailable -> HOLD at credited, nothing sold', async () => {
  const { engine, db, alerts, state } = setup({ walletUsdc: 100, marketOk: false });
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  const row = db.getTransfer(id)!;
  assert.equal(row.recycle_status, 'credited');
  assert.equal(row.recycle_held, 1);
  assert.equal(state.sellCount, 0);
  assert.ok(alerts.some((a) => a.includes('HELD') && a.includes('USDCUSDT market unavailable')));
});

test('gas reserve too low -> HOLD, nothing sent', async () => {
  const { engine, db, alerts, state } = setup({ walletUsdc: 100, ethBalance: 5_000_000_000_000_000n }); // 0.005 native < 0.01 reserve
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(db.getTransfer(id)!.recycle_held, 1);
  assert.equal(state.sendCount, 0);
  assert.ok(alerts.some((a) => a.includes('HELD') && a.includes('gas reserve too low')));
});

test('deposit send fails (mined + reverted) -> HOLD in sent, nothing sold; resume re-sends', async () => {
  const first = setup({ walletUsdc: 100, sendFails: true });
  const id = doneTransfer(first.db, 100);
  await first.engine.advanceTransfer(first.db.getTransfer(id)!, GAS, 2000);
  // onSigned already recorded the hash before the revert was known, so the job
  // holds in 'sent' (never blindly re-sends a signed tx); the receipt says 0.
  const held = first.db.getTransfer(id)!;
  assert.equal(held.recycle_status, 'sent');
  assert.equal(held.recycle_held, 1);
  assert.equal(first.state.sellCount, 0);
  assert.ok(first.alerts.some((a) => a.includes('HELD') && a.includes('deposit send failed')));
  // Resume: the receipt-0 check sends the job back to 'address', then it re-sends once.
  assert.match(first.engine.retryTransfer(id), /resumes on the next scan/);
  const second = setup({ db: first.db, walletUsdc: 100 });
  const sendsBefore = first.state.sendCount; // 1 (the reverted send)
  Object.assign(second.state, { ...first.state, walletUsdc: BigInt(100e6), mexcUsdc: 0, mexcUsdt: 1000, deposits: [] });
  await second.engine.advanceTransfer(second.db.getTransfer(id)!, GAS, 2000);
  assert.equal(second.db.getTransfer(id)!.recycle_status, 'address'); // receipt-0 check sent it back to unsent
  await second.engine.advanceTransfer(second.db.getTransfer(id)!, GAS, 2000); // next scan re-sends
  assert.equal(second.db.getTransfer(id)!.recycle_status, 'done');
  assert.equal(second.state.sendCount, sendsBefore + 1); // the new engine sent exactly once
});

test('deposit send outcome unknown with a failed receipt -> re-sends once, then done', async () => {
  const s = setup({ walletUsdc: 100, sendUnknown: true, receiptStatus: 0 });
  const id = doneTransfer(s.db, 100);
  await s.engine.advanceTransfer(s.db.getTransfer(id)!, GAS, 2000);
  const row = s.db.getTransfer(id)!;
  assert.equal(row.recycle_status, 'address'); // failed on-chain: back to unsent
  assert.equal(row.recycle_tx, null);
  assert.equal(row.recycle_held, 0);
  assert.equal(s.state.sendCount, 1);
  // Second attempt: the send now succeeds (no longer unknown).
  const s2 = setup({ db: s.db, walletUsdc: 100 });
  Object.assign(s2.state, { ...s.state, walletUsdc: BigInt(100e6), mexcUsdc: 0, mexcUsdt: 1000, deposits: [] });
  await s2.engine.advanceTransfer(s2.db.getTransfer(id)!, GAS, 2000);
  assert.equal(s2.db.getTransfer(id)!.recycle_status, 'done');
});

test('restart after the deposit send resumes without double-send', async () => {
  const first = setup({ walletUsdc: 100, credit: false });
  const id = doneTransfer(first.db, 100);
  await first.engine.advanceTransfer(first.db.getTransfer(id)!, GAS, 2000);
  assert.equal(first.db.getTransfer(id)!.recycle_status, 'sent');
  assert.equal(first.state.sendCount, 1);
  // "Restart": new engine, same DB; the deposit credits now.
  const second = setup({ db: first.db, walletUsdc: 0 });
  second.state.walletUsdc = 0n;
  second.state.mexcUsdc = 100; // credited while down
  second.state.deposits.push({ txId: first.state.depositHash, amount: '100' });
  second.state.mexcUsdt = 1000;
  await second.engine.advanceTransfer(second.db.getTransfer(id)!, GAS, 2000);
  assert.equal(second.db.getTransfer(id)!.recycle_status, 'done');
  assert.equal(second.state.sendCount, 0); // the new engine sent nothing
  assert.equal(second.state.sellCount, 1);
});

test('deposit history missing (404) -> credit decided by balance alone', async () => {
  const { engine, db, state } = setup({ walletUsdc: 100, history404: true });
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(db.getTransfer(id)!.recycle_status, 'done');
  assert.equal(state.sellCount, 1);
});

test('a concurrent unrelated deposit does NOT satisfy the credit check', async () => {
  // MEXC balance grows (someone else's deposit) but OUR tx hash is absent from history.
  const { engine, db, state } = setup({ walletUsdc: 100, credit: false });
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(db.getTransfer(id)!.recycle_status, 'sent');
  state.mexcUsdc = 100; // unrelated funds land
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(db.getTransfer(id)!.recycle_status, 'sent'); // still waiting for OUR deposit
  assert.equal(state.sellCount, 0);
});

test('BSC is out of scope: no recycle, no calls', async () => {
  const { engine, db, calls, state } = setup({ chain: 'bsc', walletUsdc: 100 });
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 900);
  assert.equal(db.getTransfer(id)!.recycle_status, null);
  assert.equal(state.sendCount, 0);
  assert.deepEqual(calls, []);
});

test('paper mode: no recycle, no calls', async () => {
  const { engine, db, state } = setup({ mode: 'paper', walletUsdc: 100 });
  const id = doneTransfer(db, 100);
  await engine.advanceTransfer(db.getTransfer(id)!, GAS, 2000);
  assert.equal(db.getTransfer(id)!.recycle_status, null);
  assert.equal(state.sendCount, 0);
});

test('DB migration: recycle columns exist, needing-recycle query round-trips', () => {
  const db = new Db(':memory:');
  const cols = new Set(db.all<{ name: string }>('PRAGMA table_info(transfers)').map((c) => c.name));
  for (const c of ['recycle_status', 'recycle_held', 'recycled_usdc', 'recycled_usdt', 'recycle_address', 'recycle_tx', 'recycle_order_id', 'recycle_note', 'recycle_deadline', 'recycle_mexc_before', 'recycle_usdt_before']) {
    assert.ok(cols.has(c), `missing column ${c}`);
  }
  const id = doneTransfer(db, 50);
  assert.deepEqual(db.transfersNeedingRecycle().map((t) => t.id), [id]);
  db.updateTransfer(id, { recycle_status: 'done' });
  assert.deepEqual(db.transfersNeedingRecycle(), []);
  assert.deepEqual(db.transfersRecyclePending().map((t) => t.id), []);
  db.updateTransfer(id, { recycle_status: 'address' });
  assert.deepEqual(db.transfersRecyclePending().map((t) => t.id), [id]);
});

// ---------------------------------------------------------- catch-up sweep

test('catch-up (a): first run sweeps the live wallet balance above dust', async () => {
  const { engine, db, alerts, state } = setup({ walletUsdc: 263.99 }); // transfer #3's proceeds on Ethereum
  await engine.catchUp(GAS, 2000);
  assert.equal(db.getState(CATCHUP_DONE_KEY), '1');
  assert.equal(state.sendCount, 1);
  assert.equal(state.sellCount, 1);
  assert.equal(state.walletUsdc, 0n);
  assert.ok(Math.abs(state.mexcUsdt - (1000 + 263.99 * 0.999)) < 0.01);
  const saved = JSON.parse(db.getState(CATCHUP_STATE_KEY)!);
  assert.equal(saved.status, 'done');
  assert.equal(saved.amount, 263.99);
  assert.ok(alerts.some((a) => a.includes('Catch-up sweep') && a.includes('263.99')));
  assert.ok(alerts.some((a) => a.includes('recycled') && a.includes('USDT on MEXC')));
});

test('catch-up (b): dust balance skips the sweep and still marks it done', async () => {
  const { engine, db, alerts, state } = setup({ walletUsdc: 0.5 });
  await engine.catchUp(GAS, 2000);
  assert.equal(db.getState(CATCHUP_DONE_KEY), '1');
  assert.equal(state.sendCount, 0);
  assert.equal(state.sellCount, 0);
  const saved = JSON.parse(db.getState(CATCHUP_STATE_KEY)!);
  assert.equal(saved.status, 'done');
  assert.ok(alerts.some((a) => a.includes('nothing to sweep') || a.includes('nothing above')));
});

test('catch-up (c): second run does NOT repeat the sweep', async () => {
  const { engine, db, state } = setup({ walletUsdc: 263.99 });
  await engine.catchUp(GAS, 2000);
  assert.equal(state.sendCount, 1);
  state.walletUsdc = BigInt(Math.round(50 * 1e6)); // fresh USDC arrives later
  await engine.catchUp(GAS, 2000);
  assert.equal(state.sendCount, 1); // no second sweep
  assert.equal(state.sellCount, 1);
  assert.equal(state.walletUsdc, BigInt(Math.round(50 * 1e6))); // untouched
});

test('catch-up excludes proceeds of done transfers whose recycle has not sent', async () => {
  const { engine, db, state } = setup({ walletUsdc: 363.99 });
  doneTransfer(db, 100); // its $100 is still in the wallet, recycle not started
  await engine.catchUp(GAS, 2000);
  assert.equal(state.sendCount, 1);
  // Only the pre-existing $263.99 was swept; the transfer's $100 stays for its own recycle.
  assert.equal(state.walletUsdc, BigInt(Math.round(100 * 1e6)));
  const saved = JSON.parse(db.getState(CATCHUP_STATE_KEY)!);
  assert.ok(Math.abs(saved.amount - 263.99) < 0.01, `swept ${saved.amount}`);
});

test('catch-up restart mid-sweep resumes without double-sweep', async () => {
  const first = setup({ walletUsdc: 263.99, credit: false });
  await first.engine.catchUp(GAS, 2000);
  assert.equal(first.state.sendCount, 1);
  assert.equal(JSON.parse(first.db.getState(CATCHUP_STATE_KEY)!).status, 'sent');
  assert.equal(first.db.getState(CATCHUP_DONE_KEY), undefined); // not done yet
  // "Restart": new engine, same DB; the deposit credits now.
  const second = setup({ db: first.db, walletUsdc: 0 });
  second.state.walletUsdc = 0n;
  second.state.mexcUsdc = 263.99;
  second.state.deposits.push({ txId: first.state.depositHash, amount: '263.99' });
  second.state.mexcUsdt = 1000;
  await second.engine.catchUp(GAS, 2000);
  assert.equal(second.db.getState(CATCHUP_DONE_KEY), '1');
  assert.equal(second.state.sendCount, 0); // the new engine sent nothing
  assert.equal(second.state.sellCount, 1);
});

test('catch-up held on address failure resumes via /recycle catchup', async () => {
  const first = setup({ walletUsdc: 100, addressThrows: true });
  await first.engine.catchUp(GAS, 2000);
  assert.equal(first.state.sendCount, 0);
  assert.equal(JSON.parse(first.db.getState(CATCHUP_STATE_KEY)!).held, true);
  assert.equal(first.db.getState(CATCHUP_DONE_KEY), undefined);
  assert.match(first.engine.retryCatchUp(), /resumes on the next scan/);
  const second = setup({ db: first.db, walletUsdc: 100 });
  Object.assign(second.state, { ...first.state, walletUsdc: BigInt(100e6), mexcUsdc: 0, mexcUsdt: 1000, deposits: [] });
  await second.engine.catchUp(GAS, 2000);
  assert.equal(second.db.getState(CATCHUP_DONE_KEY), '1');
  assert.equal(second.state.sendCount, 1);
});
