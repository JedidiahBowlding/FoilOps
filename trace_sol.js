const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();

async function main() {
    const endpoint = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(endpoint, 'confirmed');
    const walletAddress = new PublicKey('GEE4vCGGwdAaSrfLfv1r6ZcWDBh6Dohqt6rT5iFiMGPZ');

    process.stderr.write('Fetching signatures for ' + walletAddress.toBase58() + '...\n');
    let signatures;
    try {
        signatures = await connection.getSignaturesForAddress(walletAddress, { limit: 10 });
    } catch (err) {
        process.stderr.write('Failed to fetch signatures: ' + err.message + '\n');
        return;
    }

    const summary = {};
    let totalOutflow = 0;

    for (let i = 0; i < signatures.length; i++) {
        const sigInfo = signatures[i];
        try {
            const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
            if (!tx || !tx.meta) continue;

            const instructions = tx.transaction.message.instructions;
            const innerInstructions = tx.meta.innerInstructions || [];

            const processInstruction = (ix) => {
                if (ix.program === 'system' && ix.parsed && ix.parsed.type === 'transfer') {
                    const { source, destination, lamports } = ix.parsed.info;
                    if (source === walletAddress.toBase58()) {
                        const amount = lamports / 1e9;
                        if (!summary[destination]) {
                            summary[destination] = { count: 0, totalSOL: 0, signatures: [] };
                        }
                        summary[destination].count += 1;
                        summary[destination].totalSOL += amount;
                        if (summary[destination].signatures.length < 3) {
                            summary[destination].signatures.push(sigInfo.signature);
                        }
                        totalOutflow += amount;
                    }
                }
            };

            instructions.forEach(processInstruction);
            innerInstructions.forEach(inner => inner.instructions.forEach(processInstruction));

            process.stderr.write('Processed ' + (i + 1) + '/' + signatures.length + ' transactions...\n');
            await new Promise(r => setTimeout(r, 3000));

        } catch (err) {
            process.stderr.write('Error processing ' + sigInfo.signature + ': ' + err.message + '\n');
            if (err.message.includes('429')) {
                await new Promise(r => setTimeout(r, 10000));
                i--; // Retry
            }
        }
    }

    const sortedDestinations = Object.entries(summary)
        .sort((a, b) => b[1].totalSOL - a[1].totalSOL)
        .slice(0, 10)
        .map(([address, data]) => {
            return { address: address, count: data.count, totalSOL: data.totalSOL, signatures: data.signatures };
        });

    process.stdout.write(JSON.stringify({
        totalOutflowSOL: totalOutflow,
        topDestinations: sortedDestinations
    }, null, 2) + '\n');
}

main().catch(console.error);
