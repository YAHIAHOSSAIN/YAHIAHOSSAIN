// Transaction sending with a local nonce manager and persisted "unresolved" state.
//
// Our txs go through a PRIVATE RPC, so the public RPC's 'pending' count does not see them.
// Rules:
//  - Nonces are tracked locally, starting from the confirmed ('latest') count.
//  - A tx whose outcome we do not know (broadcast error that may still have been accepted, or not mined
//    and its cancel not mined either) is "unresolved". While one exists, no new tx is sent, so a nonce is
//    never reused by accident. The unresolved record is PERSISTED, so a restart does not forget it.
//  - A clear RPC rejection (insufficient funds, nonce too low, underpriced, any JSON-RPC error answer)
//    is NOT unresolved: nothing was broadcast, the nonce is rolled back.
//  - An unresolved tx that no RPC knows any more after DROP_AFTER_MS is treated as dropped.
import { errMsg, log } from '../log.js';

export interface GasInfo {
  baseFee: bigint;
  tip: bigint;
  /** What we expect to actually pay per gas (baseFee + tip). */
  effective: bigint;
  /** maxFeePerGas to set on the tx (headroom for base fee rises). */
  maxFee: bigint;
}

export interface TxResult {
  ok: boolean;
  hash?: string;
  gasCostWei: bigint;
  reason?: string;
  /** We do NOT know whether it executed: never unwind or retry; pause for a human. */
  unknown?: boolean;
  /** The RPC clearly refused it: nothing was broadcast, nothing to wait for. */
  rejected?: boolean;
  /** Not even attempted, because an earlier tx is still unresolved. Not a failed attempt. */
  refused?: boolean;
  gasUsed?: bigint;
  gasPrice?: bigint;
  /** ms from signing to the receipt (inclusion latency). */
  inclusionMs?: number;
  /** OP-stack L1 data fee (wei), when the raw receipt carries one (Base/Optimism). */
  l1FeeWei?: bigint;
  /** Arbitrum L1 data gas (units), when the raw receipt carries gasUsedForL1
   * instead of l1Fee. No USD price is in the receipt, so this is recorded
   * for visibility only; the pre-trade gate uses L1_FEE_USD. */
  l1GasUsed?: bigint;
}

export interface Unresolved {
  nonce: number;
  hashes: string[];
  since: number;
  /** Highest maxFeePerGas / tip used at this nonce (a replacement must outbid them). */
  maxFee?: string;
  tip?: string;
  /** false while we are still waiting normally (in flight); true once the outcome is unknown. */
  unknown?: boolean;
}

export interface TxBackend {
  address: string;
  confirmedNonce(): Promise<number>;
  receipt(hash: string): Promise<{ status: number | null; gasUsed: bigint; gasPrice: bigint } | null>;
  /** Optional raw receipt (ethers does not expose the OP-stack L1 fee): only l1Fee is read. */
  rawReceipt?(hash: string): Promise<{ l1Fee?: bigint; gasUsedForL1?: bigint } | null>;
  /** true if the public or the private RPC still knows this tx (pending or mined). */
  knowsTx(hash: string): Promise<boolean>;
  sign(tx: { nonce: number; to: string; data: string; value: bigint; gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }): Promise<{ raw: string; hash: string }>;
  broadcast(raw: string): Promise<void>;
  /** Optional second route (public RPC) for /cancelnonce. */
  broadcastPublic?(raw: string): Promise<void>;
  gas(): Promise<GasInfo>;
}

export interface KeyValue {
  get(): string | undefined;
  set(v: string | null): void;
}

export const DROP_AFTER_MS = 10 * 60_000;

/** What a broadcast error means. */
export function classifySendError(e: unknown): 'accepted' | 'rejected' | 'ambiguous' {
  const o = (e ?? {}) as { code?: unknown; error?: { code?: unknown }; info?: { error?: { code?: unknown } } };
  const msg = errMsg(e);
  if (/already known|known transaction|already imported|already in mempool/i.test(msg)) return 'accepted';
  if (['INSUFFICIENT_FUNDS', 'NONCE_EXPIRED', 'REPLACEMENT_UNDERPRICED'].includes(String(o.code))) return 'rejected';
  if (/nonce too low|insufficient funds|underpriced|intrinsic gas too low|exceeds block gas limit|invalid sender|max fee per gas less than/i.test(msg)) {
    return 'rejected';
  }
  // The server answered with a JSON-RPC error object: it explicitly refused the tx.
  if (typeof o.error?.code === 'number' || typeof o.info?.error?.code === 'number') return 'rejected';
  return 'ambiguous'; // timeout, connection reset, 5xx, no answer: it may have been accepted
}

export class TxSender {
  private nextNonce: number | null = null;

