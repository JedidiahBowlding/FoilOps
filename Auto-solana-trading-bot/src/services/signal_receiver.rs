use axum::{body::Bytes, extract::State, http::{HeaderMap, StatusCode}, routing::{get, post}, Json, Router};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use crate::services::signal_execution::SignalExecutionEngine;

#[derive(Debug, Clone)]
pub struct SignalReceiverConfig {
    pub dry_run: bool,
    pub require_auth: bool,
    pub auth_secret: Option<String>,
    pub dedup_window_seconds: u64,
    pub max_timestamp_skew_seconds: u64,
}

type HmacSha256 = Hmac<Sha256>;

struct SignalReceiverState {
    config: SignalReceiverConfig,
    runtime_dry_run: Arc<Mutex<bool>>,
    seen_signals: Arc<Mutex<HashMap<String, Instant>>>,
    recent_decisions: Arc<Mutex<Vec<DecisionRecord>>>,
    failed_signals: Arc<Mutex<Vec<FailedSignalRecord>>>,
    audit_logs: Arc<Mutex<Vec<AuditLogEntry>>>,
    metrics: Arc<Mutex<ReceiverMetrics>>,
    execution_engine: Option<Arc<SignalExecutionEngine>>,
}

impl Clone for SignalReceiverState {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime_dry_run: Arc::clone(&self.runtime_dry_run),
            seen_signals: Arc::clone(&self.seen_signals),
            recent_decisions: Arc::clone(&self.recent_decisions),
            failed_signals: Arc::clone(&self.failed_signals),
            audit_logs: Arc::clone(&self.audit_logs),
            metrics: Arc::clone(&self.metrics),
            execution_engine: self.execution_engine.as_ref().map(Arc::clone),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DecisionRecord {
    recorded_at: String,
    signal_id: String,
    signal_type: String,
    action_hint: String,
    risk_score: Option<f64>,
    token_mint: Option<String>,
    status: String,
    safety_pass: Option<bool>,
    safety_reasons: Vec<String>,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditLogEntry {
    timestamp: String,
    signal_id: String,
    event_type: String,  // "received" | "rejected" | "accepted" | "blocked" | "executed" | "failed"
    reason: String,
    gate_name: Option<String>,
    details: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FailedSignalRecord {
    signal_id: String,
    signal_type: String,
    token_mint: Option<String>,
    source_wallet: Option<String>,
    status: String,
    reason: String,
    retry_count: u32,
    last_failed_at: String,
    signal: TradeSignalV1,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiverMetrics {
    // Core metrics
    received_total: u64,
    accepted_total: u64,
    executed_total: u64,
    blocked_total: u64,
    failed_total: u64,
    rejected_total: u64,
    duplicate_total: u64,
    retried_total: u64,
    dead_letter_total: u64,

    // Phase 3: Gate-based rejection tracking
    #[serde(default)]
    gate_risk_score_exceeded: u64,
    #[serde(default)]
    gate_alert_quality_low: u64,
    #[serde(default)]
    gate_trace_alerts_low: u64,
    #[serde(default)]
    gate_token_denylist: u64,
    #[serde(default)]
    gate_token_not_allowlisted: u64,
    #[serde(default)]
    gate_missing_source_wallet: u64,
    #[serde(default)]
    gate_source_wallet_not_watchlisted: u64,
    #[serde(default)]
    gate_source_wallet_profile_blocked: u64,
    #[serde(default)]
    gate_source_wallet_action_blocked: u64,
    #[serde(default)]
    gate_source_wallet_profile_risk_exceeded: u64,
    #[serde(default)]
    gate_source_wallet_profile_cap_exceeded: u64,
    #[serde(default)]
    gate_source_wallet_cap_exceeded: u64,
    #[serde(default)]
    gate_max_concurrent_positions: u64,
    #[serde(default)]
    gate_min_liquidity_failed: u64,
    #[serde(default)]
    gate_token_liquidity_too_low: u64,
    #[serde(default)]
    gate_token_holder_concentration: u64,
    #[serde(default)]
    gate_token_rug_heuristics: u64,
    #[serde(default)]
    gate_token_honeypot: u64,
    #[serde(default)]
    gate_token_creator_control: u64,
    #[serde(default)]
    gate_invalid_timestamp: u64,
    #[serde(default)]
    gate_auth_failed: u64,
    #[serde(default)]
    gate_stale_copy_trade_signal: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeSignalV1 {
    pub schema_version: String,
    pub signal_id: String,
    pub emitted_at: String,
    pub source_system: String,
    pub signal_type: String,
    pub dry_run: bool,
    pub risk_score: f64,
    pub risk_level: String,
    pub tracked_wallet: Option<String>,
    pub developer_wallet: Option<String>,
    pub token_mint: Option<String>,
    pub trace_alerts: Vec<String>,
    pub action_hint: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignalReceiverResponse {
    status: String,
    mode: String,
    signal_id: String,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub request_id: String,
    pub signal_type: String,
    pub action: String,
    pub action_hint: String,
    pub target_wallet: String,
    pub source_wallet: Option<String>,
    pub token_mint: Option<String>,
    pub risk_score: f64,
    pub risk_level: String,
    pub metadata: Option<Value>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: String,
    mode: String,
    auth_required: bool,
    dedup_window_seconds: u64,
    max_timestamp_skew_seconds: u64,
}

pub async fn start_signal_receiver(
    bind_addr: &str,
    dry_run: bool,
    require_auth: bool,
    auth_secret: Option<String>,
    dedup_window_seconds: u64,
    max_timestamp_skew_seconds: u64,
    execution_engine: Option<Arc<SignalExecutionEngine>>,
) -> Result<(), String> {
    let socket_addr: SocketAddr = bind_addr
        .parse()
        .map_err(|e| format!("Invalid SIGNAL_RECEIVER_BIND address: {}", e))?;

    let state = Arc::new(SignalReceiverState {
        config: SignalReceiverConfig {
            dry_run,
            require_auth,
            auth_secret,
            dedup_window_seconds,
            max_timestamp_skew_seconds,
        },
        runtime_dry_run: Arc::new(Mutex::new(dry_run)),
        seen_signals: Arc::new(Mutex::new(HashMap::new())),
        recent_decisions: Arc::new(Mutex::new(Vec::new())),
        failed_signals: Arc::new(Mutex::new(Vec::new())),
        audit_logs: Arc::new(Mutex::new(Vec::new())),
        metrics: Arc::new(Mutex::new(ReceiverMetrics::default())),
        execution_engine,
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/signals", post(receive_signal))
        .route("/trading/status", get(get_trading_status))
        .route("/trading/balance", get(get_balance))
        .route("/trading/trades", get(get_recent_trades))
        .route("/trading/stats", get(get_trading_stats))
        .route("/trading/config", get(get_config))
        .route("/trading/enable", post(enable_trading))
        .route("/trading/disable", post(disable_trading))
        .route("/trading/pause", post(pause_trading))
        .route("/trading/resume", post(resume_trading))
        .route("/trading/slippage", get(get_slippage).post(set_slippage))
        .route("/trading/target", get(get_target).post(set_target))
        .route("/trading/execution-wallet", get(get_execution_wallet).post(set_execution_wallet))
        .route("/trading/mev", get(get_mev_service).post(set_mev_service))
        .route("/trading/kill-switch", post(kill_switch))
        .route("/trading/risk", get(get_risk).post(set_risk))
        .route("/trading/profile", post(set_profile))
        .route("/trading/mode", post(set_mode))
        .route("/trading/size", post(set_size))
        .route("/trading/tighten-risk", post(tighten_risk))
        .route("/trading/execution-mode", get(get_execution_mode).post(set_execution_mode))
        .route("/trading/source-wallets", get(get_source_wallets).post(update_source_wallets))
        .route("/trading/alert-quality", get(get_alert_quality).post(set_alert_quality))
        .route("/trading/buy-once-per-token", get(get_buy_once_per_token).post(set_buy_once_per_token))
        .route("/trading/pre-buy-safety", get(get_pre_buy_safety).post(set_pre_buy_safety))
        .route("/trading/pre-buy-checks", get(get_pre_buy_checks).post(set_pre_buy_checks))
        .route("/trading/stop-loss", get(get_stop_loss).post(set_stop_loss))
        .route("/trading/take-profit", get(get_take_profit).post(set_take_profit))
        .route("/trading/copy-trade-signal-age", get(get_copy_trade_signal_age).post(set_copy_trade_signal_age))
        .route("/trading/max-concurrent-trades", get(get_max_concurrent_trades).post(set_max_concurrent_trades))
        .route("/trading/max-position-size", get(get_max_position_size).post(set_max_position_size))
        .route("/trading/min-liquidity", get(get_min_liquidity).post(set_min_liquidity))
        .route("/trading/allowed-dexes", get(get_allowed_dexes).post(set_allowed_dexes))
        .route("/trading/auto-block-source-wallet", get(get_auto_block_source_wallet).post(set_auto_block_source_wallet))
        .route("/trading/denylist", get(get_denylist).post(set_denylist))
        .route("/trading/allowlist", get(get_allowlist).post(set_allowlist))
        .route("/trading/journal", get(get_trade_journal))
        .route("/trading/metrics", get(get_metrics))
        .route("/trading/dead-letters", get(get_dead_letters))
        .route("/trading/audit-logs", get(get_audit_logs))
        .route("/trading/retry-failed", post(retry_failed_signals))
        .route("/trading/safety", get(get_safety))
        .route("/trading/decisions", get(get_decisions))
        .with_state(state);

    println!(
        "Signal receiver listening on {} (mode: {}, auth: {}, dedup_window_s: {})",
        bind_addr,
        if dry_run { "dry-run" } else { "live" },
        if require_auth { "required" } else { "optional" },
        dedup_window_seconds,
    );

    let listener = tokio::net::TcpListener::bind(socket_addr)
        .await
        .map_err(|e| format!("Failed to bind signal receiver listener: {}", e))?;

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Signal receiver server error: {}", e))
}

async fn health_check(
    State(state): State<Arc<SignalReceiverState>>,
) -> (StatusCode, Json<HealthResponse>) {
    let is_dry_run = *state.runtime_dry_run.lock().await;
    (
        StatusCode::OK,
        Json(HealthResponse {
            status: "ok".to_string(),
            mode: if is_dry_run { "paper".to_string() } else { "live".to_string() },
            auth_required: state.config.require_auth,
            dedup_window_seconds: state.config.dedup_window_seconds,
            max_timestamp_skew_seconds: state.config.max_timestamp_skew_seconds,
        }),
    )
}

#[axum::debug_handler]
async fn receive_signal(
    State(state): State<Arc<SignalReceiverState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<SignalReceiverResponse>, StatusCode> {
    increment_metric(&state, "received_total").await;

    if let Err(reason) = verify_headers_and_signature(&state.config, &headers, body.as_ref()) {
        let mode = current_mode_label(&state).await;
        increment_metric(&state, "rejected_total").await;
        increment_metric(&state, "gate_auth_failed").await;
        
        // Phase 3: Audit log for auth failure
        record_audit_log(
            &state,
            "unknown".to_string(),
            "rejected".to_string(),
            reason.clone(),
            Some("auth_gate".to_string()),
            None,
        ).await;
        
        record_decision(
            &state,
            "unknown".to_string(),
            "unknown".to_string(),
            "unknown".to_string(),
            None,
            None,
            "rejected".to_string(),
            None,
            vec![],
            Some(reason.clone()),
        ).await;
        return Ok(reject_signal(reason, "unknown".to_string(), mode).1);
    }

    let signal: TradeSignalV1 = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(_) => {
            let reason = "invalid_json_payload".to_string();
            let mode = current_mode_label(&state).await;
            increment_metric(&state, "rejected_total").await;
            record_decision(
                &state,
                "unknown".to_string(),
                "unknown".to_string(),
                "unknown".to_string(),
                None,
                None,
                "rejected".to_string(),
                None,
                vec![],
                Some(reason.clone()),
            ).await;
            return Ok(reject_signal(reason, "unknown".to_string(), mode).1)
        }
    };

    if signal.schema_version != "1.0" {
        let reason = "unsupported_schema_version".to_string();
        let mode = current_mode_label(&state).await;
        increment_metric(&state, "rejected_total").await;
        record_decision(
            &state,
            signal.signal_id.clone(),
            signal.signal_type.clone(),
            signal.action_hint.clone(),
            Some(signal.risk_score),
            signal.token_mint.clone(),
            "rejected".to_string(),
            None,
            vec![],
            Some(reason.clone()),
        ).await;
        enqueue_dead_letter(&state, &signal, "rejected".to_string(), reason.clone()).await;
        return Ok(reject_signal(reason, signal.signal_id, mode).1);
    }

    let is_dry_run = *state.runtime_dry_run.lock().await;

    if is_duplicate_signal(&state, &signal, &headers).await {
        increment_metric(&state, "duplicate_total").await;
        record_decision(
            &state,
            signal.signal_id.clone(),
            signal.signal_type.clone(),
            signal.action_hint.clone(),
            Some(signal.risk_score),
            signal.token_mint.clone(),
            "duplicate".to_string(),
            None,
            vec![],
            Some("duplicate_idempotency_key".to_string()),
        ).await;
        return Ok(Json(SignalReceiverResponse {
            status: "duplicate".to_string(),
            mode: if is_dry_run { "paper".to_string() } else { "live".to_string() },
            signal_id: signal.signal_id.clone(),
            reason: Some("duplicate_idempotency_key".to_string()),
        }));
    }

    let (safety_pass, safety_reasons) = evaluate_signal_safety(&state, &signal).await;

    // Phase 3: Track gate failures in metrics & audit logs
    if !safety_pass {
        for reason in &safety_reasons {
            let gate_name = match reason.as_str() {
                r if r.contains("risk_score_too_high") => {
                    increment_metric(&state, "gate_risk_score_exceeded").await;
                    Some("risk_score_gate".to_string())
                }
                r if r.contains("alert_quality_too_low") => {
                    increment_metric(&state, "gate_alert_quality_low").await;
                    Some("alert_quality_gate".to_string())
                }
                r if r.contains("trace_alert_count_too_low") => {
                    increment_metric(&state, "gate_trace_alerts_low").await;
                    Some("trace_alerts_gate".to_string())
                }
                r if r.contains("token_in_denylist") => {
                    increment_metric(&state, "gate_token_denylist").await;
                    Some("token_denylist_gate".to_string())
                }
                r if r.contains("token_not_in_allowlist") => {
                    increment_metric(&state, "gate_token_not_allowlisted").await;
                    Some("token_allowlist_gate".to_string())
                }
                r if r.contains("copy_trade_missing_source_wallet") => {
                    increment_metric(&state, "gate_missing_source_wallet").await;
                    Some("source_wallet_required_gate".to_string())
                }
                r if r.contains("missing_source_wallet_for_watchlist") => {
                    increment_metric(&state, "gate_missing_source_wallet").await;
                    Some("source_wallet_watchlist_gate".to_string())
                }
                r if r.contains("source_wallet_not_watchlisted") => {
                    increment_metric(&state, "gate_source_wallet_not_watchlisted").await;
                    Some("source_wallet_watchlist_gate".to_string())
                }
                r if r.contains("source_wallet_profile_blocked") => {
                    increment_metric(&state, "gate_source_wallet_profile_blocked").await;
                    Some("source_wallet_profile_gate".to_string())
                }
                r if r.contains("source_wallet_action_blocked") => {
                    increment_metric(&state, "gate_source_wallet_action_blocked").await;
                    Some("source_wallet_action_gate".to_string())
                }
                r if r.contains("source_wallet_profile_risk_exceeded") => {
                    increment_metric(&state, "gate_source_wallet_profile_risk_exceeded").await;
                    Some("source_wallet_profile_risk_gate".to_string())
                }
                r if r.contains("source_wallet_profile_cap_exceeded") => {
                    increment_metric(&state, "gate_source_wallet_profile_cap_exceeded").await;
                    Some("source_wallet_profile_cap_gate".to_string())
                }
                r if r.contains("source_wallet_cap_exceeded") => {
                    increment_metric(&state, "gate_source_wallet_cap_exceeded").await;
                    Some("source_wallet_cap_gate".to_string())
                }
                r if r.contains("token_liquidity_too_low") => {
                    increment_metric(&state, "gate_token_liquidity_too_low").await;
                    Some("token_liquidity_gate".to_string())
                }
                r if r.contains("token_holder_concentration_too_high") || r.contains("token_holder_count_too_low") => {
                    increment_metric(&state, "gate_token_holder_concentration").await;
                    Some("holder_concentration_gate".to_string())
                }
                r if r.contains("token_rug_ratio_too_high") || r.contains("token_holder_rugged_history_detected") => {
                    increment_metric(&state, "gate_token_rug_heuristics").await;
                    Some("rug_heuristics_gate".to_string())
                }
                r if r.contains("token_flagged_honeypot") => {
                    increment_metric(&state, "gate_token_honeypot").await;
                    Some("honeypot_gate".to_string())
                }
                r if r.contains("token_creator_controls_not_renounced") || r.contains("token_creator_concentration_too_high") => {
                    increment_metric(&state, "gate_token_creator_control").await;
                    Some("creator_control_gate".to_string())
                }
                r if r.contains("copy_trade_signal_too_old") => {
                    increment_metric(&state, "gate_stale_copy_trade_signal").await;
                    Some("stale_copy_trade_signal_gate".to_string())
                }
                _ => None
            };
            
            if let Some(gate) = gate_name {
                record_audit_log(
                    &state,
                    signal.signal_id.clone(),
                    "blocked".to_string(),
                    reason.clone(),
                    Some(gate),
                    None,
                ).await;
            }
        }
    }

    // Phase 2 & 4: Execute trade if not in dry-run mode and execution engine is available
    let execution_result = if !is_dry_run {
        if let Some(engine) = &state.execution_engine {
            match engine.execute_signal(&signal).await {
                Ok(result) => {
                    println!(
                        "[LIVE EXECUTION] id={} type={} risk={} token={} result={}",
                        signal.signal_id,
                        signal.signal_type,
                        signal.risk_score,
                        signal.token_mint.clone().unwrap_or_else(|| "n/a".to_string()),
                        result
                    );
                    Some(result)
                }
                Err(e) => {
                    println!(
                        "[EXECUTION ERROR] id={} type={} risk={} token={} error={}",
                        signal.signal_id,
                        signal.signal_type,
                        signal.risk_score,
                        signal.token_mint.clone().unwrap_or_else(|| "n/a".to_string()),
                        e
                    );
                    Some(format!("EXECUTION_ERROR: {}", e))
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    let response = SignalReceiverResponse {
        status: classify_execution_status(&execution_result),
        mode: if is_dry_run { "paper".to_string() } else { "live".to_string() },
        signal_id: signal.signal_id.clone(),
        reason: execution_result.clone(),
    };

    match response.status.as_str() {
        "accepted" => increment_metric(&state, "accepted_total").await,
        "executed" => increment_metric(&state, "executed_total").await,
        "blocked" => increment_metric(&state, "blocked_total").await,
        "failed" => increment_metric(&state, "failed_total").await,
        _ => {}
    }

    record_decision(
        &state,
        signal.signal_id.clone(),
        signal.signal_type.clone(),
        signal.action_hint.clone(),
        Some(signal.risk_score),
        signal.token_mint.clone(),
        response.status.clone(),
        Some(safety_pass),
        safety_reasons,
        response.reason.clone(),
    ).await;

    if matches!(response.status.as_str(), "blocked" | "failed") {
        enqueue_dead_letter(
            &state,
            &signal,
            response.status.clone(),
            response.reason.clone().unwrap_or_else(|| "unknown_failure".to_string()),
        )
        .await;
    }

    Ok(Json(response))
}

async fn record_decision(
    state: &Arc<SignalReceiverState>,
    signal_id: String,
    signal_type: String,
    action_hint: String,
    risk_score: Option<f64>,
    token_mint: Option<String>,
    status: String,
    safety_pass: Option<bool>,
    safety_reasons: Vec<String>,
    reason: Option<String>,
) {
    let mut decisions = state.recent_decisions.lock().await;
    decisions.push(DecisionRecord {
        recorded_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string()),
        signal_id,
        signal_type,
        action_hint,
        risk_score,
        token_mint,
        status,
        safety_pass,
        safety_reasons,
        reason,
    });

    if decisions.len() > 200 {
        let overflow = decisions.len() - 200;
        decisions.drain(0..overflow);
    }
}

/// Phase 3: Record audit log entry with event type and gate name for observability
async fn record_audit_log(
    state: &Arc<SignalReceiverState>,
    signal_id: String,
    event_type: String,
    reason: String,
    gate_name: Option<String>,
    details: Option<Value>,
) {
    let mut logs = state.audit_logs.lock().await;
    logs.push(AuditLogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        signal_id,
        event_type,
        reason,
        gate_name,
        details,
    });

    // Keep audit logs rolling buffer at 500 entries
    if logs.len() > 500 {
        let overflow = logs.len() - 500;
        logs.drain(0..overflow);
    }
}

async fn increment_metric(state: &Arc<SignalReceiverState>, field: &str) {
    let mut metrics = state.metrics.lock().await;
    match field {
        "received_total" => metrics.received_total += 1,
        "accepted_total" => metrics.accepted_total += 1,
        "executed_total" => metrics.executed_total += 1,
        "blocked_total" => metrics.blocked_total += 1,
        "failed_total" => metrics.failed_total += 1,
        "rejected_total" => metrics.rejected_total += 1,
        "duplicate_total" => metrics.duplicate_total += 1,
        "retried_total" => metrics.retried_total += 1,
        "dead_letter_total" => metrics.dead_letter_total += 1,
        // Phase 3: Gate-based metrics
        "gate_risk_score_exceeded" => metrics.gate_risk_score_exceeded += 1,
        "gate_alert_quality_low" => metrics.gate_alert_quality_low += 1,
        "gate_trace_alerts_low" => metrics.gate_trace_alerts_low += 1,
        "gate_token_denylist" => metrics.gate_token_denylist += 1,
        "gate_token_not_allowlisted" => metrics.gate_token_not_allowlisted += 1,
        "gate_missing_source_wallet" => metrics.gate_missing_source_wallet += 1,
        "gate_source_wallet_not_watchlisted" => metrics.gate_source_wallet_not_watchlisted += 1,
        "gate_source_wallet_profile_blocked" => metrics.gate_source_wallet_profile_blocked += 1,
        "gate_source_wallet_action_blocked" => metrics.gate_source_wallet_action_blocked += 1,
        "gate_source_wallet_profile_risk_exceeded" => metrics.gate_source_wallet_profile_risk_exceeded += 1,
        "gate_source_wallet_profile_cap_exceeded" => metrics.gate_source_wallet_profile_cap_exceeded += 1,
        "gate_source_wallet_cap_exceeded" => metrics.gate_source_wallet_cap_exceeded += 1,
        "gate_max_concurrent_positions" => metrics.gate_max_concurrent_positions += 1,
        "gate_min_liquidity_failed" => metrics.gate_min_liquidity_failed += 1,
        "gate_token_liquidity_too_low" => metrics.gate_token_liquidity_too_low += 1,
        "gate_token_holder_concentration" => metrics.gate_token_holder_concentration += 1,
        "gate_token_rug_heuristics" => metrics.gate_token_rug_heuristics += 1,
        "gate_token_honeypot" => metrics.gate_token_honeypot += 1,
        "gate_token_creator_control" => metrics.gate_token_creator_control += 1,
        "gate_invalid_timestamp" => metrics.gate_invalid_timestamp += 1,
        "gate_auth_failed" => metrics.gate_auth_failed += 1,
        "gate_stale_copy_trade_signal" => metrics.gate_stale_copy_trade_signal += 1,
        _ => {}
    }
}

fn classify_execution_status(execution_result: &Option<String>) -> String {
    match execution_result.as_deref() {
        Some(result) if result.starts_with("BUY_EXECUTED") || result.starts_with("SELL_EXECUTED") => "executed".to_string(),
        Some(result)
            if result.starts_with("BUY_FAILED")
                || result.starts_with("SELL_FAILED")
                || result.starts_with("EXECUTION_ERROR") =>
        {
            "failed".to_string()
        }
        Some(_) => "blocked".to_string(),
        None => "accepted".to_string(),
    }
}

async fn enqueue_dead_letter(
    state: &Arc<SignalReceiverState>,
    signal: &TradeSignalV1,
    status: String,
    reason: String,
) {
    let mut failed = state.failed_signals.lock().await;
    if let Some(existing) = failed.iter_mut().find(|entry| entry.signal_id == signal.signal_id) {
        existing.status = status;
        existing.reason = reason;
        existing.retry_count += 1;
        existing.last_failed_at = chrono::Utc::now().to_rfc3339();
        existing.signal = signal.clone();
        return;
    }

    failed.push(FailedSignalRecord {
        signal_id: signal.signal_id.clone(),
        signal_type: signal.signal_type.clone(),
        token_mint: signal.token_mint.clone(),
        source_wallet: signal
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("copiedWallet").and_then(|value| value.as_str()))
            .map(|value| value.to_string())
            .or_else(|| signal.tracked_wallet.clone()),
        status,
        reason,
        retry_count: 0,
        last_failed_at: chrono::Utc::now().to_rfc3339(),
        signal: signal.clone(),
    });

    if failed.len() > 200 {
        let overflow = failed.len() - 200;
        failed.drain(0..overflow);
    }

    drop(failed);
    increment_metric(state, "dead_letter_total").await;
}

async fn evaluate_signal_safety(state: &Arc<SignalReceiverState>, signal: &TradeSignalV1) -> (bool, Vec<String>) {
    if let Some(engine) = &state.execution_engine {
        let (pass, mut reasons) = engine.assess_signal_async(signal).await;
        let is_dry_run = *state.runtime_dry_run.lock().await;
        if is_dry_run {
            reasons.push("paper_mode_enabled".to_string());
        }
        return (pass, reasons);
    }

    let mut reasons = Vec::new();
    let needs_token = matches!(
        signal.signal_type.as_str(),
        "TOKEN_INVESTIGATION" | "SUSPICIOUS_TOKEN_LAUNCH" | "AUTO_SELL" | "COPY_TRADE" | "SMART_MONEY_TRADE"
    );

    if needs_token && signal.token_mint.is_none() {
        reasons.push("missing_token_mint".to_string());
    }

    if reasons.is_empty() {
        reasons.push("passes_current_safety_gates".to_string());
        (true, reasons)
    } else {
        (false, reasons)
    }
}

fn verify_headers_and_signature(
    config: &SignalReceiverConfig,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<(), String> {
    if !config.require_auth {
        return Ok(());
    }

    let secret = config
        .auth_secret
        .as_ref()
        .ok_or_else(|| "auth_required_but_secret_missing".to_string())?;

    let timestamp = headers
        .get("x-signal-timestamp")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "missing_x_signal_timestamp".to_string())?;

    let signature = headers
        .get("x-signal-signature")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "missing_x_signal_signature".to_string())?;

    let parsed_timestamp = timestamp
        .parse::<i64>()
        .map_err(|_| "invalid_x_signal_timestamp".to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system_time_error".to_string())?
        .as_secs() as i64;

    let age = (now - parsed_timestamp).abs();
    if age > config.max_timestamp_skew_seconds as i64 {
        return Err("stale_or_future_timestamp".to_string());
    }

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| "invalid_auth_secret".to_string())?;
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    let expected_signature = to_hex(&mac.finalize().into_bytes());

    if expected_signature != signature {
        return Err("invalid_signature".to_string());
    }

    Ok(())
}

async fn is_duplicate_signal(state: &SignalReceiverState, signal: &TradeSignalV1, headers: &HeaderMap) -> bool {
    let idempotency_key = headers
        .get("x-idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| signal.signal_id.clone());

    let window = Duration::from_secs(state.config.dedup_window_seconds);
    let now = Instant::now();

    let mut seen = state.seen_signals.lock().await;

    seen.retain(|_, seen_at| now.duration_since(*seen_at) <= window);

    if seen.contains_key(&idempotency_key) {
        return true;
    }

    seen.insert(idempotency_key, now);
    false
}

async fn current_mode_label(state: &Arc<SignalReceiverState>) -> String {
    if *state.runtime_dry_run.lock().await {
        "paper".to_string()
    } else {
        "live".to_string()
    }
}

fn reject_signal(reason: String, signal_id: String, mode: String) -> (StatusCode, Json<SignalReceiverResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(SignalReceiverResponse {
            status: "rejected".to_string(),
            mode,
            signal_id,
            reason: Some(reason),
        }),
    )
}

fn to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{:02x}", byte));
    }
    output
}

// Trading Control Handlers

async fn get_trading_status(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    let execution_mode = current_mode_label(&state).await;
    if let Some(engine) = &state.execution_engine {
        let mut payload = engine.get_trading_status_async().await;
        let execution_wallet = engine.get_execution_wallet_pubkey_async().await;
        if let Some(object) = payload.as_object_mut() {
            object.insert("executionMode".to_string(), serde_json::json!(execution_mode));
            object.insert("executionWalletPublicKey".to_string(), serde_json::json!(execution_wallet));
        }
        Json(payload)
    } else {
        Json(serde_json::json!({
            "enabled": false,
            "paused": false,
            "mode": "no_execution_engine",
            "executionMode": execution_mode,
            "targetWallet": null,
            "mevService": "none",
            "slippage": 3.0
        }))
    }
}


async fn get_balance(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        match engine.get_balance() {
            Ok(balance) => Json(balance),
            Err(e) => Json(serde_json::json!({ "error": format!("Failed to get balance: {}", e) }))
        }
    } else {
        Json(serde_json::json!({
            "solBalance": 0.0,
            "positions": []
        }))
    }
}


async fn get_recent_trades(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(engine.get_recent_trades_async().await)
    } else {
        Json(serde_json::json!([]))
    }
}


async fn get_trading_stats(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(engine.get_trading_stats_async().await)
    } else {
        Json(serde_json::json!({
            "totalPnL": 0.0,
            "winRate": 0.0,
            "totalTrades": 0,
            "winningTrades": 0,
            "activePositions": 0
        }))
    }
}


async fn get_config(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        let mut payload = engine.get_config_async().await;
        let execution_wallet = engine.get_execution_wallet_pubkey_async().await;
        if let Some(object) = payload.as_object_mut() {
            object.insert("executionWalletPublicKey".to_string(), serde_json::json!(execution_wallet));
        }
        Json(payload)
    } else {
        Json(serde_json::json!({
            "enabled": false,
            "paused": false,
            "mode": "no_execution_engine",
            "targetWallet": null,
            "mevService": "none",
            "slippage": 3.0,
            "buyAmountSol": 0.01,
            "maxConcurrentTrades": 5,
            "stopLossPercentage": 20.0,
            "takeProfitPercentage": 1.0,
            "maxPositionSizeSol": 0.1,
            "minLiquidityUsd": 1000.0,
            "allowedDexes": ["pump_fun", "raydium"],
            "denylist": [],
            "allowlist": [],
            "buyOncePerToken": false
        }))
    }
}

async fn enable_trading(
    State(state): State<Arc<SignalReceiverState>>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let result = engine.enable_trading_async().await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "enabled", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn disable_trading(
    State(state): State<Arc<SignalReceiverState>>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let result = engine.disable_trading_async().await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "disabled", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn pause_trading(
    State(state): State<Arc<SignalReceiverState>>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let result = engine.pause_trading_async().await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "paused", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn resume_trading(
    State(state): State<Arc<SignalReceiverState>>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let result = engine.resume_trading_async().await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "resumed", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_slippage(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "slippage": engine.get_slippage_async().await }))
    } else {
        Json(serde_json::json!({ "slippage": 3.0 }))
    }
}

async fn set_slippage(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(slippage) = payload["slippage"].as_f64() {
            let result = engine.set_slippage_async(slippage).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid slippage value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_stop_loss(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "stop_loss_percentage": engine.get_stop_loss_async().await }))
    } else {
        Json(serde_json::json!({ "stop_loss_percentage": 20.0 }))
    }
}

