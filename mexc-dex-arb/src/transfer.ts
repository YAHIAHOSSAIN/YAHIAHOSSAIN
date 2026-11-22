// TRANSFER strategy: scan all MEXC ERC20 tokens -> buy the one that is cheaper on MEXC ->
// withdraw it to the hot wallet -> sell it on an Ethereum DEX.
//
// Each cycle is a persisted state machine (buying -> withdrawing -> selling -> done),
// so a crash or pm2 restart continues where it stopped.
//
// Safety rules:
//  - Orders and withdrawals carry our own client id; an ambiguous request (timeout) is looked up,
//    never blindly repeated.
//  - A withdrawal is only ever sent to our own hot wallet, and never re-sent automatically.
//  - Failed DEX sales back off (2m, 10m, 30m) and then wait for a human (/sell <id>, /clear <id>).
//    The FIRST retry after a failed swap is fast (~25 s) while the fresh quote is still
//    profitable (Phase 7); a fresh quote at/below the loss floor holds instead, as before.
//  - If arrival-time price would lose more than TRANSFER_MAX_LOSS_PCT, the tokens are held (alert).
//  - An unknown on-chain outcome pauses trading instead of retrying.
import type { Config } from './config.js';
import { BestOf, ZEROX_ALLOWANCE_HOLDER, type Aggregator, type Quote } from './dex/aggregator.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Book, CoinConfig, DepositRecord, Order, SymbolInfo, WithdrawRecord } from './mexc/rest.js';
import { AmbiguousRequestError } from './mexc/rest.js';
import type { Db, OpportunityRow, TransferRow } from './db.js';
import type { Risk } from './risk.js';
import type { Notifier } from './engine.js';
import { RecycleEngine } from './recycle.js';
import { USDC_DECIMALS, cancelAndConfirm, clientId, placeSafely } from './engine.js';
import { closePrice, orderProblem, takerFeeFor } from './mexc/rules.js';
import { type Gap, type ScanToken, MAX_PINNED_WINNERS, dexPrices, findGaps, loadUniverse } from './scanner.js';
import { depthRejectReason, depthSafeSize, estimatedImpact, topDepthRejects, type DepthRejectDetail } from './dex/depth.js';
import { scanDexArb } from './dex/dexarb.js';
import type { Token } from './watchlist.js';
import { explorerTxUrl } from './chains.js';
import { evaluateTransfer, gasUsd, planCexBuy, threshold } from './pricing.js';
import { hurdleBps } from './config.js';
import { log, errMsg } from './log.js';
import { decimalsOfStep, dhakaDay, floorToStep, mapBatches, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

const APPROVE_GAS = 60_000n;
const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
const SELL_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000]; // after attempt 1, 2, 3; attempt 4 -> stuck
// Phase 7: fast retry after the FIRST failed swap only, while the fresh quote is still
// profitable (live ACN #3: first swap reverted, quote stayed profitable, +$15.79 after
// the 2-min wait). Later retries keep SELL_BACKOFF_MS. Hardcoded: no env knob.
const SELL_FAST_RETRY_MS = 25_000;
const MAX_SELL_ATTEMPTS = 4;
const FALSE_GAP_COOLDOWN_MS = 10 * 60_000;
// Phase 4: DEX-DEX detection scans at most this many tokens per tick (see
// scanDexArbTick): the live quote budget is 3–4 calls/s per aggregator, so a
// full-universe scan would burn it and warn per skipped token.
const DEX_ARB_TOKENS_PER_TICK = 5;

export interface TransferMexc {
  exchangeInfo(): Promise<SymbolInfo[]>;
  tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]>;
  coinConfigs(): Promise<CoinConfig[]>;
  bookTickers(): Promise<Map<string, { bid: number; ask: number }>>;
  depth(symbol: string, limit?: number): Promise<Book>;
  balances(): Promise<Record<string, number>>;
  limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
  cancelOrder(symbol: string, orderId: string): Promise<Order>;
  withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string>;
  findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null>;
  /** Phase 8 recycle: MEXC USDC deposit address (GET, else POST-generate) + deposit history for credit attribution. */
  depositAddress(coin: string, network: string): Promise<string | null>;
  depositHistory(coin: string, sinceTs: number): Promise<DepositRecord[]>;
  findDeposit(coin: string, sinceTs: number, txId: string): Promise<DepositRecord | null>;
}
export interface TransferChain {
  readonly address: string;
  gas(): Promise<GasInfo>;
  decimals(token: string): Promise<number>;
  tokenBalance(token: string): Promise<bigint>;
  /** Native balance (ETH/BNB) — Phase 8 gas-reserve sanity check before the USDC deposit send. */
  ethBalance(): Promise<bigint>;
  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
  send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
    onSigned?: (hash: string, nonce: number) => void,
  ): Promise<TxResult>;
  checkUnresolved?(): Promise<{ state: 'clear' | 'pending'; dropped?: boolean }>;
  receipt?(hash: string): Promise<{ status: number | null } | null>;
}

export interface TransferDeps {
  cfg: Config;
  mexc: TransferMexc;
  chain: TransferChain;
  agg: Aggregator;
  db: Db;
  risk: Risk;
  tg: Notifier;
  dexPricesFn?: typeof dexPrices;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Random source for the per-tick trade size (default Math.random; tests inject a fixed one). */
  rand?: () => number;
  /** DEX-stable decimals, read on-chain at startup (6 for USDC, 18 for BSC USDT). Falls back to 6. */
  stableDecimals?: number;
  // Live mode: restrict the universe to tokens proven profitable in paper
  // (same rule as the inventory live watchlist). When set, refreshUniverse
  // re-applies it on every rescan, so newly proven tokens join live.
  provenFilter?: (tokens: ScanToken[]) => ScanToken[];
}

interface Candidate {
  gap: Gap;
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  ev: ReturnType<typeof evaluateTransfer>;
  decimals: number;
  /** Winning aggregator for the candidate's DEX quote (q.source ?? agg name). */
  aggregator?: string;
}

const WITHDRAW_FAILED = new Set([8, 9]); // FAILED, CANCEL
const WITHDRAW_MANUAL = 10;
// Client order ids must be unique per chain: all three live twins share one
// MEXC account and their transfer ids each restart at 1, so a bare `arb{id}b`
// would collide — an ambiguous buy could adopt the other twin's order.
const buyCid = (chain: string, id: number) => `${chain}${id}b`;
const withdrawCid = (chain: string, id: number) => `${chain}${id}w`;

/** Random whole-dollar trade size in [minUsd, maxUsd] (owner decision 2026-11-22: random $100–500 per trade so thin DEX pools get a smaller size instead of always $500). Only the unknown-TVL fallback uses it now — known pools size from the depth ladder (see depthSizes). `rand` is injectable for tests. */
export function pickTradeSize(minUsd: number, maxUsd: number, rand: () => number = Math.random): number {
  if (maxUsd <= minUsd) return minUsd;
  return minUsd + Math.floor(rand() * (maxUsd - minUsd + 1));
}

/**
 * Phase 9: winners' gaps first, so a reappearing gap on a proven winner is
 * never starved by the exact-quote slice (`scanExactQuotes`) or the
 * aggregator quote budget. Each group keeps its gap-size order (the input
 * is already biggest-gap-first from findGaps): winners are prioritised,
 * never re-ranked against each other by PnL. A token with no winner entry
 * keeps its normal place behind every winner — priority only, never a gate.
 */
export function winnersFirst(gaps: Gap[], winners: Set<string>): Gap[] {
  if (!winners.size) return gaps;
  const w: Gap[] = [];
  const rest: Gap[] = [];
  for (const g of gaps) (winners.has(g.token.base) ? w : rest).push(g);
  return [...w, ...rest];
}

export class TransferEngine {
  universe: ScanToken[] = [];
  // Phase 9: profit-winners — tokens with positive booked net PnL in THIS
  // twin's own live trades (total > $0, min 1 trade), best PnL first, capped
  // at MAX_PINNED_WINNERS. Refreshed with the universe (every 10 min), so a
  // token stops being a winner as soon as its live total goes to/below $0.
  // Paper mode has no live trades, so its list is always empty.
  winners: { base: string; pnl: number; trades: number }[] = [];
  private winnerSet = new Set<string>();
  // True when the proven filter emptied a non-empty universe: live has nothing
  // proven yet, so the bot waits instead of failing startup.
  provenFilteredEmpty = false;
  private universeTs = 0;
  private lastNote = new Map<string, string>();
  private cooldown = new Map<string, number>(); // token -> skip exact quotes until
  private alerted = new Set<string>();
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private rand: () => number;
  /** Phase 8 USDC recycle loop (+ one-time catch-up sweep). */
  private recycle: RecycleEngine;
  lastGasGwei = 0;
  lastTopGaps: Gap[] = [];
  /** Phase 5: depth rejects this tick (thin pools dropped before any exact quote).
   * Reset at the start of every tick; the status server (Phase 6) can read it. */
  lastDepthRejects = 0;
  /** Phase 6: per-candidate reject detail for this tick (token/liq/impact/reason),
   * flushed as ONE summary row at the end of the tick (see flushDepthRejects). */
  private depthRejectDetails: DepthRejectDetail[] = [];
  /** Phase 4: DEX-DEX detection rotation — next universe index to scan from (see scanDexArbTick). */
  private dexArbCursor = 0;
  /** Phase 4: on-chain token decimals for the detection scan, cached per process (decimals never change). */
  private dexArbDecimals = new Map<string, number>();

