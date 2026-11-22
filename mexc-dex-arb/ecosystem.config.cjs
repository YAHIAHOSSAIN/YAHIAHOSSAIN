// pm2 start ecosystem.config.cjs
// One pm2 app per chain, each with its own database. Choose the chains with BOT_CHAINS, e.g.
//   BOT_CHAINS=base pm2 start ecosystem.config.cjs
//   BOT_CHAINS=ethereum,base pm2 start ecosystem.config.cjs
// Each app reads the same .env; CHAIN and DB_PATH are set per app here (they override .env).
//
// WARNING (round-3 review, M2): two chains on ONE MEXC account share the same balances and hot
// wallet, but each keeps its own risk state (daily loss limit, trade count, fail streak, inventory
// caps). Both processes can commit the same inventory and each can spend the full daily loss
// budget. Run one chain per MEXC account, or accept that the limits are per-process, not shared.
const chains = (process.env.BOT_CHAINS || 'ethereum')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

module.exports = {
  apps: chains.map((chain) => ({
    name: `mexc-dex-arb-${chain}`,
    script: 'dist/main.js',
    cwd: __dirname,
    env: { CHAIN: chain, MODE: 'paper', DB_PATH: `data/${chain}.sqlite` },
    autorestart: true,
    // Keep restarting (with growing delay) instead of giving up silently after a few crashes.
    max_restarts: 1000,
    min_uptime: '60s',
    exp_backoff_restart_delay: 5000,
    // pm2 sends SIGKILL 1.6 s after SIGINT by default, which would kill the bot halfway through a trade.
    // The bot waits up to TX_TIMEOUT_SEC*2+60 s (max 220 s) for a running trade, so give it 240 s.
    kill_timeout: 240000,
    time: true,
    out_file: `logs/${chain}.out.log`,
    error_file: `logs/${chain}.error.log`,
  })),
};
