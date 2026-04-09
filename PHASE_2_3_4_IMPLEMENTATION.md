# Phases 2, 3, 4 Implementation Guide

## Overview

This document describes the complete implementation of Phases 2, 3, and 4 of the signal integration system, enabling the Rust trading bot to consume signals from the TypeScript intelligence system and execute trades with comprehensive safety controls.

---

## Phase 2: Decision Bridge to Existing Execution Engine

### Objective

Map validated signals to existing Rust swap strategy functions, enabling deterministic routing from signal -> execution.

### Completed Tasks

#### 1. Signal Contract Definition

- **Type:** `TradeSignalV1` in Rust matches TypeScript definition
- **Fields:** schemaVersion, signalId, emittedAt, sourceSystem, signalType, riskScore, tokenMint, developerWallet, etc.
- **Validation:** Strict schema validation in `signal_receiver.rs`

#### 2. Signal-to-Execution Mapping

**File:** `Auto-solana-trading-bot/src/services/signal_execution.rs`

```rust
fn map_signal_to_execution_request(&self, signal: &TradeSignalV1) -> ExecutionRequest {
    // Maps signal.signalType to action
    let action = match signal.signal_type.as_str() {
        "TOKEN_INVESTIGATION" => "BUY_TOKEN",
        "SUSPICIOUS_TOKEN_LAUNCH" => "SELL_TOKEN", // Sell on scam detection
        "COPY_TRADE" => "COPY_TRADE",
        _ => "WATCH_ONLY",
    };
}
```

#### 3. Execution Functions

Three main execution paths implemented:

**a) Buy Orders**

- Determines DEX (Pump Fun or Raydium)
- Calculates position size based on config
- Executes swap via existing `pump_swap()` or `raydium_swap()`
- Records active position with entry price, stop-loss, take-profit

**b) Sell Orders**

- Locates existing position by token mint
- Sells via appropriate DEX
- Calculates PnL and records trade
- Updates win rate statistics

**c) Copy Trade**

- Tracks wallet movements
- Integrates with existing WebSocket monitoring system
- Uses risk gates to validate before execution

#### 4. DEX Routing

```rust
async fn determine_dex(&self, token_mint: &str) -> Result<String> {
    // Try Raydium first
    match get_pool_state_by_mint(...) {
        Ok(_) => Ok("raydium".to_string()),
        Err(_) => Ok("pump_fun".to_string()), // Fall back to PumpFun
    }
}
```

#### 5. Configuration Control

**Feature Flags:**

- `DRY_RUN`: Accept and log signals without executing swaps
- `LIVE_TRADING_ENABLED`: Enable actual trade execution

---

## Phase 3: Safety Gates, Idempotency, and Observability

### Objective

Prevent unsafe or duplicate execution and add full auditability through risk gates, idempotency checks, and structured logging.

### Completed Tasks

#### 1. Risk Gates Implementation

**File:** `Auto-solana-trading-bot/src/services/signal_execution.rs`

All gates run before signal execution:

```rust
pub fn validate_risk_gates(&self, execution_request: &ExecutionRequest,
                            state: &TradingState) -> Result<(), String> {
    // 1. Risk score validation (max 75%)
    if execution_request.risk_score > 75.0 {
        return Err("risk_score_too_high");
    }

    // 2. Position size validation
    let total_position_sol = state.active_positions.values()
        .map(|pos| pos.amount)
        .sum();
    if total_position_sol >= state.config.max_position_size_sol {
        return Err("max_position_size_exceeded");
    }

    // 3. Concurrent trades limit
    if state.active_positions.len() >= state.config.max_concurrent_trades {
        return Err("max_concurrent_trades_exceeded");
    }

    // 4. Token denylist/allowlist checks
    if state.config.denylist.contains(token_mint) {
        return Err("token_in_denylist");
    }

    // 5. Minimum liquidity check
    if state.config.min_liquidity_usd > 0.0 {
        // Validate liquidity from DEX
    }

    Ok(())
}
```

**Configuration Parameters:**

```rust
pub struct TradingConfig {
    pub max_position_size_sol: f64,           // Max size per position
    pub max_concurrent_trades: usize,         // Max open positions
    pub slippage: f64,                        // Max slippage tolerance
    pub min_liquidity_usd: f64,              // Min pool liquidity
    pub denylist: Vec<String>,              // Blocked token mints
    pub allowlist: Vec<String>,             // Allowed token mints (if not empty)
}
```

