// pm2 start status-ecosystem.config.cjs
// Runs ONLY the read-only status page. It does not trade, does not write to
// the bot DB, and reads no secrets — MODE/CHAIN/MAX_TRADE_USD/WATCHLIST_MAX
// below are display values only (copy them from the bot's .env by hand).
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb-status',
      script: 'status-server.mjs',
      cwd: __dirname,
      env: {
        STATUS_PORT: 3102,
        STATUS_HOST: '127.0.0.1',
        CHAIN: 'ethereum',
        MODE: 'paper',
        MAX_TRADE_USD: 300,
        LIVE_MAX_TRADE_USD: 500, // live bots raised $300 -> $500 (owner decision 2026-11-23); display only
        WATCHLIST_MAX: 50,
        DB_PATH: 'data/ethereum.sqlite',
      },
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '10s',
      out_file: 'logs/status.out.log',
      error_file: 'logs/status.error.log',
    },
  ],
};
