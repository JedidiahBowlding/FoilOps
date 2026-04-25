# Phases 2, 3, 4: Quick Start Guide

## Quick Setup

### 1. Environment Configuration

Create or update `.env` in the project root:

```bash
# Rust Trading Bot (Auto-solana-trading-bot)
SIGNAL_RECEIVER_BIND=127.0.0.1:8787
SIGNAL_RECEIVER_DRY_RUN=true              # Start with dry-run!
SIGNAL_REQUIRE_AUTH=false                  # Phase 3: Later enable auth
SIGNAL_AUTH_SECRET=your-secret-key-here   # Generate: openssl rand -hex 32
SIGNAL_DEDUP_WINDOW_SECONDS=300
SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS=120

# TypeScript Intelligence System
TRADE_SIGNAL_ENDPOINT=http://127.0.0.1:8787/signals
TRADE_SIGNAL_TIMEOUT_MS=4000
TRADE_SIGNAL_DRY_RUN=true                 # Start with dry-run!
TRADE_SIGNAL_AUTH_SECRET=your-secret-key-here
TRADE_SIGNAL_REQUIRE_AUTH=false           # Phase 3: Later require auth

# Trading Parameters (Phase 4)
TRADING_MODE=ultra_conservative            # Start conservative!
TRADING_ENABLED=false                      # Must explicitly enable
TRADING_PAUSED=false

# Whale auto-watch (credit protection)
WHALE_AUTO_TRACK_ENABLED=false             # Keep off unless intentionally tuning auto-discovery
WHALE_MANUAL_WALLETS=                       # Comma-separated curated wallets (recommended)
WHALE_EXCLUDE_WALLETS=                      # Comma-separated bot wallets to force-exclude
WHALE_MAX_ACTIVITY_HITS=10                  # Ignore hyper-active wallets (often bots)
```

### 2. Start the Rust Signal Receiver

```bash
cd Auto-solana-trading-bot
cargo run --release -- --signal-receiver
```

**Expected Output:**

```
Signal receiver listening on 127.0.0.1:8787 (mode: dry-run, auth: optional, dedup_window_s: 300)
```

### 3. Emit Test Signals from TypeScript

```bash
node -e "
const { TradeSignalEmitter } = require('./dist/lib/trade-signal-emitter.js');
const emitter = new TradeSignalEmitter();

(async () => {
  const signal = emitter.createSignal({
    signalType: 'TOKEN_INVESTIGATION',
    riskScore: 45,
    tokenMint: 'EPjFWaLb3hLW1zLwT8sgUxsqF7xo8YCvqKjhyxHRt1jR',  // USDC on devnet
    trackedWallet: '4xKr1VDcx6J87oKoxQWvHxGWXrC1kztUVbW1BaGLXPQ3',
  });

  await emitter.emit(signal);
})();
"
```

---

## Phase 2: Signal Mapping Examples

### Example 1: Token Investigation Signal

**Emission (TypeScript):**

```typescript
import { tradeSignalEmitter } from './lib/trade-signal-emitter'

await tradeSignalEmitter.emitTokenInvestigationSignal({
  tokenMint: 'JUPyiwrYJFskUPiHa7hL93z06CjwxZ1JM8PqJGUnvR8',
  riskScore: 35,
  investigationReason: 'Unusual holder distribution detected',
  trackedWallets: ['7G93GkFgvBHy9Tq1y8vU2kU1qU9vQ3yU2xQ1pR4sT5u'],
  metadata: {
    investigationType: 'HOLDER_DISTRIBUTION',
    holdersCount: 1250,
  },
})
```

**Reception (Rust):**

```
[AUDIT_LOG] {"timestamp":"2026-04-09T10:30:15Z","event_type":"SIGNAL_RECEIVED","signal_id":"uuid","status":"accepted","details":""}
Signal mapped: TOKEN_INVESTIGATION -> BUY_TOKEN
Risk gates validation: PASSED
Execution: Buying 0.001 SOL worth of JUPyiwrYJFskUPiHa7hL93z06CjwxZ1JM8PqJGUnvR8 on Raydium
[AUDIT_LOG] {"timestamp":"2026-04-09T10:30:16Z","event_type":"BUY_EXECUTED","signal_id":"uuid","status":"success"}
```

