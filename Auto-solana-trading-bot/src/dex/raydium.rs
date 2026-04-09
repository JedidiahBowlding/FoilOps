use anyhow::{anyhow, Result};
use raydium_amm::state::AmmInfo;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;

use crate::engine::swap::{SwapDirection, SwapInType};

pub struct Raydium {
    _rpc_nonblocking_client: Arc<solana_client::nonblocking::rpc_client::RpcClient>,
    _rpc_client: Arc<solana_client::rpc_client::RpcClient>,
    _wallet: Arc<solana_sdk::signature::Keypair>,
}

impl Raydium {
    pub fn new(
        rpc_nonblocking_client: Arc<solana_client::nonblocking::rpc_client::RpcClient>,
        rpc_client: Arc<solana_client::rpc_client::RpcClient>,
        wallet: Arc<solana_sdk::signature::Keypair>,
    ) -> Self {
        Self {
            _rpc_nonblocking_client: rpc_nonblocking_client,
            _rpc_client: rpc_client,
            _wallet: wallet,
        }
    }

    pub async fn swap(
        &self,
        _amount_in: f64,
        _swap_direction: SwapDirection,
        _in_type: SwapInType,
        _slippage: u64,
        _use_jito: bool,
        _amm_pool_id: Pubkey,
        _pool_state: AmmInfo,
    ) -> Result<Vec<String>> {
        Err(anyhow!("Raydium swap not yet implemented"))
    }
}

pub async fn get_pool_state(
    _rpc_client: Arc<solana_client::rpc_client::RpcClient>,
    _amm_pool_id: &Pubkey,
) -> Result<(Pubkey, AmmInfo)> {
    Err(anyhow!("get_pool_state not yet implemented"))
}

pub async fn get_pool_state_by_mint(
    _rpc_client: Arc<solana_client::rpc_client::RpcClient>,
    _mint: &str,
) -> Result<(Pubkey, AmmInfo)> {
    Err(anyhow!("get_pool_state_by_mint not yet implemented"))
}
