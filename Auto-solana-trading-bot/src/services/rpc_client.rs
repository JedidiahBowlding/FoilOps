use std::{collections::HashMap, sync::Arc, time::SystemTime};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{pubkey::Pubkey, program_pack::Pack};
use anyhow::Result;
use tokio::sync::RwLock;

use crate::common::logger::Logger;
use crate::common::cache::{self, CachedTokenBalance};

/// BatchRpcClient provides optimized methods for fetching multiple accounts in a single RPC call
pub struct BatchRpcClient {
    rpc_client: Arc<RpcClient>,
    connection_pool: Arc<RwLock<Vec<Arc<RpcClient>>>>,
    logger: Logger,
}

impl BatchRpcClient {
    pub fn new(rpc_client: Arc<RpcClient>) -> Self {
        // Create a connection pool with the initial client
        let mut pool = Vec::with_capacity(5);
        pool.push(rpc_client.clone());
        
        Self {
            rpc_client,
            connection_pool: Arc::new(RwLock::new(pool)),
            logger: Logger::new("[BATCH-RPC]".to_string()),
        }
    }
    
    /// Get a client from the connection pool
    pub async fn get_client(&self) -> Arc<RpcClient> {
        let pool = self.connection_pool.read().await;
        if pool.is_empty() {
            self.rpc_client.clone()
        } else {
            // Simple round-robin selection
            let index = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as usize % pool.len();
            pool[index].clone()
        }
    }
    
    /// Add a new client to the connection pool
    pub async fn add_client(&self, client: Arc<RpcClient>) {
        let mut pool = self.connection_pool.write().await;
        pool.push(client);
    }
    
    /// Get multiple token accounts in a single RPC call with caching
    pub async fn get_multiple_token_accounts(
        &self, 
        accounts: &[Pubkey],
        cache_ttl_seconds: u64,
    ) -> Result<HashMap<Pubkey, CachedTokenBalance>> {
        let mut result = HashMap::new();
        let mut accounts_to_fetch = Vec::new();
        
        // Check cache first
        for account in accounts {
            if let Some(cached) = cache::get_cached_token_account(account, cache_ttl_seconds) {
                result.insert(*account, cached);
            } else {
                accounts_to_fetch.push(*account);
            }
        }
        
        // If all accounts were cached, return early
        if accounts_to_fetch.is_empty() {
            if !result.is_empty() {
                self.logger.log(format!("✓ All {} token accounts from cache", result.len()));
            }
            return Ok(result);
        }
        
        self.logger.log(format!(
            "⚡ Batch fetching {} token accounts ({} from cache)", 
            accounts_to_fetch.len(),
            result.len()
        ));
        
        // Fetch remaining accounts in batch (1 RPC call instead of N)
        let client = self.get_client().await;
        let fetched_accounts = client.get_multiple_accounts(&accounts_to_fetch).await?;
        
        for (i, maybe_account) in fetched_accounts.iter().enumerate() {
            if let Some(account_data) = maybe_account {
                if let Ok(token_account) = spl_token::state::Account::unpack(&account_data.data) {
                    let balance = CachedTokenBalance {
                        amount: token_account.amount,
                        timestamp: SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                    };

                    cache::cache_token_account(accounts_to_fetch[i], balance.amount);
                    result.insert(accounts_to_fetch[i], balance);
                }
            }
        }
        
        Ok(result)
    }
    
    /// Get token account with automatic caching (30 second TTL)
    pub async fn get_token_account_cached(
        &self,
        account: &Pubkey,
    ) -> Result<Option<CachedTokenBalance>> {
        // Check cache first (30 second TTL)
        if let Some(cached) = cache::get_cached_token_account(account, 30) {
            self.logger.debug(format!("✓ Token account {} from cache", account));
            return Ok(Some(cached));
        }
        
        self.logger.debug(format!("→ Fetching token account {}", account));
        
        // Fetch from RPC
        let client = self.get_client().await;
        match client.get_account(account).await {
            Ok(account_data) => {
                if let Ok(token_account) = spl_token::state::Account::unpack(&account_data.data) {
                    let balance = CachedTokenBalance {
                        amount: token_account.amount,
                        timestamp: SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                    };

                    cache::cache_token_account(*account, balance.amount);
                    Ok(Some(balance))
                } else {
                    Ok(None)
                }
            },
            Err(_) => Ok(None),
        }
    }
    
    /// Check if multiple token accounts exist in a single RPC call
    pub async fn check_multiple_accounts_exist(
        &self,
        accounts: &[Pubkey]
    ) -> Result<HashMap<Pubkey, bool>> {
        let mut result = HashMap::new();
        
        // Get accounts
        let client = self.get_client().await;
        let fetched_accounts = client.get_multiple_accounts(accounts).await?;
        
        for (i, maybe_account) in fetched_accounts.iter().enumerate() {
            result.insert(accounts[i], maybe_account.is_some());
        }
        
        Ok(result)
    }
}

/// Create a batch RPC client from an existing RPC client
pub fn create_batch_client(rpc_client: Arc<RpcClient>) -> BatchRpcClient {
    BatchRpcClient::new(rpc_client)
} 