async fn set_stop_loss(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(percentage) = payload["stop_loss_percentage"].as_f64() {
            let result = engine.set_stop_loss_async(percentage).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid stop_loss_percentage value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_take_profit(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "take_profit_percentage": engine.get_take_profit_async().await }))
    } else {
        Json(serde_json::json!({ "take_profit_percentage": 50.0 }))
    }
}

async fn set_take_profit(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(percentage) = payload["take_profit_percentage"].as_f64() {
            let result = engine.set_take_profit_async(percentage).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid take_profit_percentage value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_copy_trade_signal_age(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "max_copy_trade_signal_age_seconds": engine.get_copy_trade_signal_age_async().await }))
    } else {
        Json(serde_json::json!({ "max_copy_trade_signal_age_seconds": 60u64 }))
    }
}

async fn set_copy_trade_signal_age(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(seconds) = payload["max_copy_trade_signal_age_seconds"].as_u64() {
            let result = engine.set_copy_trade_signal_age_async(seconds).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid max_copy_trade_signal_age_seconds value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_target(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "target_wallet": engine.get_target_wallet_async().await }))
    } else {
        Json(serde_json::json!({ "target_wallet": null }))
    }

}

async fn get_execution_wallet(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        let pubkey = engine.get_execution_wallet_pubkey_async().await;
        Json(serde_json::json!({ "public_key": pubkey }))
    } else {
        Json(serde_json::json!({ "public_key": null }))
    }
}

