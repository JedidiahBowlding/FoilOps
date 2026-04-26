const path = require('path')
const ROOT = __dirname

module.exports = {
  apps: [
    {
      name: 'foilops-web',
      cwd: ROOT,
      script: 'pnpm',
      args: 'start',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 30,
      min_uptime: '15s',
      kill_timeout: 5000,
      error_file: path.join(ROOT, 'logs/foilops-web-error.log'),
      out_file: path.join(ROOT, 'logs/foilops-web-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env_file: path.join(ROOT, '.env'),
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'foilops-receiver',
      cwd: path.join(ROOT, 'Auto-solana-trading-bot'),
      script: 'bash',
      args: '-lc "if [ -x target/release/trading-bot ]; then exec ./target/release/trading-bot; elif [ -x target/debug/trading-bot ]; then exec ./target/debug/trading-bot; else exec cargo run --release --bin trading-bot; fi"',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 30,
      min_uptime: '15s',
      kill_timeout: 5000,
      error_file: path.join(ROOT, 'logs/foilops-receiver-error.log'),
      out_file: path.join(ROOT, 'logs/foilops-receiver-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env_file: path.join(ROOT, '.env'),
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