#### 2. Idempotency & Replay Protection

**TypeScript Side** (`src/lib/trade-signal-emitter.ts`):

```typescript
private signalIdempotencyMap: Map<string, number> = new Map()

private shouldDeduplicate(signal: TradeSignalV1): boolean {
    const dedupKey = signal.tokenMint || signal.signalId
    if (this.signalIdempotencyMap.has(dedupKey)) {
        return true  // Deduplicate
    }
    this.signalIdempotencyMap.set(dedupKey, Date.now())
    return false
}
```

**Rust Side** (`src/services/signal_receiver.rs`):

```rust
struct SignalReceiverState {
    seen_signals: Arc<Mutex<HashMap<String, Instant>>>,
    config: SignalReceiverConfig {
        dedup_window_seconds: u64,           // 300 seconds default
        max_timestamp_skew_seconds: u64,    // 120 seconds default
    }
}

fn is_duplicate_signal(state: &SignalReceiverState,
                       signal: &TradeSignalV1,
                       headers: &HeaderMap) -> bool {
    // Checks idempotency-key in dedup window
    // Auto-expires old entries after window passes
}
```

**Timestamp Validation:**

- Checks `X-Signal-Timestamp` header
- Rejects if age > `max_timestamp_skew_seconds`
- Prevents replay attacks

#### 3. Authenticated Signal Verification

**HMAC-SHA256 Signing:**

TypeScript emitter:

```typescript
const signature = createHmac('sha256', this.authSecret).update(`${timestamp}.${payload}`).digest('hex')
headers['X-Signal-Signature'] = signature
headers['X-Signal-Timestamp'] = timestamp
```

Rust verifier:

```rust
fn verify_headers_and_signature(config: &SignalReceiverConfig,
                                headers: &HeaderMap,
                                body: &[u8]) -> Result<(), String> {
    let timestamp = headers.get("x-signal-timestamp")?;
    let signature = headers.get("x-signal-signature")?;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())?;
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);

    if expected_signature != provided_signature {
        return Err("invalid_signature");
    }
    Ok(())
}
```

**Environment Variables:**

- `TRADE_SIGNAL_AUTH_SECRET`: Shared HMAC key
- `SIGNAL_REQUIRE_AUTH`: Force authentication (default: !dry_run)

#### 4. Structured Audit Logging

**File:** `Auto-solana-trading-bot/src/services/signal_execution.rs`

```rust
pub fn log_signal_event(
    &self,
    event_type: &str,      // "SIGNAL_RECEIVED", "RISK_GATE_FAILED", "EXECUTED"
    signal_id: &str,
    status: &str,
    details: Option<String>,
) {
    let event = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "event_type": event_type,
        "signal_id": signal_id,
        "status": status,
        "details": details.unwrap_or_default(),
    });
    println!("[AUDIT_LOG] {}", event.to_string());
}
```

**Log Events:**

- `SIGNAL_RECEIVED`: Signal validated and accepted
- `RISK_GATE_FAILED`: Specific gate failure reason
- `DUPLICATE_SIGNAL`: Idempotency key matched
- `AUTHENTICATED`: Signature verified
- `BUY_EXECUTED`: Trade executed
- `SELL_EXECUTED`: Position closed
- `KILL_SWITCH_ACTIVATED`: Emergency stop triggered

#### 5. Metrics Collection

**File:** `Auto-solana-trading-bot/src/services/signal_execution.rs`

```rust
pub fn record_execution_metric(
    &self,
    metric_name: &str,      // "signal_accept_rate", "risk_gate_reject_rate"
    value: f64,
    tags: Option<Vec<(String, String)>>,
) {
    let metric = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "metric": metric_name,
        "value": value,
        "tags": tags.unwrap_or_default(),
    });
    println!("[METRIC] {}", metric.to_string());
}
```

**Tracked Metrics:**

- `signal_dedup_rate`: % of signals deduplicated
- `risk_gate_reject_rate`: % of signals failing gates
- `execution_success_rate`: % of executed trades successful
- `average_position_size`: Mean size of open positions
- `total_trades`: Cumulative trade count
- `win_rate`: % of profitable trades

