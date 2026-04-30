const web3 = require('@solana/web3.js');
require('dotenv').config();

function firstConfiguredRpcEndpoint() {
  const raw = process.env.RPC_ENDPOINTS || '';
  const first = raw
    .split(',')
    .map((v) => v.trim())
    .find(Boolean);
  return first || '';
}

(async () => {
  const endpoint =
    process.env.QUICKNODE_RPC_URL?.trim() ||
    process.env.RPC_ENDPOINT?.trim() ||
    firstConfiguredRpcEndpoint();

  if (!endpoint) {
    console.error(
      'Missing RPC URL. Set QUICKNODE_RPC_URL (preferred) or RPC_ENDPOINT/RPC_ENDPOINTS in your .env.',
    );
    process.exit(1);
  }

  const connection = new web3.Connection(endpoint, 'confirmed');
  const slot = await connection.getSlot();

  console.log('RPC endpoint:', endpoint);
  console.log('Current slot:', slot);
})().catch((error) => {
  console.error('Failed to fetch slot:', error?.message || error);
  process.exit(1);
});
