import TelegramBot from 'node-telegram-bot-api'

export const TELEGRAM_COMMANDS: TelegramBot.BotCommand[] = [
  { command: 'start', description: 'Open the FoilOps main menu' },
  { command: 'discovery', description: 'Hidden-gem discovery menu' },
  { command: 'discoveries', description: 'Ranked Solana and Robinhood launches' },
  { command: 'robinhood', description: 'Robinhood Chain candidates' },
  { command: 'candidate', description: 'Inspect token evidence and history' },
  { command: 'discovery_status', description: 'Check autonomous ingestion health' },
  { command: 'discovery_scan', description: 'Scan launch sources now (admin)' },
  { command: 'add', description: 'Track a wallet' },
  { command: 'manage', description: 'Manage tracked wallets' },
  { command: 'scam_intelligence', description: 'Open scam intelligence tools' },
  { command: 'trace_token', description: 'Investigate a token and developer' },
  { command: 'flow_map', description: 'Trace wallet fund flows' },
  { command: 'trading_status', description: 'View trading system status' },
  { command: 'trading_dashboard', description: 'Open trading operations dashboard' },
  { command: 'settings', description: 'Configure notifications' },
  { command: 'help', description: 'Show the complete command directory' },
]
