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
    let very_early_mode = env::var("SIGNAL_VERY_EARLY_MODE")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let auth_secret = env::var("SIGNAL_AUTH_SECRET").ok();
    let dedup_default_seconds = if very_early_mode { 45 } else { 300 };
    let dedup_window_seconds = env::var("SIGNAL_DEDUP_WINDOW_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(dedup_default_seconds);
    let max_timestamp_skew_default_seconds = if very_early_mode { 30 } else { 120 };
    let max_timestamp_skew_seconds = env::var("SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(max_timestamp_skew_default_seconds);

    println!(
        "Signal receiver profile => very_early_mode={}, dedup_window={}s, max_timestamp_skew={}s",
        very_early_mode,
        dedup_window_seconds,
        max_timestamp_skew_seconds,
    );

    if let Err(error) = start_signal_receiver(
        &bind_addr,
        dry_run,
        require_auth,
        auth_secret,
        dedup_window_seconds,
        max_timestamp_skew_seconds,
        None,
    ).await {
        eprintln!("Signal receiver failed: {}", error);
        std::process::exit(1);
    }
}
