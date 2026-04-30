const wallets = [
  '4gwbU7Q5sUzjC3ZHMd53AEk8MfhgjWmp1AgXL25zrAvR', '4Tzg41af34tjndWHys25fbSgPC3Qyxi29umWC55erjHJ', '7GFUN3bWzJMKMRZ34JLsvcqdssDbXnp589SiE33KVwcC', '7ybe6anz24RNJC47YJ5GnYwcxyyxhBtKFGHmC1bPBsF4', '94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb', 'AwpF13wS7gDFhVjwkz4FPgiTspJdEAJqFU7EfUDqQvzt', 'AZUzwQM28WHDVZTWZWd1PvDMNp974dbn1fabpCc4sKt5', 'BdK16FWaNxfMrMQ7cZHGTA2bkRyTdA1dZ3zxVdgFaYE3', 'BkLW1rh7yxHp8XfrRM37ezkYbP8Tui4XjEG8T8oWYqso', 'Bvtgim23rfocUzxVX9j9QFxTbBnH8JZxnaGLCEkXvjKS', 'Ccqybt7azGdoZmud2oEuPvY37oTuHWg43ERL1fv2Erto', 'CNmv3wvNsMj65PLrYHLw6hSnnky5fZx2F9aa7oU7YpW1', 'DWpvfqzGWuVy9jVSKSShdM2733nrEsnnhsUStYbkj6Nn', 'F16svAz3mNo2CYsMGnAXqx2Q1KPJyF8ocfMDBBqSCFNo', 'GLTy4XjfZCyBmzNzWuyrB4MJLTa8L8KYucg3gBr84qZz'
];
require('dotenv').config();
const rpc = process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || process.env.SOLANA_NETWORK || 'https://api.mainnet-beta.solana.com';
async function run() {
  const results = [];
  const now = Date.now() / 1000;
  for (const w of wallets) {
    try {
      const bRes = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [w] }) });
      const b = await bRes.json();
      const sRes = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [w, { limit: 1 }] }) });
      const s = await sRes.json();
      const sol = b.result ? b.result.value / 1e9 : 0;
      const bt = (s.result && s.result[0]) ? s.result[0].blockTime : null;
      const ts = bt ? new Date(bt * 1000).toISOString().replace('T', ' ').substring(0, 19) : '-';
      const age = bt ? ((now - bt) / 86400).toFixed(2) : '-';
      results.push({ w, sol, ts, age, sig: (s.result && s.result[0] ? s.result[0].signature : null) });
    } catch (e) { results.push({ w, sol: 0, ts: '-', age: '-', sig: null }); }
  }
  results.sort((a, b) => (a.ts === '-' ? 1 : b.ts === '-' ? -1 : b.ts.localeCompare(a.ts) || b.sol - a.sol));
  console.log('Rank Wallet                                        SOL      Latest Tx (UTC)       Age(d)  Signature');
  results.forEach((r, i) => console.log(`${(i + 1).toString().padStart(2)}   ${r.w.padEnd(44)} ${r.sol.toFixed(4).padStart(8)}  ${r.ts.padEnd(20)} ${r.age.padStart(6)}  ${r.sig ? r.sig.substring(0, 18) + '...' : '-'}`));
  console.log(`\nSummary: <24h=${results.filter(r => r.age != '-' && r.age < 1).length}, <7d=${results.filter(r => r.age != '-' && r.age < 7).length}, zero_history=${results.filter(r => r.ts === '-').length}`);
}
run();
