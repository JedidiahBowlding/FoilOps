const { Connection } = require('@solana/web3.js');
require('dotenv').config();
const sigs = [
  '42cSWCddcy2WGkEmMWzNJXLQxemVaH5fvqhn1i93PgPEvVvWu6CqWFGwJeXwW9u3k3wFJAi4nP1XPqmd1mcLiFon',
  '69W7CBcmzP1TNde6ZnveApoa11C5HLMwxdm4nSXTwwagNc68ojwvuYgLvUSwXXqHrboFi2q3NskmfTgrce24UUy',
  '4XqZWfJrACz5ahiPVnq4B2ZPGHLaPXPhyEjb2Gh4ugCMcSC7RSWqPuC1aHUdGvhyRmWx1U9BdtVJRzkXEh6FT12w'
];
const TARGET_MINT = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
const DEV_WALLET = 'E7iMadA9qRD4K9PeRsitYg19wP23FYnibXXVBJnGezj7';
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC_URL, 'confirmed');
async function run() {
  for (const sig of sigs) {
    let tx = null;
    while (!tx) {
      try {
        tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
        if (!tx) { await new Promise(r => setTimeout(r, 10000)); }
      } catch (e) { await new Promise(r => setTimeout(r, 10000)); }
    }
    console.log('\nSig:', sig);
    const keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
    tx.meta.preBalances.forEach((pre, i) => {
      const d = (tx.meta.postBalances[i] - pre) / 1e9;
      const a = keys[i].toString();
      if (Math.abs(d) > 0.001 && (a === DEV_WALLET || Math.abs(d) > 1)) console.log(`SOL Delta [${a}]: ${d.toFixed(4)}`);
    });
    await new Promise(r => setTimeout(r, 2000));
  }
}
run();
