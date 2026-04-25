const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d965c9f1-7f28-43f3-8c78-a21f82fa045e';
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
