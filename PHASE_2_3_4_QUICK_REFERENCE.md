# Phases 2, 3, 4 - Quick Reference Card

## 🚀 Quick Start (30 seconds)

```bash
# 1. Environment setup
export SIGNAL_RECEIVER_DRY_RUN=true
export TRADE_SIGNAL_DRY_RUN=true
export TRADING_ENABLED=false

# 2. Start Rust bot
cd Auto-solana-trading-bot
cargo run --release

# 3. Send test signal (from another terminal)
curl -X POST http://localhost:8787/signals \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion":"1.0","signalId":"test-001",
    "signalType":"TOKEN_INVESTIGATION","riskScore":45,
    "emittedAt":"2026-04-09T10:00:00Z",
    "sourceSystem":"foilops-intelligence",
    "tokenMint":"EPjFWaLb3hLW1zLwT8sgUxsqF7xo8YCvqKjhyxHRt1jR",
    "traceAlerts":[],"actionHint":"WATCH_ONLY"
  }'

# 4. Check status
curl http://localhost:8787/trading/status | jq
```

---

## 📋 What Each Phase Does

### Phase 2: Signal Mapping

```
TypeScript Intelligence     Rust Trading Bot
      ↓                            ↓
TOKEN_INVESTIGATION ----→ BUY_TOKEN (buy the token)
SUSPICIOUS_LAUNCH ------→ SELL_TOKEN (protect portfolio)
COPY_TRADE -----------→ COPY_TRADE (mirror wallet)
Unknown ---------------→ WATCH_ONLY (observe)
```

**Routing Logic:**

1. Receive signal (POST /signals)
2. Validate schema
3. Map signalType to action
4. Determine DEX (Raydium > PumpFun)
5. Execute or skip based on mode

### Phase 3: Safety Gates

```
Signal Arrives
     ↓
┌─────────────────────────────────┐
│ GATE 1: Risk Score ≤ 75?        │ → Reject if >75
└─────────────────────────────────┘
     ↓
┌─────────────────────────────────┐
│ GATE 2: Position Size OK?        │ → Reject if exceeds max
└─────────────────────────────────┘
     ↓
┌─────────────────────────────────┐
│ GATE 3: Concurrent Trades < Max? │ → Reject if ≥ max
└─────────────────────────────────┘
     ↓
┌─────────────────────────────────┐
│ GATE 4: Token Not Denylisted?    │ → Reject if denied
└─────────────────────────────────┘
     ↓
┌─────────────────────────────────┐
│ GATE 5: Liquidity > Minimum?     │ → Reject if illiquid
└─────────────────────────────────┘
     ↓
Execute (if dry-run=false)
```

**Deduplication & Auth:**

- Map signal to token, check if seen in last 300s → DEDUPLICATE
- Verify timestamp ±120s → VALIDATE FRESHNESS
- Check HMAC signature → VERIFY AUTHENTICITY
- Log all events → AUDIT

### Phase 4: Staged Rollout

```
Dry-Run (validate routing)
    ↓ (after 2-4 hours, metrics stable)
Ultra-Conservative (1% position sizing)
    ↓ (after 24-48 hours, no errors)
Conservative (10% position sizing)
    ↓ (after 48-72 hours, win rate acceptable)
Normal (100% position sizing)
```

**At Each Stage:**

- Monitor: acceptance rate, error rate, latency, PnL
- Can pause/resume any time
- Emergency kill switch always available

---

## 🛑 Emergency Commands

```bash
# Immediate stop (no new trades)
curl -X POST http://localhost:8787/trading/kill-switch

# Temporary pause (can resume)
curl -X POST http://localhost:8787/trading/pause

# Resume (if enabled and not killed)
curl -X POST http://localhost:8787/trading/resume

# Check state (before any action)
curl http://localhost:8787/trading/status | jq

# What to do next (recovery plan)
curl http://localhost:8787/trading/rollback-status | jq '.recommendedAction'
```

