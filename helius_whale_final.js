const fs = require('fs');
require('dotenv').config();

const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
const MINT = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD8w2k7cD2qQxQq4Yk9B2w';
const MAX_SIGS = 10000;
const OUT = '/tmp/helius_6p6xg_full_analysis.json';

async function rpc(method, params) {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function getSolUsd() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const j = await r.json();
    const p = Number(j?.solana?.usd);
    return Number.isFinite(p) && p > 0 ? p : 150;
  } catch {
    return 150;
  }
}

function tokenAmount(x) {
  const v = x?.uiTokenAmount?.uiAmount;
  return Number.isFinite(v) ? v : 0;
}

(async () => {
  const solUsd = await getSolUsd();

  const sigs = [];
  let before;
  while (sigs.length < MAX_SIGS) {
    const batch = await rpc('getSignaturesForAddress', [MINT, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!Array.isArray(batch) || batch.length === 0) break;
    sigs.push(...batch.map(x => x.signature));
    before = batch[batch.length - 1].signature;
    if (batch.length < 1000) break;
  }

  const buyers = {}; // address -> {address, usdSpent, txCount, tokenAcquired}
  let parsed = 0;

  for (let i = 0; i < sigs.length; i += 25) {
    const chunk = sigs.slice(i, i + 25);
    const txs = await Promise.all(chunk.map(async (sig) => {
      try {
        return await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      } catch {
        return null;
      }
    }));

    for (const tx of txs) {
      if (!tx || !tx.meta || !tx.transaction?.message?.accountKeys) continue;
      parsed++;

      const preTB = tx.meta.preTokenBalances || [];
      const postTB = tx.meta.postTokenBalances || [];
      const preLamports = tx.meta.preBalances || [];
      const postLamports = tx.meta.postBalances || [];
      const accountKeys = tx.transaction.message.accountKeys;

      const gains = [];
      for (const post of postTB) {
        if (post.mint !== MINT) continue;
        const pre = preTB.find(p => p.accountIndex === post.accountIndex && p.mint === MINT);
        const preAmt = tokenAmount(pre);
        const postAmt = tokenAmount(post);
        const diff = postAmt - preAmt;
        if (diff > 0) {
          const owner = post.owner || (accountKeys[post.accountIndex]?.pubkey || accountKeys[post.accountIndex]);
          if (owner) gains.push({ owner, accountIndex: post.accountIndex, tokenGained: diff });
        }
      }
      if (!gains.length) continue;

      for (const g of gains) {
        if (!buyers[g.owner]) buyers[g.owner] = { address: g.owner, usdSpent: 0, txCount: 0, tokenAcquired: 0 };

        let usd = 0;

        if (Number.isInteger(g.accountIndex) && g.accountIndex >= 0 && g.accountIndex < preLamports.length && g.accountIndex < postLamports.length) {
          const dLamports = preLamports[g.accountIndex] - postLamports[g.accountIndex];
          if (dLamports > 0) usd += (dLamports / 1e9) * solUsd;
        }

        for (const mint of [USDC, USDT]) {
          const postRows = postTB.filter(x => x.mint === mint && x.owner === g.owner);
          for (const pRow of postRows) {
            const preRow = preTB.find(x => x.mint === mint && x.owner === g.owner && x.accountIndex === pRow.accountIndex);
            const d = tokenAmount(preRow) - tokenAmount(pRow);
            if (d > 0) usd += d;
          }
        }

        buyers[g.owner].usdSpent += usd;
        buyers[g.owner].txCount += 1;
        buyers[g.owner].tokenAcquired += g.tokenGained;
      }
    }
  }

  const sorted = Object.values(buyers).sort((a, b) => b.usdSpent - a.usdSpent);
  const whales = sorted.filter(x => x.usdSpent >= 1_000_000);

  const out = {
    tokenMint: MINT,
    solUsd,
    signaturesFetched: sigs.length,
    transactionsParsed: parsed,
    buyersCount: sorted.length,
    top20: sorted.slice(0, 20),
    whales
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    signaturesFetched: out.signaturesFetched,
    transactionsParsed: out.transactionsParsed,
    buyersCount: out.buyersCount,
    whaleCount: out.whales.length,
    whales: out.whales.map(w => ({ address: w.address, usdSpent: w.usdSpent })),
    outPath: OUT
  }, null, 2));
})();
