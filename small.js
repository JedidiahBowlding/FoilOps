const { Connection } = require('@solana/web3.js');
const c = new Connection('https://api.mainnet-beta.solana.com');
c.getParsedTransaction('5SZpjQn2C92gGQKjEnGYrufNzpkd1VfM1YBnJ6rzhTqahvD27oDk169T6XH96eeEFYPSdgQbKtZct6jPUu65K8wV', {maxSupportedTransactionVersion:0}).then(t => console.log(JSON.stringify(t.meta.postTokenBalances.filter(x=>x.mint==='EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs'))));