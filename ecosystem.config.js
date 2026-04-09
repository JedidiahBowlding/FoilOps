module.exports = {
  apps: [
    // Option 1: Manage both services as one using start-both.sh
    {
      name: 'wallet-tracker-all',
      script: './start-both.sh',
      exec_mode: 'fork',
      restart_delay: 5000,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
      },
    },
    // Option 2: Manage services separately (uncomment to use instead)
    // {
    //   name: 'rust-trading-bot',
    //   script: 'bash',
    //   args: '-c "cd Auto-solana-trading-bot && cargo build --release && cargo run --release"',
    //   exec_mode: 'fork',
    //   restart_delay: 5000,
    //   error_file: './logs/rust-error.log',
    //   out_file: './logs/rust-out.log',
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    //   env: {
    //     NODE_ENV: 'production',
    //   },
    // },
    // {
    //   name: 'ts-app',
    //   script: 'pnpm',
    //   args: 'start',
    //   exec_mode: 'fork',
    //   restart_delay: 5000,
    //   error_file: './logs/ts-error.log',
    //   out_file: './logs/ts-out.log',
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    //   env: {
    //     NODE_ENV: 'production',
    //   },
    // },
  ],
};
