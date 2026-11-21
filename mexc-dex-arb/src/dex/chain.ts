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

/** MaxUint256: the unlimited-approval amount. Only used when UNLIMITED_APPROVAL=yes. */
export const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Amount actually approved: the exact amount, or MaxUint256 when unlimited approval is on.
 * Unlimited skips the approve tx on every later sale of the same token (allowance stays huge),
 * saving ~12s per sale — but a compromised spender could then drain the whole token balance.
 * Owner decision 2026-11-21: unlimited ON for the live twin only (default off everywhere else).
 */
export function approvalAmount(unlimited: boolean, amount: bigint): bigint {
  return unlimited ? MAX_UINT256 : amount;
}

export type { GasInfo, TxResult } from './txsender.js';
import { type GasInfo, type KeyValue, type TxResult, TxSender } from './txsender.js';

/** Median of recent per-block p50 tips, capped; at least 0.001 gwei so a builder still includes the tx. */
export function pickTip(rewards: bigint[], cap: bigint): bigint {
  const floor = 1_000_000n; // 0.001 gwei
  if (!rewards.length) return cap;
  const sorted = [...rewards].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = sorted[Math.floor(sorted.length / 2)];
  const t = median < floor ? floor : median;
  return t > cap ? cap : t;
}

export class Chain {
  readonly provider: ethers.JsonRpcProvider;
  readonly sendProvider: ethers.JsonRpcProvider;
  readonly wallet?: ethers.Wallet;
  private decimalsCache = new Map<string, number>();

  readonly tx: TxSender;

  /** `unresolvedStore` persists the unresolved-tx record (SQLite state) so a restart does not forget it. */
  constructor(
    rpcUrl: string,
    sendRpcUrl: string,
    privateKey: string,
    private priorityFeeGwei: number,
    unresolvedStore?: KeyValue,
    readonly chainId = 1,
    readonly unlimitedApproval = false,
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.sendProvider = new ethers.JsonRpcProvider(sendRpcUrl, chainId, { staticNetwork: true });
    if (privateKey) this.wallet = new ethers.Wallet(privateKey, this.provider);
    const chain = this; // eslint-disable-line @typescript-eslint/no-this-alias
    this.tx = new TxSender(
      {
        get address() {
          return chain.address;
        },
        confirmedNonce: () => this.provider.getTransactionCount(this.address, 'latest'),
        receipt: (h) => this.provider.getTransactionReceipt(h),
        // Raw receipt for the OP-stack L1 fee (ethers' receipt type has no l1Fee field).
        rawReceipt: async (h) => {
          const raw = (await this.provider.send('eth_getTransactionReceipt', [h]).catch(() => null)) as { l1Fee?: string } | null;
          return raw?.l1Fee ? { l1Fee: BigInt(raw.l1Fee) } : null;
        },
        knowsTx: async (h) => Boolean((await this.provider.getTransaction(h).catch(() => null)) ?? (await this.sendProvider.getTransaction(h).catch(() => null))),
        sign: async (t) => {
          const raw = await this.wallet!.signTransaction({ chainId: BigInt(chainId), type: 2, ...t });
          return { raw, hash: ethers.keccak256(raw) };
        },
        broadcast: async (raw) => {
          await this.sendProvider.send('eth_sendRawTransaction', [raw]);
        },
        broadcastPublic: async (raw) => {
          await this.provider.send('eth_sendRawTransaction', [raw]);
        },
        gas: () => this.gas(),
      },
      unresolvedStore,
    );
  }

  get unresolved() {
    return this.tx.unresolved;
  }
  checkUnresolved() {
    return this.tx.checkUnresolved();
  }
  receipt(hash: string) {
    return this.provider.getTransactionReceipt(hash);
  }
  readyToSend() {
    return this.tx.readyToSend();
  }
  cancelNonce() {
    return this.tx.cancelNonce();
  }
  resetNonce() {
    this.tx.resetNonce();
  }
  send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
    onSigned?: (hash: string, nonce: number) => void,
  ): Promise<TxResult> {
    return this.tx.send(tx, gasLimit, gas, timeoutSec, onSigned);
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
    const cap = ethers.parseUnits(String(this.priorityFeeGwei), 'gwei');
    // Tip = median (p50) of the last 20 blocks' tips, capped by PRIORITY_FEE_GWEI. A fixed 1 gwei was
    // 2-7x the whole base fee on mainnet (base fee ~0.15 gwei), i.e. most of the gas cost.
    let tip = cap;
    try {
      const h = (await this.provider.send('eth_feeHistory', ['0x14', 'latest', [50]])) as { reward?: string[][] };
      tip = pickTip((h.reward ?? []).map((r) => BigInt(r[0])), cap);
    } catch {
      // keep the cap
    }
    return { baseFee, tip, effective: baseFee + tip, maxFee: baseFee * 2n + tip };
  }

  /** Gas units needed for an approval before the swap (0 if allowance already covers it). */
  async approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint> {
    if (!this.wallet) return 0n;
    const allowance: bigint = await this.erc20(token).allowance(this.address, spender);
    if (allowance >= amount) return 0n;
    return allowance > 0n ? APPROVE_GAS * 2n : APPROVE_GAS; // USDT-style tokens need approve(0) first
  }

  /** Approve the sell amount (exact by default; MaxUint256 when UNLIMITED_APPROVAL=yes). Sent through the private RPC. */
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
    const target = approvalAmount(this.unlimitedApproval, amount);
    const data = c.interface.encodeFunctionData('approve', [spender, target]);
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
}
