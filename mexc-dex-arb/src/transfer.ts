// TRANSFER strategy: scan all MEXC ERC20 tokens -> buy the one that is cheaper on MEXC ->
// withdraw it to the hot wallet -> sell it on an Ethereum DEX.
//
// Each cycle is a persisted state machine (buying -> withdrawing -> selling -> done),
// so a crash or pm2 restart continues where it stopped. Only MAX_OPEN_TRANSFERS run at once.
import type { Config } from './config.js';
import type { Aggregator, Quote } from './dex/aggregator.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Book, CoinConfig, Order, SymbolInfo } from './mexc/rest.js';
import type { Db, TransferRow } from './db.js';
import type { Risk } from './risk.js';
import type { Notifier } from './engine.js';
import { USDC_DECIMALS, ZEROX_ALLOWANCE_HOLDER } from './engine.js';
import { type Gap, type ScanToken, dexPrices, findGaps, loadUniverse } from './scanner.js';
import { evaluateTransfer, gasUsd, planCexBuy, threshold } from './pricing.js';
import { log, errMsg } from './log.js';
import { decimalsOfStep, dhakaDay, floorToStep, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

const APPROVE_GAS = 60_000n;
const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';

export interface TransferMexc {
  exchangeInfo(): Promise<SymbolInfo[]>;
  tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]>;
  coinConfigs(): Promise<CoinConfig[]>;
  bookTickers(): Promise<Map<string, { bid: number; ask: number }>>;
  depth(symbol: string, limit?: number): Promise<Book>;
  balances(): Promise<Record<string, number>>;
  limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string): Promise<{ orderId: string }>;
  marketSell(symbol: string, quantity: string): Promise<{ orderId: string }>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<Order>;
  withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string>;
  withdrawStatus(coin: string, id: string): Promise<{ status: number; txId?: string } | null>;
}
export interface TransferChain {
  readonly address: string;
  gas(): Promise<GasInfo>;
  decimals(token: string): Promise<number>;
  tokenBalance(token: string): Promise<bigint>;
  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
  send(tx: { to: string; data: string; value?: bigint }, gasLimit: bigint, gas: GasInfo, timeoutSec: number): Promise<TxResult>;
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
}

interface Candidate {
  gap: Gap;
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  ev: ReturnType<typeof evaluateTransfer>;
  decimals: number;
}

const TERMINAL_WITHDRAW = new Set([8, 9]); // FAILED, CANCEL

export class TransferEngine {
  universe: ScanToken[] = [];
  private universeTs = 0;
  private lastNote = new Map<string, string>();
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  lastGasGwei = 0;
  lastTopGaps: Gap[] = [];

  constructor(private d: TransferDeps) {
    this.sleep = d.sleep ?? realSleep;
    this.now = d.now ?? Date.now;
  }

  private get cfg() {
    return this.d.cfg;
  }
  private get live() {
    return this.cfg.mode === 'live';
  }
  private costs() {
    return { takerFee: this.cfg.mexcTakerFee, cexSlippageBps: this.cfg.cexSlippageBps, safetyMarginUsd: this.cfg.safetyMarginUsd };
  }
  private note(key: string, msg: string) {
    if (this.lastNote.get(key) !== msg) {
      this.lastNote.set(key, msg);
      log.info(msg);
    }
  }

  async refreshUniverse(force = false): Promise<void> {
    if (!force && this.now() - this.universeTs < 10 * 60_000) return;
    this.universe = await loadUniverse(this.d.mexc, { minVolumeUsd: this.cfg.minMexcVolumeUsd, only: this.cfg.watchlist });
    this.universeTs = this.now();
    log.info(`scanner universe: ${this.universe.length} MEXC ERC20 tokens (deposit+withdraw open, volume >= $${this.cfg.minMexcVolumeUsd})`);
  }