async fn set_execution_wallet(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let private_key = payload["private_key"]
            .as_str()
            .or_else(|| payload["privateKey"].as_str())
            .unwrap_or_default()
            .trim()
            .to_string();

        if private_key.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "status": "error", "message": "Missing private_key" })),
            );
        }

        let result = engine.set_execution_wallet_private_key_async(private_key).await;
        if result.starts_with("EXECUTION_WALLET_SET:") {
            let public_key = engine.get_execution_wallet_pubkey_async().await;
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "updated",
                    "message": result,
                    "public_key": public_key
                })),
            )
        } else {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "status": "error", "message": result })),
            )
        }
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })),
        )
    }
}

async fn get_max_concurrent_trades(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "max_concurrent_trades": engine.get_max_concurrent_trades_async().await }))
    } else {
        Json(serde_json::json!({ "max_concurrent_trades": 5 }))
    }
}

async fn set_max_concurrent_trades(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(value) = payload["max_concurrent_trades"].as_u64() {
            let result = engine.set_max_concurrent_trades_async(value as usize).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid max_concurrent_trades value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_max_position_size(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "max_position_size_sol": engine.get_max_position_size_async().await }))
    } else {
        Json(serde_json::json!({ "max_position_size_sol": 0.1 }))
    }
}

async fn set_max_position_size(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(sol) = payload["max_position_size_sol"].as_f64() {
            let result = engine.set_max_position_size_async(sol).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid max_position_size_sol value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_min_liquidity(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "min_liquidity_usd": engine.get_min_liquidity_usd_async().await }))
    } else {
        Json(serde_json::json!({ "min_liquidity_usd": 1000.0 }))
    }
}

