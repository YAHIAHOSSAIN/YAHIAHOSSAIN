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
//  - If arrival-time price would lose more than TRANSFER_MAX_LOSS_PCT, the tokens are held (alert).
//  - An unknown on-chain outcome pauses trading instead of retrying.
import type { Config } from './config.js';
import type { Aggregator, Quote } from './dex/aggregator.js';
import { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Book, CoinConfig, Order, SymbolInfo, WithdrawRecord } from './mexc/rest.js';
import { AmbiguousRequestError } from './mexc/rest.js';
import type { Db, TransferRow } from './db.js';
import type { Risk } from './risk.js';
import type { Notifier } from './engine.js';
import { USDC_DECIMALS, cancelAndConfirm, clientId, placeSafely } from './engine.js';
import { closePrice, orderProblem } from './mexc/rules.js';
import { type Gap, type ScanToken, dexPrices, findGaps, loadUniverse } from './scanner.js';
import { evaluateTransfer, gasUsd, planCexBuy, threshold } from './pricing.js';
import { log, errMsg } from './log.js';
import { decimalsOfStep, dhakaDay, floorToStep, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

const APPROVE_GAS = 60_000n;
const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
const SELL_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000]; // after attempt 1, 2, 3; attempt 4 -> stuck
const MAX_SELL_ATTEMPTS = 4;
const FALSE_GAP_COOLDOWN_MS = 10 * 60_000;

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
}
export interface TransferChain {
  readonly address: string;
  gas(): Promise<GasInfo>;
  decimals(token: string): Promise<number>;
  tokenBalance(token: string): Promise<bigint>;
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
}

interface Candidate {
  gap: Gap;
  plan: NonNullable<ReturnType<typeof planCexBuy>>;
  ev: ReturnType<typeof evaluateTransfer>;
  decimals: number;
}

const WITHDRAW_FAILED = new Set([8, 9]); // FAILED, CANCEL
const WITHDRAW_MANUAL = 10;
const buyCid = (id: number) => `arb${id}b`;
const withdrawCid = (id: number) => `arb${id}w`;

