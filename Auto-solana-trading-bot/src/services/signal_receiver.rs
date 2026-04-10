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
    seen_signals: Arc<Mutex<HashMap<String, Instant>>>,
    execution_engine: Option<Arc<SignalExecutionEngine>>,
}

impl Clone for SignalReceiverState {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            seen_signals: Arc::clone(&self.seen_signals),
            execution_engine: self.execution_engine.as_ref().map(Arc::clone),
        }
    }
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
    pub target_wallet: String,
    pub token_mint: Option<String>,
    pub risk_score: f64,
    pub risk_level: String,
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
        seen_signals: Arc::new(Mutex::new(HashMap::new())),
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
        .route("/trading/mev", get(get_mev_service).post(set_mev_service))
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
    (
        StatusCode::OK,
        Json(HealthResponse {
            status: "ok".to_string(),
            mode: if state.config.dry_run { "dry-run".to_string() } else { "live".to_string() },
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
    if let Err(reason) = verify_headers_and_signature(&state.config, &headers, body.as_ref()) {
        return Ok(reject_signal(reason, "unknown".to_string()).1);
    }

    let signal: TradeSignalV1 = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(reject_signal("invalid_json_payload".to_string(), "unknown".to_string()).1),
    };

    if signal.schema_version != "1.0" {
        return Ok(reject_signal("unsupported_schema_version".to_string(), signal.signal_id).1);
    }

    if is_duplicate_signal(&state, &signal, &headers).await {
        return Ok(Json(SignalReceiverResponse {
            status: "duplicate".to_string(),
            mode: if state.config.dry_run { "dry-run".to_string() } else { "live".to_string() },
            signal_id: signal.signal_id,
            reason: Some("duplicate_idempotency_key".to_string()),
        }));
    }

    // Phase 2 & 4: Execute trade if not in dry-run mode and execution engine is available
    let execution_result = if !state.config.dry_run {
        if let Some(engine) = &state.execution_engine {
            match engine.execute_signal(&signal).await {
                Ok(result) => {
                    println!("[LIVE EXECUTION] id={} result={}", signal.signal_id, result);
                    Some(result)
                }
                Err(e) => {
                    println!("[EXECUTION ERROR] id={} error={}", signal.signal_id, e);
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
        status: if execution_result.is_some() { "executed".to_string() } else { "accepted".to_string() },
        mode: if state.config.dry_run { "dry-run".to_string() } else { "live".to_string() },
        signal_id: signal.signal_id,
        reason: execution_result,
    };

    Ok(Json(response))
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

fn reject_signal(reason: String, signal_id: String) -> (StatusCode, Json<SignalReceiverResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(SignalReceiverResponse {
            status: "rejected".to_string(),
            mode: "dry-run".to_string(),
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
    if let Some(engine) = &state.execution_engine {
        Json(engine.get_trading_status_async().await)
    } else {
        Json(serde_json::json!({
            "enabled": false,
            "paused": false,
            "mode": "no_execution_engine",
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
        Json(engine.get_config_async().await)
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
            "takeProfitPercentage": 50.0,
            "maxPositionSizeSol": 0.1,
            "minLiquidityUsd": 1000.0,
            "allowedDexes": ["pump_fun", "raydium"],
            "denylist": [],
            "allowlist": []
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

async fn get_target(
    State(state): State<Arc<SignalReceiverState>>,
) -> Json<Value> {
    if let Some(engine) = &state.execution_engine {
        Json(serde_json::json!({ "target_wallet": engine.get_target_wallet_async().await }))
    } else {
        Json(serde_json::json!({ "target_wallet": null }))
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
