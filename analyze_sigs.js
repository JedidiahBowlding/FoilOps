const { Connection } = require('@solana/web3.js');

const signatures = [
  '4vWvfxaHjiG5owdj6Ec1fSRKddEyBqKd8Rru4xHG2KiRUW6mNRNGgmZzzwaXskZdR2bbvfGgW4o9hCVN9tzNVLB2',
  'yUqfCTkgYPv8JrcYKZsEgbJ7e189AHWssLh3Qwandnv3EYCJyUsG4GZ5maEaTS8ryUdqxCdNtvC2ZiXQTnbrd5a',
  '42cSWCddcy2WGkEmMWzNJXLQxemVaH5fvqhn1i93PgPEvVvWu6CqWFGwJeXwW9u3k3wFJAi4nP1XPqmd1mcLiFon',
  '69W7CBcmzP1TNde6ZnveApoa11C5HLMwxdm4nSXTwwagNc68ojwvuYgLvUSwXXqHrboFi2q3NskmfTgrce24UUy',
  '4XqZWfJrACz5ahiPVnq4B2ZPGHLaPXPhyEjb2Gh4ugCMcSC7RSWqPuC1aHUdGvhyRmWx1U9BdtVJRzkXEh6FT12w'
];

const TARGET_MINT = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
const DEV_WALLET = 'E7iMadA9qRD4K9PeRsitYg19wP23FYnibXXVBJnGezj7';

// Public endpoints often have tight rate limits. Use a delay between requests.
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

async function analyze() {
  const aggregateTargetMint = {};
  const aggregateSol = {};

  for (const sig of signatures) {
    let tx = null;
    let retries = 5;
    while (retries > 0) {
      try {
        tx = await connection.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
        break;
      } catch (e) {
        console.log(`Error fetching ${sig}, retrying... ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
        retries--;
      }
    }

    if (!tx) {
      console.log(`Failed to fetch ${sig}`);
      continue;
    }

    console.log(`\nSignature: ${sig}`);
    console.log(`BlockTime: ${tx.blockTime}`);

    const logs = tx.meta.logMessages || [];
    const isLiquidityAction = logs.some(log => 
      /remove|burn|withdraw|close|initialize|liquidity/i.test(log)
    );
    console.log(`Liquidity Action: ${isLiquidityAction}`);

    const preToken = tx.meta.preTokenBalances || [];
    const postToken = tx.meta.postTokenBalances || [];
    const allTokenOwners = new Set([...preToken.map(t => t.owner), ...postToken.map(t => t.owner)]);

    for (const owner of allTokenOwners) {
      if (!owner) continue;
      const pre = preToken.find(t => t.owner === owner && t.mint === TARGET_MINT);
      const post = postToken.find(t => t.owner === owner && t.mint === TARGET_MINT);
      const preAmt = pre ? (pre.uiTokenAmount.uiAmount || 0) : 0;
      const postAmt = post ? (post.uiTokenAmount.uiAmount || 0) : 0;
      const delta = postAmt - preAmt;
      if (Math.abs(delta) > 0.000001) {
        console.log(`Token Delta [${owner}]: ${delta}`);
        aggregateTargetMint[owner] = (aggregateTargetMint[owner] || 0) + delta;
      }
    }

    const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
    const preBal = tx.meta.preBalances;
    const postBal = tx.meta.postBalances;

    preBal.forEach((pre, i) => {
      const delta = (postBal[i] - pre) / 1e9;
      const addr = accountKeys[i].pubkey ? accountKeys[i].pubkey.toString() : accountKeys[i].toString();
      if (Math.abs(delta) > 0.0001) {
          if (addr === DEV_WALLET || Math.abs(delta) > 1) {
             console.log(`SOL Delta [${addr}]: ${delta.toFixed(4)}`);
             aggregateSol[addr] = (aggregateSol[addr] || 0) + delta;
          }
      }
    });

    // Small delay between transactions to respect rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n--- AGGREGATE TOTALS ---');
  console.log('Target Mint Moves:');
  Object.entries(aggregateTargetMint).sort((a,b) => b[1] - a[1]).forEach(([owner, total]) => {
    console.log(`  ${owner}: ${total}`);
  });
  console.log('SOL Deltas:');
  Object.entries(aggregateSol).sort((a,b) => b[1] - a[1]).forEach(([addr, total]) => {
    console.log(`  ${addr}: ${total.toFixed(4)}`);
  });
}

analyze().catch(console.error);
