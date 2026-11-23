// pm2 start ecosystem.gate-paper.config.cjs
// Gate.io PAPER scout (transfer mode, Ethereum): scans Gate prices vs DEX,
// simulates transfers only — no real orders, no real withdrawals, no keys.
// ALLOW_WITHDRAWALS=yes is required by config validation for STRATEGY=transfer
// even in paper mode, but paper trades are simulated (see transfer.ts: paper path
// inserts a simulated trade, never calls withdraw). No GATE_API_KEY/SECRET needed:
// paper mode reads Gate public market data only (config requires keys in live only).
// Own DB + logs; never touches the live bots or their DBs.
// Pool liquidity floor $50k (Yahia, 2026-11-23) — was $150k default.
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb-gate-paper',
      script: 'dist/main.js',
      cwd: __dirname,
      env: {
        CHAIN: 'ethereum',
        MODE: 'paper',
        STRATEGY: 'transfer', // CEX buy -> withdraw -> DEX sell only (never DEX->CEX)
        CEX: 'gate',
        ALLOW_WITHDRAWALS: 'yes', // validation requires it for transfer; paper never withdraws (simulated)
        DB_PATH: 'data/gate-paper.sqlite',
        MAX_TRADE_USD: '300',
        MIN_MEXC_VOLUME_USD: '10000',
        MIN_DEX_VOLUME_USD: '10000',
        MIN_POOL_LIQUIDITY_USD: '50000',
        TRANSFER_UNIVERSE_MAX: '100',
        SCAN_MIN_GAP_PCT: '2',
      },
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '60s',
      exp_backoff_restart_delay: 5000,
      kill_timeout: 240000,
      time: true,
      out_file: 'logs/gate-paper.out.log',
      error_file: 'logs/gate-paper.error.log',
    },
  ],
};
