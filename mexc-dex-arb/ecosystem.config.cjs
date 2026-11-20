// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'mexc-dex-arb',
      script: 'dist/main.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      restart_delay: 10000,
      time: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
    },
  ],
};
