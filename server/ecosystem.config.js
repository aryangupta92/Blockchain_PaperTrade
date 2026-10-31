# BlockTrade — PM2 process definition (production)
# Usage: pm2 start server/ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: 'blocktrade-api',
      script: 'server/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      log_file: './logs/blocktrade-api.log',
      error_file: './logs/blocktrade-api-error.log',
      out_file: './logs/blocktrade-api-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
