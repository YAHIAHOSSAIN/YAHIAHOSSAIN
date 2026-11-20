// Ethereum side: balances, gas, exact approvals, simulation and private sending.
import { ethers } from 'ethers';
import { log, errMsg } from '../log.js';
import { sleep } from '../util.js';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const APPROVE_GAS = 60_000n;

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
  /**
   * true = we do NOT know whether the tx executed (not mined, cancel not confirmed either).
   * Callers must not unwind or retry: pause and let a human check the wallet.
   */
  unknown?: boolean;
}

export class Chain {
  readonly provider: ethers.JsonRpcProvider;
  readonly sendProvider: ethers.JsonRpcProvider;
  readonly wallet?: ethers.Wallet;
  private decimalsCache = new Map<string, number>();

  constructor(rpcUrl: string, sendRpcUrl: string, privateKey: string, private priorityFeeGwei: number) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl, 1, { staticNetwork: true });
    this.sendProvider = new ethers.JsonRpcProvider(sendRpcUrl, 1, { staticNetwork: true });
    if (privateKey) this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  get address(): string {
    if (!this.wallet) throw new Error('PRIVATE_KEY not set');
    return this.wallet.address;
  }

  erc20(token: string) {
    return new ethers.Contract(token, ERC20_ABI, this.wallet ?? this.provider);
  }

  async decimals(token: string): Promise<number> {
    const key = token.toLowerCase();
    if (!this.decimalsCache.has(key)) this.decimalsCache.set(key, Number(await this.erc20(token).decimals()));
    return this.decimalsCache.get(key)!;
  }

  async tokenBalance(token: string, owner = this.address): Promise<bigint> {
    return this.erc20(token).balanceOf(owner);
  }

  async ethBalance(owner = this.address): Promise<bigint> {
    return this.provider.getBalance(owner);
  }

  async gas(): Promise<GasInfo> {
    const block = await this.provider.getBlock('latest');
    const baseFee = block?.baseFeePerGas ?? 0n;
    const tip = ethers.parseUnits(String(this.priorityFeeGwei), 'gwei');
    return { baseFee, tip, effective: baseFee + tip, maxFee: baseFee * 2n + tip };
  }

  /** Gas units needed for an approval before the swap (0 if allowance already covers it). */
  async approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint> {
    if (!this.wallet) return 0n;
    const allowance: bigint = await this.erc20(token).allowance(this.address, spender);
    if (allowance >= amount) return 0n;
    return allowance > 0n ? APPROVE_GAS * 2n : APPROVE_GAS; // USDT-style tokens need approve(0) first
  }

  /** Approve exactly `amount` (never unlimited). Sent through the private RPC. */
  async approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult> {
    const c = this.erc20(token);
    let cost = 0n;
    const current: bigint = await c.allowance(this.address, spender);
    if (current >= amount) return { ok: true, gasCostWei: 0n };
    if (current > 0n) {
      const data0 = c.interface.encodeFunctionData('approve', [spender, 0n]);
      const r = await this.send({ to: token, data: data0 }, await this.approveGasLimit(token, data0), gas, 60);
      cost += r.gasCostWei;
      if (!r.ok) return { ...r, gasCostWei: cost };
    }
    const data = c.interface.encodeFunctionData('approve', [spender, amount]);
    const r = await this.send({ to: token, data }, await this.approveGasLimit(token, data), gas, 60);
    return { ...r, gasCostWei: cost + r.gasCostWei };
  }

  /** Some tokens need more than 60k gas for approve: estimate, +30%, never below 60k. */
  private async approveGasLimit(token: string, data: string): Promise<bigint> {
    try {
      const est = await this.provider.estimateGas({ from: this.address, to: token, data });
      const limit = (est * 13n) / 10n;
      return limit > APPROVE_GAS ? limit : APPROVE_GAS;
    } catch {
      return APPROVE_GAS * 2n;
    }
  }

  /** eth_call + estimateGas. Returns the gas estimate, or throws with the revert reason. */
  async simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint> {
    const req = { from: this.address, to: tx.to, data: tx.data, value: tx.value };
    await this.provider.call(req);
    return this.provider.estimateGas(req);
  }

  // ---- Nonce manager ----
  // Our txs go through a PRIVATE RPC, so the public RPC's 'pending' count does not see them.
  // We track nonces locally, starting from the confirmed ('latest') count, and refuse to send
  // while an earlier tx is unresolved (outcome unknown), so a nonce is never reused by accident.
  private nextNonce: number | null = null;
  /** A tx (and maybe its cancel) whose outcome we do not know yet. */
  unresolved: { nonce: number; hashes: string[]; since: number } | null = null;

  private async takeNonce(): Promise<number> {
    const confirmed = await this.provider.getTransactionCount(this.address, 'latest');
    if (this.nextNonce === null || this.nextNonce < confirmed) this.nextNonce = confirmed;
    return this.nextNonce;
  }

  /**
   * Re-check an unresolved tx. Returns 'clear' once its nonce is consumed on-chain (by the tx or its cancel),
   * 'pending' while nothing is mined yet.
   */
  async checkUnresolved(): Promise<{ state: 'clear' | 'pending'; executedHash?: string; ok?: boolean }> {
    const u = this.unresolved;
    if (!u) return { state: 'clear' };
    for (const h of u.hashes) {
      const r = await this.provider.getTransactionReceipt(h).catch(() => null);
      if (r) {
        this.unresolved = null;
        this.nextNonce = Math.max(this.nextNonce ?? 0, u.nonce + 1);
        return { state: 'clear', executedHash: h, ok: r.status === 1 };
      }
    }
    const confirmed = await this.provider.getTransactionCount(this.address, 'latest').catch(() => -1);
    if (confirmed > u.nonce) {
      // Nonce used by something we did not see a receipt for (RPC lag): treat as clear, keep counting up.
      this.unresolved = null;
      this.nextNonce = Math.max(this.nextNonce ?? 0, confirmed);
      return { state: 'clear' };
    }
    return { state: 'pending' };
  }

  /**
   * Sign and send through the private RPC, wait for inclusion.
   * If it is not mined within timeoutSec, replace it with a 0-value self-transfer (cancel).
   * Result states: ok (mined, success), ok:false (mined and reverted / cancelled), unknown (we cannot tell).
   */
  async send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
    onSigned?: (hash: string, nonce: number) => void,
  ): Promise<TxResult> {
    const wallet = this.wallet!;
    if (this.unresolved && (await this.checkUnresolved()).state === 'pending') {
      return { ok: false, gasCostWei: 0n, reason: `refusing to send: earlier tx ${this.unresolved.hashes[0]} unresolved` };
    }
    const nonce = await this.takeNonce();
    const base = { chainId: 1n, type: 2, nonce, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip };
    const signed = await wallet.signTransaction({ ...base, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit });
    const hash = ethers.keccak256(signed);
    this.nextNonce = nonce + 1;
    onSigned?.(hash, nonce); // persisted before broadcast, so a crash cannot lose the hash
    try {
      await this.sendProvider.send('eth_sendRawTransaction', [signed]);
    } catch (e) {
      // The RPC may have accepted it before failing to answer: outcome unknown, nonce may be consumed.
      this.unresolved = { nonce, hashes: [hash], since: Date.now() };
      return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `send error, outcome unknown: ${errMsg(e)}` };
    }
    log.info(`tx sent ${hash} (nonce ${nonce})`);

    let receipt = await this.waitReceipt(hash, timeoutSec);
    if (!receipt) {
      log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
      const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
      const cancel = await wallet.signTransaction({
        ...base,
        maxFeePerGas: bump(gas.maxFee),
        maxPriorityFeePerGas: bump(gas.tip),
        to: wallet.address,
        value: 0n,
        gasLimit: 21_000n,
      });
      const cancelHash = ethers.keccak256(cancel);
      await this.sendProvider.send('eth_sendRawTransaction', [cancel]).catch((e) => log.warn(`cancel send failed: ${errMsg(e)}`));
      const deadline = Date.now() + timeoutSec * 1000;
      while (Date.now() < deadline && !receipt) {
        receipt = await this.provider.getTransactionReceipt(hash).catch(() => null);
        const cancelReceipt = await this.provider.getTransactionReceipt(cancelHash).catch(() => null);
        if (cancelReceipt) {
          return { ok: false, hash, gasCostWei: cancelReceipt.gasUsed * cancelReceipt.gasPrice, reason: 'not mined, cancelled' };
        }
        if (!receipt) await sleep(3000);
      }
      if (!receipt) {
        this.unresolved = { nonce, hashes: [hash, cancelHash], since: Date.now() };
        return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `not mined and cancel ${cancelHash} not confirmed: outcome UNKNOWN` };
      }
    }
    const cost = receipt.gasUsed * receipt.gasPrice;
    return receipt.status === 1 ? { ok: true, hash, gasCostWei: cost } : { ok: false, hash, gasCostWei: cost, reason: 'reverted' };
  }

  private async waitReceipt(hash: string, timeoutSec: number) {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const r = await this.provider.getTransactionReceipt(hash).catch(() => null);
      if (r) return r;
      await sleep(2000);
    }
    return null;
  }
}
