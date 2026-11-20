// DEX quotes from 0x (Swap API v2, AllowanceHolder) or 1inch (Swap API v6).
// Both route across Uniswap v2/v3 and other Ethereum DEXs; DEX fees are already in buyAmount.
import { redact } from '../log.js';

export interface QuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  taker: string;
  slippageBps: number;
}
export interface Quote {
  buyAmount: bigint; // expected output
  minBuyAmount: bigint; // output floor enforced on-chain
  gas: bigint; // estimated gas units
  spender: string; // address that needs an ERC20 allowance on sellToken
  tx?: { to: string; data: string; value: bigint }; // only for firm quotes
}

export interface Aggregator {
  name: string;
  /** Indicative price, cheap; no transaction. */
  price(req: QuoteRequest): Promise<Quote>;
  /** Firm quote with calldata ready to sign. */
  quote(req: QuoteRequest): Promise<Quote>;
}

type FetchFn = typeof fetch;

async function getJson<T>(fetchFn: FetchFn, url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`));
  return JSON.parse(text) as T;
}

interface ZeroExResponse {
  liquidityAvailable: boolean;
  buyAmount: string;
  minBuyAmount: string;
  gas?: string | null;
  issues?: { allowance?: { spender: string } | null; balance?: unknown };
  transaction?: { to: string; data: string; gas: string; value: string };
}

export class ZeroEx implements Aggregator {
  name = '0x';
  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, private chainId = 1) {
    if (!apiKey) throw new Error('ZEROX_API_KEY is required for DEX_AGGREGATOR=0x');
  }

  private url(kind: 'price' | 'quote', r: QuoteRequest): string {
    const q = new URLSearchParams({
      chainId: String(this.chainId),
      sellToken: r.sellToken,
      buyToken: r.buyToken,
      sellAmount: r.sellAmount.toString(),
      taker: r.taker,
      slippageBps: String(r.slippageBps),
    });
    return `https://api.0x.org/swap/allowance-holder/${kind}?${q}`;
  }

  private async call(kind: 'price' | 'quote', r: QuoteRequest): Promise<Quote> {
    const d = await getJson<ZeroExResponse>(this.fetchFn, this.url(kind, r), { '0x-api-key': this.apiKey, '0x-version': 'v2' });
    if (!d.liquidityAvailable) throw new Error('0x: no liquidity');
    const gas = BigInt(d.transaction?.gas ?? d.gas ?? '300000');
    const spender = d.issues?.allowance?.spender ?? d.transaction?.to ?? '';
    return {
      buyAmount: BigInt(d.buyAmount),
      minBuyAmount: BigInt(d.minBuyAmount),
      gas,
      spender,
      tx: d.transaction ? { to: d.transaction.to, data: d.transaction.data, value: BigInt(d.transaction.value || '0') } : undefined,
    };
  }

  price(r: QuoteRequest) {
    return this.call('price', r);
  }
  quote(r: QuoteRequest) {
    return this.call('quote', r);
  }
}

export class OneInch implements Aggregator {
  name = '1inch';
  private spender?: string;
  private base: string;
  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, chainId = 1) {
    if (!apiKey) throw new Error('ONEINCH_API_KEY is required for DEX_AGGREGATOR=1inch');
    this.base = `https://api.1inch.dev/swap/v6.0/${chainId}`;
  }
  private get headers() {
    return { Authorization: `Bearer ${this.apiKey}`, accept: 'application/json' };
  }
  private async getSpender(): Promise<string> {
    if (!this.spender) {
      this.spender = (await getJson<{ address: string }>(this.fetchFn, `${this.base}/approve/spender`, this.headers)).address;
    }
    return this.spender;
  }
  private minOut(amount: bigint, bps: number) {
    return (amount * BigInt(10_000 - bps)) / 10_000n;
  }

  async price(r: QuoteRequest): Promise<Quote> {
    const q = new URLSearchParams({ src: r.sellToken, dst: r.buyToken, amount: r.sellAmount.toString(), includeGas: 'true' });
    const d = await getJson<{ dstAmount: string; gas?: number }>(this.fetchFn, `${this.base}/quote?${q}`, this.headers);
    const buy = BigInt(d.dstAmount);
    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.gas ?? 300_000), spender: await this.getSpender() };
  }

  async quote(r: QuoteRequest): Promise<Quote> {
    const q = new URLSearchParams({
      src: r.sellToken,
      dst: r.buyToken,
      amount: r.sellAmount.toString(),
      from: r.taker,
      origin: r.taker,
      slippage: String(r.slippageBps / 100), // percent
      disableEstimate: 'true', // we simulate ourselves with eth_call
      includeGas: 'true',
    });
    const d = await getJson<{ dstAmount: string; tx: { to: string; data: string; value: string; gas: number } }>(
      this.fetchFn,
      `${this.base}/swap?${q}`,
      this.headers,
    );
    const buy = BigInt(d.dstAmount);
    return {
      buyAmount: buy,
      minBuyAmount: this.minOut(buy, r.slippageBps),
      gas: BigInt(d.tx.gas || 300_000),
      spender: await this.getSpender(),
      tx: { to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value || '0') },
    };
  }
}