  /** One scan cycle. Always advances open transfers first. */
  async tick(): Promise<void> {
    const gas = await this.d.chain.gas();
    this.lastGasGwei = Number(gas.effective) / 1e9;
    const tickers = await this.d.mexc.bookTickers();
    const eth = tickers.get('ETHUSDT');
    if (!eth) throw new Error('no ETHUSDT ticker');
    const ethUsd = (eth.bid + eth.ask) / 2;

    for (const row of this.d.db.openTransfers()) {
      try {
        await this.advance(row, gas, ethUsd);
      } catch (e) {
        log.error(`transfer #${row.id} ${row.base}: ${errMsg(e)}`);
      }
    }

    await this.refreshUniverse();
    const dex = await (this.d.dexPricesFn ?? dexPrices)(this.universe.map((t) => t.address));
    const gaps = findGaps(this.universe, tickers, dex, { minTvlUsd: this.cfg.minDexTvlUsd, minGapPct: this.cfg.scanMinGapPct });
    this.lastTopGaps = gaps.slice(0, 5);
    this.note(
      'gaps',
      gaps.length
        ? `scan: ${gaps.length} gaps >= ${this.cfg.scanMinGapPct}%: ${gaps.slice(0, 5).map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ')}`
        : `scan: ${this.universe.length} tokens, no gap >= ${this.cfg.scanMinGapPct}%`,
    );

    const block = this.d.risk.blockReason();
    if (block) return this.note('block', `new trades blocked: ${block}`);
    this.note('block', 'new trades enabled');
    if (this.d.db.openTransfers().length >= this.cfg.maxOpenTransfers) return this.note('open', 'waiting for open transfer to finish');
    this.note('open', 'no open transfer');
    if (this.lastGasGwei > this.cfg.maxGasGwei) return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > ${this.cfg.maxGasGwei}, no new trades`);
    this.note('gas', 'gas ok');
    if (!gaps.length) return;

    const usdt = this.live ? ((await this.d.mexc.balances()).USDT ?? 0) : 1e12;
    let best: Candidate | null = null;
    for (const g of gaps.slice(0, this.cfg.scanExactQuotes)) {
      try {
        const c = await this.evaluate(g, gas, ethUsd, usdt);
        if (!c) continue;
        const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
        log.info(`${g.token.base}: gap ${g.gapPct.toFixed(2)}%, size ${usd(c.ev.costUsd)}, exact net ${usd(c.ev.net)} (need ${usd(need)})`);
        if (c.ev.net > need && (!best || c.ev.net > best.ev.net)) best = c;
      } catch (e) {
        log.warn(`${g.token.base} evaluate: ${errMsg(e)}`);
      }
    }
    if (!best) return;
    if (!this.live) return this.recordPaper(best);
    await this.start(best, gas, ethUsd);
  }

  /** Exact, size-specific numbers: MEXC depth walk + withdraw fee + aggregator quote + gas + drift reserve. */
  async evaluate(g: Gap, gas: GasInfo, ethUsd: number, usdt: number): Promise<Candidate | null> {
    const size = Math.min(this.cfg.maxTradeUsd, usdt * 0.99);
    if (size < this.cfg.minTradeUsd) {
      this.note('usdt', `MEXC USDT too low for a trade (${usd(usdt)})`);
      return null;
    }
    const t = g.token;
    const book = await this.d.mexc.depth(t.symbol, 20);
    const plan = planCexBuy({ sizeUsd: size, asks: book.asks, qtyStep: t.qtyStep, takerFee: this.cfg.mexcTakerFee });
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
      usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
      usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
      gasUsd: gasUsd(q.gas + APPROVE_GAS, gas.effective, ethUsd),
      driftBps: this.cfg.transferDriftBps,
      costs: this.costs(),
    });
    return { gap: g, plan, ev, decimals };
  }

  private async recordPaper(c: Candidate) {
    const t = c.gap.token;
    const now = this.now();
    this.d.db.insertTrade({
      ts: now, day: dhakaDay(now), mode: 'paper', symbol: t.base, direction: 'TRANSFER',
      size_usd: c.ev.costUsd, qty: c.plan.qty, buy_price: c.ev.buyPrice, sell_price: c.ev.sellPrice,
      expected_net: c.ev.net, cex_fee_usd: c.ev.cexFeeUsd + c.ev.withdrawFeeUsd, gas_usd: c.ev.gasUsd,
      pnl_usd: c.ev.net, status: 'paper', dex_tx: null, cex_order_id: null, note: `gap ${c.gap.gapPct.toFixed(2)}%`,
    });
    await this.d.tg.send(
      `📝 PAPER TRANSFER ${t.base}: buy MEXC @ ${c.ev.buyPrice.toPrecision(6)} -> sell DEX @ ${c.ev.sellPrice.toPrecision(6)}\n` +
        `Size ${usd(c.ev.costUsd)} | fees ${usd(c.ev.cexFeeUsd + c.ev.withdrawFeeUsd)} | gas ${usd(c.ev.gasUsd)} | drift reserve ${usd(c.ev.driftUsd)}\nNet ${usd(c.ev.net)}`,
    );
    this.d.risk.afterTrade('paper');
  }

  /** Create the persisted transfer and run its first steps right away. */
  private async start(c: Candidate, gas: GasInfo, ethUsd: number) {
    const t = c.gap.token;
    const now = this.now();
    const id = this.d.db.insertTransfer({
      ts: now, updated: now, base: t.base, symbol: t.symbol, address: t.address, decimals: c.decimals,
      net_work: t.netWork, qty_step: t.qtyStep, price_decimals: t.priceDecimals, status: 'buying',
      buy_qty: c.plan.qty, cost_usd: c.ev.costUsd, buy_order_id: null, withdraw_amount: null, withdraw_id: null,
      wallet_before: null, received: null, usdc_out: null, gas_usd: 0, expected_net: c.ev.net, pnl: null,
      sell_attempts: 0, alerted_timeout: 0, note: null,
    });
    log.info(`transfer #${id} ${t.base}: START gap ${c.gap.gapPct.toFixed(2)}% expected ${usd(c.ev.net)}`);
    const row = this.d.db.openTransfers().find((r) => r.id === id)!;
    try {
      await this.buy(row, c.plan.worst * (1 + this.cfg.cexSlippageBps / 10_000));
    } catch (e) {
      if (!row.buy_order_id) return this.fail(row, `MEXC buy rejected: ${errMsg(e)}`, 0, false);
      throw e; // order exists; the next tick re-reads it
    }
    const next = this.d.db.openTransfers().find((r) => r.id === id);
    if (next) await this.advance(next, gas, ethUsd);
  }