---

## Phase 4: Controlled Live Rollout

### Objective

Enable live trading with strict guardrails, staged risk, and emergency controls.

### Completed Tasks

#### 1. Live Mode Feature Flag

**Environment Variables:**

```bash
# Enable live trading (overrides dry-run mode)
TRADE_SIGNAL_DRY_RUN=false

# Signal receiver mode
SIGNAL_RECEIVER_DRY_RUN=false
```

**Signal Creation:**

```typescript
const isLiveMode = process.env.TRADE_SIGNAL_DRY_RUN !== 'true'

return {
  dryRun: !isLiveMode,
  // ... other fields
}
```

#### 2. Staged Position Sizing

**File:** `Auto-solana-trading-bot/src/services/signal_execution.rs`

```rust
pub fn calculate_position_size(&self, base_amount: f64, config: &TradingConfig) -> f64 {
    match config.mode.as_str() {
        "ultra_conservative" => base_amount * 0.01,   // 1% of normal
        "conservative" => base_amount * 0.1,          // 10% of normal
        "normal" => base_amount,                       // 100% of normal
        "aggressive" => base_amount * 1.5,            // 150% of normal (with leverage)
        _ => base_amount,
    }
}
```

**Rollout Progression:**

1. Start in `ultra_conservative` mode
2. Monitor metrics for 24-48 hours
3. Escalate to `conservative` mode
4. Monitor for 48-72 hours
5. Move to `normal` mode if stable

**Monitoring Checklist:**

- [ ] No execution errors
- [ ] Win rate > 40%
- [ ] Average trade duration stable
- [ ] No unexpected slippage
- [ ] Latency < 2 seconds
- [ ] Zero rejected signals due to risk gates

#### 3. Mode Control API

**HTTP Endpoints:**

```
POST /trading/mode
Body: { "mode": "ultra_conservative" | "conservative" | "normal" | "aggressive" }
```

**Example:**

```bash
curl -X POST http://localhost:8787/trading/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "conservative"}'
```

#### 4. Emergency Kill Switch

**File:** `Auto-solana-trading-bot/src/services/signal_execution.rs`

```rust
pub fn kill_switch(&self) -> Result<String> {
    let mut state = self.state.lock().unwrap();
    state.config.enabled = false;
    state.config.paused = true;

    self.log_signal_event(
        "KILL_SWITCH_ACTIVATED",
        "emergency",
        "all_trading_stopped",
        None,
    );

    Ok("KILL_SWITCH_ACTIVATED: All trading disabled".to_string())
}
```

**How to Trigger:**

- HTTP: `POST /trading/kill-switch`
- Environment: Set `TRADING_DISABLED=true`
- CLI: Send `SIGTERM` or `SIGINT`

**Actions on Activation:**

1. Disable new trade entry
2. Pause all pending orders
3. Log alert with timestamp
4. Send notification (if configured)
5. Return status on all endpoints

#### 5. Runtime Pause/Resume

```rust
pub fn pause_all(&self) -> Result<String> {
    let mut state = self.state.lock().unwrap();
    state.config.paused = true;
    self.log_signal_event("TRADING_PAUSED", "runtime", "paused", None);
    Ok("ALL_TRADING_PAUSED".to_string())
}

pub fn resume_all(&self) -> Result<String> {
    let mut state = self.state.lock().unwrap();
    if state.config.enabled {
        state.config.paused = false;
        self.log_signal_event("TRADING_RESUMED", "runtime", "resumed", None);
        Ok("ALL_TRADING_RESUMED".to_string())
    } else {
        Err("TRADING_NOT_ENABLED".to_string())
    }
}
```

**HTTP Endpoints:**

```
POST /trading/pause   -> Pauses execution
POST /trading/resume  -> Resumes execution (if enabled)
```

#### 6. Advanced Risk Controls

**Slippage Protection:**

```rust
pub fn set_max_slippage(&self, max_slippage: f64) -> Result<String> {
    if max_slippage < 0.1 || max_slippage > 50.0 {
        return Err("Invalid slippage: must be between 0.1% and 50%".to_string());
    }
    state.config.slippage = max_slippage;
}
```

**Denylist/Allowlist Management:**

