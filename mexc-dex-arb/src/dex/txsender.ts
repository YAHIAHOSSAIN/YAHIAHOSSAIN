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
}

export interface Unresolved {
  nonce: number;
  hashes: string[];
  since: number;
}

export interface TxBackend {
  address: string;
  confirmedNonce(): Promise<number>;
  receipt(hash: string): Promise<{ status: number | null; gasUsed: bigint; gasPrice: bigint } | null>;
  /** true if the public or the private RPC still knows this tx (pending or mined). */
  knowsTx(hash: string): Promise<boolean>;
  sign(tx: { nonce: number; to: string; data: string; value: bigint; gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }): Promise<{ raw: string; hash: string }>;
  broadcast(raw: string): Promise<void>;
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

  /** Human override after checking the wallet by hand (/start confirm only does this if checkUnresolved agrees). */
  forget(): void {
    this.setUnresolved(null);
    this.nextNonce = null;
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
    onSigned?.(hash, nonce); // persisted before broadcast, so a crash cannot lose the hash
    try {
      await this.b.broadcast(raw);
    } catch (e) {
      const kind = classifySendError(e);
      if (kind === 'rejected') {
        this.nextNonce = nonce; // nothing was broadcast: reuse the nonce
        return { ok: false, rejected: true, hash, gasCostWei: 0n, reason: `RPC rejected the tx: ${errMsg(e)}` };
      }
      if (kind === 'ambiguous') {
        this.setUnresolved({ nonce, hashes: [hash], since: this.now() });
        return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `send error, outcome unknown: ${errMsg(e)}` };
      }
      // 'accepted': already in the mempool, just wait for it below.
    }
    log.info(`tx sent ${hash} (nonce ${nonce})`);

    let receipt = await this.waitReceipt(hash, timeoutSec);
    if (receipt) return this.result(hash, receipt);

    log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
    // Re-read gas: if the base fee spiked while we waited, a cancel priced from the old fee would not mine either.
    const fresh = await this.b.gas().catch(() => gas);
    const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
    const maxFee = [bump(gas.maxFee), bump(fresh.maxFee)].reduce((a, c) => (c > a ? c : a));
    const tip = [bump(gas.tip), bump(fresh.tip)].reduce((a, c) => (c > a ? c : a));
    const cancel = await this.b.sign({ nonce, to: this.b.address, data: '0x', value: 0n, gasLimit: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
    this.setUnresolved({ nonce, hashes: [hash, cancel.hash], since: this.now() }); // before broadcasting the cancel
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
    return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `not mined and cancel ${cancel.hash} not confirmed: outcome UNKNOWN` };
  }

  private result(hash: string, r: { status: number | null; gasUsed: bigint; gasPrice: bigint }): TxResult {
    const cost = r.gasUsed * r.gasPrice;
    return r.status === 1 ? { ok: true, hash, gasCostWei: cost } : { ok: false, hash, gasCostWei: cost, reason: 'reverted' };
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