### Example 2: Suspicious Launch Signal

**Emission (TypeScript):**

```typescript
await tradeSignalEmitter.emitSuspiciousLaunchSignal({
  tokenMint: 'EvilToken123456789012345678901234567890AB',
  developerWallet: 'BadDevWallet123456789012345678901234567890AB',
  riskScore: 82,
  suspiciousIndicators: ['LIQUIDITY_PROVIDER_REMOVED', 'AUTHORITY_TRANSFERRED', 'MINT_DISABLED'],
  metadata: {
    detectionTime: 1712685015000,
    victimCount: 42,
    estimatedLoss: 125000,
  },
})
```

**Reception (Rust):**

```
[AUDIT_LOG] {"timestamp":"2026-04-09T10:35:22Z","event_type":"SIGNAL_RECEIVED","signal_id":"uuid","status":"accepted"}
Signal mapped: SUSPICIOUS_TOKEN_LAUNCH -> SELL_TOKEN
Risk gate validation: FAILED
Reason: risk_score_too_high: 82 > 75
Execution: SKIPPED (risk gate rejected)
[AUDIT_LOG] {"timestamp":"2026-04-09T10:35:22Z","event_type":"RISK_GATE_FAILED","signal_id":"uuid","status":"rejected","details":"risk_score_too_high: 82 > 75"}
```

---

## Phase 3: Safety Controls in Action

### Example 1: Idempotency Protection

**First signal (at t=0s):**

```bash
curl -X POST http://localhost:8787/signals \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": "1.0",
    "signalId": "signal-001",
    "tokenMint": "ABC123...",
    "signalType": "TOKEN_INVESTIGATION",
    "riskScore": 45,
    "emittedAt": "2026-04-09T10:30:00Z",
    ...
  }'
```

Response:

```json
{
  "status": "accepted",
  "mode": "dry-run",
  "signal_id": "signal-001"
}
```

**Duplicate signal (at t=30s, within 300s dedup window):**

```bash
# Same payload...
```

Response:

```json
{
  "status": "duplicate",
  "mode": "dry-run",
  "signal_id": "signal-001",
  "reason": "duplicate_idempotency_key"
}
```

Logs:

```
[AUDIT_LOG] {"event_type":"DUPLICATE_SIGNAL","signal_id":"signal-001","status":"deduplicated"}
```

### Example 2: Risk Gate - Position Limit

**Configuration:**

```bash
export TRADING_ROLE_MAX_CONCURRENT_TRADES=3
export TRADING_MODE_MAX_POSITION_SIZE_SOL=0.05
```

**Execution:**

```
Position 1: Buy 0.02 SOL ACCEPTED
Position 2: Buy 0.02 SOL ACCEPTED
Position 3: Buy 0.01 SOL ACCEPTED

Position 4: Buy 0.01 SOL
Risk gate validation: FAILED
Reason: max_concurrent_trades_exceeded: 3 >= 3
[AUDIT_LOG] {"event_type":"RISK_GATE_FAILED","details":"max_concurrent_trades_exceeded"}
```

### Example 3: HMAC Authentication

**Enable auth in config:**

```bash
SIGNAL_REQUIRE_AUTH=true
TRADE_SIGNAL_AUTH_SECRET=my_secret_key_32_characters_long_!!!!
```

**TypeScript client (auto-signed):**

```typescript
const signal = emitter.createSignal({...})
await emitter.emit(signal)  // Auto-signs with HMAC-SHA256
```

**Manual cURL with signature:**

