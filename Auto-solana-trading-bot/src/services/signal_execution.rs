use crate::common::utils::AppState;
use crate::engine::swap::{pump_swap, raydium_swap};
use crate::dex::raydium::get_pool_state_by_mint;
use crate::services::signal_receiver::{ExecutionRequest, TradeSignalV1};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

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
            take_profit_percentage: 50.0,
            max_position_size_sol: 0.1,
            min_liquidity_usd: 1000.0,
            allowed_dexes: vec!["pump_fun".to_string(), "raydium".to_string()],
            denylist: vec![],
            allowlist: vec![],
        }
    }
}

#[derive(Debug, Clone)]
pub struct ActivePosition {
    pub token_mint: String,
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
    pub recent_trades: Vec<TradeRecord>,
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

impl Default for TradingState {
    fn default() -> Self {
        Self {
            config: TradingConfig::default(),
            active_positions: HashMap::new(),
            recent_trades: Vec::new(),
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
    pub fn new(app_state: AppState) -> Self {
        Self {
            state: Arc::new(Mutex::new(TradingState::default())),
            app_state,
        }
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
        if signal.risk_score > 75.0 {
            return Err("risk_score_too_high".to_string());
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
            "COPY_TRADE" => "COPY_TRADE",
            _ => "WATCH_ONLY",
        };

        ExecutionRequest {
            request_id: signal.signal_id.clone(),
            signal_type: signal.signal_type.clone(),
            action: action.to_string(),
            target_wallet,
            token_mint: signal.token_mint.clone(),
            risk_score: signal.risk_score,
            risk_level: signal.risk_level.clone(),
            reason: format!("Signal-based execution: {}", signal.signal_type),
        }
    }

    async fn execute_buy(&self, request: &ExecutionRequest) -> Result<String> {
        let token_mint = match &request.token_mint {
            Some(mint) => mint.clone(),
            None => return Ok("NO_TOKEN_MINT_SPECIFIED".to_string()),
        };

        let (slippage, mev_service, actual_amount, allowed_dexes) = {
            let state = self.state.lock().await;
            if state.active_positions.contains_key(&token_mint) {
                return Ok("POSITION_ALREADY_EXISTS".to_string());
            }
            let amount_sol = state.config.buy_amount_sol;
            let actual_amount = if state.config.mode == "conservative" {
                (amount_sol * 0.1).max(0.001)
            } else {
                amount_sol
            };
            (
                state.config.slippage as u64,
                state.config.mev_service.clone(),
                actual_amount,
                state.config.allowed_dexes.clone(),
            )
        };

        let dex = self.determine_dex(&token_mint).await?;

        if !allowed_dexes.contains(&dex) {
            return Ok(format!("DEX_NOT_ALLOWED: {}", dex));
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
                let mut state = self.state.lock().await;
                // Record the position
                let position = ActivePosition {
                    token_mint: token_mint.clone(),
                    entry_price: 0.0, // Would need price oracle integration
                    amount: actual_amount,
                    entry_time: Instant::now(),
                    stop_loss_price: 0.0, // Would need price calculation
                    take_profit_price: 0.0, // Would need price calculation
                };

                state.active_positions.insert(token_mint.clone(), position);

                // Record trade
                let trade = TradeRecord {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    token_mint: token_mint.clone(),
                    action: "buy".to_string(),
                    amount: actual_amount,
                    price: 0.0,
                    pnl: None,
                    reason: request.reason.clone(),
                };

                state.recent_trades.push(trade);
                state.total_trades += 1;

                Ok(format!("BUY_EXECUTED: {} tx(s), amount: {} SOL", tx_sigs.len(), actual_amount))
            }
            Err(e) => Ok(format!("BUY_FAILED: {}", e)),
        }
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

                Ok(format!("SELL_EXECUTED: {} tx(s), amount: {} SOL, PnL: {} SOL",
                          tx_sigs.len(), position.amount, pnl))
            }
            Err(e) => {
                let mut state = self.state.lock().await;
                // Put position back if sell failed
                state.active_positions.insert(token_mint, position);
                Ok(format!("SELL_FAILED: {}", e))
            }
        }
    }

    async fn execute_copy_trade(&self, request: &ExecutionRequest) -> Result<String> {
        // For copy trading, we need token mint and amount from the signal metadata
        let token_mint = match &request.token_mint {
            Some(mint) => mint.clone(),
            None => return Ok("NO_TOKEN_MINT_FOR_COPY_TRADE".to_string()),
        };

        // Copy trading uses the existing swap_to_events logic but with risk controls
        // This would integrate with the existing WebSocket monitoring system

        Ok(format!("COPY_TRADE_SIGNAL_RECEIVED: {} from {}", token_mint, request.target_wallet))
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
}
