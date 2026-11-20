// MEXC public WebSocket: keeps a live top-20 order book per symbol.
import WebSocket from 'ws';
import { decodeDepthPush } from './proto.js';
import type { Book } from './rest.js';
import { log, errMsg } from '../log.js';

const URL = 'wss://wbs-api.mexc.com/ws';
const MAX_SUBS_PER_CONN = 30; // MEXC limit per connection

export class MexcBookStream {
  private books = new Map<string, Book>();
  private sockets: WebSocket[] = [];
  private stopped = false;

  constructor(private symbols: string[]) {}

  start(): void {
    for (let i = 0; i < this.symbols.length; i += MAX_SUBS_PER_CONN) {
      this.connect(this.symbols.slice(i, i + MAX_SUBS_PER_CONN), 0);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.sockets) s.terminate();
  }

  /** Latest book, or undefined if missing / older than maxAgeMs. */
  get(symbol: string, maxAgeMs = 5000): Book | undefined {
    const b = this.books.get(symbol);
    return b && Date.now() - b.ts <= maxAgeMs ? b : undefined;
  }

  private connect(symbols: string[], attempt: number): void {
    if (this.stopped) return;
    const ws = new WebSocket(URL);
    this.sockets.push(ws);
    let ping: NodeJS.Timeout | undefined;
    let lastData = Date.now();
    // MEXC drops idle subscriptions; if no data arrives for 60s, reconnect.
    const watchdog = setInterval(() => {
      if (Date.now() - lastData > 60_000) {
        log.warn(`MEXC WS: no data for 60s on ${symbols.length} symbols, reconnecting`);
        ws.terminate();
      }
    }, 15_000);

    ws.on('open', () => {
      lastData = Date.now();
      const params = symbols.map((s) => `spot@public.limit.depth.v3.api.pb@${s}@20`);
      ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params }));
      ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ method: 'PING' })), 20_000);
      log.info(`MEXC WS subscribed: ${symbols.join(',')}`);
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const msg = data.toString();
        if (msg.includes('Blocked') || msg.includes('Not Subscribed')) log.warn(`MEXC WS: ${msg}`);
        return;
      }
      lastData = Date.now();
      attempt = 0; // reset backoff only once data really flows (a bad subscription closes right after open)
      try {
        const push = decodeDepthPush(data);
        // Sanity check: ignore empty or crossed books instead of trading on them.
        if (push && push.symbol && push.bids.length && push.asks.length && push.bids[0][0] < push.asks[0][0]) {
          this.books.set(push.symbol, { bids: push.bids, asks: push.asks, ts: Date.now() });
        }
      } catch (e) {
        log.warn(`MEXC WS decode error: ${errMsg(e)}`);
      }
    });

    const reconnect = () => {
      if (ping) clearInterval(ping);
      clearInterval(watchdog);
      this.sockets = this.sockets.filter((s) => s !== ws);
      if (this.stopped) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      log.warn(`MEXC WS closed, reconnecting in ${delay}ms`);
      setTimeout(() => this.connect(symbols, attempt + 1), delay);
    };
    ws.on('close', reconnect);
    ws.on('error', (e) => {
      log.warn(`MEXC WS error: ${errMsg(e)}`);
      ws.terminate();
    });
  }
}
