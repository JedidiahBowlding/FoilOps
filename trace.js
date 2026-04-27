const { Connection, PublicKey } = require('@solana/web3.js');
async function main() {
    const conn = new Connection('https://api.mainnet-beta.solana.com');
    const mint = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
    const sigs = await conn.getSignaturesForAddress(new PublicKey(mint), { limit: 5 });
    for (const s of sigs) {
        const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        if (tx && tx.meta) {
            console.log("SIG: " + s.signature);
            tx.transaction.message.accountKeys.forEach((k, i) => {
                const delta = (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9;
                if (delta > 0.001) console.log("  " + (k.pubkey || k).toString() + " +" + delta.toFixed(3));
            });
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}
main();
