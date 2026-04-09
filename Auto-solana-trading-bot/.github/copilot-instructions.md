# Solana Auto Trading Bot - AI Agent Guide

## Architecture Overview

This is a Rust-based copy trading bot for Solana that monitors on-chain transactions via Helius WebSocket and executes automated trades on PumpFun and Raydium DEXes. The bot follows a target wallet and replicates its trades with configurable parameters.

### Core Components

- **WebSocket Listener** ([main.rs](../src/main.rs)): Subscribes to Helius WebSocket for real-time transaction monitoring of target wallet
- **DEX Implementations** ([dex/](../src/dex/)): PumpFun and Raydium swap logic
- **Execution Engines** ([engine/](../src/engine/)): `sniper.rs`, `swap.rs`, `strategy.rs` - duplicate implementations for different trading modes
- **MEV Protection** ([services/](../src/services/)): Jito bundles, Nozomi, and Zero Slot for transaction prioritization
- **Transaction Parsing** (module `ray_parse` in [lib.rs](../src/lib.rs#L5)): Parses transaction data but directory doesn't exist - may be legacy code

### Key Data Flow

1. WebSocket receives transaction → `main.rs` parses inner instructions
2. Detects transfer from target wallet → extracts mint, amount, direction
3. Calls `get_pool_state_by_mint()` to determine Raydium pool
4. Executes `raydium_swap()` with configurable slippage and MEV protection
5. Returns transaction signatures for monitoring

## Project-Specific Patterns

### AppState Pattern

All swap functions require `AppState` with three components:

```rust
AppState {
    rpc_client: Arc<RpcClient>,              // blocking RPC
    rpc_nonblocking_client: Arc<RpcClient>,  // async RPC
    wallet: Arc<Keypair>,                     // signer
}
```

Create via: `create_rpc_client()`, `create_nonblocking_rpc_client()`, `import_wallet()`

### Swap Function Signatures

Three identical `raydium_swap()` implementations exist in `sniper.rs`, `swap.rs`, `strategy.rs`:

- Parameters: `(state, amount_in: f64, swap_direction: &str, in_type: &str, slippage: u64, use_jito: bool, amm_pool_id, pool_state)`
- Direction: `"buy"` or `"sell"` (parsed to `SwapDirection` enum)
- Input type: `"qty"` (absolute amount) or `"pct"` (percentage of balance)
- Always returns `Result<Vec<String>>` (transaction signatures)

### MEV Protection Integration

Three MEV services follow identical patterns in [services/](../src/services/):

- `get_tip_account()` - Returns random tip recipient from hardcoded list
- `get_tip_value()` - Reads from env var (`JITO_TIP_VALUE`, `NOZOMI_TIP_VALUE`, `ZERO_SLOT_TIP_VALUE`)
- All use `LazyLock` for endpoint URLs loaded from environment

## Development Workflows

### Build & Run

```bash
cargo build --release
./target/release/trading-bot
```

### Environment Setup

Required `.env` variables:

- `SOL_PUBKEY` - Your wallet public key
- `PRIVATE_KEY` - Base58 encoded private key
- `RPC_ENDPOINT` - Helius HTTPS endpoint
- `RPC_WEBSOCKET_ENDPOINT` - Helius WSS endpoint
- `TARGET_PUBKEY` - Wallet to copy trade
- `JUP_PUBKEY` - Jupiter aggregator to exclude from monitoring
- `SLIPPAGE` - Default: 5 (in basis points)

Optional MEV services:

- `JITO_BLOCK_ENGINE_URL`, `JITO_TIP_STREAM_URL`, `JITO_TIP_PERCENTILE`, `JITO_TIP_VALUE`
- `NOZOMI_URL`, `NOZOMI_TIP_VALUE`
- `ZERO_SLOT_URL`, `ZERO_SLOT_TIP_VALUE`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

### Logging

Set `RUST_LOG=debug` for verbose output. Custom logger in [common/logger.rs](../src/common/logger.rs) uses `LOG_LEVEL` const (defaults to "LOG").

## Critical Gotchas

### Duplicate Code

`SwapDirection` and `SwapInType` enums duplicated across `sniper.rs`, `swap.rs`, `strategy.rs`. When modifying, update all three files.

### Logger Implementation

[cache.rs](../src/common/cache.rs) and [constants.rs](../src/common/constants.rs) incorrectly contain Logger implementation (copy-paste error). Actual logger is in [logger.rs](../src/common/logger.rs).

### Missing Module

`ray_parse` module declared in [lib.rs](../src/lib.rs#L5) but directory doesn't exist. Code compiles because [main.rs](../src/main.rs#L6) imports it but likely dead code path.

### WebSocket Subscription

Main loop subscribes to `accountInclude: ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", target]` (Raydium program + target wallet). Filters out Jupiter aggregator via `accountExclude`.

### Transaction Parsing

Inner instructions parsing in [main.rs](../src/main.rs#L66-L95) looks for `"transfer"` type where `authority == target`. Assumes specific instruction ordering: `[0]` is input, `[1]` is output.

## Dependencies

- **Solana SDK**: Version pinned to `1.16.27` (older version, not latest)
- **Raydium**: Uses git dependency from `raydium-io/raydium-amm`
- **Token Programs**: Both SPL Token (v4) and Token-2022 (v0.9) supported
- **Async Runtime**: Tokio with full features
- **Edition**: Cargo.toml declares `edition = "2025"` (non-standard, likely should be `2021`)

## When Adding Features

1. **New DEX support**: Add module to [dex/](../src/dex/), export in [mod.rs](../src/dex/mod.rs), create swap function in engine
2. **New MEV service**: Follow pattern in existing services with `get_tip_account()` and `get_tip_value()`
3. **Trading strategies**: Add to [engine/](../src/engine/) - note three existing files may be for different modes
4. **Transaction monitoring**: Modify WebSocket filter in [main.rs](../src/main.rs#L36-L53) `transactionSubscribe` params
