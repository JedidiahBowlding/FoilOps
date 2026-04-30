use crate::common::utils::AppState;
use crate::engine::swap::{pump_swap, raydium_swap};
use crate::dex::raydium::get_pool_state_by_mint;
use crate::services::price_monitor::{ExitReason, PriceMonitor};
use crate::services::signal_receiver::{ExecutionRequest, TradeSignalV1};
use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use solana_client::rpc_request::TokenAccountsFilter;
use solana_sdk::signature::Signer;
use solana_sdk::{program_pack::Pack, pubkey::Pubkey};
use spl_token_2022::extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensionsOwned};
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::time::sleep;

const WSOL_MINT: &str = "So11111111111111111111111111111111111111112";
const SUSPICIOUS_TAX_THRESHOLD_PCT: f64 = 15.0;

#[derive(Debug, Clone)]
struct MintGuardInfo {
    decimals: u8,
    freeze_authority: Option<String>,
    risky_extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreBuySafetyChecksConfig {
    pub sell_route: bool,
    pub freeze_authority: bool,
    pub token2022_extensions: bool,
    pub honeypot: bool,
    pub suspicious_tax: bool,
}

impl Default for PreBuySafetyChecksConfig {
    fn default() -> Self {
        Self {
            sell_route: true,
            freeze_authority: true,
            token2022_extensions: true,
            honeypot: true,
            suspicious_tax: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradingConfig {
    pub enabled: bool,
    pub paused: bool,
    pub mode: String, // "copy_trade", "signal_based", "manual"
    pub target_wallet: Option<String>,
    pub mev_service: String, // "jito", "nozomi", "zero_slot", "none"
    pub slippage: f64,
    pub buy_amount_sol: f64,
    pub max_concurrent_trades: usize,
    pub stop_loss_percentage: f64,
    pub take_profit_percentage: f64,
    pub max_position_size_sol: f64,
    pub min_liquidity_usd: f64,
    pub allowed_dexes: Vec<String>, // ["pump_fun", "raydium"]
    pub denylist: Vec<String>, // blocked token mints
    pub allowlist: Vec<String>, // allowed token mints (if not empty, only these)
    pub max_risk_score: f64, // signals with riskScore above this are rejected
    pub source_wallet_watchlist: Vec<String>,
    pub source_wallet_caps_sol: HashMap<String, f64>,
    pub source_wallet_profiles: HashMap<String, SourceWalletProfile>,
    pub min_alert_quality_score: f64,
    pub min_trace_alerts: usize,
    pub auto_block_source_wallet_after_buy: bool,
    pub buy_once_per_token: bool,
    pub pre_buy_checks: PreBuySafetyChecksConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceWalletProfile {
    pub preset: String,
    pub enabled: bool,
    pub allowed_actions: Vec<String>,
    pub size_multiplier: f64,
    pub max_position_size_sol: Option<f64>,
    pub max_risk_score: Option<f64>,
    pub notes: Option<String>,
}

impl Default for TradingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: false,
            mode: "signal_based".to_string(),
            target_wallet: None,
            mev_service: "jito".to_string(),
            slippage: 3.0,
            buy_amount_sol: 0.01,
            max_concurrent_trades: 5,
            stop_loss_percentage: 20.0,
            take_profit_percentage: 1.0,
            max_position_size_sol: 0.1,
            min_liquidity_usd: 1000.0,
            allowed_dexes: vec!["pump_fun".to_string(), "raydium".to_string()],
            denylist: vec![],
            allowlist: vec![],
            max_risk_score: 75.0,
            source_wallet_watchlist: vec![],
            source_wallet_caps_sol: HashMap::new(),
            source_wallet_profiles: HashMap::new(),
            min_alert_quality_score: 0.0,
            min_trace_alerts: 0,
            auto_block_source_wallet_after_buy: false,
            buy_once_per_token: true,
            pre_buy_checks: PreBuySafetyChecksConfig::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ActivePosition {
    pub token_mint: String,
    pub source_wallet: Option<String>,
    pub entry_price: f64,
    pub amount: f64,
    pub entry_time: Instant,
    pub stop_loss_price: f64,
    pub take_profit_price: f64,
}

#[derive(Debug, Clone)]
pub struct TradingState {
    pub config: TradingConfig,
    pub active_positions: HashMap<String, ActivePosition>, // token_mint -> position
    pub bought_tokens: HashSet<String>,
    pub recent_trades: Vec<TradeRecord>,
    pub journal: Vec<TradeJournalEntry>,
    pub total_pnl: f64,
    pub win_rate: f64,
    pub total_trades: u32,
    pub winning_trades: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TradeRecord {
    pub timestamp: String,
    pub token_mint: String,
    pub action: String, // "buy", "sell"
    pub amount: f64,
    pub price: f64,
    pub pnl: Option<f64>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TradeJournalEntry {
    pub timestamp: String,
    pub request_id: String,
    pub token_mint: Option<String>,
    pub source_wallet: Option<String>,
    pub action: String,
    pub status: String,
    pub amount_sol: f64,
    pub pnl_sol: Option<f64>,
    pub profile_preset: Option<String>,
    pub reason: String,
}

impl Default for TradingState {
    fn default() -> Self {
        Self {
            config: TradingConfig::default(),
            active_positions: HashMap::new(),
            bought_tokens: HashSet::new(),
            recent_trades: Vec::new(),
            journal: Vec::new(),
            total_pnl: 0.0,
            win_rate: 0.0,
            total_trades: 0,
            winning_trades: 0,
        }
    }
}

#[derive(Clone)]
pub struct SignalExecutionEngine {
    state: Arc<Mutex<TradingState>>,
    app_state: AppState,
}

impl SignalExecutionEngine {
    fn build_source_wallet_profile(preset: &str, notes: Option<String>) -> Option<SourceWalletProfile> {
        let normalized = preset.trim().to_lowercase();
        let profile = match normalized.as_str() {
            "shadow" => SourceWalletProfile {
                preset: normalized,
                enabled: true,
                allowed_actions: vec!["buy".to_string(), "sell".to_string()],
                size_multiplier: 1.0,
                max_position_size_sol: Some(0.10),
                max_risk_score: Some(75.0),
                notes,
            },
            "scalp" => SourceWalletProfile {
                preset: normalized,
                enabled: true,
                allowed_actions: vec!["buy".to_string(), "sell".to_string()],
                size_multiplier: 0.45,
                max_position_size_sol: Some(0.03),
                max_risk_score: Some(60.0),
                notes,
            },
            "swing" => SourceWalletProfile {
                preset: normalized,
                enabled: true,
                allowed_actions: vec!["buy".to_string()],
                size_multiplier: 0.70,
                max_position_size_sol: Some(0.06),
                max_risk_score: Some(72.0),
                notes,
            },
            "defensive" => SourceWalletProfile {
                preset: normalized,
                enabled: true,
                allowed_actions: vec!["sell".to_string()],
                size_multiplier: 0.25,
                max_position_size_sol: Some(0.02),
                max_risk_score: Some(45.0),
                notes,
            },
            "blocked" => SourceWalletProfile {
                preset: normalized,
                enabled: false,
                allowed_actions: vec![],
                size_multiplier: 0.0,
                max_position_size_sol: Some(0.0),
                max_risk_score: Some(0.0),
                notes,
            },
            _ => return None,
        };

        Some(profile)
    }

    pub fn new(
        app_state: AppState,
        max_risk_score: f64,
        auto_block_source_wallet_after_buy: bool,
        initial_enabled: bool,
        initial_paused: bool,
    ) -> Self {
        let mut trading_state = TradingState::default();
        trading_state.config.max_risk_score = max_risk_score;
        trading_state.config.auto_block_source_wallet_after_buy = auto_block_source_wallet_after_buy;
        trading_state.config.enabled = initial_enabled;
        trading_state.config.paused = initial_paused;
        
        let engine = Self {
            state: Arc::new(Mutex::new(trading_state)),
            app_state,
        };
        
        // Spawn price monitoring loop in background
        let state_for_monitor = engine.state.clone();
        let app_state_for_monitor = engine.app_state.clone();
        tokio::spawn(async move {
            let monitor_engine = SignalExecutionEngine {
                state: state_for_monitor,
                app_state: app_state_for_monitor,
            };
            monitor_engine.price_monitoring_loop().await;
        });
        
        engine
    }

    pub async fn execute_signal(&self, signal: &TradeSignalV1) -> Result<String> {
        let execution_request = self.map_signal_to_execution_request(signal);

        {
            let state = self.state.lock().await;

            if !state.config.enabled {
                return Ok("TRADING_DISABLED".to_string());
            }

            if state.config.paused {
                return Ok("TRADING_PAUSED".to_string());
            }

            if let Err(reason) = self.validate_signal_risk_gates(signal, &state) {
                return Ok(format!("RISK_GATE_FAILED: {}", reason));
            }

            if state.active_positions.len() >= state.config.max_concurrent_trades {
                return Ok("MAX_CONCURRENT_TRADES_EXCEEDED".to_string());
            }
        }

        match execution_request.action.as_str() {
            "BUY_TOKEN" => self.execute_buy(&execution_request).await,
            "SELL_TOKEN" => self.execute_sell(&execution_request).await,
            "COPY_TRADE" => self.execute_copy_trade(&execution_request).await,
            _ => Ok("WATCH_ONLY_NO_EXECUTION".to_string()),
        }
    }

    fn validate_signal_risk_gates(&self, signal: &TradeSignalV1, state: &TradingState) -> Result<(), String> {
        // Risk score validation
        if signal.risk_score > state.config.max_risk_score {
            return Err(format!("risk_score_too_high: {} > {}", signal.risk_score, state.config.max_risk_score));
        }

        let quality_score = Self::extract_alert_quality_score(signal);
        if quality_score < state.config.min_alert_quality_score {
            return Err(format!(
                "alert_quality_too_low: {} < {}",
                quality_score,
                state.config.min_alert_quality_score
            ));
        }

        if signal.trace_alerts.len() < state.config.min_trace_alerts {
            return Err(format!(
                "trace_alert_count_too_low: {} < {}",
                signal.trace_alerts.len(),
                state.config.min_trace_alerts
            ));
        }

        // Token validation - check denylist/allowlist
        if let Some(token_mint) = &signal.token_mint {
            if state.config.denylist.contains(token_mint) {
                return Err("token_in_denylist".to_string());
            }

            if !state.config.allowlist.is_empty() && !state.config.allowlist.contains(token_mint) {
                return Err("token_not_in_allowlist".to_string());
            }
        }

        // Developer wallet validation
        if let Some(dev_wallet) = &signal.developer_wallet {
            // Could add developer wallet blacklist check here
            if dev_wallet.is_empty() {
                return Err("invalid_developer_wallet".to_string());
            }
        }

        let source_wallet = Self::extract_source_wallet(signal);
        let signal_direction = Self::resolve_signal_direction(signal);

        if signal.signal_type == "COPY_TRADE" && source_wallet.is_none() {
            return Err("copy_trade_missing_source_wallet".to_string());
        }

        if !state.config.source_wallet_watchlist.is_empty() {
            let Some(ref wallet) = source_wallet else {
                return Err("missing_source_wallet_for_watchlist".to_string());
            };

            if !state.config.source_wallet_watchlist.iter().any(|allowed| allowed == wallet) {
                return Err(format!("source_wallet_not_watchlisted: {}", wallet));
            }
        }

        if let Some(wallet) = source_wallet.as_ref() {
            if let Some(profile) = state.config.source_wallet_profiles.get(wallet) {
                if !profile.enabled {
                    return Err(format!("source_wallet_profile_blocked: {}", wallet));
                }

                if let Some(direction) = signal_direction.as_ref() {
                    if !profile.allowed_actions.iter().any(|allowed| allowed == direction) {
                        return Err(format!("source_wallet_action_blocked:{}:{}", wallet, direction));
                    }
                }

                if let Some(profile_max_risk) = profile.max_risk_score {
                    if signal.risk_score > profile_max_risk {
                        return Err(format!(
                            "source_wallet_profile_risk_exceeded:{}:{}>{}",
                            wallet,
                            signal.risk_score,
                            profile_max_risk
                        ));
                    }
                }
            }
        }

        if Self::signal_creates_position(signal) {
            if let Some(wallet) = source_wallet {
                if let Some(profile) = state.config.source_wallet_profiles.get(&wallet) {
                    if let Some(profile_cap) = profile.max_position_size_sol {
                        let existing_exposure: f64 = state
                            .active_positions
                            .values()
                            .filter(|position| position.source_wallet.as_deref() == Some(wallet.as_str()))
                            .map(|position| position.amount)
                            .sum();

                        let requested_amount = state.config.buy_amount_sol * profile.size_multiplier.max(0.0);
                        if existing_exposure + requested_amount > profile_cap {
                            return Err(format!(
                                "source_wallet_profile_cap_exceeded: {} + {} > {} ({})",
                                existing_exposure,
                                requested_amount,
                                profile_cap,
                                wallet
                            ));
                        }
                    }
                }

                if let Some(cap) = state.config.source_wallet_caps_sol.get(&wallet) {
                    let existing_exposure: f64 = state
                        .active_positions
                        .values()
                        .filter(|position| position.source_wallet.as_deref() == Some(wallet.as_str()))
                        .map(|position| position.amount)
                        .sum();

                    let requested_amount = state.config.buy_amount_sol;
                    if existing_exposure + requested_amount > *cap {
                        return Err(format!(
                            "source_wallet_cap_exceeded: {} + {} > {} ({})",
                            existing_exposure,
                            requested_amount,
                            cap,
                            wallet
                        ));
                    }
                }
            }
        }

        Ok(())
    }

    fn map_signal_to_execution_request(&self, signal: &TradeSignalV1) -> ExecutionRequest {
        let target_wallet = signal
            .developer_wallet
            .clone()
            .or_else(|| signal.tracked_wallet.clone())
            .unwrap_or_else(|| "unknown".to_string());

        let action = match signal.signal_type.as_str() {
            "TOKEN_INVESTIGATION" => "BUY_TOKEN",
            "SUSPICIOUS_TOKEN_LAUNCH" => "SELL_TOKEN",
            "AUTO_SELL" => "SELL_TOKEN",
            "AUTO_AVOID" => "WATCH_ONLY",
            "AUTO_WATCH" => "WATCH_ONLY",
            "COPY_TRADE" => "COPY_TRADE",
            _ => "WATCH_ONLY",
        };

        ExecutionRequest {
            request_id: signal.signal_id.clone(),
            signal_type: signal.signal_type.clone(),
            action: action.to_string(),
            action_hint: signal.action_hint.clone(),
            target_wallet,
            source_wallet: Self::extract_source_wallet(signal),
            token_mint: signal.token_mint.clone(),
            risk_score: signal.risk_score,
            risk_level: signal.risk_level.clone(),
            metadata: signal.metadata.clone(),
            reason: format!("Signal-based execution: {}", signal.signal_type),
        }
    }

    fn extract_source_wallet(signal: &TradeSignalV1) -> Option<String> {
        signal
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("copiedWallet").and_then(|value| value.as_str()))
            .or_else(|| {
                signal
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("sourceWallet").and_then(|value| value.as_str()))
            })
            .or_else(|| {
                signal
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("source_wallet").and_then(|value| value.as_str()))
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| signal.tracked_wallet.clone())
    }

    fn extract_alert_quality_score(signal: &TradeSignalV1) -> f64 {
        let metadata_score = signal
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("alertQualityScore").and_then(|value| value.as_f64()))
            .or_else(|| {
                signal
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("qualityScore").and_then(|value| value.as_f64()))
            })
            .or_else(|| {
                signal
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("confidenceScore").and_then(|value| value.as_f64()))
            })
            .or_else(|| {
                signal
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("confidence").and_then(|value| value.as_f64()))
            });

        if let Some(score) = metadata_score {
            return if score <= 1.0 { score * 100.0 } else { score }.clamp(0.0, 100.0);
        }

        let mut derived_score = signal.risk_score * 0.35;
        derived_score += (signal.trace_alerts.len().min(4) as f64) * 12.5;
        if signal.token_mint.is_some() {
            derived_score += 10.0;
        }
        if Self::extract_source_wallet(signal).is_some() {
            derived_score += 10.0;
        }
        derived_score.clamp(0.0, 100.0)
    }