  constructor(
    private b: TxBackend,
    private store?: KeyValue,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  get unresolved(): Unresolved | null {
    const v = this.store?.get() ?? this.mem;
    return v ? (JSON.parse(v) as Unresolved) : null;
  }
  private mem: string | undefined;
  private setUnresolved(u: Unresolved | null) {
    const v = u ? JSON.stringify(u) : null;
    if (this.store) this.store.set(v);
    else this.mem = v ?? undefined;
  }

  private async takeNonce(): Promise<number> {
    const confirmed = await this.b.confirmedNonce();
    if (this.nextNonce === null || this.nextNonce < confirmed) this.nextNonce = confirmed;
    return this.nextNonce;
  }

  /**
   * Re-check an unresolved tx. 'clear' once its nonce is consumed on-chain (by it or its cancel),
   * or once no RPC knows it any more after DROP_AFTER_MS (`dropped`). 'pending' otherwise.
   */
  async checkUnresolved(): Promise<{ state: 'clear' | 'pending'; executedHash?: string; ok?: boolean; dropped?: boolean }> {
    const u = this.unresolved;
    if (!u) return { state: 'clear' };
    for (const h of u.hashes) {
      const r = await this.b.receipt(h).catch(() => null);
      if (r) {
        this.setUnresolved(null);
        this.nextNonce = Math.max(this.nextNonce ?? 0, u.nonce + 1);
        return { state: 'clear', executedHash: h, ok: r.status === 1 };
      }
    }
    const confirmed = await this.b.confirmedNonce().catch(() => -1);
    if (confirmed > u.nonce) {
      // Nonce consumed by something we have no receipt for yet (RPC lag).
      this.setUnresolved(null);
      this.nextNonce = Math.max(this.nextNonce ?? 0, confirmed);
      return { state: 'clear' };
    }
    if (this.now() - u.since > DROP_AFTER_MS) {
      const known = await Promise.all(u.hashes.map((h) => this.b.knowsTx(h).catch(() => true)));
      if (!known.some(Boolean)) {
        // Never accepted or dropped by every mempool: the nonce is free again.
        this.setUnresolved(null);
        this.nextNonce = null;
        return { state: 'clear', dropped: true };
      }
    }
    return { state: 'pending' };
  }

  /** Re-read the nonce from the chain on the next send (after /start confirm). */
  resetNonce(): void {
    this.nextNonce = null;
  }

  /**
   * Safe to send now? Only if nothing is unresolved AND our next nonce is exactly the chain's next nonce
   * (a gap would make the tx unminable, so the MEXC leg must not fire).
   */
  async readyToSend(): Promise<{ ok: boolean; reason?: string }> {
    if (this.unresolved && (await this.checkUnresolved()).state === 'pending') {
      const u = this.unresolved!;
      return { ok: false, reason: `tx at nonce ${u.nonce} unresolved (${u.hashes.join(', ')})` };
    }
    const latest = await this.b.confirmedNonce();
    if (this.nextNonce !== null && this.nextNonce !== latest) {
      log.warn(`nonce gap: local ${this.nextNonce}, chain ${latest}; resetting to the chain value`);
      this.nextNonce = latest;
    }
    return { ok: true };
  }

  /**
   * /cancelnonce: replace the unresolved tx with a 0-value self-transfer at the same nonce, at least 2x the
   * highest fee used so far, through the private AND the public RPC. Waits up to `timeoutMs` for the nonce to be used.
   */
  async cancelNonce(timeoutMs = 10 * 60_000): Promise<string> {
    const u = this.unresolved;
    if (!u) return 'Nothing unresolved.';
    const g = await this.b.gas();
    const twice = (x: bigint | undefined) => (x ?? 0n) * 2n;
    const max = (...xs: bigint[]) => xs.reduce((a, c) => (c > a ? c : a));
    const maxFee = max(twice(u.maxFee ? BigInt(u.maxFee) : undefined), g.maxFee * 2n);
    const tip = max(twice(u.tip ? BigInt(u.tip) : undefined), g.tip * 2n);
    const c = await this.b.sign({ nonce: u.nonce, to: this.b.address, data: '0x', value: 0n, gasLimit: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
    this.setUnresolved({ ...u, hashes: [...u.hashes, c.hash], maxFee: maxFee.toString(), tip: tip.toString() });
    await Promise.allSettled([this.b.broadcast(c.raw), this.b.broadcastPublic?.(c.raw)]);
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const r = await this.checkUnresolved();
      if (r.state === 'clear') {
        if (r.executedHash) return `Nonce ${u.nonce} used by ${r.executedHash} (${r.executedHash === c.hash ? 'the cancel' : 'an earlier tx'}, ${r.ok ? 'success' : 'reverted'}).`;
        return `Nonce ${u.nonce} is used${r.dropped ? ' (all txs were dropped)' : ''}, but no receipt was found for our hashes: check etherscan.`;
      }
      await this.sleep(5000);
    }
    return `Nonce ${u.nonce} still not used after ${Math.round(timeoutMs / 60_000)} min (cancel ${c.hash}). Try /cancelnonce again later.`;
  }

  async send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
    onSigned?: (hash: string, nonce: number) => void,
  ): Promise<TxResult> {
    if (this.unresolved && (await this.checkUnresolved()).state === 'pending') {
      return { ok: false, refused: true, gasCostWei: 0n, reason: `earlier tx ${this.unresolved!.hashes[0]} still unresolved` };
    }
    const nonce = await this.takeNonce();
    const { raw, hash } = await this.b.sign({
      nonce, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip,
    });
    this.nextNonce = nonce + 1;
    this.signedAt = this.now();
    onSigned?.(hash, nonce); // persisted before broadcast, so a crash cannot lose the hash
    // In flight from now on, and PERSISTED: if the bot dies while waiting, a restart still knows this nonce is taken.
    const fees = { maxFee: gas.maxFee.toString(), tip: gas.tip.toString() };
    this.setUnresolved({ nonce, hashes: [hash], since: this.now(), ...fees, unknown: false });
    try {
      await this.b.broadcast(raw);
    } catch (e) {
      const kind = classifySendError(e);
      if (kind === 'rejected') {
        this.nextNonce = nonce; // nothing was broadcast: reuse the nonce
        this.setUnresolved(null);
        return { ok: false, rejected: true, hash, gasCostWei: 0n, reason: `RPC rejected the tx: ${errMsg(e)}` };
      }
      if (kind === 'ambiguous') {
        this.setUnresolved({ nonce, hashes: [hash], since: this.now(), ...fees, unknown: true });
        return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `send error, outcome unknown: ${errMsg(e)}` };
      }
      // 'accepted': already in the mempool, just wait for it below.
    }
    log.info(`tx sent ${hash} (nonce ${nonce})`);

    let receipt = await this.waitReceipt(hash, timeoutSec);
    if (receipt) {
      this.setUnresolved(null);
      return this.result(hash, receipt);
    }

    log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
    // Re-read gas: if the base fee spiked while we waited, a cancel priced from the old fee would not mine either.
    const fresh = await this.b.gas().catch(() => gas);
    const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
    const maxFee = [bump(gas.maxFee), bump(fresh.maxFee)].reduce((a, c) => (c > a ? c : a));
    const tip = [bump(gas.tip), bump(fresh.tip)].reduce((a, c) => (c > a ? c : a));
    const cancel = await this.b.sign({ nonce, to: this.b.address, data: '0x', value: 0n, gasLimit: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
    this.setUnresolved({ nonce, hashes: [hash, cancel.hash], since: this.now(), maxFee: maxFee.toString(), tip: tip.toString(), unknown: false }); // before broadcasting the cancel
    await this.b.broadcast(cancel.raw).catch((e) => log.warn(`cancel send failed: ${errMsg(e)}`));
    const deadline = this.now() + timeoutSec * 1000;
    while (this.now() < deadline) {
      receipt = await this.b.receipt(hash).catch(() => null);
      if (receipt) {
        this.setUnresolved(null);
        return this.result(hash, receipt);
      }
      const c = await this.b.receipt(cancel.hash).catch(() => null);
      if (c) {
        this.setUnresolved(null);
        return { ok: false, hash, gasCostWei: c.gasUsed * c.gasPrice, reason: 'not mined, cancelled' };
      }
      await this.sleep(3000);
    }
    this.setUnresolved({ ...this.unresolved!, unknown: true });
    return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `not mined and cancel ${cancel.hash} not confirmed: outcome UNKNOWN` };
  }

  private signedAt = 0;
  private async result(hash: string, r: { status: number | null; gasUsed: bigint; gasPrice: bigint }): Promise<TxResult> {
    // OP-stack chains (Base/Optimism) charge an L1 data fee on top of the L2 gas: it lives in the
    // raw receipt's l1Fee field, which ethers does not expose. Without it the recorded gas
    // understates the true cost (round-3 review, M1). On other chains the field is absent.
    // Arbitrum receipts carry gasUsedForL1 instead (no USD price in the receipt):
    // record the units for visibility; the pre-trade gate uses L1_FEE_USD.
    const raw = await this.b.rawReceipt?.(hash).catch(() => null);
    const l1 = raw?.l1Fee ?? 0n;
    const l1Gas = raw?.gasUsedForL1 ?? 0n;
    const cost = r.gasUsed * r.gasPrice + l1;
    const extra = { gasUsed: r.gasUsed, gasPrice: r.gasPrice, inclusionMs: this.now() - this.signedAt, ...(l1 > 0n ? { l1FeeWei: l1 } : {}), ...(l1Gas > 0n ? { l1GasUsed: l1Gas } : {}) };
    return r.status === 1 ? { ok: true, hash, gasCostWei: cost, ...extra } : { ok: false, hash, gasCostWei: cost, reason: 'reverted', ...extra };
  }

  private async waitReceipt(hash: string, timeoutSec: number) {
    const deadline = this.now() + timeoutSec * 1000;
    while (this.now() < deadline) {
      const r = await this.b.receipt(hash).catch(() => null);
      if (r) return r;
      await this.sleep(2000);
    }
    return null;
  }
}
