// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb',
      script: 'dist/main.js',
      cwd: __dirname,
      autorestart: true,
      // Keep restarting (with growing delay) instead of giving up silently after a few crashes.
      max_restarts: 1000,
      min_uptime: '60s',
      exp_backoff_restart_delay: 5000,
      // pm2 sends SIGKILL 1.6 s after SIGINT by default, which would kill the bot halfway through a trade.
      // The bot waits up to TX_TIMEOUT_SEC*2+60 s (max 220 s) for a running trade, so give it 240 s.
      kill_timeout: 240000,
      time: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
    },
  ],
};
