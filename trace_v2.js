const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
    const conn = new Connection('https://api.mainnet-beta.solana.com');
    const mint = new PublicKey('EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs');
    
    console.log("Fetching up to 80 signatures...");
    let sigs = [];
    try {
        sigs = await conn.getSignaturesForAddress(mint, { limit: 80 });
    } catch (e) {
        console.error("Failed to fetch signatures:", e.message);
        return;
    }
    
    const candidates = [];
    const walletAgg = {}; 
    const limit = Math.min(sigs.length, 40);

    console.log("Processing " + limit + " txs with 7s delay...");

    for (let i = 0; i < limit; i++) {
        const s = sigs[i];
        try {
            const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
            if (!tx || !tx.meta) {
                await new Promise(r => setTimeout(r, 7000));
                continue;
            }

            const logs = tx.meta.logMessages || [];
            const isTargetLog = logs.some(l => /liquidity|remove|burn|withdraw|close|lp/i.test(l));
            
            let mintDrop = false;
            const preToken = tx.meta.preTokenBalances || [];
            const postToken = tx.meta.postTokenBalances || [];
            
            const preBal = preToken.find(b => b.mint === mint.toBase58());
            const postBal = postToken.find(b => b.mint === mint.toBase58());
            if (preBal && postBal) {
                const diff = (postBal.uiTokenAmount.uiAmount || 0) - (preBal.uiTokenAmount.uiAmount || 0);
                if (diff < -100) mintDrop = true; 
            }

            if (isTargetLog || mintDrop) {
                const gainers = [];
                const pre = tx.meta.preBalances;
                const post = tx.meta.postBalances;
                const keys = tx.transaction.message.accountKeys;
                
                keys.forEach((k, idx) => {
                    const addr = k.pubkey ? k.pubkey.toBase58() : k.toString();
                    const delta = (post[idx] - pre[idx]) / 1e9;
                    if (delta > 0.0005) {
                        gainers.push({ addr, delta });
                        if (!walletAgg[addr]) walletAgg[addr] = { count: 0, sol: 0 };
                        walletAgg[addr].count++;
                        walletAgg[addr].sol += delta;
                    }
                });

                gainers.sort((a,b) => b.delta - a.delta);
                candidates.push({
                    sig: s.signature,
                    ts: s.blockTime,
                    gainers: gainers.slice(0, 3)
                });
            }

            await new Promise(r => setTimeout(r, 7000));
        } catch (e) {
            console.log("Error processing " + s.signature + ": " + e.message);
            if (e.message.indexOf('429') !== -1) {
              await new Promise(r => setTimeout(r, 15000));
              i--; 
            }
        }
    }

    console.log("\n--- TOP 15 RANKED WALLETS ---");
    const rankedAddresses = Object.entries(walletAgg)
        .sort((a, b) => (b[1].sol - a[1].sol) || (b[1].count - a[1].count))
        .slice(0, 15);

    if (rankedAddresses.length === 0) {
        console.log("No candidates with SOL gainers found.");
    } else {
        rankedAddresses.forEach(([addr, stats], idx) => {
            console.log((idx + 1) + ". " + addr + " | Freq: " + stats.count + " | Total SOL: " + stats.sol.toFixed(4));
        });
    }

    console.log("\n--- TOP 10 CANDIDATE SIGNATURES ---");
    candidates.slice(0, 10).forEach(c => {
        const timeStr = c.ts ? new Date(c.ts * 1000).toISOString() : "N/A";
        const topGainers = c.gainers.map(g => g.addr + "(" + g.delta.toFixed(3) + ")").join(", ");
        console.log("SIG: " + c.sig + " | TIME: " + timeStr);
        console.log("  Gainers: " + topGainers);
    });
}
main();
