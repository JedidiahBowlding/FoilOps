require('dotenv').config();
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
const MINT = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';

async function rpc(method, params) {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const res = await r.json();
  console.log("RPC Method:", method, "Response Keys:", Object.keys(res), res.error ? "Error: " + JSON.stringify(res.error) : "No Error");
  return res.result;
}

rpc('getSignaturesForAddress', [MINT, { limit: 5 }])
  .then(sigs => console.log("Sigs:", Array.isArray(sigs) ? sigs.length : "Not array"))
  .catch(console.error);
