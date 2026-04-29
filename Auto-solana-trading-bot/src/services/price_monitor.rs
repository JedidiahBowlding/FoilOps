use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct TokenPrice {
    pub mint: String,
    pub price_sol: f64,
    pub timestamp: u64,
}

pub struct PriceMonitor {
    http_client: Client,
}

impl PriceMonitor {
    pub fn new() -> Self {
        Self {
            http_client: Client::builder()
                .timeout(Duration::from_secs(8))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    /// Fetch current price for a token from Jupiter quote API
    pub async fn get_token_price(&self, token_mint: &str) -> Result<TokenPrice> {
        // Use a small fixed amount (0.01 SOL) to get current price from quote
        let input_mint = "So11111111111111111111111111111111111111112"; // WSOL
        let amount = 10_000_000u64; // 0.01 SOL in lamports

        let bases = vec![
            "https://api.jup.ag/swap",
            "https://lite-api.jup.ag/swap",
        ];

        for base in bases {
            let quote_url = format!(
                "{}/v1/quote?inputMint={}&outputMint={}&amount={}&slippageBps=100",
                base, input_mint, token_mint, amount
            );

            match self.http_client.get(&quote_url).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        continue;
                    }

                    match resp.json::<Value>().await {
                        Ok(quote) => {
                            if let Some(out_amount) = quote
                                .get("outAmount")
                                .and_then(|v| v.as_str())
                                .and_then(|s| s.parse::<f64>().ok())
                            {
                                // Get token decimals from quote if available
                                let decimals = quote
                                    .get("outAmountDecimal")
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| s.parse::<f64>().ok())
                                    .unwrap_or(out_amount);

                                // Price in SOL per token
                                let price_sol = if decimals > 0.0 {
                                    0.01 / (decimals / 10_f64.powi(9)) // Adjust for decimals
                                } else {
                                    0.01 / out_amount
                                };

                                return Ok(TokenPrice {
                                    mint: token_mint.to_string(),
                                    price_sol: price_sol.max(0.0000001), // Prevent zero/negative prices
                                    timestamp: chrono::Utc::now().timestamp() as u64,
                                });
                            }
                        }
                        Err(_) => continue,
                    }
                }
                Err(_) => continue,
            }
        }

        Err(anyhow!("unable_to_fetch_price_from_all_endpoints"))
    }

    /// Calculate stop loss and take profit prices
    pub fn calculate_exit_prices(
        entry_price: f64,
        stop_loss_percentage: f64,
        take_profit_percentage: f64,
    ) -> (f64, f64) {
        let stop_loss_price = entry_price * (1.0 - (stop_loss_percentage / 100.0));
        let take_profit_price = entry_price * (1.0 + (take_profit_percentage / 100.0));

        (stop_loss_price, take_profit_price)
    }

    /// Check if position should exit
    pub fn should_exit(
        current_price: f64,
        stop_loss_price: f64,
        take_profit_price: f64,
    ) -> Option<ExitReason> {
        if current_price <= stop_loss_price {
            Some(ExitReason::StopLoss)
        } else if current_price >= take_profit_price {
            Some(ExitReason::TakeProfit)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExitReason {
    StopLoss,
    TakeProfit,
}

impl std::fmt::Display for ExitReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExitReason::StopLoss => write!(f, "STOP_LOSS"),
            ExitReason::TakeProfit => write!(f, "TAKE_PROFIT"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_exit_prices() {
        let (sl, tp) = PriceMonitor::calculate_exit_prices(1.0, 20.0, 50.0);
        assert!((sl - 0.8).abs() < 0.001);
        assert!((tp - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_should_exit() {
        let (sl, tp) = PriceMonitor::calculate_exit_prices(1.0, 20.0, 50.0);

        // Below stop loss
        assert_eq!(
            PriceMonitor::should_exit(0.75, sl, tp),
            Some(ExitReason::StopLoss)
        );

        // Above take profit
        assert_eq!(
            PriceMonitor::should_exit(1.6, sl, tp),
            Some(ExitReason::TakeProfit)
        );

        // Between SL and TP
        assert_eq!(PriceMonitor::should_exit(1.0, sl, tp), None);
    }
}
