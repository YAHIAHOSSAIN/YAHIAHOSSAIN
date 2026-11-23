// Gate.io API v4 adapter — implements TransferMexc so Gate can be the transfer CEX.
// REST only (v1); no WebSocket. MEXC stays the default (CEX=mexc).
//
// Docs: https://www.gate.io/docs/developers/apiv4/en/ (APIv4, checked 2026-11-23)
//   Base URL https://api.gateio.ws/api/v4
//   Signing: headers KEY / Timestamp (Unix SECONDS) / SIGN =
//     Hex(HMAC-SHA512(secret, METHOD + "\n" + path-incl-/api/v4 + "\n" + query-string +
//     "\n" + Hex(SHA512(body)) + "\n" + Timestamp))
//   Symbol format BTC_USDT (underscore); MEXC uses BTCUSDT — mapped both ways here.
//   Spot fee VIP 0 is 0.20% maker/taker (Gate's currency_pairs `fee` field is a PERCENT:
//   "0.2" means 0.20%, so it is divided by 100 into the bot's fraction form).
//   Order `text` (custom id): must start with `t-`, at most 28 bytes after the prefix,
//     charset [0-9A-Za-z_.-] — the engine's client ids are 32 chars, so they are truncated.
//   Market buy amount is in QUOTE currency, market sell (and limit) amount in BASE.
//   Withdrawal status: DONE -> 7 (SUCCESS), FAIL -> 8, CANCEL -> 9, MANUAL -> 10,
//     anything else -> 1 (in progress), matching the MEXC numbers the engine checks.
//   Gate chain codes (verified live 2026-11-23 via GET /wallet/currency_chains?currency=USDT,
//     a PUBLIC endpoint): ETH, ARBEVM (Arbitrum One), BSC.
//   Verified live from the public API (no key): /spot/tickers, /spot/order_book,
//     /spot/currencies (per-chain contract addresses live in chains[].addr),
//     /spot/currency_pairs (fee "0.2", amount_precision, min_base/quote_amount),
//     /wallet/currency_chains (contract_address + withdraw_amount_min per chain).
//
// Known v1 gaps (documented, not guessed):
//   - coinConfigs() cannot fill withdrawFee/withdrawMin: Gate's public /spot/currencies
//     carries no fixed per-chain fee (fees adjust hourly with network conditions) and
//     withdraw_amount_min lives in /wallet/currency_chains (one call per coin). Both are
//     left unset (0 in the engine's math); the fee actually charged IS read back from
//     withdrawal history (findWithdraw -> transactionFee) and used for the arrival check.
//   - account().canTrade is always true: Gate has no canTrade flag. A successful
//     /spot/accounts read means the key can read spot accounts; trade permission only
//     surfaces at the first order attempt (clear API error, never a silent trade).
//   - Market orders omit `price` (Gate docs: price is required for limit orders only).
//     This is verified from the docs, not from a live order (no real order was placed);
//     if Gate rejects a price-less market order the failure is loud, at order time.
//   - syncTime() uses the Date header of a public call: Gate has no /time endpoint.
import crypto from 'node:crypto';
import { redact, errMsg } from '../log.js';
import {
  AmbiguousRequestError,
  RateLimitError,
  type Book,
  type CoinConfig,
  type DepositRecord,
  type Level,
  type Order,
  type Side,
  type SymbolInfo,
  type WithdrawRecord,
} from '../mexc/rest.js';
import type { TransferMexc } from '../transfer.js';

export const GATE_BASE_URL = 'https://api.gateio.ws/api/v4';

/** SHA512 hex of an empty body — the constant the docs themselves quote. */
export const EMPTY_BODY_SHA512 =
  'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e';

/**
 * Pure signing function (testable): SIGN = Hex(HMAC-SHA512(secret, payload)) where
 * payload = METHOD + "\n" + path + "\n" + query + "\n" + Hex(SHA512(body)) + "\n" + timestamp.
 * `path` includes the /api/v4 prefix, `query` is the raw query string in URL order ("" if none).
 */
export function gateSign(secret: string, method: string, path: string, query: string, body: string, timestampSec: number): string {
  const bodyHash = crypto.createHash('sha512').update(body).digest('hex');
  const payload = [method, path, query, bodyHash, String(timestampSec)].join('\n');
  return crypto.createHmac('sha512', secret).update(payload).digest('hex');
}

