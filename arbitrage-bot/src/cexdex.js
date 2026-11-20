// MEXC <-> Uniswap V2 (Ethereum) arbitrage bot.
//
// This is NOT atomic like the flash-swap bot: you keep inventory on both sides
// (USDC + WETH in your wallet, USDT + ETH on MEXC) and trade both legs.
// Over time inventory drifts to one side and has to be rebalanced (deposit/withdraw).
import 'dotenv/config';
import { ethers } from 'ethers';
import { Mexc } from './mexc.js';
import { bestOpportunity } from './cexdexMath.js';

const env = (k, d) => process.env[k] ?? d;
const cfg = {
  rpcUrl: env('RPC_URL'),
  sendRpcUrl: env('SEND_RPC_URL', 'https://rpc.flashbots.net/fast'),
  privateKey: env('PRIVATE_KEY', ''),
  mexcKey: env('MEXC_API_KEY', ''),
  mexcSecret: env('MEXC_API_SECRET', ''),
  symbol: env('MEXC_SYMBOL', 'ETHUSDT'),
  pair: env('DEX_PAIR', '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'), // Uniswap V2 USDC/WETH
  router: env('DEX_ROUTER', '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'), // Uniswap V2 Router02
  weth: env('WETH', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2').toLowerCase(),
  takerFee: Number(env('MEXC_TAKER_FEE', '0.0005')),
  maxSize: Number(env('MAX_SIZE_ETH', '1')),
  step: Number(env('SIZE_STEP_ETH', '0.01')),
  minNetUsd: Number(env('MIN_NET_USD', '5')),
  dexSlippage: Number(env('DEX_SLIPPAGE', '0.002')), // 0.2%
  gasLimit: BigInt(env('DEX_GAS_LIMIT', '180000')),
  dryRun: env('DRY_RUN', 'true').toLowerCase() !== 'false',
};
if (!cfg.rpcUrl) throw new Error('RPC_URL is required (see .env.example)');

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112, uint112, uint32)',
];
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[])',
  'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] path, address to, uint deadline) returns (uint[])',
];

const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
const wallet = cfg.privateKey ? new ethers.Wallet(cfg.privateKey, provider) : null;
const sendWallet = wallet ? wallet.connect(new ethers.JsonRpcProvider(cfg.sendRpcUrl)) : null;
const mexc = new Mexc({ apiKey: cfg.mexcKey, apiSecret: cfg.mexcSecret });
const pair = new ethers.Contract(cfg.pair, PAIR_ABI, provider);
const canTrade = Boolean(wallet && cfg.mexcKey && cfg.mexcSecret);

let usd; // { address, decimals, contract }
let wethIsToken0;

async function init() {
  const [t0, t1] = (await Promise.all([pair.token0(), pair.token1()])).map((a) => a.toLowerCase());
  if (t0 !== cfg.weth && t1 !== cfg.weth) throw new Error('DEX_PAIR has no WETH side');
  wethIsToken0 = t0 === cfg.weth;
  const usdAddr = wethIsToken0 ? t1 : t0;
  const c = new ethers.Contract(usdAddr, ERC20_ABI, provider);
  usd = { address: usdAddr, decimals: Number(await c.decimals()), contract: c };

  if (canTrade && !cfg.dryRun) {
    // One-time approvals so the router can spend USDC and WETH.
    for (const token of [usdAddr, cfg.weth]) {
      const t = new ethers.Contract(token, ERC20_ABI, wallet);
      if ((await t.allowance(wallet.address, cfg.router)) < ethers.MaxUint256 / 2n) {
        console.log(`approving router for ${token}`);
        await (await t.approve(cfg.router, ethers.MaxUint256)).wait();
      }
    }
  }
}

/** Largest trade (in ETH) our balances allow, per direction. */
async function sizeLimits(midPrice) {
  if (!canTrade) return { DEX_BUY: cfg.maxSize, CEX_BUY: cfg.maxSize };
  const weth = new ethers.Contract(cfg.weth, ERC20_ABI, provider);
  const [walletUsd, walletWeth, cex] = await Promise.all([
    usd.contract.balanceOf(wallet.address),
    weth.balanceOf(wallet.address),
    mexc.balances(),
  ]);
  const quoteAsset = cfg.symbol.replace(/^ETH/, '');
  return {
    // Buy on DEX with wallet USDC, sell ETH held on MEXC.
    DEX_BUY: Math.min(cfg.maxSize, (Number(walletUsd) / 10 ** usd.decimals / midPrice) * 0.98, cex.ETH ?? 0),
    // Buy on MEXC with USDT, sell wallet WETH on DEX.
    CEX_BUY: Math.min(cfg.maxSize, ((cex[quoteAsset] ?? 0) / midPrice) * 0.98, Number(ethers.formatEther(walletWeth))),
  };
}

