// pm2 start ecosystem.live.cjs
// Live twin: trades only tokens proven profitable in paper (see provenTokens).
// Reads paper history from the paper bot's DB (PAPER_DB_PATH, readonly); keeps its
// own DB for live trades + risk state. Same MEXC key + hot wallet as the paper bot
// (paper mode never touches real funds, so no double-commit).
// Requires: PRIVATE_KEY in .env, a funded hot wallet, and a MEXC key with Spot
// Trading enabled (withdraw stays OFF). Do NOT start until those are ready.
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb-ethereum-live',
      script: 'dist/main.js',
      cwd: __dirname,
      env: {
        CHAIN: 'ethereum',
        MODE: 'live',
        STRATEGY: 'transfer', // CEX buy -> withdraw -> DEX sell only (never DEX->CEX)
        ALLOW_WITHDRAWALS: 'yes', // transfer mode needs MEXC withdrawals (key needs Withdraw permission + whitelist = hot wallet only)
        DB_PATH: 'data/ethereum-live.sqlite',
        PAPER_DB_PATH: 'data/ethereum.sqlite',
        MAX_TRADE_USD: '300',
        UNLIMITED_APPROVAL: 'yes', // owner decision 2026-11-21: approve MaxUint256 once per token, skip the approve tx on later sales (~12s saved per sale). Risk accepted: a compromised spender could drain the token balance.
      },
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '60s',
      exp_backoff_restart_delay: 5000,
      kill_timeout: 240000,
      time: true,
      out_file: 'logs/ethereum-live.out.log',
      error_file: 'logs/ethereum-live.error.log',
    },
  ],
};