/** MEXC-style symbol (BTCUSDT) -> Gate pair (BTC_USDT). The bot only trades USDT pairs. */
export function toGatePair(mexcSymbol: string): string {
  const s = mexcSymbol.toUpperCase();
  if (!s.endsWith('USDT')) throw new Error(`Gate adapter only trades USDT pairs, got ${mexcSymbol}`);
  return `${s.slice(0, -4)}_USDT`;
}

/** Gate pair (BTC_USDT) -> MEXC-style symbol (BTCUSDT). */
export function fromGatePair(pair: string): string {
  return pair.replace('_', '').toUpperCase();
}

/**
 * Gate order `text`: `t-` + at most 28 bytes, charset [0-9A-Za-z_.-].
 * The engine's client ids are 32 chars (`arb<chain><id><side>` + uuid), so truncate to 28;
 * the leading `arb<chain><id><side>` part survives, so ids stay unique. The same truncation
 * is applied on lookup, so send and lookup always agree.
 */
export function gateOrderText(clientOrderId: string): string {
  return `t-${clientOrderId.slice(0, 28)}`;
}

/** Gate chain codes per chain: ETH, ARBEVM (Arbitrum One), BSC. Aliases map MEXC-style names to them. */
const GATE_CHAIN_ALIASES: Record<string, string> = {
  ARB: 'ARBEVM',
  ERC20: 'ETH',
  BEP20: 'BSC',
  'Ethereum(ERC20)': 'ETH',
  Ethereum: 'ETH',
  'BNB Smart Chain(BEP20)': 'BSC',
  'BNB Smart Chain': 'BSC',
  'Arbitrum One(ARB)': 'ARBEVM',
  'Arbitrum One': 'ARBEVM',
};

export function gateChainCode(network: string): string {
  return GATE_CHAIN_ALIASES[network] ?? network;
}

/** Gate withdrawal status -> the MEXC numbers the engine checks (7 ok, 8/9 failed, 10 manual). */
const WITHDRAW_STATUS: Record<string, number> = { DONE: 7, FAIL: 8, CANCEL: 9, MANUAL: 10, REJECT: 8 };

function mapWithdrawStatus(s: string): number {
  return WITHDRAW_STATUS[(s ?? '').toUpperCase()] ?? 1; // anything else: still in progress
}

function mapDepositStatus(s: unknown): number {
  if (typeof s === 'number') return s;
  if (typeof s === 'string') {
    const v = s.toUpperCase();
    if (v === 'DONE' || v === 'SUCCESS' || v === 'COMPLETED') return 1;
    return 0;
  }
  return 0;
}

interface GateTicker {
  currency_pair: string;
  last: string;
  lowest_ask: string;
  lowest_size: string;
  highest_bid: string;
  highest_size: string;
  quote_volume: string;
}

interface GatePair {
  id: string;
  base: string;
  quote: string;
  fee: string;
  min_base_amount: string;
  min_quote_amount: string;
  max_base_amount: string;
  max_quote_amount: string;
  amount_precision: number;
  precision: number;
  trade_status: string;
  market_order_max_money?: string;
}

interface GateCurrencyChain {
  name: string;
  addr: string;
  withdraw_disabled: boolean;
  withdraw_delayed: boolean;
  deposit_disabled: boolean;
}

interface GateCurrency {
  currency: string;
  delisted: boolean;
  withdraw_disabled: boolean;
  deposit_disabled: boolean;
  chains?: GateCurrencyChain[];
}

interface GateAccount {
  currency: string;
  available: string;
  locked: string;
}

interface GateOrder {
  id: string;
  text?: string;
  currency_pair: string;
  status: string; // open | closed | cancelled
  type: string;
  side: string;
  amount: string;
  price?: string;
  left?: string;
  filled_total?: string;
}

interface GateWithdrawal {
  id: string;
  txid?: string;
  withdraw_order_id?: string;
  amount: string;
  fee?: string;
  currency: string;
  status: string;
}

interface GateDeposit {
  txid?: string;
  status?: string | number;
  amount: string;
}

interface GateDepositAddress {
  currency: string;
  address?: string;
  multichain_addresses?: { chain: string; address: string }[];
}

