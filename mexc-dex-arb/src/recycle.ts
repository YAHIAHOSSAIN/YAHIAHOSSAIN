// Phase 8 — USDC recycle loop: after every completed DEX sell, the USDC
// proceeds in the hot wallet go back to MEXC as USDT, automatically, so the
// MEXC USDT balance is restored for the next buy. Exact user-approved flow:
//   (1) send the USDC to the MEXC USDC deposit address for that chain
//       (from MEXC's own API, never hardcoded);
//   (2) wait (poll) until the deposit credits on MEXC;
//   (3) market-sell that USDC for USDT ON MEXC SPOT (USDCUSDT) — the
//       conversion happens on MEXC itself, NOT on-chain, NOT via any DEX.
//
// State machine (persisted BEFORE each irreversible step, same bar as the
// transfer flow): '' -> 'address' -> 'sent' -> 'credited' -> 'sold' -> 'done'.
// A restart resumes from the recorded step; a hold stops the job until a
// human runs /recycle. NEVER double-send, NEVER double-sell: the deposit tx
// hash is written before broadcast (onSigned) and the MEXC market sell
// carries our own client order id (placeSafely lookup on ambiguity).
//
// The same machine also runs the ONE-TIME catch-up sweep: on the first
// recycle run after deploy it sweeps whatever USDC is already sitting in the
// hot wallet (transfer #3's $263.99 on Ethereum) through the exact same path.
// The sweep amount is the LIVE on-chain balance minus any proceeds of done
// transfers whose recycle has not sent yet — never the DB's remembered
// usdc_out figure. A persistent `recycle:catchup-done` state key makes it
// run exactly once; dust (<= $1) skips it and still marks it done.
//
// Scope: USDC chains only (Ethereum, Arbitrum). BSC's DEX stable is USDT, so
// a BSC sell leaves USDT in the wallet with no conversion needed; sending
// USDT proceeds back is OUT of scope (open question for the user).
import { ethers } from 'ethers';
import type { Config } from './config.js';
import { networkFor, explorerTxUrl } from './chains.js';
import type { Db, TransferRow } from './db.js';
import type { GasInfo, TxResult } from './dex/chain.js';
import type { Notifier } from './engine.js';
import { cancelAndConfirm, placeSafely } from './engine.js';
import { log, errMsg } from './log.js';
import type { CoinConfig, DepositRecord, Order, SymbolInfo } from './mexc/rest.js';
import { MexcApiError } from './mexc/rest.js';
import { decimalsOfStep, floorToStep, sleep as realSleep, toFloat, toUnits, usd } from './util.js';

/** How long a deposit may take to credit on MEXC before the loop holds (30 min). */
export const RECYCLE_CREDIT_TIMEOUT_MS = 30 * 60_000;
/** Dust floor: never recycle (or sweep) USDC at or below $1 — a smaller deposit risks being lost to MEXC minimums. */
export const RECYCLE_MIN_USDC = 1;
/** State-table key holding the catch-up sweep's persisted state (JSON). */
export const CATCHUP_STATE_KEY = 'recycle:catchup';
/** State-table key marking the one-time catch-up sweep finished (done, or skipped as dust). */
export const CATCHUP_DONE_KEY = 'recycle:catchup-done';
/** First-use deposit-address Telegram, once per chain+network (state key prefix). */
const ADDR_ALERT_KEY = (chain: string, net: string) => `recycle:addr:${chain}:${net}`;
/** Verified (app-current) deposit address per chain+network — reused by later recycles instead of re-resolving the GET list (whose order moves whenever a new address is generated). */
const VERIFIED_ADDR_KEY = (chain: string, net: string) => `recycle:deposit-addr:${chain}:${net}`;
/** A MEXC deposit address is a 0x + 40 hex chars. */
const isDepositAddress = (a: string | null | undefined): a is string => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

const ERC20_TRANSFER = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);

export type RecycleStep = 'address' | 'sent' | 'credited' | 'sold' | 'done';

