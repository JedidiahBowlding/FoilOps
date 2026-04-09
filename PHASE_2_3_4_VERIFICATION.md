# Phases 2, 3, 4: Deployment Verification Checklist

## Pre-Deployment Checklist

### Code Quality

- [x] All imports in place (engine/mod.rs, services/mod.rs)
- [x] TypeScript signal emitter compiles
- [x] Rust signal_execution.rs compiles
- [x] No unimplemented! macros in critical paths
- [x] Error handling for all DEX calls
- [x] Proper mutex/Arc usage for thread safety

### Security Review

- [x] HMAC-SHA256 authentication implemented
- [x] Timestamp validation prevents replay attacks
- [x] Idempotency deduplication working
- [x] Risk gates blocking dangerous signals
- [x] Sensitive data not logged
- [x] Secret management via environment variables

### Phase 2 Validation

#### Signal Reception

- [ ] Rust listener starts on SIGNAL_RECEIVER_BIND
- [ ] TypeScript can POST to TRADE_SIGNAL_ENDPOINT
- [ ] Signal schema validated on receipt
- [ ] Invalid signals rejected (400 status)
- [ ] Valid signals accepted (200 status)

#### Signal Mapping

- [ ] TOKEN_INVESTIGATION -> BUY_TOKEN
- [ ] SUSPICIOUS_TOKEN_LAUNCH -> SELL_TOKEN
- [ ] COPY_TRADE -> COPY_TRADE
- [ ] Unknown signals -> WATCH_ONLY

#### DEX Routing

- [ ] Raydium detection works (pool exists)
- [ ] PumpFun fallback activates (no Raydium pool)
- [ ] Correct DEX selected for token
- [ ] Liquidity checks pass for valid tokens

#### Trade Execution

- [ ] Buy orders execute via correct DEX
- [ ] Sell orders execute via correct DEX
- [ ] Position recorded in active_positions
- [ ] Trade recorded in recent_trades[]
- [ ] PnL calculated and recorded
- [ ] Win rate updated

### Phase 3 Validation

#### Risk Gates

- [ ] High-risk signals (>75) rejected
- [ ] Low-risk signals (<75) accepted
- [ ] Max position size enforced
- [ ] Max concurrent trades enforced
- [ ] Denylisted tokens blocked
- [ ] Allowlist enforced when set
- [ ] Minimum liquidity validated

#### Idempotency

- [ ] First signal of token accepted
- [ ] Duplicate signal within window rejected
- [ ] Duplicate marked as "duplicate" in response
- [ ] Old entries cleaned after window expires
- [ ] Dedup window configurable (SIGNAL_DEDUP_WINDOW_SECONDS)

#### Replay Protection

- [ ] Timestamp required in headers
- [ ] Stale timestamps rejected (>max_skew)
- [ ] Future timestamps rejected (>max_skew)
- [ ] Skew window configurable (SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS)

#### Authentication

- [ ] HMAC-SHA256 required when SIGNAL_REQUIRE_AUTH=true
- [ ] Invalid signature rejected
- [ ] Modified payload detected
- [ ] Auth optional when SIGNAL_REQUIRE_AUTH=false
- [ ] Signature generated correctly by TypeScript

#### Audit Logging

- [ ] AUDIT_LOG events printed for significant events
- [ ] Events include: timestamp, event_type, signal_id, status
- [ ] SIGNAL_RECEIVED logged
- [ ] RISK_GATE_FAILED logged with reason
- [ ] DUPLICATE_SIGNAL logged
- [ ] BUY_EXECUTED logged
- [ ] SELL_EXECUTED logged

#### Metrics

- [ ] METRIC events printed for key indicators
- [ ] Metrics include: timestamp, metric name, value, tags
- [ ] Acceptance rate tracked
- [ ] Rejection rate tracked
- [ ] Execution success rate tracked
- [ ] PnL metrics tracked

### Phase 4 Validation

#### Dry-Run Mode

- [ ] Signals accepted when SIGNAL_RECEIVER_DRY_RUN=true
- [ ] No trades executed in dry-run
- [ ] Trades logged as planned
- [ ] Status shows executed: false

#### Live Mode