---

## ⚙️ Configuration Essentials

| Var                     | Default | Start Value        | Production | Purpose                     |
| ----------------------- | ------- | ------------------ | ---------- | --------------------------- |
| SIGNAL_RECEIVER_DRY_RUN | -       | true               | false      | Accept but don't trade      |
| TRADING_MODE            | normal  | ultra_conservative | normal     | Position size (1%→10%→100%) |
| TRADING_ENABLED         | false   | false              | true       | Allow trades                |
| MAX_CONCURRENT_TRADES   | 5       | 3                  | 5          | Max open positions          |
| MAX_POSITION_SIZE_SOL   | 0.1     | 0.05               | 0.1        | Total position cap          |
| SLIPPAGE                | 3.0     | 2.0                | 3.0        | Max slippage %              |
| SIGNAL_REQUIRE_AUTH     | -       | false              | true       | Auth required               |

---

## 📊 Monitoring Checklists

### Hourly (First 24h)

- [ ] Signal acceptance rate > 90%
- [ ] Execution success rate = 100%
- [ ] No cryptic errors in logs
- [ ] Latency < 2s

### Daily (After 24h)

- [ ] Acceptance rate stable
- [ ] Win rate calculating correctly
- [ ] PnL tracking working
- [ ] No systematic failures
- [ ] Metrics dashboard updated

### Before Escalation (24-48h mark)

- [ ] Total trades > 10
- [ ] Win rate > 0% (at least one win)
- [ ] No hanging trades
- [ ] No repeated errors
- [ ] Risk gates working (rejections expected)

### Before Going Live (Post-testing)

- [ ] All tests passing
- [ ] Team trained
- [ ] Runbooks reviewed
- [ ] Kill switch tested
- [ ] Alerts configured
- [ ] On-call coverage

---

## 🔍 Common Issues & Fixes

| Issue                 | Check           | Fix                                                    |
| --------------------- | --------------- | ------------------------------------------------------ |
| Signal not received   | Port 8787 open? | `lsof -i :8787`                                        |
| Keep getting rejected | Risk gates?     | Lower risk_score in signal                             |
| Trades not executing  | Mode=dry-run?   | Set SIGNAL_RECEIVER_DRY_RUN=false                      |
| Auth failure          | Secret match?   | `echo $SIGNAL_AUTH_SECRET vs TRADE_SIGNAL_AUTH_SECRET` |
| Slow execution        | RPC lag?        | Check RPC endpoint latency                             |
| High slippage         | Pool size?      | Increase SLIPPAGE tolerance                            |

---

## 📈 Key Metrics to Watch

```json
{
  "signal_health": {
    "accept_rate": "95%", // Should be > 90%
    "reject_rate": "5%", // Should be low
    "dedup_rate": "2%", // Optional metric
    "error_rate": "0%" // Should be 0%
  },
  "execution_health": {
    "success_rate": "98%", // Should be > 95%
    "avg_latency_ms": 850, // Should be < 2000ms
    "active_positions": 2, // Monitor against max
    "total_trades": 42
  },
  "profitability": {
    "total_pnl": 0.125, // Track trend
    "win_rate": 0.619, // Should be > 40%
    "avg_trade_value": 0.003, // Monitor consistency
    "losing_streak": 2 // Alert if > 5
  }
}
```

---

## 🔐 Security Checklist

- [ ] SIGNAL_AUTH_SECRET generated (openssl rand -hex 32)
- [ ] Auth enabled before production (SIGNAL_REQUIRE_AUTH=true)
- [ ] Secrets NOT in .env (use secure vault)
- [ ] Audit logs enabled (AUDIT_LOG_ENABLED=true)
- [ ] Kill switch tested quarterly
- [ ] Denylist maintained (scam tokens added)
- [ ] Access logs reviewed weekly
- [ ] Emergency runbook documented

---

## 📐 Position Sizing Reference

For base amount: **0.01 SOL**

