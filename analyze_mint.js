const fs = require('fs');
require('dotenv').config();
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || "https://api.mainnet-beta.solana.com";
const MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";

async function main() {
  console.log("Fetching signatures for " + MINT);
  const sRes = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [MINT, { limit: 50 }] })
  });
  const sigs = (await sRes.json()).result || [];
  console.log(`Found ${sigs.length} signatures.`);

  const wallets = {};
  let transactionsParsed = 0;

  for (let s of sigs) {
    const tRes = await fetch(RPC_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] })
    });
    const tx = (await tRes.json()).result;
    if (tx?.meta) {
      transactionsParsed++;
      const fee = (tx.meta.fee || 0) / 1e9;
      const signer = tx.transaction.message.accountKeys.find(ak => ak.signer).pubkey;

      // Look for token transfers involving our mint
      let inVol = 0;
      tx.meta.postTokenBalances?.forEach(p => {
        if (p.mint === MINT) {
          const pre = tx.meta.preTokenBalances?.find(pre => pre.accountIndex === p.accountIndex)?.uiTokenAmount?.uiAmount || 0;
          const post = p.uiTokenAmount?.uiAmount || 0;
          if (post > pre) inVol += (post - pre);
        }
      });

      if (inVol > 0) {
        // Approximate USD spent using SOL balance change if available or just count the wallet
        const solChange = (tx.meta.preBalances[0] - tx.meta.postBalances[0]) / 1e9;
        const spent = Math.max(0, solChange - fee) * 150; // Mock price $150
        wallets[signer] = (wallets[signer] || { usdSpent: 0, count: 0 });
        wallets[signer].usdSpent += spent;
        wallets[signer].count += 1;
      }
    }
  }

  const walletsArray = Object.entries(wallets).map(([addr, data]) => ({ address: addr, ...data }));
  const top10 = walletsArray.sort((a, b) => b.usdSpent - a.usdSpent).slice(0, 10);
  const whales = walletsArray.filter(w => w.usdSpent >= 1000000);

  const res = {
    signaturesFetched: sigs.length,
    transactionsParsed,
    wallets: wallets,
    top10,
    whales
  };

  fs.writeFileSync("/tmp/helius_6p6xg_analysis.json", JSON.stringify(res, null, 2));
  console.log("Analysis saved to /tmp/helius_6p6xg_analysis.json");
  console.log(`Parsed ${transactionsParsed} transactions.`);
  console.log("Top 3 spent:", top10.slice(0, 3));
}
main().catch(console.error);
