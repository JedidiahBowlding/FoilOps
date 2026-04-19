use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use crate::engine::swap::{SwapDirection, SwapInType};
use serde::{Deserialize, Serialize};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    transaction::VersionedTransaction,
};
use spl_associated_token_account::get_associated_token_address;
use spl_token::ui_amount_to_amount;
use std::str::FromStr;
use std::sync::Arc;

const SOL_MINT: &str = "So11111111111111111111111111111111111111112";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JupiterQuoteResponse {
    input_mint: String,
    output_mint: String,
    in_amount: String,
    out_amount: String,
    slippage_bps: u64,
    route_plan: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JupiterSwapRequest {
    quote_response: JupiterQuoteResponse,
    user_public_key: String,
    wrap_and_unwrap_sol: bool,
    dynamic_compute_unit_limit: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JupiterSwapResponse {
    swap_transaction: String,
}

pub struct Pump {
    rpc_nonblocking_client: Arc<solana_client::nonblocking::rpc_client::RpcClient>,
    rpc_client: Arc<solana_client::rpc_client::RpcClient>,
    wallet: Arc<Keypair>,
}

impl Pump {
    pub fn new(
        rpc_nonblocking_client: Arc<solana_client::nonblocking::rpc_client::RpcClient>,
        rpc_client: Arc<solana_client::rpc_client::RpcClient>,
        wallet: Arc<solana_sdk::signature::Keypair>,
    ) -> Self {
        Self {
            rpc_nonblocking_client,
            rpc_client,
            wallet,
        }
    }

    async fn execute_jupiter_swap(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount: u64,
        slippage: u64,
    ) -> Result<Vec<String>> {
        if amount == 0 {
            return Err(anyhow!("invalid_amount: amount must be greater than 0"));
        }

        let slippage_bps = slippage.saturating_mul(100).min(5000);
        let quote_url = format!(
            "https://quote-api.jup.ag/v6/quote?inputMint={}&outputMint={}&amount={}&slippageBps={}",
            input_mint, output_mint, amount, slippage_bps
        );

        let quote_response = reqwest::get(&quote_url)
            .await
            .context("jupiter_quote_request_failed")?
            .error_for_status()
            .context("jupiter_quote_http_error")?
            .json::<JupiterQuoteResponse>()
            .await
            .context("jupiter_quote_decode_failed")?;

        if quote_response.route_plan.is_empty() {
            return Err(anyhow!("no_route_found_for_token"));
        }

        let swap_payload = JupiterSwapRequest {
            quote_response,
            user_public_key: self.wallet.pubkey().to_string(),
            wrap_and_unwrap_sol: true,
            dynamic_compute_unit_limit: true,
        };

        let swap_response = reqwest::Client::new()
            .post("https://quote-api.jup.ag/v6/swap")
            .json(&swap_payload)
            .send()
            .await
            .context("jupiter_swap_request_failed")?
            .error_for_status()
            .context("jupiter_swap_http_error")?
            .json::<JupiterSwapResponse>()
            .await
            .context("jupiter_swap_decode_failed")?;

        let swap_tx_bytes = STANDARD
            .decode(&swap_response.swap_transaction)
            .context("swap_transaction_base64_decode_failed")?;

        let mut swap_tx: VersionedTransaction =
            bincode::deserialize(&swap_tx_bytes).context("swap_transaction_deserialize_failed")?;

        let message_data = swap_tx.message.serialize();
        let signature = self.wallet.sign_message(&message_data);
        if swap_tx.signatures.is_empty() {
            swap_tx.signatures.push(signature);
        } else {
            swap_tx.signatures[0] = signature;
        }

        let tx_sig: Signature = self
            .rpc_nonblocking_client
            .send_transaction(&swap_tx)
            .await
            .context("swap_transaction_send_failed")?;

        let _ = self.rpc_client.get_latest_blockhash();

        Ok(vec![tx_sig.to_string()])
    }

    async fn execute_jupiter_buy(&self, mint: &str, amount_sol: f64, slippage: u64) -> Result<Vec<String>> {
        let amount_lamports = ui_amount_to_amount(amount_sol, spl_token::native_mint::DECIMALS);
        let output_mint = Pubkey::from_str(mint)
            .map_err(|_| anyhow!("invalid_token_mint"))?
            .to_string();

        self.execute_jupiter_swap(SOL_MINT, &output_mint, amount_lamports, slippage)
            .await
    }

    async fn execute_jupiter_sell(
        &self,
        mint: &str,
        amount_in: f64,
        in_type: SwapInType,
        slippage: u64,
    ) -> Result<Vec<String>> {
        let mint_pubkey = Pubkey::from_str(mint).map_err(|_| anyhow!("invalid_token_mint"))?;
        let token_ata = get_associated_token_address(&self.wallet.pubkey(), &mint_pubkey);

        let token_balance = self
            .rpc_nonblocking_client
            .get_token_account_balance(&token_ata)
            .await
            .context("token_balance_lookup_failed")?;

        let raw_balance = token_balance
            .amount
            .parse::<u64>()
            .context("invalid_token_balance_amount")?;

        if raw_balance == 0 {
            return Err(anyhow!("no_token_balance_to_sell"));
        }

        let sell_amount = match in_type {
            SwapInType::Qty => {
                let requested = ui_amount_to_amount(amount_in.max(0.0), token_balance.decimals);
                requested.min(raw_balance)
            }
            SwapInType::Pct => {
                let pct = amount_in.clamp(0.0, 100.0);
                ((raw_balance as f64) * (pct / 100.0)).floor() as u64
            }
        };

        if sell_amount == 0 {
            return Err(anyhow!("sell_amount_too_small"));
        }

        self.execute_jupiter_swap(mint, SOL_MINT, sell_amount, slippage).await
    }

    pub async fn swap(
        &self,
        mint: &str,
        amount_in: f64,
        swap_direction: SwapDirection,
        in_type: SwapInType,
        slippage: u64,
        _use_jito: bool,
    ) -> Result<Vec<String>> {
        match swap_direction {
            SwapDirection::Buy => match in_type {
                SwapInType::Qty => self.execute_jupiter_buy(mint, amount_in, slippage).await,
                SwapInType::Pct => Err(anyhow!("pumpfun_buy_pct_not_supported")),
            },
            SwapDirection::Sell => self.execute_jupiter_sell(mint, amount_in, in_type, slippage).await,
        }
    }
}