| Mode               | Multiplier | Actual Amount | Risk Level |
| ------------------ | ---------- | ------------- | ---------- |
| ultra_conservative | 1%         | 0.0001 SOL    | Minimal    |
| conservative       | 10%        | 0.001 SOL     | Low        |
| normal             | 100%       | 0.01 SOL      | Medium     |
| aggressive         | 150%       | 0.015 SOL     | High       |

**Recommendation:** Start ultra_conservative, escalate only after 24-48h of stable metrics.

---

## 🚨 Kill Switch Procedures

### Scenario 1: Unexpected Losses

```bash
# 1. Check status
curl http://localhost:8787/trading/status | jq '.total_pnl'

# 2. If PnL < threshold, kill
curl -X POST http://localhost:8787/trading/kill-switch

# 3. Assess damage
curl http://localhost:8787/trading/trades | jq '.[] | last'

# 4. Restart (if needed)
# Kill process, review logs, restart with TRADING_ENABLED=false
```

### Scenario 2: System Malfunction

```bash
# 1. Immediate
curl -X POST http://localhost:8787/trading/kill-switch

# 2. Check logs for errors
tail -f <log_file> | grep ERROR

# 3. Investigate root cause
# Maybe RPC down? Maybe signal flow broken?

# 4. Restart when safe
# systemctl restart trading-bot (or equivalent)
```

### Scenario 3: Scheduled Maintenance

```bash
# 1. Pause trading (keeps positions open)
curl -X POST http://localhost:8787/trading/pause

# 2. Perform maintenance
# Update code, configs, etc.

# 3. Resume
curl -X POST http://localhost:8787/trading/resume

# 4. Verify normal operation
curl http://localhost:8787/health | jq
```

---

## 📞 Support Matrix

| Question             | Answer                        | Reference                      |
| -------------------- | ----------------------------- | ------------------------------ |
| "How do I start?"    | Use Quick Start section       | PHASE_2_3_4_QUICK_START.md     |
| "How does it work?"  | Read implementation guide     | PHASE_2_3_4_IMPLEMENTATION.md  |
| "How do I test?"     | Follow verification checklist | PHASE_2_3_4_VERIFICATION.md    |
| "What's the config?" | Check .env.example template   | .env.example                   |
| "How do I escalate?" | See staged rollout path       | PHASE_2_3_4_SUMMARY.md         |
| "Emergency?"         | Use kill switch commands      | Above (Kill Switch Procedures) |

---

## 🎯 Success Criteria

✅ **Phase 2 Success:**

- Signals route to correct DEX
- Trades execute in live mode
- Positions tracked correctly

✅ **Phase 3 Success:**

- Risk gates block bad signals
- Deduplication prevents duplicates
- Auth verification working
- Audit logs comprehensive

✅ **Phase 4 Success:**

- Dry-run stable 4+ hours
- Ultra-conservative 24-48h stable
- Escalate to conservative
- No unexpected system behavior
- Team confident in kill switch

---

## 📚 Full Documentation

- **Technical Deep-Dive:** [PHASE_2_3_4_IMPLEMENTATION.md](./PHASE_2_3_4_IMPLEMENTATION.md)
- **Hands-On Examples:** [PHASE_2_3_4_QUICK_START.md](./PHASE_2_3_4_QUICK_START.md)
- **Testing Guide:** [PHASE_2_3_4_VERIFICATION.md](./PHASE_2_3_4_VERIFICATION.md)
- **Executive Summary:** [PHASE_2_3_4_SUMMARY.md](./PHASE_2_3_4_SUMMARY.md)
- **Environment Config:** [.env.example](./.env.example)
- **Phases Overview:** [MIGRATION_PHASES.md](./MIGRATION_PHASES.md)

---

**Last Updated:** April 9, 2026  
**Status:** ✅ Ready for Deployment  
**Version:** 1.0 (Phases 2, 3, 4 Complete)