```bash
PAYLOAD='{"signalId":"test-001","riskScore":45,...}'
TIMESTAMP=$(date +%s)
SECRET='my_secret_key_32_characters_long_!!!!'
SIGNATURE=$(echo -n "$TIMESTAMP.$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

curl -X POST http://localhost:8787/signals \
  -H "Content-Type: application/json" \
  -H "X-Signal-Timestamp: $TIMESTAMP" \
  -H "X-Signal-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

Response:

```json
{
  "status": "accepted",
  "mode": "dry-run",
  "signal_id": "test-001"
}
```

---

## Phase 4: Live Trading Guardrails

### Example 1: Ultra-Conservative Rollout

**Step 1: Enable in dry-run mode**

```bash
export SIGNAL_RECEIVER_DRY_RUN=true
export TRADING_MODE=ultra_conservative
export TRADING_ENABLED=false
```

**Step 2: Check status**

```bash
curl http://localhost:8787/trading/status
```

Response:

```json
{
  "enabled": false,
  "paused": false,
  "mode": "ultra_conservative",
  "activePositions": 0,
  "totalPnL": 0.0,
  "winRate": 0.0,
  "totalTrades": 0
}
```

**Step 3: Enable trading**

```bash
curl -X POST http://localhost:8787/trading/enable
```

Response:

```json
{
  "status": "enabled",
  "message": "TRADING_ENABLED"
}
```

**Step 4: Send signals**

- Signals are now processed in ultra_conservative mode
- Position sizes are 1% of normal (0.01 SOL becomes 0.0001 SOL)
- Monitors all metrics for 24-48 hours

**Logs:**

```
[AUDIT_LOG] {"event_type":"TRADING_ENABLED"}
BUY_EXECUTED with position_size 0.0001 SOL (ultra_conservative)
[METRIC] {"metric":"signal_accept_rate","value":0.95,"tags":[]}
[METRIC] {"metric":"risk_gate_reject_rate","value":0.05,"tags":[]}
```

### Example 2: Mode Escalation

**After 24-48 hours of stability:**

```bash
# Step 1: Check rollback status
curl http://localhost:8787/trading/rollback-status
```

Response:

```json
{
  "enabled": true,
  "paused": false,
  "mode": "ultra_conservative",
  "activePositions": 2,
  "lastTrade": "2026-04-09T18:30:15Z",
  "totalPnL": 0.012,
  "recommendedAction": "upgrade_mode"
}
```

**Step 2: Escalate to conservative**

```bash
curl -X POST http://localhost:8787/trading/config \
  -H "Content-Type: application/json" \
  -d '{"mode": "conservative"}'
```

**Step 3: Monitor new metrics**

- Position size now 10% of normal
- Continue monitoring for 48-72 hours
- Watch for execution errors or slippage

### Example 3: Emergency Kill Switch

**Scenario: Detected anomaly**

```bash
# Immediately stop all trading
curl -X POST http://localhost:8787/trading/kill-switch
```

Response:

```json
{
  "status": "killed",
  "message": "KILL_SWITCH_ACTIVATED: All trading disabled"
}
```

**Logs:**

```
[AUDIT_LOG] {"event_type":"KILL_SWITCH_ACTIVATED","signal_id":"emergency","status":"all_trading_stopped"}
```

**Status after kill switch:**

```bash
curl http://localhost:8787/trading/status
```

Response:

```json
{
  "enabled": false,
  "paused": true,
  "mode": "ultra_conservative",
  "activePositions": 2,
  "totalPnL": 0.015,
  "message": "All trading disabled - review positions manually"
}
```

### Example 4: Manage Denylist

**Add scam token to denylist:**

```bash
curl -X POST http://localhost:8787/trading/denylist/add \
  -H "Content-Type: application/json" \
  -d '{"token_mint": "ScamToken1234567890123456789012345678901234"}'
```

Response:

```json
{
  "status": "updated",
  "message": "ADDED_TO_DENYLIST: ScamToken..."
}
```

**Logs:**

```
[AUDIT_LOG] {"event_type":"DENYLIST_UPDATED","signal_id":"...","status":"added","details":"Total denied: 42"}
```

**Set allowlist (only trade these tokens):**

```bash
curl -X POST http://localhost:8787/trading/allowlist/set \
  -H "Content-Type: application/json" \
  -d '{
    "tokens": [
      "JUPyiwrYJFskUPiHa7hL93z06CjwxZ1JM8PqJGUnvR8",
      "EPjFWaLb3hLW1zLwT8sgUxsqF7xo8YCvqKjhyxHRt1jR"
    ]
  }'