- [ ] Trades executed when SIGNAL_RECEIVER_DRY_RUN=false
- [ ] TRADE_SIGNAL_DRY_RUN=false respected
- [ ] Transactions sent to blockchain
- [ ] Position recorded before execution

#### Position Sizing Modes

- [ ] ultra_conservative: 1% of base amount
- [ ] conservative: 10% of base amount
- [ ] normal: 100% of base amount
- [ ] aggressive: 150% of base amount
- [ ] Mode switchable via API

#### Mode Escalation

- [ ] Initial mode set to ultra_conservative
- [ ] Can escalate to conservative via POST /trading/mode
- [ ] Can escalate to normal via POST /trading/mode
- [ ] Can escalate to aggressive via POST /trading/mode
- [ ] Can downgrade to previous mode
- [ ] Escalation seamless

#### Pause/Resume

- [ ] POST /trading/pause stops execution
- [ ] POST /trading/resume resumes (if enabled)
- [ ] Resume fails if not enabled
- [ ] New signals blocked while paused
- [ ] Status shows paused: true

#### Kill Switch

- [ ] POST /trading/kill-switch stops all trading
- [ ] Both enabled and paused set to true
- [ ] Kill switch immediate (no validation)
- [ ] Cannot resume after kill switch without restart
- [ ] Event logged and audited

#### Trading Control APIs

- [ ] GET /trading/status returns correct state
- [ ] GET /trading/balance returns wallet info
- [ ] GET /trading/trades returns recent trades
- [ ] GET /trading/stats returns performance metrics
- [ ] GET /trading/config returns current config
- [ ] GET /trading/rollback-status returns recovery plan

#### Configuration Management

- [ ] SET /trading/slippage updates limit
- [ ] SET /trading/mode changes rollout stage
- [ ] Denylist/allowlist updateable via API
- [ ] MEV service changeable via API
- [ ] Changes take effect immediately

#### Risk Controls

- [ ] Max position size prevents over-leverage
- [ ] Max concurrent trades prevents exposure
- [ ] Slippage caps protect against bad fills
- [ ] Min liquidity filters illiquid pairs
- [ ] Risk score threshold blocks bad signals

---

## Integration Testing Flow

### Test 1: Phase 2 Signal Mapping (Dry-Run)

**Setup:**

```bash
export SIGNAL_RECEIVER_DRY_RUN=true
export TRADE_SIGNAL_DRY_RUN=true
export TRADING_ENABLED=false
cargo run --release
```

**Test Steps:**

1. Emit TOKEN_INVESTIGATION signal

   - Expected: accepted, mapped to BUY_TOKEN
   - Verify: status="accepted", mode="dry-run"

2. Send malformed signal

   - Expected: rejected
   - Verify: status="rejected", reason includes "invalid"

3. Emit same token twice

   - Expected: first accepted, second deduplicated
   - Verify: second has status="duplicate"

4. Emit signal with high risk (>75)
   - Expected: accepted but trade not executed
   - Verify: logs show RISK_GATE_FAILED

**Validation:**

- [ ] All signals received
- [ ] Routing correct
- [ ] No trades executed (dry-run)
- [ ] Logs show all events

---

### Test 2: Phase 3 Safety Gates (Dry-Run)

**Setup:**

```bash
# Same as Test 1
export SIGNAL_REQUIRE_AUTH=false
```

**Test Steps:**

1. **Risk Score Gate:**

   - Emit signal with riskScore: 85
   - Expected: RISK_GATE_FAILED
   - Verify: logs show "risk_score_too_high: 85 > 75"

2. **Position Limit Gate:**

   - Emit 5 BUY signals (MAX_CONCURRENT_TRADES=5)
   - Expected: first 5 accepted, 6th rejected
   - Verify: 6th has status="rejected", reason="max_concurrent_trades_exceeded"

3. **Denylist Gate:**

   - Set DENYLIST_TOKENS="BadToken123"
   - Emit signal with token=BadToken123
   - Expected: rejected
   - Verify: reason="token_in_denylist"

4. **Allowlist Gate:**

   - Set ALLOWLIST_TOKENS="GoodToken456"
   - Emit signal with token=BadToken123
   - Expected: rejected (not in allowlist)
   - Verify: reason="token_not_in_allowlist"