export class TransferEngine {
  universe: ScanToken[] = [];
  private universeTs = 0;
  private lastNote = new Map<string, string>();
  private cooldown = new Map<string, number>(); // token -> skip exact quotes until
  private alerted = new Set<string>();
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
        await this.advance(row, gas, ethUsd);
      } catch (e) {
        log.error(`transfer #${row.id} ${row.base}: ${errMsg(e)}`);
      }
    }

    await this.refreshUniverse();
    const dex = await (this.d.dexPricesFn ?? dexPrices)(this.universe.map((t) => t.address));
    const now = this.now();
    const gaps = findGaps(this.universe, tickers, dex, {
      minTvlUsd: this.cfg.minDexTvlUsd,
      minGapPct: this.cfg.scanMinGapPct,
      maxGapPct: this.cfg.scanMaxGapPct,
    });
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
    if (txBlocked) return;
    if (this.d.db.blockingTransfers().length >= this.cfg.maxOpenTransfers) return this.note('open', 'waiting for open transfer to finish');
    this.note('open', 'no open transfer');
    if (this.lastGasGwei > this.cfg.maxGasGwei) return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > ${this.cfg.maxGasGwei}, no new trades`);
    this.note('gas', 'gas ok');

    // Skip tokens whose exact quote recently showed the gap was not real, so they cannot starve the rest.
    // Never two transfers of the same token at once (they would share one wallet balance), even after
    // an old one stopped blocking because of a long withdrawal.
    const busyTokens = new Set([...this.d.db.openTransfers(), ...this.d.db.stuckTransfers()].map((t) => t.base));
    const fresh = gaps.filter((g) => (this.cooldown.get(g.token.base) ?? 0) <= now && !busyTokens.has(g.token.base));
    if (!fresh.length) return;

    const usdt = this.live ? ((await this.d.mexc.balances()).USDT ?? 0) : 1e12;
    let best: Candidate | null = null;
    for (const g of fresh.slice(0, this.cfg.scanExactQuotes)) {
      try {
        const c = await this.evaluate(g, gas, ethUsd, usdt);
        if (!c) {
          this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
          continue;
        }
        const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, this.cfg.minProfitPct);
        log.info(`${g.token.base}: gap ${g.gapPct.toFixed(2)}%, size ${usd(c.ev.costUsd)}, exact net ${usd(c.ev.net)} (need ${usd(need)})`);
        if (c.ev.net <= need) this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
        else if (!best || c.ev.net > best.ev.net) best = c;
      } catch (e) {
        log.warn(`${g.token.base} evaluate: ${errMsg(e)}`);
        this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
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
    this.cooldown.set(t.base, this.now() + FALSE_GAP_COOLDOWN_MS); // one paper trade per gap
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
      sell_attempts: 0, alerted_timeout: 0, note: null, withdraw_fee: t.withdrawFee, next_try: 0, force_sell: 0, hold_alerted: 0, sell_tx: null,
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
    if (next.status === 'withdrawing') await this.advance(next, gas, ethUsd);
  }

  /** Move one transfer forward as far as it can go right now. */
  async advance(row: TransferRow, gas: GasInfo, ethUsd: number): Promise<void> {
    if (row.status === 'buying') {
      if (!row.buy_order_id) {
        // Crashed or timed out while placing: find the order by our client id, never guess.
        const o = await this.d.mexc.getOrderByClientId(row.symbol, buyCid(row.id!));
        if (!o) return this.fail(row, 'MEXC buy was never placed', 0, false);
        this.d.db.updateTransfer(row.id!, { buy_order_id: o.orderId });
        row = this.reload(row);
      }
      await this.finishBuy(row);
      row = this.reload(row);
      if (row.status !== 'withdrawing') return;
    }
    if (row.status === 'withdrawing') return this.withdrawStep(row, gas, ethUsd);
    if (row.status === 'selling') return this.sellStep(row, gas, ethUsd);
  }

  private async buy(row: TransferRow, limitPrice: number) {
    const f = 10 ** row.price_decimals;
    const px = (Math.ceil(limitPrice * f) / f).toFixed(row.price_decimals);
    const qty = row.buy_qty.toFixed(decimalsOfStep(row.qty_step));
    const cid = buyCid(row.id!);
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

  private async withdrawStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
    const since = row.ts - 60_000;

    if (!row.withdraw_id) {
      if (row.withdraw_amount) {
        // A request was sent before but its result was lost (timeout / restart). Look it up; NEVER resend.
        const rec = await this.d.mexc.findWithdraw(row.base, since, { withdrawOrderId: withdrawCid(row.id!) });
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
      const amount = floorToStep(Math.min(free, row.buy_qty * (1 - this.cfg.mexcTakerFee)), row.qty_step);
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
          withdrawOrderId: withdrawCid(row.id!),
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

    const rec = await this.d.mexc.findWithdraw(row.base, since, { id: row.withdraw_id, withdrawOrderId: withdrawCid(row.id!) }).catch(() => undefined);
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
      return this.sellStep(this.reload(row), gas, ethUsd);
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

  private async sellStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
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
        `🚨 TRANSFER #${row.id} ${row.base}: the tokens are no longer in the wallet (sold before a restart, or moved). Check etherscan, then /clear ${row.id}.`,
      );
      return;
    }
    const qty = toFloat(amount, row.decimals);
    const req = { sellToken: row.address, buyToken: this.cfg.usdc, sellAmount: amount, taker: this.d.chain.address, slippageBps: this.cfg.dexSlippageBps };
    let gasWei = 0n;
    let txHash: string | undefined;
    try {
      const first = await this.d.agg.quote(req);

      // Loss floor: price may have fallen while the withdrawal travelled. Hold instead of locking in a big loss.
      const worstOut = toFloat(first.minBuyAmount, USDC_DECIMALS);
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
        return;
      }

      const ap = await this.d.chain.approveExact(row.address, this.spenderOf(first), amount, gas);
      gasWei += ap.gasCostWei;
      if (ap.unknown) return this.unknownOutcome(row, `approval ${ap.hash}`, gasWei, ethUsd);
      if (!ap.ok) throw new Error(`approval failed: ${ap.reason}`);
      const firm = await this.d.agg.quote(req); // fresh after the approval
      if (!firm.tx) throw new Error('quote without transaction');
      const est = await this.d.chain.simulate(firm.tx);
      const usdcBefore = await this.d.chain.tokenBalance(this.cfg.usdc);
      const r = await this.d.chain.send(firm.tx, (est * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash) =>
        this.d.db.updateTransfer(row.id!, { sell_tx: hash }),
      );
      if (r.refused) return; // an earlier tx is unresolved: not an attempt, try again later
      gasWei += r.gasCostWei;
      txHash = r.hash;
      if (r.unknown) return this.unknownOutcome(row, `swap ${r.hash}`, gasWei, ethUsd);
      if (!r.ok) throw new Error(`swap ${r.reason}`);
      const usdcOut = toFloat((await this.d.chain.tokenBalance(this.cfg.usdc)) - usdcBefore, USDC_DECIMALS);
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
      const pnl = usdcOut - row.cost_usd - gasTotal;
      this.d.db.updateTransfer(row.id!, { status: 'done', usdc_out: usdcOut, gas_usd: gasTotal, pnl });
      this.recordTrade(row, 'ok', pnl, gasTotal, txHash, `sold ${qty} for ${usd(usdcOut)}`, usdcOut / qty);
      await this.d.tg.send(
        [
          `${pnl >= 0 ? '✅' : '🔻'} TRANSFER #${row.id} ${row.base} done`,
          `Buy MEXC: ${row.buy_qty} for ${usd(row.cost_usd)} (@ ${(row.cost_usd / row.buy_qty).toPrecision(6)})`,
          `Sell DEX: ${qty} for ${usd(usdcOut)} (@ ${(usdcOut / qty).toPrecision(6)})`,
          `Withdraw fee ${row.withdraw_fee} ${row.base} | Gas ${usd(gasTotal)}`,
          `Expected ${usd(row.expected_net)} | Net PnL ${usd(pnl)}`,
          `https://etherscan.io/tx/${txHash}`,
        ].join('\n'),
      );
      this.afterRisk('ok');
    } catch (e) {
      const attempts = row.sell_attempts + 1;
      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
      const stuck = attempts >= MAX_SELL_ATTEMPTS;
      const wait = SELL_BACKOFF_MS[Math.min(attempts - 1, SELL_BACKOFF_MS.length - 1)];
      this.d.db.updateTransfer(row.id!, {
        sell_attempts: attempts,
        gas_usd: gasTotal,
        status: stuck ? 'stuck' : 'selling',
        next_try: this.now() + wait,
        note: errMsg(e),
      });
      log.warn(`transfer #${row.id} ${row.base} sell attempt ${attempts} failed: ${errMsg(e)}${stuck ? '' : `; retry in ${wait / 60_000} min`}`);
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
  private async unknownOutcome(row: TransferRow, what: string, gasWei: bigint, ethUsd: number) {
    this.d.db.updateTransfer(row.id!, {
      status: 'stuck',
      gas_usd: row.gas_usd + (Number(gasWei) / 1e18) * ethUsd,
      note: `${what} outcome unknown`,
    });
    this.d.risk.pause(`transfer #${row.id}: ${what} outcome unknown`, true);
    await this.d.tg.send(
      `🚨 TRANSFER #${row.id} ${row.base}: ${what} was not mined and its cancel was not confirmed. Outcome UNKNOWN.\n` +
        `Trading PAUSED. Check the wallet on etherscan. Then /sell ${row.id} (if the tokens are still there) or /clear ${row.id}, and /start.`,
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
      return received > 0 ? received : Number(o.cummulativeQuoteQty) * (1 - this.cfg.mexcTakerFee);
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

  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0) {
    const now = this.now();
    const buyPrice = row.cost_usd / (row.buy_qty || 1);
    this.d.db.insertTrade({
      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: buyPrice, sell_price: sellPrice, expected_net: row.expected_net,
      // informational only: PnL is measured from real balances and already includes every fee
      cex_fee_usd: row.cost_usd * this.cfg.mexcTakerFee + row.withdraw_fee * buyPrice,
      gas_usd: gas, pnl_usd: pnl, status, dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
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
