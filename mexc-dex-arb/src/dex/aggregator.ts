// DEX quotes from 0x (Swap API v2, AllowanceHolder), 1inch (Swap API v6), KyberSwap (Aggregator API v1),
// Velora (ex-ParaSwap, Market API v6.2) and OpenOcean (Enterprise API v4).
// All route across many DEXs; DEX pool fees are already in the output amount.
// BestOf queries several of them and uses the best quote after gas; Limited wraps each in a rate limiter.
import { log, redact } from '../log.js';
import { RateLimitError } from '../mexc/rest.js';

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
  /** Which aggregator produced it. */
  source?: string;
}

/** Our own quote budget for this aggregator is used up: not an error, a "rate_limited" decision. */
export class QuoteBudgetError extends Error {}

export interface Aggregator {
  name: string;
  /** Indicative price, cheap; no transaction. */
  price(req: QuoteRequest): Promise<Quote>;
  /** Firm quote with calldata ready to sign. */
  quote(req: QuoteRequest): Promise<Quote>;
}

type FetchFn = typeof fetch;

// Allowlist: we only ever approve / send to these contracts. Each is the same address on Ethereum,
// Base, BSC and Arbitrum. A wrong or compromised API response pointing anywhere else is rejected.
export const ZEROX_ALLOWANCE_HOLDER = '0x0000000000001ff3684f28c67538d4d072c22734';
export const ONEINCH_ROUTER_V6 = '0x111111125421ca6dc452d289314280a0f8842a65';
// KyberSwap MetaAggregationRouterV2: docs.kyberswap.com/developer-guide/aggregator-api/contracts
// ("deployed at the same address across all supported chains"); live /routes returned it on all four chains.
export const KYBER_ROUTER_V2 = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
// Velora (ex-ParaSwap) Augustus V6.2 router: same address on every chain (CREATE2 deployment).
// Verified: Arbiscan labels it "Velora: Augustus V6.2" on Arbitrum, and Tether's WDK Velora
// integration docs pin this exact address for the EVM module ("The target is the Augustus v6.2
// router, 0x6a000f20005980200259b80c5102003040001068"). The API's returned contractAddress is
// still checked against it on every call, so a per-chain difference would fail soft, never
// approve a wrong address. For Market swaps through Augustus v6.2 the router IS the direct
// ERC-20 spender (no separate TokenTransferProxy — that was the v5 flow).
export const VELORA_ROUTER_V6_2 = '0x6a000f20005980200259b80c5102003040001068';
// OpenOcean Exchange V2: one address on every standard EVM network (per the official
// openocean-finance/OpenOceanExchangeV2 deployment docs: "Most networks (Ethereum, BSC,
// Polygon, Arbitrum, etc.) ... Consistent contract address"). Verified: Etherscan labels it
// "OpenOcean: Exchange V2" on Ethereum, Arbiscan the same on Arbitrum, and the official
// Enterprise API docs show it as the "exchange" in their BSC quote example. The API's
// returned exchange/to is still checked against this map on every call.
export const OPENOCEAN_EXCHANGE_V2 = '0x6352a56caadc4f1e25cd6c75970fa768a3304e64';
export const OPENOCEAN_EXCHANGE: Record<number, string> = { 1: OPENOCEAN_EXCHANGE_V2, 56: OPENOCEAN_EXCHANGE_V2, 42161: OPENOCEAN_EXCHANGE_V2 };

function requireAddress(kind: string, got: string | undefined, allowed: string): string {
  if (!got || got.toLowerCase() !== allowed) throw new Error(`${kind} ${got} is not the allowlisted contract ${allowed}`);
  return allowed;
}

