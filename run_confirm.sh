python3 -c "
import requests, os, sys, time
from datetime import datetime

rpc_endpoint = os.getenv('RPC_ENDPOINTS', '').split(',')[0].strip()
wallets = [
    '4gwbU7Q5sUzjC3ZHMd53AEk8MfhgjWmp1AgXL25zrAvR', '4Tzg41af34tjndWHys25fbSgPC3Qyxi29umWC55erjHJ',
    '7GFUN3bWzJMKMRZ34JLsvcqdssDbXnp589SiE33KVwcC', '7ybe6anz24RNJC47YJ5GnYwcxyyxhBtKFGHmC1bPBsF4',
    '94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb', 'AwpF13wS7gDFhVjwkz4FPgiTspJdEAJqFU7EfUDqQvzt',
    'AZUzwQM28WHDVZTWZWd1PvDMNp974dbn1fabpCc4sKt5', 'BdK16FWaNxfMrMQ7cZHGTA2bkRyTdA1dZ3zxVdgFaYE3',
    'BkLW1rh7yxHp8XfrRM37ezkYbP8Tui4XjEG8T8oWYqso', 'Bvtgim23rfocUzxVX9j9QFxTbBnH8JZxnaGLCEkXvjKS',
    'Ccqybt7azGdoZmud2oEuPvY37oTuHWg43ERL1fv2Erto', 'CNmv3wvNsMj65PLrYHLw6hSnnky5fZx2F9aa7oU7YpW1',
    'DWpvfqzGWuVy9jVSKSShdM2733nrEsnnhsUStYbkj6Nn', 'F16svAz3mNo2CYsMGnAXqx2Q1KPJyF8ocfMDBBqSCFNo',
    'GLTy4XjfZCyBmzNzWuyrB4MJLTa8L8KYucg3gBr84qZz'
]
results = []
now = datetime.now()
for w in wallets:
    try:
        resp = requests.post(rpc_endpoint, json={'jsonrpc':'2.0','id':1,'method':'getBalance','params':[w]}, timeout=10)
        sol = resp.json()['result']['value'] / 1e9
        resp = requests.post(rpc_endpoint, json={'jsonrpc':'2.0','id':1,'method':'getSignaturesForAddress','params':[w, {'limit': 1}]}, timeout=10)
        sigs = resp.json().get('result', [])
        latest_tx_time = sigs[0].get('blockTime') if sigs else None
        latest_sig = sigs[0].get('signature') if sigs else 'N/A'
        dt_str, age_days = 'N/A', -1
        if latest_tx_time:
            dt = datetime.fromtimestamp(latest_tx_time)
            dt_str, age_days = dt.strftime('%Y-%m-%d %H:%M:%S'), (now - dt).total_seconds() / 86400
        results.append({'w': w, 'sol': sol, 'time': latest_tx_time or 0, 'dt': dt_str, 'age': age_days, 'sig': latest_sig, 'status': 'OK'})
    except Exception as e:
        results.append({'w': w, 'sol': 0, 'time': 0, 'dt': 'N/A', 'age': -1, 'sig': 'N/A', 'status': 'ERR'})
results.sort(key=lambda x: (x['time'], x['sol']), reverse=True)
print('Rank Wallet                                       SOL Balance  Latest Tx (UTC)      Age (d)  Signature    Status')
for i, r in enumerate(results, 1):
    sig_short = (r['sig'][:8] + '..') if r['sig'] != 'N/A' else 'N/A'
    age_str = f\"{r['age']:.1f}\" if r['age'] >= 0 else 'N/A'
    print(f\"{i:<4} {r['w']:<45} {r['sol']:<12.2f} {r['dt']:<20} {age_str:<8} {sig_short:<12} {r['status']}\")
h24, d7, zero = sum(1 for r in results if 0 <= r['age'] < 1), sum(1 for r in results if 0 <= r['age'] < 7), sum(1 for r in results if r['time'] == 0 and r['status'] == 'OK')
print(f'\nSummary:\nWallets with tx in <24h: {h24}\nWallets with tx in <7d:  {d7}\nWallets with zero tx:    {zero}')
"
