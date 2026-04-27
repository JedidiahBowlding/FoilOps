const { Connection } = require('@solana/web3.js');

const SIG = '5SZpjQn2C92gGQKjEnGYrufNzpkd1VfM1YBnJ6rzhTqahvD27oDk169T6XH96eeEFYPSdgQbKtZct6jPUu65K8wV';
const MINT_EUX = 'EUX5SLDN9Ez8naTNJFJH7kow3QXeMwYcVNcZgcmCBZrs';
const MINT_WSOL = 'So11111111111111111111111111111111111111112';

async function run() {
    const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    const tx = await conn.getParsedTransaction(SIG, { maxSupportedTransactionVersion: 0 });

    if (!tx) {
        console.log("Transaction not found");
        return;
    }

    console.log("--- 1) Basic TX Meta ---");
    console.log(`BlockTime: ${tx.blockTime}`);
    console.log(`Signer: ${tx.transaction.message.accountKeys[0].pubkey.toString()}`);
    console.log(`Status: ${tx.meta.err ? 'Failed' : 'Success'}`);
    console.log(`Fee: ${tx.meta.fee / 1e9} SOL`);
    console.log(`Compute Units: ${tx.meta.computeUnitsConsumed}`);

    console.log("\n--- 2) Instructions ---");
    tx.transaction.message.instructions.forEach((ix, i) => {
        const programId = ix.programId.toString();
        console.log(`Index ${i}: ${programId}`);
        if (programId === '6EF8rrecthR5DkwiZycWn7Peb47VREXp9E52zM27') {
           console.log(`  ^^ Detected Pump.fun`);
        } else if (programId === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') {
           console.log(`  ^^ Detected Pump.fun AMM (Withdraw/Burn)`);
        }
    });

    console.log("\n--- 3) Token balance deltas ---");
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    const owners = Array.from(new Set([...preBalances, ...postBalances].map(b => b.owner)));
    const mints = [MINT_EUX, MINT_WSOL];

    owners.forEach(owner => {
        mints.forEach(mint => {
            const pre = preBalances.find(b => b.owner === owner && b.mint === mint);
            const post = postBalances.find(b => b.owner === owner && b.mint === mint);
            const preAmt = pre ? BigInt(pre.uiTokenAmount.amount) : 0n;
            const postAmt = post ? BigInt(post.uiTokenAmount.amount) : 0n;
            const delta = postAmt - preAmt;
            if (delta !== 0n) {
                console.log(`Owner: ${owner} | Mint: ${mint.slice(0,4)}...`);
                console.log(`  Delta: ${delta.toString()} (UI: ${post?.uiTokenAmount?.uiAmountString || '0'} - ${pre?.uiTokenAmount?.uiAmountString || '0'})`);
            }
        });
    });

    console.log("\n--- 4) LP Token / Burn ---");
    const lpMint = '3gEXmffE5EKWLK2w6EBFVTcDi7Ao54fHYp1RrdjA71nL';
    const lpPre = preBalances.find(b => b.mint === lpMint);
    const lpPost = postBalances.find(b => b.mint === lpMint);
    const lpDelta = (lpPost ? BigInt(lpPost.uiTokenAmount.amount) : 0n) - (lpPre ? BigInt(lpPre.uiTokenAmount.amount) : 0n);
    console.log(`LP Mint: ${lpMint}`);
    console.log(`LP Delta: ${lpDelta.toString()}`);

    console.log("\n--- 5) SOL Balance Deltas (> 0.1) ---");
    const accountKeys = tx.transaction.message.accountKeys;
    tx.meta.preBalances.forEach((pre, i) => {
        const post = tx.meta.postBalances[i];
        const delta = (post - pre) / 1e9;
        if (Math.abs(delta) > 0.1) {
            console.log(`Account ${i} [${accountKeys[i].pubkey.toString()}]: ${delta.toFixed(4)} SOL`);
        }
    });

    console.log("\n--- 6) Lineage ---");
    console.log("Market/Pool (Cd14...) -> Recipient (Gif9...) for EUX leg.");
    console.log("WSOL leg wrapped/unwrapped via Index 4: Recipient (Gif9...) received SOL delta from account 6.");
}

run().catch(console.error);
