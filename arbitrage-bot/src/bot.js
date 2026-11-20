import { ethers } from 'ethers';
import { config } from './config.js';
import { findOptimalAmount, orient } from './math.js';

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];
const ARB_ABI = [
  'function execute(address pairBorrow, address pairSell, bool borrowToken1, uint256 amountIn, uint256 minProfit)',
];

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = config.privateKey ? new ethers.Wallet(config.privateKey, provider) : null;
const sender = wallet ? wallet.connect(new ethers.JsonRpcProvider(config.sendRpcUrl)) : null;
const arb = wallet && config.contract ? new ethers.Contract(config.contract, ARB_ABI, wallet) : null;

/** Load token0/token1 for every pair once and validate the groups. */
async function loadGroups() {
  const groups = [];
  for (const addrs of config.pairGroups) {
    const pairs = await Promise.all(
      addrs.map(async (address) => {
        const c = new ethers.Contract(address, PAIR_ABI, provider);
        const [token0, token1] = await Promise.all([c.token0(), c.token1()]);
        return { address, contract: c, token0: token0.toLowerCase(), token1: token1.toLowerCase() };
      }),
    );
    const { token0, token1 } = pairs[0];
    if (pairs.some((p) => p.token0 !== token0 || p.token1 !== token1)) {
      throw new Error(`Pairs in group ${addrs.join(',')} do not share the same tokens`);
    }
    if (token0 !== config.weth && token1 !== config.weth) {
      throw new Error(`Group ${addrs.join(',')} has no WETH side; profit is measured in WETH`);
    }
    groups.push({ pairs, wethIsToken0: token0 === config.weth });
  }
  return groups;
}

/** Best opportunity across every ordered (borrow, sell) pair in a group. */
async function scanGroup(group) {
  const reserves = await Promise.all(group.pairs.map((p) => p.contract.getReserves()));
  let best = null;
  for (let i = 0; i < group.pairs.length; i++) {
    for (let j = 0; j < group.pairs.length; j++) {
      if (i === j) continue;
      // tokenIn = WETH (we repay and profit in WETH); tokenOut = the other token.
      const borrow = orient(reserves[i][0], reserves[i][1], group.wethIsToken0);
      const sell = orient(reserves[j][0], reserves[j][1], group.wethIsToken0);
      const opp = findOptimalAmount(borrow, sell);
      if (opp.profit > 0n && (!best || opp.profit > best.profit)) {
        best = { ...opp, borrowPair: group.pairs[i], sellPair: group.pairs[j] };
      }
    }
  }
  return best;
}

async function tryExecute(opp, group, gasPrice) {
  // Borrow the non-WETH token: if WETH is token0, we borrow token1.
  const borrowToken1 = group.wethIsToken0;
  const args = [opp.borrowPair.address, opp.sellPair.address, borrowToken1, opp.amountIn, config.minProfitWei];

  let gasLimit = config.gasLimitFallback;
  if (arb) {
    try {
      await arb.execute.staticCall(...args); // simulation: reverts if not profitable on-chain
      gasLimit = await arb.execute.estimateGas(...args);
    } catch (e) {
      console.log(`  simulation reverted: ${e.shortMessage || e.message}`);
      return;
    }
  }

  const gasCost = gasLimit * gasPrice;
  const net = opp.profit - gasCost;
  console.log(
    `  amountIn=${ethers.formatEther(opp.amountIn)} WETH gross=${ethers.formatEther(opp.profit)}` +
      ` gas=${ethers.formatEther(gasCost)} net=${ethers.formatEther(net)}`,
  );
  if (net <= config.minProfitWei) return console.log('  not worth it after gas, skip');
  if (config.dryRun || !arb) return console.log('  DRY_RUN: would send transaction');

  // Require that the on-chain profit at least covers gas plus the margin.
  args[4] = gasCost + config.minProfitWei;
  const tx = await arb.connect(sender).execute(...args, { gasLimit: (gasLimit * 12n) / 10n });
  console.log(`  sent ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  mined in block ${receipt.blockNumber}, status=${receipt.status}`);
}

async function main() {
  if (config.pairGroups.length === 0) throw new Error('PAIR_GROUPS is empty (see .env.example)');
  const groups = await loadGroups();
  console.log(`Watching ${groups.length} group(s). DRY_RUN=${config.dryRun}`);

  let busy = false;
  provider.on('block', async (blockNumber) => {
    if (busy) return; // skip blocks while the previous scan is still running
    busy = true;
    try {
      const { gasPrice } = await provider.getFeeData();
      for (const group of groups) {
        const opp = await scanGroup(group);
        if (!opp) continue;
        console.log(`[block ${blockNumber}] ${opp.borrowPair.address} -> ${opp.sellPair.address}`);
        await tryExecute(opp, group, gasPrice ?? 0n);
      }
    } catch (e) {
      console.error(`[block ${blockNumber}] error:`, e.shortMessage || e.message);
    } finally {
      busy = false;
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
