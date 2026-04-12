export class CommandsDirectory {
  static getFullCommandDirectory(): string {
    return `
🤖 <b>FoilOps Bot - Complete Command Directory</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>📱 WALLET TRACKING</b>
Essential commands for managing your tracked wallets

🔸 <b>/start</b> - Initialize bot & show main menu
🔸 <b>/add</b> - Add a new wallet to track
🔸 <b>/delete</b> - Remove a wallet from tracking
🔸 <b>/manage</b> - View & manage all tracked wallets
🔸 <b>/my_wallet</b> - Show your FoilOps wallet details

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>🚀 TRADING CONTROL</b>
Commands to control your trading bot

<i>Status & Monitoring:</i>
🔹 <b>/trading_status</b> - Show current bot status & settings
🔹 <b>/trading_balance</b> - Display wallet balance & holdings
🔹 <b>/trading_trades</b> - Show last 5 executed trades
🔹 <b>/trading_decisions</b> - View recent trading decisions
🔹 <b>/trading_safety</b> - Display safety gate configuration
🔹 /trading_dashboard - Open web dashboard (HTML/API/CSV)

<i>Trading Control:</i>
🔹 <b>/trading_enable</b> - Turn on trading bot
🔹 <b>/trading_disable</b> - Turn off trading bot
🔹 <b>/trading_pause</b> - Pause trading (monitoring continues)
🔹 <b>/trading_resume</b> - Resume paused trading
🔹 <b>/trading_kill</b> - Emergency kill switch (cancels all orders)

<i>Configuration:</i>
🔹 <b>/trading_execution_mode</b> [paper|live] - Toggle dry-run vs live
   <i>Example: /trading_execution_mode paper</i>
🔹 <b>/trading_profile</b> [conservative|balanced|aggressive] - Set risk profile
   <i>Example: /trading_profile balanced</i>
🔹 <b>/trading_mode</b> [copy_trade|signal_based|manual] - Set trading mode
🔹 <b>/trading_size</b> [amount] - Set default trade size in SOL
   <i>Example: /trading_size 5.5</i>
🔹 <b>/trading_slippage</b> [%] - Set max slippage tolerance
   <i>Example: /trading_slippage 3</i>
🔹 <b>/trading_target</b> [wallet] - Set wallet to copy-trade from
   <i>Example: /trading_target 9B5X4abc...</i>
🔹 <b>/trading_tighten_risk</b> - Reduce position sizes immediately

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>👥 SOURCE WALLET MANAGEMENT (Phase 2 Control)</b>
Advanced commands for multi-wallet copy-trading

<i>Watchlist & Profiles:</i>
🔹 <b>/trading_sources</b> - List all source wallets with profiles
🔹 <b>/trading_source_add</b> [wallet] - Add source wallet
   <i>Example: /trading_source_add 9B5X4abc...</i>
🔹 <b>/trading_source_remove</b> [wallet] - Remove source wallet
🔹 <b>/trading_source_profile</b> [wallet] [preset] [notes] - Set profile
   <i>Presets: shadow|scalp|swing|defensive|blocked</i>
   <i>Example: /trading_source_profile 9B5X4... scalp aggressive copy-trader</i>

<i>Exposure Controls:</i>
🔹 <b>/trading_source_cap</b> [wallet] [SOL] - Set max exposure per wallet
   <i>Example: /trading_source_cap 9B5X4... 50</i>
🔹 <b>/trading_source_uncap</b> [wallet] - Remove exposure cap

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>📊 OPERATIONS & MONITORING (Phase 3 Ops Surface)</b>
Real-time metrics, audit trail, and retry capabilities

🔹 <b>/trading_metrics</b> - Show receiver health metrics
   Shows: received, accepted, executed, blocked, failed, duplicates, retried

🔹 <b>/trading_journal</b> - Show trade execution history
   Displays: last 10 trades with status, amount, profile, reason

🔹 <b>/trading_failures</b> - Show failed signals queue
   Displays: last 10 failed signals with retry count

🔹 <b>/trading_retry_failed</b> [signal_id|all] - Retry failed signals
   <i>Example: /trading_retry_failed all (retries up to 10)</i>
   <i>Example: /trading_retry_failed abc123 (retry specific signal)</i>

🔹 <b>/trading_alert_quality</b> [min_score] [min_trace] - Set alert thresholds
   <i>Example: /trading_alert_quality 70 3</i>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>🔎 SCAM INTELLIGENCE & SECURITY</b>
Advanced threat detection and fund flow analysis

🔹 <b>/settings</b> - Configure notification preferences
🔹 <b>/scam_intelligence</b> - Open scam detection menu

   <i>Sub-commands available through menu:</i>
   • Flag Wallet - Mark & trace suspicious wallet
   • Flow Map - Visualize fund movements
   • Trace Token - Investigate token & developer
   • Scam Feed - View latest threat alerts

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>💰 ACCOUNT & SUBSCRIPTION</b>
Manage your plan and support

🔹 <b>/upgrade</b> - View plan options & upgrade
   FREE → HOBBY → PRO → WHALE
🔹 <b>/donate</b> - Support FoilOps development
🔹 <b>/help</b> - Show this command directory

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>👥 GROUP CHAT MANAGEMENT</b>
Using FoilOps in Telegram groups

🔹 <b>/help_group</b> - Group setup instructions
🔹 <b>/groups</b> - Manage group subscriptions
🔹 <b>/help_notify</b> - Notification preferences

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>⚡ QUICK START</b>

1️⃣ <b>/start</b> - Initialize & open main menu
2️⃣ <b>/add</b> - Add first wallet to track
3️⃣ <b>/settings</b> - Configure alerts
4️⃣ <b>/upgrade</b> - (Optional) Get PRO features
5️⃣ <b>/help</b> - View full command directory

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>💡 TIPS</b>

✨ Use inline buttons in menus for guided setup
✨ Admin-only commands work in private chats only
✨ Trading commands require bot admin privileges
✨ Copy wallet addresses with \`/src\` format
✨ Set profiles to automate multi-wallet strategies

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<i>Need help? Check the /help menu or visit our docs</i>
    `.trim()
  }

  static getCommandsByCategory() {
    return {
      'Wallet Tracking': {
        '/start': 'Initialize bot & show main menu',
        '/add': 'Add new wallet to track',
        '/delete': 'Remove tracked wallet',
        '/manage': 'View & manage all wallets',
        '/my_wallet': 'Show your wallet details',
      },
      'Trading Status': {
        '/trading_status': 'Current bot status & config',
        '/trading_balance': 'Wallet balance & holdings',
        '/trading_trades': 'Last 5 executed trades',
        '/trading_decisions': 'Recent trading decisions',
        '/trading_safety': 'Safety gate settings',
      },
      'Trading Control': {
        '/trading_enable': 'Start trading bot',
        '/trading_disable': 'Stop trading bot',
        '/trading_pause': 'Pause trading',
        '/trading_resume': 'Resume trading',
        '/trading_kill': 'Emergency kill switch',
      },
      'Trading Configuration': {
        '/trading_execution_mode': 'Toggle paper/live mode',
        '/trading_profile': 'Set risk profile',
        '/trading_mode': 'Set trading mode (copy_trade/signal_based)',
        '/trading_size': 'Set default trade size',
        '/trading_slippage': 'Set slippage tolerance',
        '/trading_target': 'Set copy-trade wallet',
        '/trading_tighten_risk': 'Emergency risk reduction',
      },
      'Source Wallet Management': {
        '/trading_sources': 'List source wallets with profiles',
        '/trading_source_add': 'Add source wallet',
        '/trading_source_remove': 'Remove source wallet',
        '/trading_source_profile': 'Set wallet profile',
        '/trading_source_cap': 'Set wallet exposure cap',
        '/trading_source_uncap': 'Remove wallet cap',
      },
      'Operations & Metrics': {
        '/trading_metrics': 'Receiver health metrics',
        '/trading_journal': 'Trade execution history',
        '/trading_failures': 'Failed signals queue',
        '/trading_retry_failed': 'Retry failed signals',
        '/trading_alert_quality': 'Set alert thresholds',
        '/trading_dashboard': 'Web dashboard access',
      },
      'Scam Intelligence': {
        '/settings': 'Configure preferences',
        '/scam_intelligence': 'Threat detection menu',
        '/help_notify': 'Notification help',
      },
      Account: {
        '/upgrade': 'View & upgrade plan',
        '/donate': 'Support FoilOps',
        '/help': 'Full command directory',
        '/groups': 'Group management',
        '/help_group': 'Group setup help',
      },
    }
  }

  static getQuickReference(): string {
    return `
<b>📋 QUICK REFERENCE</b>

<b>Most Used Commands:</b>
• /trading_status - Check if bot is running
• /trading_metrics - See execution health  
• /trading_sources - Review source wallets
• /trading_journal - View recent trades
• /trading_failures - Check failed signals  
• /trading_retry_failed - Rerun failed trades

<b>Safety Commands:</b>
• /trading_pause - Pause instantly
• /trading_tighten_risk - Reduce position sizes
• /trading_kill - Emergency stop

<b>Setup Commands:</b>
• /start - First time setup
• /add - Track wallet
• /upgrade - Get more features
    `.trim()
  }
}
