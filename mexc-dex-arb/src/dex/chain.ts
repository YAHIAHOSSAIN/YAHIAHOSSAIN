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
      const r = await this.send({ to: token, data: c.interface.encodeFunctionData('approve', [spender, 0n]) }, APPROVE_GAS, gas, 60);
      cost += r.gasCostWei;
      if (!r.ok) return { ...r, gasCostWei: cost };
    }
    const r = await this.send({ to: token, data: c.interface.encodeFunctionData('approve', [spender, amount]) }, APPROVE_GAS, gas, 60);
    return { ...r, gasCostWei: cost + r.gasCostWei };
  }

  /** eth_call + estimateGas. Returns the gas estimate, or throws with the revert reason. */
  async simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint> {
    const req = { from: this.address, to: tx.to, data: tx.data, value: tx.value };
    await this.provider.call(req);
    return this.provider.estimateGas(req);
  }

  /**
   * Sign and send through the private RPC, wait for inclusion.
   * If it is not mined within timeoutSec, replace it with a 0-value self-transfer (cancel).
   */
  async send(
    tx: { to: string; data: string; value?: bigint },
    gasLimit: bigint,
    gas: GasInfo,
    timeoutSec: number,
  ): Promise<TxResult> {
    const wallet = this.wallet!;
    const nonce = await this.provider.getTransactionCount(wallet.address, 'pending');
    const base = { chainId: 1n, type: 2, nonce, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip };
    const signed = await wallet.signTransaction({ ...base, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit });
    const hash = ethers.keccak256(signed);
    await this.sendProvider.send('eth_sendRawTransaction', [signed]);
    log.info(`tx sent ${hash}`);

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
        receipt = await this.provider.getTransactionReceipt(hash);
        const cancelReceipt = await this.provider.getTransactionReceipt(cancelHash);
        if (cancelReceipt) {
          return { ok: false, hash, gasCostWei: cancelReceipt.gasUsed * cancelReceipt.gasPrice, reason: 'not mined, cancelled' };
        }
        if (!receipt) await sleep(3000);
      }
      if (!receipt) return { ok: false, hash, gasCostWei: 0n, reason: 'not mined and cancel not confirmed: CHECK WALLET' };
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
