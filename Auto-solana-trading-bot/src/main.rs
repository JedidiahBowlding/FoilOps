use trading_bot::common::utils::{
    create_nonblocking_rpc_client, create_rpc_client, import_env_var, import_wallet, AppState,
};
use trading_bot::dex::raydium::get_pool_state_by_mint;
use trading_bot::engine::swap::raydium_swap;
use trading_bot::services::rpc_client::BatchRpcClient;
use trading_bot::services::signal_execution::SignalExecutionEngine;
use trading_bot::services::signal_receiver::start_signal_receiver;
use dotenv::dotenv;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use solana_client::rpc_client::RpcClient;
use solana_sdk::program_pack::Pack;
use solana_sdk::pubkey::Pubkey;
use std::env;
use std::future::pending;
use std::panic;
use std::str::FromStr;
use std::sync::Arc;
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

fn mask(val: &str) -> String {
    if val.is_empty() {
        return "MISSING".to_string();
    }
    let len = val.chars().count();
    if len <= 8 {
        "****".to_string()
    } else {
        let start: String = val.chars().take(4).collect();
        let end: String = val.chars().rev().take(4).collect::<String>().chars().rev().collect();
        format!("{}****{}", start, end)
    }
}

fn env_masked(key: &str) -> String {
    env::var(key).map(|v| mask(&v)).unwrap_or_else(|_| "MISSING".to_string())
}

