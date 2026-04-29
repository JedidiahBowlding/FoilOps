const SIG = '4CCwFdeqtgGEtFj7mjdtwguWMkNgm6iw72XGfTz8PGhRPUNuvsF2NA3d5DVS7eCqsnBsxNEMxXSqyR2PaxV16dR1';
const EUX_MINT = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';

async function rpc(method, params) {
  const r = await fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

(async () => {
  try {
    const tx = await rpc('getTransaction', [SIG, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    const meta = tx.meta;
    const msg = tx.transaction.message;
    const accounts = msg.accountKeys.map(k => typeof k === 'string' ? k : k.pubkey);

    console.log('=== TRANSACTION OVERVIEW ===');
    console.log('Signature:', SIG);
    console.log('Block time:', new Date(tx.blockTime * 1000).toISOString());
    console.log('Fee:', meta.fee / 1e9, 'SOL');
    console.log('Fee payer:', accounts[0]);
    console.log('Success:', !meta.err);

    console.log('\n=== SOL BALANCE CHANGES ===');
    meta.preBalances.forEach((pre, i) => {
      const post = meta.postBalances[i];
      const delta = (post - pre) / 1e9;
      if (Math.abs(delta) > 0.000001) {
        console.log(`  [${i}] ${accounts[i]} : ${delta > 0 ? '+' : ''}${delta.toFixed(9)} SOL`);
      }
    });

    console.log('\n=== TOKEN BALANCE CHANGES ===');
    const pre = meta.preTokenBalances || [];
    const post = meta.postTokenBalances || [];
    const allIdx = new Set([...pre.map(t => t.accountIndex), ...post.map(t => t.accountIndex)]);
    for (const idx of allIdx) {
      const preE = pre.find(t => t.accountIndex === idx);
      const postE = post.find(t => t.accountIndex === idx);
      const mint = preE?.mint || postE?.mint;
      const owner = preE?.owner || postE?.owner;
      const preAmt = parseFloat(preE?.uiTokenAmount?.uiAmountString || '0');
      const postAmt = parseFloat(postE?.uiTokenAmount?.uiAmountString || '0');
      const delta = postAmt - preAmt;
      if (Math.abs(delta) > 0) {
        const label = mint === EUX_MINT ? ' *** EUX ***' : '';
        console.log(`  [${idx}] owner=${owner} mint=${mint}${label}`);
        console.log(`        delta=${delta > 0 ? '+' : ''}${delta.toFixed(6)}`);
      }
    }

    console.log('\n=== PROGRAM INVOCATIONS ===');
    const insts = msg.instructions || [];
    insts.forEach((ix, i) => {
      const prog = typeof ix.programId === 'string' ? ix.programId : ix.programId?.pubkey;
      console.log(`  [${i}] program=${prog}`);
      if (ix.parsed) {
        console.log('       type:', ix.parsed.type, JSON.stringify(ix.parsed.info).slice(0, 300));
      }
    });

    console.log('\n=== INNER INSTRUCTIONS ===');
    (meta.innerInstructions || []).forEach(group => {
      group.instructions.forEach(ix => {
        const prog = typeof ix.programId === 'string' ? ix.programId : ix.programId?.pubkey;
        if (ix.parsed) {
          const info = ix.parsed.info;
          console.log(`  program=${prog} type=${ix.parsed.type}`);
          if (info?.destination) console.log(`    -> destination: ${info.destination}`);
          if (info?.source) console.log(`    -> source: ${info.source}`);
          if (info?.amount) console.log(`    -> amount: ${info.amount}`);
          if (info?.tokenAmount) console.log(`    -> tokenAmount: ${JSON.stringify(info.tokenAmount)}`);
          if (info?.lamports) console.log(`    -> lamports: ${info.lamports} (${(info.lamports / 1e9).toFixed(6)} SOL)`);
        }
      });
    });

    console.log('\n=== ALL ACCOUNTS ===');
    accounts.forEach((a, i) => console.log(`  [${i}] ${a}`));

  } catch (e) {
    console.error('ERROR:', e.message);
  }
})();
