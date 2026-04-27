const { Connection, PublicKey } = require('@solana/web3.js');
const c = new Connection('https://api.mainnet-beta.solana.com');
const W = 'Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce';
const M = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
async function r() {
  try {
    const ss = await c.getSignaturesForAddress(new PublicKey(W), {limit:10});
    for(const s of ss.filter(x=>x.blockTime>=1777306043).reverse()) {
      const t = await c.getParsedTransaction(s.signature, {maxSupportedTransactionVersion:0});
      if(!t) continue;
      const b1 = (t.meta.preTokenBalances || []).find(x=>x.owner===W && x.mint===M);
      const b2 = (t.meta.postTokenBalances || []).find(x=>x.owner===W && x.mint===M);
      const dE = (b2?b2.uiTokenAmount.uiAmount:0) - (b1?b1.uiTokenAmount.uiAmount:0);
      const k = t.transaction.message.accountKeys.findIndex(x=>(x.pubkey||x).toString()===W);
      const dS = (t.meta.postBalances[k]-t.meta.preBalances[k])/1e9;
      console.log(`${s.blockTime} | ${s.signature.slice(0,10)}... | EUX Delta: ${dE.toFixed(2)} | SOL Delta: ${dS.toFixed(4)}`);
    }
  } catch (e) {
    console.log("Error:", e.message);
  }
}
r();
