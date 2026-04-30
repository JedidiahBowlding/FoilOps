const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();

const WALLET = 'Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce';
const MINT = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
const START_TIME = 1777306043;
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';

async function run() {
    const connection = new Connection(RPC_URL, 'confirmed');
    const pubkey = new PublicKey(WALLET);

    console.log(`Fetching signatures for ${WALLET}...`);
    let signatures = await connection.getSignaturesForAddress(pubkey, { limit: 40 });

    // Sort chronological
    signatures.reverse();

    const results = [];
    for (const sigInfo of signatures) {
        if (sigInfo.blockTime < START_TIME) continue;

        let tx = null;
        let retries = 3;
        while (retries > 0) {
            try {
                tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
                break;
            } catch (e) {
                if (e.message.includes('429')) {
                    await new Promise(r => setTimeout(r, 2000));
                    retries--;
                } else throw e;
            }
        }

        if (!tx) continue;

        const preBalances = tx.meta.preTokenBalances || [];
        const postBalances = tx.meta.postTokenBalances || [];

        let euxDeltas = {};

        // Track EUX deltas
        [...preBalances, ...postBalances].forEach(b => {
            if (b.mint === MINT) {
                if (!euxDeltas[b.owner]) euxDeltas[b.owner] = 0;
            }
        });

        Object.keys(euxDeltas).forEach(owner => {
            const pre = preBalances.find(b => b.owner === owner && b.mint === MINT);
            const post = postBalances.find(b => b.owner === owner && b.mint === MINT);
            const preAmt = pre ? parseFloat(pre.uiTokenAmount.amount) : 0;
            const postAmt = post ? parseFloat(post.uiTokenAmount.amount) : 0;
            euxDeltas[owner] = postAmt - preAmt;
        });

        // SOL Delta for Gif9
        const accountIndex = tx.transaction.message.accountKeys.findIndex(ak => ak.pubkey.equals(pubkey));
        let solDelta = 0;
        if (accountIndex !== -1) {
            solDelta = (tx.meta.postBalances[accountIndex] - tx.meta.preBalances[accountIndex]) / 1e9;
        }

        const gif9EuxDelta = euxDeltas[WALLET] || 0;
        const decimals = postBalances.find(b => b.mint === MINT)?.uiTokenAmount.decimals || 6;
        const uiGif9EuxDelta = gif9EuxDelta / Math.pow(10, decimals);

        // Counterparts (largest opposite delta)
        let counterpart = "N/A";
        let maxOppositeBody = 0;
        Object.entries(euxDeltas).forEach(([owner, delta]) => {
            if (owner !== WALLET) {
                if (Math.abs(delta) > maxOppositeBody) {
                    maxOppositeBody = Math.abs(delta);
                    counterpart = owner;
                }
            }
        });

        results.push({
            blockTime: sigInfo.blockTime,
            signature: sigInfo.signature,
            euxDelta: gif9EuxDelta,
            uiEuxDelta: uiGif9EuxDelta,
            solDelta: solDelta,
            counterpart: counterpart
        });
    }

    console.log("Time       | Signature                                                                  | EUX Delta (UI) | SOL Delta | Counterpart");
    console.log("-----------|----------------------------------------------------------------------------|----------------|-----------|------------");

    let totalIn = 0;
    let totalOut = 0;
    let routerAccount = {};

    results.forEach(r => {
        console.log(`${r.blockTime} | ${r.signature.padEnd(88)} | ${r.uiEuxDelta.toFixed(2).padStart(14)} | ${r.solDelta.toFixed(4).padStart(9)} | ${r.counterpart}`);
        if (r.uiEuxDelta > 0) totalIn += r.uiEuxDelta;
        else totalOut += Math.abs(r.uiEuxDelta);

        if (r.uiEuxDelta < 0 && r.counterpart !== "N/A") {
            routerAccount[r.counterpart] = (routerAccount[r.counterpart] || 0) + Math.abs(r.uiEuxDelta);
        }
    });

    console.log("\n--- Summary ---");
    console.log(`Total EUX Outflow: ${totalOut.toFixed(2)}`);
    console.log(`Total EUX Inflow:  ${totalIn.toFixed(2)}`);
    console.log(`Net EUX Change:    ${(totalIn - totalOut).toFixed(2)}`);

    const topRouter = Object.entries(routerAccount).sort((a, b) => b[1] - a[1])[0];
    if (topRouter && topRouter[1] > 1) {
        console.log(`Significant routed onward to: ${topRouter[0]} (${topRouter[1].toFixed(2)} EUX)`);
    } else {
        console.log("No significant EUX routed onward to individual wallets found.");
    }
}

run().catch(console.error);
