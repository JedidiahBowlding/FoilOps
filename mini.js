const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();

const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
async function run() {
  const connection = new Connection(RPC_URL, "confirmed");
  const walletAddr = "Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce";
  const mintAddr = "EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs";
  const startBlockTime = 1777306043;
  const sigs = await connection.getSignaturesForAddress(new PublicKey(walletAddr), { limit: 10 });
  console.log("Found sigs:", sigs.length);
  for (const s of sigs) {
    if (s.blockTime < startBlockTime) continue;
    const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    console.log(s.signature.slice(0, 12), s.blockTime, tx ? "Parsed" : "Null");
  }
}
run();