export interface RecycleState {
  status: RecycleStep | '';
  held: boolean;
  /** Intended USDC to recycle (transfer: usdc_out; catch-up: live balance at first run). */
  amount: number | null;
  usdc: number | null; // actually sent to MEXC
  usdt: number | null; // actually received from the USDCUSDT sell
  address: string | null;
  tx: string | null; // deposit tx hash
  orderId: string | null; // our client order id of the USDCUSDT market sell
  mexcBefore: number | null; // MEXC free USDC just before the deposit send
  usdtBefore: number | null; // MEXC free USDT just before the market sell
  deadline: number; // ms timestamp: the deposit must credit by this
  note: string | null;
}

export function emptyRecycleState(): RecycleState {
  return {
    status: '', held: false, amount: null, usdc: null, usdt: null,
    address: null, tx: null, orderId: null, mexcBefore: null, usdtBefore: null,
    deadline: 0, note: null,
  };
}

export interface RecycleMexc {
  coinConfigs(): Promise<CoinConfig[]>;
  depositAddress(coin: string, network: string): Promise<string | null>;
  depositHistory(coin: string, sinceTs: number): Promise<DepositRecord[]>;
  findDeposit(coin: string, sinceTs: number, txId: string): Promise<DepositRecord | null>;
  balances(): Promise<Record<string, number>>;
  exchangeInfo(): Promise<SymbolInfo[]>;
  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<Order>;
}

export interface RecycleChain {
  readonly address: string;
  gas(): Promise<GasInfo>;
  tokenBalance(token: string): Promise<bigint>;
  ethBalance(): Promise<bigint>;
  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
  send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
    onSigned?: (hash: string, nonce: number) => void,
  ): Promise<TxResult>;
  receipt?(hash: string): Promise<{ status: number | null } | null>;
}

export interface RecycleDeps {
  cfg: Config;
  mexc: RecycleMexc;
  chain: RecycleChain;
  db: Db;
  tg: Notifier;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** DEX-stable decimals, read on-chain at startup (6 for USDC). Falls back to 6. */
  stableDecimals?: number;
}

/** One recycle job: a completed transfer's proceeds, or the catch-up sweep.
 * `load`/`save` are the job's persistence (transfer row columns, or the
 * state-table JSON blob for the sweep); the machine itself is shared. */
interface JobStore {
  label: string;
  resumeHint: string;
  sellCid: string;
  load(): RecycleState;
  save(s: RecycleState): void;
  /** Amount the job intends to recycle, when it has not started yet. */
  intendedAmount(): Promise<number | null>;
  /** Called when the job reaches 'done' (the sweep marks its one-time flag). */
  onDone?(s: RecycleState): void;
}

export class RecycleEngine {
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(private d: RecycleDeps) {
    this.sleep = d.sleep ?? realSleep;
    this.now = d.now ?? Date.now;
  }

  private get cfg() {
    return this.d.cfg;
  }
  /** Live + USDC-chain only: paper has no real funds, and BSC's DEX stable
   * is USDT, so a BSC sell needs no conversion (out of scope). */
  private applicable(): boolean {
    return this.cfg.mode === 'live' && this.cfg.chain.stable.symbol === 'USDC';
  }
  private stableDec(): number {
    return this.d.stableDecimals ?? 6;
  }
  private nativeSymbol(): string {
    return this.cfg.chain.nativeMexcSymbol.replace('USDT', '');
  }

  // ---------------------------------------------------------------- jobs

  /** Advance the recycle for one completed transfer. No-op unless the
   * transfer is done with USDC proceeds waiting. */
  async advanceTransfer(row: TransferRow, gas: GasInfo, nativeUsd: number): Promise<void> {
    if (!this.applicable()) return;
    if (row.status !== 'done' || !row.usdc_out || row.usdc_out <= 0) return;
    await this.advance(this.transferStore(row), gas, nativeUsd);
  }