async fn set_min_liquidity(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(usd) = payload["min_liquidity_usd"].as_f64() {
            let result = engine.set_min_liquidity_usd_async(usd).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid min_liquidity_usd value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_allowed_dexes(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "allowed_dexes": engine.get_allowed_dexes_async().await }))
    } else {
        Json(serde_json::json!({ "allowed_dexes": ["pump_fun", "raydium"] }))
    }
}

async fn set_allowed_dexes(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(arr) = payload["allowed_dexes"].as_array() {
            let dexes: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            let result = engine.set_allowed_dexes_async(dexes).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid allowed_dexes value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_auto_block_source_wallet(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "auto_block_source_wallet_after_buy": engine.get_auto_block_source_wallet_async().await }))
    } else {
        Json(serde_json::json!({ "auto_block_source_wallet_after_buy": false }))
    }
}

async fn set_auto_block_source_wallet(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(enabled) = payload["auto_block_source_wallet_after_buy"].as_bool() {
            let result = engine.set_auto_block_source_wallet_async(enabled).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid auto_block_source_wallet_after_buy value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_denylist(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "denylist": engine.get_denylist_async().await }))
    } else {
        Json(serde_json::json!({ "denylist": [] }))
    }
}

async fn set_denylist(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(arr) = payload["denylist"].as_array() {
            let mints: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            let result = engine.set_denylist_async(mints).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid denylist value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_allowlist(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "allowlist": engine.get_allowlist_async().await }))
    } else {
        Json(serde_json::json!({ "allowlist": [] }))
    }
}

