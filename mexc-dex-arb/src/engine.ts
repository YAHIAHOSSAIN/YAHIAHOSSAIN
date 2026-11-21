// The trading loop: find the best opportunity each block, confirm it, trade both legs, clean up, account.
import type { Config } from './config.js';
import { explorerTxUrl } from './chains.js';
import { BestOf, QuoteBudgetError, type Aggregator, type Quote, type QuoteRequest } from './dex/aggregator.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Book, Order, Side } from './mexc/rest.js';
import type { Db, OpportunityRow, TradeStatus } from './db.js';
import type { Risk, RiskEvent } from './risk.js';
import type { Token } from './watchlist.js';
import { type Balances, inventoryPlan, inventoryWarnings, portfolioUsd } from './inventory.js';
import {
  type Opportunity,
  evaluateCexBuy,
  evaluateDexBuy,
  gasUsd,
  planCexBuy,
  planCexBuyQty,
  threshold,
  unwindPlan,
} from './pricing.js';
import { log, errMsg } from './log.js';
import { AmbiguousRequestError } from './mexc/rest.js';
import { bandProblem, closePrice, orderProblem, takerFeeFor } from './mexc/rules.js';
import crypto from 'node:crypto';

/** A close/unwind that only partly filled: `remaining` is what is still open. */
export class PartialCloseError extends Error {
  constructor(msg: string, readonly remaining: number) {
    super(msg);
  }
}