  /**
   * One-time catch-up sweep (first recycle run after deploy): recycle whatever
   * USDC is already in the hot wallet through the exact same path. The amount
   * is the LIVE on-chain balance minus the proceeds of done transfers whose
   * recycle has not sent yet — never the DB's remembered usdc_out figure.
   * Runs exactly once: `recycle:catchup-done` is set when it finishes or when
   * the live balance is dust (<= $1).
   */
  async catchUp(gas: GasInfo, nativeUsd: number): Promise<void> {
    if (!this.applicable()) return;
    if (this.d.db.getState(CATCHUP_DONE_KEY)) return; // already swept (or skipped as dust)
    const store = this.catchUpStore();
    const s = store.load();
    if (s.status === 'done') {
      this.d.db.setState(CATCHUP_DONE_KEY, '1');
      return;
    }
    if (s.held) return; // waiting for a human (/recycle catchup)
    if (s.status === '' && s.amount === null) {
      const live = toFloat(await this.d.chain.tokenBalance(this.cfg.usdc), this.stableDec());
      // Proceeds of done transfers whose recycle has not sent yet are still
      // in the wallet and belong to those transfers, not to the sweep.
      const pending = this.d.db.transfersRecyclePending().reduce((sum, t) => sum + (t.usdc_out ?? 0), 0);
      const sweep = live - pending;
      if (sweep <= RECYCLE_MIN_USDC) {
        const done: RecycleState = { ...emptyRecycleState(), status: 'done', amount: live, note: `nothing to sweep: live wallet USDC ${usd(live)} minus ${usd(pending)} pending transfer proceeds = ${usd(sweep)} <= $${RECYCLE_MIN_USDC} dust floor` };
        store.save(done);
        this.d.db.setState(CATCHUP_DONE_KEY, '1');
        await this.d.tg.send(`🧹 Catch-up sweep: live wallet USDC is ${usd(live)} (${usd(pending)} reserved for pending transfer recycles) — nothing above the $${RECYCLE_MIN_USDC} dust floor to sweep, marked done.`);
        return;
      }
      s.amount = sweep;
      store.save(s);
      await this.d.tg.send(
        `🧹 Catch-up sweep: live wallet holds ${usd(live)} USDC (${usd(pending)} reserved for pending transfer recycles) — sweeping ${usd(sweep)} back to MEXC through the recycle path.`,
      );
    }
    await this.advance(store, gas, nativeUsd);
    if (store.load().status === 'done') this.d.db.setState(CATCHUP_DONE_KEY, '1');
  }

  /** Manual resume: clear the hold on a transfer's recycle so the next scan retries it. */
  retryTransfer(id: number): string {
    const row = this.d.db.getTransfer(id);
    if (!row) return `No transfer #${id}`;
    if (row.status !== 'done') return `Transfer #${id} is ${row.status} (recycle only runs for done transfers)`;
    if (row.recycle_status === 'done') return `Transfer #${id} recycle is already done (${usd(row.recycled_usdt ?? 0)} USDT back on MEXC)`;
    if (!row.recycle_held) return `Transfer #${id} recycle is not held (step ${row.recycle_status || 'not started'} — it runs on the next scan)`;
    this.d.db.updateTransfer(id, { recycle_held: 0, recycle_note: 'resumed via /recycle' });
    return `Transfer #${id}: recycle resumes on the next scan.`;
  }

  /** Manual resume for the catch-up sweep. */
  retryCatchUp(): string {
    if (this.d.db.getState(CATCHUP_DONE_KEY)) return 'Catch-up sweep is already done.';
    const store = this.catchUpStore();
    const s = store.load();
    if (!s.held) return 'Catch-up sweep is not held (it runs on the next scan).';
    s.held = false;
    s.note = 'resumed via /recycle catchup';
    store.save(s);
    return 'Catch-up sweep resumes on the next scan.';
  }

  private transferStore(row: TransferRow): JobStore {
    const db = this.d.db;
    const id = row.id!;
    return {
      label: `TRANSFER #${id} ${row.base}`,
      resumeHint: `/recycle ${id}`,
      sellCid: `${this.cfg.chain.name}${id}r`,
      load: (): RecycleState => {
        const r = db.getTransfer(id) ?? row;
        return {
          status: (r.recycle_status as RecycleStep | '') ?? '',
          held: r.recycle_held === 1,
          amount: r.usdc_out,
          usdc: r.recycled_usdc,
          usdt: r.recycled_usdt,
          address: r.recycle_address,
          tx: r.recycle_tx,
          orderId: r.recycle_order_id,
          mexcBefore: r.recycle_mexc_before,
          usdtBefore: r.recycle_usdt_before,
          deadline: r.recycle_deadline ?? 0,
          note: r.recycle_note,
        };
      },
      save: (s) => {
        db.updateTransfer(id, {
          recycle_status: s.status,
          recycle_held: s.held ? 1 : 0,
          recycled_usdc: s.usdc,
          recycled_usdt: s.usdt,
          recycle_address: s.address,
          recycle_tx: s.tx,
          recycle_order_id: s.orderId,
          recycle_note: s.note,
          recycle_deadline: s.deadline,
          recycle_mexc_before: s.mexcBefore,
          recycle_usdt_before: s.usdtBefore,
        });
      },
      intendedAmount: async () => row.usdc_out,
    };
  }

