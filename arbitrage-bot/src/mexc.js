// Minimal MEXC Spot API v3 client (https://mexcdevelop.github.io/apidocs/spot_v3_en/).
import crypto from 'node:crypto';

export class Mexc {
  constructor({ apiKey = '', apiSecret = '', baseUrl = 'https://api.mexc.com', fetchFn = fetch } = {}) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl;
    this.fetch = fetchFn;
  }

  /** HMAC-SHA256 over the exact query string that is sent. */
  sign(query) {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  async request(method, path, params = {}, signed = false) {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    if (signed) {
      if (!this.apiKey || !this.apiSecret) throw new Error('MEXC_API_KEY / MEXC_API_SECRET not set');
      qs.set('timestamp', String(Date.now()));
      qs.set('recvWindow', '5000');
      qs.set('signature', this.sign(qs.toString()));
    }
    const url = `${this.baseUrl}${path}${qs.size ? `?${qs}` : ''}`;
    const headers = { 'Content-Type': 'application/json' };
    if (signed) headers['X-MEXC-APIKEY'] = this.apiKey;
    const res = await this.fetch(url, { method, headers });
    const body = await res.json();
    if (!res.ok) throw new Error(`MEXC ${method} ${path} ${res.status}: ${JSON.stringify(body)}`);
    return body;
  }

  /** Order book: { bids: [[price, qty]], asks: [[price, qty]] } as numbers, best first. */
  async depth(symbol, limit = 50) {
    const d = await this.request('GET', '/api/v3/depth', { symbol, limit });
    const toNum = (side) => side.map(([p, q]) => [Number(p), Number(q)]);
    return { bids: toNum(d.bids), asks: toNum(d.asks) };
  }

  /** Free balances by asset, e.g. { ETH: 1.2, USDT: 3000 }. */
  async balances() {
    const acc = await this.request('GET', '/api/v3/account', {}, true);
    return Object.fromEntries(acc.balances.map((b) => [b.asset, Number(b.free)]));
  }

  /** Marketable limit order: fills now at `price` or better; any rest is cancelled by the caller. */
  placeLimit(symbol, side, quantity, price) {
    return this.request('POST', '/api/v3/order', { symbol, side, type: 'LIMIT', quantity, price }, true);
  }

  getOrder(symbol, orderId) {
    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
  }

  cancelOrder(symbol, orderId) {
    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
  }
}