async function getJson<T>(fetchFn: FetchFn, url: string, headers: Record<string, string>, init: RequestInit = {}): Promise<T> {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(8000), ...init });
  const text = await res.text();
  const msg = redact(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`);
  if (res.status === 429) throw new RateLimitError(msg, Number(res.headers.get('retry-after')) || 0);
  if (!res.ok) throw new Error(msg);
  return JSON.parse(text) as T;
}

/**
 * 0x may charge a fee (0.15% on select pairs on the Standard plan). The docs do not settle whether
 * buyAmount is already net of it, so it is treated as an extra cost: the conservative choice
 * (worst case a few trades are skipped; never a loss counted as profit).
 */
export function applyZeroExFee(
  q: { buyAmount: bigint; minBuyAmount: bigint },
  fee: { amount: string; token: string } | null | undefined,
  r: { sellToken: string; buyToken: string; sellAmount: bigint },
): { buyAmount: bigint; minBuyAmount: bigint } {
  if (!fee) return q;
  const amount = BigInt(fee.amount);
  const token = fee.token.toLowerCase();
  if (token === r.buyToken.toLowerCase()) {
    const sub = (x: bigint) => (x > amount ? x - amount : 0n);
    return { buyAmount: sub(q.buyAmount), minBuyAmount: sub(q.minBuyAmount) };
  }
  if (token === r.sellToken.toLowerCase() && r.sellAmount > 0n) {
    const scale = (x: bigint) => (x * (r.sellAmount - amount)) / r.sellAmount;
    return { buyAmount: scale(q.buyAmount), minBuyAmount: scale(q.minBuyAmount) };
  }
  return q;
}

interface ZeroExResponse {
  liquidityAvailable: boolean;
  buyAmount: string;
  minBuyAmount: string;
  gas?: string | null;
  allowanceTarget?: string | null;
  fees?: { zeroExFee?: { amount: string; token: string } | null } | null;
  issues?: { allowance?: { spender: string } | null; balance?: unknown; simulationIncomplete?: boolean };
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
      slippagePpm: String(r.slippageBps * 100), // slippageBps is deprecated in v2
    });
    return `https://api.0x.org/swap/allowance-holder/${kind}?${q}`;
  }

  private async call(kind: 'price' | 'quote', r: QuoteRequest): Promise<Quote> {
    const d = await getJson<ZeroExResponse>(this.fetchFn, this.url(kind, r), { '0x-api-key': this.apiKey, '0x-version': 'v2' });
    if (!d.liquidityAvailable) throw new Error('0x: no liquidity');
    if (kind === 'quote') {
      // A firm quote we would actually send: refuse if 0x itself could not validate it.
      if (d.issues?.balance) throw new Error('0x: taker balance too low for this quote');
      if (d.issues?.simulationIncomplete) throw new Error('0x: simulation incomplete');
      if (d.fees?.zeroExFee) log.info(`0x fee: ${d.fees.zeroExFee.amount} of ${d.fees.zeroExFee.token}`);
    }
    const gas = BigInt(d.transaction?.gas ?? d.gas ?? '300000');
    // With the AllowanceHolder flow, both the spender and tx.to are the AllowanceHolder contract.
    // Never transaction.to for allowances (0x docs): issues.allowance.spender or allowanceTarget, pinned.
    const spender = requireAddress(
      '0x spender',
      d.issues?.allowance?.spender ?? d.allowanceTarget ?? ZEROX_ALLOWANCE_HOLDER,
      ZEROX_ALLOWANCE_HOLDER,
    );
    if (d.transaction) requireAddress('0x tx.to', d.transaction.to, ZEROX_ALLOWANCE_HOLDER);
    const net = applyZeroExFee({ buyAmount: BigInt(d.buyAmount), minBuyAmount: BigInt(d.minBuyAmount) }, d.fees?.zeroExFee, r);
    return {
      ...net,
      source: '0x',
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
      const a = (await getJson<{ address: string }>(this.fetchFn, `${this.base}/approve/spender`, this.headers)).address;
      this.spender = requireAddress('1inch spender', a, ONEINCH_ROUTER_V6);
      setTimeout(() => (this.spender = undefined), 24 * 3600_000).unref?.(); // re-check daily
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
    requireAddress('1inch tx.to', d.tx.to, ONEINCH_ROUTER_V6);
    return {
      buyAmount: buy,
      minBuyAmount: this.minOut(buy, r.slippageBps),
      gas: BigInt(d.tx.gas || 300_000),
      spender: await this.getSpender(),
      tx: { to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value || '0') },
    };
  }
}

interface KyberRoutes {
  code: number;
  message?: string;
  data?: { routeSummary: { amountOut: string; gas: string } & Record<string, unknown>; routerAddress: string };
}
interface KyberBuild {
  code: number;
  message?: string;
  data?: { amountOut: string; gas: string; data: string; routerAddress: string; transactionValue: string };
}

/**
 * KyberSwap Aggregator API v1 (docs.kyberswap.com, evm-swaps): GET /{chain}/api/v1/routes, then
 * POST /{chain}/api/v1/route/build. slippageTolerance is in bps. No API key; x-client-id identifies us.
 */
