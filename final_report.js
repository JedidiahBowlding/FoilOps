const { Connection, PublicKey } = require('@solana/web3.js');

async function analyze() {
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const walletAddr = "Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce";
    const mintAddr = "EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs";
    const startBlockTime = 1777306043;
    const limit = 5; // Very small limit for guaranteed output

    const walletPubkey = new PublicKey(walletAddr);
    console.log(`Analyzing Wallet: ${walletAddr}`);
    
    let signatures = [];
    try {
        signatures = await connection.getSignaturesForAddress(walletPubkey, { limit });
    } catch (e) {
        console.error("RPC Error:", e.message);
        return;
    }
    
    const filteredSigs = signatures.filter(s => s.blockTime >= startBlockTime);
    console.log(`Found ${filteredSigs.length} transactions after LP removal.`);

    const results = [];
    let inflow = 0; let outflow = 0;
    const counterparts = new Set();

    for (const sigInfo of filteredSigs) {
        try {
            const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
            if (!tx) continue;

            const pre = tx.meta.preTokenBalances.find(b => b.owner === walletAddr && b.mint === mintAddr);
            const post = tx.meta.postTokenBalances.find(b => b.owner === walletAddr && b.mint === mintAddr);
            const delta = ((post ? post.uiTokenAmount.uiAmount : 0) - (pre ? pre.uiTokenAmount.uiAmount : 0));

            let cp = "N/A"; let cpDelta = 0;
            const other = tx.meta.postTokenBalances.find(b => b.owner !== walletAddr && b.mint === mintAddr);
            if (other) {
                cp = other.owner;
                const otherPre = tx.meta.preTokenBalances.find(b => b.owner === cp && b.mint === mintAddr);
                cpDelta = (other.uiTokenAmount.uiAmount - (otherPre ? otherPre.uiTokenAmount.uiAmount : 0));
                counterparts.add(cp);
            }

            if (delta > 0) inflow += delta; else outflow += Math.abs(delta);

            results.push({
                time: sigInfo.blockTime,
                sig: sigInfo.signature.slice(0, 12),
                delta: delta.toFixed(2),
                cp: cp.slice(0, 8),
                cpDelta: cpDelta.toFixed(2),
                sol: "0.00",
                type: delta > 0 ? "Inflow" : (delta < 0 ? "Outflow" : "Other")
            });
            await new Promise(r => setTimeout(r, 5000));
        } catch (e) {
            console.log("Error fetching tx:", sigInfo.signature.slice(0, 8));
        }
    }

    console.log("\n--- LEDGER ---");
    console.log("blockTime | sig | Gif9 EUX | CP | CP Delta | SOL | Class");
    results.forEach(r => console.log(`${r.time} | ${r.sig} | ${r.delta} | ${r.cp} | ${r.cpDelta} | ${r.sol} | ${r.type}`));
    
    console.log("\n--- TOTALS ---");
    console.log(`In: ${inflow.toFixed(2)} | Out: ${outflow.toFixed(2)} | Net: ${(inflow - outflow).toFixed(2)}`);
    console.log(`Unique CPs: ${counterparts.size}`);
}
analyze();