  /** Move one transfer forward as far as it can go right now. */
  async advance(row: TransferRow, gas: GasInfo, ethUsd: number): Promise<void> {
    if (row.status === 'buying') {
      // Crashed between creating the row and recording the order: never guess.
      if (!row.buy_order_id) return this.fail(row, 'restart during MEXC buy, order id unknown: check MEXC manually', 0);
      return this.finishBuy(row);
    }
    if (row.status === 'withdrawing') return this.withdrawStep(row, ethUsd);
    if (row.status === 'selling' || row.status === 'stuck') return this.sellStep(row, gas, ethUsd);
  }

  private async buy(row: TransferRow, limitPrice: number) {
    const f = 10 ** row.price_decimals;
    const px = (Math.ceil(limitPrice * f) / f).toFixed(row.price_decimals);
    const qty = row.buy_qty.toFixed(decimalsOfStep(row.qty_step));
    const { orderId } = await this.d.mexc.limitOrder(row.symbol, 'BUY', qty, px);
    this.d.db.updateTransfer(row.id!, { buy_order_id: orderId });
    row.buy_order_id = orderId;
    log.info(`transfer #${row.id} MEXC BUY ${qty} ${row.base} @ ${px} id=${orderId}`);
    await this.sleep(1500);
    await this.finishBuy(row);
  }