export class Kyber implements Aggregator {
  name = 'kyber';
  private base: string;
  constructor(
    chain: string,
    private clientId = 'mexc-dex-arb',
    private fetchFn: FetchFn = fetch,
  ) {
    this.base = `https://aggregator-api.kyberswap.com/${chain}/api/v1`;
  }
  private get headers() {
    return { 'x-client-id': this.clientId, accept: 'application/json' };
  }
  private minOut(amount: bigint, bps: number) {
    return (amount * BigInt(10_000 - bps)) / 10_000n;
  }
  private async routes(r: QuoteRequest) {
    const q = new URLSearchParams({ tokenIn: r.sellToken, tokenOut: r.buyToken, amountIn: r.sellAmount.toString() });
    const d = await getJson<KyberRoutes>(this.fetchFn, `${this.base}/routes?${q}`, this.headers);
    if (d.code !== 0 || !d.data) throw new Error(`kyber routes: ${d.code} ${d.message ?? ''}`);
    requireAddress('kyber router', d.data.routerAddress, KYBER_ROUTER_V2);
    return d.data;
  }

  async price(r: QuoteRequest): Promise<Quote> {
    const d = await this.routes(r);
    const buy = BigInt(d.routeSummary.amountOut);
    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.routeSummary.gas || '300000'), spender: KYBER_ROUTER_V2, source: 'kyber' };
  }

  async quote(r: QuoteRequest): Promise<Quote> {
    const d = await this.routes(r);
    const body = {
      routeSummary: d.routeSummary,
      sender: r.taker,
      recipient: r.taker, // output always to our own wallet
      slippageTolerance: r.slippageBps,
      deadline: Math.floor(Date.now() / 1000) + 120,
    };
    const b = await getJson<KyberBuild>(this.fetchFn, `${this.base}/route/build`, { ...this.headers, 'content-type': 'application/json' }, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (b.code !== 0 || !b.data) throw new Error(`kyber build: ${b.code} ${b.message ?? ''}`);
    const to = requireAddress('kyber tx.to', b.data.routerAddress, KYBER_ROUTER_V2);
    const buy = BigInt(b.data.amountOut);
    return {
      buyAmount: buy,
      minBuyAmount: this.minOut(buy, r.slippageBps),
      gas: BigInt(b.data.gas || d.routeSummary.gas || '300000'),
      spender: KYBER_ROUTER_V2,
      source: 'kyber',
      tx: { to, data: b.data.data, value: BigInt(b.data.transactionValue || '0') },
    };
  }
}

interface VeloraPrice {
  priceRoute?: {
    srcToken?: string;
    srcAmount?: string;
    destToken?: string;
    destAmount: string;
    gasCost?: string | null;
    contractAddress?: string;
    tokenTransferProxy?: string;
    version?: string | null;
  } & Record<string, unknown>;
  // v6.2 may also surface the route under `route`; the raw object is passed
  // to /transactions unmodified either way.
  route?: Record<string, unknown>;
}
interface VeloraTx {
  from?: string;
  to: string;
  chainId?: number;
  value?: string | null;
  data: string;
  gasPrice?: string | null;
  gas?: string | null;
}

/**
 * Velora (ex-ParaSwap) Market API, version 6.2 (docs.velora.xyz, API free tier: no key,
 * pass partner=<app> on each call; 1 RPS / 5,000 req/day). GET /prices/?...&version=6.2,
 * then POST /transactions/{network} with the priceRoute EXACTLY as /prices returned it
 * (the API rejects a modified route, hmac included). srcDecimals/destDecimals are optional
 * ("improves accuracy") and are omitted: QuoteRequest carries no decimals, so the API
 * resolves them from its token list; a token it cannot resolve fails soft (BestOf skips it).
 * priceRoute.gasCost is treated as the gas-units estimate (ParaSwap convention).
 */
export class Velora implements Aggregator {
  name = 'velora';
  private base = 'https://api.velora.xyz';
  constructor(
    private chainId = 1,
    private partner = 'mexc-dex-arb',
    private fetchFn: FetchFn = fetch,
  ) {}
  private minOut(amount: bigint, bps: number) {
    return (amount * BigInt(10_000 - bps)) / 10_000n;
  }
  private async prices(r: QuoteRequest): Promise<{ route: Record<string, unknown>; destAmount: string; gas: string }> {
    const q = new URLSearchParams({
      srcToken: r.sellToken,
      destToken: r.buyToken,
      amount: r.sellAmount.toString(),
      side: 'SELL',
      network: String(this.chainId),
      version: '6.2',
      partner: this.partner,
    });
    const d = await getJson<VeloraPrice>(this.fetchFn, `${this.base}/prices/?${q}`, { accept: 'application/json' });
    const route = (d.priceRoute ?? d.route) as VeloraPrice['priceRoute'];
    if (!route || typeof route.destAmount !== 'string') throw new Error('velora: no route for this pair');
    // The quote must be for API version 6.2 (WDK Velora docs) and for our exact request.
    if (route.version && route.version !== '6.2') throw new Error(`velora: priceRoute version ${route.version} is not 6.2`);
    if (route.srcToken && route.srcToken.toLowerCase() !== r.sellToken.toLowerCase()) throw new Error('velora: priceRoute srcToken does not match the request');
    if (route.destToken && route.destToken.toLowerCase() !== r.buyToken.toLowerCase()) throw new Error('velora: priceRoute destToken does not match the request');
    if (route.srcAmount && BigInt(route.srcAmount) !== r.sellAmount) throw new Error('velora: priceRoute srcAmount does not match the request');
    // For Market swaps through Augustus v6.2 the router is the direct spender; reject anything else.
    requireAddress('velora router', route.contractAddress, VELORA_ROUTER_V6_2);
    return { route: route as Record<string, unknown>, destAmount: route.destAmount, gas: route.gasCost ?? '300000' };
  }

