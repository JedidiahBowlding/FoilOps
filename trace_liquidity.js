const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();

const MINT_ADDRESS = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
const RPC_ENDPOINT = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
const SIGNATURE_LIMIT = 150;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const mintPubkey = new PublicKey(MINT_ADDRESS);

    console.log('Fetching signatures for mint: ' + MINT_ADDRESS);
    const signaturesInfo = await connection.getSignaturesForAddress(mintPubkey, { limit: SIGNATURE_LIMIT });
    console.log('Found ' + signaturesInfo.length + ' signatures.');

    const candidates = [];
    const solGainersMap = {};

    for (let i = 0; i < signaturesInfo.length; i++) {
        const sigInfo = signaturesInfo[i];
        const signature = sigInfo.signature;

        try {
            const tx = await connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
            });

            if (!tx) {
                console.log('Skip ' + signature + ' (not found)');
                continue;
            }

            let reasons = [];
            const logs = tx.meta.logMessages || [];
            const keywords = ['withdraw', 'remove', 'burn', 'close', 'lp', 'liquidity'];

            for (const log of logs) {
                const lowerLog = log.toLowerCase();
                if (keywords.some(k => lowerLog.includes(k))) {
                    reasons.push('Log match: ' + log.substring(0, 50));
                    break;
                }
            }

            const preBalances = tx.meta.preTokenBalances || [];
            const postBalances = tx.meta.postTokenBalances || [];

            for (const pre of preBalances) {
                if (pre.mint === MINT_ADDRESS) {
                    const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
                    const preAmt = BigInt(pre.uiTokenAmount.amount);
                    const postAmt = post ? BigInt(post.uiTokenAmount.amount) : 0n;
                    if (preAmt > postAmt) {
                        reasons.push('Token balance drop on account index ' + pre.accountIndex);
                    }
                }
            }

            if (reasons.length > 0) {
                const solGains = [];
                const preSol = tx.meta.preBalances;
                const postSol = tx.meta.postBalances;
                const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;

                for (let j = 0; j < preSol.length; j++) {
                    const delta = postSol[j] - preSol[j];
                    if (delta > 0) {
                        const acc = accountKeys[j].toBase58();
                        solGains.push({ account: acc, delta });
                        solGainersMap[acc] = (solGainersMap[acc] || 0) + delta;
                    }
                }

                solGains.sort((a, b) => b.delta - a.delta);

                const tokenReceivers = [];
                for (const post of postBalances) {
                    if (post.mint === MINT_ADDRESS) {
                        const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
                        const postAmt = BigInt(post.uiTokenAmount.amount);
                        const preAmt = pre ? BigInt(pre.uiTokenAmount.amount) : 0n;
                        if (postAmt > preAmt) {
                            tokenReceivers.push({ accountIndex: post.accountIndex, owner: post.owner, delta: postAmt - preAmt });
                        }
                    }
                }

                candidates.push({
                    signature,
                    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'unknown',
                    reasons: [...new Set(reasons)],
                    programIds: tx.transaction.message.compiledInstructions.map(ix => {
                        const idx = ix.programIdIndex;
                        return accountKeys[idx] ? accountKeys[idx].toBase58() : 'unknown';
                    }),
                    topSolGainers: solGains.slice(0, 3),
                    topTokenReceivers: tokenReceivers
                });
            }

            process.stdout.write('.');
            await sleep(300);
        } catch (err) {
            console.error('\nError fetching ' + signature + ': ' + err.message);
            if (err.message.includes('429')) {
                await sleep(2000);
            }
        }
    }

    console.log('\n--- CANDIDATE TRANSACTIONS ---');
    candidates.forEach(c => {
        console.log('Signature: ' + c.signature);
        console.log('Time: ' + c.blockTime);
        console.log('Reasons: ' + c.reasons.join(', '));
        console.log('Programs: ' + [...new Set(c.programIds)].join(', '));
        console.log('Top SOL Gainers: ' + c.topSolGainers.map(g => g.account + ' (+' + (g.delta / 1e9).toFixed(4) + ' SOL)').join(', '));
        console.log('----------------------------');
    });

    console.log('\n--- LIKELY DESTINATION WALLETS (by SOL gain) ---');
    const sortedWallets = Object.entries(solGainersMap).sort((a, b) => b[1] - a[1]);
    sortedWallets.slice(0, 10).forEach(([wallet, totalGain]) => {
        const freq = candidates.filter(c => c.topSolGainers.some(g => g.account === wallet)).length;
        console.log('Wallet: ' + wallet + ' | Total SOL Gain: ' + (totalGain / 1e9).toFixed(4) + ' SOL | Frequency: ' + freq);
    });
}

main().catch(console.error);