```

---

## Monitoring & Debugging

### View Recent Trades

```bash
curl http://localhost:8787/trading/trades | jq
```

Output:

```json
[
  {
    "timestamp": "2026-04-09T10:30:16Z",
    "token_mint": "ABC123...",
    "action": "buy",
    "amount": 0.0001,
    "price": 0.0,
    "pnl": null,
    "reason": "Signal-based execution: TOKEN_INVESTIGATION"
  },
  ...
]
```

### View Trading Stats

```bash
curl http://localhost:8787/trading/stats | jq
```

Output:

```json
{
  "totalPnL": 0.0125,
  "winRate": 0.667,
  "totalTrades": 3,
  "winningTrades": 2,
  "activePositions": 1
}
```

### View Full Configuration

```bash
curl http://localhost:8787/trading/config | jq
```

Output:

```json
{
  "enabled": true,
  "paused": false,
  "mode": "ultra_conservative",
  "target_wallet": null,
  "mev_service": "jito",
  "slippage": 3.0,
  "buy_amount_sol": 0.01,
  "max_concurrent_trades": 5,
  "stop_loss_percentage": 20.0,
  "take_profit_percentage": 50.0,
  "max_position_size_sol": 0.1,
  "min_liquidity_usd": 1000.0,
  "allowed_dexes": ["pump_fun", "raydium"],
  "denylist": ["ScamToken..."],
  "allowlist": []
}
```

### Check Health

```bash
curl http://localhost:8787/health | jq
```

Output:

```json
{
  "status": "ok",
  "mode": "dry-run",
  "auth_required": false,
  "dedup_window_seconds": 300,
  "max_timestamp_skew_seconds": 120
}
```

---

## Common Tasks

### Pause Trading (Temporary)

```bash
curl -X POST http://localhost:8787/trading/pause
# Later...
curl -X POST http://localhost:8787/trading/resume
```

### Adjust Slippage

```bash
# Check current
curl http://localhost:8787/trading/slippage

# Set to 5%
curl -X POST http://localhost:8787/trading/slippage \
  -H "Content-Type: application/json" \
  -d '{"slippage": 5.0}'
```

### View Rollback Plan

```bash
curl http://localhost:8787/trading/rollback-status | jq '.recommendedAction'
# Output: "safe_to_disable" or "close_positions_first"

# If needed: manually close positions by sending SELL signals
curl -X POST http://localhost:8787/signals \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": "1.0",
    "signalType": "SUSPICIOUS_TOKEN_LAUNCH",
    "tokenMint": "position_to_close",
    "riskScore": 50,
    ...
  }'
```

---

## Troubleshooting

### Signals not received

```bash
# 1. Check Rust listener is running
lsof -i :8787

# 2. Verify endpoint is correct
echo $TRADE_SIGNAL_ENDPOINT

# 3. Test connectivity
curl -v http://localhost:8787/health
```

### Auth errors

```bash
# Ensure secrets match
echo $TRADE_SIGNAL_AUTH_SECRET
echo $SIGNAL_AUTH_SECRET
# Should be identical

# Regenerate secret
openssl rand -hex 32
```

### Execution failures

```bash
# Check balance
curl http://localhost:8787/trading/balance

# Check config
curl http://localhost:8787/trading/config | jq '.max_position_size_sol'

# Adjust slippage up
curl -X POST http://localhost:8787/trading/slippage \
  -d '{"slippage": 10.0}'
```

### High rejection rate

```bash
# Check risk gates
curl http://localhost:8787/trading/stats | jq

# Review denylist
curl http://localhost:8787/trading/config | jq '.denylist'

# Lower risk threshold (if needed)
# Modify code: validate_risk_gates() max_score
```

---

## Next Steps

1. ✅ **Phase 2:** Test signal routing (BUY, SELL, COPY_TRADE)
2. ✅ **Phase 3:** Verify risk gates and authentication
3. ✅ **Phase 4:** Staged rollout (ultra_conservative -> conservative -> normal)
4. 🔄 **Monitoring:** Set up metrics dashboards (Grafana/Prometheus)
5. 📊 **Analysis:** Review PnL and win rates regularly
6. 🚨 **On-call:** Prepare emergency runbooks

---

## References

- Implementation Details: [PHASE_2_3_4_IMPLEMENTATION.md](./PHASE_2_3_4_IMPLEMENTATION.md)
- Phases Overview: [MIGRATION_PHASES.md](./MIGRATION_PHASES.md)
- TypeScript API: [src/lib/trade-signal-emitter.ts](./src/lib/trade-signal-emitter.ts)
- Rust Engine: [Auto-solana-trading-bot/src/services/signal_execution.rs](./Auto-solana-trading-bot/src/services/signal_execution.rs)