  /** Record one depth rejection for this tick's summary row. */
  private noteDepthReject(token: string, size: number, liq: number, reason: string): void {
    this.depthRejectDetails.push({ token, liq_usd: liq, impact_pct: estimatedImpact(size, liq), reason });
  }

  /**
   * Phase 6: persist this tick's depth rejects as ONE summary row
   * (ts, chain, total, top-10 detail JSON). Zero-reject ticks write nothing,
   * so a quiet day costs no rows. Never throws — a failed write is logged
   * and the tick goes on.
   */
  flushDepthRejects(now = this.now()): void {
    if (this.lastDepthRejects === 0 || !this.depthRejectDetails.length) return;
    try {
      this.d.db.insertDepthRejects({
        ts: now,
        chain: this.cfg.chain.name,
        total: this.lastDepthRejects,
        detail: JSON.stringify(topDepthRejects(this.depthRejectDetails)),
      });
    } catch (e) {
      log.warn(`depth rejects record: ${errMsg(e)}`);
    }
  }

  /**
   * Phase 4: DEX-DEX detection only — the inventory engine's scanDexArbTick,
   * wired into the transfer tick (live bots run STRATEGY=transfer, so the
   * engine's copy never runs live). Detection only: never trades, sends,
   * approves or opens a position. Same ordering as the engine (after
   * candidate evaluation, before execute), same row fields and reason text.
   *
   * One deliberate difference from the engine: the engine scans its whole
   * watchlist every tick, but the live quote budget is 3–4 calls/s per
   * aggregator (Kyber 3 RPS) while a full universe scan needs 2 quotes per
   * token (~150 quotes on Ethereum). An unbounded scan would burn the
   * budget and log a QuoteBudgetError warning per skipped token, and the
   * same first few tokens would win the budget every tick. So each tick
   * scans a rotating window of DEX_ARB_TOKENS_PER_TICK TVL-known tokens
   * (decimals cached per process); the whole universe is covered over a
   * few minutes and the trading quotes keep priority (detection runs after
   * evaluation). A 'trade' decision here means "net beat the hurdle", not
   * "a trade was made".
   */
  private async scanDexArbTick(gas: GasInfo, nativeUsd: number, dex: Map<string, { price: number; tvl: number; vol24h: number }>): Promise<void> {
    const known = this.universe.filter((t) => (dex.get(t.address.toLowerCase())?.tvl ?? 0) > 0);
    if (!known.length) return;
    const window: ScanToken[] = [];
    for (let i = 0; i < DEX_ARB_TOKENS_PER_TICK && i < known.length; i++) {
      window.push(known[(this.dexArbCursor + i) % known.length]);
    }
    const tokens: Token[] = [];
    await Promise.all(window.map(async (t) => {
      let dec = this.dexArbDecimals.get(t.address);
      if (dec === undefined) {
        try {
          dec = await this.d.chain.decimals(t.address);
        } catch (e) {
          log.warn(`dex-arb ${t.base}: decimals lookup failed (${errMsg(e)})`);
          return;
        }
        this.dexArbDecimals.set(t.address, dec);
      }
      tokens.push({
        base: t.base, symbol: t.symbol, address: t.address, decimals: dec,
        qtyStep: t.qtyStep, priceDecimals: t.priceDecimals, rules: t.rules,
        dexTvlUsd: dex.get(t.address.toLowerCase())!.tvl, mexcVolumeUsd: t.volumeUsd,
        depositOk: true, withdrawOk: true,
      });
    }));
    // Advance by the tokens actually scanned, not the window size: if every
    // window token failed its decimals lookup, the cursor stays put and those
    // tokens are retried next tick instead of being skipped for a full
    // rotation. A partially failed window advances by its success count, so
    // a mid-window failure is retried after the rotation wraps (~3-5 min) —
    // advancing to the first failed token instead would pin the cursor
    // forever on a persistently failing token and re-price the same
    // successes every tick. Detection-only data, so the delay is negligible.
    this.dexArbCursor = (this.dexArbCursor + tokens.length) % known.length;
    if (!tokens.length) return;
    const opps = await scanDexArb(tokens, this.d.agg, gas, nativeUsd, {
      stableAddress: this.cfg.usdc,
      stableDecimals: this.stableDec(),
      taker: this.live ? this.d.chain.address : PAPER_TAKER,
      slippageBps: this.cfg.dexSlippageBps,
      minTradeUsd: this.cfg.minTradeUsd,
      maxTradeUsd: this.cfg.maxTradeUsd,
      hurdleUsd: (size) => threshold(size, this.cfg.minProfitUsd, hurdleBps(this.cfg)),
      stableInUsdt: this.stableRate,
      l1FeeUsd: this.cfg.l1FeeUsd,
      maxImpactPct: this.cfg.depthMaxImpactBps / 100,
      maxSizePct: this.cfg.depthMaxSizePct,
    });
    if (!opps.length) return;
    const now = this.now();
    const rows: OpportunityRow[] = [];
    for (const o of opps) {
      log.info(`DEX-ARB ${o.token}: buy ${usd(o.buyInUsd)} -> sell ${usd(o.sellOutUsd)}, net ${usd(o.netUsd)}`);
      const passes = o.netUsd > o.hurdleUsd;
      rows.push({
        ts: now, chain: this.cfg.chain.name, token: o.token, direction: 'DEX_ARB',
        size_usd: o.sizeUsd, mexc_bid: null, mexc_ask: null, book_age_ms: null,
        aggregator: o.buySource ?? this.d.agg.name,
        dex_out: o.tokensBought, dex_min_out: null, usdc_usdt: this.stableRate,
        gross_bps: ((o.sellOutUsd - o.buyInUsd) / o.sizeUsd) * 10_000,
        fee_bps: null, // no MEXC leg on a DEX-DEX row, so no taker fee (the
        // inventory engine's blankRow carries the taker fee instead).
        gas_usd: o.gasUsd, net_usd: o.netUsd, hurdle_usd: o.hurdleUsd,
        decision: passes ? 'trade' : 'below_hurdle',
        reason: passes
          ? 'dex-arb detection only — no execution'
          : `net ${o.netUsd.toFixed(4)} <= hurdle ${o.hurdleUsd.toFixed(4)} (dex-arb detection only — no execution)`,
      });
    }
    try {
      this.d.db.insertOpportunities(rows);
    } catch (e) {
      log.warn(`dex-arb record: ${errMsg(e)}`);
    }
  }

  /** Run the DEX-DEX detection scan when enabled (no-op otherwise). */
  private async maybeScanDexArb(gas: GasInfo, nativeUsd: number, dex: Map<string, { price: number; tvl: number; vol24h: number }>): Promise<void> {
    if (!this.cfg.dexArbEnabled) return;
    try {
      await this.scanDexArbTick(gas, nativeUsd, dex);
    } catch (e) {
      // Detection must never kill a trade tick: a scan bug costs at most the
      // DEX-ARB rows for this tick, never the transfer that follows it.
      log.warn(`dex-arb scan: ${errMsg(e)} (detection only — skipped this tick)`);
    }
  }

  constructor(private d: TransferDeps) {
    this.sleep = d.sleep ?? realSleep;
    this.now = d.now ?? Date.now;
    this.rand = d.rand ?? Math.random;
    this.recycle = new RecycleEngine({
      cfg: d.cfg, mexc: d.mexc, chain: d.chain, db: d.db, tg: d.tg,
      sleep: this.sleep, now: this.now, stableDecimals: d.stableDecimals,
    });
  }

  private get cfg() {
    return this.d.cfg;
  }
  private get live() {
    return this.cfg.mode === 'live';
  }
  /** DEX-stable decimals (6 for USDC, 18 for BSC USDT); read on-chain at startup, falls back to 6 (same pattern as the inventory engine). */
  private stableDec(): number {
    return this.d.stableDecimals ?? USDC_DECIMALS;
  }
  /** USDT per USDC, from MEXC USDCUSDT (refreshed every tick). */
  stableRate = 1;
  private fee(base: string) {
    return takerFeeFor(this.universe.find((t) => t.base === base)?.rules, this.cfg.mexcTakerFee);
  }
  private costs(base: string) {
    return {
      takerFee: this.fee(base),
      cexSlippageBps: this.cfg.cexSlippageBps,
      safetyMarginUsd: this.cfg.safetyMarginUsd,
      safetyMarginBps: this.cfg.safetyMarginBps,
      stableInUsdt: this.stableRate,
    };
  }
  private note(key: string, msg: string) {
    if (this.lastNote.get(key) !== msg) {
      this.lastNote.set(key, msg);
      log.info(msg);
    }
  }
  /** Telegram once per key (per process). */
  private async alertOnce(key: string, text: string) {
    if (this.alerted.has(key)) return;
    this.alerted.add(key);
    await this.d.tg.send(text);
  }
  private reload(row: TransferRow): TransferRow {
    return this.d.db.getTransfer(row.id!)!;
  }

