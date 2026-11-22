// pm2 start ecosystem.bsc-live.config.cjs
// Live twin on BSC (BNB Smart Chain): same transfer mode as the Ethereum live
// twin (CEX buy -> withdraw -> DEX sell only, never DEX->CEX), same MEXC key +
// hot wallet, own DB (data/bsc-live.sqlite), own pm2 app
// (mexc-dex-arb-bsc-live). BSC universe is big: 259 MEXC tokens have a BSC
// network with deposit+withdraw+contract (verified 2026-11-22 via `npm run
// networks` — matched names: BSC | BNB Smart Chain(BEP20)). Same live
// settings as Ethereum ($300 size, 2% gap threshold, unlimited approval).
// BSC differences: the DEX stable is USDT with 18 decimals (not USDC 6) — the
// stableDecimals fix (2026-11-22) threads the on-chain decimals into the
// transfer engine, without which every BSC amount would be off by 1e12. Gas
// is paid in BNB.
// Requires: PRIVATE_KEY in .env, BNB in the hot wallet (>= 0.01,
// MIN_ETH_FOR_GAS — the wallet held only ~0.00114 BNB on BSC at build time,
// so the twin refuses to start until it is funded), and a MEXC key with Spot
// Trading + Withdraw permission (withdrawal-address whitelist = hot wallet
// only). Do NOT start until those are ready.
// NOTE (M2): live chains share ONE MEXC account + hot wallet but keep
// separate DBs/risk — all draw from the same MEXC USDT balance, so combined
// live exposure is 3x $300/cycle once Ethereum + Arbitrum + BSC all run.
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb-bsc-live',
      script: 'dist/main.js',
      cwd: __dirname,
      env: {
        CHAIN: 'bsc',
        MODE: 'live',
        STRATEGY: 'transfer', // CEX buy -> withdraw -> DEX sell only (never DEX->CEX)
        ALLOW_WITHDRAWALS: 'yes', // transfer mode needs MEXC withdrawals (key needs Withdraw permission + whitelist = hot wallet only)
        RPC_URL: 'https://bsc-dataseed.binance.org',
        SEND_RPC_URL: 'https://bsc.rpc.blxrbdn.com', // bloXroute Protect: private sends, no public mempool (free, no key; verified chain 56, 2026-11-22)
        DB_PATH: 'data/bsc-live.sqlite',
        MAX_TRADE_USD: '300',
        MIN_TRADE_USD: '100', // random size $100–300 per trade (owner decision 2026-11-22)
        TRANSFER_DRIFT_BPS: '100', // drift reserve 1.5% -> 1.0% (owner decision 2026-11-22)
        UNLIMITED_APPROVAL: 'yes', // owner decision 2026-11-21: approve MaxUint256 once per token, skip the approve tx on later sales (~12s saved per sale). Risk accepted: a compromised spender could drain the token balance.
        MIN_MEXC_VOLUME_USD: '10000',
        MIN_DEX_VOLUME_USD: '10000',
        TRANSFER_UNIVERSE_MAX: '100',
        SCAN_MIN_GAP_PCT: '2',
      },
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '60s',
      exp_backoff_restart_delay: 5000,
      kill_timeout: 240000,
      time: true,
      out_file: 'logs/bsc-live.out.log',
      error_file: 'logs/bsc-live.error.log',
    },
  ],
};