async function executeDex(opp) {
  const router = new ethers.Contract(cfg.router, ROUTER_ABI, sendWallet);
  const deadline = Math.floor(Date.now() / 1000) + 60;
  const sizeWei = ethers.parseEther(opp.size.toFixed(8));
  const slip = BigInt(Math.round(cfg.dexSlippage * 1e6));
  const opts = { gasLimit: cfg.gasLimit };
  let tx;
  if (opp.direction === 'DEX_BUY') {
    const maxIn = (opp.dexAmount * (1_000_000n + slip)) / 1_000_000n;
    tx = await router.swapTokensForExactTokens(sizeWei, maxIn, [usd.address, cfg.weth], wallet.address, deadline, opts);
  } else {
    const minOut = (opp.dexAmount * (1_000_000n - slip)) / 1_000_000n;
    tx = await router.swapExactTokensForTokens(sizeWei, minOut, [cfg.weth, usd.address], wallet.address, deadline, opts);
  }
  console.log(`  DEX tx ${tx.hash}`);
  return tx.wait();
}

async function executeCex(opp) {
  const side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
  const qty = (opp.direction === 'CEX_BUY' ? opp.cexQty : opp.size).toFixed(4); // ETHUSDT step is 0.0001
  // Limit at the worst price we walked in the book: fills immediately, never at a worse price.
  const order = await mexc.placeLimit(cfg.symbol, side, qty, opp.cexPrice.toFixed(2));
  console.log(`  MEXC ${side} ${qty} @ ${opp.cexPrice} id=${order.orderId}`);
  await new Promise((r) => setTimeout(r, 1500));
  const status = await mexc.getOrder(cfg.symbol, order.orderId);
  if (status.status !== 'FILLED') {
    await mexc.cancelOrder(cfg.symbol, order.orderId).catch(() => {});
    console.warn(`  MEXC filled only ${status.executedQty}/${qty}: inventory is unbalanced, check manually`);
  }
  return status;
}

async function scan(blockNumber) {
  const [book, reserves, fee] = await Promise.all([
    mexc.depth(cfg.symbol, 50),
    pair.getReserves(),
    provider.getFeeData(),
  ]);
  const [reserveWeth, reserveUsd] = wethIsToken0 ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
  const mid = (book.bids[0][0] + book.asks[0][0]) / 2;
  const dexPrice = Number(reserveUsd) / 10 ** usd.decimals / Number(ethers.formatEther(reserveWeth));
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const gasUsd = Number(ethers.formatEther(cfg.gasLimit * gasPrice)) * mid;

  const limits = await sizeLimits(mid);
  const common = {
    book, reserveWeth, reserveUsd, gasUsd,
    usdDecimals: usd.decimals, takerFee: cfg.takerFee, step: cfg.step,
  };
  const opp = ['DEX_BUY', 'CEX_BUY']
    .map((dir) => bestOpportunity({ ...common, maxSize: limits[dir], directions: [dir] }))
    .filter(Boolean)
    .sort((a, b) => b.net - a.net)[0];

  console.log(
    `[${blockNumber}] MEXC ${mid.toFixed(2)} | DEX ${dexPrice.toFixed(2)} | gas $${gasUsd.toFixed(2)}` +
      (opp ? ` | ${opp.direction} ${opp.size} ETH net $${opp.net.toFixed(2)}` : ' | no opportunity'),
  );
  if (!opp || opp.net < cfg.minNetUsd) return;
  if (cfg.dryRun || !canTrade) return console.log('  DRY_RUN: would trade');

  // DEX leg first: it is the one most likely to fail (revert, slippage, not mined).
  // Only hedge on MEXC once it succeeded, so a failure never leaves us one-sided.
  const receipt = await executeDex(opp).catch((e) => {
    console.error('  DEX failed:', e.shortMessage || e.message);
    return null;
  });
  if (!receipt || receipt.status !== 1) return console.log('  DEX leg failed, skipping MEXC leg');
  await executeCex(opp);
}

async function main() {
  await init();
  console.log(`MEXC ${cfg.symbol} <-> Uniswap V2 ${cfg.pair}. DRY_RUN=${cfg.dryRun} trading=${canTrade}`);
  let busy = false;
  provider.on('block', async (n) => {
    if (busy) return; // previous trade still in progress
    busy = true;
    try {
      await scan(n);
    } catch (e) {
      console.error(`[${n}] error:`, e.shortMessage || e.message);
    } finally {
      busy = false;
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
