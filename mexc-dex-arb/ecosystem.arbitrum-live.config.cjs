// pm2 start ecosystem.arbitrum-live.config.cjs
// Live twin on Arbitrum: same transfer mode as the Ethereum live twin
// (CEX buy -> withdraw -> DEX sell only, never DEX->CEX), same MEXC key +
// hot wallet (paper mode never touches real funds, so no double-commit).
// Arbitrum universe is small: only 16 MEXC tokens have an ARB network with
// deposit+withdraw+contract (verified 2026-11-22 via `CHAIN=arbitrum npm run
// networks` — matched names: ARB | Arbitrum One(ARB)); the $10k/$10k volume
// filters cut it further. Same live settings as Ethereum ($300 size, 2% gap
// threshold, unlimited approval).
// Requires: PRIVATE_KEY in .env, Arbitrum ETH in the hot wallet (>= 0.01,
// MIN_ETH_FOR_GAS — the wallet held only ~0.00013 ETH on Arbitrum at build
// time, so the twin refuses to start until it is funded), and a MEXC key
// with Spot Trading + Withdraw permission (withdrawal-address whitelist =
// hot wallet only). Do NOT start until those are ready.
// NOTE (M2): two live chains share ONE MEXC account + hot wallet but keep
// separate DBs/risk — both draw from the same MEXC USDT balance, so combined
// live exposure is 2x $300 per cycle. NOTE (gas): the OP-stack l1Fee capture
// does not apply to Arbitrum receipts (they carry gasUsedForL1, not l1Fee),
// so the receipt-level gas omits the L1 data portion; the pre-trade gate adds
// a conservative L1_FEE_USD=0.10 estimate per transfer instead (typical
// Arbitrum swap L1 fee is ~$0.02-0.10 — revisit after the first real
// Arbitrum receipts are measured).
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb-arbitrum-live',
      script: 'dist/main.js',
      cwd: __dirname,
      env: {
        CHAIN: 'arbitrum',
        MODE: 'live',
        STRATEGY: 'transfer', // CEX buy -> withdraw -> DEX sell only (never DEX->CEX)
        ALLOW_WITHDRAWALS: 'yes', // transfer mode needs MEXC withdrawals (key needs Withdraw permission + whitelist = hot wallet only)
        RPC_URL: 'https://arbitrum.publicnode.com',
        SEND_RPC_URL: 'https://arbitrum.publicnode.com', // mevblocker is Ethereum-only; Arbitrum uses publicnode for sends too
        DB_PATH: 'data/arbitrum-live.sqlite',
        MAX_TRADE_USD: '300',
        MIN_TRADE_USD: '100', // random size $100–300 per trade (owner decision 2026-11-22)
        TRANSFER_DRIFT_BPS: '100', // drift reserve 1.5% -> 1.0% (owner decision 2026-11-22)
        UNLIMITED_APPROVAL: 'yes', // owner decision 2026-11-21: approve MaxUint256 once per token, skip the approve tx on later sales (~12s saved per sale). Risk accepted: a compromised spender could drain the token balance.
        MIN_MEXC_VOLUME_USD: '10000',
        MIN_DEX_VOLUME_USD: '10000',
        TRANSFER_UNIVERSE_MAX: '100',
        SCAN_MIN_GAP_PCT: '2',
        L1_FEE_USD: '0.10', // conservative estimate of the Arbitrum L1 data fee per transfer (see NOTE above)
      },
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '60s',
      exp_backoff_restart_delay: 5000,
      kill_timeout: 240000,
      time: true,
      out_file: 'logs/arbitrum-live.out.log',
      error_file: 'logs/arbitrum-live.error.log',
    },
  ],
};