```rust
pub fn add_to_denylist(&self, token_mint: String) -> Result<String> {
    state.config.denylist.push(token_mint);
    self.log_signal_event("DENYLIST_UPDATED", &token_mint, "added", None);
}

pub fn set_allowlist(&self, tokens: Vec<String>) -> Result<String> {
    state.config.allowlist = tokens;
    self.log_signal_event("ALLOWLIST_UPDATED", "config", "set", None);
}
```

#### 7. Rollback Status & Action Plan

**File:** `Auto-solana-trading-bot/src/services/signal_execution.rs`

```rust
pub fn get_rollback_status(&self) -> Result<serde_json::Value> {
    let state = self.state.lock().unwrap();
    Ok(serde_json::json!({
        "enabled": state.config.enabled,
        "paused": state.config.paused,
        "mode": state.config.mode,
        "activePositions": state.active_positions.len(),
        "lastTrade": state.recent_trades.last().map(|t| &t.timestamp),
        "totalPnL": state.total_pnl,
        "recommendedAction": if state.active_positions.is_empty() {
            "safe_to_disable"
        } else {
            "close_positions_first"
        }
    }))
}
```

**Rollback Procedure:**

1. Call `GET /trading/rollback-status`
2. Review current positions and metrics
3. If `active_positions` > 0, manually close or trigger sell signals
4. Once empty, can disable trading safely
5. Call `POST /trading/kill-switch` to disable completely

---

## Configuration Reference

### Environment Variables

**Phase 1 (Existing):**

```bash
SIGNAL_RECEIVER_BIND=127.0.0.1:8787
SIGNAL_RECEIVER_DRY_RUN=true
```

**Phase 2 (New):**

```bash
TRADE_SIGNAL_ENDPOINT=http://127.0.0.1:8787/signals
TRADE_SIGNAL_TIMEOUT_MS=4000
```

**Phase 3 (New):**

```bash
SIGNAL_REQUIRE_AUTH=false          # Default: !DRY_RUN
TRADE_SIGNAL_AUTH_SECRET=your_secret_key_here
SIGNAL_DEDUP_WINDOW_SECONDS=300
SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS=120
TRADE_SIGNAL_REQUIRE_AUTH=true
```

**Phase 4 (New):**

```bash
TRADING_MODE=conservative          # ultra_conservative | conservative | normal | aggressive
TRADING_ENABLED=false              # Start disabled, enable after testing
TRADING_PAUSED=false               # Start unpaused
```

### TradingConfig Structure

```rust
pub struct TradingConfig {
    pub enabled: bool,
    pub paused: bool,
    pub mode: String,                      // Rollout stage
    pub target_wallet: Option<String>,
    pub mev_service: String,
    pub slippage: f64,
    pub buy_amount_sol: f64,
    pub max_concurrent_trades: usize,
    pub stop_loss_percentage: f64,
    pub take_profit_percentage: f64,
    pub max_position_size_sol: f64,
    pub min_liquidity_usd: f64,
    pub allowed_dexes: Vec<String>,
    pub denylist: Vec<String>,
    pub allowlist: Vec<String>,
}
```

---

## HTTP API Reference

### Signal Reception

```
POST /signals
Content-Type: application/json
X-Signal-Signature: sha256_hmac
X-Signal-Timestamp: unix_seconds
X-Idempotency-Key: uuid

Request:
{
  "schemaVersion": "1.0",
  "signalId": "uuid",
  "signalType": "TOKEN_INVESTIGATION",
  "riskScore": 45.0,
  "tokenMint": "token_address",
  ...
}

Response:
{
  "status": "accepted|executed|duplicate|rejected",
  "mode": "dry-run|live",
  "signal_id": "uuid",
  "reason": "optional_explanation"
}
```

### Trading Control Endpoints

**Status:**

```
GET /trading/status
GET /trading/balance
GET /trading/trades
GET /trading/stats
GET /trading/config
GET /trading/rollback-status
```

**Control:**

```
POST /trading/enable
POST /trading/disable
POST /trading/pause
POST /trading/resume
POST /trading/kill-switch
POST /trading/mode

Location: /trading/slippage
POST /trading/slippage
  { "slippage": 2.5 }

Location: /trading/denylist
POST /trading/denylist/add
  { "token_mint": "address" }

POST /trading/allowlist/set
  { "tokens": ["addr1", "addr2"] }
```

