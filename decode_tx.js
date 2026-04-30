const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
const c = new Connection(RPC_URL);
const sig = '5SZpjQn2C92gGQKjEnGYrufNzpkd1VfM1YBnJ6rzhTqahvD27oDk169T6XH96eeEFYPSdgQbKtZct6jPUu65K8wV';
const M = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
const targetOwner = 'Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce';

async function run() {
  const t = await c.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
  if (!t) { console.log("Tx not found"); return; }

  const accounts = t.transaction.message.accountKeys;
  const pre = t.meta.preTokenBalances || [];
  const post = t.meta.postTokenBalances || [];

  const map = {};
  pre.forEach(b => {
    if (b.mint === M) {
      map[b.accountIndex] = {
        pre: BigInt(b.uiTokenAmount.amount),
        post: BigInt(0),
        decimals: b.uiTokenAmount.decimals,
        owner: b.owner,
        tokenAccount: accounts[b.accountIndex].pubkey.toString()
      };
    }
  });
  post.forEach(b => {
    if (b.mint === M) {
      if (!map[b.accountIndex]) {
        map[b.accountIndex] = {
          pre: BigInt(0),
          post: BigInt(b.uiTokenAmount.amount),
          decimals: b.uiTokenAmount.decimals,
          owner: b.owner,
          tokenAccount: accounts[b.accountIndex].pubkey.toString()
        };
      } else {
        map[b.accountIndex].post = BigInt(b.uiTokenAmount.amount);
      }
    }
  });

  const rows = Object.entries(map).map(([idx, data]) => {
    const deltaRaw = data.post - data.pre;
    const div = 10 ** data.decimals;
    return {
      accountIndex: idx,
      owner: data.owner,
      tokenAccount: data.tokenAccount,
      preRaw: data.pre.toString(),
      postRaw: data.post.toString(),
      deltaRaw: deltaRaw,
      decimals: data.decimals,
      deltaUI: Number(deltaRaw) / div
    };
  });

  rows.sort((a, b) => {
    const absA = a.deltaRaw < 0n ? -a.deltaRaw : a.deltaRaw;
    const absB = b.deltaRaw < 0n ? -b.deltaRaw : b.deltaRaw;
    return absA > absB ? -1 : 1;
  });

  rows.forEach(r => {
    console.log(`Idx: ${r.accountIndex} | Owner: ${r.owner} | TA: ${r.tokenAccount} | Pre: ${r.preRaw} | Post: ${r.postRaw} | Delta: ${r.deltaRaw} | Dec: ${r.decimals} | UI: ${r.deltaUI}`);
  });

  let sumPosRaw = 0n, sumNegRaw = 0n, sumPosUI = 0, sumNegUI = 0;
  let targetRow = null;

  rows.forEach(r => {
    if (r.deltaRaw > 0n) { sumPosRaw += r.deltaRaw; sumPosUI += r.deltaUI; }
    else if (r.deltaRaw < 0n) { sumNegRaw += r.deltaRaw; sumNegUI += r.deltaUI; }
    if (r.owner === targetOwner) targetRow = r;
  });

  console.log("\nTotals:");
  console.log(`PosDeltaRaw: ${sumPosRaw} | PosDeltaUI: ${sumPosUI}`);
  console.log(`NegDeltaRaw: ${sumNegRaw} | NegDeltaUI: ${sumNegUI}`);
  console.log(`NetDeltaRaw: ${sumPosRaw + sumNegRaw} | NetDeltaUI: ${sumPosUI + sumNegUI}`);
  if (targetRow) {
    console.log(`Target Owner Row (${targetOwner}): DeltaRaw: ${targetRow.deltaRaw} | DeltaUI: ${targetRow.deltaUI}`);
  }
}
run();
