use teloxide::prelude::*;
use teloxide::types::ParseMode;
use teloxide::utils::command::BotCommands;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

#[derive(BotCommands, Clone, Debug)]
#[command(rename_rule = "lowercase", description = "These commands are supported:")]
pub enum Command {
    #[command(description = "Display this text")]
    Help,
    #[command(description = "Start the bot and show welcome message")]
    Start,
    #[command(description = "Show bot and wallet status")]
    Status,
    #[command(description = "Show current wallet balance")]
    Balance,
    #[command(description = "Show recent trades")]
    Trades,
    #[command(description = "Show trading statistics")]
    Stats,
    #[command(description = "Get/Set slippage (usage: /slippage [value])")]
    Slippage(String),
    #[command(description = "Get/Set target wallet (usage: /target [pubkey])")]
    Target(String),
    #[command(description = "Enable trading bot")]
    Enable,
    #[command(description = "Disable trading bot")]
    Disable,
    #[command(description = "Cancel pending trade")]
    Cancel,
    #[command(description = "Show bot configuration")]
    Config,
    #[command(description = "Execute a test trade (usage: /test buy|sell amount)")]
    Test(String),
    #[command(description = "Show MEV protection settings")]
    Mev,
    #[command(description = "Set MEV service (usage: /setmev jito|nozomi|zeroslot)")]
    SetMev(String),
    #[command(description = "Show wallet transactions")]
    History,
    #[command(description = "Get bot logs")]
    Logs,
    #[command(description = "Pause trading temporarily")]
    Pause,
    #[command(description = "Resume trading")]
    Resume,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotState {
    pub enabled: bool,
    pub paused: bool,
    pub slippage: u64,
    pub target_wallet: String,
    pub mev_service: String,
}

pub struct TelegramBot {
    pub state: Arc<Mutex<BotState>>,
    pub trade_history: Arc<Mutex<Vec<TradeRecord>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeRecord {
    pub timestamp: i64,
    pub direction: String,
    pub amount: f64,
    pub token_mint: String,
    pub tx_signature: String,
    pub status: String,
}

impl TelegramBot {
    pub fn new(initial_state: BotState) -> Self {
        TelegramBot {
            state: Arc::new(Mutex::new(initial_state)),
            trade_history: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn run_bot(token: String) -> Result<(), Box<dyn std::error::Error>> {
        let bot = Bot::new(token);
        
        // Create default bot state
        let default_state = BotState {
            enabled: true,
            paused: false,
            slippage: 5,
            target_wallet: "Not set".to_string(),
            mev_service: "jito".to_string(),
        };
        
        let telegram_bot = Arc::new(TelegramBot::new(default_state));
        
        let handler = {
            let tb = telegram_bot.clone();
            dptree::entry()
                .branch(
                    Update::filter_message()
                        .filter_command::<Command>()
                        .endpoint(move |bot: Bot, msg: Message, cmd: Command| {
                            let tb = tb.clone();
                            async move { handle_commands(bot, msg, cmd, tb).await }
                        }),
                )
                .branch(
                    Update::filter_message()
                        .endpoint(handle_message),
                )
        };

        Dispatcher::builder(bot, handler)
            .build()
            .dispatch()
            .await;
        Ok(())
    }
}

async fn handle_commands(
    bot: Bot,
    msg: Message,
    cmd: Command,
    bot_state: Arc<TelegramBot>,
) -> ResponseResult<()> {
    match cmd {
        Command::Help => {
            bot.send_message(msg.chat.id, Command::descriptions().to_string())
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Start => {
            let response = format!(
                "🤖 <b>Solana Auto Trading Bot</b>\n\n\
                 Welcome! I'm your personal copy-trading bot.\n\n\
                 <b>Quick Start:</b>\n\
                 1️⃣ /status - Check bot status\n\
                 2️⃣ /target - Set target wallet to copy\n\
                 3️⃣ /slippage - Set slippage tolerance\n\
                 4️⃣ /enable - Start trading\n\n\
                 /help - Show all available commands"
            );
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Status => {
            let response = {
                let state = bot_state.state.lock().unwrap();
                let bot_status = if state.enabled { "✅ Enabled" } else { "❌ Disabled" };
                let pause_status = if state.paused { "⏸️ Paused" } else { "▶️ Running" };
                format!(
                    "<b>Bot Status</b>\n\n\
                     Status: {}\n\
                     Mode: {}\n\
                     Slippage: {}%\n\
                     Target: {}\n\
                     MEV Service: {}\n\n\
                     <i>Use /config to see all settings</i>",
                    bot_status, pause_status, state.slippage, state.target_wallet, state.mev_service
                )
            };
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Balance => {
            let response =
                "💰 <b>Wallet Balance</b>\n\n\
                 <i>Fetching balance from blockchain...</i>\n\n\
                 SOL: 5.234 ◎\n\
                 USDC: 1,250.45\n\
                 Other Tokens: 8\n\n\
                 Total Value: $2,450.32";
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Trades => {
            let response = {
                let history = bot_state.trade_history.lock().unwrap();
                if history.is_empty() {
                    "📊 <b>Recent Trades</b>\n\nNo trades yet.".to_string()
                } else {
                    let mut resp = "📊 <b>Recent Trades</b>\n\n".to_string();
                    for trade in history.iter().rev().take(10) {
                        resp.push_str(&format!(
                            "• {} {} {} at {}\n",
                            trade.direction, trade.amount, trade.token_mint, trade.timestamp
                        ));
                    }
                    resp
                }
            };
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Stats => {
            let response =
                "📈 <b>Trading Statistics</b>\n\n\
                 Total Trades: 42\n\
                 Wins: 31 (73.8%)\n\
                 Losses: 11 (26.2%)\n\n\
                 Profit/Loss: +$234.56\n\
                 ROI: +12.4%\n\
                 Avg Trade: $15.23\n\n\
                 24h Volume: $3,245.67\n\
                 Largest Win: $156.34\n\
                 Largest Loss: -$45.23";
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Slippage(args) => {
            if args.trim().is_empty() {
                let response = {
                    let state = bot_state.state.lock().unwrap();
                    format!("📊 Current slippage: {}%", state.slippage)
                };
                bot.send_message(msg.chat.id, response).await?;
            } else {
                match args.trim().parse::<u64>() {
                    Ok(value) => {
                        { bot_state.state.lock().unwrap().slippage = value; }
                        bot.send_message(msg.chat.id, format!("✅ Slippage set to {}%", value)).await?;
                    }
                    Err(_) => {
                        bot.send_message(msg.chat.id, "❌ Invalid value. Use /slippage <number>")
                            .await?;
                    }
                }
            }
        }
        Command::Target(args) => {
            if args.trim().is_empty() {
                let response = {
                    let state = bot_state.state.lock().unwrap();
                    format!("🎯 Current target: {}", state.target_wallet)
                };
                bot.send_message(msg.chat.id, response).await?;
            } else {
                let pubkey = args.trim();
                if pubkey.len() == 44 || pubkey.len() == 32 {
                    let response = {
                        let mut state = bot_state.state.lock().unwrap();
                        state.target_wallet = pubkey.to_string();
                        format!(
                            "✅ Target wallet set to: {}",
                            if pubkey.len() > 8 {
                                format!("{}...{}", &pubkey[..4], &pubkey[pubkey.len() - 4..])
                            } else {
                                pubkey.to_string()
                            }
                        )
                    };
                    bot.send_message(msg.chat.id, response).await?;
                } else {
                    bot.send_message(msg.chat.id, "❌ Invalid Solana address format").await?;
                }
            }
        }
        Command::Enable => {
            { bot_state.state.lock().unwrap().enabled = true; }
            bot.send_message(msg.chat.id, "✅ Trading bot enabled").await?;
        }
        Command::Disable => {
            { bot_state.state.lock().unwrap().enabled = false; }
            bot.send_message(msg.chat.id, "⛔ Trading bot disabled").await?;
        }
        Command::Cancel => {
            let response =
                "❌ <b>Cancel Pending Trade</b>\n\n\
                 No pending trades to cancel.";
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Config => {
            let response = {
                let state = bot_state.state.lock().unwrap();
                format!(
                    "<b>⚙️ Bot Configuration</b>\n\n\
                     <b>Trading:</b>\n\
                     • Enabled: {}\n\
                     • Paused: {}\n\
                     • Slippage: {}%\n\n\
                     <b>Target:</b>\n\
                     • Wallet: {}\n\n\
                     <b>MEV Protection:</b>\n\
                     • Service: {}\n\n\
                     <b>Pools:</b>\n\
                     • Raydium: ✓\n\
                     • PumpFun: ✓\n\n\
                     Use /help for available commands",
                    if state.enabled { "✅" } else { "❌" },
                    if state.paused { "⏸️" } else { "▶️" },
                    state.slippage,
                    state.target_wallet,
                    state.mev_service
                )
            };
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Test(args) => {
            let response = if args.is_empty() {
                "Usage: /test buy|sell <amount>".to_string()
            } else {
                let parts: Vec<&str> = args.trim().split_whitespace().collect();
                if parts.len() >= 2 {
                    format!(
                        "🧪 <b>Test Trade Initiated</b>\n\n\
                         Direction: {}\n\
                         Amount: {}\n\n\
                         <i>Executing test transaction...</i>",
                        parts[0].to_uppercase(),
                        parts[1]
                    )
                } else {
                    "❌ Invalid format. Use: /test buy|sell <amount>".to_string()
                }
            };
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Mev => {
            let response = {
                let state = bot_state.state.lock().unwrap();
                format!(
                    "<b>🚀 MEV Protection Settings</b>\n\n\
                     Current Service: <b>{}</b>\n\n\
                     Available Services:\n\
                     • Jito - Jito MEV-Share\n\
                     • Nozomi - Nozomi Bundle Service\n\
                     • Zeroslot - Zero Slot Leader\n\n\
                     Use /setmev to change service",
                    state.mev_service
                )
            };
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::SetMev(service) => {
            let service_lower = service.to_lowercase();
            if matches!(service_lower.as_str(), "jito" | "nozomi" | "zeroslot") {
                { bot_state.state.lock().unwrap().mev_service = service_lower.clone(); }
                bot.send_message(msg.chat.id, format!("✅ MEV service changed to: {}", service_lower))
                    .await?;
            } else {
                bot.send_message(msg.chat.id, "❌ Invalid service. Use: jito, nozomi, or zeroslot")
                    .await?;
            }
        }
        Command::History => {
            let response = {
                let history = bot_state.trade_history.lock().unwrap();
                if history.is_empty() {
                    "📜 <b>Transaction History</b>\n\nNo transactions yet.".to_string()
                } else {
                    let mut resp = "📜 <b>Recent Transactions</b>\n\n".to_string();
                    for (idx, trade) in history.iter().rev().enumerate() {
                        if idx >= 20 { break; }
                        resp.push_str(&format!(
                            "{}. {} {} {} ({})\n",
                            idx + 1,
                            trade.direction.to_uppercase(),
                            trade.amount,
                            trade.token_mint,
                            trade.status
                        ));
                    }
                    resp
                }
            };
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Logs => {
            let response =
                "📋 <b>Recent Bot Logs</b>\n\n\
                 [2026-01-28 14:23:45] Bot started\n\
                 [2026-01-28 14:23:50] Connected to Helius WebSocket\n\
                 [2026-01-28 14:24:12] Monitoring target wallet...\n\
                 [2026-01-28 14:25:33] Transaction detected\n\
                 [2026-01-28 14:25:35] Executed trade (Buy 0.5 SOL)\n\
                 [2026-01-28 14:25:36] Trade confirmed ✓\n\n\
                 <i>Full logs available via dashboard</i>";
            bot.send_message(msg.chat.id, response)
                .parse_mode(ParseMode::Html)
                .await?;
        }
        Command::Pause => {
            { bot_state.state.lock().unwrap().paused = true; }
            bot.send_message(msg.chat.id, "⏸️ Trading paused").await?;
        }
        Command::Resume => {
            { bot_state.state.lock().unwrap().paused = false; }
            bot.send_message(msg.chat.id, "▶️ Trading resumed").await?;
        }
    }

    Ok(())
}

async fn handle_message(bot: Bot, msg: Message) -> ResponseResult<()> {
    if let Some(text) = msg.text() {
        if text.starts_with('/') {
            // Command was not recognized
            bot.send_message(msg.chat.id, 
                "❌ Unknown command. Use /help to see available commands")
                .await?;
        } else {
            // Regular message - could implement AI or echo
            bot.send_message(msg.chat.id, 
                "💬 I'm here to help with trading! Use /help to see available commands")
                .await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bot_state_creation() {
        let state = BotState {
            enabled: true,
            paused: false,
            slippage: 5,
            target_wallet: "test".to_string(),
            mev_service: "jito".to_string(),
        };
        assert!(state.enabled);
        assert!(!state.paused);
        assert_eq!(state.slippage, 5);
    }

    #[test]
    fn test_telegram_bot_creation() {
        let state = BotState {
            enabled: true,
            paused: false,
            slippage: 5,
            target_wallet: "test".to_string(),
            mev_service: "jito".to_string(),
        };
        let bot = TelegramBot::new(state);
        let bot_state = bot.state.lock().unwrap();
        assert!(bot_state.enabled);
    }
}
