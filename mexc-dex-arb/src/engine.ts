// The trading loop: find the best opportunity each block, confirm it, trade both legs, clean up, account.
import type { Config } from './config.js';
import type { Aggregator, Quote, QuoteRequest } from './dex/aggregator.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Book, Order, Side } from './mexc/rest.js';
import type { Db, TradeStatus } from './db.js';
import type { Risk, RiskEvent } from './risk.js';
import type { Token } from './watchlist.js';
import { type Balances, inventoryWarnings, portfolioUsd } from './inventory.js';
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
import { decimalsOfStep, dhakaDay, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

export const USDC_DECIMALS = 6;
export const ZEROX_ALLOWANCE_HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';
const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';

// Narrow interfaces so tests can plug in fakes.
export interface CexApi {
  limitOrder(symbol: string, side: Side, quantity: string, price: string): Promise<{ orderId: string }>;
  marketSell(symbol: string, quantity: string): Promise<{ orderId: string }>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<Order>;
}
export interface ChainApi {
  readonly address: string;
  gas(): Promise<GasInfo>;
  approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint>;
  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
  send(tx: { to: string; data: string; value?: bigint }, gasLimit: bigint, gas: GasInfo, timeoutSec: number): Promise<TxResult>;
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
  balances: () => Promise<Balances>;
  tokens: Token[];
  sleep?: (ms: number) => Promise<void>;
}

export interface Candidate {
  token: Token;
  opp: Opportunity;
  req: QuoteRequest;
  spender: string;
  approvalGas: bigint;
  tokenUsd: number;
}

const mid = (b: Book) => (b.bids[0][0] + b.asks[0][0]) / 2;

export class Engine {
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
  private costs() {
    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
  }
  private need(sizeUsd: number) {
    return threshold(sizeUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
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
    if (block) return this.note('block', `trading blocked: ${block}`);
    this.note('block', 'trading enabled');

    const gas = await this.d.chain.gas();
    this.lastGasGwei = Number(gas.effective) / 1e9;
    if (this.lastGasGwei > this.cfg.maxGasGwei) {
      return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > MAX_GAS_GWEI ${this.cfg.maxGasGwei}, waiting`);
    }
    this.note('gas', 'gas ok');

    const ethUsd = mid(await this.d.book('ETHUSDT'));
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
        for (const c of await this.candidates(t, b, bal, gas, ethUsd)) {
          log.info(`${t.base} ${c.opp.direction} size ${usd(c.opp.sizeUsd)} net ${usd(c.opp.net)} (need ${usd(this.need(c.opp.sizeUsd))})`);
          if (c.opp.net > this.need(c.opp.sizeUsd) && (!best || c.opp.net > best.opp.net)) best = c;
        }
      } catch (e) {
        log.warn(`${t.base} quote: ${errMsg(e)}`);
      }
    }
    if (best) await this.execute(best, gas, ethUsd);
  }

  /** Indicative opportunities in both directions for one token. */
  async candidates(t: Token, b: Book, bal: Balances, gas: GasInfo, ethUsd: number): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const bestBid = b.bids[0][0];
    const tokenUsd = mid(b);
    const cexTok = bal.mexc[t.base] ?? 0;
    const walTok = bal.walletToken[t.base] ?? 0;
    const slippageBps = this.cfg.dexSlippageBps;

    // DEX_BUY: USDC -> token on DEX, token -> USDT on MEXC.
    const sizeA = Math.floor(Math.min(this.cfg.maxTradeUsd, bal.walletUsdc * 0.99, cexTok * bestBid * 0.99) * 100) / 100;
    if (sizeA >= this.cfg.minTradeUsd) {
      const req = { sellToken: this.cfg.usdc, buyToken: t.address, sellAmount: toUnits(sizeA, USDC_DECIMALS), taker: this.taker, slippageBps };
      const q = await this.d.agg.price(req);
      const spender = this.spenderOf(q);
      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
      const opp = evaluateDexBuy({
        sizeUsd: sizeA,
        tokensOut: toFloat(q.buyAmount, t.decimals),
        tokensMin: toFloat(q.minBuyAmount, t.decimals),
        bids: b.bids,
        qtyStep: t.qtyStep,
        gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
        costs: this.costs(),
      });
      if (opp && opp.cexQty <= cexTok) out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
    }

    // CEX_BUY: USDT -> token on MEXC, token -> USDC on DEX.
    const sizeB = Math.min(this.cfg.maxTradeUsd, (bal.mexc.USDT ?? 0) * 0.99, walTok * bestBid * 0.99);
    if (sizeB >= this.cfg.minTradeUsd) {
      const plan = planCexBuy({ sizeUsd: sizeB, asks: b.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
      if (plan && plan.tokensToSell <= walTok) {
        const req = { sellToken: t.address, buyToken: this.cfg.usdc, sellAmount: toUnits(plan.tokensToSell, t.decimals), taker: this.taker, slippageBps };
        const q = await this.d.agg.price(req);
        const spender = this.spenderOf(q);
        const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
        const opp = evaluateCexBuy({
          plan,
          usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
          usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
          gasUsd: gasUsd(q.gas + approvalGas, gas.effective, ethUsd),
          costs: this.costs(),
        });
        out.push({ token: t, opp, req, spender, approvalGas, tokenUsd });
      }
    }
    return out;
  }

  private spenderOf(q: Quote): string {
    if (q.spender) return q.spender;
    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
    throw new Error('aggregator did not return a spender');
  }

  /** Re-check with a firm quote + simulation, then trade both legs at once. */
  async execute(c: Candidate, gas: GasInfo, ethUsd: number): Promise<void> {
    const { token: t } = c;
    if (!this.live) return this.recordPaper(c);

    let approvalCostWei = 0n;
    const skip = async (why: string) => {
      log.info(`${t.base} skip: ${why}`);
      if (approvalCostWei > 0n) {
        // The approval gas was really spent; book it so PnL and the loss limit stay honest.
        const g = (Number(approvalCostWei) / 1e18) * ethUsd;
        this.record(c, 'approval', { pnl: -g, gas: g, note: `approval, then skipped: ${why}` });
      }
    };

    // 1) Exact approval (never unlimited).
    if (c.approvalGas > 0n) {
      const r = await this.d.chain.approveExact(c.req.sellToken, c.spender, c.req.sellAmount, gas);
      approvalCostWei = r.gasCostWei;
      if (!r.ok) {
        await skip(`approval failed (${r.reason})`);
        await this.d.tg.send(`⚠️ Approval failed for ${t.base}: ${r.reason} ${r.hash ?? ''}`);
        return;
      }
    }

    // 2) Firm quote + simulation (eth_call). Abort on any doubt.
    let firm: Quote;
    let gasEst: bigint;
    try {
      firm = await this.d.agg.quote(c.req);
      if (!firm.tx) return skip('firm quote has no transaction');
      gasEst = await this.d.chain.simulate(firm.tx);
    } catch (e) {
      return skip(`simulation/quote failed: ${errMsg(e)}`);
    }
    const tx = firm.tx;

    // 3) Re-evaluate with fresh book, firm amounts and simulated gas.
    const b = await this.d.book(t.symbol);
    const g = gasUsd(gasEst, gas.effective, ethUsd);
    let opp: Opportunity | null;
    if (c.opp.direction === 'DEX_BUY') {
      opp = evaluateDexBuy({
        sizeUsd: c.opp.sizeUsd,
        tokensOut: toFloat(firm.buyAmount, t.decimals),
        tokensMin: toFloat(firm.minBuyAmount, t.decimals),
        bids: b.bids,
        qtyStep: t.qtyStep,
        gasUsd: g,
        costs: this.costs(),
      });
    } else {
      // Same quantity as quoted on the DEX, priced against the fresh MEXC book.
      const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.cfg.mexcTakerFee);
      opp = plan
        ? evaluateCexBuy({
            plan,
            usdcOut: toFloat(firm.buyAmount, USDC_DECIMALS),
            usdcMin: toFloat(firm.minBuyAmount, USDC_DECIMALS),
            gasUsd: g,
            costs: this.costs(),
          })
        : null;
    }
    const need = this.need(c.opp.sizeUsd);
    if (!opp || opp.net <= need) return skip(`profit fell to ${usd(opp?.net ?? 0)} after firm quote (need ${usd(need)})`);

    // 4) Both legs at the same time.
    const before = await this.d.balances();
    log.info(`${t.base} EXECUTE ${opp.direction} size ${usd(opp.sizeUsd)} expected ${usd(opp.net)}`);
    const [cexR, dexR] = await Promise.allSettled([
      this.cexLeg(t, opp),
      this.d.chain.send(tx, (gasEst * 13n) / 10n, gas, this.cfg.txTimeoutSec),
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
      this.d.risk.pause('MEXC order state unknown');
      await this.d.tg.send(`🚨 ${t.base}: MEXC order state unknown after placing. Trading PAUSED. Check MEXC manually.\n${errMsg(cexR.reason)}`);
    } else {
      log.warn(`${t.base} MEXC leg failed: ${errMsg(cexR.reason)}`);
    }

    // 5) One-sided? Close the open position at market right away.
    let status: TradeStatus = 'ok';
    const notes: string[] = [];
    if (!dex.ok) notes.push(`DEX: ${dex.reason}`);
    const unwind = cexUnknown ? null : unwindPlan(opp.direction, dex.ok, opp.cexQty, cexFilled, this.cfg.mexcTakerFee, t.qtyStep);
    if (cexUnknown) {
      status = 'one_sided';
    } else if (unwind) {
      status = 'one_sided';
      const qty = unwind.qty.toFixed(decimalsOfStep(t.qtyStep));
      try {
        const r = await this.closeAtMarket(t, unwind.side, qty);
        notes.push(`unwind ${unwind.side} ${qty} @market (${r.orderId}, filled ${r.filled})`);
        await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base} ${opp.direction}\n${unwind.reason}\nClosed: MEXC MARKET ${unwind.side} ${qty} ${t.base}`);
      } catch (e) {
        this.d.risk.pause(`unwind failed for ${t.base}`);
        notes.push(`UNWIND FAILED: ${errMsg(e)}`);
        await this.d.tg.send(
          `🚨 ONE-SIDED FILL ${t.base} and the market close FAILED: ${errMsg(e)}\n` +
            `Open position: MEXC ${unwind.side} ${qty} ${t.base} still needed.\nTrading PAUSED. Close it manually, then /start.`,
        );
      }
    } else if (!dex.ok) {
      status = 'dex_failed'; // nothing filled on either side
    }

    // 6) Exact PnL = change in total value of everything the trade touched, at pre-trade prices.
    await this.sleep(2500); // let MEXC balances settle
    const after = await this.d.balances();
    const pnl = portfolioUsd(after, t, c.tokenUsd, ethUsd) - portfolioUsd(before, t, c.tokenUsd, ethUsd);
    const gasPaid = (Number(dex.gasCostWei + approvalCostWei) / 1e18) * ethUsd;
    this.record({ ...c, opp }, status, { pnl, gas: gasPaid, dexTx: dex.hash, orderId, note: notes.join('; ') || null });

    const dexIsBuy = opp.direction === 'DEX_BUY';
    await this.d.tg.send(
      [
        `${status === 'ok' ? '✅' : '⚠️'} LIVE ${t.base} ${opp.direction} [${status}]`,
        `Buy  ${dexIsBuy ? 'DEX ' : 'MEXC'} @ ${opp.buyPrice.toPrecision(6)}`,
        `Sell ${dexIsBuy ? 'MEXC' : 'DEX '} @ ${opp.sellPrice.toPrecision(6)}`,
        `Qty ${opp.cexQty} ${t.base} | size ${usd(opp.sizeUsd)}`,
        `MEXC fee ${usd(opp.cexFeeUsd)} | Gas ${usd(gasPaid)}`,
        `Expected ${usd(opp.net)} | Net PnL ${usd(pnl)}`,
        dex.hash ? `https://etherscan.io/tx/${dex.hash}` : '',
        notes.length ? `Notes: ${notes.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    await this.handleRisk(this.d.risk.afterTrade(status));
  }

  /**
   * Close a position on MEXC now. SELL uses a MARKET order. BUY uses a LIMIT 2% above the best ask
   * (MEXC documents MARKET buys by quote amount only, and we need an exact token quantity).
   */
  async closeAtMarket(t: Token, side: Side, qty: string): Promise<{ orderId: string; filled: number }> {
    if (side === 'SELL') {
      const { orderId } = await this.d.mexc.marketSell(t.symbol, qty);
      return { orderId, filled: Number(qty) };
    }
    const b = await this.d.book(t.symbol);
    const f = 10 ** t.priceDecimals;
    const px = (Math.ceil(b.asks[0][0] * 1.02 * f) / f).toFixed(t.priceDecimals);
    const { orderId } = await this.d.mexc.limitOrder(t.symbol, 'BUY', qty, px);
    await this.sleep(1500);
    let o = await this.d.mexc.getOrder(t.symbol, orderId);
    if (o.status !== 'FILLED') {
      await this.d.mexc.cancelOrder(t.symbol, orderId).catch(() => {});
      o = await this.d.mexc.getOrder(t.symbol, orderId);
      if (Number(o.executedQty) < Number(qty) * 0.999) throw new Error(`close BUY only filled ${o.executedQty}/${qty}`);
    }
    return { orderId, filled: Number(o.executedQty) };
  }

  /** MEXC marketable limit order; cancels any unfilled rest. Returns filled quantity. */
  async cexLeg(t: Token, opp: Opportunity): Promise<{ orderId: string; filled: number }> {
    const side: Side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
    const qty = opp.cexQty.toFixed(decimalsOfStep(t.qtyStep));
    const f = 10 ** t.priceDecimals;
    const px = side === 'SELL' ? Math.floor(opp.cexLimitPrice * f) / f : Math.ceil(opp.cexLimitPrice * f) / f;
    const { orderId } = await this.d.mexc.limitOrder(t.symbol, side, qty, px.toFixed(t.priceDecimals));
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
      await this.d.mexc.cancelOrder(t.symbol, orderId).catch((e) => log.warn(`cancel: ${errMsg(e)}`));
      await this.sleep(500);
      o = await read();
    }
    return { orderId, filled: Number(o.executedQty) };
  }

  private async recordPaper(c: Candidate) {
    const { token: t, opp } = c;
    this.record(c, 'paper', { pnl: opp.net, gas: opp.gasUsd });
    await this.d.tg.send(
      `📝 PAPER ${t.base} ${opp.direction}\nBuy @ ${opp.buyPrice.toPrecision(6)} | Sell @ ${opp.sellPrice.toPrecision(6)}\n` +
        `Qty ${opp.cexQty} | size ${usd(opp.sizeUsd)} | fee ${usd(opp.cexFeeUsd)} | gas ${usd(opp.gasUsd)}\nNet ${usd(opp.net)}`,
    );
    await this.handleRisk(this.d.risk.afterTrade('paper'));
  }

  private record(
    c: Candidate,
    status: TradeStatus,
    r: { pnl: number; gas: number; dexTx?: string; orderId?: string | null; note?: string | null },
  ) {
    const now = Date.now();
    this.d.db.insertTrade({
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