/** Gate order -> the MEXC-shaped Order the engine expects. */
function mapOrder(o: GateOrder): Order {
  const amount = Number(o.amount ?? 0);
  const left = Number(o.left ?? 0);
  const filled = amount - left;
  let status: string;
  if (o.status === 'closed') status = 'FILLED';
  else if (o.status === 'cancelled') status = filled > 0 ? 'PARTIALLY_CANCELED' : 'CANCELED';
  else status = left < amount ? 'PARTIALLY_FILLED' : 'NEW'; // 'open'
  // toFixed(12) trims float noise (0.01 - 0.004 -> 0.006, not 0.006000000000000001).
  return {
    orderId: String(o.id),
    status,
    executedQty: String(Number(filled.toFixed(12))),
    cummulativeQuoteQty: o.filled_total ?? '0',
    origQty: o.amount,
    price: o.price ?? '0',
    side: o.side === 'buy' ? 'BUY' : 'SELL',
  };
}

type FetchFn = typeof fetch;

export class GateRest implements TransferMexc {
  /** serverTime - localTime, so signed timestamps stay inside Gate's 60 s window. */
  timeOffsetMs = 0;

  constructor(
    private apiKey = '',
    private apiSecret = '',
    private baseUrl = GATE_BASE_URL,
    private fetchFn: FetchFn = fetch,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    params: Record<string, string | number> = {},
    opts: { signed?: boolean; body?: unknown } = {},
  ): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const query = qs.toString();
    const bodyStr = opts.body === undefined ? '' : JSON.stringify(opts.body);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (opts.signed) {
      if (!this.apiKey || !this.apiSecret) throw new Error('GATE_API_KEY/SECRET are not configured');
      const ts = Math.floor(Date.now() / 1000) + Math.round(this.timeOffsetMs / 1000);
      headers.KEY = this.apiKey;
      headers.Timestamp = String(ts);
      // The signed path is the FULL URL path including the /api/v4 prefix
      // (signing the bare /spot/... path is rejected by Gate).
      const signPath = new URL(this.baseUrl).pathname.replace(/\/$/, '') + path;
      headers.SIGN = gateSign(this.apiSecret, method, signPath, query, bodyStr, ts);
    }
    let res: Response;
    let text: string;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}${query ? `?${query}` : ''}`, {
        method,
        headers,
        body: bodyStr === '' ? undefined : bodyStr,
        signal: AbortSignal.timeout(10_000),
      });
      text = await res.text();
    } catch (e) {
      const msg = redact(`Gate ${method} ${path}: ${errMsg(e)}`);
      // A write that timed out may still have been executed by Gate.
      if (method !== 'GET') throw new AmbiguousRequestError(msg);
      throw new Error(msg);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const err = redact(`Gate ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    if (res.status === 429) throw new RateLimitError(err, Number(res.headers.get('retry-after')) || 0);
    if (res.status >= 500 && method !== 'GET') throw new AmbiguousRequestError(err);
    if (!res.ok) {
      const label = body && typeof body === 'object' && 'label' in body ? String((body as { label: unknown }).label) : '';
      const message = body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : '';
      throw new GateApiError(message ? `${label}: ${message}` : err, res.status, label || undefined);
    }
    return body as T;
  }

  /**
   * Measure clock skew against Gate; returns the offset in ms. Gate has no /time
   * endpoint, so the Date header of a public call is used instead.
   */
  async syncTime(): Promise<number> {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/spot/tickers?currency_pair=ETH_USDT`, { signal: AbortSignal.timeout(10_000) });
      await res.text();
    } catch {
      return 0;
    }
    const t1 = Date.now();
    const date = res.headers.get('date');
    if (!date) return 0;
    const serverMs = Date.parse(date);
    if (!Number.isFinite(serverMs)) return 0;
    this.timeOffsetMs = Math.round(serverMs - (t0 + t1) / 2);
    return this.timeOffsetMs;
  }

  async account(): Promise<{ canTrade: boolean; balances: { asset: string; free: string; locked: string }[] }> {
    const accs = await this.request<GateAccount[]>('GET', '/spot/accounts', {}, { signed: true });
    return {
      // Gate has no canTrade flag: a successful read means the key can read spot accounts.
      // Trade permission only surfaces at the first order attempt.
      canTrade: true,
      balances: accs.map((a) => ({ asset: a.currency, free: a.available, locked: a.locked })),
    };
  }

  async exchangeInfo(): Promise<SymbolInfo[]> {
    const pairs = await this.request<GatePair[]>('GET', '/spot/currency_pairs');
    return pairs.map((p) => {
      const tradable = p.trade_status === 'tradable';
      // Gate's `fee` is a PERCENT ("0.2" = 0.20%): the bot's takerCommission is a fraction.
      const fee = p.fee === '' || p.fee === undefined ? undefined : String(Number(p.fee) / 100);
      return {
        symbol: fromGatePair(p.id),
        baseAsset: p.base,
        quoteAsset: p.quote,
        status: tradable ? 'ENABLED' : 'BREAK',
        isSpotTradingAllowed: tradable,
        baseSizePrecision: p.min_base_amount,
        baseAssetPrecision: p.amount_precision,
        quotePrecision: p.precision,
        orderTypes: ['LIMIT', 'MARKET'],
        quoteAmountPrecision: p.min_quote_amount,
        maxQuoteAmount: p.max_quote_amount,
        quoteAmountPrecisionMarket: p.min_quote_amount,
        maxQuoteAmountMarket: p.market_order_max_money ?? p.max_quote_amount,
        tradeSideType: 1,
        takerCommission: fee,
        makerCommission: fee,
      };
    });
  }

  async tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]> {
    const tickers = await this.request<GateTicker[]>('GET', '/spot/tickers');
    return tickers
      .filter((t) => t.currency_pair.endsWith('_USDT'))
      .map((t) => ({ symbol: fromGatePair(t.currency_pair), quoteVolume: t.quote_volume, lastPrice: t.last }));
  }

  /**
   * Deposit/withdraw status and contract address per network. Public on Gate (unlike
   * MEXC, where this is a signed endpoint): paper mode needs no keys. Per-chain contract
   * addresses live in chains[].addr; the chain code is chains[].name (ETH / ARBEVM / BSC).
   */
  async coinConfigs(): Promise<CoinConfig[]> {
    const currencies = await this.request<GateCurrency[]>('GET', '/spot/currencies');
    return currencies
      .filter((c) => !c.delisted)
      .map((c) => ({
        coin: c.currency,
        networkList: (c.chains ?? []).map((ch) => ({
          coin: c.currency,
          network: ch.name,
          netWork: ch.name,
          contract: ch.addr,
          depositEnable: !ch.deposit_disabled && !c.deposit_disabled,
          withdrawEnable: !ch.withdraw_disabled && !c.withdraw_disabled,
          // No withdrawFee/withdrawMin: Gate publishes no fixed per-chain fee in this
          // endpoint (fees adjust hourly with network conditions) and withdraw_amount_min
          // lives in /wallet/currency_chains (one call per coin). The fee actually charged
          // is read back from withdrawal history (findWithdraw -> transactionFee).
        })),
      }));
  }

  async bookTickers(): Promise<Map<string, { bid: number; ask: number }>> {
    const tickers = await this.request<GateTicker[]>('GET', '/spot/tickers');
    const out = new Map<string, { bid: number; ask: number }>();
    for (const t of tickers) {
      if (!t.currency_pair.endsWith('_USDT')) continue;
      out.set(fromGatePair(t.currency_pair), { bid: Number(t.highest_bid), ask: Number(t.lowest_ask) });
    }
    return out;
  }

  async depth(symbol: string, limit = 20): Promise<Book> {
    const d = await this.request<{ bids: [string, string][]; asks: [string, string][] }>('GET', '/spot/order_book', {
      currency_pair: toGatePair(symbol),
      limit,
    });
    const conv = (l: [string, string][]): Level[] => l.map(([p, q]) => [Number(p), Number(q)]);
    return { bids: conv(d.bids), asks: conv(d.asks), ts: Date.now() };
  }

  async balances(): Promise<Record<string, number>> {
    const accs = await this.request<GateAccount[]>('GET', '/spot/accounts', {}, { signed: true });
    return Object.fromEntries(accs.map((a) => [a.currency, Number(a.available)]));
  }

  async limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<Order> {
    const body: Record<string, string> = {
      currency_pair: toGatePair(symbol),
      side: side.toLowerCase(),
      type: 'limit',
      amount: quantity, // limit amount is always in the BASE currency
      price,
      time_in_force: 'gtc',
      account: 'spot',
    };
    if (clientOrderId) body.text = gateOrderText(clientOrderId);
    const o = await this.request<GateOrder>('POST', '/spot/orders', {}, { signed: true, body });
    return mapOrder(o);
  }

  async marketSell(symbol: string, qty: string, clientOrderId?: string): Promise<Order> {
    const body: Record<string, string> = {
      currency_pair: toGatePair(symbol),
      side: 'sell',
      type: 'market',
      amount: qty, // market sell amount is in the BASE currency (market BUY would be quote)
      time_in_force: 'ioc',
      account: 'spot',
      // No `price`: Gate docs list it as required for limit orders only.
    };
    if (clientOrderId) body.text = gateOrderText(clientOrderId);
    const o = await this.request<GateOrder>('POST', '/spot/orders', {}, { signed: true, body });
    return mapOrder(o);
  }

  async getOrder(symbol: string, orderId: string): Promise<Order> {
    const o = await this.request<GateOrder>('GET', `/spot/orders/${orderId}`, { currency_pair: toGatePair(symbol) }, { signed: true });
    return mapOrder(o);
  }

  async getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null> {
    const text = gateOrderText(clientOrderId);
    const pair = toGatePair(symbol);
    for (const status of ['open', 'finished'] as const) {
      const orders = await this.request<GateOrder[]>('GET', '/spot/orders', { currency_pair: pair, status, limit: 100 }, { signed: true });
      const hit = orders.find((o) => o.text === text);
      if (hit) return mapOrder(hit);
    }
    return null;
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Order> {
    const o = await this.request<GateOrder>('DELETE', `/spot/orders/${orderId}`, { currency_pair: toGatePair(symbol) }, { signed: true });
    return mapOrder(o);
  }

  async withdraw(p: {
    coin: string;
    netWork: string;
    address: string;
    amount: string;
    contractAddress?: string;
    withdrawOrderId?: string;
  }): Promise<string> {
    const body: Record<string, string> = {
      currency: p.coin,
      address: p.address,
      amount: p.amount,
      chain: gateChainCode(p.netWork),
      // contractAddress is ignored: Gate derives the token from currency + chain.
    };
    if (p.withdrawOrderId) body.withdraw_order_id = p.withdrawOrderId;
    const r = await this.request<{ id: string }>('POST', '/withdrawals', {}, { signed: true, body });
    return String(r.id);
  }

  async findWithdraw(
    coin: string,
    sinceTs: number,
    ref: { id?: string | null; withdrawOrderId?: string },
  ): Promise<WithdrawRecord | null> {
    let recs: GateWithdrawal[];
    if (ref.id) {
      recs = await this.request<GateWithdrawal[]>('GET', '/wallet/withdrawals', { currency: coin, withdraw_id: ref.id }, { signed: true });
    } else if (ref.withdrawOrderId) {
      recs = await this.request<GateWithdrawal[]>('GET', '/wallet/withdrawals', { currency: coin, withdraw_order_id: ref.withdrawOrderId }, { signed: true });
    } else {
      // Gate list params use Unix SECONDS; sinceTs is ms.
      recs = await this.request<GateWithdrawal[]>('GET', '/wallet/withdrawals', { currency: coin, from: Math.floor(sinceTs / 1000) }, { signed: true });
    }
    const r = recs[0];
    if (!r) return null;
    return {
      id: String(r.id),
      status: mapWithdrawStatus(r.status),
      amount: r.amount,
      transactionFee: r.fee,
      txId: r.txid,
      withdrawOrderId: r.withdraw_order_id,
    };
  }

  async depositAddress(coin: string, network: string): Promise<string | null> {
    const r = await this.request<GateDepositAddress>('GET', '/wallet/deposit_address', { currency: coin }, { signed: true });
    const code = gateChainCode(network);
    const hit = (r.multichain_addresses ?? []).find((a) => a.chain === code);
    if (hit) return hit.address;
    // No chain requested, or the chain has no separate entry: the top-level address is the default chain's.
    if (!network) return r.address ?? null;
    return null;
  }

  async depositHistory(coin: string, sinceTs: number): Promise<DepositRecord[]> {
    const recs = await this.request<GateDeposit[]>('GET', '/wallet/deposits', { currency: coin, from: Math.floor(sinceTs / 1000) }, { signed: true });
    return recs.map((r) => ({ txId: r.txid, status: mapDepositStatus(r.status), amount: r.amount }));
  }

  async findDeposit(coin: string, sinceTs: number, txId: string): Promise<DepositRecord | null> {
    const recs = await this.depositHistory(coin, sinceTs);
    return recs.find((r) => r.txId?.toLowerCase() === txId.toLowerCase()) ?? null;
  }
}

/** Gate error body: {"label": "...", "message": "..."} plus the HTTP status. */
export class GateApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly label?: string,
  ) {
    super(message);
  }
}
