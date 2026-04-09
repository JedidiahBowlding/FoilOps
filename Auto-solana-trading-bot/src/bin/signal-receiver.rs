use std::env;
use trading_bot::services::signal_receiver::start_signal_receiver;

#[tokio::main]
async fn main() {
    let bind_addr = env::var("SIGNAL_RECEIVER_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let dry_run = env::var("SIGNAL_RECEIVER_DRY_RUN")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let require_auth = env::var("SIGNAL_REQUIRE_AUTH")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(!dry_run);
    let auth_secret = env::var("SIGNAL_AUTH_SECRET").ok();
    let dedup_window_seconds = env::var("SIGNAL_DEDUP_WINDOW_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(300);
    let max_timestamp_skew_seconds = env::var("SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(120);

    if let Err(error) = start_signal_receiver(
        &bind_addr,
        dry_run,
        require_auth,
        auth_secret,
        dedup_window_seconds,
        max_timestamp_skew_seconds,
    ).await {
        eprintln!("Signal receiver failed: {}", error);
        std::process::exit(1);
    }
}