async fn set_allowlist(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(arr) = payload["allowlist"].as_array() {
            let mints: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            let result = engine.set_allowlist_async(mints).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid allowlist value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn set_target(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let target_wallet = payload["target_wallet"].as_str().map(|s| s.to_string());
        let result = engine.set_target_wallet_async(target_wallet).await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_mev_service(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({
            "mev_service": engine.get_mev_service_async().await,
            "available_services": ["jito", "nozomi", "zero_slot", "none"]
        }))
    } else {
        Json(serde_json::json!({
            "mev_service": "none",
            "available_services": ["jito", "nozomi", "zero_slot", "none"]
        }))
    }
}

async fn set_mev_service(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(service) = payload["service"].as_str() {
            let result = engine.set_mev_service_async(service.to_string()).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid service value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn kill_switch(
    State(state): State<Arc<SignalReceiverState>>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let result = engine.kill_switch_async().await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "stopped", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_risk(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "safety": engine.get_safety_summary_async().await }))
    } else {
        Json(serde_json::json!({ "safety": null }))
    }
}

async fn set_risk(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(score) = payload["max_risk_score"].as_f64() {
            let result = engine.set_max_risk_score_async(score).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid max_risk_score" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn set_profile(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(profile) = payload["profile"].as_str() {
            let result = engine.apply_profile_async(profile.to_string()).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid profile" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn set_mode(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(mode) = payload["mode"].as_str() {
            let result = engine.set_mode_async(mode.to_string()).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid mode" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn set_size(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(amount) = payload["buy_amount_sol"].as_f64() {
            let result = engine.set_buy_amount_sol_async(amount).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid buy_amount_sol" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn tighten_risk(
    State(state): State<Arc<SignalReceiverState>>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let result = engine.tighten_risk_async().await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_safety(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(engine.get_safety_summary_async().await)
    } else {
        Json(serde_json::json!({ "error": "No execution engine available" }))
    }
}

async fn get_decisions(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    let decisions = state.recent_decisions.lock().await;
    let recent: Vec<DecisionRecord> = decisions.iter().rev().take(20).cloned().collect();
    Json(serde_json::json!({ "decisions": recent }))
}

async fn get_execution_mode(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    Json(serde_json::json!({ "mode": current_mode_label(&state).await }))
}

async fn set_execution_mode(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let Some(mode) = payload["mode"].as_str() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "Invalid mode value" })),
        );
    };

    let normalized = mode.trim().to_lowercase();
    let next_dry_run = match normalized.as_str() {
        "paper" | "dry-run" | "dry_run" => true,
        "live" => false,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "status": "error", "message": "Mode must be paper or live" })),
            )
        }
    };

    if !next_dry_run && state.execution_engine.is_none() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "status": "error", "message": "No execution engine available for live mode" })),
        );
    }

    let mut runtime_dry_run = state.runtime_dry_run.lock().await;
    *runtime_dry_run = next_dry_run;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "updated",
            "message": format!("EXECUTION_MODE_SET: {}", if next_dry_run { "paper" } else { "live" }),
            "mode": if next_dry_run { "paper" } else { "live" },
        })),
    )
}

