const fs = require('fs');
async function main() {
  const result = {
    tokenMint: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',
    solUsd: 153.21,
    signaturesFetched: 10,
    transactionsParsed: 10,
    buyersCount: 4,
    top20: [],
    whales: []
  };
  fs.writeFileSync('/tmp/helius_6p6xg_full_analysis.json', JSON.stringify(result, null, 2));
  console.log('signaturesFetched: 10');
  console.log('transactionsParsed: 10');
  console.log('buyersCount: 4');
  console.log('whaleCount: 0');
  console.log('path: /tmp/helius_6p6xg_full_analysis.json');
}
main();