5. **Idempotency:**

   - Emit signal A at t=0
   - Emit signal A again at t=30 (within 300s window)
   - Expected: first accepted, second deduplicated
   - Verify: second has status="duplicate"

6. **Timestamp Validation:**
   - Send signal with stale timestamp (>120s old)
   - Expected: rejected
   - Verify: reason="stale_or_future_timestamp"

**Validation:**

- [ ] All gates working
- [ ] Rejections include correct reasons
- [ ] Deduplication working
- [ ] Timestamp validation working

---

### Test 3: Phase 3 Authentication (Dry-Run)

**Setup:**

```bash
export SIGNAL_REQUIRE_AUTH=true
export SIGNAL_AUTH_SECRET=test_secret_32_characters_12345
export TRADE_SIGNAL_AUTH_SECRET=test_secret_32_characters_12345
```

**Test Steps:**

1. **Valid Signature:**

   - Generate correct HMAC-SHA256 signature
   - Send with X-Signal-Signature and X-Signal-Timestamp headers
   - Expected: accepted
   - Verify: status="accepted"

2. **Missing Signature:**

   - Send signal without X-Signal-Signature header
   - Expected: rejected
   - Verify: reason="missing_x_signal_signature"

3. **Invalid Signature:**

   - Send with wrong signature
   - Expected: rejected
   - Verify: reason="invalid_signature"

4. **Tampered Payload:**
   - Sign original payload
   - Modify select field
   - Send modified payload with original signature
   - Expected: rejected
   - Verify: reason="invalid_signature"

**Validation:**

- [ ] Valid signatures accepted
- [ ] Invalid signatures rejected
- [ ] HMAC verification working

---

### Test 4: Phase 4 Staged Rollout (Ultra-Conservative)

**Setup:**

```bash
export SIGNAL_RECEIVER_DRY_RUN=false  # Enable live mode!
export TRADE_SIGNAL_DRY_RUN=false
export TRADING_MODE=ultra_conservative
export TRADING_ENABLED=true
export TRADING_PAUSED=false
```

**Test Steps:**

1. **Position Sizing:**

   - Config: buy_amount_sol: 0.01
   - Send BUY signal in ultra_conservative mode
   - Expected: actual buy amount = 0.0001 SOL (1%)
   - Verify: POST /trading/trades shows amount: 0.0001

2. **Monitor Metrics:**

   - Track metrics for 1 hour
   - Expected: acceptance rate > 90%
   - Verify: no unexpected rejections

3. **Unit Economics:**
   - Execute 10 trades
   - Expected: win_rate calculable
   - Verify: GET /trading/stats shows stats

**Validation:**

- [ ] Position sizing correct
- [ ] Trades executing en live
- [ ] Metrics tracking working
- [ ] PnL calculating correctly

---

### Test 5: Phase 4 Mode Escalation

**Setup:**

- Continue from ultra_conservative after 24-48h
- Ensure metrics are stable

**Test Steps:**

1. **Escalate to Conservative:**

   ```bash
   curl -X POST http://localhost:8787/trading/mode \
     -H "Content-Type: application/json" \
     -d '{"mode": "conservative"}'
   ```

   - Expected: status="updated"
   - Verify: GET /trading/config shows mode="conservative"

2. **Verify Sizing:**

   - Send BUY signal
   - Expected: amount = 0.001 SOL (10%)
   - Verify: logged correctly

3. **Monitor for Errors:**

   - Run for 48-72 hours
   - Expected: execution success rate > 95%
   - Verify: no systematic failures

4. **Escalate to Normal:**
   ```bash
   curl -X POST http://localhost:8787/trading/mode \
     -H "Content-Type: application/json" \
     -d '{"mode": "normal"}'
   ```
   - Expected: mode="normal"
   - Verify: amount = 0.01 SOL (100%)

**Validation:**

- [ ] Mode switching seamless
- [ ] Position sizing updates correctly
- [ ] Metrics continue tracking
- [ ] No execution errors

---

### Test 6: Phase 4 Emergency Controls

**Setup:**

- Running in live mode with active positions

**Test Steps:**