  private catchUpStore(): JobStore {
    const db = this.d.db;
    return {
      label: 'catch-up sweep',
      resumeHint: '/recycle catchup',
      sellCid: `${this.cfg.chain.name}catchupr`,
      load: (): RecycleState => {
        const raw = db.getState(CATCHUP_STATE_KEY);
        if (!raw) return emptyRecycleState();
        try {
          return { ...emptyRecycleState(), ...(JSON.parse(raw) as Partial<RecycleState>) };
        } catch {
          return emptyRecycleState();
        }
      },
      save: (s) => {
        db.setState(CATCHUP_STATE_KEY, JSON.stringify(s));
      },
      intendedAmount: async () => toFloat(await this.d.chain.tokenBalance(this.cfg.usdc), this.stableDec()),
      onDone: () => {
        db.setState(CATCHUP_DONE_KEY, '1');
      },
    };
  }

  // ------------------------------------------------------------- machine

  /** Advance one job one step (falls through: a fast job can finish in one call). */
  private async advance(store: JobStore, gas: GasInfo, nativeUsd: number): Promise<void> {
    let s = store.load();
    if (s.status === 'done' || s.held) return;

    // Step 1: resolve the MEXC deposit address (DB cache, else GET-first;
    // POST-generate only inside depositAddress when GET returns no address
    // at all — never preferred), persist before any send.
    if (s.status === '') {
      const amount = s.amount ?? (await store.intendedAmount());
      if (amount === null || amount <= 0) return; // nothing to recycle
      s.amount = amount;
      const address = await this.resolveAddress(store, s);
      if (!address) return; // held inside (fetch failed / deposits disabled)
      s.address = address;
      s.status = 'address';
      store.save(s);
      await this.d.tg.send(`♻️ ${store.label}: MEXC USDC deposit address ${address} — sending ${usd(amount)} USDC there, then selling for USDT on MEXC spot.`);
    }

    // Step 2: send the USDC (proceeds only, capped at the live wallet balance) after a gas sanity check.
    if (s.status === 'address') {
      s = store.load();
      const walletUsdc = toFloat(await this.d.chain.tokenBalance(this.cfg.usdc), this.stableDec());
      const amount = Math.min(s.amount ?? 0, walletUsdc);
      if (amount < RECYCLE_MIN_USDC) {
        await this.hold(store, s, `wallet USDC ${usd(walletUsdc)} is below the $${RECYCLE_MIN_USDC} floor (proceeds ${usd(s.amount ?? 0)} may already have moved) — nothing sent`);
        return;
      }
      const data = ERC20_TRANSFER.encodeFunctionData('transfer', [s.address!, toUnits(amount, this.stableDec())]);
      let est: bigint;
      try {
        est = await this.d.chain.simulate({ to: this.cfg.usdc, data, value: 0n });
      } catch (e) {
        await this.hold(store, s, `USDC transfer simulation failed (would revert): ${errMsg(e)} — nothing sent`);
        return;
      }
      const limit = (est * 13n) / 10n;
      const costWei = limit * gas.effective;
      const nativeBal = await this.d.chain.ethBalance();
      const reserveWei = ethers.parseUnits(String(this.cfg.minEthForGas), 18);
      if (nativeBal < costWei + reserveWei) {
        await this.hold(
          store,
          s,
          `gas reserve too low: wallet has ${ethers.formatEther(nativeBal)} ${this.nativeSymbol()}, the transfer needs ~${ethers.formatEther(costWei)} + ${this.cfg.minEthForGas} ${this.nativeSymbol()} reserve — nothing sent`,
        );
        return;
      }
      // Persist the pre-send state BEFORE the irreversible send.
      s.mexcBefore = (await this.d.mexc.balances()).USDC ?? 0;
      s.deadline = this.now() + RECYCLE_CREDIT_TIMEOUT_MS;
      store.save(s);
      const r = await this.d.chain.send({ to: this.cfg.usdc, data }, limit, gas, this.cfg.txTimeoutSec, (hash) => {
        s.tx = hash;
        s.usdc = amount;
        s.status = 'sent';
        store.save(s);
      });
      s = store.load();
      if (r.refused) return; // an earlier tx is unresolved: not an attempt, retry next scan
      let mined = r.ok;
      if (r.unknown) {
        if (!s.tx) {
          await this.hold(store, s, `USDC deposit send outcome unknown and no tx hash was recorded — check the wallet on ${this.cfg.chain.explorer} before retrying`);
          return;
        }
        const rc = this.d.chain.receipt ? await this.d.chain.receipt(s.tx).catch(() => null) : null;
        if (rc?.status === 1) {
          mined = true; // mined after all: fall through to the sent Telegram below
        } else if (rc?.status === 0) {
          // Failed on-chain: nothing left the wallet, retry the send next scan.
          s.tx = null;
          s.usdc = null;
          s.status = 'address';
          s.mexcBefore = null;
          s.deadline = 0;
          store.save(s);
          return;
        } else {
          await this.hold(store, s, `USDC deposit tx ${s.tx} outcome unknown (no receipt yet) — check the wallet before retrying`);
          return;
        }
      }
      if (!mined) {
        await this.hold(store, s, `USDC deposit send failed: ${r.reason ?? 'reverted'} — nothing left the wallet`);
        return;
      }
      if (s.status === 'address') {
        // onSigned never fired (some chain impls): persist from the result.
        s.tx = r.hash ?? null;
        s.usdc = amount;
        s.status = 'sent';
        store.save(s);
      }
      const sentHash = s.tx ?? r.hash ?? '';
      await this.d.tg.send(`📤 ♻️ ${store.label}: sent ${usd(s.usdc ?? amount)} USDC to MEXC (${s.address})\n${explorerTxUrl(this.cfg.chain, sentHash)}`);
    }

    // Step 3: wait until the deposit credits on MEXC.
    if (s.status === 'sent') {
      s = store.load();
      // Restart safety: a recorded tx that failed on-chain must not be waited on.
      if (s.tx && this.d.chain.receipt) {
        const rc = await this.d.chain.receipt(s.tx).catch(() => null);
        if (rc?.status === 0) {
          s.tx = null;
          s.usdc = null;
          s.status = 'address';
          s.mexcBefore = null;
          s.deadline = 0;
          store.save(s);
          return; // next scan re-sends (nothing left the wallet)
        }
        // status 1 or null (still pending): keep waiting for the MEXC credit below.
      }
      const credited = await this.depositCredited(s);
      if (credited === 'error') return; // MEXC lookup failed transiently: retry next scan, no state change
      if (credited) {
        s.status = 'credited';
        store.save(s);
        await this.d.tg.send(`✅ ♻️ ${store.label}: ${usd(s.usdc ?? 0)} USDC credited on MEXC — selling for USDT on MEXC spot.`);
      } else if (this.now() > s.deadline) {
        await this.hold(
          store,
          s,
          `USDC deposit ${s.tx ?? ''} did not credit on MEXC within ${RECYCLE_CREDIT_TIMEOUT_MS / 60_000} min — check MEXC deposits; the funds are on the deposit address or in transit, nothing was sold`,
        );
        return;
      } else {
        return; // still waiting
      }
    }

    // Step 4: market-sell the USDC for USDT ON MEXC SPOT (USDCUSDT).
    if (s.status === 'credited') {
      s = store.load();
      // A sell already placed before a crash/ambiguity: look it up first, never place twice.
      // A lookup that THROWS is transient (not "not placed"): keep the recorded
      // client id and retry next scan — clearing it would double-sell.
      if (s.orderId) {
        let found: Order | null;
        try {
          found = await this.d.mexc.getOrderByClientId('USDCUSDT', s.orderId);
        } catch {
          return;
        }
        if (found) {
          s.status = 'sold';
          store.save(s);
        } else {
          // Never placed: clear and place below.
          s.orderId = null;
          s.usdtBefore = null;
          store.save(s);
        }
      }
      if (s.status === 'credited') {
        const info = await this.d.mexc.exchangeInfo().catch(() => null);
        const sym = info?.find((x) => x.symbol === 'USDCUSDT');
        if (!sym || !sym.isSpotTradingAllowed || !sym.orderTypes.includes('MARKET')) {
          await this.hold(store, s, `USDCUSDT market unavailable on MEXC (no MARKET sell) — ${usd(s.usdc ?? 0)} USDC is sitting on MEXC, sell it by hand`);
          return;
        }
        const bals = await this.d.mexc.balances();
        const amount = Math.min(s.usdc ?? 0, bals.USDC ?? 0);
        if (amount < (s.usdc ?? 0) * 0.99 || amount < RECYCLE_MIN_USDC) {
          await this.hold(store, s, `MEXC USDC balance ${usd(bals.USDC ?? 0)} is short of the credited ${usd(s.usdc ?? 0)} — nothing sold`);
          return;
        }
        const step = Number(sym.baseSizePrecision) || 10 ** -(sym.baseAssetPrecision ?? 2);
        const qty = floorToStep(amount, step).toFixed(decimalsOfStep(step));
        // Persist the client order id + USDT balance BEFORE placing (idempotency).
        s.orderId = store.sellCid;
        s.usdtBefore = bals.USDT ?? 0;
        store.save(s);
        const { orderId } = await placeSafely(this.d.mexc, 'USDCUSDT', store.sellCid, () => this.d.mexc.marketSell('USDCUSDT', qty, store.sellCid), this.sleep);
        log.info(`recycle ${store.label}: USDCUSDT market sell ${qty} id=${orderId}`);
        s = store.load();
        s.status = 'sold';
        store.save(s);
      }
    }

    // Step 5: confirm the fill and book the USDT received.
    if (s.status === 'sold') {
      s = store.load();
      let found: Order | null;
      try {
        found = await this.d.mexc.getOrderByClientId('USDCUSDT', s.orderId!);
      } catch {
        return; // transient lookup failure: keep 'sold', retry next scan
      }
      if (!found) {
        // The sell was never placed: retry from 'credited'.
        s.status = 'credited';
        s.orderId = null;
        s.usdtBefore = null;
        store.save(s);
        return;
      }
      let o = found.status === 'FILLED' ? found : await this.d.mexc.getOrder('USDCUSDT', found.orderId).catch(() => found);
      if (o.status !== 'FILLED') {
        try {
          o = await cancelAndConfirm(this.d.mexc, 'USDCUSDT', found.orderId, this.sleep);
        } catch (e) {
          await this.hold(store, s, `USDCUSDT sell ${found.orderId} is ${o.status} and could not be confirmed/cancelled: ${errMsg(e)} — check MEXC open orders`);
          return;
        }
      }
      if (o.status !== 'FILLED') {
        await this.hold(store, s, `USDCUSDT sell only partly filled (${o.executedQty}) — the rest is still USDC on MEXC, sell it by hand`);
        return;
      }
      const usdtAfter = (await this.d.mexc.balances()).USDT ?? 0;
      let received = usdtAfter - (s.usdtBefore ?? 0);
      if (!(received > 0)) received = Number(o.cummulativeQuoteQty); // balance read off (concurrent flow): fall back to the order
      s.usdt = received;
      s.status = 'done';
      store.save(s);
      store.onDone?.(s);
      await this.d.tg.send(`✅ ♻️ ${store.label}: recycled ${usd(s.usdc ?? 0)} USDC → ${usd(received)} USDT on MEXC — USDT balance restored for the next buy.`);
    }
  }

