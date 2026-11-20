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

export type { GasInfo, TxResult } from './txsender.js';
import { type GasInfo, type KeyValue, type TxResult, TxSender } from './txsender.js';

export class Chain {
  readonly provider: ethers.JsonRpcProvider;
  readonly sendProvider: ethers.JsonRpcProvider;
  readonly wallet?: ethers.Wallet;
  private decimalsCache = new Map<string, number>();

  readonly tx: TxSender;

  /** `unresolvedStore` persists the unresolved-tx record (SQLite state) so a restart does not forget it. */
  constructor(rpcUrl: string, sendRpcUrl: string, privateKey: string, private priorityFeeGwei: number, unresolvedStore?: KeyValue) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl, 1, { staticNetwork: true });
    this.sendProvider = new ethers.JsonRpcProvider(sendRpcUrl, 1, { staticNetwork: true });
    if (privateKey) this.wallet = new ethers.Wallet(privateKey, this.provider);
    const chain = this; // eslint-disable-line @typescript-eslint/no-this-alias
    this.tx = new TxSender(
      {
        get address() {
          return chain.address;
        },
        confirmedNonce: () => this.provider.getTransactionCount(this.address, 'latest'),
        receipt: (h) => this.provider.getTransactionReceipt(h),
        knowsTx: async (h) => Boolean((await this.provider.getTransaction(h).catch(() => null)) ?? (await this.sendProvider.getTransaction(h).catch(() => null))),
        sign: async (t) => {
          const raw = await this.wallet!.signTransaction({ chainId: 1n, type: 2, ...t });
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
}
