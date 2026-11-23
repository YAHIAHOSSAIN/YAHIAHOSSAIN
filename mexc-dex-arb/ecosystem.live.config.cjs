// pm2 start ecosystem.live.cjs
// Live twin (transfer mode since 2026-11-21): CEX buy -> withdraw -> DEX sell
// only, never DEX->CEX. Reads paper history from the paper bot's DB
// (PAPER_DB_PATH, readonly); keeps its own DB for live trades + risk state.
// Same MEXC key + hot wallet as the paper bot (paper mode never touches real
// funds, so no double-commit).
// Requires: PRIVATE_KEY in .env, a funded hot wallet, and a MEXC key with Spot
// Trading + Withdraw enabled (withdrawal-address whitelist = hot wallet only).
// Do NOT start until those are ready.
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
        MAX_TRADE_USD: '500', // owner decision 2026-11-23: $300 -> $500 (ladder caps at $500; MIN $100, gap 2%, loss floor unchanged)
        MIN_TRADE_USD: '100', // depth ladder $100–500 per trade; random size only for unknown-TVL pools
        TRANSFER_DRIFT_BPS: '100', // drift reserve 1.5% -> 1.0% (owner decision 2026-11-22)
        UNLIMITED_APPROVAL: 'yes', // owner decision 2026-11-21: approve MaxUint256 once per token, skip the approve tx on later sales (~12s saved per sale). Risk accepted: a compromised spender could drain the token balance.
        // Live watchlist (owner decision 2026-11-22): 100 tokens by volume — MEXC 24h vol >= $10k
        // and DEX 24h vol >= $10k. Paper bot keeps the shared .env values (MEXC vol $50k, no DEX filter, no cap).
        MIN_MEXC_VOLUME_USD: '10000',
        MIN_DEX_VOLUME_USD: '5000', // owner decision 2026-11-23: $10k -> $5k (universe ~102 -> ~127 tokens; thinner DEX tokens, depth/exact gates still apply)
        MIN_POOL_LIQUIDITY_USD: '20000', // owner decision 2026-11-23: pool floor $50k -> $20k (impact <=0.7% and size <=1% of pool caps still apply)
        TRANSFER_UNIVERSE_MAX: '200', // owner decision 2026-11-23: 100 -> 200 (more tokens scanned per tick, trade chance up; scan cycle gets slower)
        SCAN_MIN_GAP_PCT: '2', // owner decision 2026-11-22: rough gap 3% -> 2% (more candidates; exact-quote profit gate still applies)
        DEX_ARB_ENABLED: 'yes', // owner decision 2026-11-23: DEX-DEX detection on (detection only — no trade/execution)
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
