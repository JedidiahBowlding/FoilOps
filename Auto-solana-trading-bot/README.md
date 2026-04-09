# 🚀 Solana Auto Trading Bot

<div align="center">

![Solana](https://img.shields.io/badge/Solana-9945FF?style=for-the-badge&logo=solana&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![Helius](https://img.shields.io/badge/Helius-FF6B35?style=for-the-badge&logo=helius&logoColor=white)

**Advanced automated trading bot for Solana tokens using Helius WebSocket feeds with PumpFun and Raydium support**

[Features](#-features) • [Installation](#-installation) • [Configuration](#-configuration) • [Usage](#-usage) • [API](#-api) • [Contributing](#-contributing)

</div>
<div align="center">
  <img width="756" height="321" alt="2025-09-10_13-23-31" src="https://github.com/user-attachments/assets/846541a9-41cb-4355-a0bb-ce1b3359e195" />
</div>

---

## ✨ Features

### 🔥 Core Trading Features

- **Real-time Token Detection**: Monitors Helius WebSocket for new token launches and trading opportunities
- **Multi-DEX Support**: Supports both PumpFun and Raydium DEX for maximum trading flexibility
- **Automated Trading**: Executes buy/sell orders based on market conditions and strategies
- **Risk Management**: Built-in stop-loss and take-profit mechanisms
- **Position Tracking**: Monitors active positions and PnL in real-time
- **Multi-token Support**: Handles multiple concurrent token positions

### 🚀 Advanced Features

- **Nozomi Integration**: MEV protection and transaction prioritization through Nozomi
- **Zero Slot Support**: Ultra-fast transaction execution with Zero Slot integration
- **Telegram Notifications**: Real-time alerts for trades, errors, and status updates
- **Jito Integration**: MEV protection and transaction bundling support

### 🛡️ Safety & Security

- **Slippage Protection**: Configurable slippage tolerance for trades
- **Liquidity Checks**: Validates minimum liquidity before trading
- **Error Handling**: Comprehensive error handling and recovery
- **Rate Limiting**: Built-in rate limiting to prevent API abuse
- **Transaction Retry Logic**: Automatic retry with exponential backoff

### 📊 Monitoring & Analytics

- **Real-time Logging**: Detailed logging with configurable levels using tracing
- **Portfolio Tracking**: Track total PnL and trade statistics
- **Performance Metrics**: Monitor success rates and profitability
- **Transaction Monitoring**: Real-time transaction status and confirmation tracking

### 🔧 Technical Features

- **Rust Performance**: High-performance, memory-safe implementation
- **Modular Architecture**: Clean, maintainable code structure
- **WebSocket Reconnection**: Automatic reconnection with exponential backoff
- **Transaction Optimization**: Optimized for Solana's transaction model
- **Async/Await**: Full async support for concurrent operations

---

## 🚀 Installation

### Prerequisites

- **Rust** (latest stable version)
- **Cargo** (comes with Rust)
- **Solana Wallet** with SOL for trading
- **Helius API Key** (for WebSocket feeds)
- **Telegram Bot** (optional, for notifications)

### Quick Start

1. **Clone the repository**

   ```bash
   git clone https://github.com/radioman/Auto-solana-trading-bot.git
   cd Auto-solana-trading-bot
   ```

2. **Install Rust** (if not already installed)

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```

3. **Set up environment variables**
   Create a `.env` file in the project root:

   ```bash
   touch .env
   ```

4. **Configure your environment**
   Edit `.env` file with your settings:

   ```env
   # Required
   SOL_PUBKEY=your_solana_public_key_here
   RPC_ENDPOINT=your_helius_rpc_endpoint
   RPC_WEBSOCKET_ENDPOINT=your_helius_websocket_endpoint
   TARGET_PUBKEY=target_wallet_to_monitor
   JUP_PUBKEY=jupiter_aggregator_pubkey

   # Optional
   NOZOMI_URL=your_nozomi_endpoint
   NOZOMI_TIP_VALUE=0.001
   ZERO_SLOT_URL=your_zeroslot_endpoint
   ZERO_SLOT_TIP_VALUE=0.001
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHAT_ID=your_telegram_chat_id
   ```

5. **Build and run**

   ```bash
   # Development
   cargo run

   # Release build
   cargo build --release
   ./target/release/trading-bot
   ```

---

## ⚙️ Configuration

### Environment Variables

| Variable                            | Description                                   | Default                 | Required             |
| ----------------------------------- | --------------------------------------------- | ----------------------- | -------------------- |
| `SOL_PUBKEY`                        | Your Solana public key                        | -                       | ✅                   |
| `RPC_ENDPOINT`                      | Helius RPC endpoint                           | -                       | ✅                   |
| `RPC_WEBSOCKET_ENDPOINT`            | Helius WebSocket endpoint                     | -                       | ✅                   |
| `TARGET_PUBKEY`                     | Target wallet to monitor                      | -                       | ✅                   |
| `JUP_PUBKEY`                        | Jupiter aggregator public key                 | -                       | ✅                   |
| `NOZOMI_URL`                        | Nozomi MEV protection endpoint                | -                       | ❌                   |
| `NOZOMI_TIP_VALUE`                  | Nozomi tip amount in SOL                      | `0.001`                 | ❌                   |
| `ZERO_SLOT_URL`                     | Zero Slot endpoint                            | -                       | ❌                   |
| `ZERO_SLOT_TIP_VALUE`               | Zero Slot tip amount in SOL                   | `0.001`                 | ❌                   |
| `TELEGRAM_BOT_TOKEN`                | Telegram bot token                            | -                       | ❌                   |
| `TELEGRAM_CHAT_ID`                  | Telegram chat ID                              | -                       | ❌                   |
| `SIGNAL_RECEIVER_BIND`              | Address for `/signals` and `/health` receiver | `127.0.0.1:8787`        | ❌                   |
| `SIGNAL_RECEIVER_DRY_RUN`           | Keep receiver in non-executing dry-run mode   | `true`                  | ❌                   |
| `SIGNAL_REQUIRE_AUTH`               | Require signed signal headers                 | `true` when not dry-run | ❌                   |
| `SIGNAL_AUTH_SECRET`                | Shared HMAC secret for signed signals         | -                       | ✅ when auth enabled |
| `SIGNAL_DEDUP_WINDOW_SECONDS`       | Idempotency duplicate suppression TTL         | `300`                   | ❌                   |
| `SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS` | Allowed timestamp skew for replay protection  | `120`                   | ❌                   |

### Signal Receiver Health Endpoint

When the receiver is active, use:

```bash
curl http://127.0.0.1:8787/health
```

Expected response fields include:

- `status`
- `mode`
- `authRequired`
- `dedupWindowSeconds`
- `maxTimestampSkewSeconds`

### Trading Configuration

You can modify trading parameters in `src/common/constants.rs`:

```rust
pub const BUY_AMOUNT_SOL: f64 = 0.01;           // SOL per trade
pub const MAX_CONCURRENT_TRADES: usize = 5;     // Max positions
pub const STOP_LOSS_PERCENTAGE: f64 = 20.0;     // Stop loss %
pub const TAKE_PROFIT_PERCENTAGE: f64 = 50.0;   // Take profit %
```

### DEX Configuration

The bot supports both PumpFun and Raydium DEX:

- **PumpFun**: For new token launches and meme coins
- **Raydium**: For established tokens with liquidity pools
- **Automatic Detection**: Bot automatically detects which DEX to use based on token characteristics

---

## 🎯 Usage

### Basic Usage

```bash
# Start the bot in development mode
cargo run

# Build and run in release mode
cargo build --release
./target/release/trading-bot
```

### Advanced Usage

The bot runs as a single executable that:

1. **Connects to Helius WebSocket** for real-time transaction monitoring
2. **Monitors target wallet** for trading opportunities
3. **Executes trades** on PumpFun or Raydium based on detected patterns
4. **Sends notifications** via Telegram (if configured)

### Command Line Options

```bash
# Run with specific configuration
cargo run -- --config custom_config.toml

# Run with debug logging
RUST_LOG=debug cargo run

# Run with specific log level
RUST_LOG=info cargo run
```

### Monitoring

The bot provides real-time monitoring through:

1. **Console Logs**: Detailed logging with timestamps using the `tracing` crate
2. **Telegram Notifications**: Real-time alerts for trades, errors, and status updates
3. **Transaction Tracking**: Real-time transaction status and confirmation monitoring
4. **Performance Metrics**: Built-in performance monitoring and statistics

### Features in Action

- **Helius WebSocket**: Monitors real-time transaction feeds for trading opportunities
- **PumpFun Integration**: Automatically trades new token launches on PumpFun
- **Raydium Integration**: Executes trades on Raydium for established tokens
- **Nozomi Protection**: Uses Nozomi for MEV protection when available
- **Zero Slot Speed**: Leverages Zero Slot for ultra-fast transaction execution
- **Telegram Alerts**: Sends notifications for successful trades, errors, and important events

---

## 📊 API Reference

### Core Modules

#### Trading Engine (`src/engine/`)

- **`strategy.rs`**: Contains trading strategies and swap logic
- **`sniper.rs`**: Implements sniper trading functionality
- **`swap.rs`**: Handles swap execution for both PumpFun and Raydium

#### DEX Integrations (`src/dex/`)

- **`pumpfun.rs`**: PumpFun DEX integration and trading logic
- **`raydium.rs`**: Raydium DEX integration and AMM operations

#### Services (`src/services/`)

- **`nozomi.rs`**: Nozomi MEV protection service
- **`zeroslot.rs`**: Zero Slot ultra-fast transaction service
- **`telegram.rs`**: Telegram notification service
- **`jito.rs`**: Jito MEV protection and bundling
- **`rpc_client.rs`**: RPC client utilities and connection management

### Key Functions

#### Trading Functions

```rust
// Raydium swap execution
pub async fn raydium_swap(
    state: AppState,
    amount_in: f64,
    swap_direction: &str,
    in_type: &str,
    slippage: u64,
    use_jito: bool,
    amm_pool_id: Pubkey,
    pool_state: AmmInfo,
) -> Result<Vec<String>>

// PumpFun swap execution
pub async fn pump_swap(
    state: AppState,
    amount_in: f64,
    // ... parameters
) -> Result<Vec<String>>
```

#### Service Functions

```rust
// Nozomi tip account selection
pub fn get_tip_account() -> Result<Pubkey>

// Zero Slot transaction sending
pub async fn send_transaction(
    &self,
    transaction: &Transaction,
) -> Result<Signature, ClientError>
```

---

## 🔧 Development

### Project Structure

```
src/
├── common/             # Common utilities and configuration
│   ├── cache.rs       # Caching utilities
│   ├── constants.rs   # Configuration constants
│   ├── logger.rs      # Logging utilities
│   ├── mod.rs         # Module declarations
│   └── utils.rs       # Helper functions
├── core/               # Core trading logic
│   ├── mod.rs         # Module declarations
│   ├── token.rs       # Token handling
│   └── tx.rs          # Transaction utilities
├── dex/                # DEX integrations
│   ├── mod.rs         # Module declarations
│   ├── pumpfun.rs     # PumpFun DEX integration
│   └── raydium.rs     # Raydium DEX integration
├── engine/             # Trading engine
│   ├── mod.rs         # Module declarations
│   ├── sniper.rs      # Sniper trading logic
│   ├── strategy.rs    # Trading strategies
│   └── swap.rs        # Swap execution logic
├── services/           # External service integrations
│   ├── bloxroute.rs   # BloxRoute integration
│   ├── jito.rs        # Jito MEV protection
│   ├── mod.rs         # Module declarations
│   ├── nozomi.rs      # Nozomi MEV protection
│   ├── rpc_client.rs  # RPC client utilities
│   ├── telegram.rs    # Telegram notifications
│   └── zeroslot.rs    # Zero Slot integration
├── lib.rs              # Library entry point
└── main.rs             # Main executable entry point
```

### Building

```bash
# Build in debug mode
cargo build

# Build in release mode
cargo build --release

# Clean build artifacts
cargo clean

# Check code without building
cargo check
```

### Testing

```bash
# Run all tests
cargo test

# Run tests with output
cargo test -- --nocapture

# Run specific test
cargo test test_name
```

---

## 🛡️ Security Considerations

### Wallet Security

- **Never commit private keys** to version control
- **Use environment variables** for sensitive data
- **Consider using a hardware wallet** for large amounts
- **Regularly rotate keys** and monitor transactions

### Trading Risks

- **Start with small amounts** to test the bot
- **Monitor performance** regularly
- **Set appropriate stop-losses** to limit downside
- **Understand the risks** of automated trading

### Best Practices

- **Test on devnet** before mainnet
- **Monitor logs** for errors and anomalies
- **Keep the bot updated** with latest changes
- **Backup your configuration** regularly

---

## 📈 Performance Tips

### Optimization

1. **Use a fast RPC endpoint** for better performance
2. **Monitor memory usage** for long-running instances
3. **Adjust trade frequency** based on market conditions
4. **Use appropriate slippage settings** for your strategy

### Monitoring

1. **Set up alerts** for critical errors
2. **Monitor PnL** regularly
3. **Check transaction success rates**
4. **Review trade logs** for patterns

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**
3. **Make your changes**
4. **Add tests** (if applicable)
5. **Submit a pull request**

### Development Setup

```bash
# Fork and clone
git clone https://github.com/radioman/Auto-solana-trading-bot.git
cd Auto-solana-trading-bot

# Install dependencies
npm install

# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and test
npm run dev

# Submit PR
git push origin feature/your-feature-name
```

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

**This software is for educational purposes only. Trading cryptocurrencies involves substantial risk of loss and is not suitable for all investors. The high degree of leverage can work against you as well as for you. Before deciding to trade cryptocurrencies, you should carefully consider your investment objectives, level of experience, and risk appetite. The possibility exists that you could sustain a loss of some or all of your initial investment and therefore you should not invest money that you cannot afford to lose. You should be aware of all the risks associated with cryptocurrency trading and seek advice from an independent financial advisor if you have any doubts.**

---

## 🆘 Support

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/radioman/Auto-solana-trading-bot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/radioman/Auto-solana-trading-bot/discussions)
- **Documentation**: [Wiki](https://github.com/radioman/Auto-solana-trading-bot/wiki)

### Common Issues

1. **Connection Issues**: Check your RPC endpoint and internet connection
2. **Transaction Failures**: Verify wallet balance and gas settings
3. **WebSocket Disconnections**: Check network stability and reconnection settings

---

<div align="center">

**Made with ❤️ for the Solana community**

[⭐ Star this repo](https://github.com/radioman/Auto-solana-trading-bot) • [🐛 Report Bug](https://github.com/radioman/Auto-solana-trading-bot/issues) • [💡 Request Feature](https://github.com/radioman/Auto-solana-trading-bot/issues)

</div>
