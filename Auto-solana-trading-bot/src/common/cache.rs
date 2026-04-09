use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::Mutex;
use solana_sdk::pubkey::Pubkey;
use spl_token_2022::extension::StateWithExtensionsOwned;
use spl_token_2022::state::Mint;

// Cache for token account data with 30 second TTL
pub static TOKEN_ACCOUNT_CACHE: LazyLock<Mutex<HashMap<Pubkey, CachedTokenBalance>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

// Cache for token mint data (mints don't change, cache forever)
pub static TOKEN_MINT_CACHE: LazyLock<Mutex<HashMap<Pubkey, StateWithExtensionsOwned<Mint>>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

// Cache for pool addresses by mint
pub static POOL_ADDRESS_CACHE: LazyLock<Mutex<HashMap<String, (Pubkey, u64)>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug)]
pub struct CachedTokenBalance {
    pub amount: u64,
    pub timestamp: u64,
}

impl CachedTokenBalance {
    pub fn new(amount: u64) -> Self {
        Self {
            amount,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }

    pub fn is_valid(&self, ttl_seconds: u64) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        now - self.timestamp < ttl_seconds
    }
}

/// Get token account from cache or None if not found/expired
pub fn get_cached_token_account(pubkey: &Pubkey, ttl_seconds: u64) -> Option<CachedTokenBalance> {
    let cache = TOKEN_ACCOUNT_CACHE.lock().ok()?;
    cache.get(pubkey)
        .filter(|cached| cached.is_valid(ttl_seconds))
        .map(|cached| cached.clone())
}

/// Cache token account data
pub fn cache_token_account(pubkey: Pubkey, amount: u64) {
    if let Ok(mut cache) = TOKEN_ACCOUNT_CACHE.lock() {
        cache.insert(pubkey, CachedTokenBalance::new(amount));
    }
}

/// Get mint from cache
pub fn get_cached_mint(pubkey: &Pubkey) -> Option<StateWithExtensionsOwned<Mint>> {
    let cache = TOKEN_MINT_CACHE.lock().ok()?;
    cache.get(pubkey).cloned()
}

/// Cache mint data (permanent - mints don't change)
pub fn cache_mint(pubkey: Pubkey, data: StateWithExtensionsOwned<Mint>) {
    if let Ok(mut cache) = TOKEN_MINT_CACHE.lock() {
        cache.insert(pubkey, data);
    }
}

/// Get pool address from cache
pub fn get_cached_pool_address(mint: &str, ttl_seconds: u64) -> Option<Pubkey> {
    let cache = POOL_ADDRESS_CACHE.lock().ok()?;
    cache.get(mint).and_then(|(pubkey, timestamp)| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if now - timestamp < ttl_seconds {
            Some(*pubkey)
        } else {
            None
        }
    })
}

/// Cache pool address
pub fn cache_pool_address(mint: String, pool_address: Pubkey) {
    if let Ok(mut cache) = POOL_ADDRESS_CACHE.lock() {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        cache.insert(mint, (pool_address, timestamp));
    }
}
