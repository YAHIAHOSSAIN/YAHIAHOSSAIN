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
}
export interface CoinNetwork {
  coin: string;
  network: string;
  netWork?: string;
  contract?: string;
  depositEnable: boolean;
  withdrawEnable: boolean;
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

export class MexcRest {
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
      qs.set('timestamp', String(Date.now()));
      qs.set('recvWindow', '5000');
      qs.set('signature', this.sign(qs.toString()));
      headers['X-MEXC-APIKEY'] = this.apiKey;
    }
    const q = qs.toString();
    const res = await this.fetchFn(`${this.baseUrl}${path}${q ? `?${q}` : ''}`, {
      method,
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) throw new Error(redact(`MEXC ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`));
    return body as T;
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

  async balances(): Promise<Record<string, number>> {
    const a = await this.account();
    return Object.fromEntries(a.balances.map((b) => [b.asset, Number(b.free)]));
  }

  limitOrder(symbol: string, side: Side, quantity: string, price: string): Promise<{ orderId: string }> {
    return this.request('POST', '/api/v3/order', { symbol, side, type: 'LIMIT', quantity, price }, true);
  }

  marketOrder(symbol: string, side: Side, quantity: string): Promise<{ orderId: string }> {
    return this.request('POST', '/api/v3/order', { symbol, side, type: 'MARKET', quantity }, true);
  }

  getOrder(symbol: string, orderId: string): Promise<Order> {
    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
  }

  cancelOrder(symbol: string, orderId: string): Promise<Order> {
    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
  }
}
