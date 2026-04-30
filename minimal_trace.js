const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();

const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
async function main() {
    const conn = new Connection(RPC_URL);
    const mint = new PublicKey('EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs');
    const sigs = await conn.getSignaturesForAddress(mint, { limit: 10 });
    for (const s of sigs) {
        try {
            const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
            if (!tx) continue;
            const isMatch = tx.meta.logMessages.some(l => /liquidity|remove|burn|withdraw/i.test(l));
            const pre = tx.meta.preBalances;
            const post = tx.meta.postBalances;
            const keys = tx.transaction.message.accountKeys;
            const deltas = keys.map((k, i) => ({
                a: k.pubkey ? k.pubkey.toBase58() : k.toString(),
                d: post[i] - pre[i]
            })).sort((a, b) => b.d - a.d);
            console.log("SIG:", s.signature, "MATCH:", isMatch, "TOP_GAINER:", deltas[0].a, "GAIN_SOL:", deltas[0].d / 1e9);
            await new Promise(r => setTimeout(r, 8000));
        } catch (e) {
            console.log("ERR:", s.signature, e.message);
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}
main();