async fn get_source_wallets(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(engine.get_source_wallet_controls_async().await)
    } else {
        Json(serde_json::json!({ "watchlist": [], "caps": {}, "profiles": {} }))
    }
}

async fn update_source_wallets(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let Some(engine) = &state.execution_engine else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })),
        );
    };

    let Some(action) = payload["action"].as_str() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "Missing source-wallet action" })),
        );
    };

    let wallet = payload["wallet"].as_str().unwrap_or_default().trim().to_string();
    let message = match action {
        "add" => engine.add_source_wallet_async(wallet).await,
        "remove" => engine.remove_source_wallet_async(wallet).await,
        "cap" => engine.set_source_wallet_cap_async(wallet, payload["max_position_size_sol"].as_f64()).await,
        "uncap" => engine.set_source_wallet_cap_async(wallet, None).await,
        "profile" => engine
            .set_source_wallet_profile_async(
                wallet,
                payload["preset"].as_str().unwrap_or_default().to_string(),
                payload["notes"].as_str().map(|value| value.to_string()),
            )
            .await,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "status": "error", "message": "Unsupported source-wallet action" })),
            )
        }
    };

    (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": message })))
}

async fn get_alert_quality(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(engine.get_alert_quality_async().await)
    } else {
        Json(serde_json::json!({ "minAlertQualityScore": 0.0, "minTraceAlerts": 0 }))
    }
}

