// MEXC Spot API v3 REST client. https://mexcdevelop.github.io/apidocs/spot_v3_en/
import crypto from 'node:crypto';
import { redact } from '../log.js';

export type Side = 'BUY' | 'SELL';
export type Level = [price: number, qty: number];
export interface Book {
  bids: Level[];
  asks: Level[];
  ts: number;
}
export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
  baseSizePrecision: string; // quantity step, e.g. "0.01" ("0" = use baseAssetPrecision)
  baseAssetPrecision?: number;
  quotePrecision: number;
  orderTypes: string[];
  quoteAmountPrecision?: string; // minimum order value (USDT)
  maxQuoteAmount?: string;
  tradeSideType?: number; // 1 all, 2 buy only, 3 sell only, 4 close only
}
export interface CoinNetwork {
  coin: string;
  network: string;
  netWork?: string;
  contract?: string;
  depositEnable: boolean;
  withdrawEnable: boolean;
  withdrawFee?: string; // in the coin itself
  withdrawMin?: string;
  withdrawMax?: string;
}
export interface CoinConfig {
  coin: string;
  networkList: CoinNetwork[];
}
export interface Order {
  orderId: string;
  status: string; // NEW, FILLED, PARTIALLY_FILLED, CANCELED, PARTIALLY_CANCELED
  executedQty: string;
  cummulativeQuoteQty: string;
  origQty: string;
  price: string;
  side: Side;
}

type FetchFn = typeof fetch;

/** HTTP 429/418 from any API: callers back off instead of hammering. */
export class RateLimitError extends Error {}

/**
 * The request may or may not have reached MEXC (timeout / connection reset on a POST).
 * Never assume "not placed": look the order / withdrawal up by our own client id.
 */
export class AmbiguousRequestError extends Error {}

export interface WithdrawRecord {
  id: string;
  status: number;
  amount: string;
  txId?: string;
  withdrawOrderId?: string;
}

export class MexcRest {
  /** serverTime - localTime, so signed timestamps stay inside recvWindow even if the VPS clock drifts. */
  timeOffsetMs = 0;

  constructor(
    private apiKey = '',
    private apiSecret = '',
    private baseUrl = 'https://api.mexc.com',
    private fetchFn: FetchFn = fetch,
  ) {}

  sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  async request<T>(method: string, path: string, params: Record<string, string | number> = {}, signed = false): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signed) {
      if (!this.apiKey || !this.apiSecret) throw new Error('MEXC API key/secret not configured');
      qs.set('timestamp', String(Date.now() + this.timeOffsetMs));
      qs.set('recvWindow', '5000');
      qs.set('signature', this.sign(qs.toString()));
      headers['X-MEXC-APIKEY'] = this.apiKey;
    }
    const q = qs.toString();
    let res: Response;
    let text: string;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}${q ? `?${q}` : ''}`, {
        method,
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      text = await res.text();
    } catch (e) {
      const msg = redact(`MEXC ${method} ${path}: ${(e as Error).message}`);
      // A write that timed out may still have been executed by MEXC.
      if (method !== 'GET') throw new AmbiguousRequestError(msg);
      throw new Error(msg);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const err = redact(`MEXC ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    if (res.status === 429 || res.status === 418) throw new RateLimitError(err);
    if (res.status >= 500 && method !== 'GET') throw new AmbiguousRequestError(err);
    if (!res.ok) throw new Error(err);
    return body as T;
  }

  /** Measure clock skew against MEXC; returns the offset in ms. */
  async syncTime(): Promise<number> {
    const t0 = Date.now();
    const r = await this.request<{ serverTime: number }>('GET', '/api/v3/time');
    const t1 = Date.now();
    this.timeOffsetMs = Math.round(r.serverTime - (t0 + t1) / 2);
    return this.timeOffsetMs;
  }

  async depth(symbol: string, limit = 20): Promise<Book> {
    const d = await this.request<{ bids: [string, string][]; asks: [string, string][] }>('GET', '/api/v3/depth', { symbol, limit });
    const conv = (l: [string, string][]): Level[] => l.map(([p, q]) => [Number(p), Number(q)]);
    return { bids: conv(d.bids), asks: conv(d.asks), ts: Date.now() };
  }

  async exchangeInfo(): Promise<SymbolInfo[]> {
    const r = await this.request<{ symbols: SymbolInfo[] }>('GET', '/api/v3/exchangeInfo');
    return r.symbols;
  }

  async tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]> {
    return this.request('GET', '/api/v3/ticker/24hr');
  }

  async price(symbol: string): Promise<number> {
    const r = await this.request<{ price: string }>('GET', '/api/v3/ticker/price', { symbol });
    return Number(r.price);
  }

  /** Deposit/withdraw status and contract address per network (signed). */
  async coinConfigs(): Promise<CoinConfig[]> {
    return this.request('GET', '/api/v3/capital/config/getall', {}, true);
  }

  async account(): Promise<{ canTrade: boolean; balances: { asset: string; free: string; locked: string }[] }> {
    return this.request('GET', '/api/v3/account', {}, true);
  }

  /** Free balances (what can be traded now); includeLocked adds funds held in open orders. */
  async balances(includeLocked = false): Promise<Record<string, number>> {
    const a = await this.account();
    return Object.fromEntries(a.balances.map((b) => [b.asset, Number(b.free) + (includeLocked ? Number(b.locked) : 0)]));
  }

  /** Best bid/ask for every symbol in one call. */
  async bookTickers(): Promise<Map<string, { bid: number; ask: number }>> {
    const r = await this.request<{ symbol: string; bidPrice: string; askPrice: string }[]>('GET', '/api/v3/ticker/bookTicker');
    return new Map(r.map((t) => [t.symbol, { bid: Number(t.bidPrice), ask: Number(t.askPrice) }]));
  }

  /** Withdraw (new endpoint). Requires an API key with withdraw permission. Returns the withdraw id. */
  async withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string> {
    const params: Record<string, string> = { coin: p.coin, netWork: p.netWork, address: p.address, amount: p.amount };
    if (p.contractAddress) params.contractAddress = p.contractAddress;
    if (p.withdrawOrderId) params.withdrawOrderId = p.withdrawOrderId;
    const r = await this.request<{ id: string }>('POST', '/api/v3/capital/withdraw', params, true);
    return r.id;
  }

  /** Recent withdrawals of a coin (status: 1 APPLY .. 6 WAIT_CONFIRM, 7 SUCCESS, 8 FAILED, 9 CANCEL, 10 MANUAL). */
  async withdrawHistory(coin: string, sinceTs: number): Promise<WithdrawRecord[]> {
    const r = await this.request<{ id: string; status: number | string; amount: string; txId?: string; withdrawOrderId?: string }[]>(
      'GET',
      '/api/v3/capital/withdraw/history',
      { coin, startTime: Math.max(0, Math.floor(sinceTs)), limit: 1000 },
      true,
    );
    return r.map((w) => ({ id: w.id, status: Number(w.status), amount: w.amount, txId: w.txId, withdrawOrderId: w.withdrawOrderId }));
  }

  /** Find a withdrawal by MEXC id or by our own withdrawOrderId. null = not in history. */
  async findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null> {
    const h = await this.withdrawHistory(coin, sinceTs);
    return h.find((w) => (ref.id && w.id === ref.id) || (ref.withdrawOrderId && w.withdrawOrderId === ref.withdrawOrderId)) ?? null;
  }

  /** `clientOrderId` makes the order findable even if this request times out. */
  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }> {
    const p: Record<string, string> = { symbol, side, type: 'LIMIT', quantity, price };
    if (clientOrderId) p.newClientOrderId = clientOrderId;
    return this.request('POST', '/api/v3/order', p, true);
  }

  /** Look an order up by our own client id; null if MEXC has no such order. */
  async getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null> {
    try {
      return await this.request<Order>('GET', '/api/v3/order', { symbol, origClientOrderId: clientOrderId }, true);
    } catch (e) {
      // MEXC documents -2011 "Unknown order sent"; anything else is a real error (caller retries).
      if (/-2011|unknown order|does not exist|not exist/i.test((e as Error).message)) return null;
      throw e;
    }
  }

  /** MARKET SELL by base quantity (documented). For buys use an aggressive LIMIT instead. */
  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }> {
    const p: Record<string, string> = { symbol, side: 'SELL', type: 'MARKET', quantity };
    if (clientOrderId) p.newClientOrderId = clientOrderId;
    return this.request('POST', '/api/v3/order', p, true);
  }

  getOrder(symbol: string, orderId: string): Promise<Order> {
    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
  }

  cancelOrder(symbol: string, orderId: string): Promise<Order> {
    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
  }
}