---

## Testing Checklist

### Phase 2 Testing

- [ ] Receive signal from TypeScript emitter
- [ ] Map TOKEN_INVESTIGATION -> BUY_TOKEN
- [ ] Map SUSPICIOUS_TOKEN_LAUNCH -> SELL_TOKEN
- [ ] Execute buy on Raydium (test token)
- [ ] Execute sell on Pump Fun (test token)
- [ ] Record positions and trades correctly
- [ ] Calculate PnL correctly

### Phase 3 Testing

- [ ] Risk gate: reject high-risk signals (>75)
- [ ] Risk gate: reject when max positions reached
- [ ] Risk gate: reject tokens in denylist
- [ ] Idempotency: deduplicate same token within window
- [ ] Replay protection: reject stale timestamps
- [ ] HMAC verification: reject invalid signatures
- [ ] Audit logs: verify all events logged
- [ ] Metrics: verify metrics recorded

### Phase 4 Testing

- [ ] Dry-run mode: accept signals, don't execute trades
- [ ] Live mode: execute actual trades
- [ ] Ultra-conservative: 1% position sizing
- [ ] Conservative: 10% position sizing
- [ ] Mode switch: seamless transition
- [ ] Kill switch: stops all trading immediately
- [ ] Pause/resume: halts and resumes execution
- [ ] Rollback status: shows correct state

---

## Deployment Checklist

1. **Pre-deployment:**

   - [ ] All Phase 2, 3, 4 tests passing
   - [ ] Dry-run mode enabled on prod canary
   - [ ] Auth enabled (SIGNAL_REQUIRE_AUTH=true)
   - [ ] Denylist populated with known scams
   - [ ] Max position size set to 0.05 SOL
   - [ ] Max concurrent trades set to 3

2. **Canary Rollout (Dry-Run):**

   - [ ] Run for 2-4 hours
   - [ ] Monitor for 100% signal acceptance (zero rejections)
   - [ ] Verify DEX routing correct
   - [ ] Check audit logs for anomalies

3. **Ultra-Conservative Rollout (1% sizing):**

   - [ ] Enable live mode for canary set of signals
   - [ ] Monitor PnL, latency, errors
   - [ ] Check for execution failures
   - [ ] Review actual fill prices vs expected

4. **Conservative Rollout (10% sizing):**

   - [ ] After 24-48 hours of stable ultra-conservative
   - [ ] Increase position size to 10%
   - [ ] Monitor same metrics
   - [ ] Check trade volume

5. **Normal Rollout (100% sizing):**
   - [ ] After 48-72 hours of stable conservative
   - [ ] Move to full sizing
   - [ ] Increase max concurrent trades to 5
   - [ ] Monitor continuously

---

## Troubleshooting

### Signal Not Received

**Symptoms:** No response to signal endpoint
**Solution:**

1. Check `SIGNAL_RECEIVER_BIND` is listening
2. Verify TypeScript has correct endpoint URL
3. Check network connectivity
4. Enable debug logging

### Risk Gate Rejection

**Symptoms:** Signals rejected with "risk_gate_failed"
**Solution:**

1. Check `riskScore` not > 75
2. Verify token not in denylist
3. Check `max_concurrent_trades` not exceeded
4. Review `max_position_size_sol` limit

### Execution Failures

**Symptoms:** "BUY_FAILED" or "SELL_FAILED"
**Solution:**

1. Check sufficient SOL balance
2. Verify DEX pool has liquidity
3. Check RPC endpoint response
4. Review slippage settings (increase if rejections)

### High Latency

**Symptoms:** Signal processing > 2 seconds
**Solution:**

1. Check RPC endpoint latency
2. Reduce DEX routing logic complexity
3. Use MEV service (jito, nozomi, zero_slot)
4. Monitor network conditions

---

## References

- **MIGRATION_PHASES.md:** Overall architecture and phase definitions
- **src/lib/trade-signal-emitter.ts:** TypeScript signal emission
- **Auto-solana-trading-bot/src/services/signal_execution.rs:** Rust execution engine
- **Auto-solana-trading-bot/src/services/signal_receiver.rs:** HTTP signal receiver