/** Unique id we give MEXC orders, so an order can be found even if the request timed out. */
export const clientId = (tag: string) => `arb${tag}${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 32);

const FINAL_ORDER = new Set(['FILLED', 'CANCELED', 'PARTIALLY_CANCELED']);

/** A cancel could not be confirmed: the order may still be live on MEXC. Never place a second close for it. */
export class OrderStillOpenError extends Error {
  constructor(readonly orderId: string, status: string) {
    super(`MEXC order ${orderId} still ${status} after cancel attempts: it may still fill`);
  }
}

/**
 * Cancel an order and keep checking until MEXC reports a final status (FILLED / CANCELED / PARTIALLY_CANCELED).
 * Throws OrderStillOpenError if that cannot be confirmed within ~10s.
 */
export async function cancelAndConfirm(
  mexc: Pick<CexApi, 'getOrder' | 'cancelOrder'>,
  symbol: string,
  orderId: string,
  sleep: (ms: number) => Promise<void>,
): Promise<Order> {
  let last = '?';
  for (let i = 0; i < 6; i++) {
    const o = await mexc.getOrder(symbol, orderId).catch(() => null);
    if (o) {
      if (FINAL_ORDER.has(o.status)) return o;
      last = o.status;
    }
    await mexc.cancelOrder(symbol, orderId).catch((e) => log.warn(`cancel ${orderId}: ${errMsg(e)}`));
    await sleep(500 * (i + 1));
  }
  const o = await mexc.getOrder(symbol, orderId).catch(() => null);
  if (o && FINAL_ORDER.has(o.status)) return o;
  throw new OrderStillOpenError(orderId, o?.status ?? last);
}

/**
 * Place an order; if the request is ambiguous (timeout / 5xx) look it up by client id
 * instead of assuming it was not placed. Throws UNKNOWN_ORDER_STATE if that is impossible.
 */
export async function placeSafely(
  mexc: Pick<CexApi, 'getOrderByClientId'>,
  symbol: string,
  cid: string,
  place: () => Promise<{ orderId: string }>,
  sleep: (ms: number) => Promise<void>,
): Promise<{ orderId: string }> {
  try {
    return await place();
  } catch (e) {
    if (!(e instanceof AmbiguousRequestError)) throw e; // clearly rejected: nothing was placed
    // MEXC may take a few seconds to index a just-placed order: look for ~10s (1, 2, 3, 4 s).
    // MEXC docs: after a 5xx "the execution status is UNKNOWN". So if it is still not found, the state is
    // UNKNOWN (critical pause, no unwind) - never "not placed", which could double the exposure.
    for (const wait of [1000, 2000, 3000, 4000]) {
      await sleep(wait);
      try {
        const o = await mexc.getOrderByClientId(symbol, cid);
        if (o) return { orderId: o.orderId }; // it WAS placed
      } catch {
        // lookup failed: try again
      }
    }
    throw new Error(`UNKNOWN_ORDER_STATE client id ${cid}: ${errMsg(e)}`);
  }
}
import { decimalsOfStep, dhakaDay, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

export const USDC_DECIMALS = 6;
export { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
import { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';

// Narrow interfaces so tests can plug in fakes.
export interface CexApi {
  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
  myTrades?(symbol: string, orderId: string): Promise<{ price: string; qty: string; quoteQty: string; commission: string; commissionAsset: string }[]>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<Order>;
}
export interface ChainApi {
  readonly address: string;
  gas(): Promise<GasInfo>;
  approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint>;
  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
  send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
    onSigned?: (hash: string, nonce: number) => void,
  ): Promise<TxResult>;
  /** Unresolved earlier tx (outcome unknown): no new trades until it is 'clear'. */
  checkUnresolved?(): Promise<{ state: 'clear' | 'pending'; dropped?: boolean; executedHash?: string; ok?: boolean }>;
  /** ok only if nothing is unresolved and our next nonce equals the chain's (no gap). */
  readyToSend?(): Promise<{ ok: boolean; reason?: string }>;
  readonly unresolved?: { nonce: number; hashes: string[]; since: number; unknown?: boolean } | null;
}
export interface Notifier {
  send(text: string): Promise<void>;
}

export interface EngineDeps {
  cfg: Config;
  mexc: CexApi;
  chain: ChainApi;
  agg: Aggregator;
  db: Db;
  risk: Risk;
  tg: Notifier;
  book: (symbol: string) => Promise<Book>;
  /** Authoritative book (REST) used for the final check right before trading; defaults to `book`. */
  freshBook?: (symbol: string) => Promise<Book>;
  /** total=true: free + locked MEXC balances (for exact PnL); default free (for sizing). */
  balances: (total?: boolean) => Promise<Balances>;
  tokens: Token[];
  sleep?: (ms: number) => Promise<void>;
  /** Decimals of the DEX stable (read on-chain at startup; 6 for USDC, 18 for BSC USDT). */
  stableDecimals?: number;
}

export interface Candidate {
  token: Token;
  opp: Opportunity;
  req: QuoteRequest;
  spender: string;
  approvalGas: bigint;
  tokenUsd: number;
  /** What gets logged to `opportunities` (decision filled in by tick). */
  row?: OpportunityRow;
  /** Hurdle for this candidate (base hurdle, skewed by inventory balance). */
  need?: number;
}

const mid = (b: Book) => (b.bids[0][0] + b.asks[0][0]) / 2;

export class Engine {
  /** Trade row being executed: every MEXC client id is recorded on it before the order is placed. */
  private currentTradeId: number | null = null;
  private lastNote = new Map<string, string>();
  private lastAlert = new Map<string, number>();
  private sleep: (ms: number) => Promise<void>;
  lastGasGwei = 0;

  constructor(private d: EngineDeps) {
    this.sleep = d.sleep ?? realSleep;
  }

  private get cfg() {
    return this.d.cfg;
  }
  private get live() {
    return this.cfg.mode === 'live';
  }
  private get taker() {
    return this.live ? this.d.chain.address : PAPER_TAKER;
  }
  /** USDT per 1 DEX stable (USDC). 1 on chains whose DEX stable is USDT. Refreshed every tick. */
  stableRate = 1;
  private get stableDec() {
    return this.d.stableDecimals ?? USDC_DECIMALS;
  }
  /** Per-symbol taker fee (exchangeInfo), never below the MEXC_TAKER_FEE override. */
  private fee(t: Token) {
    return takerFeeFor(t.rules, this.cfg.mexcTakerFee);
  }
  private costs(t: Token) {
    return {
      takerFee: this.fee(t),
      cexSlippageBps: this.cfg.cexSlippageBps,
      safetyMarginUsd: this.cfg.safetyMarginUsd,
      safetyMarginBps: this.cfg.safetyMarginBps,
      stableInUsdt: this.stableRate,
    };
  }
  private need(sizeUsd: number) {
    return threshold(sizeUsd, this.cfg.minProfitUsd, this.cfg.minProfitBps);
  }

  /**
   * USDC is not USDT (MEXC USDCUSDT was ~1.0021). Read the live rate; refuse to trade on a stale or
   * unreasonable one. Returns an error string, or null when the rate is usable.
   */
  async refreshStableRate(): Promise<string | null> {
    if (this.cfg.stableIsUsdt) {
      this.stableRate = 1;
      return null;
    }
    const b = await this.d.book('USDCUSDT');
    if (!b.bids.length || !b.asks.length) return 'USDCUSDT book empty';
    if (Date.now() - b.ts > this.cfg.stableRateMaxAgeMs) return `USDCUSDT book is ${Math.round((Date.now() - b.ts) / 1000)}s old`;
    const r = mid(b);
    if (!(r >= 0.99 && r <= 1.01)) return `USDC/USDT rate ${r} outside 0.99-1.01`;
    this.stableRate = r;
    return null;
  }

  /** Log a status line only when it changes (avoids spamming every block). */
  private note(key: string, msg: string) {
    if (this.lastNote.get(key) !== msg) {
      this.lastNote.set(key, msg);
      log.info(msg);
    }
  }

  async alertThrottled(key: string, text: string, everyMs = 6 * 3600_000) {
    const last = this.lastAlert.get(key) ?? 0;
    if (Date.now() - last < everyMs) return;
    this.lastAlert.set(key, Date.now());
    await this.d.tg.send(text);
  }

  /** One scan; executes at most one trade. */
  async tick(): Promise<void> {
    const block = this.d.risk.blockReason();
    if (block) {
      this.logBlocked('paused', block);
      return this.note('block', `trading blocked: ${block}`);
    }
    this.note('block', 'trading enabled');

    if (this.d.chain.checkUnresolved) {
      const pending = this.d.chain.unresolved;
      const u = await this.d.chain.checkUnresolved();
      if (u.state === 'clear' && pending) await this.reportResolved(pending, u);
      if (u.state === 'pending') {
        const p = this.d.chain.unresolved;
        if (p && Date.now() - p.since > 10 * 60_000) {
          await this.alertThrottled(
            'unresolved',
            `⏳ DEX tx at nonce ${p.nonce} still unresolved after ${Math.round((Date.now() - p.since) / 60_000)} min (${p.hashes.join(', ')}). ` +
              `No new trades. Send /cancelnonce to replace it with a cancel, or wait.`,
            3600_000,
          );
        }
        return this.note('unresolved', 'an earlier DEX tx is still unresolved: no new trades until it is mined or dropped');
      }
    }
    this.note('unresolved', 'no unresolved tx');

    const gas = await this.d.chain.gas();
    this.lastGasGwei = Number(gas.effective) / 1e9;
    if (this.lastGasGwei > this.cfg.maxGasGwei) {
      this.logBlocked('gas', `gas ${this.lastGasGwei.toFixed(2)} gwei > ${this.cfg.maxGasGwei}`);
      return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > MAX_GAS_GWEI ${this.cfg.maxGasGwei}, waiting`);
    }
    this.note('gas', 'gas ok');

    const rateProblem = await this.refreshStableRate();
    if (rateProblem) return this.note('stable', `no trading: ${rateProblem}`);
    this.note('stable', 'stable rate ok');
    const ethUsd = mid(await this.d.book(this.cfg.chain.nativeMexcSymbol));
    const bal = await this.d.balances();
    const books = new Map<string, Book>();
    const prices: Record<string, number> = {};
    for (const t of this.d.tokens) {
      try {
        const b = await this.d.book(t.symbol);
        if (b.bids.length && b.asks.length) {
          books.set(t.symbol, b);
          prices[t.base] = mid(b);
        }
      } catch (e) {
        log.warn(`${t.symbol} book: ${errMsg(e)}`);
      }
    }

    if (this.live) {
      for (const w of inventoryWarnings(bal, this.d.tokens, prices, this.cfg.minTradeUsd, this.cfg.minEthForGas)) {
        await this.alertThrottled(`inv-${w.key}`, `📦 Inventory: ${w.text}`);
      }
    }

    this.inventoryHousekeeping(bal, prices);
    // BestOf compares aggregators after gas: tell it what gas costs in each output token right now.
    if (this.d.agg instanceof BestOf) this.d.agg.gasInOutput = this.gasValuer(gas, ethUsd, prices);

    const rows: OpportunityRow[] = [];
    let best: Candidate | null = null;
    for (const t of this.d.tokens) {
      const b = books.get(t.symbol);
      if (!b) continue;
      if (!t.depositOk || !t.withdrawOk) {
        this.note(`susp-${t.base}`, `${t.base}: MEXC deposit/withdraw suspended, skipping`);
        continue;
      }
      this.note(`susp-${t.base}`, `${t.base}: active`);
      try {
        for (const c of await this.candidates(t, b, bal, gas, ethUsd, rows)) {
          const need = c.need ?? this.need(c.opp.sizeUsd);
          log.info(`${t.base} ${c.opp.direction} size ${usd(c.opp.sizeUsd)} net ${usd(c.opp.net)} (need ${usd(need)})`);
          const passes = c.opp.net > need;
          if (c.row) {
            c.row.decision = passes ? 'trade' : 'below_hurdle';
            c.row.reason = passes ? null : `net ${c.opp.net.toFixed(4)} <= need ${need.toFixed(4)}`;
          }
          if (passes && (!best || c.opp.net > best.opp.net)) best = c;
        }
      } catch (e) {
        if (e instanceof QuoteBudgetError) rows.push(this.blankRow(t, 'rate_limited', errMsg(e)));
        else log.warn(`${t.base} quote: ${errMsg(e)}`);
      }
    }
    for (const r of rows) if (r.decision === 'trade' && best?.row !== r) r.reason = 'passed, but another candidate was better this tick';
    this.flushRows(rows);
    if (best) await this.execute(best, gas, ethUsd);
  }

  // ---------- opportunity logging ----------
  private lastBlockedLog = new Map<string, number>();

  private blankRow(t: Token, decision: OpportunityRow['decision'], reason: string | null, direction = '-'): OpportunityRow {
    return {
      ts: Date.now(), chain: this.cfg.chain.name, token: t.base, direction, size_usd: null, mexc_bid: null, mexc_ask: null,
      book_age_ms: null, aggregator: null, dex_out: null, dex_min_out: null, usdc_usdt: this.stableRate, gross_bps: null,
      fee_bps: this.fee(t) * 10_000, gas_usd: null, net_usd: null, hurdle_usd: null, decision, reason,
    };
  }

  /** Paused / gas too high: one row per token, at most once a minute (so the report shows WHY nothing traded). */
  private logBlocked(decision: 'paused' | 'gas', reason: string) {
    const last = this.lastBlockedLog.get(decision) ?? 0;
    if (Date.now() - last < 60_000) return;
    this.lastBlockedLog.set(decision, Date.now());
    this.flushRows(this.d.tokens.map((t) => this.blankRow(t, decision, reason)));
  }

  private flushRows(rows: OpportunityRow[]) {
    try {
      this.d.db.insertOpportunities(rows);
    } catch (e) {
      log.warn(`opportunity log: ${errMsg(e)}`);
    }
  }

  /** Gas units -> output-token base units, so BestOf can compare aggregators after gas. */
  /** Gas estimate in USD, including the OP-stack L1 data fee reserve (0 on Ethereum/Arbitrum). */
  private estGasUsd(units: bigint, gas: GasInfo, ethUsd: number): number {
    return gasUsd(units, gas.effective, ethUsd) + this.cfg.l1FeeUsd;
  }

  private gasValuer(gas: GasInfo, ethUsd: number, prices: Record<string, number>) {
    return (units: bigint, buyToken: string): bigint => {
      const usdCost = this.estGasUsd(units, gas, ethUsd);
      if (buyToken.toLowerCase() === this.cfg.usdc) return toUnits(usdCost / this.stableRate, this.stableDec);
      const t = this.d.tokens.find((x) => x.address === buyToken.toLowerCase());
      const px = t ? prices[t.base] : undefined;
      return t && px ? toUnits(usdCost / px, t.decimals) : 0n;
    };
  }

  // ---------- inventory (item 5) ----------
  /** Wallet share of a token's inventory (0..1), or null if there is none. */
  private walletShare(t: Token, bal: Balances, px: number, dWallet = 0, dMexc = 0): number | null {
    const w = Math.max(0, (bal.walletToken[t.base] ?? 0) * px + dWallet);
    const m = Math.max(0, (bal.mexc[t.base] ?? 0) * px + dMexc);
    return w + m > 0 ? w / (w + m) : null;
  }

  /**
   * Skewed hurdle: trades that push a token's inventory further from 50/50 wallet/MEXC need more profit,
   * trades that restore it need less (x0.8), never below the plain cost-and-safety hurdle's floor.
   */
  needFor(t: Token, direction: 'DEX_BUY' | 'CEX_BUY', sizeUsd: number, bal: Balances, px: number): number {
    const base = this.need(sizeUsd);
    if (!this.live) return base; // paper balances are synthetic
    const before = this.walletShare(t, bal, px);
    const after = direction === 'DEX_BUY' ? this.walletShare(t, bal, px, sizeUsd, -sizeUsd) : this.walletShare(t, bal, px, -sizeUsd, sizeUsd);
    if (before === null || after === null) return base;
    const worsening = Math.abs(after - 0.5) - Math.abs(before - 0.5);
    if (worsening > 0) return base * (1 + this.cfg.skewK * worsening);
    if (worsening < 0) return Math.max(base * 0.8, this.cfg.minProfitUsd * 0.8);
    return base;
  }

  /** An unresolved tx got its outcome: tell the human which tx won, and note it on the trade row. */
  private async reportResolved(
    p: { nonce: number; hashes: string[] },
    u: { executedHash?: string; ok?: boolean; dropped?: boolean },
  ) {
    const what = u.executedHash
      ? `${u.executedHash} was mined (${u.ok ? 'SUCCESS' : 'REVERTED'})${u.executedHash === p.hashes[0] ? ': the ORIGINAL tx executed' : ': the cancel won, the original did NOT execute'}`
      : u.dropped
        ? 'no RPC knows the tx any more: it was dropped and never executed'
        : 'the nonce was used, but no receipt was found for our hashes: check etherscan';
    await this.d.tg.send(`ℹ️ Nonce ${p.nonce} resolved: ${what}. You may now fix any position by hand, then /start confirm.`);
    const row = this.d.db.tradeByDexTx(p.hashes[0]);
    if (row) this.d.db.updateTrade(row.id, { note: `${row.note ?? ''}; dex resolved: ${what}` });
  }

  /**
   * Indicative opportunities in both directions for one token, at several sizes:
   * the base size first; if its gross gap reaches MULTISIZE_TRIGGER of the hurdle, also 0.5x and 2x
   * (within inventory and MAX_TRADE_USD). The best net per direction is returned. Every evaluation is
   * added to `rows` (the opportunities log).
   */
  async candidates(t: Token, b: Book, bal: Balances, gas: GasInfo, ethUsd: number, rows: OpportunityRow[] = []): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const bestBid = b.bids[0][0];
    const tokenUsd = mid(b);
    const cexTok = bal.mexc[t.base] ?? 0;
    const walTok = bal.walletToken[t.base] ?? 0;
    const base = this.cfg.baseTradeUsd > 0 ? this.cfg.baseTradeUsd : this.cfg.maxTradeUsd / 2;

    const capA = Math.min(this.cfg.maxTradeUsd, bal.walletUsdc * 0.99, cexTok * bestBid * 0.99);
    const capB = Math.min(this.cfg.maxTradeUsd, (bal.mexc.USDT ?? 0) * 0.99, walTok * bestBid * 0.99);

    for (const [dir, cap] of [['DEX_BUY', capA], ['CEX_BUY', capB]] as const) {
      if (cap < this.cfg.minTradeUsd) {
        rows.push(this.blankRow(t, 'inventory', `max size ${usd(cap)} < MIN_TRADE_USD (not enough ${dir === 'DEX_BUY' ? 'wallet stable / MEXC token' : 'MEXC USDT / wallet token'})`, dir));
        continue;
      }
      const sizes = [Math.max(this.cfg.minTradeUsd, Math.min(base, cap))];
      const results: Candidate[] = [];
      const first = await this.evalAt(t, b, bal, gas, ethUsd, dir, sizes[0], rows);
      if (first) results.push(first);
      // Multi-size: only worth the extra quotes when the base size is already close to the hurdle.
      if (first && first.opp.grossUsd >= this.cfg.multiSizeTrigger * (first.need ?? this.need(first.opp.sizeUsd))) {
        for (const k of [0.5, 2]) {
          const size = Math.floor(Math.min(sizes[0] * k, cap) * 100) / 100;
          if (size < this.cfg.minTradeUsd || sizes.includes(size)) continue;
          sizes.push(size);
          const c = await this.evalAt(t, b, bal, gas, ethUsd, dir, size, rows);
          if (c) results.push(c);
        }
      }
      if (results.length) out.push(results.reduce((x, y) => (y.opp.net > x.opp.net ? y : x)));
    }
    return out;
  }

  /** One direction at one size: DEX quote + MEXC book walk -> Candidate (or null), plus its opportunities row. */
  private async evalAt(
    t: Token,
    b: Book,
    bal: Balances,
    gas: GasInfo,
    ethUsd: number,
    dir: 'DEX_BUY' | 'CEX_BUY',
    size: number,
    rows: OpportunityRow[],
  ): Promise<Candidate | null> {
    const slippageBps = this.cfg.dexSlippageBps;
    const tokenUsd = mid(b);
    const row = this.blankRow(t, 'below_hurdle', null, dir);
    Object.assign(row, { size_usd: size, mexc_bid: b.bids[0][0], mexc_ask: b.asks[0][0], book_age_ms: Date.now() - b.ts });
    rows.push(row);

    let c: Candidate | null = null;
    if (dir === 'DEX_BUY') {
      // USDC -> token on DEX, token -> USDT on MEXC.
      const req = { sellToken: this.cfg.usdc, buyToken: t.address, sellAmount: toUnits(size, this.stableDec), taker: this.taker, slippageBps };
      const q = await this.d.agg.price(req);
      const spender = this.spenderOf(q);
      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
      const opp = evaluateDexBuy({
        sizeUsd: size,
        tokensOut: toFloat(q.buyAmount, t.decimals),
        tokensMin: toFloat(q.minBuyAmount, t.decimals),
        bids: b.bids,
        qtyStep: t.qtyStep,
        gasUsd: this.estGasUsd(q.gas + approvalGas, gas, ethUsd),
        costs: this.costs(t),
      });
      Object.assign(row, { aggregator: q.source ?? this.d.agg.name, dex_out: toFloat(q.buyAmount, t.decimals), dex_min_out: toFloat(q.minBuyAmount, t.decimals) });
      if (!opp) {
        row.decision = 'inventory';
        row.reason = 'MEXC book too thin for this size';
        return null;
      }
      const problem = orderProblem(t.rules, 'SELL', opp.cexQty, opp.cexLimitPrice);
      if (problem || opp.cexQty > (bal.mexc[t.base] ?? 0)) {
        row.decision = problem ? 'rule' : 'inventory';
        row.reason = problem ?? 'not enough token on MEXC';
        this.fillRow(row, opp, size);
        return null;
      }
      c = { token: t, opp, req, spender, approvalGas, tokenUsd };
    } else {
      // USDT -> token on MEXC, token -> USDC on DEX.
      const plan = planCexBuy({ sizeUsd: size, asks: b.asks, qtyStep: t.qtyStep, takerFee: this.fee(t) });
      if (!plan || plan.tokensToSell > (bal.walletToken[t.base] ?? 0)) {
        row.decision = 'inventory';
        row.reason = plan ? 'not enough token in the wallet' : 'MEXC book too thin for this size';
        return null;
      }
      const req = { sellToken: t.address, buyToken: this.cfg.usdc, sellAmount: toUnits(plan.tokensToSell, t.decimals), taker: this.taker, slippageBps };
      const q = await this.d.agg.price(req);
      const spender = this.spenderOf(q);
      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
      const opp = evaluateCexBuy({
        plan,
        usdcOut: toFloat(q.buyAmount, this.stableDec),
        usdcMin: toFloat(q.minBuyAmount, this.stableDec),
        gasUsd: this.estGasUsd(q.gas + approvalGas, gas, ethUsd),
        costs: this.costs(t),
      });
      Object.assign(row, { aggregator: q.source ?? this.d.agg.name, dex_out: toFloat(q.buyAmount, this.stableDec), dex_min_out: toFloat(q.minBuyAmount, this.stableDec) });
      const problem = orderProblem(t.rules, 'BUY', opp.cexQty, opp.cexLimitPrice);
      if (problem) {
        Object.assign(row, { decision: 'rule', reason: problem });
        this.fillRow(row, opp, size);
        return null;
      }
      c = { token: t, opp, req, spender, approvalGas, tokenUsd };
    }
    c.need = this.needFor(t, dir, size, bal, tokenUsd);
    c.row = row;
    this.fillRow(row, c.opp, size, c.need);
    return c;
  }

  private fillRow(row: OpportunityRow, opp: Opportunity, size: number, need?: number) {
    Object.assign(row, {
      gross_bps: (opp.grossUsd / size) * 10_000,
      gas_usd: opp.gasUsd,
      net_usd: opp.net,
      hurdle_usd: need ?? this.need(size),
    });
  }

  /** Hourly inventory snapshot + per-side warnings + rebalance tickets (live only). */
  private lastSnapshot = 0;
  private lowSince = new Map<string, number>();
  private inventoryHousekeeping(bal: Balances, prices: Record<string, number>) {
    if (!this.live) return;
    const now = Date.now();
    if (now - this.lastSnapshot > 3600_000) {
      this.lastSnapshot = now;
      try {
        this.d.db.insertInventorySnapshot(
          this.d.tokens.filter((t) => prices[t.base]).map((t) => ({
            ts: now,
            token: t.base,
            wallet_usd: (bal.walletToken[t.base] ?? 0) * prices[t.base],
            mexc_usd: (bal.mexc[t.base] ?? 0) * prices[t.base],
          })),
        );
      } catch (e) {
        log.warn(`inventory snapshot: ${errMsg(e)}`);
      }
    }
    const trade = this.cfg.baseTradeUsd > 0 ? this.cfg.baseTradeUsd : this.cfg.maxTradeUsd / 2;
    for (const w of inventoryPlan(bal, this.d.tokens, prices, {
      tradeUsd: trade,
      perSideX: this.cfg.inventoryPerSideX,
      maxTokenSharePct: this.cfg.maxTokenSharePct,
      stableInUsdt: this.stableRate,
      stableSymbol: this.cfg.chain.stable.symbol,
      walletAddress: this.d.chain.address,
    })) {
      if (w.kind === 'warning') {
        void this.alertThrottled(`invplan-${w.key}`, `📦 Inventory: ${w.text}`);
        continue;
      }
      // A side below 1x the trade size for REBALANCE_AFTER_MIN -> ONE ticket (the bot never moves funds).
      const key = `${w.token}:${w.side}`;
      if (!w.low) {
        this.lowSince.delete(key);
        this.d.db.closeTickets(w.token, w.side);
        continue;
      }
      const since = this.lowSince.get(key) ?? now;
      this.lowSince.set(key, since);
      const already = this.d.db.openTickets().some((x) => x.token === w.token && x.side === w.side);
      if (!already && now - since >= this.cfg.rebalanceAfterMin * 60_000) {
        this.d.db.openTicket({ token: w.token, side: w.side, asset: w.asset, amount: w.amount, direction: w.direction });
        void this.d.tg.send(`🎫 Rebalance ticket: ${w.direction}: ${w.amount.toFixed(4)} ${w.asset}. (${w.side} side of ${w.token} has been low for ${this.cfg.rebalanceAfterMin} min.) The bot never moves funds itself.`);
      }
    }
  }

  private spenderOf(q: Quote): string {
    if (q.spender) return q.spender;
    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
    throw new Error('aggregator did not return a spender');
  }

  /** Re-check with a firm quote + simulation, then trade both legs at once. */
  async execute(c: Candidate, gas: GasInfo, ethUsd: number): Promise<void> {
    const { token: t } = c;
    this.currentTradeId = null;
    if (!this.live) return this.recordPaper(c, gas, ethUsd);

    let approvalCostWei = 0n;
    const skip = async (why: string) => {
      log.info(`${t.base} skip: ${why}`);
      if (approvalCostWei > 0n) {
        // The approval gas was really spent; book it so PnL and the loss limit stay honest.
        const g = (Number(approvalCostWei) / 1e18) * ethUsd;
        this.record(c, 'approval', { pnl: -g, gas: g, note: `approval, then skipped: ${why}` });
      }
    };

    // 0) Worst case must fit in what is left of today's loss budget.
    const worst = (c.opp.sizeUsd * this.cfg.worstCaseLossPct) / 100 + c.opp.gasUsd;
    const budget = this.d.risk.remainingLossBudget();
    if (worst > budget) return skip(`worst case ${usd(worst)} > remaining daily loss budget ${usd(budget)}`);

    // Snapshot BEFORE the approval, so approval gas is part of the measured PnL.
    const before = await this.d.balances(true);

    // 1) Exact approval (never unlimited).
    if (c.approvalGas > 0n) {
      const r = await this.d.chain.approveExact(c.req.sellToken, c.spender, c.req.sellAmount, gas);
      approvalCostWei = r.gasCostWei;
      if (r.unknown) {
        const u = this.d.chain.unresolved;
        await skip('approval outcome unknown');
        await this.d.tg.send(
          `⚠️ ${t.base}: approval outcome UNKNOWN (nonce ${u?.nonce ?? '?'}, ${u?.hashes.join(', ') ?? r.hash}). No trade was made. ` +
            `New txs wait until it resolves; /cancelnonce replaces it.`,
        );
        return;
      }
      if (!r.ok) {
        await skip(`approval failed (${r.reason})`);
        await this.d.tg.send(`⚠️ Approval failed for ${t.base}: ${r.reason} ${r.hash ?? ''}`);
        return;
      }
    }

    // 2) Firm quote + simulation (eth_call). Abort on any doubt.
    let firm: Quote;
    let gasEst: bigint;
    const tQuote = Date.now();
    try {
      firm = await this.d.agg.quote(c.req);
      if (!firm.tx) return skip('firm quote has no transaction');
      gasEst = await this.d.chain.simulate(firm.tx);
    } catch (e) {
      return skip(`simulation/quote failed: ${errMsg(e)}`);
    }
    const tx = firm.tx;
    const quoteMs = Date.now() - tQuote;

    // 3) Re-evaluate with a fresh REST book, firm amounts and simulated gas.
    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
    const g = this.estGasUsd(gasEst, gas, ethUsd);
    let opp: Opportunity | null;
    if (c.opp.direction === 'DEX_BUY') {
      opp = evaluateDexBuy({
        sizeUsd: c.opp.sizeUsd,
        tokensOut: toFloat(firm.buyAmount, t.decimals),
        tokensMin: toFloat(firm.minBuyAmount, t.decimals),
        bids: b.bids,
        qtyStep: t.qtyStep,
        gasUsd: g,
        costs: this.costs(t),
      });
    } else {
      // Same quantity as quoted on the DEX, priced against the fresh MEXC book.
      const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.fee(t));
      opp = plan
        ? evaluateCexBuy({
            plan,
            usdcOut: toFloat(firm.buyAmount, this.stableDec),
            usdcMin: toFloat(firm.minBuyAmount, this.stableDec),
            gasUsd: g,
            costs: this.costs(t),
          })
        : null;
    }
    const need = c.need ?? this.need(c.opp.sizeUsd); // the inventory-skewed hurdle from the scan
    if (!opp || opp.net <= need) return skip(`profit fell to ${usd(opp?.net ?? 0)} after firm quote (need ${usd(need)})`);
    // MEXC symbol rules on the FINAL numbers, before anything is sent: a rejected MEXC leg after a sent DEX tx = one-sided.
    const side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
    const problem = orderProblem(t.rules, side, opp.cexQty, opp.cexLimitPrice) ?? bandProblem(t.rules, side, opp.cexLimitPrice, mid(b));
    if (problem) return skip(`MEXC would reject the order: ${problem}`);

    // The CEX leg must never fire if the DEX tx cannot get the next valid nonce.
    if (this.d.chain.readyToSend) {
      const ready = await this.d.chain.readyToSend();
      if (!ready.ok) return skip(`DEX side not ready to send: ${ready.reason}`);
    }

    // 4) Persist the trade as 'executing' BEFORE anything is sent: if the bot dies now, startup sees it.
    // The approval gas was already spent (and sits inside the balance-based PnL below), so the stored
    // expectation must not promise it back: expected = re-checked net minus approval gas actually paid.
    // (Round-3 review, L3: otherwise realized-minus-expected shows a drag equal to the approval gas.)
    const expectedNet = opp.net - (Number(approvalCostWei) / 1e18) * ethUsd;
    const cid = clientId('t');
    const tradeId = this.record({ ...c, opp: { ...opp, net: expectedNet } }, 'executing', { pnl: 0, gas: 0, orderId: cid, note: `client order id ${cid}` });
    this.currentTradeId = tradeId;
    this.d.db.appendCid(tradeId, cid);

    // Both legs are sent together. They do NOT complete together: the MEXC order fills in ~1.5s,
    // the DEX tx needs 12-60s to be mined. If the DEX side fails in between, step 5 unwinds on MEXC.
    log.info(`${t.base} EXECUTE ${opp.direction} size ${usd(opp.sizeUsd)} expected ${usd(opp.net)}`);
    const tLegs = Date.now();
    let signMs: number | null = null;
    const [cexR, dexR] = await Promise.allSettled([
      this.cexLeg(t, opp, cid),
      this.d.chain.send(tx, (gasEst * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash, nonce) => {
        signMs = Date.now() - tLegs;
        this.d.db.updateTrade(tradeId, { dex_tx: hash, note: `client order id ${cid}; nonce ${nonce}` });
      }),
    ]);

    const dex: TxResult = dexR.status === 'fulfilled' ? dexR.value : { ok: false, gasCostWei: 0n, reason: errMsg(dexR.reason) };
    let cexFilled = 0;
    let orderId: string | null = null;
    let cexUnknown = false;
    if (cexR.status === 'fulfilled') {
      cexFilled = cexR.value.filled;
      orderId = cexR.value.orderId;
    } else if (String((cexR.reason as Error)?.message ?? '').startsWith('UNKNOWN_ORDER_STATE')) {
      cexUnknown = true;
      this.d.risk.pause('MEXC order state unknown', true);
      await this.d.tg.send(`🚨 ${t.base}: MEXC order state unknown after placing. Trading PAUSED. Check MEXC manually.\n${errMsg(cexR.reason)}`);
    } else {
      log.warn(`${t.base} MEXC leg failed: ${errMsg(cexR.reason)}`);
    }

    // 5) One-sided? Close the open position at market right away.
    let status: TradeStatus = 'ok';
    const notes: string[] = [];
    if (!dex.ok) notes.push(`DEX: ${dex.reason}`);
    if (dex.unknown) {
      // We cannot tell if the swap executed. Unwinding could DOUBLE the position. Stop and ask a human.
      this.d.risk.pause(`DEX tx unknown ${dex.hash}`, true);
      await this.d.tg.send(
        `🚨 ${t.base}: DEX tx ${dex.hash} outcome UNKNOWN (not mined, cancel not confirmed). MEXC filled ${cexFilled}/${opp.cexQty}.\n` +
          `NOT unwinding automatically. Trading PAUSED.\nDo NOT hedge by hand until the nonce is consumed - the bot will alert you. (/cancelnonce replaces it.)`,
      );
    }
    const unwind = cexUnknown || dex.unknown ? null : unwindPlan(opp.direction, dex.ok, opp.cexQty, cexFilled, this.fee(t), t.qtyStep);
    if (cexUnknown || dex.unknown) {
      status = 'one_sided';
      notes.push('pnl unknown'); // the measured balance change may not include the final outcome yet
    } else if (unwind) {
      status = 'one_sided';
      const qty = unwind.qty.toFixed(decimalsOfStep(t.qtyStep));
      try {
        const r = await this.closeAtMarket(t, unwind.side, qty);
        if (r.dust) {
          notes.push(`unwind ${unwind.side} ${qty} not sent: ${r.dust}`);
          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base}: leftover ${unwind.side} ${qty} is below MEXC minimums (${r.dust}). Left as dust; fix inventory by hand.`);
        } else {
          notes.push(`unwind ${unwind.side} ${qty} (${r.orderId}, filled ${r.filled})`);
          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base} ${opp.direction}\n${unwind.reason}\nClosed: MEXC ${unwind.side} ${r.filled} ${t.base}`);
        }
      } catch (e) {
        const remaining = e instanceof PartialCloseError ? e.remaining : Number(qty);
        if (e instanceof OrderStillOpenError) notes.push(`close order ${e.orderId} may still be live on MEXC: cancel it by hand`);
        this.d.risk.pause(`unwind failed for ${t.base}`, true);
        notes.push(`UNWIND FAILED: ${errMsg(e)}`);
        await this.d.tg.send(
          `🚨 ONE-SIDED FILL ${t.base} and the market close FAILED: ${errMsg(e)}\n` +
            `Still open: MEXC ${unwind.side} ${remaining} ${t.base} needed.\nTrading PAUSED. Close it manually, then /start confirm.`,
        );
      }
    } else if (!dex.ok) {
      status = 'dex_failed'; // nothing filled on either side
    }

    // 6) Exact PnL = change in total value of everything the trade touched, at pre-trade prices.
    //    Orders are closed (filled/cancelled) by now; free + locked balances avoid counting held funds as lost.
    const { balances: after, stable } = await this.stableBalances(t, c.tokenUsd, ethUsd);
    if (!stable) notes.push('pnl approximate (balances still changing after 15 s)');
    const pnl = portfolioUsd(after, t, c.tokenUsd, ethUsd, this.stableRate) - portfolioUsd(before, t, c.tokenUsd, ethUsd, this.stableRate);
    const gasPaid = (Number(dex.gasCostWei + approvalCostWei) / 1e18) * ethUsd;
    this.d.db.updateTrade(tradeId, {
      status,
      pnl_usd: pnl,
      gas_usd: gasPaid,
      dex_tx: dex.hash ?? null,
      cex_order_id: orderId ?? cid,
      note: [`client order id ${cid}`, ...notes].join('; '),
    });

    const dexIsBuy = opp.direction === 'DEX_BUY';
    await this.d.tg.send(
      [
        `${status === 'ok' ? '✅' : '⚠️'} LIVE ${t.base} ${opp.direction} [${status}]`,
        `Buy  ${dexIsBuy ? 'DEX ' : 'MEXC'} @ ${opp.buyPrice.toPrecision(6)}`,
        `Sell ${dexIsBuy ? 'MEXC' : 'DEX '} @ ${opp.sellPrice.toPrecision(6)}`,
        `Qty ${opp.cexQty} ${t.base} | size ${usd(opp.sizeUsd)}`,
        `MEXC fee ${usd(opp.cexFeeUsd)} | Gas ${usd(gasPaid)}`,
        `Expected ${usd(expectedNet)} | Net PnL ${usd(pnl)}`,
        dex.hash ? explorerTxUrl(this.cfg.chain, dex.hash) : '',
        notes.length ? `Notes: ${notes.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    await this.recordLegs(tradeId, t, opp, firm, before, after, dex, cexR.status === 'fulfilled' ? cexR.value : null, {
      quoteMs,
      signMs,
    }).catch((e) => log.warn(`legs: ${errMsg(e)}`));
    this.currentTradeId = null;
    await this.handleRisk(this.d.risk.afterTrade(status));
  }

  /** Read balances until two reads in a row give the same value (settled), for at most ~15 s. */
  private async stableBalances(t: Token, tokenUsd: number, ethUsd: number): Promise<{ balances: Balances; stable: boolean }> {
    let prev = await this.d.balances(true);
    for (let i = 0; i < 6; i++) {
      await this.sleep(2500);
      const cur = await this.d.balances(true);
      if (Math.abs(portfolioUsd(cur, t, tokenUsd, ethUsd, this.stableRate) - portfolioUsd(prev, t, tokenUsd, ethUsd, this.stableRate)) < 1e-6) return { balances: cur, stable: true };
      prev = cur;
    }
    return { balances: prev, stable: false };
  }

  /**
   * Close a position on MEXC now with an aggressive LIMIT 2% through the book, for BOTH sides.
   * (No MEXC spot symbol offers IMMEDIATE_OR_CANCEL, and some have no MARKET; LIMIT works everywhere.)
   * Reads the order back and never assumes it filled. Below MEXC minimums -> returns `dust`, sends nothing.
   */
  async closeAtMarket(t: Token, side: Side, qty: string): Promise<{ orderId: string; filled: number; dust?: string }> {
    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
    // 2% through the book, but inside the symbol's PERCENT_PRICE_BY_SIDE band (some are 0.5% - 2%).
    const pxNum = closePrice({ ...t.rules, priceDecimals: t.priceDecimals }, side, { bid: b.bids[0][0], ask: b.asks[0][0] });
    const dust = orderProblem(t.rules, side, Number(qty), pxNum);
    if (dust) return { orderId: '', filled: 0, dust };
    const px = pxNum.toFixed(t.priceDecimals);
    const cid = clientId('c');
    if (this.currentTradeId !== null) this.d.db.appendCid(this.currentTradeId, cid); // before placing (crash safety)
    const { orderId } = await placeSafely(this.d.mexc, t.symbol, cid, () => this.d.mexc.limitOrder(t.symbol, side, qty, px, cid), this.sleep);
    await this.sleep(1500);
    let o = await this.d.mexc.getOrder(t.symbol, orderId);
    if (o.status !== 'FILLED') o = await cancelAndConfirm(this.d.mexc, t.symbol, orderId, this.sleep);
    const filled = Number(o.executedQty);
    if (filled < Number(qty) * 0.999) {
      const remaining = Number((Number(qty) - filled).toFixed(decimalsOfStep(t.qtyStep)));
      throw new PartialCloseError(`close ${side} only filled ${filled}/${qty}, ${remaining} remaining`, remaining);
    }
    return { orderId, filled };
  }

  /** MEXC marketable limit order; cancels any unfilled rest. Returns filled quantity. */
  async cexLeg(t: Token, opp: Opportunity, cid = clientId('t')): Promise<{ orderId: string; filled: number; ackMs: number }> {
    const side: Side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
    const qty = opp.cexQty.toFixed(decimalsOfStep(t.qtyStep));
    const f = 10 ** t.priceDecimals;
    const px = side === 'SELL' ? Math.floor(opp.cexLimitPrice * f) / f : Math.ceil(opp.cexLimitPrice * f) / f;
    const tPlace = Date.now();
    const { orderId } = await placeSafely(
      this.d.mexc,
      t.symbol,
      cid,
      () => this.d.mexc.limitOrder(t.symbol, side, qty, px.toFixed(t.priceDecimals), cid),
      this.sleep,
    );
    const ackMs = Date.now() - tPlace;
    log.info(`MEXC ${side} ${qty} ${t.symbol} @ ${px} id=${orderId}`);
    await this.sleep(1500);

    const read = async (): Promise<Order> => {
      for (let i = 0; i < 3; i++) {
        try {
          return await this.d.mexc.getOrder(t.symbol, orderId);
        } catch (e) {
          log.warn(`getOrder retry: ${errMsg(e)}`);
          await this.sleep(1000);
        }
      }
      throw new Error(`UNKNOWN_ORDER_STATE ${orderId}`);
    };
    let o = await read();
    if (o.status !== 'FILLED') {
      try {
        o = await cancelAndConfirm(this.d.mexc, t.symbol, orderId, this.sleep);
      } catch (e) {
        // The order may still fill later: its state is unknown, so no unwind may be based on it.
        if (e instanceof OrderStillOpenError) throw new Error(`UNKNOWN_ORDER_STATE ${e.message}`);
        throw e;
      }
    }
    return { orderId, filled: Number(o.executedQty), ackMs };
  }

  /**
   * Paper realism: wait PAPER_LATENCY_MS, re-quote the DEX and re-read the MEXC book, and book THAT net.
   * The first quote overstates profit (in live trading, prices move while both legs are sent).
   */
  private async recordPaper(c: Candidate, gas: GasInfo, ethUsd: number) {
    const { token: t, opp } = c;
    await this.sleep(this.cfg.paperLatencyMs);
    let requoted: number;
    try {
      requoted = (await this.requote(c, gas, ethUsd)) ?? -opp.gasUsd;
    } catch (e) {
      log.warn(`paper re-quote ${t.base}: ${errMsg(e)}`);
      requoted = -opp.gasUsd; // cannot re-quote: assume the worst sensible case (gas spent, nothing earned)
    }
    const id = this.record(c, 'paper', { pnl: requoted, gas: opp.gasUsd });
    this.d.db.updateTrade(id, { requoted_net: requoted });
    await this.d.tg.send(
      `📝 PAPER ${t.base} ${opp.direction}\nBuy @ ${opp.buyPrice.toPrecision(6)} | Sell @ ${opp.sellPrice.toPrecision(6)}\n` +
        `Qty ${opp.cexQty} | size ${usd(opp.sizeUsd)} | fee ${usd(opp.cexFeeUsd)} | gas ${usd(opp.gasUsd)}\n` +
        `Net ${usd(opp.net)} at first quote, ${usd(requoted)} after ${this.cfg.paperLatencyMs} ms re-quote (booked)`,
    );
    await this.handleRisk(this.d.risk.afterTrade('paper'));
  }

  /** Same trade, fresh prices: DEX re-quote + fresh MEXC book. Returns the new net (null if it no longer fills). */
  private async requote(c: Candidate, gas: GasInfo, ethUsd: number): Promise<number | null> {
    const t = c.token;
    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
    const q = await this.d.agg.price(c.req);
    const g = this.estGasUsd(q.gas + c.approvalGas, gas, ethUsd);
    if (c.opp.direction === 'DEX_BUY') {
      const o = evaluateDexBuy({
        sizeUsd: c.opp.sizeUsd,
        tokensOut: toFloat(q.buyAmount, t.decimals),
        tokensMin: toFloat(q.minBuyAmount, t.decimals),
        bids: b.bids,
        qtyStep: t.qtyStep,
        gasUsd: g,
        costs: this.costs(t),
      });
      return o?.net ?? null;
    }
    const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.fee(t));
    if (!plan) return null;
    return evaluateCexBuy({ plan, usdcOut: toFloat(q.buyAmount, this.stableDec), usdcMin: toFloat(q.minBuyAmount, this.stableDec), gasUsd: g, costs: this.costs(t) }).net;
  }

  /** One `legs` row per leg: quoted vs filled price, gas, MEXC fills and fee (myTrades), latency per stage. */
  private async recordLegs(
    tradeId: number,
    t: Token,
    opp: Opportunity,
    firm: Quote,
    before: Balances,
    after: Balances,
    dex: TxResult,
    cex: { orderId: string; filled: number; ackMs: number } | null,
    lat: { quoteMs: number; signMs: number | null },
  ) {
    const dexBuy = opp.direction === 'DEX_BUY';
    const tokDelta = (after.walletToken[t.base] ?? 0) - (before.walletToken[t.base] ?? 0);
    const stableDelta = (after.walletUsdc - before.walletUsdc) * this.stableRate;
    // DEX: buy = USDT-value spent per token received; sell = USDT-value received per token sold.
    const dexQuoted = dexBuy ? opp.buyPrice : opp.sellPrice;
    const dexFilled = dex.ok && tokDelta !== 0 ? Math.abs(stableDelta / tokDelta) : null;
    const slip = (q: number, f: number | null, buy: boolean) => (f === null || !q ? null : ((buy ? f - q : q - f) / q) * 10_000);
    this.d.db.insertLeg({
      trade_id: tradeId, leg: 'dex', quoted_price: dexQuoted, filled_price: dexFilled, slippage_bps: slip(dexQuoted, dexFilled, dexBuy),
      min_out: toFloat(firm.minBuyAmount, dexBuy ? t.decimals : this.stableDec), real_out: dexBuy ? tokDelta : after.walletUsdc - before.walletUsdc,
      gas_used: dex.gasUsed?.toString() ?? null, gas_price: dex.gasPrice?.toString() ?? null, l1_fee: dex.l1FeeWei?.toString() ?? null,
      executed_qty: null, avg_price: null, fee: null, fee_asset: null,
      latency_quote_ms: lat.quoteMs, latency_sign_ms: lat.signMs, latency_inclusion_ms: dex.inclusionMs ?? null, latency_mexc_ack_ms: null,
    });
    if (!cex) return;
    let qty = cex.filled;
    let avg: number | null = null;
    let fee: number | null = null;
    let feeAsset: string | null = null;
    if (this.d.mexc.myTrades && cex.filled > 0) {
      const fills = await this.d.mexc.myTrades(t.symbol, cex.orderId);
      qty = fills.reduce((a, f) => a + Number(f.qty), 0);
      const quote = fills.reduce((a, f) => a + Number(f.quoteQty), 0);
      avg = qty > 0 ? quote / qty : null;
      fee = fills.reduce((a, f) => a + Number(f.commission), 0);
      feeAsset = fills[0]?.commissionAsset ?? null;
    }
    const cexQuoted = dexBuy ? opp.sellPrice : opp.buyPrice;
    this.d.db.insertLeg({
      trade_id: tradeId, leg: 'mexc', quoted_price: cexQuoted, filled_price: avg, slippage_bps: slip(cexQuoted, avg, !dexBuy),
      min_out: null, real_out: null, gas_used: null, gas_price: null, l1_fee: null,
      executed_qty: qty, avg_price: avg, fee, fee_asset: feeAsset,
      latency_quote_ms: null, latency_sign_ms: null, latency_inclusion_ms: null, latency_mexc_ack_ms: cex.ackMs,
    });
  }

  private record(
    c: Candidate,
    status: TradeStatus,
    r: { pnl: number; gas: number; dexTx?: string; orderId?: string | null; note?: string | null },
  ): number {
    const now = Date.now();
    return this.d.db.insertTrade({
      ts: now,
      day: dhakaDay(now),
      mode: this.cfg.mode,
      symbol: c.token.base,
      direction: c.opp.direction,
      size_usd: c.opp.sizeUsd,
      qty: c.opp.cexQty,
      buy_price: c.opp.buyPrice,
      sell_price: c.opp.sellPrice,
      expected_net: c.opp.net,
      cex_fee_usd: status === 'approval' ? 0 : c.opp.cexFeeUsd,
      gas_usd: r.gas,
      pnl_usd: r.pnl,
      status,
      dex_tx: r.dexTx ?? null,
      cex_order_id: r.orderId ?? null,
      note: r.note ?? null,
    });
  }

  private async handleRisk(events: RiskEvent[]) {
    for (const e of events) {
      if (e.kind === 'loss_limit') await this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). Trading STOPPED. Send /start to resume.`);
      if (e.kind === 'fail_streak') await this.d.tg.send(`🛑 ${e.count} failed trades in a row. Trading PAUSED. Check logs, then /start.`);
      if (e.kind === 'trade_limit') await this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}). Resumes tomorrow (Dhaka time).`);
    }
  }
}
