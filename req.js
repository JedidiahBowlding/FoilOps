const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
const c = new Connection(RPC_URL);
async function r() {
  const s = await c.getParsedTransaction('5SZpjQn2C92gGQKjEnGYrufNzpkd1VfM1YBnJ6rzhTqahvD27oDk169T6XH96eeEFYPSdgQbKtZct6jPUu65K8wV', { maxSupportedTransactionVersion: 0 });
  console.log(JSON.stringify(s.meta.postTokenBalances.filter(x => x.mint === 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs'), null, 2));
}
r();
