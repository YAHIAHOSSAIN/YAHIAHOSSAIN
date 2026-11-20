import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const config = {
  rpcUrl: required('RPC_URL'),
  // Transactions are sent here. Flashbots Protect keeps them out of the public mempool,
  // so other bots cannot front-run or sandwich your arbitrage.
  sendRpcUrl: process.env.SEND_RPC_URL || 'https://rpc.flashbots.net/fast',
  privateKey: process.env.PRIVATE_KEY || '',
  contract: process.env.ARB_CONTRACT || '',
  // Profit token (repayment token). Mainnet WETH by default.
  weth: (process.env.WETH || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2').toLowerCase(),
  // Comma separated groups of pairs for the same token pair, separated by ';'
  // e.g. "uniPairA,sushiPairA;uniPairB,sushiPairB"
  pairGroups: (process.env.PAIR_GROUPS || '')
    .split(';')
    .map((g) => g.split(',').map((a) => a.trim()).filter(Boolean))
    .filter((g) => g.length >= 2),
  // Extra margin above gas cost, in wei of WETH.
  minProfitWei: BigInt(process.env.MIN_PROFIT_WEI || '0'),
  // Gas the arbitrage tx is assumed to use if estimateGas is not available.
  gasLimitFallback: BigInt(process.env.GAS_LIMIT_FALLBACK || '250000'),
  // Safety: by default the bot only prints opportunities and never sends transactions.
  dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
};
