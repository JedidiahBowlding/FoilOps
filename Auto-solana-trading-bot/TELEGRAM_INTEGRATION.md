// Example integration of Telegram bot into main.rs
// This shows how to run the Telegram bot alongside the WebSocket listener

use trading_bot::services::telegram::TelegramBot;
use std::env;

// Add this to Cargo.toml if not already present:
// teloxide = { version = "0.17", features = ["macros"] }

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load environment variables
    dotenv::dotenv().ok();

    // Get Telegram bot token from environment
    let telegram_token = env::var("TELEGRAM_BOT_TOKEN")
        .expect("TELEGRAM_BOT_TOKEN not set in .env");

    // OPTION 1: Run Telegram bot in a separate task while main continues
    // This allows both the WebSocket listener and Telegram bot to run concurrently
    let telegram_handle = tokio::spawn(async move {
        match TelegramBot::run_bot(telegram_token).await {
            Ok(_) => println!("Telegram bot stopped"),
            Err(e) => eprintln!("Telegram bot error: {}", e),
        }
    });

    // Continue with your existing WebSocket listener code here...
    // (your existing main.rs code for swap_to_events, etc.)

    // Wait for Telegram bot to complete (or run indefinitely)
    let _ = telegram_handle.await;

    Ok(())
}

// ALTERNATIVE: Run Telegram bot in the main thread if you don't need the WebSocket listener
#[tokio::main]
async fn main_telegram_only() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();

    let telegram_token = env::var("TELEGRAM_BOT_TOKEN")
        .expect("TELEGRAM_BOT_TOKEN not set in .env");

    // Run only the Telegram bot
    TelegramBot::run_bot(telegram_token).await?;

    Ok(())
}

// ADVANCED: Run Telegram bot with custom initial state
use trading_bot::services::telegram::{TelegramBot, BotState};

#[tokio::main]
async fn main_with_custom_state() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();

    let telegram_token = env::var("TELEGRAM_BOT_TOKEN")
        .expect("TELEGRAM_BOT_TOKEN not set in .env");

    // Create custom bot state with your preferred defaults
    let custom_state = BotState {
        enabled: true,
        paused: false,
        slippage: 5,
        target_wallet: env::var("TARGET_PUBKEY").unwrap_or_default(),
        mev_service: env::var("MEV_SERVICE").unwrap_or_else(|_| "jito".to_string()),
    };

    let bot = TelegramBot::new(custom_state);
    // Note: TelegramBot::run_bot() creates its own state, so for custom state,
    // you would need to modify the run_bot method or create a new implementation

    Ok(())
}