#[tokio::main]
async fn main() {
    dotenv().ok();

    let signal_receiver_bind = env::var("SIGNAL_RECEIVER_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let signal_receiver_dry_run = env::var("SIGNAL_RECEIVER_DRY_RUN")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let signal_receiver_require_auth = env::var("SIGNAL_REQUIRE_AUTH")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(!signal_receiver_dry_run);
    let signal_auth_secret = env::var("SIGNAL_AUTH_SECRET").ok();
    let signal_dedup_window_seconds = env::var("SIGNAL_DEDUP_WINDOW_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(300);
    let signal_max_timestamp_skew_seconds = env::var("SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(120);
    let signal_max_risk_score = env::var("SIGNAL_MAX_RISK_SCORE")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(75.0);

    let signal_receiver_bind_for_task = signal_receiver_bind.clone();
    let signal_auth_secret_for_task = signal_auth_secret.clone();

    // Create execution engine for live trading when wallet + RPC config are valid.
    let execution_engine: Option<Arc<SignalExecutionEngine>> = match create_rpc_client() {
        Ok(rpc_client) => match create_nonblocking_rpc_client().await {
            Ok(rpc_nonblocking_client) => {
                let wallet_result = panic::catch_unwind(|| import_wallet());
                match wallet_result {
                    Ok(Ok(wallet)) => {
                        let app_state = AppState {
                            rpc_client,
                            rpc_nonblocking_client,
                            wallet,
                        };
                        Some(Arc::new(SignalExecutionEngine::new(app_state, signal_max_risk_score)))
                    }
                    Ok(Err(error)) => {
                        eprintln!(
                            "Execution engine disabled: failed to import PRIVATE_KEY: {}. Signal receiver will still run.",
                            error
                        );
                        None
                    }
                    Err(_) => {
                        eprintln!(
                            "Execution engine disabled: PRIVATE_KEY format caused panic during parsing. Signal receiver will still run."
                        );
                        None
                    }
                }
            }
            Err(error) => {
                eprintln!(
                    "Execution engine disabled: failed to create nonblocking RPC client: {}. Signal receiver will still run.",
                    error
                );
                None
            }
        },
        Err(error) => {
            eprintln!(
                "Execution engine disabled: failed to create RPC client: {}. Signal receiver will still run.",
                error
            );
            None
        }
    };

    tokio::spawn(async move {
        if let Err(error) = start_signal_receiver(
            &signal_receiver_bind_for_task,
            signal_receiver_dry_run,
            signal_receiver_require_auth,
            signal_auth_secret_for_task,
            signal_dedup_window_seconds,
            signal_max_timestamp_skew_seconds,
            execution_engine,
        ).await {
            eprintln!("Signal receiver failed: {}", error);
        }
    });

    let required_loop_env = [
        "SOL_PUBKEY",
        "RPC_ENDPOINT",
        "JUP_PUBKEY",
        "TARGET_PUBKEY",
        "RPC_WEBSOCKET_ENDPOINT",
    ];
    let missing_loop_env: Vec<&str> = required_loop_env
        .iter()
        .copied()
        .filter(|key| env::var(key).is_err())
        .collect();

    if !missing_loop_env.is_empty() {
        eprintln!(
            "Copy-trading loop disabled. Missing env vars: {}. Signal receiver remains active on {}.",
            missing_loop_env.join(", "),
            signal_receiver_bind
        );
        pending::<()>().await;
        return;
    }

    let sol_address = env::var("SOL_PUBKEY").unwrap();
    let rpc_https_url = env::var("RPC_ENDPOINT").unwrap();
    let _rpc_client = RpcClient::new(rpc_https_url.clone());
    let unwanted_key = env::var("JUP_PUBKEY").unwrap();
    let target = env::var("TARGET_PUBKEY").unwrap();

    // Create batch RPC client for optimized calls
    let rpc_nonblocking = create_nonblocking_rpc_client().await.expect("Failed to create RPC client");
    let batch_client = Arc::new(BatchRpcClient::new(rpc_nonblocking));

    let ws_url = env::var("RPC_WEBSOCKET_ENDPOINT").unwrap();
    println!(
        "ENV loaded => SOL_PUBKEY={}, TARGET_PUBKEY={}, JUP_PUBKEY={}, RPC_ENDPOINT={}, RPC_WEBSOCKET_ENDPOINT={}, SLIPPAGE={}, JITO_TIP_VALUE={}, NOZOMI_TIP_VALUE={}, ZERO_SLOT_TIP_VALUE={}, TELEGRAM_BOT_TOKEN={}, TELEGRAM_CHAT_ID={}",
        mask(&sol_address),
        mask(&target),
        mask(&unwanted_key),
        mask(&rpc_https_url),
        mask(&ws_url),
        env::var("SLIPPAGE").unwrap_or_else(|_| "MISSING".to_string()),
        env_masked("JITO_TIP_VALUE"),
        env_masked("NOZOMI_TIP_VALUE"),
        env_masked("ZERO_SLOT_TIP_VALUE"),
        env_masked("TELEGRAM_BOT_TOKEN"),
        env_masked("TELEGRAM_CHAT_ID"),
    );
    let (ws_stream, _) = connect_async(ws_url)
        .await
        .expect("Failed to connect to WebSocket server");
    let (mut write, mut read) = ws_stream.split();
    // Subscribe to logs
    let subscription_message = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "transactionSubscribe",
        "params": [

            {
                "failed": false,
                "accountInclude": ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", target],
                "accountExclude": [unwanted_key],
                // Optionally specify accounts of interest
            },
            {
                "commitment": "processed",
                "encoding": "jsonParsed",
                "transactionDetails": "full",
                "maxSupportedTransactionVersion": 0
            }
        ]
    });

    write
        .send(subscription_message.to_string().into())
        .await
        .expect("Failed to send subscription message");

    // Listen for messages
    while let Some(Ok(msg)) = read.next().await {
        if let WsMessage::Text(text) = msg {
            let json: Value = match serde_json::from_str(&text) {
                Ok(value) => value,
                Err(_) => continue,
            };

            // println!("json: {:#?}", json);

            let _sig = json["params"]["result"]["signature"].to_string();
            // let mut ixs: Vec<_> = Vec::new();
            if let Some(inner_instructions) =
                json["params"]["result"]["transaction"]["meta"]["innerInstructions"].as_array()
            {
                // println!("log_str: {:#?}", inner_instructions.clone());
                // Iterate over logs and check for unwanted_key
                for inner_instruction in inner_instructions.iter() {
                    // Try to extract the string representation of the log

                    if let Some(instructions) = inner_instruction["instructions"].as_array() {
                        for instruction in instructions.iter() {
                            if instruction["parsed"]["type"] == "transfer".to_string()
                                && instruction["parsed"]["info"]["authority"] == target
                            {
                                let amount_in = instructions[0]["parsed"]["info"]["amount"]
                                    .as_str()
                                    .unwrap_or("0.0")
                                    .to_string();
                                let amount_out = instructions[1]["parsed"]["info"]["amount"]
                                    .as_str()
                                    .unwrap_or("0.0")
                                    .to_string();
                                let in_ata = instructions[0]["parsed"]["info"]["destination"]
                                    .as_str()
                                    .unwrap_or("")
                                    .to_string();

                                let out_ata = instructions[1]["parsed"]["info"]["source"]
                                    .as_str()
                                    .unwrap_or("")
                                    .to_string();
                                let pubkey_in_ata = match Pubkey::from_str(&in_ata) {
                                    Ok(pubkey) => pubkey,
                                    Err(e) => {
                                        println!("Failed to parse Pubkey in: {}", e);
                                        return;
                                    }
                                };
                                let pubkey_out_ata = match Pubkey::from_str(&out_ata) {
                                    Ok(pubkey) => pubkey,
                                    Err(e) => {
                                        println!("Failed to parse Pubkey out: {}", e);
                                        return;
                                    }
                                };

                                // ⚡ OPTIMIZATION: Batch fetch both token accounts in ONE RPC call
                                println!("⚡ Fetching token accounts in batch...");
                                let accounts = match batch_client.get_multiple_token_accounts(
                                    &[pubkey_in_ata, pubkey_out_ata],
                                    30  // 30 second cache TTL
                                ).await {
                                    Ok(accounts) => accounts,
                                    Err(e) => {
                                        println!("Failed to fetch token accounts: {}", e);
                                        return;
                                    }
                                };

                                let _in_data = match accounts.get(&pubkey_in_ata) {
                                    Some(data) => data,
                                    None => {
                                        println!("Token account not found: {}", pubkey_in_ata);
                                        return;
                                    }
                                };

                                let _out_data = match accounts.get(&pubkey_out_ata) {
                                    Some(data) => data,
                                    None => {
                                        println!("Token account not found: {}", pubkey_out_ata);
                                        return;
                                    }
                                };

                                // Get mint addresses from the accounts (need to fetch full account data)
                                let in_mint_pubkey = match batch_client.get_client().await.get_account(&pubkey_in_ata).await {
                                    Ok(acc) => {
                                        if let Ok(token_acc) = spl_token::state::Account::unpack(&acc.data) {
                                            token_acc.mint
                                        } else {
                                            println!("Failed to unpack in token account");
                                            return;
                                        }
                                    },
                                    Err(e) => {
                                        println!("Failed to get in account: {}", e);
                                        return;
                                    }
                                };

                                let out_mint_pubkey = match batch_client.get_client().await.get_account(&pubkey_out_ata).await {
                                    Ok(acc) => {
                                        if let Ok(token_acc) = spl_token::state::Account::unpack(&acc.data) {
                                            token_acc.mint
                                        } else {
                                            println!("Failed to unpack out token account");
                                            return;
                                        }
                                    },
                                    Err(e) => {
                                        println!("Failed to get out account: {}", e);
                                        return;
                                    }
                                };

                                println!("in_mint: {:#?}", in_mint_pubkey);
                                println!("in_amount: {:#?}", amount_in);
                                println!("out_mint: {:#?}", out_mint_pubkey);
                                println!("out_amount: {:#?}", amount_out);
                                println!("signature: {:#?}", json["params"]["result"]["signature"]);
                                
                                let param_mint;
                                let param_dirs;
                                let in_decimal = 0u8; // decimals unavailable without mint fetch; default to 0
                                let param_amount_in = match amount_in.parse::<f64>() {
                                    Ok(num) => num,
                                    Err(_) => return,
                                };
                                
                                if in_mint_pubkey.to_string() == sol_address {
                                    param_mint = out_mint_pubkey.to_string();
                                    param_dirs = "buy".to_string();
                                } else {
                                    param_mint = in_mint_pubkey.to_string();
                                    param_dirs = "sell".to_string();
                                }
                                swap_to_events(
                                    param_mint,
                                    param_amount_in / 10_f64.powf(in_decimal as f64),
                                    param_dirs,
                                )
                                .await;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

// Listen all events with websocket

pub async fn swap_to_events(mint: String, amount_in: f64, dirs: String) {
    let rpc_client = create_rpc_client().unwrap();
    let rpc_nonblocking_client = create_nonblocking_rpc_client().await.unwrap();
    let wallet = import_wallet().unwrap();
    let in_type = "qty";
    let slippage = import_env_var("SLIPPAGE").parse::<u64>().unwrap_or(5);
    let use_jito = true;

    let (pool_id, pool_state) = match get_pool_state_by_mint(rpc_client.clone(), &mint).await {
        Ok(value) => value,
        Err(err) => {
            eprintln!("Error fetching pool state: {}", err);
            return; // Propagates the error if needed
        }
    };
    let state = AppState {
        rpc_client,
        rpc_nonblocking_client,
        wallet,
    };

    println!("amount_in: {:#?}", amount_in.clone());
    let res = raydium_swap(
        state,
        amount_in.clone(),
        &dirs,
        in_type,
        slippage,
        use_jito,
        pool_id,
        pool_state,
    )
    .await;
    println!("res: {:#?}", res);
}