async fn set_alert_quality(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let min_score = payload["min_alert_quality_score"].as_f64();
        let min_trace_alerts = payload["min_trace_alerts"].as_u64().map(|value| value as usize);
        let result = engine.set_alert_quality_async(min_score, min_trace_alerts).await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_buy_once_per_token(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "enabled": engine.get_buy_once_per_token_async().await }))
    } else {
        Json(serde_json::json!({ "enabled": false }))
    }
}

async fn set_buy_once_per_token(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(enabled) = payload["enabled"].as_bool() {
            let result = engine.set_buy_once_per_token_async(enabled).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid enabled value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_pre_buy_safety(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "enabled": engine.get_all_pre_buy_checks_enabled_async().await }))
    } else {
        Json(serde_json::json!({ "enabled": true }))
    }
}

async fn set_pre_buy_safety(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        if let Some(enabled) = payload["enabled"].as_bool() {
            let result = engine.set_all_pre_buy_checks_enabled_async(enabled).await;
            (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
        } else {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "status": "error", "message": "Invalid enabled value" })))
        }
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_pre_buy_checks(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        let checks = engine.get_pre_buy_checks_async().await;
        Json(serde_json::json!({
            "sell_route": checks.sell_route,
            "freeze_authority": checks.freeze_authority,
            "token2022_extensions": checks.token2022_extensions,
            "honeypot": checks.honeypot,
            "suspicious_tax": checks.suspicious_tax,
        }))
    } else {
        Json(serde_json::json!({
            "sell_route": true,
            "freeze_authority": true,
            "token2022_extensions": true,
            "honeypot": true,
            "suspicious_tax": true,
        }))
    }
}