  // ------------------------------------------------------------- helpers

  /**
   * Deposit credited? BOTH: the MEXC free USDC balance grew by (almost) the
   * sent amount AND MEXC's deposit history shows OUR tx hash — a concurrent
   * unrelated deposit must not satisfy this job. If the deposit-history
   * endpoint itself is missing (404), the balance alone decides (logged).
   * 'error' = a transient MEXC lookup failure: retry next scan, no state change.
   */
  private async depositCredited(s: RecycleState): Promise<boolean | 'error'> {
    let bals: Record<string, number>;
    try {
      bals = await this.d.mexc.balances();
    } catch {
      return 'error';
    }
    const amount = s.usdc ?? 0;
    if ((bals.USDC ?? 0) < (s.mexcBefore ?? 0) + amount * 0.999) return false;
    if (!s.tx) return true; // no hash recorded (old job): the balance is the only signal
    try {
      const rec = await this.d.mexc.findDeposit('USDC', (s.deadline || this.now()) - RECYCLE_CREDIT_TIMEOUT_MS - 60_000, s.tx);
      return rec !== null;
    } catch (e) {
      if (e instanceof MexcApiError && e.status === 404) {
        log.warn('recycle: MEXC deposit history endpoint missing (404) — credit decided by balance alone');
        return true;
      }
      return 'error';
    }
  }