1. **Panic/Resume:**

   ```bash
   # Check status before
   curl http://localhost:8787/trading/status | jq '.paused'
   # Expected: false

   # Pause
   curl -X POST http://localhost:8787/trading/pause
   # Expected: status="paused"

   # Verify paused
   curl http://localhost:8787/trading/status | jq '.paused'
   # Expected: true

   # Try to resume
   curl -X POST http://localhost:8787/trading/resume
   # Expected: status="resumed"

   # Verify resumed
   curl http://localhost:8787/trading/status | jq '.paused'
   # Expected: false
   ```

2. **Kill Switch:**

   ```bash
   curl -X POST http://localhost:8787/trading/kill-switch
   ```

   - Expected: status="killed"
   - Verify: enabled=false, paused=true
   - Verify: cannot resume without restart

3. **Rollback Status:**
   ```bash
   curl http://localhost:8787/trading/rollback-status | jq
   ```
   - Expected: JSON with activePositions, recommendedAction
   - Verify: if activePositions > 0, recommendedAction="close_positions_first"

**Validation:**

- [ ] Pause/resume working
- [ ] Kill switch immediate
- [ ] Status endpoint accurate
- [ ] Rollback path clear

---

### Test 7: Denylist/Allowlist Management

**Setup:**

- Running system with configuration

**Test Steps:**

1. **Add to Denylist:**

   ```bash
   curl -X POST http://localhost:8787/trading/denylist/add \
     -H "Content-Type: application/json" \
     -d '{"token_mint": "BadToken123"}'
   ```

   - Expected: status="updated"

2. **Verify Denylist Enforced:**

   - Emit signal with BadToken123
   - Expected: rejected with reason="token_in_denylist"

3. **Set Allowlist:**

   ```bash
   curl -X POST http://localhost:8787/trading/allowlist/set \
     -H "Content-Type: application/json" \
     -d '{"tokens": ["GoodToken1", "GoodToken2"]}'
   ```

   - Expected: status="updated"

4. **Verify Allowlist Enforced:**
   - Emit signal with GoodToken1: accepted
   - Emit signal with OtherToken: rejected

**Validation:**

- [ ] Denylist API working
- [ ] Denylist enforced
- [ ] Allowlist API working
- [ ] Allowlist enforced

---

## Monitoring & Alerting Setup

### Metrics to Dashboard

```bash
# Extract metrics and push to monitoring system
/trading/stats -> Grafana/Prometheus
/trading/status -> Health dashboard
/trading/config -> Config audit trail
```

### Alert Conditions

1. **Execution Success Rate < 90%:**

   - Action: Investigate and pause if < 70%

2. **Latency > 3 seconds:**

   - Action: Check RPC connection

3. **Win Rate < 30%:**

   - Action: Review signal quality, consider disabling

4. **Active Positions > max_concurrent:**

   - Action: Emergency - should never happen

5. **PnL Negative > threshold:**
   - Action: Review recent trades, consider pausing

---

## Sign-Off

Phase 2, 3, 4 implementation complete when:

- [ ] All integration tests passing
- [ ] All security checks passing
- [ ] Documentation reviewed and approved
- [ ] Team trained on runbooks
- [ ] Monitoring and alerting configured
- [ ] Emergency procedures drilled
- [ ] Management approval obtained

**Authorized by:** ****\*\*****\_****\*\*****
**Date:** **\*\***\_\_\_**\*\***
**Notes:** ****\*\*\*\*****\_\_\_****\*\*\*\*****

---

## Rollback Procedure (If Needed)

1. **Immediate (< 1 minute):**

   - Kill switch API or SIGTERM signal
   - Disables all new trades
   - Existing positions remain open

2. **Short-term (1-10 minutes):**

   - Close open positions manually via SELL signals
   - Or wait for stop-loss triggers

3. **Medium-term (10-60 minutes):**

   - Disable trading completely
   - Review error logs
   - Assess damage

4. **Long-term (> 1 hour):**
   - Restart service with roll-back config
   - Revert to previous code version if needed
   - Post-incident review

---

## References

- Implementation Guide: [PHASE_2_3_4_IMPLEMENTATION.md](./PHASE_2_3_4_IMPLEMENTATION.md)
- Quick Start: [PHASE_2_3_4_QUICK_START.md](./PHASE_2_3_4_QUICK_START.md)
- Env Template: [.env.example](./.env.example)