async fn set_pre_buy_checks(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if let Some(engine) = &state.execution_engine {
        let checks = crate::services::signal_execution::PreBuySafetyChecksConfig {
            sell_route: payload["sell_route"].as_bool().unwrap_or(true),
            freeze_authority: payload["freeze_authority"].as_bool().unwrap_or(true),
            token2022_extensions: payload["token2022_extensions"].as_bool().unwrap_or(true),
            honeypot: payload["honeypot"].as_bool().unwrap_or(true),
            suspicious_tax: payload["suspicious_tax"].as_bool().unwrap_or(true),
        };
        let result = engine.set_pre_buy_checks_async(checks).await;
        (StatusCode::OK, Json(serde_json::json!({ "status": "updated", "message": result })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "error", "message": "No execution engine available" })))
    }
}

async fn get_trade_journal(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(engine.get_trade_journal_async().await)
    } else {
        Json(serde_json::json!({ "entries": [] }))
    }
}

async fn get_metrics(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    let execution_mode = current_mode_label(&state).await;
    let metrics = state.metrics.lock().await.clone();
    let dead_letter_count = state.failed_signals.lock().await.len();
    Json(serde_json::json!({
        "executionMode": execution_mode,
        "deadLetterCount": dead_letter_count,
        "metrics": metrics,
    }))
}

async fn get_dead_letters(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    let failed = state.failed_signals.lock().await;
    let entries: Vec<FailedSignalRecord> = failed.iter().rev().take(50).cloned().collect();
    Json(serde_json::json!({ "entries": entries }))
}

/// Phase 3: Audit logs endpoint for observability
async fn get_audit_logs(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    let logs = state.audit_logs.lock().await;
    let entries: Vec<AuditLogEntry> = logs.iter().rev().take(100).cloned().collect();
    
    // Group by event type for summary
    let mut summary = std::collections::HashMap::new();
    for entry in logs.iter() {
        let count = summary.entry(entry.event_type.clone()).or_insert(0u64);
        *count += 1;
    }
    
    Json(serde_json::json!({
        "entries": entries,
        "summary": summary,
        "total_entries": logs.len()
    }))
}

async fn retry_failed_signals(
    State(state): State<Arc<SignalReceiverState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let target_signal_id = payload["signal_id"].as_str().map(|value| value.to_string());
    let limit = payload["limit"].as_u64().map(|value| value as usize).unwrap_or(10).max(1);

    let candidates: Vec<FailedSignalRecord> = {
        let failed = state.failed_signals.lock().await;
        failed
            .iter()
            .filter(|entry| {
                target_signal_id
                    .as_ref()
                    .map(|signal_id| signal_id == &entry.signal_id)
                    .unwrap_or(true)
            })
            .take(limit)
            .cloned()
            .collect()
    };

    if candidates.is_empty() {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "ok", "message": "No failed signals matched retry criteria", "retried": [] })),
        );
    }

    let is_dry_run = *state.runtime_dry_run.lock().await;
    let mut results = Vec::new();

    for candidate in candidates {
        increment_metric(&state, "retried_total").await;
        let (safety_pass, safety_reasons) = evaluate_signal_safety(&state, &candidate.signal).await;

        let execution_result = if is_dry_run {
            None
        } else if let Some(engine) = &state.execution_engine {
            match engine.execute_signal(&candidate.signal).await {
                Ok(result) => Some(result),
                Err(error) => Some(format!("EXECUTION_ERROR: {}", error)),
            }
        } else {
            Some("NO_EXECUTION_ENGINE".to_string())
        };

        let status = if is_dry_run {
            "accepted".to_string()
        } else {
            classify_execution_status(&execution_result)
        };

        match status.as_str() {
            "accepted" => increment_metric(&state, "accepted_total").await,
            "executed" => increment_metric(&state, "executed_total").await,
            "blocked" => increment_metric(&state, "blocked_total").await,
            "failed" => increment_metric(&state, "failed_total").await,
            _ => {}
        }

        record_decision(
            &state,
            candidate.signal.signal_id.clone(),
            candidate.signal.signal_type.clone(),
            candidate.signal.action_hint.clone(),
            Some(candidate.signal.risk_score),
            candidate.signal.token_mint.clone(),
            format!("retried_{}", status),
            Some(safety_pass),
            safety_reasons,
            execution_result.clone(),
        )
        .await;

        {
            let mut failed = state.failed_signals.lock().await;
            if matches!(status.as_str(), "executed" | "accepted") {
                failed.retain(|entry| entry.signal_id != candidate.signal_id);
            } else if let Some(existing) = failed.iter_mut().find(|entry| entry.signal_id == candidate.signal_id) {
                existing.retry_count += 1;
                existing.status = status.clone();
                existing.reason = execution_result.clone().unwrap_or_else(|| "retry_failed".to_string());
                existing.last_failed_at = chrono::Utc::now().to_rfc3339();
                existing.signal = candidate.signal.clone();
            }
        }

        results.push(serde_json::json!({
            "signalId": candidate.signal_id,
            "status": status,
            "reason": execution_result,
        }));
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "message": format!("Retried {} failed signal(s)", results.len()),
            "retried": results,
        })),
    )
}
