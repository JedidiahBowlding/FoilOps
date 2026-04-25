const axios = require('axios');
(async () => {
    try {
        const sol = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd').then(r => r.data.solana.usd);
        const mint = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';
        const rpc = 'https://mainnet.helius-rpc.com/?api-key=d965c9f1-7f28-43f3-8c78-a21f82fa045e';
        const sigs = (await axios.post(rpc, {jsonrpc:'2.0', id:1, method:'getSignaturesForAddress', params:[mint, {limit:50}]})).data.result;
        const wallets = {};
        for(const s of sigs) {
            const tx = (await axios.post(rpc, {jsonrpc:'2.0', id:1, method:'getTransaction', params:[s.signature, {encoding:'jsonParsed', maxSupportedTransactionVersion:0}]})).data.result;
            if(!tx || !tx.meta) continue;
            (tx.meta.postTokenBalances||[]).forEach(pb => {
                if(pb.mint === mint && pb.owner) {
                    const pre = (tx.meta.preTokenBalances||[]).find(pr => pr.accountIndex === pb.accountIndex) || {uiTokenAmount:{uiAmount:0}};
                    if(pb.uiTokenAmount.uiAmount > pre.uiTokenAmount.uiAmount) {
                      if(!wallets[pb.owner]) wallets[pb.owner] = {address:pb.owner, usdSpent:0, acquired:0};
                      wallets[pb.owner].acquired += (pb.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount);
                      const idx = tx.transaction.message.accountKeys.findIndex(ak => (ak.pubkey||ak) === pb.owner);
                      if(idx !== -1) {
                        const solSpent = (tx.meta.preBalances[idx] - tx.meta.postBalances[idx])/1e9;
                        if(solSpent > 0) wallets[pb.owner].usdSpent += solSpent * sol;
                      }
                    }
                }
            });
        }
        const top = Object.values(wallets).sort((a,b)=>b.usdSpent-a.usdSpent).slice(0,10);
        console.log(JSON.stringify({solUsd:sol, sigs:sigs.length, buyers:Object.keys(wallets).length, top}, null, 2));
    } catch(e) { console.error(e); }
})();