    fn resolve_signal_direction(signal: &TradeSignalV1) -> Option<String> {
        signal
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("direction").and_then(|value| value.as_str()))
            .or_else(|| {
                signal
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("action").and_then(|value| value.as_str()))
            })
            .or_else(|| {
                signal
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("side").and_then(|value| value.as_str()))
            })
            .map(|value| value.trim().to_lowercase())
            .or_else(|| match signal.action_hint.as_str() {
                "BUY" => Some("buy".to_string()),
                "SELL" | "AUTO_SELL" => Some("sell".to_string()),
                _ => None,
            })
    }

    fn signal_creates_position(signal: &TradeSignalV1) -> bool {
        match signal.signal_type.as_str() {
            "TOKEN_INVESTIGATION" => true,
            "COPY_TRADE" => signal
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("direction").and_then(|value| value.as_str()))
                .map(|direction| matches!(direction.trim().to_lowercase().as_str(), "buy" | "long"))
                .unwrap_or(matches!(signal.action_hint.as_str(), "BUY")),
            _ => false,
        }
    }

    fn record_journal_entry(state: &mut TradingState, entry: TradeJournalEntry) {
        state.journal.push(entry);
        if state.journal.len() > 500 {
            let overflow = state.journal.len() - 500;
            state.journal.drain(0..overflow);
        }
    }

    fn wallet_has_token_balance(&self, token_mint: &str) -> bool {
        let owner = self.app_state.wallet.pubkey();
        let mint_pubkey = match Pubkey::from_str(token_mint) {
            Ok(pk) => pk,
            Err(_) => return false,
        };

        let accounts = match self
            .app_state
            .rpc_client
            .get_token_accounts_by_owner(&owner, TokenAccountsFilter::Mint(mint_pubkey))
        {
            Ok(result) => result,
            Err(_) => return false,
        };

        for keyed in accounts {
            let token_account = match Pubkey::from_str(&keyed.pubkey) {
                Ok(pk) => pk,
                Err(_) => continue,
            };

            if let Ok(balance) = self.app_state.rpc_client.get_token_account_balance(&token_account) {
                if balance.amount.parse::<u64>().unwrap_or(0) > 0 {
                    return true;
                }
            }
        }

        false
    }

    async fn execute_buy(&self, request: &ExecutionRequest) -> Result<String> {
        let token_mint = match &request.token_mint {
            Some(mint) => mint.clone(),
            None => return Ok("NO_TOKEN_MINT_SPECIFIED".to_string()),
        };

        let (slippage, mev_service, actual_amount, allowed_dexes, profile_preset, pre_buy_checks) = {
            let state = self.state.lock().await;
            if state.config.buy_once_per_token && state.bought_tokens.contains(&token_mint) {
                return Ok("TOKEN_ALREADY_BOUGHT_ONCE".to_string());
            }
            if state.config.buy_once_per_token && self.wallet_has_token_balance(&token_mint) {
                return Ok("TOKEN_ALREADY_HELD_IN_WALLET".to_string());
            }
            if state.active_positions.contains_key(&token_mint) {
                return Ok("POSITION_ALREADY_EXISTS".to_string());
            }
            let source_profile = request
                .source_wallet
                .as_ref()
                .and_then(|wallet| state.config.source_wallet_profiles.get(wallet));
            let amount_sol = state.config.buy_amount_sol;
            let mut actual_amount = if state.config.mode == "conservative" {
                (amount_sol * 0.1).max(0.001)
            } else {
                amount_sol
            };
            if let Some(profile) = source_profile {
                actual_amount = (actual_amount * profile.size_multiplier.max(0.0)).max(0.001);
            }
            (
                state.config.slippage as u64,
                state.config.mev_service.clone(),
                actual_amount,
                state.config.allowed_dexes.clone(),
                source_profile.map(|profile| profile.preset.clone()),
                state.config.pre_buy_checks.clone(),
            )
        };

        let dex = self.determine_dex(&token_mint).await?;

        if !allowed_dexes.contains(&dex) {
            return Ok(format!("DEX_NOT_ALLOWED: {}", dex));
        }

        if Self::has_any_pre_buy_check_enabled(&pre_buy_checks) {
            if let Err(reason) = self
                .validate_token_sellability_before_buy(
                    &token_mint,
                    actual_amount,
                    slippage,
                    request.metadata.as_ref(),
                    &pre_buy_checks,
                )
                .await
            {
                let mut state = self.state.lock().await;
                Self::record_journal_entry(
                    &mut state,
                    TradeJournalEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        request_id: request.request_id.clone(),
                        token_mint: Some(token_mint.clone()),
                        source_wallet: request.source_wallet.clone(),
                        action: "buy".to_string(),
                        status: "blocked".to_string(),
                        amount_sol: actual_amount,
                        pnl_sol: None,
                        profile_preset: profile_preset.clone(),
                        reason: format!("{} | prebuy_safety_check_failed: {}", request.reason, reason),
                    },
                );
                return Ok(format!("BUY_BLOCKED_PREBUY_SAFETY: {}", reason));
            }
        }

        let result = match dex.as_str() {
            "pump_fun" => {
                pump_swap(
                    self.app_state.clone(),
                    actual_amount,
                    "buy",
                    "qty",
                    slippage,
                    self.should_use_mev(&mev_service),
                    &token_mint,
                ).await
            }
            "raydium" => {
                let (pool_id, pool_state) = get_pool_state_by_mint(self.app_state.rpc_client.clone(), &token_mint).await?;
                raydium_swap(
                    self.app_state.clone(),
                    actual_amount,
                    "buy",
                    "qty",
                    slippage,
                    self.should_use_mev(&mev_service),
                    pool_id,
                    pool_state,
                ).await
            }
            _ => return Ok(format!("UNSUPPORTED_DEX: {}", dex)),
        };

        match result {
            Ok(tx_sigs) => {
                // Fetch current price to establish entry price
                let price_monitor = PriceMonitor::new();
                let entry_price = match price_monitor.get_token_price(&token_mint).await {
                    Ok(price_info) => price_info.price_sol,
                    Err(_) => {
                        // Fallback: use a placeholder price for now (will be updated on next price check)
                        0.0001
                    }
                };

                let (stop_loss_price, take_profit_price) = {
                    let state = self.state.lock().await;
                    PriceMonitor::calculate_exit_prices(
                        entry_price,
                        state.config.stop_loss_percentage,
                        state.config.take_profit_percentage,
                    )
                };

                let mut state = self.state.lock().await;
                // Record the position
                let position = ActivePosition {
                    token_mint: token_mint.clone(),
                    source_wallet: request.source_wallet.clone(),
                    entry_price,
                    amount: actual_amount,
                    entry_time: Instant::now(),
                    stop_loss_price,
                    take_profit_price,
                };

                state.active_positions.insert(token_mint.clone(), position);
                state.bought_tokens.insert(token_mint.clone());

                // Record trade
                let trade = TradeRecord {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    token_mint: token_mint.clone(),
                    action: "buy".to_string(),
                    amount: actual_amount,
                    price: entry_price,
                    pnl: None,
                    reason: request.reason.clone(),
                };

                state.recent_trades.push(trade);
                state.total_trades += 1;
                Self::record_journal_entry(
                    &mut state,
                    TradeJournalEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        request_id: request.request_id.clone(),
                        token_mint: Some(token_mint.clone()),
                        source_wallet: request.source_wallet.clone(),
                        action: "buy".to_string(),
                        status: "executed".to_string(),
                        amount_sol: actual_amount,
                        pnl_sol: None,
                        profile_preset,
                        reason: format!("{} [entry_price: {} SOL, SL: {} SOL, TP: {} SOL]", 
                                       request.reason, entry_price, stop_loss_price, take_profit_price),
                    },
                );

                let auto_blocked_wallet = if state.config.auto_block_source_wallet_after_buy {
                    if let Some(source_wallet) = request.source_wallet.as_ref() {
                        if let Some(blocked_profile) = Self::build_source_wallet_profile(
                            "blocked",
                            Some(format!(
                                "auto-blocked after successful buy for request {}",
                                request.request_id
                            )),
                        ) {
                            state
                                .config
                                .source_wallet_profiles
                                .insert(source_wallet.clone(), blocked_profile);
                            state
                                .config
                                .source_wallet_caps_sol
                                .insert(source_wallet.clone(), 0.0);
                            Some(source_wallet.clone())
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                Ok(match auto_blocked_wallet {
                    Some(wallet) => format!(
                        "BUY_EXECUTED: {} tx(s), amount: {} SOL, entry_price: {} SOL, AUTO_BLOCKED_SOURCE_WALLET: {}",
                        tx_sigs.len(),
                        actual_amount,
                        entry_price,
                        wallet
                    ),
                    None => format!("BUY_EXECUTED: {} tx(s), amount: {} SOL, entry_price: {} SOL", tx_sigs.len(), actual_amount, entry_price),
                })
            }
            Err(e) => {
                let mut state = self.state.lock().await;
                Self::record_journal_entry(
                    &mut state,
                    TradeJournalEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        request_id: request.request_id.clone(),
                        token_mint: Some(token_mint.clone()),
                        source_wallet: request.source_wallet.clone(),
                        action: "buy".to_string(),
                        status: "failed".to_string(),
                        amount_sol: actual_amount,
                        pnl_sol: None,
                        profile_preset,
                        reason: format!("{} | {}", request.reason, e),
                    },
                );
                Ok(format!("BUY_FAILED: {}", e))
            }
        }
    }

    async fn validate_token_sellability_before_buy(
        &self,
        token_mint: &str,
        amount_sol: f64,
        slippage: u64,
        metadata: Option<&serde_json::Value>,
        checks: &PreBuySafetyChecksConfig,
    ) -> Result<()> {
        let mint_info = self.read_token_mint_guard_info(token_mint).await?;
        if checks.freeze_authority && mint_info.freeze_authority.is_some() {
            let freeze_authority = mint_info.freeze_authority.as_ref().expect("checked is_some");
            return Err(anyhow!("token_has_freeze_authority:{}", freeze_authority));
        }

        if checks.token2022_extensions && !mint_info.risky_extensions.is_empty() {
            return Err(anyhow!(
                "token2022_risky_extensions:{}",
                mint_info.risky_extensions.join(",")
            ));
        }

        self.validate_metadata_safety_flags(metadata, checks)?;

        if !checks.sell_route {
            return Ok(());
        }

        let buy_amount_lamports = (amount_sol.max(0.0) * 1_000_000_000.0).round() as u64;
        if buy_amount_lamports == 0 {
            return Err(anyhow!("invalid_buy_amount_for_sellability_check"));
        }

        let buy_quote = self
            .fetch_jupiter_quote(WSOL_MINT, token_mint, buy_amount_lamports, slippage)
            .await
            .map_err(|error| anyhow!("buy_quote_unavailable:{}", error))?;

        let estimated_token_out = buy_quote
            .get("outAmount")
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| anyhow!("buy_quote_missing_out_amount"))?;

        if estimated_token_out == 0 {
            return Err(anyhow!("buy_quote_zero_out_amount"));
        }

        let one_token = 10_u64.saturating_pow(mint_info.decimals as u32).max(1);
        let sell_probe_amount = estimated_token_out.max(one_token);
        self.fetch_jupiter_quote(token_mint, WSOL_MINT, sell_probe_amount, slippage)
            .await
            .map_err(|error| anyhow!("sell_quote_unavailable:{}", error))?;

        Ok(())
    }

    async fn read_token_mint_guard_info(&self, token_mint: &str) -> Result<MintGuardInfo> {
        let rpc_client = self.app_state.rpc_client.clone();
        let token_mint = token_mint.to_string();

        tokio::task::spawn_blocking(move || -> Result<MintGuardInfo> {
            let mint_pubkey = Pubkey::from_str(&token_mint)
                .map_err(|error| anyhow!("invalid_token_mint:{}", error))?;
            let account = rpc_client
                .get_account(&mint_pubkey)
                .map_err(|error| anyhow!("token_mint_account_fetch_failed:{}", error))?;

            if account.owner == spl_token::ID {
                let mint = spl_token::state::Mint::unpack(&account.data)
                    .map_err(|error| anyhow!("token_mint_unpack_failed:{}", error))?;
                return Ok(MintGuardInfo {
                    decimals: mint.decimals,
                    freeze_authority: mint.freeze_authority.map(|key| key.to_string()).into(),
                    risky_extensions: Vec::new(),
                });
            }

            if account.owner == spl_token_2022::ID {
                let mint = StateWithExtensionsOwned::<spl_token_2022::state::Mint>::unpack(account.data)
                    .map_err(|error| anyhow!("token2022_mint_unpack_failed:{}", error))?;
                let extension_types = mint
                    .get_extension_types()
                    .map_err(|error| anyhow!("token2022_extension_parse_failed:{}", error))?;
                let risky_extensions = extension_types
                    .into_iter()
                    .filter_map(|extension| match extension {
                        ExtensionType::TransferHook => Some("TransferHook".to_string()),
                        ExtensionType::TransferFeeConfig => Some("TransferFeeConfig".to_string()),
                        ExtensionType::PermanentDelegate => Some("PermanentDelegate".to_string()),
                        ExtensionType::DefaultAccountState => Some("DefaultAccountState".to_string()),
                        ExtensionType::NonTransferable => Some("NonTransferable".to_string()),
                        ExtensionType::ConfidentialTransferMint => Some("ConfidentialTransferMint".to_string()),
                        _ => None,
                    })
                    .collect();
                return Ok(MintGuardInfo {
                    decimals: mint.base.decimals,
                    freeze_authority: mint.base.freeze_authority.map(|key| key.to_string()).into(),
                    risky_extensions,
                });
            }

            Err(anyhow!("unsupported_token_program:{}", account.owner))
        })
        .await
        .map_err(|error| anyhow!("token_mint_guard_task_failed:{}", error))?
    }

    async fn fetch_jupiter_quote(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount: u64,
        slippage: u64,
    ) -> Result<serde_json::Value> {
        let slippage_bps = slippage.saturating_mul(100).min(5000);
        let http_client = Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|error| anyhow!("jupiter_http_client_build_failed:{}", error))?;

        let bases = ["https://api.jup.ag/swap/v1", "https://lite-api.jup.ag/swap/v1"];
        let mut errors = Vec::new();

        for base in bases {
            let quote_url = format!(
                "{}/quote?inputMint={}&outputMint={}&amount={}&slippageBps={}",
                base, input_mint, output_mint, amount, slippage_bps
            );

            match http_client.get(&quote_url).send().await {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        let body = response
                            .text()
                            .await
                            .unwrap_or_else(|_| "<unable_to_read_body>".to_string());
                        errors.push(format!("{}:{}:{}", base, status, body));
                        continue;
                    }

                    let quote = response
                        .json::<serde_json::Value>()
                        .await
                        .map_err(|error| anyhow!("quote_decode_failed:{}", error))?;
                    let has_route = quote
                        .get("routePlan")
                        .and_then(|value| value.as_array())
                        .map(|routes| !routes.is_empty())
                        .unwrap_or(false);

                    if has_route {
                        return Ok(quote);
                    }

                    errors.push(format!("{}:no_route_found", base));
                }
                Err(error) => errors.push(format!("{}:{}", base, error)),
            }
        }

        Err(anyhow!("all_quote_endpoints_failed [{}]", errors.join(" | ")))
    }

    fn validate_metadata_safety_flags(
        &self,
        metadata: Option<&serde_json::Value>,
        checks: &PreBuySafetyChecksConfig,
    ) -> Result<()> {
        let Some(metadata) = metadata else {
            return Ok(());
        };

        if checks.honeypot
            && Self::metadata_bool_at_any_path(
            metadata,
            &[
                &["isHoneypot"],
                &["is_honeypot"],
                &["tokenInvestigation", "isHoneypot"],
                &["tokenInvestigation", "is_honeypot"],
                &["enrichment", "isHoneypot"],
                &["gmgn", "is_honeypot"],
            ],
        ) == Some(true)
        {
            return Err(anyhow!("metadata_flagged_honeypot"));
        }

        let buy_tax = Self::metadata_number_at_any_path(
            metadata,
            &[
                &["buyTax"],
                &["buy_tax"],
                &["tokenInvestigation", "buyTax"],
                &["tokenInvestigation", "buy_tax"],
                &["gmgn", "buy_tax"],
            ],
        );
        let sell_tax = Self::metadata_number_at_any_path(
            metadata,
            &[
                &["sellTax"],
                &["sell_tax"],
                &["tokenInvestigation", "sellTax"],
                &["tokenInvestigation", "sell_tax"],
                &["gmgn", "sell_tax"],
            ],
        );

        if checks.suspicious_tax
            && (buy_tax.unwrap_or(0.0) >= SUSPICIOUS_TAX_THRESHOLD_PCT
                || sell_tax.unwrap_or(0.0) >= SUSPICIOUS_TAX_THRESHOLD_PCT)
        {
            return Err(anyhow!(
                "metadata_flagged_suspicious_tax:buy={} sell={}",
                buy_tax.map(|value| value.to_string()).unwrap_or_else(|| "n/a".to_string()),
                sell_tax.map(|value| value.to_string()).unwrap_or_else(|| "n/a".to_string())
            ));
        }

        Ok(())
    }

    fn metadata_bool_at_any_path(metadata: &serde_json::Value, paths: &[&[&str]]) -> Option<bool> {
        paths
            .iter()
            .find_map(|path| Self::metadata_value_at_path(metadata, path))
            .and_then(|value| value.as_bool())
    }

    fn metadata_number_at_any_path(metadata: &serde_json::Value, paths: &[&[&str]]) -> Option<f64> {
        paths
            .iter()
            .find_map(|path| Self::metadata_value_at_path(metadata, path))
            .and_then(|value| {
                value
                    .as_f64()
                    .or_else(|| value.as_i64().map(|number| number as f64))
                    .or_else(|| value.as_u64().map(|number| number as f64))
                    .or_else(|| value.as_str().and_then(|number| number.parse::<f64>().ok()))
            })
    }

    fn metadata_value_at_path<'a>(metadata: &'a serde_json::Value, path: &[&str]) -> Option<&'a serde_json::Value> {
        let mut current = metadata;
        for segment in path {
            current = current.get(*segment)?;
        }
        Some(current)
    }

    fn has_any_pre_buy_check_enabled(checks: &PreBuySafetyChecksConfig) -> bool {
        checks.sell_route
            || checks.freeze_authority
            || checks.token2022_extensions
            || checks.honeypot
            || checks.suspicious_tax
    }

    async fn execute_sell(&self, request: &ExecutionRequest) -> Result<String> {
        let token_mint = match &request.token_mint {
            Some(mint) => mint.clone(),
            None => return Ok("NO_TOKEN_MINT_SPECIFIED".to_string()),
        };

        let (position, slippage, mev_service) = {
            let mut state = self.state.lock().await;
            let position = match state.active_positions.remove(&token_mint) {
                Some(pos) => pos,
                None => return Ok("NO_POSITION_FOUND".to_string()),
            };
            (position, state.config.slippage as u64, state.config.mev_service.clone())
        };

        let dex = self.determine_dex(&token_mint).await?;

        let result = match dex.as_str() {
            "pump_fun" => {
                pump_swap(
                    self.app_state.clone(),
                    position.amount,
                    "sell",
                    "pct", // Sell percentage of position
                    slippage,
                    self.should_use_mev(&mev_service),
                    &token_mint,
                ).await
            }
            "raydium" => {
                let (pool_id, pool_state) = get_pool_state_by_mint(self.app_state.rpc_client.clone(), &token_mint).await?;
                raydium_swap(
                    self.app_state.clone(),
                    100.0, // Sell 100% of position
                    "sell",
                    "pct",
                    slippage,
                    self.should_use_mev(&mev_service),
                    pool_id,
                    pool_state,
                ).await
            }
            _ => return Ok(format!("UNSUPPORTED_DEX: {}", dex)),
        };

        match result {
            Ok(tx_sigs) => {
                let mut state = self.state.lock().await;
                let journal_profile_preset = request
                    .source_wallet
                    .as_ref()
                    .and_then(|wallet| state.config.source_wallet_profiles.get(wallet))
                    .map(|profile| profile.preset.clone());
                // Calculate PnL (simplified - would need actual price data)
                let pnl = 0.0; // Placeholder
                if pnl > 0.0 {
                    state.winning_trades += 1;
                }
                state.total_pnl += pnl;
                state.win_rate = if state.total_trades == 0 {
                    0.0
                } else {
                    state.winning_trades as f64 / state.total_trades as f64
                };

                // Record trade
                let trade = TradeRecord {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    token_mint: token_mint.clone(),
                    action: "sell".to_string(),
                    amount: position.amount,
                    price: 0.0,
                    pnl: Some(pnl),
                    reason: request.reason.clone(),
                };

                state.recent_trades.push(trade);
                Self::record_journal_entry(
                    &mut state,
                    TradeJournalEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        request_id: request.request_id.clone(),
                        token_mint: Some(token_mint.clone()),
                        source_wallet: position.source_wallet.clone(),
                        action: "sell".to_string(),
                        status: "executed".to_string(),
                        amount_sol: position.amount,
                        pnl_sol: Some(pnl),
                        profile_preset: journal_profile_preset,
                        reason: request.reason.clone(),
                    },
                );

                Ok(format!("SELL_EXECUTED: {} tx(s), amount: {} SOL, PnL: {} SOL",
                          tx_sigs.len(), position.amount, pnl))
            }
            Err(e) => {
                let mut state = self.state.lock().await;
                let journal_profile_preset = request
                    .source_wallet
                    .as_ref()
                    .and_then(|wallet| state.config.source_wallet_profiles.get(wallet))
                    .map(|profile| profile.preset.clone());
                // Put position back if sell failed
                let journal_source_wallet = position.source_wallet.clone();
                let journal_amount = position.amount;
                state.active_positions.insert(token_mint, position);
                Self::record_journal_entry(
                    &mut state,
                    TradeJournalEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        request_id: request.request_id.clone(),
                        token_mint: request.token_mint.clone(),
                        source_wallet: journal_source_wallet,
                        action: "sell".to_string(),
                        status: "failed".to_string(),
                        amount_sol: journal_amount,
                        pnl_sol: None,
                        profile_preset: journal_profile_preset,
                        reason: format!("{} | {}", request.reason, e),
                    },
                );
                Ok(format!("SELL_FAILED: {}", e))
            }
        }
    }

    async fn execute_copy_trade(&self, request: &ExecutionRequest) -> Result<String> {
        let direction = self.resolve_copy_trade_direction(request)?;

        match direction.as_str() {
            "buy" => self.execute_buy(request).await,
            "sell" => self.execute_sell(request).await,
            _ => Ok("COPY_TRADE_INVALID_DIRECTION".to_string()),
        }
    }

    fn resolve_copy_trade_direction(&self, request: &ExecutionRequest) -> Result<String> {
        let metadata_direction = request
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("direction").and_then(|value| value.as_str()))
            .or_else(|| {
                request
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("action").and_then(|value| value.as_str()))
            })
            .or_else(|| {
                request
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("side").and_then(|value| value.as_str()))
            });

        let candidate = metadata_direction
            .or_else(|| Some(request.action_hint.as_str()))
            .ok_or_else(|| anyhow!("COPY_TRADE_DIRECTION_MISSING"))?
            .trim()
            .to_lowercase();

        match candidate.as_str() {
            "buy" | "long" => Ok("buy".to_string()),
            "sell" | "short" => Ok("sell".to_string()),
            _ => Err(anyhow!("COPY_TRADE_DIRECTION_UNSUPPORTED: {}", candidate)),
        }
    }

    async fn determine_dex(&self, token_mint: &str) -> Result<String> {
        // Simple DEX detection - in production this would check token metadata
        // For now, assume PumpFun for new tokens, Raydium for established ones
        // This is a placeholder - real implementation would check token age, liquidity, etc.

        // Check if token is on Raydium by trying to get pool state
        match get_pool_state_by_mint(self.app_state.rpc_client.clone(), token_mint).await {
            Ok(_) => Ok("raydium".to_string()),
            Err(_) => Ok("pump_fun".to_string()), // Assume PumpFun if no Raydium pool
        }
    }

    fn should_use_mev(&self, mev_service: &str) -> bool {
        match mev_service {
            "jito" | "nozomi" | "zero_slot" => true,
            _ => false,
        }
    }

    // Public API methods for the HTTP endpoints
    pub async fn get_trading_status_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        serde_json::json!({
            "enabled": state.config.enabled,
            "paused": state.config.paused,
            "mode": state.config.mode,
            "targetWallet": state.config.target_wallet,
            "mevService": state.config.mev_service,
            "slippage": state.config.slippage,
            "activePositions": state.active_positions.len(),
            "totalPnL": state.total_pnl,
            "winRate": state.win_rate,
            "totalTrades": state.total_trades
        })
    }

    pub async fn enable_trading_async(&self) -> String {
        let mut state = self.state.lock().await;
        state.config.enabled = true;
        "TRADING_ENABLED".to_string()
    }

    pub async fn disable_trading_async(&self) -> String {
        let mut state = self.state.lock().await;
        state.config.enabled = false;
        "TRADING_DISABLED".to_string()
    }

    pub async fn pause_trading_async(&self) -> String {
        let mut state = self.state.lock().await;
        state.config.paused = true;
        "TRADING_PAUSED".to_string()
    }

    pub async fn resume_trading_async(&self) -> String {
        let mut state = self.state.lock().await;
        state.config.paused = false;
        "TRADING_RESUMED".to_string()
    }

    pub async fn set_slippage_async(&self, slippage: f64) -> String {
        let mut state = self.state.lock().await;
        state.config.slippage = slippage.max(0.1).min(50.0);
        format!("SLIPPAGE_SET: {}%", state.config.slippage)
    }

    pub async fn get_slippage_async(&self) -> f64 {
        let state = self.state.lock().await;
        state.config.slippage
    }

    pub async fn set_stop_loss_async(&self, percentage: f64) -> String {
        let mut state = self.state.lock().await;
        state.config.stop_loss_percentage = percentage.max(1.0).min(99.0);
        format!("STOP_LOSS_SET: {}%", state.config.stop_loss_percentage)
    }

    pub async fn get_stop_loss_async(&self) -> f64 {
        let state = self.state.lock().await;
        state.config.stop_loss_percentage
    }

    pub async fn set_take_profit_async(&self, percentage: f64) -> String {
        let mut state = self.state.lock().await;
        state.config.take_profit_percentage = percentage.max(1.0).min(999.0);
        format!("TAKE_PROFIT_SET: {}%", state.config.take_profit_percentage)
    }

    pub async fn get_take_profit_async(&self) -> f64 {
        let state = self.state.lock().await;
        state.config.take_profit_percentage
    }

    pub async fn set_target_wallet_async(&self, wallet: Option<String>) -> String {
        let mut state = self.state.lock().await;
        state.config.target_wallet = wallet.clone();
        format!("TARGET_WALLET_SET: {}", wallet.unwrap_or_else(|| "None".to_string()))
    }

    pub async fn get_target_wallet_async(&self) -> Option<String> {
        let state = self.state.lock().await;
        state.config.target_wallet.clone()
    }

    pub async fn set_max_concurrent_trades_async(&self, value: usize) -> String {
        let mut state = self.state.lock().await;
        state.config.max_concurrent_trades = value.max(1).min(50);
        format!("MAX_CONCURRENT_TRADES_SET: {}", state.config.max_concurrent_trades)
    }

    pub async fn get_max_concurrent_trades_async(&self) -> usize {
        let state = self.state.lock().await;
        state.config.max_concurrent_trades
    }

    pub async fn set_max_position_size_async(&self, sol: f64) -> String {
        let mut state = self.state.lock().await;
        state.config.max_position_size_sol = sol.max(0.001);
        format!("MAX_POSITION_SIZE_SET: {} SOL", state.config.max_position_size_sol)
    }

    pub async fn get_max_position_size_async(&self) -> f64 {
        let state = self.state.lock().await;
        state.config.max_position_size_sol
    }

    pub async fn set_min_liquidity_usd_async(&self, usd: f64) -> String {
        let mut state = self.state.lock().await;
        state.config.min_liquidity_usd = usd.max(0.0);
        format!("MIN_LIQUIDITY_USD_SET: ${}", state.config.min_liquidity_usd)
    }

    pub async fn get_min_liquidity_usd_async(&self) -> f64 {
        let state = self.state.lock().await;
        state.config.min_liquidity_usd
    }

    pub async fn set_allowed_dexes_async(&self, dexes: Vec<String>) -> String {
        let mut state = self.state.lock().await;
        state.config.allowed_dexes = dexes.clone();
        format!("ALLOWED_DEXES_SET: [{}]", dexes.join(", "))
    }

    pub async fn get_allowed_dexes_async(&self) -> Vec<String> {
        let state = self.state.lock().await;
        state.config.allowed_dexes.clone()
    }

    pub async fn set_auto_block_source_wallet_async(&self, enabled: bool) -> String {
        let mut state = self.state.lock().await;
        state.config.auto_block_source_wallet_after_buy = enabled;
        format!("AUTO_BLOCK_SOURCE_WALLET_SET: {}", enabled)
    }

    pub async fn get_auto_block_source_wallet_async(&self) -> bool {
        let state = self.state.lock().await;
        state.config.auto_block_source_wallet_after_buy
    }

    pub async fn set_denylist_async(&self, mints: Vec<String>) -> String {
        let mut state = self.state.lock().await;
        let count = mints.len();
        state.config.denylist = mints;
        format!("DENYLIST_SET: {} tokens", count)
    }

    pub async fn get_denylist_async(&self) -> Vec<String> {
        let state = self.state.lock().await;
        state.config.denylist.clone()
    }

    pub async fn set_allowlist_async(&self, mints: Vec<String>) -> String {
        let mut state = self.state.lock().await;
        let count = mints.len();
        state.config.allowlist = mints;
        format!("ALLOWLIST_SET: {} tokens", count)
    }

    pub async fn get_allowlist_async(&self) -> Vec<String> {
        let state = self.state.lock().await;
        state.config.allowlist.clone()
    }

    pub async fn set_mev_service_async(&self, service: String) -> String {
        let mut state = self.state.lock().await;
        state.config.mev_service = service.clone();
        format!("MEV_SERVICE_SET: {}", service)
    }

    pub async fn get_mev_service_async(&self) -> String {
        let state = self.state.lock().await;
        state.config.mev_service.clone()
    }

    pub async fn get_safety_summary_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        let pre_buy_checks_enabled_count = [
            state.config.pre_buy_checks.sell_route,
            state.config.pre_buy_checks.freeze_authority,
            state.config.pre_buy_checks.token2022_extensions,
            state.config.pre_buy_checks.honeypot,
            state.config.pre_buy_checks.suspicious_tax,
        ]
        .into_iter()
        .filter(|enabled| *enabled)
        .count();
        serde_json::json!({
            "maxRiskScore": state.config.max_risk_score,
            "minLiquidityUsd": state.config.min_liquidity_usd,
            "minAlertQualityScore": state.config.min_alert_quality_score,
            "minTraceAlerts": state.config.min_trace_alerts,
            "maxPositionSizeSol": state.config.max_position_size_sol,
            "maxConcurrentTrades": state.config.max_concurrent_trades,
            "sourceWalletWatchlistCount": state.config.source_wallet_watchlist.len(),
            "sourceWalletCapsCount": state.config.source_wallet_caps_sol.len(),
            "sourceWalletProfileCount": state.config.source_wallet_profiles.len(),
            "slippage": state.config.slippage,
            "buyAmountSol": state.config.buy_amount_sol,
            "buyOncePerToken": state.config.buy_once_per_token,
            "preBuyChecks": {
                "sellRoute": state.config.pre_buy_checks.sell_route,
                "freezeAuthority": state.config.pre_buy_checks.freeze_authority,
                "token2022Extensions": state.config.pre_buy_checks.token2022_extensions,
                "honeypot": state.config.pre_buy_checks.honeypot,
                "suspiciousTax": state.config.pre_buy_checks.suspicious_tax
            },
            "preBuyChecksEnabledCount": pre_buy_checks_enabled_count,
            "boughtTokenCount": state.bought_tokens.len(),
            "activePositions": state.active_positions.len(),
            "enabled": state.config.enabled,
            "paused": state.config.paused
        })
    }

    pub async fn set_buy_once_per_token_async(&self, enabled: bool) -> String {
        let mut state = self.state.lock().await;
        state.config.buy_once_per_token = enabled;
        format!("BUY_ONCE_PER_TOKEN_SET: {}", enabled)
    }

    pub async fn get_buy_once_per_token_async(&self) -> bool {
        let state = self.state.lock().await;
        state.config.buy_once_per_token
    }

    pub async fn set_pre_buy_checks_async(&self, checks: PreBuySafetyChecksConfig) -> String {
        let mut state = self.state.lock().await;
        state.config.pre_buy_checks = checks.clone();
        format!(
            "PRE_BUY_CHECKS_SET: sell_route={} freeze_authority={} token2022_extensions={} honeypot={} suspicious_tax={}",
            checks.sell_route,
            checks.freeze_authority,
            checks.token2022_extensions,
            checks.honeypot,
            checks.suspicious_tax
        )
    }

    pub async fn get_pre_buy_checks_async(&self) -> PreBuySafetyChecksConfig {
        let state = self.state.lock().await;
        state.config.pre_buy_checks.clone()
    }

    pub async fn set_all_pre_buy_checks_enabled_async(&self, enabled: bool) -> String {
        self.set_pre_buy_checks_async(PreBuySafetyChecksConfig {
            sell_route: enabled,
            freeze_authority: enabled,
            token2022_extensions: enabled,
            honeypot: enabled,
            suspicious_tax: enabled,
        })
        .await
    }

    pub async fn get_all_pre_buy_checks_enabled_async(&self) -> bool {
        let state = self.state.lock().await;
        Self::has_any_pre_buy_check_enabled(&state.config.pre_buy_checks)
    }

    pub async fn set_max_risk_score_async(&self, score: f64) -> String {
        let mut state = self.state.lock().await;
        state.config.max_risk_score = score.clamp(0.0, 100.0);
        format!("MAX_RISK_SCORE_SET: {}", state.config.max_risk_score)
    }

    pub async fn set_mode_async(&self, mode: String) -> String {
        let normalized = mode.trim().to_lowercase();
        let mut state = self.state.lock().await;

        state.config.mode = match normalized.as_str() {
            "copy_trade" | "signal_based" | "manual" | "conservative" => normalized,
            _ => "signal_based".to_string(),
        };

        format!("MODE_SET: {}", state.config.mode)
    }

    pub async fn set_buy_amount_sol_async(&self, amount: f64) -> String {
        let mut state = self.state.lock().await;
        state.config.buy_amount_sol = amount.max(0.001);
        format!("BUY_AMOUNT_SOL_SET: {}", state.config.buy_amount_sol)
    }

    pub async fn get_source_wallet_controls_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        serde_json::json!({
            "watchlist": state.config.source_wallet_watchlist,
            "caps": state.config.source_wallet_caps_sol,
            "profiles": state.config.source_wallet_profiles,
        })
    }

    pub async fn add_source_wallet_async(&self, wallet: String) -> String {
        let normalized = wallet.trim().to_string();
        if normalized.is_empty() {
            return "SOURCE_WALLET_INVALID".to_string();
        }

        let mut state = self.state.lock().await;
        if !state.config.source_wallet_watchlist.iter().any(|entry| entry == &normalized) {
            state.config.source_wallet_watchlist.push(normalized.clone());
            state.config.source_wallet_watchlist.sort();
        }

        format!("SOURCE_WALLET_ADDED: {}", normalized)
    }

    pub async fn remove_source_wallet_async(&self, wallet: String) -> String {
        let normalized = wallet.trim().to_string();
        let mut state = self.state.lock().await;
        state.config.source_wallet_watchlist.retain(|entry| entry != &normalized);
        state.config.source_wallet_caps_sol.remove(&normalized);
        format!("SOURCE_WALLET_REMOVED: {}", normalized)
    }

    pub async fn set_source_wallet_cap_async(&self, wallet: String, cap_sol: Option<f64>) -> String {
        let normalized = wallet.trim().to_string();
        if normalized.is_empty() {
            return "SOURCE_WALLET_INVALID".to_string();
        }

        let mut state = self.state.lock().await;
        if !state.config.source_wallet_watchlist.iter().any(|entry| entry == &normalized) {
            state.config.source_wallet_watchlist.push(normalized.clone());
            state.config.source_wallet_watchlist.sort();
        }

        match cap_sol {
            Some(cap) => {
                let clamped = cap.max(0.001);
                state.config.source_wallet_caps_sol.insert(normalized.clone(), clamped);
                format!("SOURCE_WALLET_CAP_SET: {} => {} SOL", normalized, clamped)
            }
            None => {
                state.config.source_wallet_caps_sol.remove(&normalized);
                format!("SOURCE_WALLET_CAP_REMOVED: {}", normalized)
            }
        }
    }

    pub async fn set_source_wallet_profile_async(&self, wallet: String, preset: String, notes: Option<String>) -> String {
        let normalized_wallet = wallet.trim().to_string();
        if normalized_wallet.is_empty() {
            return "SOURCE_WALLET_INVALID".to_string();
        }

        let Some(profile) = Self::build_source_wallet_profile(&preset, notes) else {
            return "SOURCE_WALLET_PROFILE_INVALID".to_string();
        };

        let mut state = self.state.lock().await;
        if !state.config.source_wallet_watchlist.iter().any(|entry| entry == &normalized_wallet) {
            state.config.source_wallet_watchlist.push(normalized_wallet.clone());
            state.config.source_wallet_watchlist.sort();
        }
        if let Some(cap) = profile.max_position_size_sol {
            state.config.source_wallet_caps_sol.insert(normalized_wallet.clone(), cap.max(0.0));
        }
        state.config.source_wallet_profiles.insert(normalized_wallet.clone(), profile.clone());

        format!("SOURCE_WALLET_PROFILE_SET: {} => {}", normalized_wallet, profile.preset)
    }

    pub async fn get_alert_quality_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        serde_json::json!({
            "minAlertQualityScore": state.config.min_alert_quality_score,
            "minTraceAlerts": state.config.min_trace_alerts,
        })
    }

    pub async fn set_alert_quality_async(&self, min_score: Option<f64>, min_trace_alerts: Option<usize>) -> String {
        let mut state = self.state.lock().await;

        if let Some(score) = min_score {
            state.config.min_alert_quality_score = score.clamp(0.0, 100.0);
        }

        if let Some(alert_count) = min_trace_alerts {
            state.config.min_trace_alerts = alert_count.min(10);
        }

        format!(
            "ALERT_QUALITY_UPDATED: min_score={}, min_trace_alerts={}",
            state.config.min_alert_quality_score,
            state.config.min_trace_alerts
        )
    }

    pub async fn assess_signal_async(&self, signal: &TradeSignalV1) -> (bool, Vec<String>) {
        let state = self.state.lock().await;
        let mut reasons = Vec::new();

        if !state.config.enabled {
            reasons.push("trading_disabled".to_string());
        }

        if state.config.paused {
            reasons.push("trading_paused".to_string());
        }

        if let Err(reason) = self.validate_signal_risk_gates(signal, &state) {
            reasons.push(reason);
        }

        if reasons.is_empty() {
            reasons.push("passes_current_safety_gates".to_string());
            (true, reasons)
        } else {
            (false, reasons)
        }
    }

    pub async fn apply_profile_async(&self, profile: String) -> String {
        let normalized = profile.trim().to_lowercase();
        let mut state = self.state.lock().await;

        match normalized.as_str() {
            "conservative" => {
                state.config.max_risk_score = 55.0;
                state.config.buy_amount_sol = 0.005;
                state.config.max_position_size_sol = 0.03;
                state.config.slippage = 1.5;
            }
            "balanced" => {
                state.config.max_risk_score = 70.0;
                state.config.buy_amount_sol = 0.01;
                state.config.max_position_size_sol = 0.10;
                state.config.slippage = 3.0;
            }
            "aggressive" => {
                state.config.max_risk_score = 85.0;
                state.config.buy_amount_sol = 0.02;
                state.config.max_position_size_sol = 0.20;
                state.config.slippage = 5.0;
            }
            _ => return "PROFILE_INVALID".to_string(),
        }

        format!("PROFILE_APPLIED: {}", normalized)
    }

    pub async fn tighten_risk_async(&self) -> String {
        let mut state = self.state.lock().await;
        state.config.max_risk_score = (state.config.max_risk_score - 10.0).max(25.0);
        state.config.slippage = (state.config.slippage - 0.5).max(0.5);
        format!(
            "RISK_TIGHTENED: max_risk_score={}, slippage={}",
            state.config.max_risk_score, state.config.slippage
        )
    }

    pub async fn kill_switch_async(&self) -> String {
        let mut state = self.state.lock().await;
        state.config.enabled = false;
        state.config.paused = true;
        "KILL_SWITCH_ACTIVATED: All trading disabled".to_string()
    }

    pub async fn get_recent_trades_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        let recent: Vec<&TradeRecord> = state.recent_trades.iter().rev().take(10).collect();
        serde_json::json!(recent)
    }

    pub async fn get_trading_stats_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        serde_json::json!({
            "totalPnL": state.total_pnl,
            "winRate": state.win_rate,
            "totalTrades": state.total_trades,
            "winningTrades": state.winning_trades,
            "activePositions": state.active_positions.len(),
            "journalEntries": state.journal.len()
        })
    }

    pub async fn get_trade_journal_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        let recent: Vec<TradeJournalEntry> = state.journal.iter().rev().take(100).cloned().collect();
        serde_json::json!({ "entries": recent })
    }

    pub async fn get_config_async(&self) -> serde_json::Value {
        let state = self.state.lock().await;
        serde_json::json!(state.config)
    }

    pub fn get_trading_status(&self) -> Result<serde_json::Value> {
        let state = self.state.blocking_lock();
        Ok(serde_json::json!({
            "enabled": state.config.enabled,
            "paused": state.config.paused,
            "mode": state.config.mode,
            "targetWallet": state.config.target_wallet,
            "mevService": state.config.mev_service,
            "slippage": state.config.slippage,
            "activePositions": state.active_positions.len(),
            "totalPnL": state.total_pnl,
            "winRate": state.win_rate,
            "totalTrades": state.total_trades
        }))
    }

    pub fn enable_trading(&self) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.enabled = true;
        Ok("TRADING_ENABLED".to_string())
    }

    pub fn disable_trading(&self) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.enabled = false;
        Ok("TRADING_DISABLED".to_string())
    }

    pub fn pause_trading(&self) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.paused = true;
        Ok("TRADING_PAUSED".to_string())
    }

    pub fn resume_trading(&self) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.paused = false;
        Ok("TRADING_RESUMED".to_string())
    }

    pub fn set_slippage(&self, slippage: f64) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.slippage = slippage.max(0.1).min(50.0); // Clamp between 0.1% and 50%
        Ok(format!("SLIPPAGE_SET: {}%", state.config.slippage))
    }

    pub fn get_slippage(&self) -> f64 {
        let state = self.state.blocking_lock();
        state.config.slippage
    }

    pub fn set_target_wallet(&self, wallet: Option<String>) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.target_wallet = wallet.clone();
        Ok(format!("TARGET_WALLET_SET: {}", wallet.unwrap_or_else(|| "None".to_string())))
    }

    pub fn get_target_wallet(&self) -> Option<String> {
        let state = self.state.blocking_lock();
        state.config.target_wallet.clone()
    }

    pub fn set_mev_service(&self, service: String) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.mev_service = service.clone();
        Ok(format!("MEV_SERVICE_SET: {}", service))
    }

    pub fn get_mev_service(&self) -> String {
        let state = self.state.blocking_lock();
        state.config.mev_service.clone()
    }

    pub fn get_balance(&self) -> Result<serde_json::Value> {
        // Placeholder - would integrate with wallet balance checking
        Ok(serde_json::json!({
            "solBalance": 0.5,
            "positions": []
        }))
    }

    pub fn get_recent_trades(&self) -> Result<serde_json::Value> {
        let state = self.state.blocking_lock();
        let recent: Vec<&TradeRecord> = state.recent_trades.iter()
            .rev()
            .take(10)
            .collect();

        Ok(serde_json::json!(recent))
    }

    pub fn get_trading_stats(&self) -> Result<serde_json::Value> {
        let state = self.state.blocking_lock();
        Ok(serde_json::json!({
            "totalPnL": state.total_pnl,
            "winRate": state.win_rate,
            "totalTrades": state.total_trades,
            "winningTrades": state.winning_trades,
            "activePositions": state.active_positions.len()
        }))
    }

    pub fn get_config(&self) -> Result<serde_json::Value> {
        let state = self.state.blocking_lock();
        Ok(serde_json::json!(state.config))
    }

    // Phase 3: Risk Gates - Comprehensive validation
    pub fn validate_risk_gates(&self, execution_request: &ExecutionRequest, state: &TradingState) -> Result<(), String> {
        // 1. Risk score validation
        if execution_request.risk_score > 75.0 {
            return Err(format!("risk_score_too_high: {} > 75", execution_request.risk_score));
        }

        // 2. Position size validation
        let total_position_sol: f64 = state.active_positions
            .values()
            .map(|pos| pos.amount)
            .sum();
        
        if total_position_sol >= state.config.max_position_size_sol {
            return Err(format!(
                "max_position_size_exceeded: {} >= {}",
                total_position_sol, state.config.max_position_size_sol
            ));
        }

        // 3. Concurrent trades limit
        if state.active_positions.len() >= state.config.max_concurrent_trades {
            return Err(format!(
                "max_concurrent_trades_exceeded: {} >= {}",
                state.active_positions.len(), state.config.max_concurrent_trades
            ));
        }

        // 4. Token denylist/allowlist checks
        if let Some(token_mint) = &execution_request.token_mint {
            if state.config.denylist.contains(token_mint) {
                return Err(format!("token_in_denylist: {}", token_mint));
            }

            if !state.config.allowlist.is_empty() && !state.config.allowlist.contains(token_mint) {
                return Err(format!("token_not_in_allowlist: {}", token_mint));
            }
        }

        // 5. Liquidity check
        if state.config.min_liquidity_usd > 0.0 {
            // In production, would check actual liquidity from DEX
            // For now, log that the check would happen
            println!("[RISK_GATE] liquidity_check_placeholder for min_liquidity_usd: {}", state.config.min_liquidity_usd);
        }

        Ok(())
    }

    // Phase 3: Idempotency and replay protection
    pub fn check_idempotency(&self, request_id: &str, recent_trades: &[TradeRecord]) -> Result<(), String> {
        // Check if we've already processed this request
        for trade in recent_trades.iter().rev().take(100) {
            // In production, would store request IDs in a persistent store
            // with TTL-based cleanup
            if trade.reason.contains(request_id) {
                return Err("duplicate_request_id".to_string());
            }
        }
        Ok(())
    }

    // Phase 3: Audit logging
    pub fn log_signal_event(
        &self,
        event_type: &str,
        signal_id: &str,
        status: &str,
        details: Option<String>,
    ) {
        let event = serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "event_type": event_type,
            "signal_id": signal_id,
            "status": status,
            "details": details.unwrap_or_default(),
        });

        println!("[AUDIT_LOG] {}", event.to_string());
    }

    // Phase 3: Metrics tracking
    pub fn record_execution_metric(&self, metric_name: &str, value: f64, tags: Option<Vec<(String, String)>>) {
        let metric = serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "metric": metric_name,
            "value": value,
            "tags": tags.unwrap_or_default(),
        });

        println!("[METRIC] {}", metric.to_string());
    }

    // Phase 4: Emergency kill switch
    pub fn kill_switch(&self) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.enabled = false;
        state.config.paused = true;
        
        // In production, would:
        // 1. Force-close all open positions
        // 2. Trigger alerts
        // 3. Log incident
        
        self.log_signal_event(
            "KILL_SWITCH_ACTIVATED",
            "emergency",
            "all_trading_stopped",
            None,
        );

        Ok("KILL_SWITCH_ACTIVATED: All trading disabled".to_string())
    }

    // Phase 4: Controlled position sizing
    pub fn calculate_position_size(&self, base_amount: f64, config: &TradingConfig) -> f64 {
        match config.mode.as_str() {
            "ultra_conservative" => base_amount * 0.01, // 1% of normal
            "conservative" => base_amount * 0.1,         // 10% of normal
            "normal" => base_amount,                      // 100% of normal
            "aggressive" => base_amount * 1.5,           // 150% of normal (with leverage)
            _ => base_amount,                             // Default to normal
        }
    }

    // Phase 4: Set trading mode for rollout control
    pub fn set_trading_mode(&self, mode: String) -> Result<String> {
        let mut state = self.state.blocking_lock();
        match mode.as_str() {
            "ultra_conservative" | "conservative" | "normal" | "aggressive" => {
                state.config.mode = mode.clone();
                Ok(format!("TRADING_MODE_SET: {}", mode))
            }
            _ => Err(anyhow!("INVALID_MODE: {}", mode))
        }
    }

    // Phase 4: Runtime pause/resume
    pub fn pause_all(&self) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.paused = true;
        self.log_signal_event("TRADING_PAUSED", "runtime", "paused", None);
        Ok("ALL_TRADING_PAUSED".to_string())
    }

    pub fn resume_all(&self) -> Result<String> {
        let mut state = self.state.blocking_lock();
        if state.config.enabled {
            state.config.paused = false;
            self.log_signal_event("TRADING_RESUMED", "runtime", "resumed", None);
            Ok("ALL_TRADING_RESUMED".to_string())
        } else {
            Err(anyhow!("TRADING_NOT_ENABLED"))
        }
    }

    // Phase 4: Add slippage protection
    pub fn set_max_slippage(&self, max_slippage: f64) -> Result<String> {
        let mut state = self.state.blocking_lock();
        if max_slippage < 0.1 || max_slippage > 50.0 {
            return Err(anyhow!("INVALID_SLIPPAGE: must be between 0.1% and 50%"));
        }
        state.config.slippage = max_slippage;
        Ok(format!("MAX_SLIPPAGE_SET: {}%", max_slippage))
    }

    // Phase 4: Add denylist/allowlist management
    pub fn add_to_denylist(&self, token_mint: String) -> Result<String> {
        let mut state = self.state.blocking_lock();
        if !state.config.denylist.contains(&token_mint) {
            state.config.denylist.push(token_mint.clone());
            self.log_signal_event(
                "DENYLIST_UPDATED",
                &token_mint,
                "added",
                Some(format!("Total denied: {}", state.config.denylist.len())),
            );
            Ok(format!("ADDED_TO_DENYLIST: {}", token_mint))
        } else {
            Ok(format!("ALREADY_DENIED: {}", token_mint))
        }
    }

    pub fn remove_from_denylist(&self, token_mint: String) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.denylist.retain(|t| t != &token_mint);
        self.log_signal_event(
            "DENYLIST_UPDATED",
            &token_mint,
            "removed",
            Some(format!("Total denied: {}", state.config.denylist.len())),
        );
        Ok(format!("REMOVED_FROM_DENYLIST: {}", token_mint))
    }

    pub fn set_allowlist(&self, tokens: Vec<String>) -> Result<String> {
        let mut state = self.state.blocking_lock();
        state.config.allowlist = tokens.clone();
        self.log_signal_event(
            "ALLOWLIST_UPDATED",
            "config",
            "set",
            Some(format!("Total allowed: {}", tokens.len())),
        );
        Ok(format!("ALLOWLIST_SET: {} tokens", tokens.len()))
    }

    // Phase 4: Get rollback info
    pub fn get_rollback_status(&self) -> Result<serde_json::Value> {
        let state = self.state.blocking_lock();
        Ok(serde_json::json!({
            "enabled": state.config.enabled,
            "paused": state.config.paused,
            "mode": state.config.mode,
            "activePositions": state.active_positions.len(),
            "lastTrade": state.recent_trades.last().map(|t| &t.timestamp),
            "totalPnL": state.total_pnl,
            "recommendedAction": if state.active_positions.is_empty() {
                "safe_to_disable"
            } else {
                "close_positions_first"
            }
        }))
    }

    // Background price monitoring loop - automatically exits positions at SL/TP
    async fn price_monitoring_loop(&self) {
        let price_monitor = PriceMonitor::new();
        let check_interval = Duration::from_secs(30); // Check every 30 seconds

        loop {
            sleep(check_interval).await;

            // Get current positions
            let positions_to_check = {
                let state = self.state.lock().await;
                if !state.config.enabled || state.active_positions.is_empty() {
                    continue;
                }
                state.active_positions.clone()
            };

            // Check each position
            for (token_mint, position) in positions_to_check.iter() {
                // Fetch current price
                match price_monitor.get_token_price(token_mint).await {
                    Ok(price_info) => {
                        let current_price = price_info.price_sol;

                        // Check if position should exit
                        if let Some(exit_reason) = PriceMonitor::should_exit(
                            current_price,
                            position.stop_loss_price,
                            position.take_profit_price,
                        ) {
                            // Execute auto-sell
                            let reason = match exit_reason {
                                ExitReason::StopLoss => format!(
                                    "AUTO_SELL_STOP_LOSS: price {} < sl {} (entry: {})",
                                    current_price, position.stop_loss_price, position.entry_price
                                ),
                                ExitReason::TakeProfit => format!(
                                    "AUTO_SELL_TAKE_PROFIT: price {} > tp {} (entry: {})",
                                    current_price, position.take_profit_price, position.entry_price
                                ),
                            };

                            let execution_request = ExecutionRequest {
                                request_id: format!("AUTO_{}_{}_{}", exit_reason, token_mint, chrono::Utc::now().timestamp()),
                                signal_type: "AUTO_EXIT".to_string(),
                                action: "SELL_TOKEN".to_string(),
                                action_hint: "SELL".to_string(),
                                target_wallet: String::new(),
                                source_wallet: position.source_wallet.clone(),
                                token_mint: Some(token_mint.clone()),
                                risk_score: 0.0,
                                risk_level: "AUTO_EXIT".to_string(),
                                metadata: Some(serde_json::json!({
                                    "exitReason": exit_reason.to_string(),
                                    "currentPrice": current_price,
                                    "entryPrice": position.entry_price,
                                    "stopLoss": position.stop_loss_price,
                                    "takeProfit": position.take_profit_price,
                                })),
                                reason: reason.clone(),
                            };

                            match self.execute_sell(&execution_request).await {
                                Ok(result) => {
                                    println!(
                                        "[PRICE_MONITOR] AUTO_EXIT: token={}, reason={}, result={}",
                                        token_mint, exit_reason, result
                                    );

                                    // Record journal entry
                                    let mut state = self.state.lock().await;
                                    Self::record_journal_entry(
                                        &mut state,
                                        TradeJournalEntry {
                                            timestamp: chrono::Utc::now().to_rfc3339(),
                                            request_id: execution_request.request_id.clone(),
                                            token_mint: Some(token_mint.clone()),
                                            source_wallet: position.source_wallet.clone(),
                                            action: "sell".to_string(),
                                            status: "executed".to_string(),
                                            amount_sol: position.amount,
                                            pnl_sol: Some((current_price - position.entry_price) * position.amount),
                                            profile_preset: None,
                                            reason,
                                        },
                                    );
                                }
                                Err(e) => {
                                    println!(
                                        "[PRICE_MONITOR] AUTO_EXIT_FAILED: token={}, reason={}, error={}",
                                        token_mint, exit_reason, e
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => {
                        // Log price fetch error but don't fail the loop
                        println!(
                            "[PRICE_MONITOR] Failed to fetch price for {}: {}",
                            token_mint, e
                        );
                    }
                }
            }
        }
    }
}
