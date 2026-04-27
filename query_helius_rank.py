import os
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

WALLETS = [
    "4gwbU7Q5sUzjC3ZHMd53AEk8MfhgjWmp1AgXL25zrAvR",
    "4Tzg41af34tjndWHys25fbSgPC3Qyxi29umWC55erjHJ",
    "7GFUN3bWzJMKMRZ34JLsvcqdssDbXnp589SiE33KVwcC",
    "7ybe6anz24RNJC47YJ5GnYwcxyyxhBtKFGHmC1bPBsF4",
    "94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb",
    "AwpF13wS7gDFhVjwkz4FPgiTspJdEAJqFU7EfUDqQvzt",
    "AZUzwQM28WHDVZTWZWd1PvDMNp974dbn1fabpCc4sKt5",
    "BdK16FWaNxfMrMQ7cZHGTA2bkRyTdA1dZ3zxVdgFaYE3",
    "BkLW1rh7yxHp8XfrRM37ezkYbP8Tui4XjEG8T8oWYqso",
    "Bvtgim23rfocUzxVX9j9QFxTbBnH8JZxnaGLCEkXvjKS",
    "Ccqybt7azGdoZmud2oEuPvY37oTuHWg43ERL1fv2Erto",
    "CNmv3wvNsMj65PLrYHLw6hSnnky5fZx2F9aa7oU7YpW1",
    "DWpvfqzGWuVy9jVSKSShdM2733nrEsnnhsUStYbkj6Nn",
    "F16svAz3mNo2CYsMGnAXqx2Q1KPJyF8ocfMDBBqSCFNo",
    "GLTy4XjfZCyBmzNzWuyrB4MJLTa8L8KYucg3gBr84qZz",
]


def load_dotenv(path):
    out = {}
    p = Path(path)
    if not p.exists():
        return out
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def pick_rpc_endpoint():
    env = {}
    env.update(load_dotenv(".env"))
    env.update(load_dotenv(".env.production"))
    env.update(load_dotenv(".env.local"))
    env.update(os.environ)

    rpc = (env.get("RPC_ENDPOINT") or "").strip()
    if (not rpc) or ("REPLACE_HELIUS_API_KEY" in rpc):
        endpoints = (env.get("RPC_ENDPOINTS") or "").split(",")
        rpc = endpoints[0].strip() if endpoints else ""
    return rpc


def rpc_call(rpc_url, method, params, retries=3):
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }).encode("utf-8")

    last_err = None
    for i in range(retries):
        try:
            req = Request(
                rpc_url,
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
                method="POST",
            )
            with urlopen(req, timeout=25) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            if "error" in body:
                raise RuntimeError(str(body["error"]))
            return body.get("result")
        except Exception as exc:
            last_err = str(exc)
            time.sleep(0.6 * (i + 1))
    raise RuntimeError(last_err or "unknown rpc error")


def fmt_ts(block_time):
    if not block_time:
        return None
    return datetime.fromtimestamp(block_time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def mask_rpc(url):
    if "api-key=" in url:
        return url.split("api-key=")[0] + "api-key=***"
    return url


def main():
    rpc = pick_rpc_endpoint()
    if not rpc:
        print("BLOCKER: missing RPC_ENDPOINT/RPC_ENDPOINTS")
        return
    if "helius" not in rpc.lower():
        print("BLOCKER: endpoint is not Helius:", mask_rpc(rpc))
        return

    print("RPC:", mask_rpc(rpc))

    now = datetime.now(timezone.utc).timestamp()
    rows = []

    for w in WALLETS:
        row = {
            "wallet": w,
            "sol": 0.0,
            "latest_block": 0,
            "latest_tx_utc": None,
            "age_days": None,
            "sig": None,
            "status": "ok",
        }

        try:
            bal = rpc_call(rpc, "getBalance", [w])
            lamports = (bal or {}).get("value", 0) or 0
            row["sol"] = lamports / 1e9
        except Exception as exc:
            row["status"] = f"balance_error:{str(exc)[:80]}"

        try:
            sigs = rpc_call(rpc, "getSignaturesForAddress", [w, {"limit": 3}]) or []
            if sigs:
                top = sigs[0]
                bt = top.get("blockTime") or 0
                row["latest_block"] = bt
                row["latest_tx_utc"] = fmt_ts(bt)
                row["age_days"] = round((now - bt) / 86400, 2) if bt else None
                row["sig"] = top.get("signature")
            elif row["status"] == "ok":
                row["status"] = "no_tx_history"
        except Exception as exc:
            if row["status"] == "ok":
                row["status"] = f"sig_error:{str(exc)[:80]}"
            else:
                row["status"] += f"|sig_error:{str(exc)[:50]}"

        rows.append(row)

    rows.sort(key=lambda r: (r["latest_block"], r["sol"]), reverse=True)

    print("\nRank Wallet                                        SOL        Latest Tx (UTC)         Age(d)  Latest Sig            Status")
    for i, r in enumerate(rows, 1):
        sig = (r["sig"][:18] + "...") if r["sig"] else "-"
        latest = r["latest_tx_utc"] or "-"
        age = str(r["age_days"]) if r["age_days"] is not None else "-"
        print(f"{i:>2}   {r['wallet']:<44} {r['sol']:>8.4f}   {latest:<22} {age:>6}  {sig:<21} {r['status']}")

    under24h = sum(1 for r in rows if r["age_days"] is not None and r["age_days"] < 1)
    under7d = sum(1 for r in rows if r["age_days"] is not None and r["age_days"] < 7)
    zero_history = sum(1 for r in rows if r["latest_block"] == 0)
    print(f"\nSummary: under24h={under24h}, under7d={under7d}, zeroHistory={zero_history}")


if __name__ == "__main__":
    main()
