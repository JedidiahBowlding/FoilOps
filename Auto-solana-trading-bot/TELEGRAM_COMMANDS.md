# Telegram Bot Commands Reference

This document lists all available Telegram commands for the Solana Auto Trading Bot.

## Quick Start Commands

### `/start`

- **Description**: Initialize the bot and display welcome message
- **Usage**: `/start`
- **Response**: Shows quick start guide and links to available commands

### `/help`

- **Description**: Display all available commands
- **Usage**: `/help`
- **Response**: Complete list of all commands with descriptions

## Status & Monitoring Commands

### `/status`

- **Description**: Show bot and wallet status
- **Usage**: `/status`
- **Response**: Current bot status (enabled/disabled), trading mode, slippage, target wallet, MEV service

### `/balance`

- **Description**: Show current wallet balance
- **Usage**: `/balance`
- **Response**: SOL balance, USDC balance, other token count, total value in USD

### `/trades`

- **Description**: Show recent trades
- **Usage**: `/trades`
- **Response**: Last 10 trades with direction, amount, token mint, and timestamp

### `/stats`

- **Description**: Show trading statistics
- **Usage**: `/stats`
- **Response**: Total trades, win/loss ratio, profit/loss, ROI, average trade value, 24h volume

### `/history`

- **Description**: Show wallet transaction history
- **Usage**: `/history`
- **Response**: Last 20 transactions with direction, amount, token, and status

### `/logs`

- **Description**: Get bot activity logs
- **Usage**: `/logs`
- **Response**: Recent bot logs (startup, connections, trades, confirmations)

### `/config`

- **Description**: Show complete bot configuration
- **Usage**: `/config`
- **Response**: Trading settings, target wallet, MEV service, supported pools

## Configuration Commands

### `/slippage [value]`

- **Description**: Get or set slippage tolerance
- **Usage**:
  - `/slippage` - Show current slippage
  - `/slippage 5` - Set slippage to 5%
- **Response**: Current slippage percentage or confirmation of new value

### `/target [pubkey]`

- **Description**: Get or set target wallet to copy trade
- **Usage**:
  - `/target` - Show current target wallet
  - `/target 9B5X4...` - Set new target wallet
- **Response**: Current target wallet or confirmation of new target

### `/mev`

- **Description**: Show MEV protection settings
- **Usage**: `/mev`
- **Response**: Current MEV service, available services (Jito, Nozomi, Zero Slot)

### `/setmev [service]`

- **Description**: Change MEV protection service
- **Usage**: `/setmev jito` or `/setmev nozomi` or `/setmev zeroslot`
- **Response**: Confirmation of MEV service change

## Bot Control Commands

### `/enable`

- **Description**: Enable trading bot
- **Usage**: `/enable`
- **Response**: ✅ Trading bot enabled

### `/disable`

- **Description**: Disable trading bot (pauses all trading)
- **Usage**: `/disable`
- **Response**: ⛔ Trading bot disabled

### `/pause`

- **Description**: Pause trading temporarily (keeps monitoring active)
- **Usage**: `/pause`
- **Response**: ⏸️ Trading paused

### `/resume`

- **Description**: Resume trading after pause
- **Usage**: `/resume`
- **Response**: ▶️ Trading resumed

### `/cancel`

- **Description**: Cancel any pending trades
- **Usage**: `/cancel`
- **Response**: Status of pending trades or confirmation of cancellation

## Testing Commands

### `/test [direction] [amount]`

- **Description**: Execute a test trade without real funds
- **Usage**: `/test buy 0.5` or `/test sell 10`
- **Direction**: `buy` or `sell`
- **Amount**: Quantity in SOL or token amount
- **Response**: Test trade confirmation with details

## Command Examples

### Basic Usage Flow

```
1. /start              # Initialize bot
2. /status             # Check status
3. /target 9B5X4...    # Set wallet to copy
4. /slippage 3         # Set 3% slippage
5. /enable             # Enable trading
6. /stats              # View statistics
```

### Advanced Configuration

```
/setmev jito           # Use Jito for MEV protection
/config                # View all settings
/balance               # Check wallet balance
/history               # View all transactions
```

### Trading Management

```
/pause                 # Pause temporarily
/resume                # Resume trading
/test buy 0.1          # Test trade execution
/cancel                # Cancel pending trade
/disable               # Disable bot
```

## Bot State Information

The bot maintains the following state that can be queried:

- **Enabled/Disabled**: Whether the bot is actively trading
- **Paused/Running**: Whether trading is temporarily paused
- **Slippage**: Current slippage tolerance (%)
- **Target Wallet**: Wallet address being copied
- **MEV Service**: Active MEV protection service

## Response Format

All responses use formatted text with:

- **Emoji indicators**: ✅ (success), ❌ (error), ⏸️ (paused), ▶️ (running), etc.
- **HTML formatting**: Bold titles, code formatting for addresses
- **Clear sections**: Organized information with bullet points
- **Inline updates**: Immediate feedback on configuration changes

## Error Handling

Invalid commands receive a helpful error message:

- Unknown commands show: "❌ Unknown command. Use /help to see available commands"
- Invalid parameters show: "❌ Invalid format. Use: [correct usage]"
- Invalid addresses show: "❌ Invalid Solana address format"

## Integration with Bot Logic

The Telegram bot commands integrate with:

- **Trading Engine**: Receive trade execution updates
- **WebSocket Listener**: Real-time transaction monitoring
- **RPC Client**: Fetch balance and transaction data
- **MEV Services**: Display and manage MEV protection
- **Configuration**: Persist settings via environment variables

---

**Note**: All commands are case-insensitive. The bot responds only to authorized users in private messages.
