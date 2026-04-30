import os
import requests
import time
from datetime import datetime
W = ["4gwbU7Q5sUzjC3ZHMd53AEk8MfhgjWmp1AgXL25zrAvR", "4Tzg41af34tjndWHys25fbSgPC3Qyxi29umWC55erjHJ", "7GFUN3bWzJMKMRZ34JLsvcqdssDbXnp589SiE33KVwcC", "7ybe6anz24RNJC47YJ5GnYwcxyyxhBtKFGHmC1bPBsF4", "94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb", "AwpF13wS7gDFhVjwkz4FPgiTspJdEAJqFU7EfUDqQvzt", "AZUzwQM28WHDVZTWZWd1PvDMNp974dbn1fabpCc4sKt5", "BdK16FWaNxfMrMQ7cZHGTA2bkRyTdA1dZ3zxVdgFaYE3", "BkLW1rh7yxHp8XfrRM37ezkYbP8Tui4XjEG8T8oWYqso", "Bvtgim23rfocUzxVX9j9QFxTbBnH8JZxnaGLCEkXvjKS", "Ccqybt7azGdoZmud2oEuPvY37oTuHWg43ERL1fv2Erto", "CNmv3wvNsMj65PLrYHLw6hSnnky5fZx2F9aa7oU7YpW1", "DWpvfqzGWuVy9jVSKSShdM2733nrEsnnhsUStYbkj6Nn", "F16svAz3mNo2CYsMGnAXqx2Q1KPJyF8ocfMDBBqSCFNo", "GLTy4XjfZCyBmzNzWuyrB4MJLTa8L8KYucg3gBr84qZz"]
U = os.getenv("QUICKNODE_RPC_URL") or os.getenv("RPC_ENDPOINT") or os.getenv("SOLANA_NETWORK") or "https://api.mainnet-beta.solana.com"
R = []
for w in W:
    try:
        b = requests.post(U, json={"jsonrpc":"2.0","id":1,"method":"getBalance","params":[w]}, timeout=10).json()["result"]["value"]/1e9
        s = requests.post(U, json={"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":[w,{"limit":1}]}, timeout=10).json()["result"]
        t = s[0].get("blockTime", 0) if s else 0
        R.append({"w":w,"b":b,"t":t,"dt":datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M:%S") if t else "N/A"})
    except Exception as e: R.append({"w":w,"b":0,"t":0,"dt":"N/A","e":str(e)})
    time.sleep(0.5)
R.sort(key=lambda x: (x["t"], x["b"]), reverse=True)
print(f"{'Rank':<4} {'Wallet':<45} {'SOL':<10} {'Latest Tx':<20}")
for i,x in enumerate(R,1): print(f"{i:<4} {x['w']:<45} {x['b']:<10.2f} {x['dt']:<20} {x.get('e','')}")
