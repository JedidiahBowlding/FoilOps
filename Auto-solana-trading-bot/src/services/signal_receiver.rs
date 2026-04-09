use axum::{body::Bytes, extract::State, http::{HeaderMap, StatusCode}, routing::{get, post}, Json, Router};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct SignalReceiverConfig {
    pub dry_run: bool,
    pub require_auth: bool,
    pub auth_secret: Option<String>,
    pub dedup_window_seconds: u64,
    pub max_timestamp_skew_seconds: u64,
}

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
struct SignalReceiverState {
    config: SignalReceiverConfig,
    seen_signals: Arc<Mutex<HashMap<String, Instant>>>,
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
struct ExecutionRequest {
    request_id: String,
    signal_type: String,
    action: String,
    target_wallet: String,
    token_mint: Option<String>,
    risk_score: f64,
    risk_level: String,
    reason: String,
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
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/signals", post(receive_signal))
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

async fn receive_signal(
    State(state): State<Arc<SignalReceiverState>>,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, Json<SignalReceiverResponse>) {
    if let Err(reason) = verify_headers_and_signature(&state.config, &headers, &body) {
        return reject_signal(reason, "unknown".to_string());
    }

    let signal: TradeSignalV1 = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(_) => {
            return reject_signal("invalid_json_payload".to_string(), "unknown".to_string());
        }
    };

    if signal.schema_version != "1.0" {
        return reject_signal("unsupported_schema_version".to_string(), signal.signal_id);
    }

    if is_duplicate_signal(&state, &signal, &headers) {
        return (
            StatusCode::CONFLICT,
            Json(SignalReceiverResponse {
                status: "duplicate".to_string(),
                mode: if state.config.dry_run { "dry-run".to_string() } else { "live".to_string() },
                signal_id: signal.signal_id,
                reason: Some("duplicate_idempotency_key".to_string()),
            }),
        );
    }

    let execution_request = map_signal_to_execution_request(&signal);

    if state.config.dry_run {
        println!(
            "[DRY-RUN SIGNAL] id={} type={} risk={} level={} token={} tracked_wallet={} developer_wallet={} alerts={}",
            signal.signal_id,
            signal.signal_type,
            signal.risk_score,
            signal.risk_level,
            signal.token_mint.clone().unwrap_or_else(|| "n/a".to_string()),
            signal
                .tracked_wallet
                .clone()
                .unwrap_or_else(|| "n/a".to_string()),
            signal
                .developer_wallet
                .clone()
                .unwrap_or_else(|| "n/a".to_string()),
            signal.trace_alerts.len(),
        );

        if let Some(metadata) = signal.metadata {
            println!("[DRY-RUN SIGNAL METADATA] id={} metadata={}", signal.signal_id, metadata);
        }

        println!(
            "[DRY-RUN EXECUTION REQUEST] id={} action={} target_wallet={} token={} reason={}",
            execution_request.request_id,
            execution_request.action,
            execution_request.target_wallet,
            execution_request
                .token_mint
                .clone()
                .unwrap_or_else(|| "n/a".to_string()),
            execution_request.reason,
        );
    }

    (
        StatusCode::ACCEPTED,
        Json(SignalReceiverResponse {
            status: "accepted".to_string(),
            mode: if state.config.dry_run {
                "dry-run".to_string()
            } else {
                "live".to_string()
            },
            signal_id: signal.signal_id,
            reason: None,
        }),
    )
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

fn is_duplicate_signal(state: &SignalReceiverState, signal: &TradeSignalV1, headers: &HeaderMap) -> bool {
    let idempotency_key = headers
        .get("x-idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| signal.signal_id.clone());

    let window = Duration::from_secs(state.config.dedup_window_seconds);
    let now = Instant::now();

    let mut seen = match state.seen_signals.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    seen.retain(|_, seen_at| now.duration_since(*seen_at) <= window);

    if seen.contains_key(&idempotency_key) {
        return true;
    }

    seen.insert(idempotency_key, now);
    false
}

fn map_signal_to_execution_request(signal: &TradeSignalV1) -> ExecutionRequest {
    let target_wallet = signal
        .developer_wallet
        .clone()
        .or_else(|| signal.tracked_wallet.clone())
        .unwrap_or_else(|| "unknown".to_string());

    ExecutionRequest {
        request_id: signal.signal_id.clone(),
        signal_type: signal.signal_type.clone(),
        action: "WATCH_ONLY".to_string(),
        target_wallet,
        token_mint: signal.token_mint.clone(),
        risk_score: signal.risk_score,
        risk_level: signal.risk_level.clone(),
        reason: "phase2_mapping_dry_run_only".to_string(),
    }
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