  async price(r: QuoteRequest): Promise<Quote> {
    const p = await this.prices(r);
    const buy = BigInt(p.destAmount);
    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(p.gas), spender: VELORA_ROUTER_V6_2, source: 'velora' };
  }

  async quote(r: QuoteRequest): Promise<Quote> {
    const p = await this.prices(r); // fresh route: /transactions rejects a stale/modified priceRoute
    const body = {
      srcToken: r.sellToken,
      destToken: r.buyToken,
      srcAmount: r.sellAmount.toString(),
      priceRoute: p.route, // unmodified, exactly as /prices returned it
      slippage: r.slippageBps,
      userAddress: r.taker,
      partner: this.partner,
    };
    const t = await getJson<VeloraTx>(this.fetchFn, `${this.base}/transactions/${this.chainId}`, { accept: 'application/json', 'content-type': 'application/json' }, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const to = requireAddress('velora tx.to', t.to, VELORA_ROUTER_V6_2);
    const buy = BigInt(p.destAmount);
    return {
      buyAmount: buy,
      minBuyAmount: this.minOut(buy, r.slippageBps),
      gas: BigInt(t.gas ?? p.gas),
      spender: VELORA_ROUTER_V6_2,
      source: 'velora',
      tx: { to, data: t.data, value: BigInt(t.value ?? '0') },
    };
  }
}

interface OpenOceanQuoteData {
  inAmount?: string;
  outAmount: string;
  estimatedGas?: string | number;
  exchange?: string;
  minOutAmount?: string;
}
interface OpenOceanSwapData extends OpenOceanQuoteData {
  from?: string;
  to?: string;
  value?: string;
  data?: string;
  gasPrice?: string;
  chainId?: number;
}
interface OpenOceanQuote {
  code: number;
  data?: OpenOceanQuoteData;
  error?: string;
}
interface OpenOceanSwap {
  code: number;
  data?: OpenOceanSwapData;
  error?: string;
}

/**
 * OpenOcean Enterprise API v4 (docs.openocean.finance/docs/swap-api/enterprise).
 * Free public API, no key (keys only raise the rate limit; public default is 2 RPS).
 * GET /v4/:chain/quote (indicative, no account -> no calldata) and /v4/:chain/swap
 * (firm, account=taker -> calldata). The exchange contract address comes back in the
 * response and is allowlisted per chain — a chain with no verified exchange address
 * throws at construction and is never traded on. NOTE: the public API applies a tiered
 * trading fee (0.01% stable / 0.1% correlated / 0.25% common / 0.5% exotic pairs,
 * docs "API Pricing & Access"); it is expected to be baked into outAmount, but that
 * must be confirmed on paper before enabling live (see CHANGES.md).
 */
export class OpenOcean implements Aggregator {
  name = 'openocean';
  private base = 'https://open-api-enterprise.openocean.finance/v4';
  private exchange: string;
  constructor(
    private chainId = 1,
    private fetchFn: FetchFn = fetch,
  ) {
    const ex = OPENOCEAN_EXCHANGE[chainId];
    if (!ex) throw new Error(`openocean: no verified exchange contract for chain ${chainId} — aggregator disabled on this chain`);
    this.exchange = ex;
  }
  private minOut(amount: bigint, bps: number) {
    return (amount * BigInt(10_000 - bps)) / 10_000n;
  }
  private params(r: QuoteRequest, extra: Record<string, string> = {}): URLSearchParams {
    return new URLSearchParams({
      inTokenAddress: r.sellToken,
      outTokenAddress: r.buyToken,
      amountDecimals: r.sellAmount.toString(),
      // Gas price in wei; only feeds the API's gas-cost estimate — our own gas
      // pricing happens in txsender. 1 Gwei is a neutral placeholder.
      gasPriceDecimals: '1000000000',
      slippage: String(r.slippageBps / 100), // percent, range 0.05–50
      ...extra,
    });
  }
  private check<D>(d: { code: number; data?: D; error?: string }, what: string): D {
    if (d.code !== 200 || !d.data) throw new Error(`openocean ${what}: code ${d.code}${d.error ? ` ${d.error}` : ''}`);
    return d.data;
  }