  private async finishBuy(row: TransferRow) {
    let o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
    if (o.status !== 'FILLED') {
      await this.d.mexc.cancelOrder(row.symbol, row.buy_order_id!).catch((e) => log.warn(`cancel: ${errMsg(e)}`));
      await this.sleep(500);
      o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
    }
    const filled = Number(o.executedQty);
    const cost = Number(o.cummulativeQuoteQty);
    if (filled <= 0) return this.fail(row, 'MEXC buy did not fill (price moved)', 0, false);
    this.d.db.updateTransfer(row.id!, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
    Object.assign(row, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
  }

  private async withdrawStep(row: TransferRow, ethUsd: number) {
    const expectedUnits = (amount: string) => toUnits(Math.max(0, Number(amount) - this.withdrawFee(row)), row.decimals);

    if (!row.withdraw_id) {
      const free = (await this.d.mexc.balances())[row.base] ?? 0;
      const amount = floorToStep(Math.min(free, row.buy_qty * (1 - this.cfg.mexcTakerFee)), row.qty_step);
      const amountStr = amount.toFixed(decimalsOfStep(row.qty_step));
      const min = this.universe.find((t) => t.base === row.base)?.withdrawMin ?? 0;
      if (amount <= 0 || amount < min) {
        const proceeds = amount > 0 ? await this.sellOnMexc(row, amountStr) : 0;
        return this.fail(row, `amount ${amountStr} below MEXC withdraw minimum ${min}; sold back on MEXC`, proceeds - row.cost_usd);
      }
      const before = await this.d.chain.tokenBalance(row.address);
      try {
        const id = await this.d.mexc.withdraw({
          coin: row.base,
          netWork: row.net_work,
          address: this.d.chain.address, // ONLY ever our own hot wallet
          amount: amountStr,
          contractAddress: row.address,
          withdrawOrderId: `arb${row.id}`,
        });
        this.d.db.updateTransfer(row.id!, { withdraw_id: id, withdraw_amount: amountStr, wallet_before: before.toString() });
        await this.d.tg.send(
          `📤 TRANSFER #${row.id} ${row.base}: bought ${row.buy_qty} on MEXC for ${usd(row.cost_usd)}, withdrawing ${amountStr} to wallet`,
        );
      } catch (e) {
        // Could not withdraw: close the position on MEXC instead.
        const proceeds = await this.sellOnMexc(row, amountStr);
        return this.fail(row, `withdraw failed: ${errMsg(e)}; sold back on MEXC`, proceeds - row.cost_usd);
      }
      return;
    }

    const st = await this.d.mexc.withdrawStatus(row.base, row.withdraw_id).catch(() => null);
    const bal = await this.d.chain.tokenBalance(row.address);
    const diff = bal - BigInt(row.wallet_before ?? '0');
    const expected = expectedUnits(row.withdraw_amount!);

    if (st && TERMINAL_WITHDRAW.has(st.status) && diff <= 0n) {
      await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base}: MEXC withdrawal ${st.status === 8 ? 'FAILED' : 'CANCELLED'}, selling back on MEXC`);
      const proceeds = await this.sellOnMexc(row, row.withdraw_amount!);
      return this.fail(row, `withdraw status ${st.status}`, proceeds - row.cost_usd);
    }
    if (diff > 0n && (st?.status === 7 || diff * 100n >= expected * 98n)) {
      this.d.db.updateTransfer(row.id!, { status: 'selling', received: diff.toString() });
      Object.assign(row, { status: 'selling', received: diff.toString() });
      log.info(`transfer #${row.id} ${row.base}: ${toFloat(diff, row.decimals)} arrived in wallet`);
      return this.sellStep(row, await this.d.chain.gas(), ethUsd);
    }
    const ageMin = (this.now() - row.ts) / 60_000;
    if (ageMin > this.cfg.transferTimeoutMin && !row.alerted_timeout) {
      this.d.db.updateTransfer(row.id!, { alerted_timeout: 1 });
      await this.d.tg.send(
        `⏳ TRANSFER #${row.id} ${row.base}: withdrawal still not in wallet after ${Math.round(ageMin)} min (MEXC status ${st?.status ?? '?'}). Still waiting; no new trades until it lands.`,
      );
    }
  }

  private withdrawFee(row: TransferRow): number {
    return this.universe.find((t) => t.base === row.base)?.withdrawFee ?? 0;
  }

  private async sellStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
    if (Number(gas.effective) / 1e9 > this.cfg.maxGasGwei) return this.note(`sell-${row.id}`, `transfer #${row.id}: gas too high, sale waits`);
    const amount = BigInt(row.received!);
    const req = { sellToken: row.address, buyToken: this.cfg.usdc, sellAmount: amount, taker: this.d.chain.address, slippageBps: this.cfg.dexSlippageBps };
    let gasWei = 0n;
    let txHash: string | undefined;
    try {
      const first = await this.d.agg.quote(req);
      const spender = this.spenderOf(first);
      const ap = await this.d.chain.approveExact(row.address, spender, amount, gas);
      gasWei += ap.gasCostWei;
      if (!ap.ok) throw new Error(`approval failed: ${ap.reason}`);
      const firm = await this.d.agg.quote(req); // fresh after the approval
      if (!firm.tx) throw new Error('quote without transaction');
      const est = await this.d.chain.simulate(firm.tx);
      const usdcBefore = await this.d.chain.tokenBalance(this.cfg.usdc);
      const r = await this.d.chain.send(firm.tx, (est * 13n) / 10n, gas, this.cfg.txTimeoutSec);
      gasWei += r.gasCostWei;
      txHash = r.hash;
      if (!r.ok) throw new Error(`swap ${r.reason}`);
      const usdcOut = toFloat((await this.d.chain.tokenBalance(this.cfg.usdc)) - usdcBefore, USDC_DECIMALS);
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
      const pnl = usdcOut - row.cost_usd - gasTotal;
      this.d.db.updateTransfer(row.id!, { status: 'done', usdc_out: usdcOut, gas_usd: gasTotal, pnl });
      const qty = toFloat(amount, row.decimals);
      this.recordTrade(row, 'ok', pnl, gasTotal, txHash, `sold ${qty} for ${usd(usdcOut)}`, usdcOut / qty);
      await this.d.tg.send(
        [
          `${pnl >= 0 ? '✅' : '🔻'} TRANSFER #${row.id} ${row.base} done`,
          `Buy MEXC: ${row.buy_qty} for ${usd(row.cost_usd)} (@ ${(row.cost_usd / row.buy_qty).toPrecision(6)})`,
          `Sell DEX: ${qty} for ${usd(usdcOut)} (@ ${(usdcOut / qty).toPrecision(6)})`,
          `Gas ${usd(gasTotal)} | Expected ${usd(row.expected_net)} | Net PnL ${usd(pnl)}`,
          `https://etherscan.io/tx/${txHash}`,
        ].join('\n'),
      );
      this.afterRisk('ok');
    } catch (e) {
      const attempts = row.sell_attempts + 1;
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
      this.d.db.updateTransfer(row.id!, { sell_attempts: attempts, gas_usd: gasTotal, status: attempts >= 3 ? 'stuck' : 'selling' });
      log.warn(`transfer #${row.id} ${row.base} sell attempt ${attempts} failed: ${errMsg(e)}`);
      if (attempts === 3) {
        await this.d.tg.send(
          `🚨 TRANSFER #${row.id} ${row.base}: could not sell on DEX 3 times (${errMsg(e)}).\nTokens are in the hot wallet. The bot keeps retrying each scan; you can also sell manually.`,
        );
        this.afterRisk('one_sided');
      }
    }
  }

  private spenderOf(q: Quote): string {
    if (q.spender) return q.spender;
    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
    throw new Error('aggregator did not return a spender');
  }

  /** Market-sell on MEXC; returns USDT received (0 if it fails, with an alert). */
  private async sellOnMexc(row: TransferRow, qty: string): Promise<number> {
    try {
      const { orderId } = await this.d.mexc.marketSell(row.symbol, qty);
      await this.sleep(1000);
      const o = await this.d.mexc.getOrder(row.symbol, orderId);
      return Number(o.cummulativeQuoteQty) * (1 - this.cfg.mexcTakerFee);
    } catch (e) {
      this.d.risk.pause(`could not close ${row.base} on MEXC`);
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

  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0) {
    const now = this.now();
    this.d.db.insertTrade({
      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: row.cost_usd / (row.buy_qty || 1),
      sell_price: sellPrice, expected_net: row.expected_net,
      cex_fee_usd: row.cost_usd * this.cfg.mexcTakerFee, gas_usd: gas, pnl_usd: pnl, status,
      dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
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