  /**
   * Resolve the MEXC USDC deposit address for this chain. Preference order:
   *   (1) a verified address cached in the DB for this chain+network wins —
   *       it pins the address, so later recycles reuse it even if the GET
   *       list order changes (the list is newest-first, so any later
   *       generate elsewhere would otherwise move the top);
   *   (2) GET-first: the GET list's first entry IS the address the MEXC app
   *       currently displays as current/default (one shared list per coin,
   *       newest first — verified live 2026-11-23).
   *   POST-generate is never PREFERRED here: it MINTS A NEW address
   *   on every call (verified live 2026-11-23: three POSTs returned three
   *   different new addresses), so preferring it would send funds to an
   *   address the user has never seen. (Precision note: depositAddress()
   *   itself still POSTs as a last resort when GET returns NO address at
   *   all — in practice GET always returns the app-current address for
   *   USDC, and the recycle Telegram announces the exact address before
   *   any send.) The network comes from coinConfigs
   *   — the LONG `network` field (e.g. "Ethereum(ERC20)"), NEVER the short
   *   `netWork`: this endpoint rejects "ETH" with 400 code 10232 (live,
   *   transfer #3 recycle, 2026-11-23). Returns null (after holding the
   *   job) when no usable address can be had.
   */
  private async resolveAddress(store: JobStore, s: RecycleState): Promise<string | null> {
    let configs: CoinConfig[];
    try {
      configs = await this.d.mexc.coinConfigs();
    } catch (e) {
      return this.hold(store, s, `MEXC coin configs lookup failed: ${errMsg(e)} — nothing sent`);
    }
    const usdc = configs.find((c) => c.coin.toUpperCase() === 'USDC');
    const net = usdc && networkFor(this.cfg.chain, usdc.networkList);
    if (!net) return this.hold(store, s, `no USDC network for ${this.cfg.chain.name} in MEXC coin configs — nothing sent`);
    if (!net.depositEnable) return this.hold(store, s, `USDC deposits disabled on ${net.network ?? net.netWork} (MEXC) — nothing sent`);
    const network = net.network ?? net.netWork;
    const cacheKey = VERIFIED_ADDR_KEY(this.cfg.chain.name, network);
    let address: string | null = isDepositAddress(this.d.db.getState(cacheKey)) ? this.d.db.getState(cacheKey)! : null;
    if (!address) {
      try {
        address = await this.d.mexc.depositAddress('USDC', network);
      } catch (e) {
        return this.hold(store, s, `MEXC deposit address fetch failed (${network}): ${errMsg(e)} — nothing sent`);
      }
      if (!isDepositAddress(address)) {
        return this.hold(store, s, `MEXC returned no usable deposit address for USDC/${network} — nothing sent`);
      }
      this.d.db.setState(cacheKey, address);
    }
    // First use per chain+network: Telegram the address BEFORE any funds move,
    // so Yahia can eyeball it against the MEXC app.
    const key = ADDR_ALERT_KEY(this.cfg.chain.name, network);
    if (!this.d.db.getState(key)) {
      this.d.db.setState(key, address);
      await this.d.tg.send(`🏦 ${store.label}: first recycle on ${this.cfg.chain.name} (${network}) — MEXC USDC deposit address:\n${address}\nPlease check it against the MEXC app before any funds move.`);
    }
    return address;
  }

  /** Determinate hold: persist held + reason, Telegram once, stop the job until /recycle. Returns null for convenience. */
  private async hold(store: JobStore, s: RecycleState, reason: string): Promise<null> {
    s.held = true;
    s.note = reason;
    store.save(s);
    log.warn(`recycle ${store.label}: HOLD — ${reason}`);
    await this.d.tg.send(`⏸️ ♻️ ${store.label}: recycle HELD — ${reason}\nNo funds moved for this step. Send ${store.resumeHint} to resume.`);
    return null;
  }
}