  async price(r: QuoteRequest): Promise<Quote> {
    const d = await getJson<OpenOceanQuote>(this.fetchFn, `${this.base}/${this.chainId}/quote?${this.params(r)}`, { accept: 'application/json' });
    const data = this.check(d, 'quote');
    requireAddress('openocean exchange', data.exchange, this.exchange);
    const buy = BigInt(data.outAmount);
    return {
      buyAmount: buy,
      minBuyAmount: this.minOut(buy, r.slippageBps),
      gas: BigInt(String(data.estimatedGas ?? '300000')),
      spender: this.exchange,
      source: 'openocean',
    };
  }

  async quote(r: QuoteRequest): Promise<Quote> {
    const d = await getJson<OpenOceanSwap>(this.fetchFn, `${this.base}/${this.chainId}/swap?${this.params(r, { account: r.taker })}`, { accept: 'application/json' });
    const data = this.check(d, 'swap');
    requireAddress('openocean exchange', data.exchange, this.exchange);
    const to = requireAddress('openocean tx.to', data.to, this.exchange);
    if (!data.data) throw new Error('openocean swap: no calldata in response');
    const buy = BigInt(data.outAmount);
    return {
      buyAmount: buy,
      minBuyAmount: data.minOutAmount ? BigInt(data.minOutAmount) : this.minOut(buy, r.slippageBps),
      gas: BigInt(String(data.estimatedGas ?? '300000')),
      spender: this.exchange,
      source: 'openocean',
      tx: { to, data: data.data, value: BigInt(data.value ?? '0') },
    };
  }
}

/** Token bucket: `rps` calls per second on average, bursts up to `rps`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  blockedUntil = 0;
  constructor(
    private rps: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = rps;
    this.last = now();
  }
  take(): boolean {
    const t = this.now();
    if (t < this.blockedUntil) return false;
    this.tokens = Math.min(this.rps, this.tokens + ((t - this.last) / 1000) * this.rps);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** After a 429: no calls for Retry-After seconds (at least 1 s). */
  block(seconds: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(1, seconds) * 1000);
  }
}

/** Wraps an aggregator in its own quote budget; honours 429 / Retry-After. */
export class Limited implements Aggregator {
  readonly name: string;
  constructor(
    private inner: Aggregator,
    readonly bucket: TokenBucket,
  ) {
    this.name = inner.name;
  }
  private async run(fn: () => Promise<Quote>): Promise<Quote> {
    if (!this.bucket.take()) throw new QuoteBudgetError(`${this.name}: quote budget used up`);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof RateLimitError) this.bucket.block(e.retryAfterSec || 5);
      throw e;
    }
  }
  price(r: QuoteRequest) {
    return this.run(() => this.inner.price(r));
  }
  quote(r: QuoteRequest) {
    return this.run(() => this.inner.quote(r));
  }
}

/**
 * Asks every aggregator and returns the best quote AFTER gas: output minus the gas cost converted into the
 * output token (set by the engine each tick through `gasInOutput`). Without it, the highest output wins.
 */
export class BestOf implements Aggregator {
  readonly name: string;
  gasInOutput?: (gasUnits: bigint, buyToken: string) => bigint;
  constructor(private aggs: Aggregator[]) {
    this.name = aggs.map((a) => a.name).join('+');
  }
  private score(q: Quote, r: QuoteRequest) {
    return q.buyAmount - (this.gasInOutput?.(q.gas, r.buyToken) ?? 0n);
  }
  private async best(r: QuoteRequest, kind: 'price' | 'quote'): Promise<Quote> {
    const res = await Promise.allSettled(this.aggs.map((a) => a[kind](r)));
    const ok = res.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
    if (!ok.length) {
      const errs = res.map((x) => (x as PromiseRejectedResult).reason);
      throw errs.every((e) => e instanceof QuoteBudgetError || e instanceof RateLimitError) ? new QuoteBudgetError('all aggregators rate limited') : errs[0];
    }
    return ok.reduce((a, b) => (this.score(b, r) > this.score(a, r) ? b : a));
  }
  price(r: QuoteRequest) {
    return this.best(r, 'price');
  }
  quote(r: QuoteRequest) {
    return this.best(r, 'quote');
  }
}