  async refreshUniverse(force = false): Promise<void> {
    if (!force && this.now() - this.universeTs < 10 * 60_000) return;
    // Phase 9: winners come from this twin's OWN live trades (booked PnL in
    // the trades table — 'ok' sales + 'one_sided' failures, both measured).
    // Live-only, no paper seeding: paper PnL is a simulated estimate, never
    // measured from real balances, so it must not make a token a winner.
    const stats = this.d.db.liveTokenStats();
    this.winners = stats
      .filter((s) => s.pnl > 0)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, MAX_PINNED_WINNERS)
      .map((s) => ({ base: s.symbol, pnl: s.pnl, trades: s.trades }));
    this.winnerSet = new Set(this.winners.map((w) => w.base));
    const { tokens: all, dropped } = await loadUniverse(this.d.mexc, {
      minVolumeUsd: this.cfg.minMexcVolumeUsd,
      only: this.cfg.watchlist,
      minDexVolumeUsd: this.cfg.minDexVolumeUsd,
      minPoolLiquidityUsd: this.cfg.minPoolLiquidityUsd,
      max: this.cfg.transferUniverseMax,
      chain: this.cfg.chain,
      // Phase 9: winners below the volume cut are pinned into the universe
      // (loadUniverse still drops any winner that fails the safety filters).
      pin: this.winnerSet,
    }, this.d.dexPricesFn);
    // Grok v2 review / board audit M1: the pool-liquidity floor in
    // loadUniverse used to drop known-thin pools with only a log line, so
    // the dashboard Depth section stayed empty. Record every such drop
    // through the same noteDepthReject path the tick-level filter uses.
    // Size for the impact figure is MIN_TRADE_USD (the smallest trade we
    // would attempt); refreshUniverse runs before the USDT cap is known.
    for (const d of dropped) {
      this.lastDepthRejects++;
      this.noteDepthReject(d.base, this.cfg.minTradeUsd, d.tvl, d.reason);
      log.info(`${d.base}: depth reject — ${d.reason} (pool ${usd(d.tvl)}, universe-build)`);
    }
    // Flush HERE, not at the end of the tick: refreshUniverse also runs at
    // startup (runTransfer calls it before the tick loop), and every tick
    // resets these counters at its start — so a tick-end flush would lose
    // the drops entirely. A tick that returns early (no fresh gaps /
    // blocked / gas) never reaches its end-of-tick flush either. Reset
    // after flushing so the tick-end flush only covers the candidates
    // evaluated in this tick (no double count).
    if (dropped.length) {
      this.flushDepthRejects();
      this.lastDepthRejects = 0;
      this.depthRejectDetails = [];
    }
    this.universe = this.d.provenFilter ? this.d.provenFilter(all) : all;
    this.universeTs = this.now();
    this.provenFilteredEmpty = !!this.d.provenFilter && all.length > 0 && this.universe.length === 0;
    if (this.provenFilteredEmpty) this.note('proven-empty', 'live transfer: কোনো টোকেন এখনো paper-এ প্রমাণিত হয়নি — paper-এ লাভ করা টোকেন আসলেই scan শুরু হবে');
    if (this.winners.length) log.info(`profit winners (priority): ${this.winners.map((w) => `${w.base} +$${w.pnl.toFixed(2)} (${w.trades} trades)`).join(', ')}`);
    log.info(`scanner universe: ${this.universe.length} MEXC ERC20 tokens (MEXC vol >= $${this.cfg.minMexcVolumeUsd}, DEX 24h vol >= $${this.cfg.minDexVolumeUsd}, pool liquidity >= $${this.cfg.minPoolLiquidityUsd}${this.cfg.transferUniverseMax ? `, max ${this.cfg.transferUniverseMax}` : ''})${this.d.provenFilter ? ' [proven-only]' : ''}`);
  }

  /** One scan cycle. Always advances open transfers first. */
  /** USDT-balance cap on the trade size: floor(min(MAX_TRADE_USD, usdt * 0.99)). Null when even the minimum trade is unaffordable. */
  private usdtCap(usdt: number): number | null {
    const cap = Math.floor(Math.min(this.cfg.maxTradeUsd, usdt * 0.99));
    return cap < this.cfg.minTradeUsd ? null : cap;
  }

  /** Random whole-dollar trade size in [MIN_TRADE_USD, usdtCap] — since Phase 2 only the
   * fail-open fallback for a candidate whose pool TVL is unknown (known pools size from depth
   * instead, see depthSizes). Null when even the minimum trade is unaffordable. */
  private tradeSize(usdt: number): number | null {
    const cap = this.usdtCap(usdt);
    if (cap === null) return null;
    return pickTradeSize(this.cfg.minTradeUsd, cap, this.rand);
  }

  /**
   * Depth-derived size ladder for one candidate (Phase 2): 100% / 75% / 50% of the largest
   * depth-safe size, each floored to whole dollars, capped by the USDT balance, deduped,
   * largest first. Returns null when the token must be skipped: a known-thin pool (below
   * the liquidity floor) or a safe size below MIN_TRADE_USD. Unknown TVL (<= 0) is NOT
   * handled here — the caller uses the random fallback instead.
   *
   * No chain-specific impact ceiling: on Ethereum the small sizes are already hopeless
   * because the $4+ gas makes their net fail the hurdle, and the ceiling never binds the
   * size anyway — at the $150k pool floor the safe size is $525, above MAX_TRADE_USD
   * ($500 live), so a DEPTH_MAX_IMPACT_BPS_ETH knob would change nothing. If the floor
   * is ever lowered or MAX raised, revisit.
   */
  private depthSizes(g: Gap, cap: number): number[] | null {
    const liq = g.tvlUsd;
    const base = g.token.base;
    if (liq < this.cfg.minPoolLiquidityUsd) {
      this.lastDepthRejects++;
      const reason = `pool $${Math.round(liq / 1000)}k < $${Math.round(this.cfg.minPoolLiquidityUsd / 1000)}k`;
      this.noteDepthReject(base, cap, liq, reason);
      log.info(`${base}: depth reject — ${reason} (pool ${usd(liq)}, gap ${g.gapPct.toFixed(2)}%)`);
      return null;
    }
    const impactPct = this.cfg.depthMaxImpactBps / 100;
    const safe = depthSafeSize(liq, { maxImpactPct: impactPct, maxSizePct: this.cfg.depthMaxSizePct });
    // Float dust: 0.7% of a $10k pool computes as 34.999... not 35 — the
    // same 1e-9 slack depth.ts uses for boundary comparisons.
    const full = Math.floor(safe + 1e-9);
    if (full < this.cfg.minTradeUsd) {
      this.lastDepthRejects++;
      const reason = `depth size $${full} < MIN_TRADE_USD $${this.cfg.minTradeUsd}`;
      this.noteDepthReject(base, full, liq, reason);
      log.info(`${base}: depth size $${full} < MIN_TRADE_USD $${this.cfg.minTradeUsd} (pool ${usd(liq)}), skipping`);
      return null;
    }
    const sizes = [...new Set([1, 0.75, 0.5].map((f) => Math.min(Math.floor(safe * f + 1e-9), cap)).filter((s) => s >= this.cfg.minTradeUsd))];
    log.info(`${base}: depth size $${sizes[0]} (pool $${Math.round(liq / 1000)}k, impact ${impactPct.toFixed(2)}%)${sizes.length > 1 ? `; ladder ${sizes.map((s) => `$${s}`).join(' / ')}` : ''}`);
    return sizes;
  }

  /**
   * Evaluate one candidate at descending depth-derived sizes (Phase 2).
   * Quote-budget aware: the 100% size is tried first; when its net already passes the hurdle
   * it is taken at once (largest size = largest absolute profit) and no smaller size is
   * quoted. A smaller size is only tried when the larger one is below the hurdle but its
   * gross is close (the MULTISIZE_TRIGGER pattern from the inventory engine). Returns the
   * best-net candidate tried, or null when no size evaluated (MEXC book too thin for the
   * size / depth reject). Throws when the exact quote itself fails — the tick loop cools
   * the token down, as before.
   */
  private async evaluateSized(g: Gap, gas: GasInfo, nativeUsd: number, sizes: number[]): Promise<Candidate | null> {
    let best: Candidate | null = null;
    for (const size of sizes) {
      const c = await this.evaluate(g, gas, nativeUsd, size);
      if (!c) break; // MEXC book cannot fill this size (or depth reject): smaller sizes are out of scope here
      const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, hurdleBps(this.cfg));
      log.info(`${g.token.base}: gap ${g.gapPct.toFixed(2)}%, size ${usd(c.ev.costUsd)}, exact net ${usd(c.ev.net)} (need ${usd(need)})`);
      if (!best || c.ev.net > best.ev.net) best = c;
      if (c.ev.net > need) break; // passes: take the largest passing size, stop
      if (c.ev.grossUsd < this.cfg.multiSizeTrigger * need) break; // not close: smaller sizes only shrink the gross
    }
    return best;
  }

  async tick(): Promise<void> {
    this.lastDepthRejects = 0; // per-tick count, read by the status server (Phase 6)
    this.depthRejectDetails = [];
    const gas = await this.d.chain.gas();
    this.lastGasGwei = Number(gas.effective) / 1e9;
    const tickers = await this.d.mexc.bookTickers();
    // Gas is paid in the chain's native token: price it in that token (BSC
    // gas in BNB, not ETH — the old code overstated BSC gas ~3x).
    const native = tickers.get(this.cfg.chain.nativeMexcSymbol);
    if (!native) throw new Error(`no ${this.cfg.chain.nativeMexcSymbol} ticker`);
    const nativeUsd = (native.bid + native.ask) / 2;
    const st = tickers.get('USDCUSDT');
    const rate = st ? (st.bid + st.ask) / 2 : NaN;
    if (!(rate >= 0.99 && rate <= 1.01)) return this.note('stable', `no trading: USDC/USDT rate ${rate} unusable`);
    // The DEX stable IS USDT on BSC, so its USDT rate is exactly 1 (the
    // USDC/USDT peg above is only a sanity check there).
    this.stableRate = this.cfg.chain.stable.symbol === 'USDT' ? 1 : rate;

    // BestOf must compare quotes AFTER gas, like the inventory engine does (round-3, L7f).
    // The transfer's buy token is always the stable, so gas converts straight to stable units.
    if (this.d.agg instanceof BestOf) {
      const dec = await this.d.chain.decimals(this.cfg.usdc);
      this.d.agg.gasInOutput = (units) => toUnits(gasUsd(units, gas.effective, nativeUsd) / this.stableRate, dec);
    }

    // An earlier DEX tx with unknown outcome blocks every new send (same nonce rule as the inventory engine).
    let txBlocked = false;
    if (this.d.chain.checkUnresolved) {
      const u = await this.d.chain.checkUnresolved();
      if (u.dropped) await this.d.tg.send('ℹ️ An unresolved DEX tx was dropped by every RPC (never mined); its nonce is free again.');
      txBlocked = u.state === 'pending';
      if (txBlocked) await this.alertOnce('unresolved-tx', '⏳ An earlier DEX tx is still unresolved: no DEX sales or new trades until it is mined or dropped.');
      else this.alerted.delete('unresolved-tx');
    }

    for (const row of this.d.db.openTransfers()) {
      if (txBlocked && row.status === 'selling') continue; // would only be refused
      try {
        await this.advance(row, gas, nativeUsd);
      } catch (e) {
        log.error(`transfer #${row.id} ${row.base}: ${errMsg(e)}`);
      }
    }

    // Phase 8: recycle completed sells (done rows are not "open", so they are
    // picked up here — including after a restart) plus the one-time catch-up
    // sweep of USDC already sitting in the hot wallet.
    for (const done of this.d.db.transfersNeedingRecycle()) {
      try {
        await this.recycle.advanceTransfer(done, gas, nativeUsd);
      } catch (e) {
        log.warn(`transfer #${done.id} recycle: ${errMsg(e)} (retried next scan)`);
      }
    }
    try {
      await this.recycle.catchUp(gas, nativeUsd);
    } catch (e) {
      log.warn(`catch-up sweep: ${errMsg(e)} (retried next scan)`);
    }

    await this.refreshUniverse();
    const dex = await (this.d.dexPricesFn ?? dexPrices)(this.universe.map((t) => t.address));
    const now = this.now();
    let gaps = findGaps(this.universe, tickers, dex, {
      minTvlUsd: this.cfg.minDexTvlUsd,
      minGapPct: this.cfg.scanMinGapPct,
      maxGapPct: this.cfg.scanMaxGapPct,
    });
    // Phase 9: winners' gaps go first — the thin-book check below and the
    // exact-quote slice both take from the front of this list, so a
    // reappearing gap on a proven winner is never starved by the slice cap
    // or the quote budget. Priority only: unproven tokens still trade
    // normally whenever slots remain (no proven-only gate is re-added).
    gaps = winnersFirst(gaps, this.winnerSet);
    // Record the best rough gaps every tick (incl. below-threshold ones):
    // transfer mode used to keep them in memory only, so the best
    // sub-threshold gap was invisible and the dashboard gap chart had no
    // live data. Top 5 per 20s tick = ~21,600 rows/day, pruned by the
    // 7-day opportunity retention. Rough rows only: no exact quote was
    // taken, so net_usd/size_usd stay NULL and the KPI would-have PnL
    // (which needs a non-NULL net) ignores them.
    const allGaps = findGaps(this.universe, tickers, dex, {
      minTvlUsd: this.cfg.minDexTvlUsd,
      minGapPct: 0,
      maxGapPct: this.cfg.scanMaxGapPct,
    });
    // Thin-book pre-filter (2026-11-22): a rough gap means nothing if MEXC
    // cannot fill the trade size — FOLD showed 2.1% but its top-20 asks
    // totalled only $165.96 < $300, so planCexBuy always returned null and
    // evaluate() skipped it silently. Check depth for the few
    // above-threshold candidates only (scanExactQuotes); a failed depth
    // read is fail-open (the token stays a candidate and evaluate()
    // decides). Thin tokens are dropped from `gaps` (so the scan note and
    // the evaluate loop see no tradable gap) and recorded with decision
    // 'rule' / reason 'thin-book' instead of 'trade'.
    const thinBook = new Map<string, number>();
    if (gaps.length) {
      // Depth is checked against the smallest trade we would attempt (MIN_TRADE_USD):
      // a book that cannot fill $100 is hopeless at any size; a bigger roll is
      // decided by planCexBuy inside evaluate().
      const size = this.cfg.minTradeUsd;
      for (const g of gaps.slice(0, this.cfg.scanExactQuotes)) {
        try {
          const book = await this.d.mexc.depth(g.token.symbol, 20);
          const askValue = book.asks.reduce((s, [p, q]) => s + p * q, 0);
          if (askValue < size) {
            thinBook.set(g.token.base, askValue);
            log.info(`${g.token.base}: thin MEXC book — top-20 asks ${usd(askValue)} < trade size ${usd(size)}, skipping`);
          }
        } catch (e) {
          log.warn(`${g.token.base} depth check: ${errMsg(e)} (fail-open)`);
        }
      }
      gaps = gaps.filter((g) => !thinBook.has(g.token.base));
    }
    this.lastTopGaps = allGaps.slice(0, 5);
    this.recordGaps(allGaps.slice(0, 5), tickers, now, thinBook);
    this.note(
      'gaps',
      gaps.length
        ? `scan: ${gaps.length} gaps >= ${this.cfg.scanMinGapPct}%: ${gaps.slice(0, 5).map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ')}`
        : `scan: ${this.universe.length} tokens, no gap >= ${this.cfg.scanMinGapPct}%`,
    );

    const block = this.d.risk.blockReason();
    if (block) return this.note('block', `new trades blocked: ${block}`);
    this.note('block', 'new trades enabled');
    if (txBlocked) return;
    // The gas gate sits above every scan site (same order as the inventory
    // engine): a high-gas tick never spends quotes on detection, even while
    // a transfer is open.
    if (this.lastGasGwei > this.cfg.maxGasGwei) return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > ${this.cfg.maxGasGwei}, no new trades`);
    this.note('gas', 'gas ok');
    if (this.d.db.blockingTransfers().length >= this.cfg.maxOpenTransfers) {
      // An open transfer blocks NEW trades, but not DEX-DEX detection (the
      // inventory engine scans on every tick that passes its own
      // gas/unresolved gates, and detection never trades): scan, then wait.
      this.note('open', 'waiting for open transfer to finish');
      await this.maybeScanDexArb(gas, nativeUsd, dex);
      return;
    }
    this.note('open', 'no open transfer');

    // Skip tokens whose exact quote recently showed the gap was not real, so they cannot starve the rest.
    // Never two transfers of the same token at once (they would share one wallet balance), even after
    // an old one stopped blocking because of a long withdrawal.
    const busyTokens = new Set([...this.d.db.openTransfers(), ...this.d.db.stuckTransfers()].map((t) => t.base));
    const fresh = gaps.filter((g) => (this.cooldown.get(g.token.base) ?? 0) <= now && !busyTokens.has(g.token.base));
    if (!fresh.length) {
      // No CEX gap this tick — a DEX-DEX spread does not need one, so the
      // detection scan still runs (same as the inventory engine, which
      // scans on every tick that reaches it).
      await this.maybeScanDexArb(gas, nativeUsd, dex);
      return;
    }

    const usdt = this.live ? ((await this.d.mexc.balances()).USDT ?? 0) : 1e12;
    // Phase 2: no shared random size per tick — each candidate sizes from its own pool
    // depth (depthSizes + evaluateSized), capped by the USDT balance.
    const cap = this.usdtCap(usdt);
    if (cap === null) {
      this.note('usdt', `MEXC USDT too low for a trade (${usd(usdt)})`);
      // MEXC USDT funds the CEX leg only; DEX-DEX detection does not need
      // it, so the scan still runs.
      await this.maybeScanDexArb(gas, nativeUsd, dex);
      return;
    }
    // Phase 5: candidates are evaluated in parallel, bounded by the
    // aggregator's own quote budget (QUOTE_RPS_*): one in-flight quote per
    // rps token, so the parallel batch cannot burn the budget and trip
    // QuoteBudgetError on its own candidates. The per-candidate size ladder
    // stays sequential (each smaller size is only quoted when the larger one
    // is below the hurdle but close — see evaluateSized). Winner selection
    // is unchanged: the highest-net passing candidate wins, exactly one
    // transfer starts per tick, and a failing candidate cools down as before.
    const quoteConcurrency = Math.max(1, Math.min(this.cfg.scanExactQuotes, this.cfg.quoteRps[this.cfg.aggregator] ?? 1));
    const evaluated = await mapBatches(fresh.slice(0, this.cfg.scanExactQuotes), quoteConcurrency, async (g): Promise<Candidate | null> => {
      // Per-candidate sizing: a known pool gets its depth ladder; unknown TVL stays
      // fail-open with one random size (the old behaviour).
      let sizes: number[];
      if (g.tvlUsd > 0) {
        const ladder = this.depthSizes(g, cap);
        if (!ladder) return null; // thin pool / safe size below MIN: logged inside depthSizes
        sizes = ladder;
      } else {
        log.info(`${g.token.base}: depth-unknown (no pool TVL from DexScreener), allowing — the exact quote still gates the trade`);
        const size = this.tradeSize(usdt);
        if (size === null) return null; // unaffordable (cannot happen: cap was checked above)
        sizes = [size];
      }
      try {
        const c = await this.evaluateSized(g, gas, nativeUsd, sizes);
        if (!c) {
          this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
          return null;
        }
        const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, hurdleBps(this.cfg));
        if (c.ev.net <= need) {
          this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
          return null;
        }
        return c;
      } catch (e) {
        log.warn(`${g.token.base} evaluate: ${errMsg(e)}`);
        this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
        return null;
      }
    });
    let best: Candidate | null = null;
    for (const c of evaluated) {
      if (c && (!best || c.ev.net > best.ev.net)) best = c;
    }
    if (this.lastDepthRejects > 0) log.info(`depth rejects this tick: ${this.lastDepthRejects} (thin pools, no exact quote spent)`);
    this.flushDepthRejects(now);
    // Phase 4: DEX-DEX detection only (flag-gated, never trades) — same
    // ordering as the inventory engine: after candidate evaluation, before
    // execute.
    await this.maybeScanDexArb(gas, nativeUsd, dex);
    if (!best) return;
    if (!this.live) return this.recordPaper(best);
    await this.start(best, gas, nativeUsd);
  }

  /** Exact, size-specific numbers: MEXC depth walk + withdraw fee + aggregator quote + gas + drift reserve.
   * `size` is the tick's pre-rolled trade size (same size the depth filter used). */
  async evaluate(g: Gap, gas: GasInfo, nativeUsd: number, size: number): Promise<Candidate | null> {
    const t = g.token;
    // Depth re-check with the actual size, before spending an exact quote
    // (the tick filter already ran; this guards direct callers too).
    const reason = depthRejectReason(size, g.tvlUsd, {
      maxImpactPct: this.cfg.depthMaxImpactBps / 100,
      minLiqUsd: this.cfg.minPoolLiquidityUsd,
      maxSizePct: this.cfg.depthMaxSizePct,
    });
    if (reason) {
      this.lastDepthRejects++;
      this.noteDepthReject(t.base, size, g.tvlUsd, reason);
      log.info(`${t.base}: depth reject — ${reason} (size ${usd(size)}, pool ${usd(g.tvlUsd)})`);
      return null;
    }
    const book = await this.d.mexc.depth(t.symbol, 20);
    const plan = planCexBuy({ sizeUsd: size, asks: book.asks, qtyStep: t.qtyStep, takerFee: this.fee(t.base) });
    if (!plan || plan.tokensToSell < t.withdrawMin) return null;
    const arriving = plan.tokensToSell - t.withdrawFee;
    if (arriving <= 0) return null;
    const decimals = await this.d.chain.decimals(t.address);
    const q = await this.d.agg.price({
      sellToken: t.address,
      buyToken: this.cfg.usdc,
      sellAmount: toUnits(arriving, decimals),
      taker: this.live ? this.d.chain.address : PAPER_TAKER,
      slippageBps: this.cfg.dexSlippageBps,
    });
    const ev = evaluateTransfer({
      plan,
      withdrawFeeTokens: t.withdrawFee,
      usdcOut: toFloat(q.buyAmount, this.stableDec()),
      usdcMin: toFloat(q.minBuyAmount, this.stableDec()),
      gasUsd: gasUsd(q.gas + APPROVE_GAS, gas.effective, nativeUsd) + this.cfg.l1FeeUsd,
      driftBps: this.cfg.transferDriftBps,
      costs: this.costs(t.base),
    });
    return { gap: g, plan, ev, decimals, aggregator: q.source ?? this.d.agg.name };
  }

  /** Write the tick's best rough gaps to the opportunities table so the gap
   *  charts (dashboard + KPI) can see sub-threshold gaps. Rough rows only:
   *  no exact quote was taken, so net_usd/size_usd stay NULL and the KPI
   *  would-have PnL (which needs a non-NULL net) ignores them. A failed
   *  write must never kill the tick — it is logged and the tick goes on. */
  private recordGaps(gaps: Gap[], tickers: Map<string, { bid: number; ask: number }>, now: number, thinBook: Map<string, number> = new Map()): void {
    if (!gaps.length) return;
    try {
      this.d.db.insertOpportunities(
        gaps.map((g) => {
          const t = tickers.get(g.token.symbol);
          const thin = thinBook.has(g.token.base);
          return {
            ts: now,
            chain: this.cfg.chain.name,
            token: g.token.base,
            direction: 'CEX_BUY',
            size_usd: null,
            mexc_bid: t?.bid ?? null,
            mexc_ask: g.ask,
            book_age_ms: null,
            aggregator: 'dexscreener',
            dex_out: g.dexPrice,
            dex_min_out: null,
            usdc_usdt: this.stableRate,
            gross_bps: Math.round(g.gapPct * 100),
            fee_bps: null,
            gas_usd: null,
            net_usd: null,
            hurdle_usd: null,
            // A thin-book gap cleared the rough threshold but MEXC cannot
            // fill the trade size, so it is not a trade candidate: decision
            // 'rule' keeps it out of the dashboard's best-gap displays
            // (which only count below_hurdle/trade) while the row still
            // shows the gap existed.
            decision: thin ? 'rule' : g.gapPct >= this.cfg.scanMinGapPct ? 'trade' : 'below_hurdle',
            reason: thin ? 'thin-book' : 'transfer-scan',
          };
        }),
      );
    } catch (e) {
      log.warn(`gap record: ${errMsg(e)}`);
    }
  }

  private async recordPaper(c: Candidate) {
    const t = c.gap.token;
    const now = this.now();
    const tvl = c.gap.tvlUsd > 0 ? c.gap.tvlUsd : null;
    this.d.db.insertTrade({
      ts: now, day: dhakaDay(now), mode: 'paper', symbol: t.base, direction: 'TRANSFER',
      size_usd: c.ev.costUsd, qty: c.plan.qty, buy_price: c.ev.buyPrice, sell_price: c.ev.sellPrice,
      expected_net: c.ev.net, cex_fee_usd: c.ev.cexFeeUsd + c.ev.withdrawFeeUsd, gas_usd: c.ev.gasUsd,
      pnl_usd: c.ev.net, status: 'paper', dex_tx: null, cex_order_id: null, note: `gap ${c.gap.gapPct.toFixed(2)}%`,
      aggregator: c.aggregator ?? null,
      pool_tvl_usd: tvl,
      safe_size_usd: tvl === null ? null : depthSafeSize(tvl, { maxImpactPct: this.cfg.depthMaxImpactBps / 100, maxSizePct: this.cfg.depthMaxSizePct }),
    });
    await this.d.tg.send(
      `📝 PAPER TRANSFER ${t.base}: buy MEXC @ ${c.ev.buyPrice.toPrecision(6)} -> sell DEX @ ${c.ev.sellPrice.toPrecision(6)}\n` +
        `Size ${usd(c.ev.costUsd)} | fees ${usd(c.ev.cexFeeUsd + c.ev.withdrawFeeUsd)} | gas ${usd(c.ev.gasUsd)} | drift reserve ${usd(c.ev.driftUsd)}\nNet ${usd(c.ev.net)}`,
    );
    this.d.risk.afterTrade('paper');
    this.cooldown.set(t.base, this.now() + FALSE_GAP_COOLDOWN_MS); // one paper trade per gap
  }

  /** Create the persisted transfer and run its first steps right away. */
  private async start(c: Candidate, gas: GasInfo, nativeUsd: number) {
    const t = c.gap.token;
    const now = this.now();
    const id = this.d.db.insertTransfer({
      ts: now, updated: now, base: t.base, symbol: t.symbol, address: t.address, decimals: c.decimals,
      net_work: t.netWork, qty_step: t.qtyStep, price_decimals: t.priceDecimals, status: 'buying',
      buy_qty: c.plan.qty, cost_usd: c.ev.costUsd, buy_order_id: null, withdraw_amount: null, withdraw_id: null,
      wallet_before: null, received: null, usdc_out: null, gas_usd: 0, expected_net: c.ev.net, pnl: null,
      sell_attempts: 0, alerted_timeout: 0, note: null, withdraw_fee: t.withdrawFee, next_try: 0, force_sell: 0, hold_alerted: 0, sell_tx: null,
      // Phase 8 recycle (fresh transfer: nothing recycled yet).
      recycle_status: null, recycle_held: 0, recycled_usdc: null, recycled_usdt: null, recycle_address: null, recycle_tx: null,
      recycle_order_id: null, recycle_note: null, recycle_deadline: 0, recycle_mexc_before: null, recycle_usdt_before: null,
    });
    log.info(`transfer #${id} ${t.base}: START gap ${c.gap.gapPct.toFixed(2)}% expected ${usd(c.ev.net)}`);
    const row = this.d.db.getTransfer(id)!;
    try {
      await this.buy(row, c.plan.worst * (1 + this.cfg.cexSlippageBps / 10_000));
    } catch (e) {
      if (String((e as Error).message).startsWith('UNKNOWN_ORDER_STATE')) {
        this.d.risk.pause(`MEXC buy state unknown for transfer #${id}`, true);
        await this.d.tg.send(`🚨 TRANSFER #${id} ${t.base}: MEXC buy state unknown (${errMsg(e)}). Trading PAUSED; the bot keeps looking for the order.`);
        return;
      }
      const now2 = this.reload(row);
      if (now2.buy_order_id) {
        log.warn(`transfer #${id}: error after the buy was placed (${errMsg(e)}); continuing next scan`);
        return;
      }
      return this.fail(now2, `MEXC buy rejected: ${errMsg(e)}`, 0, false);
    }
    const next = this.d.db.getTransfer(id)!;
    if (next.status === 'withdrawing') await this.advance(next, gas, nativeUsd);
  }

  /** Move one transfer forward as far as it can go right now. */
  async advance(row: TransferRow, gas: GasInfo, nativeUsd: number): Promise<void> {
    if (row.status === 'buying') {
      if (!row.buy_order_id) {
        // Crashed or timed out while placing: find the order by our client id, never guess.
        const o = await this.d.mexc.getOrderByClientId(row.symbol, buyCid(this.cfg.chain.name, row.id!));
        if (!o) return this.fail(row, 'MEXC buy was never placed', 0, false);
        this.d.db.updateTransfer(row.id!, { buy_order_id: o.orderId });
        row = this.reload(row);
      }
      await this.finishBuy(row);
      row = this.reload(row);
      if (row.status !== 'withdrawing') return;
    }
    if (row.status === 'withdrawing') await this.withdrawStep(row, gas, nativeUsd);
    else if (row.status === 'selling') await this.sellStep(row, gas, nativeUsd);
    // Phase 8: a sell that just completed (here, or via withdrawStep's arrival
    // path above) starts its recycle in the same scan; a restart resumes it
    // from the tick loop's transfersNeedingRecycle() instead.
    const done = this.reload(row);
    if (done.status === 'done') {
      try {
        await this.recycle.advanceTransfer(done, gas, nativeUsd);
      } catch (e) {
        log.warn(`transfer #${row.id} recycle: ${errMsg(e)} (retried next scan)`);
      }
    }
  }

  private async buy(row: TransferRow, limitPrice: number) {
    const f = 10 ** row.price_decimals;
    const px = (Math.ceil(limitPrice * f) / f).toFixed(row.price_decimals);
    const qty = row.buy_qty.toFixed(decimalsOfStep(row.qty_step));
    const cid = buyCid(this.cfg.chain.name, row.id!);
    const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, () => this.d.mexc.limitOrder(row.symbol, 'BUY', qty, px, cid), this.sleep);
    this.d.db.updateTransfer(row.id!, { buy_order_id: orderId });
    log.info(`transfer #${row.id} MEXC BUY ${qty} ${row.base} @ ${px} id=${orderId}`);
    await this.sleep(1500);
    await this.finishBuy(this.reload(row));
  }

  private async finishBuy(row: TransferRow) {
    let o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
    if (o.status !== 'FILLED') {
      try {
        o = await cancelAndConfirm(this.d.mexc, row.symbol, row.buy_order_id!, this.sleep);
      } catch (e) {
        log.warn(`transfer #${row.id}: ${errMsg(e)}; checking again next scan`);
        return; // still 'buying': the order is re-read next tick, never assumed
      }
    }
    const filled = Number(o.executedQty);
    const cost = Number(o.cummulativeQuoteQty);
    if (filled <= 0) return this.fail(row, 'MEXC buy did not fill (price moved)', 0, false);
    this.d.db.updateTransfer(row.id!, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
  }

  private async withdrawStep(row: TransferRow, gas: GasInfo, nativeUsd: number) {
    const since = row.ts - 60_000;

    if (!row.withdraw_id) {
      if (row.withdraw_amount) {
        // A request was sent before but its result was lost (timeout / restart). Look it up; NEVER resend.
        const rec = await this.d.mexc.findWithdraw(row.base, since, { withdrawOrderId: withdrawCid(this.cfg.chain.name, row.id!) });
        if (rec) {
          this.d.db.updateTransfer(row.id!, { withdraw_id: rec.id });
          return;
        }
        if (this.now() - row.updated > 10 * 60_000) {
          this.d.db.updateTransfer(row.id!, { status: 'stuck', note: 'withdraw request outcome unknown' });
          await this.d.tg.send(
            `🚨 TRANSFER #${row.id} ${row.base}: withdraw request was sent but MEXC shows no record after 10 min.\n` +
              `Check MEXC withdraw history. If nothing went out: /sell ${row.id} is NOT right (tokens are on MEXC), sell them on MEXC by hand, then /clear ${row.id}.`,
          );
        }
        return;
      }

      const free = (await this.d.mexc.balances())[row.base] ?? 0;
      const amount = floorToStep(Math.min(free, row.buy_qty * (1 - this.fee(row.base))), row.qty_step);
      const amountStr = amount.toFixed(decimalsOfStep(row.qty_step));
      const min = this.universe.find((t) => t.base === row.base)?.withdrawMin ?? 0;
      if (amount <= 0 || amount < min) {
        const proceeds = amount > 0 ? await this.sellOnMexc(row, amountStr) : 0;
        return this.fail(row, `amount ${amountStr} below MEXC withdraw minimum ${min}; sold back on MEXC`, proceeds - row.cost_usd);
      }
      const before = await this.d.chain.tokenBalance(row.address);
      // Persist BEFORE sending, so a crash during the request can never cause a second withdrawal.
      this.d.db.updateTransfer(row.id!, { withdraw_amount: amountStr, wallet_before: before.toString() });
      try {
        const id = await this.d.mexc.withdraw({
          coin: row.base,
          netWork: row.net_work,
          address: this.d.chain.address, // ONLY ever our own hot wallet
          amount: amountStr,
          contractAddress: row.address,
          withdrawOrderId: withdrawCid(this.cfg.chain.name, row.id!),
        });
        this.d.db.updateTransfer(row.id!, { withdraw_id: id });
        await this.d.tg.send(`📤 TRANSFER #${row.id} ${row.base}: bought ${row.buy_qty} on MEXC for ${usd(row.cost_usd)}, withdrawing ${amountStr} to wallet`);
      } catch (e) {
        if (e instanceof AmbiguousRequestError) {
          log.warn(`transfer #${row.id} withdraw request ambiguous, will look it up: ${errMsg(e)}`);
          return; // next tick: findWithdraw by withdrawOrderId
        }
        // Clearly rejected: nothing left MEXC. Close the position there instead.
        this.d.db.updateTransfer(row.id!, { withdraw_amount: null });
        const proceeds = await this.sellOnMexc(row, amountStr);
        return this.fail(this.reload(row), `withdraw rejected: ${errMsg(e)}; sold back on MEXC`, proceeds - row.cost_usd);
      }
      return;
    }

    const rec = await this.d.mexc.findWithdraw(row.base, since, { id: row.withdraw_id, withdrawOrderId: withdrawCid(this.cfg.chain.name, row.id!) }).catch(() => undefined);
    const bal = await this.d.chain.tokenBalance(row.address);
    const diff = bal - BigInt(row.wallet_before ?? '0');
    // Fee actually charged by MEXC (history) beats the configured one.
    const fee = rec?.transactionFee !== undefined && rec.transactionFee !== '' ? Number(rec.transactionFee) : row.withdraw_fee;
    const expected = toUnits(Math.max(0, Number(row.withdraw_amount) - fee), row.decimals);

    // Arrival needs BOTH: MEXC says SUCCESS and the wallet grew by (almost) the expected amount.
    // A balance change alone could be an unrelated deposit / airdrop.
    if (rec?.status === 7 && diff > 0n && diff * 100n < expected * 98n) {
      await this.alertOnce(
        `wshort-${row.id}`,
        `⚠️ TRANSFER #${row.id} ${row.base}: MEXC says SUCCESS but the wallet only grew by ${toFloat(diff, row.decimals)} (expected ~${toFloat(expected, row.decimals)}). Waiting; check the wallet.`,
      );
    }
    if (rec?.status === 7 && diff > 0n && diff * 100n >= expected * 98n) {
      // Sell what was withdrawn, never more (extra balance may belong to something else).
      const received = diff > (expected * 102n) / 100n ? expected : diff;
      this.d.db.updateTransfer(row.id!, { status: 'selling', received: received.toString() });
      log.info(`transfer #${row.id} ${row.base}: ${toFloat(received, row.decimals)} arrived in wallet`);
      return this.sellStep(this.reload(row), gas, nativeUsd);
    }
    if (rec && WITHDRAW_FAILED.has(rec.status) && diff <= 0n) {
      // Funds go back to the MEXC account; sell there once they are visible.
      const free = (await this.d.mexc.balances())[row.base] ?? 0;
      if (free < Number(row.withdraw_amount) * 0.99) {
        return this.alertOnce(`wfail-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: MEXC withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}; waiting for the tokens to return to MEXC`);
      }
      await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}, selling back on MEXC`);
      // Sell what is actually free on MEXC, never more than was withdrawn.
      const qty = floorToStep(Math.min(free, Number(row.withdraw_amount)), row.qty_step).toFixed(decimalsOfStep(row.qty_step));
      const proceeds = await this.sellOnMexc(row, qty);
      return this.fail(row, `withdraw status ${rec.status}`, proceeds - row.cost_usd);
    }
    if (rec?.status === WITHDRAW_MANUAL) {
      await this.alertOnce(`wmanual-${row.id}`, `⏳ TRANSFER #${row.id} ${row.base}: MEXC put the withdrawal under MANUAL review. Waiting.`);
    }
    if (rec === null) {
      await this.alertOnce(`wmissing-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${row.withdraw_id} not found in MEXC history. Still watching the wallet.`);
    }

    const ageMin = (this.now() - row.ts) / 60_000;
    if (ageMin > this.cfg.transferTimeoutMin && row.alerted_timeout < 1) {
      this.d.db.updateTransfer(row.id!, { alerted_timeout: 1 });
      await this.d.tg.send(
        `⏳ TRANSFER #${row.id} ${row.base}: not in wallet after ${Math.round(ageMin)} min (MEXC status ${rec?.status ?? '?'}). Still waiting.`,
      );
    } else if (ageMin > 2 * this.cfg.transferTimeoutMin && row.alerted_timeout < 2) {
      // Give up blocking: new trades may start, this one is still watched every scan (read-only, no gas).
      this.d.db.updateTransfer(row.id!, { alerted_timeout: 2 });
      await this.d.tg.send(
        `⏳ TRANSFER #${row.id} ${row.base}: still not in wallet after ${Math.round(ageMin)} min. It no longer blocks new trades; ` +
          `the bot keeps watching and sells when it arrives. Check MEXC support if it stays missing.`,
      );
    }
  }

  /**
   * Loss floor: if the DEX would pay less than cost minus TRANSFER_MAX_LOSS_PCT, hold the tokens
   * (alert once) instead of locking in a big loss. Returns true when held.
   * Called on the first quote AND on the firm quote after the approval, because the price may
   * have moved during the approval window (round-3 review, M3).
   */
  private async holdIfBelowFloor(row: TransferRow, minBuyAmount: bigint, qty: number): Promise<boolean> {
    const worstOut = toFloat(minBuyAmount, this.stableDec()) * this.stableRate; // in USDT, like the cost
    const floor = row.cost_usd * (1 - this.cfg.transferMaxLossPct / 100);
    if (worstOut >= floor && row.hold_alerted) this.d.db.updateTransfer(row.id!, { hold_alerted: 0 }); // recovered: alert again if it falls
    if (worstOut < floor && !row.force_sell) {
      this.d.db.updateTransfer(row.id!, { next_try: this.now() + 5 * 60_000 });
      if (!row.hold_alerted) {
        this.d.db.updateTransfer(row.id!, { hold_alerted: 1 });
        await this.d.tg.send(
          `✋ TRANSFER #${row.id} ${row.base}: DEX would pay only ${usd(worstOut)} for tokens that cost ${usd(row.cost_usd)} ` +
            `(more than ${this.cfg.transferMaxLossPct}% loss). HOLDING ${qty} ${row.base} in the wallet and re-checking every 5 min.\n` +
            `Send /sell ${row.id} to sell anyway.`,
        );
      }
      return true;
    }
    return false;
  }

  private async sellStep(row: TransferRow, gas: GasInfo, nativeUsd: number) {
    if (row.next_try > this.now()) return;
    if (Number(gas.effective) / 1e9 > this.cfg.maxGasGwei) return this.note(`sell-${row.id}`, `transfer #${row.id}: gas too high, sale waits`);

    // Crash safety: a sale tx was signed before (hash persisted). Did it already execute?
    if (row.sell_tx && this.d.chain.receipt) {
      const rc = await this.d.chain.receipt(row.sell_tx).catch(() => null);
      if (rc?.status === 1) {
        this.d.db.updateTransfer(row.id!, { status: 'done', note: 'sale completed before a restart; PnL not measured' });
        this.recordTrade(row, 'ok', 0, row.gas_usd, row.sell_tx, 'sale completed before a restart; PnL not measured');
        await this.d.tg.send(`✅ TRANSFER #${row.id} ${row.base}: the DEX sale ${row.sell_tx} had already executed before the restart. Marked done (PnL not measured).`);
        return;
      }
    }
    // Never sell more than is really in the wallet now.
    const balance = await this.d.chain.tokenBalance(row.address);
    const amount = balance < BigInt(row.received!) ? balance : BigInt(row.received!);
    if (amount * 100n < BigInt(row.received!)) {
      this.d.db.updateTransfer(row.id!, { status: 'stuck', note: 'tokens no longer in the wallet' });
      await this.d.tg.send(
        `🚨 TRANSFER #${row.id} ${row.base}: the tokens are no longer in the wallet (sold before a restart, or moved). Check ${this.cfg.chain.explorer}, then /clear ${row.id}.`,
      );
      return;
    }
    const qty = toFloat(amount, row.decimals);
    const req = { sellToken: row.address, buyToken: this.cfg.usdc, sellAmount: amount, taker: this.d.chain.address, slippageBps: this.cfg.dexSlippageBps };
    let gasWei = 0n;
    let txHash: string | undefined;
    try {
      const first = await this.d.agg.quote(req);
      if (await this.holdIfBelowFloor(row, first.minBuyAmount, qty)) return;

      const ap = await this.d.chain.approveExact(row.address, this.spenderOf(first), amount, gas);
      gasWei += ap.gasCostWei;
      if (ap.unknown) return this.unknownOutcome(row, `approval ${ap.hash}`, gasWei, nativeUsd);
      if (!ap.ok) throw new Error(`approval failed: ${ap.reason}`);
      const firm = await this.d.agg.quote(req); // fresh after the approval
      if (!firm.tx) throw new Error('quote without transaction');
      // The price may have moved during the approval (up to ~60 s on mainnet): re-check the floor
      // on the FIRM quote before sending, or the loss floor does not protect the actual sale (round-3, M3).
      if (await this.holdIfBelowFloor(row, firm.minBuyAmount, qty)) {
        // The approval gas was really spent; book it so the row's gas stays honest.
        this.d.db.updateTransfer(row.id!, { gas_usd: row.gas_usd + (Number(gasWei) / 1e18) * nativeUsd });
        return;
      }
      const est = await this.d.chain.simulate(firm.tx);
      const usdcBefore = await this.d.chain.tokenBalance(this.cfg.usdc);
      const r = await this.d.chain.send(firm.tx, (est * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash) =>
        this.d.db.updateTransfer(row.id!, { sell_tx: hash }),
      );
      if (r.refused) return; // an earlier tx is unresolved: not an attempt, try again later
      gasWei += r.gasCostWei;
      txHash = r.hash;
      if (r.unknown) return this.unknownOutcome(row, `swap ${r.hash}`, gasWei, nativeUsd);
      if (!r.ok) throw new Error(`swap ${r.reason}`);
      const usdcOut = toFloat((await this.d.chain.tokenBalance(this.cfg.usdc)) - usdcBefore, this.stableDec()) * this.stableRate; // USDT
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * nativeUsd;
      const pnl = usdcOut - row.cost_usd - gasTotal;
      this.d.db.updateTransfer(row.id!, { status: 'done', usdc_out: usdcOut, gas_usd: gasTotal, pnl });
      this.recordTrade(row, 'ok', pnl, gasTotal, txHash, `sold ${qty} for ${usd(usdcOut)}`, usdcOut / qty, firm.source ?? this.d.agg.name);
      await this.d.tg.send(
        [
          `${pnl >= 0 ? '✅' : '🔻'} TRANSFER #${row.id} ${row.base} done`,
          `Buy MEXC: ${row.buy_qty} for ${usd(row.cost_usd)} (@ ${(row.cost_usd / row.buy_qty).toPrecision(6)})`,
          `Sell DEX: ${qty} for ${usd(usdcOut)} (@ ${(usdcOut / qty).toPrecision(6)})`,
          `Withdraw fee ${row.withdraw_fee} ${row.base} | Gas ${usd(gasTotal)}`,
          `Expected ${usd(row.expected_net)} | Net PnL ${usd(pnl)}`,
          explorerTxUrl(this.cfg.chain, txHash!),
        ].join('\n'),
      );
      this.afterRisk('ok');
    } catch (e) {
      const attempts = row.sell_attempts + 1;
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * nativeUsd;
      const stuck = attempts >= MAX_SELL_ATTEMPTS;
      let wait = SELL_BACKOFF_MS[Math.min(attempts - 1, SELL_BACKOFF_MS.length - 1)];
      let fastRetry = false;
      let held = false;
      // Phase 7: before the long backoff, take a fresh quote (same BestOf path as the sell
      // quote). Still profitable -> retry FAST, first retry only. At/below the loss floor
      // -> the existing hold path (holdIfBelowFloor sets next_try +5 min and alerts; the
      // update below must not overwrite it). Fresh quote itself failing -> existing
      // backoff, never a fast-retry spin on quote errors.
      if (!stuck && attempts === 1) {
        try {
          const fresh = await this.d.agg.quote(req);
          if (await this.holdIfBelowFloor(row, fresh.minBuyAmount, qty)) {
            held = true;
          } else {
            wait = SELL_FAST_RETRY_MS;
            fastRetry = true;
          }
        } catch (qe) {
          log.warn(`transfer #${row.id} ${row.base}: fresh quote after the failed sell also failed (${errMsg(qe)}); keeping the ${wait / 60_000}-min backoff`);
        }
      }
      this.d.db.updateTransfer(row.id!, {
        sell_attempts: attempts,
        gas_usd: gasTotal,
        status: stuck ? 'stuck' : 'selling',
        ...(held ? {} : { next_try: this.now() + wait }),
        note: errMsg(e),
      });
      log.warn(
        `transfer #${row.id} ${row.base} sell attempt ${attempts} failed: ${errMsg(e)}` +
          (stuck ? '' : held ? '; below the loss floor, holding (re-check in 5 min)' : fastRetry ? `; quote still profitable, fast retry in ${SELL_FAST_RETRY_MS / 1000} s` : `; retry in ${wait / 60_000} min`),
      );
      if (stuck) {
        await this.d.tg.send(
          `🚨 TRANSFER #${row.id} ${row.base}: DEX sale failed ${attempts} times (${errMsg(e)}). Automatic retries STOPPED.\n` +
            `${qty} ${row.base} are in the hot wallet. Send /sell ${row.id} to try again, or sell by hand and send /clear ${row.id}.`,
        );
        this.afterRisk('one_sided');
      }
    }
  }

  /** On-chain outcome unknown: do not retry (could double-sell). Pause and hand over to a human. */
  private async unknownOutcome(row: TransferRow, what: string, gasWei: bigint, nativeUsd: number) {
    this.d.db.updateTransfer(row.id!, {
      status: 'stuck',
      gas_usd: row.gas_usd + (Number(gasWei) / 1e18) * nativeUsd,
      note: `${what} outcome unknown`,
    });
    this.d.risk.pause(`transfer #${row.id}: ${what} outcome unknown`, true);
    await this.d.tg.send(
      `🚨 TRANSFER #${row.id} ${row.base}: ${what} was not mined and its cancel was not confirmed. Outcome UNKNOWN.\n` +
        `Trading PAUSED. Check the wallet on ${this.cfg.chain.explorer}. Then /sell ${row.id} (if the tokens are still there) or /clear ${row.id}, and /start.`,
    );
  }

  private spenderOf(q: Quote): string {
    if (q.spender) return q.spender;
    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
    throw new Error('aggregator did not return a spender');
  }

  /**
   * Market-sell on MEXC; returns the net USDT received.
   * MEXC's docs do not say whether the fee is inside cummulativeQuoteQty, so we measure the
   * real USDT balance change instead of assuming.
   */
  private async sellOnMexc(row: TransferRow, qty: string): Promise<number> {
    const rules = this.universe.find((t) => t.base === row.base)?.rules;
    const px = row.cost_usd / (row.buy_qty || 1);
    // Some symbols have no MARKET order type: use an aggressive LIMIT inside the price band instead.
    const useLimit = Boolean(rules && !rules.orderTypes.includes('MARKET'));
    const problem = rules && orderProblem(rules, 'SELL', Number(qty), px, useLimit ? 'LIMIT' : 'MARKET');
    if (problem) {
      this.d.risk.pause(`cannot sell ${row.base} on MEXC: ${problem}`, true);
      await this.d.tg.send(`🚨 ${row.base}: cannot market-sell ${qty} on MEXC (${problem}). Trading PAUSED: sell it by hand, then /start confirm.`);
      return 0;
    }
    try {
      const usdtBefore = (await this.d.mexc.balances()).USDT ?? 0;
      const cid = clientId(`${row.id}s`);
      let place = () => this.d.mexc.marketSell(row.symbol, qty, cid);
      if (useLimit && rules) {
        const b = await this.d.mexc.depth(row.symbol, 5);
        const limit = closePrice(rules, 'SELL', { bid: b.bids[0][0], ask: b.asks[0][0] }).toFixed(rules.priceDecimals);
        place = () => this.d.mexc.limitOrder(row.symbol, 'SELL', qty, limit, cid);
      }
      const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, place, this.sleep);
      await this.sleep(1000);
      let o = await this.d.mexc.getOrder(row.symbol, orderId);
      if (o.status !== 'FILLED') o = await cancelAndConfirm(this.d.mexc, row.symbol, orderId, this.sleep);
      const filled = Number(o.executedQty);
      if (filled < Number(qty) * 0.999) {
        this.d.risk.pause(`MEXC sell of ${row.base} only partly filled`, true);
        await this.d.tg.send(
          `🚨 ${row.base}: MEXC market sell filled only ${filled}/${qty}. The rest is still on MEXC. Trading PAUSED: sell it by hand, then /start.`,
        );
      }
      await this.sleep(1500);
      const received = ((await this.d.mexc.balances()).USDT ?? 0) - usdtBefore;
      // Fallback only if the balance read is clearly off (e.g. a concurrent deposit/withdrawal).
      return received > 0 ? received : Number(o.cummulativeQuoteQty) * (1 - this.fee(row.base));
    } catch (e) {
      this.d.risk.pause(`could not close ${row.base} on MEXC`, true);
      await this.d.tg.send(`🚨 ${row.base}: MEXC market sell of ${qty} FAILED (${errMsg(e)}). Trading PAUSED. Close it manually, then /start.`);
      return 0;
    }
  }

  private async fail(row: TransferRow, why: string, pnl: number, countAsFailure = true) {
    this.d.db.updateTransfer(row.id!, { status: 'failed', pnl, note: why });
    log.warn(`transfer #${row.id} ${row.base} failed: ${why}`);
    if (!countAsFailure) return; // e.g. buy simply did not fill: no money moved
    this.recordTrade(row, 'one_sided', pnl, row.gas_usd, undefined, why);
    await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base} failed: ${why}\nPnL ${usd(pnl)}`);
    this.afterRisk('one_sided');
  }

  /** Telegram /recycle <id>: resume a held Phase 8 recycle on the next scan. */
  retryRecycle(id: number): string {
    return this.recycle.retryTransfer(id);
  }

  /** Telegram /recycle catchup: resume a held catch-up sweep on the next scan. */
  retryCatchUp(): string {
    return this.recycle.retryCatchUp();
  }

  /** Telegram /sell <id>: retry a stuck or held sale now (even below the loss floor). */
  forceSell(id: number): string {
    const t = this.d.db.getTransfer(id);
    if (!t) return `No transfer #${id}`;
    if (!t.received) return `Transfer #${id} has no tokens in the wallet yet (status ${t.status})`;
    if (t.status !== 'stuck' && t.status !== 'selling') return `Transfer #${id} is ${t.status}`;
    this.d.db.updateTransfer(id, { status: 'selling', force_sell: 1, next_try: 0, sell_attempts: 0 });
    return `Transfer #${id}: selling on the next scan (loss floor ignored).`;
  }

  /** Telegram /clear <id>: you resolved it by hand; close the record. */
  clear(id: number): string {
    const t = this.d.db.getTransfer(id);
    if (!t) return `No transfer #${id}`;
    if (t.status === 'done' || t.status === 'failed') return `Transfer #${id} is already ${t.status}`;
    this.d.db.updateTransfer(id, { status: 'failed', note: 'cleared manually via /clear' });
    // Gas already burned on this transfer is a real cost: book it so the daily loss limit sees it.
    if (t.gas_usd > 0) this.recordTrade(t, 'one_sided', -t.gas_usd, t.gas_usd, undefined, 'cleared manually; gas spent');
    return `Transfer #${id} closed manually. Gas spent (${usd(t.gas_usd)}) is booked; the token result is not, check balances yourself.`;
  }

  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0, aggregator: string | null = null) {
    const now = this.now();
    const buyPrice = row.cost_usd / (row.buy_qty || 1);
    this.d.db.insertTrade({
      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: buyPrice, sell_price: sellPrice, expected_net: row.expected_net,
      // informational only: PnL is measured from real balances and already includes every fee
      cex_fee_usd: row.cost_usd * this.fee(row.base) + row.withdraw_fee * buyPrice,
      gas_usd: gas, pnl_usd: pnl, status, dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
      // Live transfer rows carry no pool TVL (the transfer row never stored
      // it): pool_tvl_usd / safe_size_usd stay NULL, the size column is
      // still the depth-derived size used (see the dashboard label).
      aggregator,
    });
  }

  private afterRisk(status: 'ok' | 'one_sided') {
    for (const e of this.d.risk.afterTrade(status)) {
      if (e.kind === 'loss_limit') void this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). New trades STOPPED. Send /start to resume.`);
      if (e.kind === 'fail_streak') void this.d.tg.send(`🛑 ${e.count} failed trades in a row. New trades PAUSED. /start to resume.`);
      if (e.kind === 'trade_limit') void this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}).`);
    }
  }
}
