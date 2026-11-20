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
      time: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
    },
  ],
};
