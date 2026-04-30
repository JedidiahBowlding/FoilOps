const { Connection } = require('@solana/web3.js');
require('dotenv').config();
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
const c = new Connection(RPC_URL);
c.getParsedTransaction('5SZpjQn2C92gGQKjEnGYrufNzpkd1VfM1YBnJ6rzhTqahvD27oDk169T6XH96eeEFYPSdgQbKtZct6jPUu65K8wV', { maxSupportedTransactionVersion: 0 }).then(t => console.log(JSON.stringify(t.meta.postTokenBalances.filter(x => x.mint === 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs'))));
