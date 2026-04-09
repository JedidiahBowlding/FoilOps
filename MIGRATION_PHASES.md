# Migration Phases: Intelligence System -> Auto-solana-trading-bot

## Goal

Integrate the TypeScript intelligence system (detection, tracing, scoring, alerts) with the Rust execution engine (`Auto-solana-trading-bot`) using a safe, staged rollout.

## Architecture Direction

- **Intelligence Plane (TypeScript):** emits normalized risk/trade signals.
- **Execution Plane (Rust):** validates risk gates and executes trades.
- **Signal Adapter:** strict contract + authenticated ingestion layer between both systems.

---

## Phase 1: Signal Contract + Dry-Run Bridge

### Objective

Define and validate end-to-end signal flow with no live trading.

### Tasks

1. Define a stable JSON schema for emitted signals.
2. Add signal producer in TypeScript from scam intelligence events.
3. Add signal receiver in Rust (HTTP or queue/file ingress).
4. Add strict schema validation and required fields checks.
5. Add dry-run mode in Rust: accept and log, but do not execute swaps.

### Deliverables

- Shared signal schema docs.
- TypeScript emitter module.
- Rust receiver module.
- Dry-run logs proving receipt and parsing.

### Exit Criteria

- Signals are transmitted, validated, and logged end-to-end.
- No trade execution path is invoked.

---

## Phase 2: Decision Bridge to Existing Execution Engine

### Objective

Map validated signals to existing Rust swap strategy functions.

### Tasks

1. Convert signal payload to internal execution request model.
2. Integrate with existing execution modules:
   - `Auto-solana-trading-bot/src/engine/strategy.rs`
   - `Auto-solana-trading-bot/src/engine/swap.rs`
3. Support DEX routing based on signal metadata.
4. Keep feature-flag control (`DRY_RUN`, `LIVE_TRADING_ENABLED`).

### Deliverables

- Strategy adapter layer in Rust.
- Deterministic routing from signal -> execution function.

### Exit Criteria

- Execution functions can be called from signal pathway in test mode.
- Manual verification confirms expected routing.

---

## Phase 3: Safety Gates, Idempotency, and Observability

### Objective

Prevent unsafe or duplicate execution and add full auditability.

### Tasks

1. Add hard risk gates:
   - max position size
   - max concurrent positions
   - slippage cap
   - minimum liquidity
   - denylist/allowlist checks
2. Add idempotency key + duplicate suppression window.
3. Add replay protection and timestamp freshness checks.
4. Add signed/authenticated signal verification.
5. Add structured logs for:
   - received
   - rejected (with reason)
   - accepted
   - executed
6. Add metrics (accept/reject/execution rates).

### Deliverables

- Risk gate middleware.
- Idempotency store.
- Auth verification on ingress.
- Audit logging/metrics hooks.

### Exit Criteria

- Unsafe signals are blocked with explicit reasons.
- Duplicate/replayed events are rejected.
- Execution traces are auditable.

---

## Phase 4: Controlled Live Rollout

### Objective

Enable live trading with strict guardrails and staged risk.

### Tasks

1. Enable live mode behind explicit feature flag.
2. Start with tiny position sizing.
3. Roll out to limited signal classes first.
4. Monitor PnL, latency, reject rates, and execution errors.
5. Add emergency kill switch and runtime pause/resume controls.
6. Define rollback procedure and fast disable path.

### Deliverables

- Live configuration profile.
- Rollback runbook.
- On-call checklist for anomalies.

### Exit Criteria

- Live pipeline is stable under monitored load.
- Risk controls and kill switch are proven in drills.

---

## Recommended Order of Implementation

1. Phase 1 (must complete first)
2. Phase 2
3. Phase 3
4. Phase 4

---

## Notes

- Do not skip dry-run validation.
- Do not enable live trading before idempotency + auth + risk gates are in place.
- Keep TypeScript and Rust repos loosely coupled via a versioned signal contract.
